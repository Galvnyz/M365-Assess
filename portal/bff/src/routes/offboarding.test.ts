import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { tenantScope } from "../rbac/scope.js";
import type { RequestContext } from "../server.js";
import {
  OFFBOARDING_JOB_NOT_FOUND,
  OFFBOARDING_OPENAPI,
  OFFBOARDING_PERMISSION,
  OFFBOARDING_STEP_NOT_FOUND,
  createOffboardingRoutes,
  type OffboardingAuditEvent,
  type OffboardingCaller,
  type OffboardingJobRecord,
  type OffboardingQueue,
  type OffboardingRouteOptions,
  type OffboardingStepRecord,
  type OffboardingStore,
} from "./offboarding.js";

const TENANT = "tenant-a";
const OTHER_TENANT = "tenant-b";

class FakeOffboardingStore implements OffboardingStore {
  private readonly jobs = new Map<string, OffboardingJobRecord>();
  private readonly steps = new Map<string, OffboardingStepRecord[]>();

  async createJob(input: {
    id: string;
    tenantId: string;
    userIds: readonly string[];
    options: Record<string, unknown>;
    createdBy: string;
  }): Promise<OffboardingJobRecord> {
    const job: OffboardingJobRecord = {
      ...input,
      userIds: [...input.userIds],
      options: { ...input.options },
      state: "planned",
      createdAt: "2026-09-26T00:00:00.000Z",
    };
    this.jobs.set(job.id, job);
    this.steps.set(job.id, []);
    return job;
  }

  async getJob(jobId: string): Promise<OffboardingJobRecord | undefined> {
    return this.jobs.get(jobId);
  }

  async createSteps(jobId: string, actions: readonly string[]): Promise<readonly OffboardingStepRecord[]> {
    const rows = actions.map((action, index) => ({
      jobId,
      order: index + 1,
      action,
      state: "pending" as const,
      result: null,
      error: null,
      appliedAt: null,
    }));
    this.steps.set(jobId, rows);
    return [...rows];
  }

  async listSteps(jobId: string): Promise<readonly OffboardingStepRecord[]> {
    return [...(this.steps.get(jobId) ?? [])];
  }

  async getStep(jobId: string, order: number): Promise<OffboardingStepRecord | undefined> {
    return (this.steps.get(jobId) ?? []).find((step) => step.order === order);
  }

  async resetStep(jobId: string, order: number): Promise<OffboardingStepRecord | undefined> {
    const rows = this.steps.get(jobId) ?? [];
    const index = rows.findIndex((step) => step.order === order);
    if (index < 0) return undefined;
    const reset: OffboardingStepRecord = {
      ...(rows[index] as OffboardingStepRecord),
      state: "pending",
      result: null,
      error: null,
      appliedAt: null,
    };
    rows[index] = reset;
    return reset;
  }

  async updateJobState(jobId: string, state: OffboardingJobRecord["state"]): Promise<OffboardingJobRecord | undefined> {
    const existing = this.jobs.get(jobId);
    if (!existing) return undefined;
    const updated = { ...existing, state };
    this.jobs.set(jobId, updated);
    return updated;
  }

  failStep(jobId: string, order: number, error: string): void {
    const rows = this.steps.get(jobId) ?? [];
    const index = rows.findIndex((step) => step.order === order);
    if (index >= 0) {
      rows[index] = { ...(rows[index] as OffboardingStepRecord), state: "failed", error };
    }
  }
}

class FakeOffboardingQueue implements OffboardingQueue {
  readonly requests: Array<{ jobId: string; tenantId: string; rerunOrder?: number }> = [];

  async enqueue(request: { jobId: string; tenantId: string; rerunOrder?: number }): Promise<string> {
    this.requests.push({ ...request });
    return `queue-${request.jobId}`;
  }
}

function callerFor(tenantIds: readonly string[] | "all"): OffboardingCaller {
  return {
    roles: [],
    tenantScope: tenantIds === "all" ? { all: true, tenantIds: [] } : tenantScope(tenantIds),
    userId: "operator-1",
  };
}

