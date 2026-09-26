// Executive drift report route (EPIC-009 SPEC.md §3.4, §4.4, §6; T-0170).
//
//   GET /v1/drift/{tenantId}/report -> counts by deviation state, top
//   deviation categories, accepted items, and remediation status.
//
// The payload is the data half of the US-8 branded report: the web
// `ExecutiveDriftReport` renders it with the EPIC-005 report theme/branding,
// and the artifact itself is produced through the EPIC-005 report pipeline
// (POST /v1/reports/render with the summary as the custom document). The
// trend series over time is a documented follow-on from EPIC-010's history
// and is not computed here. Reads require `drift.read`; tenant scope is
// enforced through the shared RBAC seam.

import { AppError, ErrorCodes } from "../errors.js";
import { requirePermission, requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { Permission } from "../rbac/roles.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";
import {
  buildDriftBreakdown,
  type DriftBreakdown,
  type DriftDeviationRecord,
  type DriftStore,
} from "./drift.js";

export const DRIFT_REPORT_PATH = "/v1/drift/:tenantId/report";

export const DRIFT_REPORT_PERMISSION = "drift.read";
export const DRIFT_REPORT_UNAUTHENTICATED = "request.unauthenticated";

/** Maximum categories returned in the top-deviation list. */
export const DRIFT_REPORT_TOP_LIMIT = 5;

export interface DriftCategoryCount {
  readonly standardKey: string;
  /** Total deviations under the standard key. */
  readonly count: number;
  /** Deviations under the key still needing triage. */
  readonly open: number;
}

export interface DriftReportRemediation {
  /** Accepted deviations carried as management-approved risk. */
  readonly accepted: number;
  /** Tenant-specific overrides in effect. */
  readonly customerSpecific: number;
  /** Denied deviations awaiting deletion on the next remediation run. */
  readonly pendingDeletion: number;
  /** Resolved deviations. */
  readonly resolved: number;
}

export interface DriftReport {
  readonly tenantId: string;
  readonly generatedAt: string;
  readonly countsByState: DriftBreakdown;
  readonly topCategories: readonly DriftCategoryCount[];
  readonly remediation: DriftReportRemediation;
  /** Trend over time; populated by EPIC-010's baseline history (not here). */
  readonly trend: null;
}

export interface DriftReportRouteOptions {
  readonly store: DriftStore;
  readonly resolveCaller: (ctx: RequestContext) => Caller | undefined;
  readonly authorize?: (caller: Caller, permission: string) => void | Promise<void>;
  readonly now?: () => Date;
}

// ─── Pure builders (shared with the web renderer) ────────────────────────────

/** Top deviation categories ordered by total count, then open count, then key. */
export function buildTopDeviationCategories(
  deviations: readonly DriftDeviationRecord[],
  limit: number = DRIFT_REPORT_TOP_LIMIT,
): DriftCategoryCount[] {
  const byStandard = new Map<string, { count: number; open: number }>();
  for (const deviation of deviations) {
    const entry = byStandard.get(deviation.standardKey) ?? { count: 0, open: 0 };
    entry.count += 1;
    if (deviation.state === "open") entry.open += 1;
    byStandard.set(deviation.standardKey, entry);
  }
  return [...byStandard.entries()]
    .map(([standardKey, counts]) => ({ standardKey, ...counts }))
    .sort(
      (left, right) =>
        right.count - left.count || right.open - left.open || left.standardKey.localeCompare(right.standardKey),
    )
    .slice(0, Math.max(0, limit));
}

export function buildDriftReport(
  tenantId: string,
  deviations: readonly DriftDeviationRecord[],
  generatedAt: string,
): DriftReport {
  const countsByState = buildDriftBreakdown(deviations);
  return {
    tenantId,
    generatedAt,
    countsByState,
    topCategories: buildTopDeviationCategories(deviations),
    remediation: {
      accepted: countsByState.accepted,
      customerSpecific: countsByState.customerSpecific,
      pendingDeletion: countsByState.deletePending,
      resolved: countsByState.resolved,
    },
    trend: null,
  };
}

// ─── Route factory ────────────────────────────────────────────────────────────

async function ensureAuthorized(
  options: DriftReportRouteOptions,
  caller: Caller,
  permission: string,
): Promise<void> {
  if (options.authorize) {
    await options.authorize(caller, permission);
    return;
  }
  // drift.* is not in the roles.ts union yet (EPIC-038); deny without a seam.
  requirePermission(caller, permission as Permission);
}

function requireCaller(options: DriftReportRouteOptions, ctx: RequestContext): Caller {
  const caller = options.resolveCaller(ctx);
  if (!caller) {
    throw new AppError(DRIFT_REPORT_UNAUTHENTICATED, "authentication required", 401);
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

export function createDriftReportRoutes(options: DriftReportRouteOptions): Route[] {
  const now = options.now ?? (() => new Date());

  async function handleReport(ctx: RequestContext): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, DRIFT_REPORT_PERMISSION);
    const tenantId = requireParam(ctx, "tenantId");
    requireTenantInScope(caller, tenantId);

    const deviations = await options.store.listDeviations(tenantId);
    return {
      status: 200,
      body: buildDriftReport(tenantId, deviations, now().toISOString()),
    };
  }

  return [{ method: "GET", path: DRIFT_REPORT_PATH, handler: handleReport }];
}

// ─── OpenAPI fragment (§6) ───────────────────────────────────────────────────

export const DRIFT_REPORT_OPENAPI = {
  "/v1/drift/{tenantId}/report": {
    get: {
      tags: ["Drift"],
      operationId: "getDriftReport",
      summary: "Executive drift summary: counts by state and top categories.",
      permission: DRIFT_REPORT_PERMISSION,
      security: [{ bearerAuth: [] }],
      parameters: [{ name: "tenantId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "Drift report payload.", content: { "application/json": { schema: { $ref: "#/components/schemas/DriftReport" } } } },
        "401": { description: "Unauthenticated.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "403": { description: "Forbidden or tenant out of scope.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
} as const;
