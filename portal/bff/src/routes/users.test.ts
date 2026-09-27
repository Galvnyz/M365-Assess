import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { tenantScope } from "../rbac/scope.js";
import { buildServer, type RequestContext, type Route } from "../server.js";
import {
  TENANT_USERS_PATH,
  USERS_OPENAPI,
  USERS_PERMISSION,
  createTenantUsersRoute,
  getTenantUsers,
  parseTenantUsersFilter,
  type TenantUser,
  type TenantUsersFilter,
  type TenantUsersPage,
  type TenantUsersProvider,
  type UsersCaller,
} from "./users.js";

const TENANT = "tenant-a";
const OTHER_TENANT = "tenant-b";

const USER_ONE: TenantUser = {
  id: "user-1",
  displayName: "Member One",
  userPrincipalName: "member.one@example.invalid",
  userType: "member",
  licenses: ["sku-1"],
  mfaState: "registered",
  lastSignInDateTime: "2026-08-01T00:00:00.000Z",
  status: "enabled",
  department: "Engineering",
};

const USER_TWO: TenantUser = {
  id: "user-2",
  displayName: "Guest Two",
  userPrincipalName: "guest.two@example.invalid",
  userType: "guest",
  licenses: [],
  mfaState: "unknown",
  lastSignInDateTime: null,
  status: "disabled",
  department: null,
};

class FakeProvider implements TenantUsersProvider {
  readonly calls: Array<{ tenantId: string; filter: TenantUsersFilter }> = [];

  constructor(private readonly page: TenantUsersPage = { items: [USER_ONE, USER_TWO], nextCursor: null }) {}

  async listUsers(tenantId: string, filter: TenantUsersFilter): Promise<TenantUsersPage> {
    this.calls.push({ tenantId, filter });
    return { items: [...this.page.items], nextCursor: this.page.nextCursor };
  }
}

function callerFor(tenantIds: readonly string[] | "all"): UsersCaller {
  return {
    roles: [],
    tenantScope: tenantIds === "all" ? { all: true, tenantIds: [] } : tenantScope(tenantIds),
  };
}

function optionsFor(caller: UsersCaller | undefined, allowed: boolean, provider?: FakeProvider) {
  const users = provider ?? new FakeProvider();
  const routes = createTenantUsersRoute({
    provider: users,
    resolveCaller: () => caller,
    authorize: async (_caller, permission) => {
      if (!allowed || permission !== USERS_PERMISSION) {
        throw new AppError("auth.forbidden", "not permitted to perform this action", 403);
      }
    },
  });
  return { provider: users, routes };
}

const openServers: Server[] = [];

async function startServer(routes: readonly Route[]) {
  const server = buildServer({ routes });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  openServers.push(server);
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe("tenant users handler", () => {
  it("returns the §3.1 columns as a cursor-paginated page", async () => {
    const provider = new FakeProvider({ items: [USER_ONE], nextCursor: "cursor-2" });

    const response = await getTenantUsers(provider, TENANT, { cursor: null, limit: 100 });

    expect(response.status).toBe(200);
    expect(response.body.nextCursor).toBe("cursor-2");
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toEqual(USER_ONE);
    expect(provider.calls).toEqual([{ tenantId: TENANT, filter: { cursor: null, limit: 100 } }]);
  });

  it("rejects a blank tenant id", async () => {
    const provider = new FakeProvider();

    await expect(getTenantUsers(provider, "  ", { cursor: null, limit: 100 })).rejects.toMatchObject({
      status: 400,
    });
    expect(provider.calls).toHaveLength(0);
  });
});

describe("tenant users filter parsing", () => {
  function query(params: Record<string, string>): URLSearchParams {
    return new URLSearchParams(params);
  }

  it("parses every §3.1 filter with pagination defaults", async () => {
    const provider = new FakeProvider();
    const { routes } = optionsFor(callerFor([TENANT]), true, provider);
    const baseUrl = await startServer(routes);

    const response = await fetch(
      `${baseUrl}/v1/tenants/${TENANT}/users?search=member&status=enabled&type=member&license=licensed&mfaState=registered&department=Engineering&inactiveDays=30&limit=1`,
    );

    expect(response.status).toBe(200);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.tenantId).toBe(TENANT);
    expect(provider.calls[0]?.filter).toMatchObject({
      search: "member",
      status: "enabled",
      type: "member",
      license: "licensed",
      mfaState: "registered",
      department: "Engineering",
      inactiveDays: 30,
      cursor: null,
      limit: 1,
    });
  });

  it("derives the inactive report from the same read with a 90-day default", () => {
    expect(parseTenantUsersFilter(query({ report: "inactive" }))).toMatchObject({
      report: "inactive",
      inactiveDays: 90,
    });
    expect(parseTenantUsersFilter(query({ report: "inactive", inactiveDays: "14" }))).toMatchObject({
      report: "inactive",
      inactiveDays: 14,
    });
  });

  it("derives the guest report from the same read by pinning the type", () => {
    expect(parseTenantUsersFilter(query({ report: "guest" }))).toMatchObject({
      report: "guest",
      type: "guest",
    });
  });

  it("derives the sign-in report from the same read", () => {
    expect(parseTenantUsersFilter(query({ report: "signin" }))).toMatchObject({ report: "signin" });
  });

  it("rejects a guest report combined with a non-guest type", () => {
    expect(() => parseTenantUsersFilter(query({ report: "guest", type: "member" }))).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });

  it("rejects unsupported filter values", () => {
    for (const params of [
      { status: "archived" },
      { type: "service" },
      { license: "trial" },
      { mfaState: "maybe" },
      { report: "audit" },
      { inactiveDays: "0" },
      { inactiveDays: "not-a-number" },
    ]) {
      expect(() => parseTenantUsersFilter(query(params)), JSON.stringify(params)).toThrowError(
        expect.objectContaining({ status: 400 }),
      );
    }
  });
});

