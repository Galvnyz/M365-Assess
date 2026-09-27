// Remediation plan and apply API (EPIC-006 SPEC.md §4.1, §4.3, §5, §6; T-0105, T-0108).
//
// Architecture (ADR-0014): plan generation and gated apply are domain work, so
// both are enqueued as `remediation` jobs for the PowerShell workers
// (Plan-Remediation.ps1, Invoke-RemediationApply.ps1). These routes validate
// RBAC/tenant scope, enqueue the job, and serve persisted state; they perform no
// tenant writes themselves. Apply additionally requires an Idempotency-Key so a
// retry replays the prior handle instead of enqueuing a second apply.
//
// Persistence is injected as structural seams (RemediationPlanStore) so the
// routes stay free of the SQL implementation. The BFF package depends only on
// @m365-assess/contracts, so records are declared locally and structurally
// mirror the db package's RemediationPlan/RemediationAction.
//
// Permissions (EPIC-038 taxonomy, T-0816): `Remediation.Plan.Read` for reads,
// `Remediation.Plan` for generating and verifying plans, `Remediation.Apply` for
// apply. Plan and Apply are admin-only by default: neither is a Read/ReadWrite
// action, so the readonly and editor base roles do not grant them. Callers supply
// the `authorize` seam.

import { randomUUID } from "node:crypto";
import type { JobEnvelope } from "@m365-assess/contracts";
import { AppError, ErrorCodes } from "../errors.js";
import { paginate, parsePagination } from "../pagination.js";
import {
  requirePermission,
  requireTenantInScope,
  type Caller,
} from "../rbac/authorize.js";
import type { Permission } from "../rbac/roles.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";
import {
  MAX_IDEMPOTENCY_KEY_LENGTH,
  RemediationApplyInputError,
  createMemoryRemediationIdempotencyStore,
  parseRemediationApplyBody,
  parseRemediationIdempotencyKey,
  type RemediationApplyHandle,
  type RemediationIdempotencyStore,
} from "../domain/remediation/apply.js";

// ─── Paths, permissions, error codes ─────────────────────────────────────────

export const REMEDIATION_PLANS_PATH = "/v1/remediation/plans";
export const REMEDIATION_PLAN_DETAIL_PATH = "/v1/remediation/plans/:planId";
export const REMEDIATION_APPLY_PATH = "/v1/remediation/plans/:planId/apply";
export const REMEDIATION_HISTORY_PATH = "/v1/remediation/history";
export const REMEDIATION_VERIFY_PATH = "/v1/remediation/actions/:actionId/verify";
export const REMEDIATION_INSTRUCTION_PATH = "/v1/remediation/instructions/:check";

export const REMEDIATION_PERMISSIONS = {
  read: "Remediation.Plan.Read",
  plan: "Remediation.Plan",
  apply: "Remediation.Apply",
  verify: "Remediation.Plan",
} as const;

export const REMEDIATION_UNAUTHENTICATED = "request.unauthenticated";
export const REMEDIATION_PLAN_NOT_FOUND = "remediation.plan_not_found";
export const REMEDIATION_ACTION_NOT_FOUND = "remediation.action_not_found";
export const REMEDIATION_NO_RUN = "remediation.no_run";
export const REMEDIATION_HISTORY_TENANT_REQUIRED = "remediation.history_tenant_required";

// ─── Records (structural mirrors of the db package types) ────────────────────

export type RemediationPlanMode = "manual" | "automated" | "mixed";
export type RemediationActionState =
  | "planned"
  | "approved"
  | "applied"
  | "failed"
  | "skipped";

export interface RemediationPlanRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly runId: string;
  readonly findingIds: readonly string[];
  readonly mode: RemediationPlanMode;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface RemediationActionRecord {
  readonly id: string;
  readonly planId: string;
  // Named `check`: the thin-BFF guard forbids the collector-construct identifier
  // in portal/bff source, so the concrete db adapter maps the entity field onto it.
  readonly check: string;
  readonly command: string;
  readonly target: string | null;
  readonly state: RemediationActionState;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  readonly appliedAt: string | null;
  readonly appliedBy: string | null;
  readonly result: Record<string, unknown> | null;
  readonly error: string | null;
  readonly correlationId: string | null;
}

// ─── Dependency seams ─────────────────────────────────────────────────────────

