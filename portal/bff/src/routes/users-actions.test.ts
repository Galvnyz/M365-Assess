import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { tenantScope } from "../rbac/scope.js";
import type { RequestContext } from "../server.js";
import {
  USER_ACTION_CONFIRM_REQUIRED,
  USER_ACTION_PATH,
  USER_ACTION_UNKNOWN,
  USERS_WRITE_PERMISSION,
  USERS_OPENAPI,
  createTenantUsersRoute,
  type TenantUsersProvider,
  type TenantUsersRouteOptions,
  type UserActionAuditEvent,
  type UserActionProvider,
  type UserCreateAuditEvent,
  type UserLifecycleAction,
  type UsersCaller,
} from "./users.js";

const TENANT = "tenant-a";
const OTHER_TENANT = "tenant-b";
const USER_ID = "user-1";

class FakeActionProvider implements UserActionProvider {
  readonly calls: Array<{ tenantId: string; userId: string; action: UserLifecycleAction; password?: string }> = [];
  failNext = "";

  async executeAction(
    tenantId: string,
    userId: string,
    action: UserLifecycleAction,
    options: { dryRun: boolean; password?: string },
  ) {
    this.calls.push({ tenantId, userId, action, password: options.password });
    if (this.failNext.length > 0) {
      const error = this.failNext;
      this.failNext = "";
      return { status: "failed" as const, before: { id: userId }, after: null, error };
    }
    return {
      status: "applied" as const,
      before: { id: userId, accountEnabled: true },
      after: { id: userId, accountEnabled: action === "disable" ? false : true },
      password: action === "resetPassword" ? "one-time-secret" : null,
    };
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
  provider: FakeActionProvider;
  audits: Array<UserCreateAuditEvent | UserActionAuditEvent>;
  routes: ReturnType<typeof createTenantUsersRoute>;
} {
  const provider = new FakeActionProvider();
  const audits: Array<UserCreateAuditEvent | UserActionAuditEvent> = [];
  const routes = createTenantUsersRoute({
    provider: NULL_LIST,
    resolveCaller: () => caller,
    authorize: async (_caller, permission) => {
      if (!allowed || permission !== USERS_WRITE_PERMISSION) {
        throw new AppError("auth.forbidden", "not permitted to perform this action", 403);
      }
    },
    execute: provider,
    readBody: (ctx) => (ctx as { body?: unknown }).body,
    recordAudit: async (event) => {
      audits.push(event);
    },
    ...overrides,
  });
  return { provider, audits, routes };
}

function actionHandler(routes: ReturnType<typeof createTenantUsersRoute>) {
  const handler = routes.find((route) => route.method === "POST" && route.path === USER_ACTION_PATH)?.handler;
  if (!handler) throw new Error("user action POST handler is missing");
  return handler;
}

function context(tenantId: string, userId: string, action: string, body: unknown): RequestContext {
  return {
    correlationId: "correlation-1",
    method: "POST",
    path: `/v1/tenants/${tenantId}/users/${userId}/actions/${action}`,
    query: new URLSearchParams(),
    headers: {},
    params: { tenantId, userId, action },
    body,
  } as RequestContext;
}

describe("tenant user lifecycle actions (T-0204)", () => {
  it("registers the action route with the users.write permission", () => {
    const { routes } = optionsFor(callerFor([TENANT]), true);
    const post = routes.find((route) => route.method === "POST" && route.path === USER_ACTION_PATH);

    expect(post?.path).toBe("/v1/tenants/:tenantId/users/:userId/actions/:action");
    expect(USERS_OPENAPI.paths["/tenants/{tenantId}/users/{userId}/actions/{action}"].post.operationId).toBe(
      "executeUserAction",
    );
    expect(USERS_OPENAPI.paths["/tenants/{tenantId}/users/{userId}/actions/{action}"].post.permission).toBe(
      "users.write",
    );
  });

  it.each([
    "resetPassword",
    "requirePasswordChange",
    "revokeSessions",
    "disable",
    "enable",
    "restore",
  ] as const)("dispatches the %s action with before/after and an audit record", async (action) => {
    const needsConfirm = action === "revokeSessions" || action === "disable" || action === "restore";
    const { provider, audits, routes } = optionsFor(callerFor([TENANT]), true);

    const response = await actionHandler(routes)(
      context(TENANT, USER_ID, action, needsConfirm ? { confirm: true } : {}),
    );

    expect(response.status).toBe(200);
    const body = response.body as { status: string; before: object | null; after: object | null };
    expect(body.status).toBe("applied");
    expect(body.before).toMatchObject({ id: USER_ID });
    expect(body.after).toMatchObject({ id: USER_ID });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toMatchObject({ tenantId: TENANT, userId: USER_ID, action });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "users.action",
      targetId: USER_ID,
      result: "success",
      tenantId: TENANT,
    });
  });

