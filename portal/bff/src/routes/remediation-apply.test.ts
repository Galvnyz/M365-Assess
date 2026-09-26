// T-0108 — gated apply API: Idempotency-Key, dry-run, history.
// Route-level tests: the apply route enqueues a `remediation` job and replays
// prior handles; the history route serves the tenant-scoped append-only log.

import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { ALL_TENANTS, tenantScope } from "../rbac/scope.js";
import { RbacErrorCodes, type Caller } from "../rbac/authorize.js";
import type { JobEnvelope } from "@m365-assess/contracts";
import type { RequestContext } from "../server.js";
import {
  REMEDIATION_APPLY_PATH,
  REMEDIATION_HISTORY_PATH,
  REMEDIATION_OPENAPI,
  REMEDIATION_PERMISSIONS,
  REMEDIATION_PLAN_NOT_FOUND,
  REMEDIATION_PLAN_DETAIL_PATH,
  REMEDIATION_PLANS_PATH,
  createRemediationRoutes,
  type RemediationActionRecord,
  type RemediationPlanRecord,
  type RemediationPlanStore,
  type RemediationQueue,
} from "./remediation.js";
import { REMEDIATION_IDEMPOTENCY_REQUIRED } from "../domain/remediation/apply.js";

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

  async listRemediationActionsForTenant(tenantId: string): Promise<readonly RemediationActionRecord[]> {
    const out: RemediationActionRecord[] = [];
    for (const [planId, actions] of this.actions) {
      if (this.plans.get(planId)?.tenantId === tenantId) out.push(...actions);
    }
    return out;
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

function allowAll(): void {}

function denyAll(): void {
  throw new AppError(RbacErrorCodes.forbidden, "not permitted to perform this action", 403);
}

function postContext(
  path: string,
  body: Record<string, unknown>,
  options: { params?: Record<string, string>; idempotencyKey?: string } = {},
): RequestContext & { body?: unknown } {
  const headers: Record<string, string> = {};
  if (options.idempotencyKey !== undefined) headers["idempotency-key"] = options.idempotencyKey;
  return {
    correlationId: "corr-apply-1",
    method: "POST",
    path,
    query: new URLSearchParams(),
    headers,
    params: options.params ?? {},
    body,
  };
}

function historyContext(tenantId?: string, extra: Record<string, string> = {}): RequestContext {
  const query = new URLSearchParams({ ...(tenantId ? { tenantId } : {}), ...extra });
  return {
    correlationId: "corr-hist-1",
    method: "GET",
    path: REMEDIATION_HISTORY_PATH,
    query,
    headers: {},
    params: {},
  };
}

function routeFor(
  opts: Parameters<typeof createRemediationRoutes>[0],
  method: string,
  path: string,
) {
  const route = createRemediationRoutes(opts).find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`route not found: ${method} ${path}`);
  return route;
}

function seedPlan(store: MemoryPlanStore, planId: string, tenantId = TENANT_1): void {
  store.plans.set(planId, {
    id: planId,
    tenantId,
    runId: "run-1",
    findingIds: ["f1"],
    mode: "automated",
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
      result: { mode: "automated" },
      error: null,
      correlationId: "corr-1",
    },
  ]);
}