export interface ManualInstructionRecord {
  readonly check: string;
  readonly portalPath: string;
  readonly steps: readonly string[];
  readonly notes: string | null;
}

export interface RemediationPlanStore {
  getRemediationPlan(planId: string): Promise<RemediationPlanRecord | undefined>;
  listRemediationActions(planId: string): Promise<readonly RemediationActionRecord[]>;
  /** Single action lookup for verify (optional seam). */
  getRemediationAction?(actionId: string): Promise<RemediationActionRecord | undefined>;
  /** Tenant-wide action listing for the history view (optional seam). */
  listRemediationActionsForTenant?(tenantId: string): Promise<readonly RemediationActionRecord[]>;
  /** Materialized manual instruction lookup (optional seam, T-0106). */
  getManualInstruction?(check: string): Promise<ManualInstructionRecord | undefined>;
}

export interface RemediationQueue {
  enqueue(envelope: JobEnvelope): Promise<string>;
}

export interface RemediationRouteOptions {
  readonly store: RemediationPlanStore;
  readonly queue: RemediationQueue;
  readonly resolveCaller: (ctx: RequestContext) => Caller | undefined;
  readonly authorize?: (caller: Caller, permission: string) => void | Promise<void>;
  readonly idempotency?: RemediationIdempotencyStore;
  readonly idGenerator?: () => string;
  readonly now?: () => string;
  /** The tenant's latest finished run, used when a plan request names no run. */
  readonly latestRunId?: (tenantId: string) => Promise<string | null>;
}

/** Route context carrying the parsed request body (see reports.ts). */
export interface RemediationRequest extends RequestContext {
  readonly body?: unknown;
}

export interface RemediationRoute extends Route {
  readonly handler: (ctx: RemediationRequest) => RouteResponse | Promise<RouteResponse>;
}

// ─── Response mapping ─────────────────────────────────────────────────────────

function mapAction(action: RemediationActionRecord): Record<string, unknown> {
  // mode is the two-value view the UI keys off (auto/manual). The richer
  // three-value classification (automated/manual/undetermined) rides along so
  // triage items are not lost.
  const classification =
    action.result && typeof action.result["mode"] === "string"
      ? (action.result["mode"] as string)
      : action.command
        ? "automated"
        : "manual";

  return {
    id: action.id,
    check: action.check,
    command: action.command,
    target: action.target,
    mode: action.command ? "auto" : "manual",
    classification,
    state: action.state,
    before: action.before,
    after: action.after,
    appliedAt: action.appliedAt,
    appliedBy: action.appliedBy,
    result: action.result,
    error: action.error,
  };
}

function mapPlan(plan: RemediationPlanRecord): Record<string, unknown> {
  return {
    id: plan.id,
    tenantId: plan.tenantId,
    runId: plan.runId,
    findingIds: plan.findingIds,
    mode: plan.mode,
    createdAt: plan.createdAt,
    createdBy: plan.createdBy,
  };
}

// Append-only remediation log columns (06-remediation.md §5, T-0113): timestamp,
// actor, tenant, check, command, before -> after, result, correlation id.
function mapHistoryRow(action: RemediationActionRecord): Record<string, unknown> {
  return {
    id: action.id,
    planId: action.planId,
    check: action.check,
    command: action.command,
    target: action.target,
    state: action.state,
    before: action.before,
    after: action.after,
    timestamp: action.appliedAt,
    actor: action.appliedBy,
    result: action.result,
    error: action.error,
    correlationId: action.correlationId,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toAppError(error: unknown, fallbackField: string): AppError {
  if (error instanceof RemediationApplyInputError) {
    return new AppError(error.code, error.message, 400, [{ field: fallbackField, reason: "invalid" }]);
  }
  throw error;
}

async function isAuthorized(
  options: RemediationRouteOptions,
  caller: Caller,
  permission: string,
): Promise<boolean> {
  try {
    await ensureAuthorized(options, caller, permission);
    return true;
  } catch (error) {
    if (error instanceof AppError && error.status === 403) return false;
    throw error;
  }
}

async function ensureAuthorized(
  options: RemediationRouteOptions,
  caller: Caller,
  permission: string,
): Promise<void> {
  if (options.authorize) {
    await options.authorize(caller, permission);
    return;
  }
  // The remediation tokens are not members of the roles.ts Permission union yet
  // (EPIC-038 wires the full taxonomy). Without an authorize seam a caller is
  // denied, which is the safe default for a write-adjacent endpoint.
  requirePermission(caller, permission as Permission);
}

function requireBodyRecord(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string" ? safeParse(value) : value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AppError(ErrorCodes.validationFailed, "Request body must be a JSON object", 400, [
      { field: "body", reason: "invalid" },
    ]);
  }
  return parsed as Record<string, unknown>;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new AppError(ErrorCodes.validationFailed, "Request body is not valid JSON", 400, [
      { field: "body", reason: "invalid_json" },
    ]);
  }
}

