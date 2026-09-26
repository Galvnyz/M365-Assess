import { describe, expect, it } from "vitest";
import { tenantScope } from "../rbac/scope.js";
import {
  MFA_DEFAULT_METHOD_PATH,
  MFA_OPENAPI,
  MFA_PUSH_PATH,
  createMfaRoutes,
  postMfaDefaultMethod,
  postMfaPush,
  type MfaActionProvider,
  type MfaAuditEvent,
  type MfaCaller,
  type MfaReportProvider,
  type MfaRouteOptions,
  type ProviderMfaActionOutcome,
} from "./mfa.js";

const TENANT = "tenant-a";

const EMPTY_REPORT: MfaReportProvider = {
  getMfaReport: async () => ({ rows: [], nextCursor: null, retrievedAt: "2026-09-26T00:00:00.000Z" }),
};

class FakeActionProvider implements MfaActionProvider {
  readonly pushCalls: Array<{ tenantId: string; userId: string; dryRun: boolean }> = [];
  readonly defaultCalls: Array<{ tenantId: string; userId: string; method: string; dryRun: boolean }> = [];

  constructor(
    private readonly pushOutcome: ProviderMfaActionOutcome = { status: "applied", pushTarget: "authenticator-device-1" },
    private readonly defaultOutcome: ProviderMfaActionOutcome = {
      status: "applied",
      methods: ["microsoftAuthenticator", "phone"],
      defaultMethod: "phone",
    },
  ) {}

  async sendPush(tenantId: string, userId: string, options: { dryRun: boolean }) {
    this.pushCalls.push({ tenantId, userId, dryRun: options.dryRun });
    return this.pushOutcome;
  }

  async setDefaultMethod(tenantId: string, userId: string, method: string, options: { dryRun: boolean }) {
    this.defaultCalls.push({ tenantId, userId, method, dryRun: options.dryRun });
    return this.defaultOutcome;
  }
}

function callerFor(tenantIds: readonly string[] | "all"): MfaCaller {
  return {
    roles: [],
    tenantScope: tenantIds === "all" ? { all: true, tenantIds: [] } : tenantScope(tenantIds),
  };
}

function optionsFor(provider: FakeActionProvider, audits: MfaAuditEvent[]): MfaRouteOptions {
  return {
    report: EMPTY_REPORT,
    resolveCaller: () => callerFor("all"),
    authorize: async () => undefined,
    actions: provider,
    recordAudit: async (event) => {
      audits.push(event);
    },
  };
}

function contextFor(path: string, body: unknown, userId = "user-1") {
  return {
    correlationId: "corr-1",
    method: "POST",
    path,
    query: new URLSearchParams(),
    headers: {},
    params: { tenantId: TENANT, userId },
    body,
  };
}

describe("MFA push (T-0224)", () => {
  it("sends the push to a registered device and audits it", async () => {
    const provider = new FakeActionProvider();
    const audits: MfaAuditEvent[] = [];
    const response = await postMfaPush(
      optionsFor(provider, audits),
      contextFor(MFA_PUSH_PATH, { confirm: true, reason: "login assistance" }),
      TENANT,
      callerFor("all"),
      "user-1",
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      userId: "user-1",
      status: "applied",
      pushTarget: "authenticator-device-1",
      error: null,
    });
    expect(provider.pushCalls).toEqual([{ tenantId: TENANT, userId: "user-1", dryRun: false }]);
    expect(audits[0]).toMatchObject({ action: "mfa.push", targetId: "user-1", result: "success" });
  });

  it("plans only on dryRun", async () => {
    const provider = new FakeActionProvider();
    const audits: MfaAuditEvent[] = [];
    const response = await postMfaPush(
      optionsFor(provider, audits),
      contextFor(MFA_PUSH_PATH, { dryRun: true, reason: "checking" }),
      TENANT,
      callerFor("all"),
      "user-1",
    );
    expect(response.body.status).toBe("planned");
    expect(provider.pushCalls).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("rejects the push with a structured 4xx when no push-capable device is registered", async () => {
    const provider = new FakeActionProvider({ status: "failed", code: "no_push_device", error: "no authenticator" });
    await expect(
      postMfaPush(
        optionsFor(provider, []),
        contextFor(MFA_PUSH_PATH, { confirm: true, reason: "x" }),
        TENANT,
        callerFor("all"),
        "user-1",
      ),
    ).rejects.toMatchObject({ status: 400, code: "mfa.no_push_device" });
  });

  it("requires confirmation and a reason", async () => {
    const provider = new FakeActionProvider();
    await expect(
      postMfaPush(optionsFor(provider, []), contextFor(MFA_PUSH_PATH, { reason: "x" }), TENANT, callerFor("all"), "user-1"),
    ).rejects.toMatchObject({ status: 400 });
    expect(provider.pushCalls).toHaveLength(0);
  });
});

describe("MFA default method (T-0224)", () => {
  it("accepts a method from the registered set and audits it", async () => {
    const provider = new FakeActionProvider();
    const audits: MfaAuditEvent[] = [];
    const response = await postMfaDefaultMethod(
      optionsFor(provider, audits),
      contextFor(MFA_DEFAULT_METHOD_PATH, { method: "phone", confirm: true, reason: "user preference" }),
      TENANT,
      callerFor("all"),
      "user-1",
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      userId: "user-1",
      status: "applied",
      methods: ["microsoftAuthenticator", "phone"],
      defaultMethod: "phone",
      error: null,
    });
    expect(audits[0]).toMatchObject({ action: "mfa.defaultMethod", targetId: "user-1", result: "success" });
  });

  it("rejects an unregistered method with a structured 4xx", async () => {
    const provider = new FakeActionProvider(
      { status: "applied", pushTarget: null },
      { status: "failed", methods: ["phone"], code: "unregistered_method", error: "not registered" },
    );
    await expect(
      postMfaDefaultMethod(
        optionsFor(provider, []),
        contextFor(MFA_DEFAULT_METHOD_PATH, { method: "fido2", confirm: true, reason: "x" }),
        TENANT,
        callerFor("all"),
        "user-1",
      ),
    ).rejects.toMatchObject({ status: 400, code: "mfa.unknown_method" });
  });

  it("requires the method, confirmation, and a reason", async () => {
    const provider = new FakeActionProvider();
    const options = optionsFor(provider, []);
    const caller = callerFor("all");
    await expect(
      postMfaDefaultMethod(options, contextFor(MFA_DEFAULT_METHOD_PATH, { confirm: true, reason: "x" }), TENANT, caller, "user-1"),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      postMfaDefaultMethod(options, contextFor(MFA_DEFAULT_METHOD_PATH, { method: "phone", reason: "x" }), TENANT, caller, "user-1"),
    ).rejects.toMatchObject({ status: 400 });
    expect(provider.defaultCalls).toHaveLength(0);
  });
});

describe("action route wiring (T-0224)", () => {
  it("mounts push and default-method under mfa.write", () => {
    const routes = createMfaRoutes({
      report: EMPTY_REPORT,
      resolveCaller: () => callerFor("all"),
    });
    expect(routes.map((route) => `${route.method} ${route.path}`)).toContain(`POST ${MFA_PUSH_PATH}`);
    expect(routes.map((route) => `${route.method} ${route.path}`)).toContain(`POST ${MFA_DEFAULT_METHOD_PATH}`);
    expect(MFA_OPENAPI.paths["/tenants/{tenantId}/users/{userId}/push"].post.permission).toBe("mfa.write");
    expect(MFA_OPENAPI.paths["/tenants/{tenantId}/users/{userId}/default-method"].post.permission).toBe("mfa.write");
  });
});
