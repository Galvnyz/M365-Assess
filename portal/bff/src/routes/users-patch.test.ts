import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { tenantScope } from "../rbac/scope.js";
import type { RequestContext } from "../server.js";
import {
  USERS_BULK_PATCH_PATH,
  USERS_OPENAPI,
  USERS_WRITE_PERMISSION,
  createTenantUsersRoute,
  type ProviderPatchOutcome,
  type TenantUsersProvider,
  type TenantUsersRouteOptions,
  type UserActionAuditEvent,
  type UserCreateAuditEvent,
  type UserPatchAuditEvent,
  type UserPatchProvider,
  type UsersCaller,
} from "./users.js";

const TENANT = "tenant-a";
const OTHER_TENANT = "tenant-b";

const CURRENT: Record<string, Record<string, string | null>> = {
  "user-1": { displayName: "Old Name", department: "Engineering", usageLocation: "US" },
  "user-2": { displayName: "Second", department: null, usageLocation: "GB" },
};

class FakePatchProvider implements UserPatchProvider {
  readonly calls: Array<{ tenantId: string; preview: boolean; count: number }> = [];
  failUsers = new Set<string>();

  async patchUsers(
    tenantId: string,
    patches: ReadonlyArray<{ userId: string; properties: Record<string, string | null> }>,
    options: { preview: boolean },
  ): Promise<readonly ProviderPatchOutcome[]> {
    this.calls.push({ tenantId, preview: options.preview, count: patches.length });
    return patches.map((patch) => {
      if (this.failUsers.has(patch.userId)) {
        return { userId: patch.userId, status: "failed" as const, error: "graph rejected the patch" };
      }
      const before = { ...(CURRENT[patch.userId] ?? {}) };
      const after = { ...before, ...patch.properties };
      return { userId: patch.userId, status: "patched" as const, before, after };
    });
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
): {
  provider: FakePatchProvider;
  audits: Array<UserCreateAuditEvent | UserActionAuditEvent | UserPatchAuditEvent>;
  routes: ReturnType<typeof createTenantUsersRoute>;
} {
  const provider = new FakePatchProvider();
  const audits: Array<UserCreateAuditEvent | UserActionAuditEvent | UserPatchAuditEvent> = [];
  const routes = createTenantUsersRoute({
    provider: NULL_LIST,
    resolveCaller: () => caller,
    authorize: async (_caller, permission) => {
      if (!allowed || permission !== USERS_WRITE_PERMISSION) {
        throw new AppError("auth.forbidden", "not permitted to perform this action", 403);
      }
    },
    patch: provider,
    readBody: (ctx) => (ctx as { body?: unknown }).body,
    recordAudit: async (event) => {
      audits.push(event);
    },
    ...overrides,
  });
  return { provider, audits, routes };
}

function patchHandler(routes: ReturnType<typeof createTenantUsersRoute>) {
  const handler = routes.find(
    (route) => route.method === "POST" && route.path === USERS_BULK_PATCH_PATH,
  )?.handler;
  if (!handler) throw new Error("bulk patch POST handler is missing");
  return handler;
}

function context(tenantId: string, body: unknown): RequestContext {
  return {
    correlationId: "correlation-1",
    method: "POST",
    path: `/v1/tenants/${tenantId}/users/bulk-patch`,
    query: new URLSearchParams(),
    headers: {},
    params: { tenantId },
    body,
  } as RequestContext;
}

describe("tenant users bulk patch (T-0203)", () => {
  it("registers the bulk-patch route with the users.write permission", () => {
    const { routes } = optionsFor(callerFor([TENANT]), true);
    const post = routes.find((route) => route.method === "POST" && route.path === USERS_BULK_PATCH_PATH);

    expect(post?.path).toBe("/v1/tenants/:tenantId/users/bulk-patch");
    expect(USERS_OPENAPI.paths["/tenants/{tenantId}/users/bulk-patch"].post.operationId).toBe(
      "bulkPatchTenantUsers",
    );
    expect(USERS_OPENAPI.paths["/tenants/{tenantId}/users/bulk-patch"].post.permission).toBe("users.write");
  });

  it("previews the per-user diff with no tenant write and no audit", async () => {
    const { provider, audits, routes } = optionsFor(callerFor([TENANT]), true);

    const response = await patchHandler(routes)(
      context(TENANT, {
        preview: true,
        users: [{ userId: "user-1", properties: { displayName: "New Name", department: "Engineering" } }],
      }),
    );

    expect(response.status).toBe(200);
    const body = response.body as {
      rows: Array<{ status: string; diffs: Array<{ property: string; before: string | null; after: string | null }> }>;
      summary: object;
    };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]?.status).toBe("previewed");
    // Only the changed property appears; the unchanged department is omitted.
    expect(body.rows[0]?.diffs).toEqual([{ property: "displayName", before: "Old Name", after: "New Name" }]);
    expect(body.summary).toMatchObject({ total: 1, previewed: 1, patched: 0, failed: 0 });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.preview).toBe(true);
    expect(audits).toHaveLength(0);
  });

  it("applies patches with before/after and an audit record per row", async () => {
    const { provider, audits, routes } = optionsFor(callerFor([TENANT]), true);

    const response = await patchHandler(routes)(
      context(TENANT, {
        users: [
          { userId: "user-1", properties: { department: "Finance" } },
          { userId: "user-2", properties: { department: "Finance" } },
        ],
      }),
    );

    const body = response.body as {
      rows: Array<{ status: string; diffs: unknown[] }>;
      summary: object;
    };
    expect(body.rows.map((row) => row.status)).toEqual(["patched", "patched"]);
    expect(body.summary).toMatchObject({ total: 2, patched: 2, failed: 0 });
    expect(provider.calls[0]?.preview).toBe(false);
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({ action: "users.patch", targetId: "user-1", result: "success" });
  });

  it("rejects an unknown property per row and never forwards it", async () => {
    const { provider, routes } = optionsFor(callerFor([TENANT]), true);

    const response = await patchHandler(routes)(
      context(TENANT, {
        users: [
          { userId: "user-1", properties: { displayName: "Fine" } },
          { userId: "user-2", properties: { employeeId: "123" } },
        ],
      }),
    );

    const body = response.body as { rows: Array<{ status: string; error: string | null }> };
    expect(body.rows[0]?.status).toBe("patched");
    expect(body.rows[1]?.status).toBe("failed");
    expect(body.rows[1]?.error).toContain("employeeId");
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.count).toBe(1);
  });

  it("reports a row that turns invalid at apply time as a per-row failure", async () => {
    const failing = new FakePatchProvider();
    failing.failUsers.add("user-2");
    const { audits, routes } = optionsFor(callerFor([TENANT]), true, { patch: failing });

    const response = await patchHandler(routes)(
      context(TENANT, {
        users: [
          { userId: "user-1", properties: { department: "Finance" } },
          { userId: "user-2", properties: { department: "Finance" } },
        ],
      }),
    );

    const body = response.body as {
      rows: Array<{ status: string; error: string | null }>;
      summary: object;
    };
    expect(body.rows[0]?.status).toBe("patched");
    expect(body.rows[1]?.status).toBe("failed");
    expect(body.rows[1]?.error).toContain("graph rejected");
    expect(body.summary).toMatchObject({ total: 2, patched: 1, failed: 1 });
    expect(audits).toHaveLength(2);
    expect(audits[1]).toMatchObject({ result: "failure" });
  });

  it("rejects a malformed usage location per row", async () => {
    const { provider, routes } = optionsFor(callerFor([TENANT]), true);

    const response = await patchHandler(routes)(
      context(TENANT, { users: [{ userId: "user-1", properties: { usageLocation: "USA" } }] }),
    );

    const body = response.body as { rows: Array<{ status: string }> };
    expect(body.rows[0]?.status).toBe("failed");
    expect(provider.calls).toHaveLength(0);
  });

  it("returns 501 when patch is not wired and rows would apply", async () => {
    const routes = createTenantUsersRoute({
      provider: NULL_LIST,
      resolveCaller: () => callerFor([TENANT]),
      authorize: async () => {},
      readBody: (ctx) => (ctx as { body?: unknown }).body,
    });

    await expect(
      patchHandler(routes)(context(TENANT, { users: [{ userId: "user-1", properties: { department: "X" } }] })),
    ).rejects.toMatchObject({ status: 501 });
  });

  it("requires the users.write permission and calls no provider on denial", async () => {
    const { provider, routes } = optionsFor(callerFor([TENANT]), false);

    await expect(
      patchHandler(routes)(context(TENANT, { users: [{ userId: "user-1", properties: { department: "X" } }] })),
    ).rejects.toMatchObject({ status: 403 });
    expect(provider.calls).toHaveLength(0);
  });

  it("rejects a tenant outside the caller scope", async () => {
    const { provider, routes } = optionsFor(callerFor([OTHER_TENANT]), true);

    await expect(
      patchHandler(routes)(context(TENANT, { users: [{ userId: "user-1", properties: { department: "X" } }] })),
    ).rejects.toMatchObject({ status: 403 });
    expect(provider.calls).toHaveLength(0);
  });

  it("requires authentication", async () => {
    const { provider, routes } = optionsFor(undefined, true);

    await expect(
      patchHandler(routes)(context(TENANT, { users: [{ userId: "user-1", properties: { department: "X" } }] })),
    ).rejects.toMatchObject({ status: 401 });
    expect(provider.calls).toHaveLength(0);
  });
});
