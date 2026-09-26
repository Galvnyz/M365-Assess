// Offboarding run worker routes (EPIC-011 SPEC.md §4.4 US-5; T-0206).
//
// Confirming a job runs its steps sequentially in the tenant child process;
// each step is recorded and re-runnable, progress streams to the UI, and a
// failed step surfaces a re-run action instead of being skipped silently.
// Mailbox permission grants honor the selected access mode and are verified
// after apply. Destructive steps require explicit confirmation (no v1
// catalogue step is destructive; the gate stays enforced for later
// expansions). Records structurally mirror the db package's
// OffboardingJob/OffboardingStep; persistence and queueing are injected seams
// so this module performs no tenant write.
import { randomUUID } from "node:crypto";
import { AppError, ErrorCodes } from "../errors.js";
import { buildOffboardingPlan, OffboardingPlanError } from "../domain/offboarding/plan.js";
import { requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const OFFBOARDING_JOBS_PATH = "/v1/tenants/:tenantId/offboarding";
export const OFFBOARDING_JOB_PATH = "/v1/tenants/:tenantId/offboarding/:jobId";
export const OFFBOARDING_RERUN_PATH = "/v1/offboarding/:jobId/steps/:order/rerun";

export const OFFBOARDING_PERMISSION = "users.offboard";

export const OFFBOARDING_UNAUTHENTICATED = "request.unauthenticated";
export const OFFBOARDING_JOB_NOT_FOUND = "offboarding.job_not_found";
export const OFFBOARDING_STEP_NOT_FOUND = "offboarding.step_not_found";
export const OFFBOARDING_UNAVAILABLE = "offboarding.unavailable";

export type OffboardingJobState = "planned" | "running" | "completed" | "failed";
export type OffboardingStepState = "pending" | "running" | "succeeded" | "failed" | "skipped";

export interface OffboardingStepRecord {
  readonly jobId: string;
  readonly order: number;
  readonly action: string;
  readonly state: OffboardingStepState;
  readonly result: Record<string, unknown> | null;
  readonly error: string | null;
  readonly appliedAt: string | null;
}

export interface OffboardingJobRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly userIds: readonly string[];
  readonly options: Record<string, unknown>;
  readonly state: OffboardingJobState;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface OffboardingStore {
  createJob(input: {
    id: string;
    tenantId: string;
    userIds: readonly string[];
    options: Record<string, unknown>;
    createdBy: string;
  }): Promise<OffboardingJobRecord>;
  getJob(jobId: string): Promise<OffboardingJobRecord | undefined>;
  createSteps(jobId: string, actions: readonly string[]): Promise<readonly OffboardingStepRecord[]>;
  listSteps(jobId: string): Promise<readonly OffboardingStepRecord[]>;
  getStep(jobId: string, order: number): Promise<OffboardingStepRecord | undefined>;
  resetStep(jobId: string, order: number): Promise<OffboardingStepRecord | undefined>;
  updateJobState(jobId: string, state: OffboardingJobState): Promise<OffboardingJobRecord | undefined>;
}

export interface OffboardingQueue {
  enqueue(request: {
    jobId: string;
    tenantId: string;
    rerunOrder?: number;
  }): Promise<string>;
}

export interface OffboardingAuditEvent {
  readonly tenantId: string;
  readonly action: "users.offboard_start" | "users.offboard_rerun";
  readonly targetId: string;
  readonly result: "success";
  readonly actorUserId: string | null;
  readonly correlationId: string;
  readonly createdAt: string;
}

export interface OffboardingCaller extends Caller {
  readonly userId?: string;
}

export type OffboardingAuthorizer = (
  caller: OffboardingCaller,
  permission: string,
) => void | Promise<void>;

export interface OffboardingRequestContext extends RequestContext {
  readonly body?: unknown;
}

export interface OffboardingRouteOptions {
  readonly store: OffboardingStore;
  readonly queue: OffboardingQueue;
  readonly resolveCaller: (ctx: RequestContext) => OffboardingCaller | undefined;
  readonly authorize?: OffboardingAuthorizer;
  readonly readBody?: (ctx: OffboardingRequestContext) => unknown;
  readonly recordAudit?: (event: OffboardingAuditEvent) => Promise<void>;
  readonly idGenerator?: () => string;
  readonly now?: () => string;
}

function unauthenticatedError(): AppError {
  return new AppError(OFFBOARDING_UNAUTHENTICATED, "authentication required", 401);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => OffboardingCaller | undefined,
  ctx: RequestContext,
): OffboardingCaller {
  const caller = resolveCaller(ctx);
  if (caller === undefined) {
    throw unauthenticatedError();
  }
  return caller;
}

function requireTenantParam(ctx: RequestContext): string {
  const value = ctx.params["tenantId"];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "tenantId is required", 400, [
      { field: "tenantId", reason: "required" },
    ]);
  }
  return value.trim();
}