function optionsFor(
  caller: OffboardingCaller | undefined,
  allowed: boolean,
  overrides: Partial<OffboardingRouteOptions> = {},
): {
  store: FakeOffboardingStore;
  queue: FakeOffboardingQueue;
  audits: OffboardingAuditEvent[];
  routes: ReturnType<typeof createOffboardingRoutes>;
} {
  const store = new FakeOffboardingStore();
  const queue = new FakeOffboardingQueue();
  const audits: OffboardingAuditEvent[] = [];
  let counter = 0;
  const routes = createOffboardingRoutes({
    store,
    queue,
    resolveCaller: () => caller,
    authorize: async (_caller, permission) => {
      if (!allowed || permission !== OFFBOARDING_PERMISSION) {
        throw new AppError("auth.forbidden", "not permitted to perform this action", 403);
      }
    },
    readBody: (ctx) => (ctx as { body?: unknown }).body,
    recordAudit: async (event) => {
      audits.push(event);
    },
    idGenerator: () => `job-${(counter += 1)}`,
    now: () => "2026-09-26T00:00:00.000Z",
    ...overrides,
  });
  return { store, audits, queue, routes };
}

function context(method: string, path: string, params: Record<string, string>, body?: unknown): RequestContext {
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

const START_BODY = {
  userIds: ["user-1", "user-2"],
  options: { disableSignIn: true, removeLicenses: true, convertMailbox: false, removeGroups: false },
};

describe("offboarding run routes (T-0206)", () => {
  it("publishes the offboarding operations with the users.offboard permission", () => {
    expect(OFFBOARDING_PERMISSION).toBe("users.offboard");
    expect(OFFBOARDING_OPENAPI.paths["/tenants/{tenantId}/offboarding"].post.operationId).toBe(
      "startOffboarding",
    );
    expect(OFFBOARDING_OPENAPI.paths["/offboarding/{jobId}/steps/{order}/rerun"].post.operationId).toBe(
      "rerunOffboardingStep",
    );
  });

  it("builds the v1 plan, persists the job, and enqueues the run", async () => {
    const { queue, audits, routes } = optionsFor(callerFor([TENANT]), true);
    const handler = routes[0]?.handler;
    if (!handler) throw new Error("offboarding start handler is missing");

    const response = await handler(context("POST", `/v1/tenants/${TENANT}/offboarding`, { tenantId: TENANT }, START_BODY));

    expect(response.status).toBe(202);
    const body = response.body as { job: OffboardingJobRecord; steps: OffboardingStepRecord[] };
    expect(body.job.id).toBe("job-1");
    expect(body.job.userIds).toEqual(["user-1", "user-2"]);
    expect(body.steps.map((step) => step.action)).toEqual(["disable-sign-in", "remove-licenses"]);
    expect(body.job.options).toMatchObject({ mailboxAccess: { mode: "full", automap: false } });
    expect(queue.requests).toEqual([{ jobId: "job-1", tenantId: TENANT }]);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "users.offboard_start", targetId: "job-1" });
  });

  it("rejects an option outside the v1 catalogue instead of ignoring it", async () => {
    const { queue, routes } = optionsFor(callerFor([TENANT]), true);
    const handler = routes[0]?.handler;
    if (!handler) throw new Error("offboarding start handler is missing");

    await expect(
      handler(
        context("POST", "/x", { tenantId: TENANT }, { userIds: ["user-1"], options: { wipeDevice: true } }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(queue.requests).toHaveLength(0);
  });

  it("rejects an empty user list", async () => {
    const { routes } = optionsFor(callerFor([TENANT]), true);
    const handler = routes[0]?.handler;
    if (!handler) throw new Error("offboarding start handler is missing");

    await expect(
      handler(context("POST", "/x", { tenantId: TENANT }, { userIds: [], options: { disableSignIn: true } })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("serves per-step progress for the job", async () => {
    const { store, routes } = optionsFor(callerFor([TENANT]), true);
    const start = routes[0]?.handler;
    const progress = routes[1]?.handler;
    if (!start || !progress) throw new Error("offboarding handlers are missing");

    const started = (await start(context("POST", "/x", { tenantId: TENANT }, START_BODY))).body as {
      job: OffboardingJobRecord;
    };
    store.failStep(started.job.id, 1, "graph rejected disable");
    const response = await progress(
      context("GET", "/x", { tenantId: TENANT, jobId: started.job.id }),
    );

    expect(response.status).toBe(200);
    const body = response.body as { job: OffboardingJobRecord; steps: OffboardingStepRecord[] };
    expect(body.steps).toHaveLength(2);
    expect(body.steps[0]).toMatchObject({ order: 1, state: "failed", error: "graph rejected disable" });
    expect(body.steps[1]).toMatchObject({ order: 2, state: "pending" });
  });

  it("rejects progress for another tenant job at the scope gate", async () => {
    const { routes } = optionsFor(callerFor([TENANT]), true);
    const start = routes[0]?.handler;
    const progress = routes[1]?.handler;
    if (!start || !progress) throw new Error("offboarding handlers are missing");

    const started = (await start(context("POST", "/x", { tenantId: TENANT }, START_BODY))).body as {
      job: OffboardingJobRecord;
    };
    await expect(
      progress(context("GET", "/x", { tenantId: OTHER_TENANT, jobId: started.job.id })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("re-runs one failed step without touching applied steps", async () => {
    const { store, queue, audits, routes } = optionsFor(callerFor([TENANT]), true);
    const start = routes[0]?.handler;
    const rerun = routes[2]?.handler;
    if (!start || !rerun) throw new Error("offboarding handlers are missing");

    const started = (await start(context("POST", "/x", { tenantId: TENANT }, START_BODY))).body as {
      job: OffboardingJobRecord;
    };
    store.failStep(started.job.id, 2, "license service timed out");
    const response = await rerun(context("POST", "/x", { jobId: started.job.id, order: "2" }));

    expect(response.status).toBe(202);
    const body = response.body as { job: OffboardingJobRecord; step: OffboardingStepRecord };
    expect(body.step).toMatchObject({ order: 2, state: "pending", error: null });
    expect(body.job.state).toBe("running");
    expect(queue.requests).toEqual([
      { jobId: started.job.id, tenantId: TENANT },
      { jobId: started.job.id, tenantId: TENANT, rerunOrder: 2 },
    ]);
    const steps = await store.listSteps(started.job.id);
    expect(steps[0]?.state).toBe("pending");
    expect(audits).toHaveLength(2);
    expect(audits[1]).toMatchObject({ action: "users.offboard_rerun", targetId: started.job.id });
  });

  it("returns 404 when the rerun step does not exist", async () => {
    const { routes } = optionsFor(callerFor([TENANT]), true);
    const start = routes[0]?.handler;
    const rerun = routes[2]?.handler;
    if (!start || !rerun) throw new Error("offboarding handlers are missing");

    const started = (await start(context("POST", "/x", { tenantId: TENANT }, START_BODY))).body as {
      job: OffboardingJobRecord;
    };
    await expect(rerun(context("POST", "/x", { jobId: started.job.id, order: "9" }))).rejects.toMatchObject({
      status: 404,
      code: OFFBOARDING_STEP_NOT_FOUND,
    });
    await expect(rerun(context("POST", "/x", { jobId: "missing", order: "1" }))).rejects.toMatchObject({
      status: 404,
      code: OFFBOARDING_JOB_NOT_FOUND,
    });
  });

  it("requires the users.offboard permission and enqueues nothing on denial", async () => {
    const { queue, routes } = optionsFor(callerFor([TENANT]), false);
    const handler = routes[0]?.handler;
    if (!handler) throw new Error("offboarding start handler is missing");

    await expect(handler(context("POST", "/x", { tenantId: TENANT }, START_BODY))).rejects.toMatchObject({
      status: 403,
    });
    expect(queue.requests).toHaveLength(0);
  });

  it("rejects a tenant outside the caller scope", async () => {
    const { queue, routes } = optionsFor(callerFor([OTHER_TENANT]), true);
    const handler = routes[0]?.handler;
    if (!handler) throw new Error("offboarding start handler is missing");

    await expect(handler(context("POST", "/x", { tenantId: TENANT }, START_BODY))).rejects.toMatchObject({
      status: 403,
    });
    expect(queue.requests).toHaveLength(0);
  });

  it("requires authentication", async () => {
    const { routes } = optionsFor(undefined, true);
    const handler = routes[0]?.handler;
    if (!handler) throw new Error("offboarding start handler is missing");

    await expect(handler(context("POST", "/x", { tenantId: TENANT }, START_BODY))).rejects.toMatchObject({
      status: 401,
    });
  });
});