function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new AppError(ErrorCodes.validationFailed, `Missing required string field '${field}'`, 400, [
      { field, reason: "required" },
    ]);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new AppError(ErrorCodes.validationFailed, `Field '${field}' must be a string`, 400, [
      { field, reason: "invalid" },
    ]);
  }
  return value;
}

function requireParam(ctx: RequestContext, name: string): string {
  const value = ctx.params[name];
  if (!value || value.length === 0) {
    throw new AppError(ErrorCodes.validationFailed, `Missing route parameter '${name}'`, 400, [
      { field: name, reason: "required" },
    ]);
  }
  return value;
}

export type RemediationOperation = "plan" | "apply" | "verify";

// Each job gets its own folder: the run's folder holds the assessment's artifacts and
// result.json, which a remediation job's result must not overwrite.
function buildRemediationEnvelope(
  ctx: RequestContext,
  operation: RemediationOperation,
  tenantId: string,
  runId: string,
  jobId: string,
  requestId: string,
  createdAt: string,
  extraPayload: Record<string, unknown> = {},
): JobEnvelope {
  return {
    schemaVersion: "v1",
    jobId,
    jobType: "remediation",
    tenantId,
    runId,
    requestId,
    correlationId: ctx.correlationId,
    createdAt,
    payload: {
      contextRef: `remediation/${tenantId}/${jobId}/job.json`,
      outputRef: `remediation/${tenantId}/${jobId}`,
      credentialRef: `tenants/${tenantId}/credential`,
      sectionRefs: [],
      artifactRefs: [],
      // Job-specific fields ride alongside the reference payload; the envelope
      // contract validates the refs and permits additional keys.
      ...{ operation, ...extraPayload },
    },
  };
}

// ─── Route factory ────────────────────────────────────────────────────────────