function baseOptions(store: MemoryPlanStore, queue: FakeQueue, overrides: Record<string, unknown> = {}) {
  let seq = 0;
  return {
    store,
    queue,
    resolveCaller: () => adminCaller(),
    authorize: allowAll,
    idGenerator: () => `id-${(seq += 1)}`,
    now: () => "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("POST /v1/remediation/plans/{planId}/apply (T-0108)", () => {
  it("enqueues a gated apply job with the body flags and returns a 202 handle", async () => {
    const store = new MemoryPlanStore();
    seedPlan(store, "plan-1");
    const queue = new FakeQueue();
    const route = routeFor(baseOptions(store, queue), "POST", REMEDIATION_APPLY_PATH);

    const res = await route.handler(
      postContext(REMEDIATION_APPLY_PATH, { dryRun: false, continueOnFailure: true, reason: "ticket-1" }, {
        params: { planId: "plan-1" },
        idempotencyKey: "key-1",
      }),
    );

    expect(res.status).toBe(202);
    const body = res.body as Record<string, unknown>;
    expect(body.planId).toBe("plan-1");
    expect(body.dryRun).toBe(false);
    expect(body.status).toBe("queued");

    expect(queue.enqueued).toHaveLength(1);
    const payload = queue.enqueued[0]!.payload as Record<string, unknown>;
    expect(payload["planId"]).toBe("plan-1");
    expect(payload["dryRun"]).toBe(false);
    expect(payload["continueOnFailure"]).toBe(true);
    expect(payload["reason"]).toBe("ticket-1");
    expect(payload["idempotencyKey"]).toBe("key-1");
  });

  it("defaults dryRun to true when the body omits it", async () => {
    const store = new MemoryPlanStore();
    seedPlan(store, "plan-1");
    const queue = new FakeQueue();
    const route = routeFor(baseOptions(store, queue), "POST", REMEDIATION_APPLY_PATH);

    const res = await route.handler(
      postContext(REMEDIATION_APPLY_PATH, {}, { params: { planId: "plan-1" }, idempotencyKey: "k" }),
    );
    expect(res.status).toBe(202);
    expect((res.body as Record<string, unknown>).dryRun).toBe(true);
    expect((queue.enqueued[0]!.payload as Record<string, unknown>)["dryRun"]).toBe(true);
  });

  it("requires an Idempotency-Key", async () => {
    const store = new MemoryPlanStore();
    seedPlan(store, "plan-1");
    const queue = new FakeQueue();
    const route = routeFor(baseOptions(store, queue), "POST", REMEDIATION_APPLY_PATH);

    await expect(
      route.handler(postContext(REMEDIATION_APPLY_PATH, {}, { params: { planId: "plan-1" } })),
    ).rejects.toMatchObject({ status: 400, code: REMEDIATION_IDEMPOTENCY_REQUIRED });
    expect(queue.enqueued).toHaveLength(0);
  });

  it("replays a prior handle for a repeated Idempotency-Key without re-enqueuing", async () => {
    const store = new MemoryPlanStore();
    seedPlan(store, "plan-1");
    const queue = new FakeQueue();
    const route = routeFor(baseOptions(store, queue), "POST", REMEDIATION_APPLY_PATH);

    const first = await route.handler(
      postContext(REMEDIATION_APPLY_PATH, { dryRun: false }, { params: { planId: "plan-1" }, idempotencyKey: "same" }),
    );
    const second = await route.handler(
      postContext(REMEDIATION_APPLY_PATH, { dryRun: false }, { params: { planId: "plan-1" }, idempotencyKey: "same" }),
    );

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect((second.body as Record<string, unknown>).replayed).toBe(true);
    expect((second.body as Record<string, unknown>).jobId).toBe(
      (first.body as Record<string, unknown>).jobId,
    );
    expect(queue.enqueued).toHaveLength(1);
  });

  it("returns 403 when the apply permission is denied", async () => {
    const store = new MemoryPlanStore();
    seedPlan(store, "plan-1");
    const route = routeFor(
      baseOptions(store, new FakeQueue(), { authorize: denyAll }),
      "POST",
      REMEDIATION_APPLY_PATH,
    );
    await expect(
      route.handler(postContext(REMEDIATION_APPLY_PATH, {}, { params: { planId: "plan-1" }, idempotencyKey: "k" })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("returns 403 when the plan tenant is outside the caller scope", async () => {
    const store = new MemoryPlanStore();
    seedPlan(store, "plan-1", TENANT_1);
    const route = routeFor(
      baseOptions(store, new FakeQueue(), { resolveCaller: () => scopedCaller([TENANT_2]) }),
      "POST",
      REMEDIATION_APPLY_PATH,
    );
    await expect(
      route.handler(postContext(REMEDIATION_APPLY_PATH, {}, { params: { planId: "plan-1" }, idempotencyKey: "k" })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("returns 404 for an unknown plan", async () => {
    const route = routeFor(baseOptions(new MemoryPlanStore(), new FakeQueue()), "POST", REMEDIATION_APPLY_PATH);
    await expect(
      route.handler(postContext(REMEDIATION_APPLY_PATH, {}, { params: { planId: "missing" }, idempotencyKey: "k" })),
    ).rejects.toMatchObject({ status: 404, code: REMEDIATION_PLAN_NOT_FOUND });
  });

  it("returns 400 for a non-boolean dryRun", async () => {
    const store = new MemoryPlanStore();
    seedPlan(store, "plan-1");
    const route = routeFor(baseOptions(store, new FakeQueue()), "POST", REMEDIATION_APPLY_PATH);
    await expect(
      route.handler(
        postContext(REMEDIATION_APPLY_PATH, { dryRun: "yes" }, { params: { planId: "plan-1" }, idempotencyKey: "k" }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("GET /v1/remediation/history (T-0108)", () => {
  it("returns the tenant-scoped append-only log with the history columns", async () => {
    const store = new MemoryPlanStore();
    seedPlan(store, "plan-1");
    const action = store.actions.get("plan-1")![0]!;
    store.actions.set("plan-1", [
      {
        ...action,
        state: "applied",
        before: { enabled: false },
        after: { enabled: true },
        appliedAt: "2026-01-02T00:00:00.000Z",
        appliedBy: "user-1",
        result: { ok: true },
      },
    ]);

    const route = routeFor(baseOptions(store, new FakeQueue()), "GET", REMEDIATION_HISTORY_PATH);
    const res = await route.handler(historyContext(TENANT_1));

    expect(res.status).toBe(200);
    const items = (res.body as { items: Record<string, unknown>[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]!.check).toBe("ENTRA-SECDEFAULT-001.1");
    expect(items[0]!.command).toBe("Set-EntraSecurityDefaultsState");
    expect(items[0]!.timestamp).toBe("2026-01-02T00:00:00.000Z");
    expect(items[0]!.actor).toBe("user-1");
    expect(items[0]!.after).toEqual({ enabled: true });
  });

  it("requires a tenantId", async () => {
    const route = routeFor(baseOptions(new MemoryPlanStore(), new FakeQueue()), "GET", REMEDIATION_HISTORY_PATH);
    await expect(route.handler(historyContext())).rejects.toMatchObject({ status: 400 });
  });

  it("returns 403 when the tenant is outside the caller scope", async () => {
    const route = routeFor(
      baseOptions(new MemoryPlanStore(), new FakeQueue(), {
        resolveCaller: () => scopedCaller([TENANT_2]),
      }),
      "GET",
      REMEDIATION_HISTORY_PATH,
    );
    await expect(route.handler(historyContext(TENANT_1))).rejects.toMatchObject({ status: 403 });
  });

  it("publishes apply and history operations with their permissions", () => {
    expect(REMEDIATION_OPENAPI["/v1/remediation/plans/{planId}/apply"].post.permission).toBe(
      REMEDIATION_PERMISSIONS.apply,
    );
    expect(REMEDIATION_OPENAPI["/v1/remediation/history"].get.permission).toBe(
      REMEDIATION_PERMISSIONS.read,
    );
  });
});

// The plan routes from T-0105 remain reachable alongside the new ones.
describe("route set (T-0105 + T-0108)", () => {
  it("exposes all four operations", () => {
    const routes = createRemediationRoutes(baseOptions(new MemoryPlanStore(), new FakeQueue()));
    const keys = routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(keys).toEqual(
      [
        `GET ${REMEDIATION_PLAN_DETAIL_PATH}`,
        `GET ${REMEDIATION_HISTORY_PATH}`,
        `POST ${REMEDIATION_APPLY_PATH}`,
        `POST ${REMEDIATION_PLANS_PATH}`,
      ].sort(),
    );
  });
});
