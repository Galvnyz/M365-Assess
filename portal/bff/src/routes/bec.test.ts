import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { tenantScope } from "../rbac/scope.js";
import type { RequestContext } from "../server.js";
import {
  BEC_CHECKS,
  BEC_CONFIRM_REQUIRED,
  BEC_FINDING_NOT_FOUND,
  BEC_MANUAL_ONLY,
  BEC_OPENAPI,
  BEC_PERMISSION,
  createBecRoutes,
  type BecAuditEvent,
  type BecCaller,
  type BecCheckOutcome,
  type BecCheckProvider,
  type BecFindingRecord,
  type BecFindingStore,
  type BecRemediateProvider,
  type BecRouteOptions,
} from "./bec.js";

const TENANT = "tenant-a";
const OTHER_TENANT = "tenant-b";
const USER_ID = "user-1";

function automated(action: string): BecCheckOutcome["remediation"] {
  return { action, automated: true, label: `Run ${action}`, steps: [] };
}

function manual(label: string): BecCheckOutcome["remediation"] {
  return { action: "manual-review", automated: false, label, steps: ["Review in the portal"] };
}

function elevenChecks(): BecCheckOutcome[] {
  return (BEC_CHECKS as readonly string[]).map((check, index) => ({
    check: check as BecCheckOutcome["check"],
    state: index < 2 ? ("finding" as const) : ("clear" as const),
    detail: { note: `${check}-detail` },
    evidence: index < 2 ? [{ item: `${check}-evidence` }] : [],
    remediation: index === 0 ? automated("removeInboxRule") : index === 1 ? manual("Review") : null,
  }));
}

class FakeCheckProvider implements BecCheckProvider {
  readonly calls: Array<{ tenantId: string; userId: string }> = [];

  constructor(private readonly outcomes: BecCheckOutcome[] = elevenChecks()) {}

  async runCheck(tenantId: string, userId: string): Promise<readonly BecCheckOutcome[]> {
    this.calls.push({ tenantId, userId });
    return this.outcomes.map((outcome) => ({ ...outcome }));
  }
}

class FakeFindingStore implements BecFindingStore {
  readonly saved: BecFindingRecord[][] = [];
  private readonly findings = new Map<string, BecFindingRecord>();

  async saveFindings(findings: readonly BecFindingRecord[]): Promise<readonly BecFindingRecord[]> {
    this.saved.push([...findings]);
    for (const finding of findings) {
      this.findings.set(finding.id, finding);
    }
    return [...findings];
  }

  async listFindings(tenantId: string, userId: string): Promise<readonly BecFindingRecord[]> {
    return [...this.findings.values()].filter(
      (finding) => finding.tenantId === tenantId && finding.userId === userId,
    );
  }

  async getFinding(findingId: string): Promise<BecFindingRecord | undefined> {
    return this.findings.get(findingId);
  }

  async updateFindingState(
    findingId: string,
    state: BecFindingRecord["state"],
  ): Promise<BecFindingRecord | undefined> {
    const existing = this.findings.get(findingId);
    if (!existing) return undefined;
    const updated = { ...existing, state, updatedAt: "2026-09-26T00:00:01.000Z" };
    this.findings.set(findingId, updated);
    return updated;
  }
}

class FakeRemediateProvider implements BecRemediateProvider {
  readonly calls: Array<{ tenantId: string; userId: string; action: string }> = [];

  async remediate(tenantId: string, userId: string, finding: BecFindingRecord, action: string) {
    this.calls.push({ tenantId, userId, action });
    return { before: { rule: finding.id }, after: null };
  }
}

function callerFor(tenantIds: readonly string[] | "all"): BecCaller {
  return {
    roles: [],
    tenantScope: tenantIds === "all" ? { all: true, tenantIds: [] } : tenantScope(tenantIds),
  };
}

function optionsFor(
  caller: BecCaller | undefined,
  allowed: boolean,
  overrides: Partial<BecRouteOptions> = {},
): {
  provider: FakeCheckProvider;
  store: FakeFindingStore;
  remediate: FakeRemediateProvider;
  audits: BecAuditEvent[];
  routes: ReturnType<typeof createBecRoutes>;
} {
  const provider = new FakeCheckProvider();
  const store = new FakeFindingStore();
  const remediate = new FakeRemediateProvider();
  const audits: BecAuditEvent[] = [];
  let counter = 0;
  const routes = createBecRoutes({
    provider,
    store,
    remediate,
    resolveCaller: () => caller,
    authorize: async (_caller, permission) => {
      if (!allowed || permission !== BEC_PERMISSION) {
        throw new AppError("auth.forbidden", "not permitted to perform this action", 403);
      }
    },
    readBody: (ctx) => (ctx as { body?: unknown }).body,
    recordAudit: async (event) => {
      audits.push(event);
    },
    idGenerator: () => `finding-${(counter += 1)}`,
    now: () => "2026-09-26T00:00:00.000Z",
    ...overrides,
  });
  return { provider, store, remediate, audits, routes };
}