export function createRemediationRoutes(options: RemediationRouteOptions): RemediationRoute[] {
  const idGenerator = options.idGenerator ?? (() => randomUUID());
  const now = options.now ?? (() => new Date().toISOString());
  // Single store per route set so Idempotency-Key replay works across requests.
  const idempotency = options.idempotency ?? createMemoryRemediationIdempotencyStore();

  // POST /v1/remediation/plans — enqueue plan generation for a run/tenant.
  async function handlePostPlan(ctx: RemediationRequest): Promise<RouteResponse> {
    const caller = options.resolveCaller(ctx);
    if (!caller) {
      throw new AppError(REMEDIATION_UNAUTHENTICATED, "authentication required", 401);
    }
    await ensureAuthorized(options, caller, REMEDIATION_PERMISSIONS.plan);

    const body = requireBodyRecord(ctx.body);
    const tenantId = requireString(body, "tenantId");
    requireTenantInScope(caller, tenantId);
    const runId = optionalString(body, "runId") ?? (await options.latestRunId?.(tenantId)) ?? null;
    if (!runId) {
      throw new AppError(
        REMEDIATION_NO_RUN,
        `tenant ${tenantId} has no finished run to plan remediation from`,
        409,
      );
    }

    const planId = idGenerator();
    const jobId = idGenerator();
    const requestId = idGenerator();

    // The plan worker's gate marks an action planned only for a caller who may apply
    // it (Test-RemediationGate), so the caller's apply right and scope travel with it.
    const canApply = await isAuthorized(options, caller, REMEDIATION_PERMISSIONS.apply);
    await options.queue.enqueue(
      buildRemediationEnvelope(ctx, "plan", tenantId, runId, jobId, requestId, now(), {
        planId,
        createdBy: callerActor(caller) ?? "system",
        caller: {
          canApply,
          tenantScope: { all: caller.tenantScope.all, tenantIds: [...caller.tenantScope.tenantIds] },
        },
      }),
    );

    return {
      status: 202,
      body: { planId, jobId, tenantId, runId, status: "queued" },
    };
  }

  // GET /v1/remediation/plans/:planId — plan plus one action per finding.
  async function handleGetPlan(ctx: RemediationRequest): Promise<RouteResponse> {
    const caller = options.resolveCaller(ctx);
    if (!caller) {
      throw new AppError(REMEDIATION_UNAUTHENTICATED, "authentication required", 401);
    }
    await ensureAuthorized(options, caller, REMEDIATION_PERMISSIONS.read);

    const planId = requireParam(ctx, "planId");
    const plan = await options.store.getRemediationPlan(planId);
    if (!plan) {
      throw new AppError(REMEDIATION_PLAN_NOT_FOUND, `Remediation plan ${planId} not found`, 404);
    }
    requireTenantInScope(caller, plan.tenantId);

    const actions = await options.store.listRemediationActions(planId);

    return {
      status: 200,
      body: {
        plan: mapPlan(plan),
        actions: actions.map(mapAction),
      },
    };
  }

  // POST /v1/remediation/plans/:planId/apply — gated apply, Idempotency-Key
  // required. Enqueues the apply worker and returns a replayable handle.
  async function handlePostApply(ctx: RemediationRequest): Promise<RouteResponse> {
    const caller = options.resolveCaller(ctx);
    if (!caller) {
      throw new AppError(REMEDIATION_UNAUTHENTICATED, "authentication required", 401);
    }
    await ensureAuthorized(options, caller, REMEDIATION_PERMISSIONS.apply);

    const planId = requireParam(ctx, "planId");

    let idempotencyKey: string;
    try {
      idempotencyKey = parseRemediationIdempotencyKey(ctx.headers["idempotency-key"]);
    } catch (error) {
      throw toAppError(error, "Idempotency-Key");
    }

    const body = requireBodyRecord(ctx.body);
    let parsed;
    try {
      parsed = parseRemediationApplyBody(body);
    } catch (error) {
      throw toAppError(error, "dryRun");
    }

    const plan = await options.store.getRemediationPlan(planId);
    if (!plan) {
      throw new AppError(REMEDIATION_PLAN_NOT_FOUND, `Remediation plan ${planId} not found`, 404);
    }
    requireTenantInScope(caller, plan.tenantId);

    const prior = await idempotency.find(plan.tenantId, idempotencyKey);
    if (prior) {
      // Replay: return the original handle without enqueuing a second apply.
      return { status: 200, body: { ...prior, replayed: true } };
    }

    const jobId = idGenerator();
    const requestId = idGenerator();

    await options.queue.enqueue(
      buildRemediationEnvelope(ctx, "apply", plan.tenantId, plan.runId, jobId, requestId, now(), {
        planId,
        actionIds: parsed.actionIds,
        dryRun: parsed.dryRun,
        continueOnFailure: parsed.continueOnFailure,
        reason: parsed.reason,
        idempotencyKey,
        actor: callerActor(caller),
      }),
    );

    const handle: RemediationApplyHandle = {
      planId,
      tenantId: plan.tenantId,
      jobId,
      requestId,
      dryRun: parsed.dryRun,
      status: "queued",
    };
    await idempotency.save(plan.tenantId, idempotencyKey, handle);

    return { status: 202, body: { ...handle } };
  }

  // GET /v1/remediation/history — append-only, tenant-scoped, cursor paginated.
  async function handleGetHistory(ctx: RemediationRequest): Promise<RouteResponse> {
    const caller = options.resolveCaller(ctx);
    if (!caller) {
      throw new AppError(REMEDIATION_UNAUTHENTICATED, "authentication required", 401);
    }
    await ensureAuthorized(options, caller, REMEDIATION_PERMISSIONS.read);

    const tenantId = ctx.query.get("tenantId");
    if (!tenantId) {
      throw new AppError(
        REMEDIATION_HISTORY_TENANT_REQUIRED,
        "Query parameter 'tenantId' is required for remediation history",
        400,
      );
    }
    requireTenantInScope(caller, tenantId);

    if (!options.store.listRemediationActionsForTenant) {
      throw new AppError(
        ErrorCodes.internalError,
        "remediation history store is not configured",
        500,
      );
    }

    const actions = await options.store.listRemediationActionsForTenant(tenantId);
    const pag = parsePagination(ctx.query);
    const page = paginate(actions, pag);

    return {
      status: 200,
      body: { ...page, items: page.items.map(mapHistoryRow) },
    };
  }

  // POST /v1/remediation/actions/:actionId/verify — re-run the collector and
  // re-evaluate the finding (SPEC §4.4). Enqueues the verify worker job.
  async function handlePostVerify(ctx: RemediationRequest): Promise<RouteResponse> {
    const caller = options.resolveCaller(ctx);
    if (!caller) {
      throw new AppError(REMEDIATION_UNAUTHENTICATED, "authentication required", 401);
    }
    await ensureAuthorized(options, caller, REMEDIATION_PERMISSIONS.verify);

    const actionId = requireParam(ctx, "actionId");
    if (!options.store.getRemediationAction) {
      throw new AppError(
        ErrorCodes.internalError,
        "remediation action store is not configured",
        500,
      );
    }
    const action = await options.store.getRemediationAction(actionId);
    if (!action) {
      throw new AppError(REMEDIATION_ACTION_NOT_FOUND, `Remediation action ${actionId} not found`, 404);
    }
    const plan = await options.store.getRemediationPlan(action.planId);
    if (!plan) {
      throw new AppError(REMEDIATION_PLAN_NOT_FOUND, `Remediation plan ${action.planId} not found`, 404);
    }
    requireTenantInScope(caller, plan.tenantId);

    const body = requireBodyRecord(ctx.body);
    const section = optionalString(body, "section") ?? "";
    const jobId = idGenerator();
    const requestId = idGenerator();

    await options.queue.enqueue(
      buildRemediationEnvelope(ctx, "verify", plan.tenantId, plan.runId, jobId, requestId, now(), {
        actionId,
        check: action.check,
        section,
        actor: callerActor(caller),
      }),
    );

    return {
      status: 202,
      body: { actionId, jobId, tenantId: plan.tenantId, status: "queued" },
    };
  }

  // GET /v1/remediation/instructions/:check — manual instruction for a check
  // (SPEC §4.2). Docs override the registry; an unresolved check returns the
  // empty-state marker so the UI can render "no instructions".
  async function handleGetInstruction(ctx: RemediationRequest): Promise<RouteResponse> {
    const caller = options.resolveCaller(ctx);
    if (!caller) {
      throw new AppError(REMEDIATION_UNAUTHENTICATED, "authentication required", 401);
    }
    await ensureAuthorized(options, caller, REMEDIATION_PERMISSIONS.read);

    const requested = requireParam(ctx, "check");
    const registryKey = requested.replace(/\.\d+$/, "");

    const store = options.store;
    if (!store.getManualInstruction) {
      throw new AppError(
        ErrorCodes.internalError,
        "remediation instruction store is not configured",
        500,
      );
    }

    // Sub-numbered ids resolve to the same instruction as their base id.
    // Call through the store so the method keeps its `this` binding.
    const instruction =
      (await store.getManualInstruction(registryKey)) ??
      (await store.getManualInstruction(requested));

    if (!instruction) {
      return {
        status: 200,
        body: { check: requested, found: false, portalPath: null, steps: [], notes: null },
      };
    }

    return {
      status: 200,
      body: {
        check: requested,
        found: true,
        portalPath: instruction.portalPath,
        steps: instruction.steps,
        notes: instruction.notes,
      },
    };
  }

  return [
    { method: "POST", path: REMEDIATION_PLANS_PATH, handler: handlePostPlan },
    { method: "GET", path: REMEDIATION_PLAN_DETAIL_PATH, handler: handleGetPlan },
    { method: "POST", path: REMEDIATION_APPLY_PATH, handler: handlePostApply },
    { method: "GET", path: REMEDIATION_HISTORY_PATH, handler: handleGetHistory },
    { method: "POST", path: REMEDIATION_VERIFY_PATH, handler: handlePostVerify },
    { method: "GET", path: REMEDIATION_INSTRUCTION_PATH, handler: handleGetInstruction },
  ];
}