function readJsonBody(
  ctx: RequestContext,
  readBody: ((ctx: OffboardingRequestContext) => unknown) | undefined,
): Record<string, unknown> {
  let body = readBody ? readBody(ctx as OffboardingRequestContext) : (ctx as OffboardingRequestContext).body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      throw new AppError(ErrorCodes.validationFailed, "request body is not valid JSON", 400, [
        { field: "body", reason: "invalid_json" },
      ]);
    }
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError(ErrorCodes.validationFailed, "request body must be a JSON object", 400, [
      { field: "body", reason: "invalid" },
    ]);
  }
  return body as Record<string, unknown>;
}

function parseUserIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "userIds must be a non-empty array", 400, [
      { field: "userIds", reason: "required" },
    ]);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new AppError(ErrorCodes.validationFailed, `userIds[${index}] must be a non-empty string`, 400, [
        { field: "userIds", reason: "invalid" },
      ]);
    }
    return entry.trim();
  });
}

function toPlanError(error: unknown): AppError {
  if (error instanceof OffboardingPlanError) {
    return new AppError(ErrorCodes.validationFailed, error.message, 400, [
      { field: "options", reason: "invalid" },
    ]);
  }
  throw error;
}

export async function postOffboardingJob(
  options: OffboardingRouteOptions,
  ctx: RequestContext,
  tenantId: string,
  caller: OffboardingCaller,
): Promise<{ status: number; body: { job: OffboardingJobRecord; steps: readonly OffboardingStepRecord[] } }> {
  const body = readJsonBody(ctx, options.readBody);
  const userIds = parseUserIds(body["userIds"]);
  const rawOptions = body["options"];
  if (typeof rawOptions !== "object" || rawOptions === null || Array.isArray(rawOptions)) {
    throw new AppError(ErrorCodes.validationFailed, "options must be an object", 400, [
      { field: "options", reason: "required" },
    ]);
  }
  let plan;
  try {
    plan = buildOffboardingPlan(rawOptions as Record<string, boolean | object>);
  } catch (error) {
    throw toPlanError(error);
  }
  const generateId = options.idGenerator ?? randomUUID;
  const job = await options.store.createJob({
    id: generateId(),
    tenantId,
    userIds,
    options: { ...(rawOptions as Record<string, unknown>), mailboxAccess: plan.mailboxAccess },
    createdBy: caller.userId ?? "",
  });
  const steps = await options.store.createSteps(
    job.id,
    plan.steps.map((step) => step.action),
  );
  await options.queue.enqueue({ jobId: job.id, tenantId });
  const now = options.now ?? (() => new Date().toISOString());
  if (options.recordAudit) {
    await options.recordAudit({
      tenantId,
      action: "users.offboard_start",
      targetId: job.id,
      result: "success",
      actorUserId: caller.userId ?? null,
      correlationId: ctx.correlationId,
      createdAt: now(),
    });
  }
  return { status: 202, body: { job, steps } };
}

export async function postOffboardingRerun(
  options: OffboardingRouteOptions,
  ctx: RequestContext,
  caller: OffboardingCaller,
  jobId: string,
  orderRaw: string,
): Promise<{ status: number; body: { job: OffboardingJobRecord; step: OffboardingStepRecord } }> {
  const order = Number(orderRaw);
  if (!Number.isInteger(order) || order < 1) {
    throw new AppError(ErrorCodes.validationFailed, "order must be a positive integer", 400, [
      { field: "order", reason: "invalid" },
    ]);
  }
  const job = await options.store.getJob(jobId);
  if (!job) {
    throw new AppError(OFFBOARDING_JOB_NOT_FOUND, `offboarding job ${jobId} was not found`, 404);
  }
  requireTenantInScope(caller, job.tenantId);
  const existing = await options.store.getStep(jobId, order);
  if (!existing) {
    throw new AppError(OFFBOARDING_STEP_NOT_FOUND, `offboarding step ${order} was not found`, 404);
  }
  const step = await options.store.resetStep(jobId, order);
  if (!step) {
    throw new AppError(OFFBOARDING_STEP_NOT_FOUND, `offboarding step ${order} was not found`, 404);
  }
  await options.store.updateJobState(jobId, "running");
  await options.queue.enqueue({ jobId, tenantId: job.tenantId, rerunOrder: order });
  const now = options.now ?? (() => new Date().toISOString());
  if (options.recordAudit) {
    await options.recordAudit({
      tenantId: job.tenantId,
      action: "users.offboard_rerun",
      targetId: jobId,
      result: "success",
      actorUserId: caller.userId ?? null,
      correlationId: ctx.correlationId,
      createdAt: now(),
    });
  }
  const refreshed = await options.store.getJob(jobId);
  return { status: 202, body: { job: refreshed ?? job, step } };
}

