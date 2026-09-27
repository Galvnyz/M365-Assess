// Manual stage advance (EPIC-010 SPEC.md §3.4, §4.2, §6, §7; T-0186).
//
//   POST /v1/baselines/{id}/stages/{order}/advance
//
// Manual advancement first (§11.2): the operator moves a tenant once it
// satisfies the stage conditions. The move is allowed only when the tenant's
// rollout is currently marked `eligible` (T-0185 computes that marker from
// the stage conditions), so an advance never skips an unsatisfied stage.
// Requires `Tenant.Baselines.ReadWrite`; the tenant must be inside the caller's
// scope. Every advance is audited and appended as a history event through
// injected ports (the concrete history store lands in T-0188).

import { AppError, ErrorCodes } from "../errors.js";
import { requirePermission, requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { Permission } from "../rbac/roles.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";
import type { BaselineRecord } from "./baselines.js";
import type { BaselineRollout } from "../domain/baseline-rollout.js";

export const BASELINE_ADVANCE_PATH = "/v1/baselines/:baselineId/stages/:order/advance";

export const BASELINE_ADVANCE_PERMISSION = "Tenant.Baselines.ReadWrite";
export const BASELINE_ADVANCE_UNAUTHENTICATED = "request.unauthenticated";
export const BASELINE_NOT_FOUND = "baseline.not_found";
export const BASELINE_STAGE_NOT_FOUND = "baseline.stage_not_found";
export const BASELINE_ADVANCE_NOT_ELIGIBLE = "baseline.advance_not_eligible";

export interface AdvanceStore {
  getBaseline(baselineId: string): Promise<BaselineRecord | undefined>;
  getRollout(baselineId: string, tenantId: string): Promise<BaselineRollout | undefined>;
  upsertRollout(input: {
    baselineId: string;
    tenantId: string;
    stage: number;
    state: BaselineRollout["state"];
  }): Promise<BaselineRollout>;
}

export interface AdvanceAuditPort {
  record(event: Record<string, unknown>): Promise<void> | void;
}

export interface AdvanceHistoryPort {
  append(event: {
    baselineId: string;
    tenantId: string;
    event: string;
    detail: Record<string, unknown>;
    at: string;
  }): Promise<void> | void;
}

export interface AdvanceRouteOptions {
  readonly store: AdvanceStore;
  readonly resolveCaller: (ctx: RequestContext) => Caller | undefined;
  readonly authorize?: (caller: Caller, permission: string) => void | Promise<void>;
  readonly audit?: AdvanceAuditPort;
  readonly history?: AdvanceHistoryPort;
  readonly now?: () => Date;
}

export interface AdvanceRequest extends RequestContext {
  readonly body?: unknown;
}

async function ensureAuthorized(
  options: AdvanceRouteOptions,
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

function requireCaller(options: AdvanceRouteOptions, ctx: AdvanceRequest): Caller {
  const caller = options.resolveCaller(ctx);
  if (!caller) {
    throw new AppError(BASELINE_ADVANCE_UNAUTHENTICATED, "authentication required", 401);
  }
  return caller;
}

function requireParam(ctx: AdvanceRequest, name: string): string {
  const value = ctx.params[name];
  if (!value || value.length === 0) {
    throw new AppError(ErrorCodes.validationFailed, `Missing route parameter '${name}'`, 400, [
      { field: name, reason: "required" },
    ]);
  }
  return value;
}

function requireTenantId(body: unknown): string {
  const record =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  const tenantId = record?.["tenantId"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "Field 'tenantId' is required", 400, [
      { field: "tenantId", reason: "required" },
    ]);
  }
  return tenantId;
}

export function createBaselinesAdvanceRoutes(options: AdvanceRouteOptions): Route[] {
  const now = options.now ?? (() => new Date());

  async function handleAdvance(ctx: AdvanceRequest): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, BASELINE_ADVANCE_PERMISSION);

    const baselineId = requireParam(ctx, "baselineId");
    const order = Number.parseInt(requireParam(ctx, "order"), 10);
    if (!Number.isInteger(order) || order < 0) {
      throw new AppError(ErrorCodes.validationFailed, "Stage order must be a non-negative integer", 400, [
        { field: "order", reason: "invalid" },
      ]);
    }
    const tenantId = requireTenantId(ctx.body);
    requireTenantInScope(caller, tenantId);

    const baseline = await options.store.getBaseline(baselineId);
    if (!baseline) {
      throw new AppError(BASELINE_NOT_FOUND, `Baseline ${baselineId} not found`, 404);
    }
    const orders = baseline.stages.map((stage) => stage.order);
    if (!orders.includes(order)) {
      throw new AppError(BASELINE_STAGE_NOT_FOUND, `Stage ${order} not found in baseline ${baselineId}`, 404);
    }

    const rollout = await options.store.getRollout(baselineId, tenantId);
    if (!rollout || rollout.stage !== order || rollout.state !== "eligible") {
      throw new AppError(
        BASELINE_ADVANCE_NOT_ELIGIBLE,
        `Tenant ${tenantId} is not eligible to advance from stage ${order}`,
        409,
        [{ field: "stage", reason: "not_eligible" }],
      );
    }

    const at = now().toISOString();
    const hasNext = orders.some((candidate) => candidate > order);
    const advanced = await options.store.upsertRollout({
      baselineId,
      tenantId,
      stage: hasNext ? order + 1 : order,
      state: hasNext ? "active" : "complete",
    });

    if (options.audit) {
      await options.audit.record({
        action: "baseline.advance",
        tenantId,
        resourceId: baselineId,
        fromStage: order,
        toStage: advanced.stage,
        correlationId: ctx.correlationId,
      });
    }
    if (options.history) {
      await options.history.append({
        baselineId,
        tenantId,
        event: "stage.advanced",
        detail: { from: order, to: advanced.stage },
        at,
      });
    }

    return { status: 200, body: { rollout: advanced } };
  }

  return [{ method: "POST", path: BASELINE_ADVANCE_PATH, handler: handleAdvance }];
}

// ─── OpenAPI fragment (§6) ───────────────────────────────────────────────────

export const BASELINE_ADVANCE_OPENAPI = {
  "/v1/baselines/{id}/stages/{order}/advance": {
    post: {
      tags: ["Baselines"],
      operationId: "advanceBaselineStage",
      summary: "Advance an eligible tenant to the next stage.",
      permission: BASELINE_ADVANCE_PERMISSION,
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
        { name: "order", in: "path", required: true, schema: { type: "integer" } },
      ],
      responses: {
        "200": { description: "Advanced.", content: { "application/json": { schema: { $ref: "#/components/schemas/BaselineRollout" } } } },
        "404": { description: "Baseline or stage not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "409": { description: "Tenant not eligible to advance.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
} as const;
