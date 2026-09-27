// T-0105 — remediation plans API: enqueue generation + read plan with actions.
// Tests exercise both routes without SQL: a memory store and a fake queue stand
// in for persistence and the EPIC-001 job queue.

import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { ALL_TENANTS, tenantScope } from "../rbac/scope.js";
import { RbacErrorCodes, type Caller } from "../rbac/authorize.js";
import type { JobEnvelope } from "@m365-assess/contracts";
import type { RequestContext } from "../server.js";
import {
  REMEDIATION_OPENAPI,
  REMEDIATION_PERMISSIONS,
  REMEDIATION_PLAN_DETAIL_PATH,
  REMEDIATION_PLANS_PATH,
  REMEDIATION_PLAN_NOT_FOUND,
  createRemediationRoutes,
  type RemediationActionRecord,
  type RemediationPlanRecord,
  type RemediationPlanStore,
  type RemediationQueue,
} from "./remediation.js";

const TENANT_1 = "11111111-1111-1111-1111-111111111111";
const TENANT_2 = "22222222-2222-2222-2222-222222222222";

class MemoryPlanStore implements RemediationPlanStore {
  readonly plans = new Map<string, RemediationPlanRecord>();
  readonly actions = new Map<string, RemediationActionRecord[]>();

  async getRemediationPlan(planId: string): Promise<RemediationPlanRecord | undefined> {
    return this.plans.get(planId);
  }

  async listRemediationActions(planId: string): Promise<readonly RemediationActionRecord[]> {
    return this.actions.get(planId) ?? [];
  }
}

class FakeQueue implements RemediationQueue {
  readonly enqueued: JobEnvelope[] = [];

  async enqueue(envelope: JobEnvelope): Promise<string> {
    this.enqueued.push(envelope);
    return envelope.jobId;
  }
}

function adminCaller(): Caller {
  return { roles: ["admin"], tenantScope: ALL_TENANTS };
}

function scopedCaller(tenantIds: string[]): Caller {
  return { roles: ["operator"], tenantScope: tenantScope(tenantIds) };
}

function allowAll(): void {
  // authorize seam: permission checks pass.
}

function denyAll(): void {
  throw new AppError(RbacErrorCodes.forbidden, "not permitted to perform this action", 403);
}

function postContext(body: Record<string, unknown>): RequestContext & { body?: unknown } {
  return {
    correlationId: "corr-1",
    method: "POST",
    path: REMEDIATION_PLANS_PATH,
    query: new URLSearchParams(),
    headers: {},
    params: {},
    body,
  };
}

function getContext(planId: string): RequestContext {
  return {
    correlationId: "corr-2",
    method: "GET",
    path: `/v1/remediation/plans/${planId}`,
    query: new URLSearchParams(),
    headers: {},
    params: { planId },
  };
}

function routeFor(
  opts: Parameters<typeof createRemediationRoutes>[0],
  method: string,
  path: string,
) {
  const route = createRemediationRoutes(opts).find(
    (r) => r.method === method && r.path === path,
  );
  if (!route) throw new Error(`route not found: ${method} ${path}`);
  return route;
}

function seedPlan(store: MemoryPlanStore, planId: string, tenantId = TENANT_1): void {
  store.plans.set(planId, {
    id: planId,
    tenantId,
    runId: "run-1",
    findingIds: ["f1", "f2"],
    mode: "mixed",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "user-1",
  });
  store.actions.set(planId, [
    {
      id: "a1",
      planId,
      check: "ENTRA-SECDEFAULT-001.1",
      command: "Set-EntraSecurityDefaultsState",
      target: null,
      state: "planned",
      before: null,
      after: null,
      appliedAt: null,
      appliedBy: null,
      result: { registryKey: "ENTRA-SECDEFAULT-001", mode: "automated", gateDecision: "planned" },
      error: null,
      correlationId: "corr-1",
    },
    {
      id: "a2",
      planId,
      check: "CA-REPORTONLY-001.2",
      command: "",
      target: "entra/conditional-access",
      state: "skipped",
      before: null,
      after: null,
      appliedAt: null,
      appliedBy: null,
      result: { registryKey: "CA-REPORTONLY-001", mode: "manual", gateDecision: "skipped" },
      error: "not-allowlisted",
      correlationId: "corr-1",
    },
  ]);
}