function context(
  method: string,
  path: string,
  params: Record<string, string>,
  body?: unknown,
): RequestContext {
  return {
    correlationId: "correlation-1",
    method,
    path,
    query: new URLSearchParams(),
    headers: {},
    params,
    body,
  } as RequestContext;
}

const CHECK_PARAMS = { tenantId: TENANT, userId: USER_ID };

describe("BEC check routes (T-0207)", () => {
  it("publishes the 11-check catalogue and the users.bec permission", () => {
    expect([...BEC_CHECKS]).toEqual([
      "mailboxRules",
      "recentUsers",
      "newApplications",
      "mailboxPermissions",
      "sentMessages",
      "mfaDevices",
      "passwordChanges",
      "mailFlow",
      "intuneDevices",
      "signinLocations",
      "sharingLinks",
    ]);
    expect(BEC_PERMISSION).toBe("Identity.User.ReadWrite");
    expect(BEC_OPENAPI.paths["/tenants/{tenantId}/users/{userId}/bec-check"].post.operationId).toBe(
      "runBecCheck",
    );
    expect(
      BEC_OPENAPI.paths["/tenants/{tenantId}/users/{userId}/bec-findings/{findingId}/remediate"].post
        .operationId,
    ).toBe("remediateBecFinding");
  });

  it("returns all 11 checks and persists only finding/review outcomes", async () => {
    const { provider, store, audits, routes } = optionsFor(callerFor([TENANT]), true);
    const handler = routes[0]?.handler;
    if (!handler) throw new Error("bec-check handler is missing");

    const response = await handler(context("POST", `/v1/tenants/${TENANT}/users/${USER_ID}/bec-check`, CHECK_PARAMS));

    expect(response.status).toBe(200);
    const body = response.body as { findings: BecFindingRecord[]; checks: BecCheckOutcome[] };
    expect(body.checks).toHaveLength(11);
    expect(body.findings).toHaveLength(2);
    expect(body.findings[0]?.check).toBe("mailboxRules");
    expect(body.findings[0]?.state).toBe("open");
    expect(body.findings[0]?.detail).toMatchObject({ evidence: [{ item: "mailboxRules-evidence" }] });
    expect(provider.calls).toEqual([{ tenantId: TENANT, userId: USER_ID }]);
    expect(store.saved).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "users.bec_check", targetId: USER_ID, result: "success" });
  });

  it("rejects a provider result missing a check", async () => {
    const short = new FakeCheckProvider(elevenChecks().slice(0, 10));
    const { store, routes } = optionsFor(callerFor([TENANT]), true, { provider: short });
    const handler = routes[0]?.handler;
    if (!handler) throw new Error("bec-check handler is missing");

    await expect(handler(context("POST", "/x", CHECK_PARAMS))).rejects.toMatchObject({ status: 400 });
    expect(store.saved).toHaveLength(0);
  });

  it("lists persisted findings for the user", async () => {
    const { routes } = optionsFor(callerFor([TENANT]), true);
    const check = routes[0]?.handler;
    const list = routes[1]?.handler;
    if (!check || !list) throw new Error("bec handlers are missing");

    await check(context("POST", "/x", CHECK_PARAMS));
    const response = await list(context("GET", "/x", CHECK_PARAMS));

    const body = response.body as { findings: BecFindingRecord[] };
    expect(body.findings).toHaveLength(2);
  });

  it("remediates an automated finding after confirmation with before/after and audit", async () => {
    const { remediate, audits, routes } = optionsFor(callerFor([TENANT]), true);
    const check = routes[0]?.handler;
    const remediateHandler = routes[2]?.handler;
    if (!check || !remediateHandler) throw new Error("bec handlers are missing");

    const ran = (await check(context("POST", "/x", CHECK_PARAMS))).body as {
      findings: BecFindingRecord[];
    };
    const findingId = ran.findings[0]?.id ?? "";
    const response = await remediateHandler(
      context("POST", "/x", { ...CHECK_PARAMS, findingId }, { confirm: true }),
    );

    expect(response.status).toBe(200);
    const body = response.body as { state: string; before: object | null; finding: BecFindingRecord };
    expect(body.state).toBe("remediated");
    expect(body.before).toMatchObject({ rule: findingId });
    expect(body.finding.state).toBe("remediated");
    expect(remediate.calls).toEqual([{ tenantId: TENANT, userId: USER_ID, action: "removeInboxRule" }]);
    expect(audits).toHaveLength(2);
    expect(audits[1]).toMatchObject({
      action: "users.bec_remediate",
      check: "mailboxRules",
      result: "success",
    });
  });

  it("requires confirmation before remediating", async () => {
    const { remediate, routes } = optionsFor(callerFor([TENANT]), true);
    const check = routes[0]?.handler;
    const remediateHandler = routes[2]?.handler;
    if (!check || !remediateHandler) throw new Error("bec handlers are missing");

    const ran = (await check(context("POST", "/x", CHECK_PARAMS))).body as {
      findings: BecFindingRecord[];
    };
    const findingId = ran.findings[0]?.id ?? "";

    await expect(
      remediateHandler(context("POST", "/x", { ...CHECK_PARAMS, findingId }, {})),
    ).rejects.toMatchObject({ status: 400, code: BEC_CONFIRM_REQUIRED });
    expect(remediate.calls).toHaveLength(0);
  });

  it("refuses a manual-only finding with evidence intact", async () => {
    const { remediate, routes } = optionsFor(callerFor([TENANT]), true);
    const check = routes[0]?.handler;
    const remediateHandler = routes[2]?.handler;
    if (!check || !remediateHandler) throw new Error("bec handlers are missing");

    const ran = (await check(context("POST", "/x", CHECK_PARAMS))).body as {
      findings: BecFindingRecord[];
    };
    const manualId = ran.findings.find((finding) => finding.check === "recentUsers")?.id ?? "";

    await expect(
      remediateHandler(context("POST", "/x", { ...CHECK_PARAMS, findingId: manualId }, { confirm: true })),
    ).rejects.toMatchObject({ status: 400, code: BEC_MANUAL_ONLY });
    expect(remediate.calls).toHaveLength(0);
  });

  it("returns 404 for an unknown or already-remediated finding", async () => {
    const { routes } = optionsFor(callerFor([TENANT]), true);
    const remediateHandler = routes[2]?.handler;
    if (!remediateHandler) throw new Error("bec remediate handler is missing");

    await expect(
      remediateHandler(context("POST", "/x", { ...CHECK_PARAMS, findingId: "nope" }, { confirm: true })),
    ).rejects.toMatchObject({ status: 404, code: BEC_FINDING_NOT_FOUND });
  });

  it("returns 501 when remediation is not wired", async () => {
    const { routes } = optionsFor(callerFor([TENANT]), true, { remediate: undefined });
    const check = routes[0]?.handler;
    const remediateHandler = routes[2]?.handler;
    if (!check || !remediateHandler) throw new Error("bec handlers are missing");

    const ran = (await check(context("POST", "/x", CHECK_PARAMS))).body as {
      findings: BecFindingRecord[];
    };
    const findingId = ran.findings[0]?.id ?? "";

    await expect(
      remediateHandler(context("POST", "/x", { ...CHECK_PARAMS, findingId }, { confirm: true })),
    ).rejects.toMatchObject({ status: 501 });
  });

  it("requires the users.bec permission and calls no provider on denial", async () => {
    const { provider, routes } = optionsFor(callerFor([TENANT]), false);
    const handler = routes[0]?.handler;
    if (!handler) throw new Error("bec-check handler is missing");

    await expect(handler(context("POST", "/x", CHECK_PARAMS))).rejects.toMatchObject({ status: 403 });
    expect(provider.calls).toHaveLength(0);
  });

  it("rejects a tenant outside the caller scope", async () => {
    const { provider, routes } = optionsFor(callerFor([OTHER_TENANT]), true);
    const handler = routes[0]?.handler;
    if (!handler) throw new Error("bec-check handler is missing");

    await expect(handler(context("POST", "/x", CHECK_PARAMS))).rejects.toMatchObject({ status: 403 });
    expect(provider.calls).toHaveLength(0);
  });

  it("requires authentication", async () => {
    const { provider, routes } = optionsFor(undefined, true);
    const handler = routes[0]?.handler;
    if (!handler) throw new Error("bec-check handler is missing");

    await expect(handler(context("POST", "/x", CHECK_PARAMS))).rejects.toMatchObject({ status: 401 });
    expect(provider.calls).toHaveLength(0);
  });

  it("holds no M365 SDK call in the route module", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = (await import("node:path")).default;
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "bec.ts"), "utf8");
    for (const marker of ["Invoke-MgGraphRequest", "Invoke-MgRestMethod", "Connect-MgGraph", "microsoft-graph-client"]) {
      expect(source).not.toContain(marker);
    }
  });
});
