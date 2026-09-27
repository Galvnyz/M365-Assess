import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { tenantScope } from "../rbac/scope.js";
import type { RequestContext } from "../server.js";
import {
  TENANT_USERS_PATH,
  USERS_OPENAPI,
  USERS_WRITE_PERMISSION,
  createTenantUsersRoute,
  type ProviderCreateRowResult,
  type ParsedUserCreate,
  type TenantUsersProvider,
  type UserCreateAuditEvent,
  type UserCreateProvider,
  type UsersCaller,
  type TenantUsersRouteOptions,
} from "./users.js";

const TENANT = "tenant-a";
const OTHER_TENANT = "tenant-b";

class FakeCreateProvider implements UserCreateProvider {
  readonly calls: Array<{ tenantId: string; users: readonly ParsedUserCreate[] }> = [];
  private readonly failures = new Set<string>();

  failUpn(upn: string): void {
    this.failures.add(upn.toLowerCase());
  }

  async createUsers(
    tenantId: string,
    users: readonly ParsedUserCreate[],
  ): Promise<readonly ProviderCreateRowResult[]> {
    this.calls.push({ tenantId, users: [...users] });
    return users.map((user) =>
      this.failures.has(user.userPrincipalName.toLowerCase())
        ? { userPrincipalName: user.userPrincipalName, status: "failed", error: "graph rejected the create" }
        : { userPrincipalName: user.userPrincipalName, status: "created", id: `id-${user.userPrincipalName}` },
    );
  }
}

const NULL_LIST: TenantUsersProvider = {
  listUsers: async () => ({ items: [], nextCursor: null }),
};

function callerFor(tenantIds: readonly string[] | "all"): UsersCaller {
  return {
    roles: [],
    tenantScope: tenantIds === "all" ? { all: true, tenantIds: [] } : tenantScope(tenantIds),
  };
}

function optionsFor(
  caller: UsersCaller | undefined,
  allowed: boolean,
  overrides: Partial<TenantUsersRouteOptions> = {},
): { provider: FakeCreateProvider; audits: UserCreateAuditEvent[]; routes: ReturnType<typeof createTenantUsersRoute> } {
  const provider = new FakeCreateProvider();
  const audits: UserCreateAuditEvent[] = [];
  const routes = createTenantUsersRoute({
    provider: NULL_LIST,
    resolveCaller: () => caller,
    authorize: async (_caller, permission) => {
      if (!allowed || permission !== USERS_WRITE_PERMISSION) {
        throw new AppError("auth.forbidden", "not permitted to perform this action", 403);
      }
    },
    create: provider,
    readBody: (ctx) => (ctx as { body?: unknown }).body,
    recordAudit: async (event) => {
      audits.push(event);
    },
    ...overrides,
  });
  return { provider, audits, routes };
}

function postHandler(routes: ReturnType<typeof createTenantUsersRoute>) {
  const handler = routes.find((route) => route.method === "POST")?.handler;
  if (!handler) throw new Error("tenant users POST handler is missing");
  return handler;
}

function context(tenantId: string, body: unknown): RequestContext {
  return {
    correlationId: "correlation-1",
    method: "POST",
    path: `/v1/tenants/${tenantId}/users`,
    query: new URLSearchParams(),
    headers: {},
    params: { tenantId },
    body,
  } as RequestContext;
}

const SINGLE = {
  userPrincipalName: "new.user@example.invalid",
  displayName: "New User",
  usageLocation: "US",
};

