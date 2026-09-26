import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { tenantScope } from "../rbac/scope.js";
import {
  MFA_BULK_RESET_PATH,
  MFA_OPENAPI,
  MFA_PERMISSIONS,
  MFA_RESET_PATH,
  createMfaRoutes,
  postMfaBulkReset,
  postMfaReset,
  type MfaCaller,
  type MfaReportProvider,
  type MfaResetProvider,
  type MfaAuditEvent,
  type MfaRouteOptions,
} from "./mfa.js";

const TENANT = "tenant-a";

const EMPTY_REPORT: MfaReportProvider = {
  getMfaReport: async () => ({ rows: [], nextCursor: null, retrievedAt: "2026-09-26T00:00:00.000Z" }),
};

class FakeResetProvider implements MfaResetProvider {
  readonly calls: Array<{ tenantId: string; userId: string; dryRun: boolean }> = [];

  constructor(private readonly failUsers: readonly string[] = []) {}

  async resetMfa(tenantId: string, userId: string, options: { dryRun: boolean }) {
    this.calls.push({ tenantId, userId, dryRun: options.dryRun });
    if (this.failUsers.includes(userId)) {
      return { status: "failed" as const, methods: ["phone"], state: "registered" as const, error: "graph refused the delete" };
    }
    return { status: "applied" as const, methods: [], state: "notRegistered" as const };
  }
}

function callerFor(tenantIds: readonly string[] | "all"): MfaCaller {
  return {
    roles: [],
    tenantScope: tenantIds === "all" ? { all: true, tenantIds: [] } : tenantScope(tenantIds),
  };
}

function contextFor(body: unknown) {
  return {
    correlationId: "corr-1",
    method: "POST",
    path: MFA_RESET_PATH,
    query: new URLSearchParams(),
    headers: {},
    params: { tenantId: TENANT, userId: "user-1" },
    body,
  };
}

function optionsFor(provider: FakeResetProvider, audits: MfaAuditEvent[]): MfaRouteOptions {
  return {
    report: EMPTY_REPORT,
    resolveCaller: () => callerFor("all"),
    authorize: async () => undefined,
    reset: provider,
    recordAudit: async (event) => {
      audits.push(event);
    },
  };
}

describe("single MFA reset (T-0222)", () => {
  it("applies the reset and returns the post-reset method state", async () => {
    const provider = new FakeResetProvider();
    const audits: MfaAuditEvent[] = [];
    const response = await postMfaReset(
      optionsFor(provider, audits),
      contextFor({ confirm: true, reason: "lost phone" }),
      TENANT,
      callerFor("all"),
      "user-1",
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      userId: "user-1",
      status: "applied",
      methods: [],
      state: "notRegistered",
      error: null,
    });
    expect(provider.calls).toEqual([{ tenantId: TENANT, userId: "user-1", dryRun: false }]);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ tenantId: TENANT, action: "mfa.reset", targetId: "user-1", result: "success" });
  });

  it("plans only on dryRun without calling the provider or auditing", async () => {
    const provider = new FakeResetProvider();
    const audits: MfaAuditEvent[] = [];
    const response = await postMfaReset(
      optionsFor(provider, audits),
      contextFor({ dryRun: true, reason: "checking" }),
      TENANT,
      callerFor("all"),
      "user-1",
    );
    expect(response.body.status).toBe("planned");
    expect(provider.calls).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("refuses to reset without an explicit confirmation", async () => {
    const provider = new FakeResetProvider();
    await expect(
      postMfaReset(
        optionsFor(provider, []),
        contextFor({ reason: "lost phone" }),
        TENANT,
        callerFor("all"),
        "user-1",
      ),
    ).rejects.toMatchObject({ status: 400, code: "mfa.confirm_required" });
    expect(provider.calls).toHaveLength(0);
  });

  it("refuses to reset without a reason", async () => {
    await expect(
      postMfaReset(
        optionsFor(new FakeResetProvider(), []),
        contextFor({ confirm: true }),
        TENANT,
        callerFor("all"),
        "user-1",
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("reports a provider failure and audits it", async () => {
    const provider = new FakeResetProvider(["user-9"]);
    const audits: MfaAuditEvent[] = [];
    const response = await postMfaReset(
      optionsFor(provider, audits),
      contextFor({ confirm: true, reason: "lost phone" }),
      TENANT,
      callerFor("all"),
      "user-9",
    );
    expect(response.body.status).toBe("failed");
    expect(response.body.error).toBe("graph refused the delete");
    expect(audits[0]).toMatchObject({ targetId: "user-9", result: "failure" });
  });
});

describe("bulk MFA reset (T-0222)", () => {
  function bulkContext(body: unknown) {
    return {
      correlationId: "corr-1",
      method: "POST",
      path: MFA_BULK_RESET_PATH,
      query: new URLSearchParams(),
      headers: {},
      params: { tenantId: TENANT },
      body,
    };
  }

  it("resets every user and audits each one", async () => {
    const provider = new FakeResetProvider();
    const audits: MfaAuditEvent[] = [];
    const response = await postMfaBulkReset(
      optionsFor(provider, audits),
      bulkContext({ userIds: ["user-1", "user-2"], confirm: true, confirmCount: 2, reason: "team re-enrollment" }),
      TENANT,
      callerFor("all"),
    );
    expect(response.body.summary).toEqual({ total: 2, applied: 2, planned: 0, failed: 0 });
    expect(audits.map((event) => event.targetId).sort()).toEqual(["user-1", "user-2"]);
  });

  it("requires the batch count to match the user list", async () => {
    const provider = new FakeResetProvider();
    await expect(
      postMfaBulkReset(
        optionsFor(provider, []),
        bulkContext({ userIds: ["user-1", "user-2"], confirm: true, confirmCount: 1, reason: "x" }),
        TENANT,
        callerFor("all"),
      ),
    ).rejects.toMatchObject({ status: 400, code: "mfa.bulk_count_required" });
    expect(provider.calls).toHaveLength(0);
  });

  it("keeps per-user failures from aborting their siblings", async () => {
    const provider = new FakeResetProvider(["user-2"]);
    const audits: MfaAuditEvent[] = [];
    const response = await postMfaBulkReset(
      optionsFor(provider, audits),
      bulkContext({ userIds: ["user-1", "user-2"], confirm: true, confirmCount: 2, reason: "x" }),
      TENANT,
      callerFor("all"),
    );
    expect(response.body.summary).toEqual({ total: 2, applied: 1, planned: 0, failed: 1 });
    expect(audits).toHaveLength(2);
  });
});

describe("reset route wiring (T-0222)", () => {
  it("mounts single and bulk reset under mfa.write", async () => {
    const routes = createMfaRoutes({
      report: EMPTY_REPORT,
      resolveCaller: () => callerFor("all"),
      authorize: async (_caller, permission) => {
        if (permission !== MFA_PERMISSIONS.write) {
          throw new AppError("auth.forbidden", "not permitted", 403);
        }
      },
      reset: new FakeResetProvider(),
      recordAudit: async () => undefined,
    });
    expect(routes.map((route) => `${route.method} ${route.path}`)).toContain(`POST ${MFA_RESET_PATH}`);
    expect(routes.map((route) => `${route.method} ${route.path}`)).toContain(`POST ${MFA_BULK_RESET_PATH}`);
    const single = MFA_OPENAPI.paths["/tenants/{tenantId}/users/{userId}/mfa/reset"].post;
    expect(single.permission).toBe("mfa.write");
    const bulk = MFA_OPENAPI.paths["/tenants/{tenantId}/users/mfa/reset"].post;
    expect(bulk.permission).toBe("mfa.write");
  });
});
