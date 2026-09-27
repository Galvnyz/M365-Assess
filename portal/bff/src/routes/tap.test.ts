import { describe, expect, it } from "vitest";
import {
  MFA_OPENAPI,
  MFA_TAP_PATH,
  createMfaRoutes,
  postTap,
  type MfaAuditEvent,
  type MfaCaller,
  type MfaReportProvider,
  type MfaRouteOptions,
  type ProviderTapOutcome,
  type TapProvider,
  type TapRecordInput,
  type TapRecordStore,
} from "./mfa.js";
import { tenantScope } from "../rbac/scope.js";

const TENANT = "tenant-a";

const EMPTY_REPORT: MfaReportProvider = {
  getMfaReport: async () => ({ rows: [], nextCursor: null, retrievedAt: "2026-09-26T00:00:00.000Z" }),
};

class FakeTapProvider implements TapProvider {
  readonly calls: Array<{ tenantId: string; userId: string; lifetimeMinutes: number; oneTime: boolean; startTime: string | null; dryRun: boolean }> = [];

  constructor(private readonly outcome: ProviderTapOutcome = {
    status: "applied",
    id: "tap-1",
    expiresAt: "2026-09-26T01:00:00.000Z",
    pass: "tap-secret-value",
  }) {}

  async createTap(
    tenantId: string,
    userId: string,
    input: { lifetimeMinutes: number; oneTime: boolean; startTime: string | null; dryRun: boolean },
  ): Promise<ProviderTapOutcome> {
    this.calls.push({ tenantId, userId, ...input });
    return this.outcome;
  }
}

class FakeTapRecords implements TapRecordStore {
  readonly saved: TapRecordInput[] = [];

  async save(record: TapRecordInput) {
    this.saved.push(record);
    return { id: "tap-1", createdAt: "2026-09-26T00:00:00.000Z" };
  }
}

function callerFor(tenantIds: readonly string[] | "all"): MfaCaller {
  return {
    roles: [],
    tenantScope: tenantIds === "all" ? { all: true, tenantIds: [] } : tenantScope(tenantIds),
  };
}

function optionsFor(provider: FakeTapProvider, records: FakeTapRecords, audits: MfaAuditEvent[]): MfaRouteOptions {
  return {
    report: EMPTY_REPORT,
    resolveCaller: () => callerFor("all"),
    authorize: async () => undefined,
    tap: provider,
    tapRecords: records,
    recordAudit: async (event) => {
      audits.push(event);
    },
  };
}

function contextFor(body: unknown) {
  return {
    correlationId: "corr-1",
    method: "POST",
    path: MFA_TAP_PATH,
    query: new URLSearchParams(),
    headers: {},
    params: { tenantId: TENANT, userId: "user-1" },
    body,
  };
}