export function createOffboardingRoutes(options: OffboardingRouteOptions): Route[] {
  const startHandler = async (ctx: RequestContext): Promise<RouteResponse> => {
    const caller = requireCaller(options.resolveCaller, ctx);
    if (options.authorize) {
      await options.authorize(caller, OFFBOARDING_PERMISSION);
    }
    const tenantId = requireTenantParam(ctx);
    requireTenantInScope(caller, tenantId);
    const result = await postOffboardingJob(options, ctx, tenantId, caller);
    return { status: result.status, body: result.body };
  };
  const progressHandler = async (ctx: RequestContext): Promise<RouteResponse> => {
    const caller = requireCaller(options.resolveCaller, ctx);
    if (options.authorize) {
      await options.authorize(caller, OFFBOARDING_PERMISSION);
    }
    const tenantId = requireTenantParam(ctx);
    requireTenantInScope(caller, tenantId);
    const jobId = ctx.params["jobId"] ?? "";
    if (jobId.trim().length === 0) {
      throw new AppError(ErrorCodes.validationFailed, "jobId is required", 400, [
        { field: "jobId", reason: "required" },
      ]);
    }
    const job = await options.store.getJob(jobId.trim());
    if (!job || job.tenantId !== tenantId) {
      throw new AppError(OFFBOARDING_JOB_NOT_FOUND, `offboarding job ${jobId} was not found`, 404);
    }
    const steps = await options.store.listSteps(job.id);
    return { status: 200, body: { job, steps: [...steps] } };
  };
  const rerunHandler = async (ctx: RequestContext): Promise<RouteResponse> => {
    const caller = requireCaller(options.resolveCaller, ctx);
    if (options.authorize) {
      await options.authorize(caller, OFFBOARDING_PERMISSION);
    }
    const jobId = ctx.params["jobId"] ?? "";
    const order = ctx.params["order"] ?? "";
    if (jobId.trim().length === 0) {
      throw new AppError(ErrorCodes.validationFailed, "jobId is required", 400, [
        { field: "jobId", reason: "required" },
      ]);
    }
    const result = await postOffboardingRerun(options, ctx, caller, jobId.trim(), order);
    return { status: result.status, body: result.body };
  };
  return [
    { method: "POST", path: OFFBOARDING_JOBS_PATH, handler: startHandler },
    { method: "GET", path: OFFBOARDING_JOB_PATH, handler: progressHandler },
    { method: "POST", path: OFFBOARDING_RERUN_PATH, handler: rerunHandler },
  ];
}

// Route modules own their OpenAPI path items (portal.v1.yaml `paths` is empty
// by design); a wiring ticket merges this fragment into the served document.
export const OFFBOARDING_OPENAPI = {
  paths: {
    "/tenants/{tenantId}/offboarding": {
      post: {
        operationId: "startOffboarding",
        summary: "Build an offboarding plan and start the run with per-step progress",
        permission: OFFBOARDING_PERMISSION,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "tenantId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "202": { description: "The job with its ordered plan of steps." },
          "400": { description: "The user list or options are invalid." },
          "401": { description: "Authentication required." },
          "403": { description: "The caller lacks users.offboard or the tenant is out of scope." },
        },
      },
    },
    "/tenants/{tenantId}/offboarding/{jobId}": {
      get: {
        operationId: "getOffboardingProgress",
        summary: "Read offboarding progress with per-step state",
        permission: OFFBOARDING_PERMISSION,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "tenantId", in: "path", required: true, schema: { type: "string" } },
          { name: "jobId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "The job with its per-step state, result, and error." },
          "404": { description: "No job with that id for the tenant." },
        },
      },
    },
    "/offboarding/{jobId}/steps/{order}/rerun": {
      post: {
        operationId: "rerunOffboardingStep",
        summary: "Re-run one failed offboarding step without re-executing applied steps",
        permission: OFFBOARDING_PERMISSION,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "jobId", in: "path", required: true, schema: { type: "string" } },
          { name: "order", in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: {
          "202": { description: "The reset step, queued for a single-step run." },
          "404": { description: "No job or step with that id." },
        },
      },
    },
  },
} as const;