describe("tenant users route", () => {
  function context(params: Record<string, string>, search = ""): RequestContext {
    return {
      correlationId: "correlation-1",
      method: "GET",
      path: `/v1/tenants/${TENANT}/users`,
      query: new URLSearchParams(search),
      headers: {},
      params,
    };
  }

  it("serves users scoped by the tenant in the path", async () => {
    const { provider, routes } = optionsFor(callerFor([TENANT]), true);
    const baseUrl = await startServer(routes);

    const response = await fetch(`${baseUrl}/v1/tenants/${TENANT}/users`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: unknown[]; nextCursor: unknown };
    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).toBeNull();
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.tenantId).toBe(TENANT);
  });

  it("requires the users.read permission and calls no provider on denial", async () => {
    const { provider, routes } = optionsFor(callerFor([TENANT]), false);
    const baseUrl = await startServer(routes);

    const response = await fetch(`${baseUrl}/v1/tenants/${TENANT}/users`);
    expect(response.status).toBe(403);
    expect(provider.calls).toHaveLength(0);
  });

  it("rejects a tenant outside the caller scope", async () => {
    const { provider, routes } = optionsFor(callerFor([OTHER_TENANT]), true);
    const handler = routes[0]?.handler;
    if (!handler) throw new Error("tenant users route handler is missing");

    await expect(handler(context({ tenantId: TENANT }))).rejects.toMatchObject({ status: 403 });
    expect(provider.calls).toHaveLength(0);
  });

  it("requires authentication", async () => {
    const { provider, routes } = optionsFor(undefined, true);
    const handler = routes[0]?.handler;
    if (!handler) throw new Error("tenant users route handler is missing");

    await expect(handler(context({ tenantId: TENANT }))).rejects.toMatchObject({ status: 401 });
    expect(provider.calls).toHaveLength(0);
  });

  it("rejects a blank tenant id with a 400", async () => {
    const { routes } = optionsFor(callerFor([TENANT]), true);
    const handler = routes[0]?.handler;
    if (!handler) throw new Error("tenant users route handler is missing");

    await expect(handler(context({ tenantId: "   " }))).rejects.toMatchObject({ status: 400 });
  });

  it("rejects an invalid filter with a 400", async () => {
    const { provider, routes } = optionsFor(callerFor([TENANT]), true);
    const handler = routes[0]?.handler;
    if (!handler) throw new Error("tenant users route handler is missing");

    await expect(handler(context({ tenantId: TENANT }, "status=archived"))).rejects.toMatchObject({
      status: 400,
    });
    expect(provider.calls).toHaveLength(0);
  });

  it("publishes the users.read permission through the route module", () => {
    const operation = USERS_OPENAPI.paths["/tenants/{tenantId}/users"].get;
    expect(operation.permission).toBe("Identity.User.Read");
    expect(operation.operationId).toBe("listTenantUsers");
    expect(USERS_PERMISSION).toBe("Identity.User.Read");
    expect(TENANT_USERS_PATH).toBe("/v1/tenants/:tenantId/users");
    const names = operation.parameters.map((parameter) => parameter.name);
    for (const name of [
      "search",
      "status",
      "type",
      "license",
      "mfaState",
      "department",
      "inactiveDays",
      "report",
      "cursor",
      "limit",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("holds no M365 SDK call in the route module", () => {
    const source = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "users.ts"),
      "utf8",
    );
    for (const marker of [
      "Invoke-MgGraphRequest",
      "Invoke-MgRestMethod",
      "Connect-MgGraph",
      "microsoft-graph-client",
    ]) {
      expect(source).not.toContain(marker);
    }
  });
});
