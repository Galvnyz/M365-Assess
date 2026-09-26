// T-0109 — verify after apply: POST /v1/remediation/actions/{actionId}/verify.
// Enqueues the verify worker job; RBAC/scope enforced; no tenant writes here.

import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { ALL_TENANTS, tenantScope } from "../rbac/scope.js";
import { RbacErrorCodes, type Caller } from "../rbac/authorize.js";
import type { JobEnvelope } from "@m365-assess/contracts";
import type { RequestContext } from "../server.js";
import {
  REMEDIATION_ACTION_NOT_FOUND,
  REMEDIATION_OPENAPI,
  REMEDIATION_PERMISSIONS,
  REMEDIATION_PLAN_NOT_FOUND,
  REMEDIATION_VERIFY_PATH,
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
  readonly actions = new Map<string, RemediationActionRecord>();

  async getRemediationPlan(planId: string): Promise<RemediationPlanRecord | undefined> {
    return this.plans.get(planId);
  }

  async listRemediationActions(planId: string): Promise<readonly RemediationActionRecord[]> {
    return [...this.actions.values()].filter((a) => a.planId === planId);
  }

  async getRemediationAction(actionId: string): Promise<RemediationActionRecord | undefined> {
    return this.actions.get(actionId);
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

function allowAll(): void {}

function denyAll(): void {
  throw new AppError(RbacErrorCodes.forbidden, "not permitted to perform this action", 403);
}

function verifyContext(actionId: string, body: Record<string, unknown> = {}): RequestContext & { body?: unknown } {
  return {
    correlationId: "corr-verify-1",
    method: "POST",
    path: `/v1/remediation/actions/${actionId}/verify`,
    query: new URLSearchParams(),
    headers: {},
    params: { actionId },
    body,
  };
}

function routeFor(opts: Parameters<typeof createRemediationRoutes>[0]) {
  const route = createRemediationRoutes(opts).find(
    (r) => r.method === "POST" && r.path === REMEDIATION_VERIFY_PATH,
  );
  if (!route) throw new Error("verify route not found");
  return route;
}

function seed(store: MemoryPlanStore, tenantId = TENANT_1): void {
  store.plans.set("plan-1", {
    id: "plan-1",
    tenantId,
    runId: "run-1",
    findingIds: ["f1"],
    mode: "automated",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "user-1",
  });
  store.actions.set("a1", {
    id: "a1",
    planId: "plan-1",
    check: "ENTRA-SECDEFAULT-001.1",
    command: "Set-EntraSecurityDefaultsState",
    target: null,
    state: "applied",
    before: null,
    after: null,
    appliedAt: "2026-01-02T00:00:00.000Z",
    appliedBy: "user-1",
    result: null,
    error: null,
    correlationId: "corr-1",
  });
}

describe("POST /v1/remediation/actions/{actionId}/verify (T-0109)", () => {
  it("enqueues a verify job and returns 202", async () => {
    const store = new MemoryPlanStore();
    seed(store);
    const queue = new FakeQueue();
    let seq = 0;
    const route = routeFor({
      store,
      queue,
      resolveCaller: () => adminCaller(),
      authorize: allowAll,
      idGenerator: () => `id-${(seq += 1)}`,
      now: () => "2026-01-01T00:00:00.000Z",
    });

    const res = await route.handler(verifyContext("a1", { section: "Entra" }));

    expect(res.status).toBe(202);
    const body = res.body as Record<string, unknown>;
    expect(body.actionId).toBe("a1");
    expect(body.tenantId).toBe(TENANT_1);
    expect(body.status).toBe("queued");

    expect(queue.enqueued).toHaveLength(1);
    const envelope = queue.enqueued[0]!;
    expect(envelope.jobType).toBe("remediation");
    expect(envelope.tenantId).toBe(TENANT_1);
    const payload = envelope.payload as Record<string, unknown>;
    expect(payload["actionId"]).toBe("a1");
    expect(payload["check"]).toBe("ENTRA-SECDEFAULT-001.1");
    expect(payload["section"]).toBe("Entra");
  });

  it("returns 404 for an unknown action", async () => {
    const store = new MemoryPlanStore();
    const route = routeFor({
      store,
      queue: new FakeQueue(),
      resolveCaller: () => adminCaller(),
      authorize: allowAll,
    });
    await expect(route.handler(verifyContext("missing"))).rejects.toMatchObject({
      status: 404,
      code: REMEDIATION_ACTION_NOT_FOUND,
    });
  });

  it("returns 404 when the action's plan is missing", async () => {
    const store = new MemoryPlanStore();
    store.actions.set("a1", {
      id: "a1",
      planId: "plan-gone",
      check: "ENTRA-SECDEFAULT-001",
      command: "cmd",
      target: null,
      state: "applied",
      before: null,
      after: null,
      appliedAt: null,
      appliedBy: null,
      result: null,
      error: null,
      correlationId: null,
    });
    const route = routeFor({
      store,
      queue: new FakeQueue(),
      resolveCaller: () => adminCaller(),
      authorize: allowAll,
    });
    await expect(route.handler(verifyContext("a1"))).rejects.toMatchObject({
      code: REMEDIATION_PLAN_NOT_FOUND,
    });
  });

  it("returns 403 when the verify permission is denied", async () => {
    const store = new MemoryPlanStore();
    seed(store);
    const route = routeFor({
      store,
      queue: new FakeQueue(),
      resolveCaller: () => adminCaller(),
      authorize: denyAll,
    });
    await expect(route.handler(verifyContext("a1"))).rejects.toMatchObject({ status: 403 });
  });

  it("returns 403 when the action's tenant is outside the caller scope", async () => {
    const store = new MemoryPlanStore();
    seed(store, TENANT_1);
    const route = routeFor({
      store,
      queue: new FakeQueue(),
      resolveCaller: () => ({ roles: ["operator"], tenantScope: tenantScope([TENANT_2]) }),
      authorize: allowAll,
    });
    await expect(route.handler(verifyContext("a1"))).rejects.toMatchObject({ status: 403 });
  });

  it("returns 401 without an authenticated caller", async () => {
    const route = routeFor({
      store: new MemoryPlanStore(),
      queue: new FakeQueue(),
      resolveCaller: () => undefined,
    });
    await expect(route.handler(verifyContext("a1"))).rejects.toMatchObject({ status: 401 });
  });

  it("publishes the verify operation with the verify permission", () => {
    expect(REMEDIATION_OPENAPI["/v1/remediation/actions/{actionId}/verify"].post.permission).toBe(
      REMEDIATION_PERMISSIONS.verify,
    );
  });
});