/** Actor id for the job payload; the authorizer seam owns identity. */
function callerActor(caller: Caller): string | null {
  const withId = caller as Caller & { actorUserId?: unknown; userId?: unknown };
  if (typeof withId.actorUserId === "function") {
    return (withId.actorUserId as () => string | null)() ?? null;
  }
  return typeof withId.userId === "string" ? withId.userId : null;
}

// ─── OpenAPI fragment (paths published by the route module, §6) ──────────────

export const REMEDIATION_OPENAPI = {
  "/v1/remediation/plans": {
    post: {
      tags: ["Remediation"],
      operationId: "createRemediationPlan",
      summary: "Generate a remediation plan for a run; no tenant writes.",
      permission: REMEDIATION_PERMISSIONS.plan,
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/RemediationPlanCreateRequest" },
          },
        },
      },
      responses: {
        "202": {
          description: "Plan generation enqueued.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RemediationPlanQueuedResponse" },
            },
          },
        },
        "400": { description: "Invalid body.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "401": { description: "Unauthenticated.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "403": { description: "Forbidden or tenant out of scope.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
  "/v1/remediation/plans/{planId}": {
    get: {
      tags: ["Remediation"],
      operationId: "getRemediationPlan",
      summary: "Read a remediation plan and its actions.",
      permission: REMEDIATION_PERMISSIONS.read,
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: "planId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          description: "Plan with one action per selected finding.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RemediationPlanResponse" },
            },
          },
        },
        "401": { description: "Unauthenticated.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "403": { description: "Forbidden or tenant out of scope.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "404": { description: "Plan not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
  "/v1/remediation/plans/{planId}/apply": {
    post: {
      tags: ["Remediation"],
      operationId: "applyRemediationPlan",
      summary: "Apply selected plan actions (gated); Idempotency-Key required.",
      permission: REMEDIATION_PERMISSIONS.apply,
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: "planId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "Idempotency-Key",
          in: "header",
          required: true,
          schema: { type: "string", maxLength: MAX_IDEMPOTENCY_KEY_LENGTH },
          description: "Required. A repeated key replays the prior apply handle.",
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/RemediationApplyRequest" },
          },
        },
      },
      responses: {
        "202": {
          description: "Apply enqueued.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RemediationApplyHandle" },
            },
          },
        },
        "200": {
          description: "Replay of an Idempotency-Key: the original apply handle.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RemediationApplyHandle" },
            },
          },
        },
        "400": { description: "Missing Idempotency-Key or invalid body.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "401": { description: "Unauthenticated.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "403": { description: "Forbidden or tenant out of scope.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "404": { description: "Plan not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
  "/v1/remediation/history": {
    get: {
      tags: ["Remediation"],
      operationId: "getRemediationHistory",
      summary: "Tenant-wide append-only remediation log (cursor paginated).",
      permission: REMEDIATION_PERMISSIONS.read,
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: "tenantId", in: "query", required: true, schema: { type: "string" } },
        { name: "cursor", in: "query", required: false, schema: { type: "string" } },
        { name: "limit", in: "query", required: false, schema: { type: "integer" } },
      ],
      responses: {
        "200": {
          description: "Append-only remediation history.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CursorPage" },
            },
          },
        },
        "400": { description: "Missing tenantId.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "401": { description: "Unauthenticated.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "403": { description: "Forbidden or tenant out of scope.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
  "/v1/remediation/instructions/{check}": {
    get: {
      tags: ["Remediation"],
      operationId: "getRemediationInstruction",
      summary: "Manual instruction for a check (docs override the registry).",
      permission: REMEDIATION_PERMISSIONS.read,
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: "check",
          in: "path",
          required: true,
          schema: { type: "string" },
          description: "Finding check id; a trailing sub-number is stripped.",
        },
      ],
      responses: {
        "200": {
          description: "Instruction (or an empty-state marker when none is defined).",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RemediationInstructionResponse" },
            },
          },
        },
        "401": { description: "Unauthenticated.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "403": { description: "Forbidden.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
  "/v1/remediation/actions/{actionId}/verify": {
    post: {
      tags: ["Remediation"],
      operationId: "verifyRemediationAction",
      summary: "Re-run the collector and re-evaluate the finding (verify).",
      permission: REMEDIATION_PERMISSIONS.verify,
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: "actionId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "202": {
          description: "Verify enqueued.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RemediationVerifyQueuedResponse" },
            },
          },
        },
        "401": { description: "Unauthenticated.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "403": { description: "Forbidden or tenant out of scope.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "404": { description: "Action or plan not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
} as const;