describe("tenant users create (T-0202)", () => {
  it("registers the POST route on the users path with the users.write permission", () => {
    const { routes } = optionsFor(callerFor([TENANT]), true);
    const post = routes.find((route) => route.method === "POST");

    expect(post?.path).toBe(TENANT_USERS_PATH);
    expect(USERS_OPENAPI.paths["/tenants/{tenantId}/users"].post.operationId).toBe("createTenantUsers");
    expect(USERS_OPENAPI.paths["/tenants/{tenantId}/users"].post.permission).toBe("Identity.User.ReadWrite");
    expect(USERS_WRITE_PERMISSION).toBe("Identity.User.ReadWrite");
  });

  it("creates a single user and audits the write", async () => {
    const { provider, audits, routes } = optionsFor(callerFor([TENANT]), true);

    const response = await postHandler(routes)(context(TENANT, SINGLE));

    expect(response.status).toBe(200);
    const body = response.body as { rows: Array<{ status: string; id: string | null }>; summary: object };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ status: "created", id: "id-new.user@example.invalid" });
    expect(body.summary).toMatchObject({ total: 1, created: 1, failed: 0 });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.tenantId).toBe(TENANT);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      tenantId: TENANT,
      action: "users.create",
      result: "success",
      userPrincipalName: "new.user@example.invalid",
    });
  });

  it("plans without a provider call or audit when dryRun is set", async () => {
    const { provider, audits, routes } = optionsFor(callerFor([TENANT]), true);

    const response = await postHandler(routes)(context(TENANT, { ...SINGLE, dryRun: true }));

    expect(response.status).toBe(200);
    const body = response.body as { rows: Array<{ status: string }> };
    expect(body.rows[0]?.status).toBe("planned");
    expect(provider.calls).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("reports a validation failure per row and never forwards it to the provider", async () => {
    const { provider, routes } = optionsFor(callerFor([TENANT]), true);

    const response = await postHandler(routes)(
      context(TENANT, {
        users: [SINGLE, { displayName: "Missing UPN", usageLocation: "US" }],
      }),
    );

    expect(response.status).toBe(200);
    const body = response.body as { rows: Array<{ status: string; error: string | null }>; summary: object };
    expect(body.rows).toHaveLength(2);
    expect(body.rows[0]?.status).toBe("created");
    expect(body.rows[1]?.status).toBe("failed");
    expect(body.rows[1]?.error).toContain("userPrincipalName is required");
    expect(body.summary).toMatchObject({ total: 2, created: 1, failed: 1 });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.users).toHaveLength(1);
  });

  it("does not abort sibling rows when one apply fails", async () => {
    const failingUpn = "bad.user@example.invalid";
    const failing = new FakeCreateProvider();
    failing.failUpn(failingUpn);
    const { routes } = optionsFor(callerFor([TENANT]), true, { create: failing });

    const response = await postHandler(routes)(
      context(TENANT, {
        users: [
          SINGLE,
          { userPrincipalName: failingUpn, displayName: "Bad User", usageLocation: "US" },
        ],
      }),
    );

    const body = response.body as { rows: Array<{ status: string; error: string | null }>; summary: object };
    expect(body.rows[0]?.status).toBe("created");
    expect(body.rows[1]?.status).toBe("failed");
    expect(body.rows[1]?.error).toContain("graph rejected");
    expect(body.summary).toMatchObject({ total: 2, created: 1, failed: 1 });
  });

  it("audits an apply failure", async () => {
    const failing = new FakeCreateProvider();
    failing.failUpn(SINGLE.userPrincipalName);
    const { audits, routes } = optionsFor(callerFor([TENANT]), true, { create: failing });

    await postHandler(routes)(context(TENANT, SINGLE));

    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ result: "failure", error: "graph rejected the create" });
  });

  it("creates from a CSV body with per-row results", async () => {
    const { provider, routes } = optionsFor(callerFor([TENANT]), true);
    const csv = [
      "userPrincipalName,displayName,usageLocation,licenses,groups",
      "csv.one@example.invalid,CSV One,US,sku-1,g-1",
      "not-a-upn,CSV Bad,US,,",
    ].join("\n");

    const response = await postHandler(routes)(context(TENANT, { csv }));

    expect(response.status).toBe(200);
    const body = response.body as { rows: Array<{ row: number; status: string; userPrincipalName: string }> };
    expect(body.rows).toHaveLength(2);
    expect(body.rows[0]).toMatchObject({ row: 2, status: "created", userPrincipalName: "csv.one@example.invalid" });
    expect(body.rows[1]).toMatchObject({ row: 3, status: "failed", userPrincipalName: "not-a-upn" });
    expect(provider.calls[0]?.users).toHaveLength(1);
  });

  it("rejects an unknown license as a validation failure, not a partial apply", async () => {
    const { provider, routes } = optionsFor(callerFor([TENANT]), true, {
      knownLicenses: ["sku-1"],
    });

    const response = await postHandler(routes)(
      context(TENANT, { ...SINGLE, licenses: "sku-9" }),
    );

    const body = response.body as { rows: Array<{ status: string; error: string | null }> };
    expect(body.rows[0]?.status).toBe("failed");
    expect(body.rows[0]?.error).toContain("sku-9");
    expect(provider.calls).toHaveLength(0);
  });

  it("rejects a missing usage location without a tenant default", async () => {
    const { provider, routes } = optionsFor(callerFor([TENANT]), true);

    const response = await postHandler(routes)(
      context(TENANT, { userPrincipalName: "n@example.invalid", displayName: "N" }),
    );

    const body = response.body as { rows: Array<{ status: string }> };
    expect(body.rows[0]?.status).toBe("failed");
    expect(provider.calls).toHaveLength(0);
  });

  it("flags a UPN duplicated within the request on the later row", async () => {
    const { provider, routes } = optionsFor(callerFor([TENANT]), true);

    const response = await postHandler(routes)(
      context(TENANT, {
        users: [
          SINGLE,
          { ...SINGLE, displayName: "Duplicate" },
        ],
      }),
    );

    const body = response.body as { rows: Array<{ status: string; error: string | null }> };
    expect(body.rows[0]?.status).toBe("created");
    expect(body.rows[1]?.status).toBe("failed");
    expect(body.rows[1]?.error).toContain("duplicates row 1");
    expect(provider.calls[0]?.users).toHaveLength(1);
  });

  it("flags a UPN that already exists in the tenant", async () => {
    const { provider, routes } = optionsFor(callerFor([TENANT]), true, {
      resolveExistingUpns: async () => ["new.user@example.invalid"],
    });

    const response = await postHandler(routes)(context(TENANT, SINGLE));

    const body = response.body as { rows: Array<{ status: string }> };
    expect(body.rows[0]?.status).toBe("failed");
    expect(provider.calls).toHaveLength(0);
  });

  it("returns 501 when create is not wired and rows would apply", async () => {
    const routes = createTenantUsersRoute({
      provider: NULL_LIST,
      resolveCaller: () => callerFor([TENANT]),
      authorize: async () => {},
      readBody: (ctx) => (ctx as { body?: unknown }).body,
    });

    await expect(postHandler(routes)(context(TENANT, SINGLE))).rejects.toMatchObject({ status: 501 });
  });

  it("rejects a body carrying both users and csv", async () => {
    const { provider, routes } = optionsFor(callerFor([TENANT]), true);

    await expect(
      postHandler(routes)(context(TENANT, { users: [SINGLE], csv: "a,b" })),
    ).rejects.toMatchObject({ status: 400 });
    expect(provider.calls).toHaveLength(0);
  });

  it("rejects a malformed CSV file with a 400", async () => {
    const { provider, routes } = optionsFor(callerFor([TENANT]), true);

    await expect(
      postHandler(routes)(context(TENANT, { csv: "displayName\nNo UPN column" })),
    ).rejects.toMatchObject({ status: 400 });
    expect(provider.calls).toHaveLength(0);
  });

  it("requires the users.write permission and calls no provider on denial", async () => {
    const { provider, routes } = optionsFor(callerFor([TENANT]), false);

    await expect(postHandler(routes)(context(TENANT, SINGLE))).rejects.toMatchObject({ status: 403 });
    expect(provider.calls).toHaveLength(0);
  });

  it("rejects a tenant outside the caller scope", async () => {
    const { provider, routes } = optionsFor(callerFor([OTHER_TENANT]), true);

    await expect(postHandler(routes)(context(TENANT, SINGLE))).rejects.toMatchObject({ status: 403 });
    expect(provider.calls).toHaveLength(0);
  });

  it("requires authentication", async () => {
    const { provider, routes } = optionsFor(undefined, true);

    await expect(postHandler(routes)(context(TENANT, SINGLE))).rejects.toMatchObject({ status: 401 });
    expect(provider.calls).toHaveLength(0);
  });
});