describe("POST /v1/remediation/plans (T-0105)", () => {
  it("enqueues a remediation job and returns a plan id", async () => {
    const store = new MemoryPlanStore();
    const queue = new FakeQueue();
    let seq = 0;
    const opts = {
      store,
      queue,
      resolveCaller: () => adminCaller(),
      authorize: allowAll,
      idGenerator: () => `id-${(seq += 1)}`,
      now: () => "2026-01-01T00:00:00.000Z",
    };

    const route = routeFor(opts, "POST", REMEDIATION_PLANS_PATH);
    const res = await route.handler(postContext({ tenantId: TENANT_1, runId: "run-1" }));

    expect(res.status).toBe(202);
    const body = res.body as Record<string, unknown>;
    expect(body.planId).toBe("id-1");
    expect(body.jobId).toBe("id-2");
    expect(body.status).toBe("queued");

    expect(queue.enqueued).toHaveLength(1);
    const envelope = queue.enqueued[0]!;
    expect(envelope.jobType).toBe("remediation");
    expect(envelope.tenantId).toBe(TENANT_1);
    expect(envelope.runId).toBe("run-1");
    expect(envelope.payload.credentialRef).toBe(`tenants/${TENANT_1}/credential`);
    // Its own folder, so its result.json cannot overwrite the assessment run's.
    expect(envelope.payload.outputRef).toBe(`remediation/${TENANT_1}/id-2`);
    expect(envelope.payload).toMatchObject({
      operation: "plan",
      planId: "id-1",
      createdBy: "system",
      caller: { canApply: true, tenantScope: { all: true, tenantIds: [] } },
    });
  });

  it("plans from the tenant's latest finished run when none is named", async () => {
    const queue = new FakeQueue();
    const opts = {
      store: new MemoryPlanStore(),
      queue,
      resolveCaller: () => adminCaller(),
      authorize: allowAll,
      latestRunId: async (tenantId: string) => (tenantId === TENANT_1 ? "run-latest" : null),
    };
    const route = routeFor(opts, "POST", REMEDIATION_PLANS_PATH);
    const res = await route.handler(postContext({ tenantId: TENANT_1 }));
    expect(res.status).toBe(202);
    expect(queue.enqueued[0]!.runId).toBe("run-latest");

    await expect(route.handler(postContext({ tenantId: TENANT_2 }))).rejects.toMatchObject({
      status: 409,
      code: "remediation.no_run",
    });
    expect(queue.enqueued).toHaveLength(1);
  });

  it("tells the plan worker when the caller may not apply", async () => {
    const queue = new FakeQueue();
    const opts = {
      store: new MemoryPlanStore(),
      queue,
      resolveCaller: () => scopedCaller([TENANT_1]),
      authorize: (_caller: Caller, permission: string) => {
        if (permission === "Remediation.Apply") {
          throw new AppError(RbacErrorCodes.forbidden, "forbidden", 403);
        }
      },
    };
    await routeFor(opts, "POST", REMEDIATION_PLANS_PATH).handler(postContext({ tenantId: TENANT_1, runId: "run-1" }));
    expect(queue.enqueued[0]!.payload).toMatchObject({
      caller: { canApply: false, tenantScope: { all: false, tenantIds: [TENANT_1] } },
    });
  });

  it("returns 401 without an authenticated caller", async () => {
    const route = routeFor(
      { store: new MemoryPlanStore(), queue: new FakeQueue(), resolveCaller: () => undefined },
      "POST",
      REMEDIATION_PLANS_PATH,
    );
    await expect(route.handler(postContext({ tenantId: TENANT_1 }))).rejects.toMatchObject({
      status: 401,
    });
  });

  it("returns 403 when the plan permission is denied", async () => {
    const route = routeFor(
      {
        store: new MemoryPlanStore(),
        queue: new FakeQueue(),
        resolveCaller: () => adminCaller(),
        authorize: denyAll,
      },
      "POST",
      REMEDIATION_PLANS_PATH,
    );
    await expect(route.handler(postContext({ tenantId: TENANT_1 }))).rejects.toMatchObject({
      status: 403,
    });
  });

  it("returns 403 when the tenant is outside the caller scope", async () => {
    const route = routeFor(
      {
        store: new MemoryPlanStore(),
        queue: new FakeQueue(),
        resolveCaller: () => scopedCaller([TENANT_2]),
        authorize: allowAll,
      },
      "POST",
      REMEDIATION_PLANS_PATH,
    );
    await expect(route.handler(postContext({ tenantId: TENANT_1 }))).rejects.toMatchObject({
      status: 403,
    });
  });

  it("returns 400 when tenantId is missing", async () => {
    const route = routeFor(
      {
        store: new MemoryPlanStore(),
        queue: new FakeQueue(),
        resolveCaller: () => adminCaller(),
        authorize: allowAll,
      },
      "POST",
      REMEDIATION_PLANS_PATH,
    );
    await expect(route.handler(postContext({ runId: "run-1" }))).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe("GET /v1/remediation/plans/{planId} (T-0105)", () => {
  it("returns the plan plus one action per finding with mode and state", async () => {
    const store = new MemoryPlanStore();
    seedPlan(store, "plan-1");
    const route = routeFor(
      { store, queue: new FakeQueue(), resolveCaller: () => adminCaller(), authorize: allowAll },
      "GET",
      REMEDIATION_PLAN_DETAIL_PATH,
    );

    const res = await route.handler(getContext("plan-1"));
    expect(res.status).toBe(200);
    const body = res.body as { plan: Record<string, unknown>; actions: Record<string, unknown>[] };
    expect(body.plan.id).toBe("plan-1");
    expect(body.plan.mode).toBe("mixed");
    expect(body.actions).toHaveLength(2);
    expect(body.actions[0]!.mode).toBe("auto");
    expect(body.actions[0]!.state).toBe("planned");
    expect(body.actions[1]!.mode).toBe("manual");
    expect(body.actions[1]!.state).toBe("skipped");
    // The richer classification is preserved for triage.
    expect(body.actions[1]!.classification).toBe("manual");
  });

  it("returns 404 for an unknown plan", async () => {
    const route = routeFor(
      {
        store: new MemoryPlanStore(),
        queue: new FakeQueue(),
        resolveCaller: () => adminCaller(),
        authorize: allowAll,
      },
      "GET",
      REMEDIATION_PLAN_DETAIL_PATH,
    );
    await expect(route.handler(getContext("missing"))).rejects.toMatchObject({
      code: REMEDIATION_PLAN_NOT_FOUND,
      status: 404,
    });
  });

  it("returns 403 when the plan tenant is outside the caller scope", async () => {
    const store = new MemoryPlanStore();
    seedPlan(store, "plan-2", TENANT_1);
    const route = routeFor(
      {
        store,
        queue: new FakeQueue(),
        resolveCaller: () => scopedCaller([TENANT_2]),
        authorize: allowAll,
      },
      "GET",
      REMEDIATION_PLAN_DETAIL_PATH,
    );
    await expect(route.handler(getContext("plan-2"))).rejects.toMatchObject({ status: 403 });
  });

  it("returns 401 without an authenticated caller", async () => {
    const route = routeFor(
      { store: new MemoryPlanStore(), queue: new FakeQueue(), resolveCaller: () => undefined },
      "GET",
      REMEDIATION_PLAN_DETAIL_PATH,
    );
    await expect(route.handler(getContext("plan-1"))).rejects.toMatchObject({ status: 401 });
  });

  it("publishes both operations with remediation permissions", () => {
    expect(REMEDIATION_OPENAPI["/v1/remediation/plans"].post.permission).toBe(
      REMEDIATION_PERMISSIONS.plan,
    );
    expect(REMEDIATION_OPENAPI["/v1/remediation/plans/{planId}"].get.permission).toBe(
      REMEDIATION_PERMISSIONS.read,
    );
  });
});