  it("returns a one-time password for resetPassword without persisting detail", async () => {
    const { routes } = optionsFor(callerFor([TENANT]), true);

    const response = await actionHandler(routes)(context(TENANT, USER_ID, "resetPassword", {}));

    const body = response.body as { status: string; password: string | null };
    expect(body.status).toBe("applied");
    expect(body.password).toBe("one-time-secret");
  });

  it("forwards a caller-supplied password to the provider", async () => {
    const { provider, routes } = optionsFor(callerFor([TENANT]), true);

    await actionHandler(routes)(context(TENANT, USER_ID, "resetPassword", { password: "Caller-Secret-1!" }));

    expect(provider.calls[0]?.password).toBe("Caller-Secret-1!");
  });

  it("requires confirmation for session-breaking and destructive actions", async () => {
    for (const action of ["revokeSessions", "disable", "restore"] as const) {
      const { provider, audits, routes } = optionsFor(callerFor([TENANT]), true);

      await expect(actionHandler(routes)(context(TENANT, USER_ID, action, {}))).rejects.toMatchObject({
        status: 400,
        code: USER_ACTION_CONFIRM_REQUIRED,
      });
      expect(provider.calls).toHaveLength(0);
      expect(audits).toHaveLength(0);
    }
  });

  it("plans without a provider call or audit when dryRun is set", async () => {
    const { provider, audits, routes } = optionsFor(callerFor([TENANT]), true);

    const response = await actionHandler(routes)(
      context(TENANT, USER_ID, "disable", { dryRun: true }),
    );

    expect(response.status).toBe(200);
    const body = response.body as { status: string; password: string | null };
    expect(body.status).toBe("planned");
    expect(body.password).toBeNull();
    expect(provider.calls).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("reports a provider failure with a failure audit record", async () => {
    const failing = new FakeActionProvider();
    failing.failNext = "graph rejected revoke";
    const { audits, routes } = optionsFor(callerFor([TENANT]), true, { execute: failing });

    const response = await actionHandler(routes)(
      context(TENANT, USER_ID, "revokeSessions", { confirm: true }),
    );

    const body = response.body as { status: string; error: string | null };
    expect(body.status).toBe("failed");
    expect(body.error).toContain("graph rejected revoke");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ result: "failure" });
  });

  it("rejects an unknown action with a structured 400 and never calls the provider", async () => {
    const { provider, audits, routes } = optionsFor(callerFor([TENANT]), true);

    await expect(
      actionHandler(routes)(context(TENANT, USER_ID, "wipeEverything", { confirm: true })),
    ).rejects.toMatchObject({ status: 400, code: USER_ACTION_UNKNOWN });
    expect(provider.calls).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("returns 501 when actions are not wired", async () => {
    const routes = createTenantUsersRoute({
      provider: NULL_LIST,
      resolveCaller: () => callerFor([TENANT]),
      authorize: async () => {},
      readBody: (ctx) => (ctx as { body?: unknown }).body,
    });

    await expect(
      actionHandler(routes)(context(TENANT, USER_ID, "enable", {})),
    ).rejects.toMatchObject({ status: 501 });
  });

  it("requires the users.write permission and calls no provider on denial", async () => {
    const { provider, routes } = optionsFor(callerFor([TENANT]), false);

    await expect(actionHandler(routes)(context(TENANT, USER_ID, "enable", {}))).rejects.toMatchObject({
      status: 403,
    });
    expect(provider.calls).toHaveLength(0);
  });

  it("rejects a tenant outside the caller scope", async () => {
    const { provider, routes } = optionsFor(callerFor([OTHER_TENANT]), true);

    await expect(actionHandler(routes)(context(TENANT, USER_ID, "enable", {}))).rejects.toMatchObject({
      status: 403,
    });
    expect(provider.calls).toHaveLength(0);
  });

  it("requires authentication", async () => {
    const { provider, routes } = optionsFor(undefined, true);

    await expect(actionHandler(routes)(context(TENANT, USER_ID, "enable", {}))).rejects.toMatchObject({
      status: 401,
    });
    expect(provider.calls).toHaveLength(0);
  });
});
