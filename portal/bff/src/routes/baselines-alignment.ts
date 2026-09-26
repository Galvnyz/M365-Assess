// Baseline alignment (EPIC-010 SPEC.md §3.4, §6; T-0809).
//
//   GET /v1/baselines/{id}/alignment -> stage progress, run events, trend.
//
// Stage progress aggregates the T-0185 rollout rows per stage; run events
// read the T-0188 append-only history newest-first (never mutated here);
// trend points feed the T-0188 fleet chart. Rows are filtered to the
// caller's tenant scope (read-model intersection). Requires `baselines.read`.
//
// Route ordering matters: this static-suffix path sits under the
// `/v1/baselines/:baselineId` detail route, so routers matching
// first-match-wins must register this path before the detail route.

import { AppError, ErrorCodes } from "../errors.js";
import {
  requirePermission,
  type Caller,
} from "../rbac/authorize.js";
import { isTenantAllowed } from "../rbac/scope.js";
import type { Permission } from "../rbac/roles.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";
import type { BaselineRecord } from "./baselines.js";
import type { BaselineRollout } from "../domain/baseline-rollout.js";
import type { HistoryEvent, TrendPoint } from "../domain/baseline-history.js";

export const BASELINE_ALIGNMENT_PATH = "/v1/baselines/:baselineId/alignment";

export const BASELINE_ALIGNMENT_PERMISSION = "baselines.read";
export const BASELINE_ALIGNMENT_UNAUTHENTICATED = "request.unauthenticated";
export const BASELINE_NOT_FOUND = "baseline.not_found";

export interface StageProgress {
  readonly order: number;
  readonly action: "report" | "remediate";
  readonly conditions: number;
  readonly tenants: number;
  readonly complete: number;
  readonly eligible: number;
  readonly active: number;
}

export interface BaselineAlignment {
  readonly baselineId: string;
  readonly stages: readonly StageProgress[];
  readonly rollouts: readonly BaselineRollout[];
  readonly runEvents: readonly HistoryEvent[];
  readonly trend: readonly TrendPoint[];
}

export interface AlignmentStore {
  getBaseline(baselineId: string): Promise<BaselineRecord | undefined>;
  listRollouts(baselineId: string): Promise<readonly BaselineRollout[]>;
  listHistory(baselineId: string, limit: number): Promise<readonly HistoryEvent[]>;
  listTrend(baselineId: string): Promise<readonly TrendPoint[]>;
}

export interface AlignmentRouteOptions {
  readonly store: AlignmentStore;
  readonly resolveCaller: (ctx: RequestContext) => Caller | undefined;
  readonly authorize?: (caller: Caller, permission: string) => void | Promise<void>;
  readonly defaultEventLimit?: number;
}

export const ALIGNMENT_DEFAULT_EVENT_LIMIT = 100;
export const ALIGNMENT_MAX_EVENT_LIMIT = 500;

// ─── Pure builders ────────────────────────────────────────────────────────────

export function buildStageProgress(
  baseline: BaselineRecord,
  rollouts: readonly BaselineRollout[],
): StageProgress[] {
  return baseline.stages.map((stage) => {
    const atStage = rollouts.filter((rollout) => rollout.stage === stage.order);
    const count = (state: BaselineRollout["state"]): number =>
      atStage.filter((rollout) => rollout.state === state).length;
    return {
      order: stage.order,
      action: stage.action,
      conditions: stage.conditions.length,
      tenants: atStage.length,
      complete: count("complete"),
      eligible: count("eligible"),
      active: count("active"),
    };
  });
}

// ─── Route factory ────────────────────────────────────────────────────────────

async function ensureAuthorized(
  options: AlignmentRouteOptions,
  caller: Caller,
  permission: string,
): Promise<void> {
  if (options.authorize) {
    await options.authorize(caller, permission);
    return;
  }
  // baselines.* is not in the roles.ts union yet (EPIC-038); deny without a seam.
  requirePermission(caller, permission as Permission);
}

function requireCaller(options: AlignmentRouteOptions, ctx: RequestContext): Caller {
  const caller = options.resolveCaller(ctx);
  if (!caller) {
    throw new AppError(BASELINE_ALIGNMENT_UNAUTHENTICATED, "authentication required", 401);
  }
  return caller;
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

function parseLimit(ctx: RequestContext, fallback: number): number {
  const raw = ctx.query.get("limit");
  if (raw === null || raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new AppError(ErrorCodes.validationFailed, "Query 'limit' must be a positive integer", 400, [
      { field: "limit", reason: "invalid" },
    ]);
  }
  return Math.min(parsed, ALIGNMENT_MAX_EVENT_LIMIT);
}

export function createBaselinesAlignmentRoutes(options: AlignmentRouteOptions): Route[] {
  async function handleAlignment(ctx: RequestContext): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, BASELINE_ALIGNMENT_PERMISSION);
    const baselineId = requireParam(ctx, "baselineId");

    const baseline = await options.store.getBaseline(baselineId);
    if (!baseline) {
      throw new AppError(BASELINE_NOT_FOUND, `Baseline ${baselineId} not found`, 404);
    }

    const inScope = (tenantId: string): boolean => isTenantAllowed(caller.tenantScope, tenantId);
    const limit = parseLimit(ctx, options.defaultEventLimit ?? ALIGNMENT_DEFAULT_EVENT_LIMIT);
    const [rollouts, events, trend] = await Promise.all([
      options.store.listRollouts(baselineId),
      options.store.listHistory(baselineId, limit),
      options.store.listTrend(baselineId),
    ]);

    const scopedRollouts = rollouts.filter((rollout) => inScope(rollout.tenantId));
    const scopedEvents = events.filter((event) => inScope(event.tenantId));
    const scopedTrend = trend.filter((point) => inScope(point.tenantId));
    const tenantFilter = ctx.query.get("tenantId");
    const filteredRollouts =
      tenantFilter === null || tenantFilter === undefined || tenantFilter === ""
        ? scopedRollouts
        : scopedRollouts.filter((rollout) => rollout.tenantId === tenantFilter);

    const alignment: BaselineAlignment = {
      baselineId,
      stages: buildStageProgress(baseline, filteredRollouts),
      rollouts: filteredRollouts,
      runEvents: scopedEvents,
      trend: scopedTrend,
    };
    return { status: 200, body: alignment };
  }

  return [{ method: "GET", path: BASELINE_ALIGNMENT_PATH, handler: handleAlignment }];
}

// ─── OpenAPI fragment (§6) ───────────────────────────────────────────────────

export const BASELINE_ALIGNMENT_OPENAPI = {
  "/v1/baselines/{id}/alignment": {
    get: {
      tags: ["Baselines"],
      operationId: "getBaselineAlignment",
      summary: "Stage progress, run events, and trend points.",
      permission: BASELINE_ALIGNMENT_PERMISSION,
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
        { name: "tenantId", in: "query", required: false, schema: { type: "string" } },
        { name: "limit", in: "query", required: false, schema: { type: "integer" } },
      ],
      responses: {
        "200": { description: "Alignment.", content: { "application/json": { schema: { $ref: "#/components/schemas/BaselineAlignment" } } } },
        "401": { description: "Unauthenticated.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "404": { description: "Baseline not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
} as const;