describe("Temporary Access Pass creation (T-0223)", () => {
  it("returns the value exactly once and persists a record without the value", async () => {
    const provider = new FakeTapProvider();
    const records = new FakeTapRecords();
    const audits: MfaAuditEvent[] = [];
    const response = await postTap(
      optionsFor(provider, records, audits),
      contextFor({ confirm: true, reason: "new hire onboarding", lifetimeMinutes: 120, oneTime: false }),
      TENANT,
      callerFor("all"),
      "user-1",
    );
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("applied");
    expect(response.body.temporaryAccessPass).toBe("tap-secret-value");
    expect(response.body.lifetimeMinutes).toBe(120);
    expect(response.body.oneTime).toBe(false);
    expect(provider.calls[0]).toMatchObject({ lifetimeMinutes: 120, oneTime: false, dryRun: false });
    // The persisted record carries metadata only — never the pass value.
    expect(records.saved).toHaveLength(1);
    expect(records.saved[0]).toEqual({
      tenantId: TENANT,
      userId: "user-1",
      createdBy: null,
      lifetimeMinutes: 120,
      oneTime: false,
      startTime: null,
    });
    expect(JSON.stringify(records.saved[0])).not.toContain("tap-secret-value");
    // The audit event carries no secret field either.
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "mfa.tap", targetId: "user-1", result: "success" });
    expect(JSON.stringify(audits[0])).not.toContain("tap-secret-value");
  });

  it("honors lifetime, one-time-use, and start time", async () => {
    const provider = new FakeTapProvider();
    const response = await postTap(
      optionsFor(provider, new FakeTapRecords(), []),
      contextFor({
        confirm: true,
        reason: "shift worker",
        lifetimeMinutes: 480,
        oneTime: true,
        startTime: "2026-09-27T08:00:00.000Z",
      }),
      TENANT,
      callerFor("all"),
      "user-1",
    );
    expect(response.body.startTime).toBe("2026-09-27T08:00:00.000Z");
    expect(provider.calls[0]).toMatchObject({
      lifetimeMinutes: 480,
      oneTime: true,
      startTime: "2026-09-27T08:00:00.000Z",
    });
  });

  it("defaults to a 60-minute one-time pass", async () => {
    const provider = new FakeTapProvider();
    await postTap(
      optionsFor(provider, new FakeTapRecords(), []),
      contextFor({ confirm: true, reason: "helpdesk" }),
      TENANT,
      callerFor("all"),
      "user-1",
    );
    expect(provider.calls[0]).toMatchObject({ lifetimeMinutes: 60, oneTime: true, startTime: null });
  });

  it("plans only on dryRun without calling the provider, storing, or auditing", async () => {
    const provider = new FakeTapProvider();
    const records = new FakeTapRecords();
    const audits: MfaAuditEvent[] = [];
    const response = await postTap(
      optionsFor(provider, records, audits),
      contextFor({ dryRun: true, reason: "checking" }),
      TENANT,
      callerFor("all"),
      "user-1",
    );
    expect(response.body.status).toBe("planned");
    expect(response.body.temporaryAccessPass).toBeNull();
    expect(provider.calls).toHaveLength(0);
    expect(records.saved).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("refuses creation without confirmation and without a reason", async () => {
    const provider = new FakeTapProvider();
    await expect(
      postTap(optionsFor(provider, new FakeTapRecords(), []), contextFor({ reason: "x" }), TENANT, callerFor("all"), "user-1"),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      postTap(optionsFor(provider, new FakeTapRecords(), []), contextFor({ confirm: true }), TENANT, callerFor("all"), "user-1"),
    ).rejects.toMatchObject({ status: 400 });
    expect(provider.calls).toHaveLength(0);
  });

  it("rejects an out-of-range lifetime and an invalid start time", async () => {
    const options = optionsFor(new FakeTapProvider(), new FakeTapRecords(), []);
    const caller = callerFor("all");
    await expect(
      postTap(options, contextFor({ confirm: true, reason: "x", lifetimeMinutes: 5 }), TENANT, caller, "user-1"),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      postTap(options, contextFor({ confirm: true, reason: "x", startTime: "next friday" }), TENANT, caller, "user-1"),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("reports a provider failure with no pass value and audits it", async () => {
    const provider = new FakeTapProvider({ status: "failed", id: "tap-9", expiresAt: null, pass: null, error: "graph refused" });
    const audits: MfaAuditEvent[] = [];
    const response = await postTap(
      optionsFor(provider, new FakeTapRecords(), audits),
      contextFor({ confirm: true, reason: "x" }),
      TENANT,
      callerFor("all"),
      "user-1",
    );
    expect(response.body.status).toBe("failed");
    expect(response.body.temporaryAccessPass).toBeNull();
    expect(audits[0]).toMatchObject({ result: "failure" });
  });

  it("mounts the TAP route under mfa.write", () => {
    const routes = createMfaRoutes({
      report: EMPTY_REPORT,
      resolveCaller: () => callerFor("all"),
    });
    expect(routes.map((route) => `${route.method} ${route.path}`)).toContain(`POST ${MFA_TAP_PATH}`);
    expect(MFA_OPENAPI.paths["/tenants/{tenantId}/users/{userId}/tap"].post.permission).toBe("Identity.Mfa.ReadWrite");
  });
});
