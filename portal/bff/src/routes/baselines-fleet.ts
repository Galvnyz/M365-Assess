// Baselines fleet overview (EPIC-010 SPEC.md §3.1, §6; T-0187).
//
//   GET /v1/baselines/fleet -> fleet compliance, deviation-state counts
//   (shared EPIC-009 vocabulary), and tenants needing attention.
//
// Tenants need attention when they carry open deviations or sit in a
// non-advanced rollout stage. The Fleet Compliance Trend chart is
// contributed by T-0188; this payload leaves the trend to that ticket and
// the page renders a container for it. Requires `Tenant.Baselines.Read`.
//
// Route ordering matters: `/v1/baselines/fleet` is a static path at the same
// depth as `/v1/baselines/:baselineId`, so it must be registered before the
// detail route where the matcher is first-match-wins.

import { AppError } from "../errors.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";
import { requirePermission, type Caller } from "../rbac/authorize.js";
import type { Permission } from "../rbac/roles.js";
import type { BaselineRecord } from "./baselines.js";
import type { BaselineRollout } from "../domain/baseline-rollout.js";

export const BASELINES_FLEET_PATH = "/v1/baselines/fleet";

export const BASELINES_FLEET_PERMISSION = "Tenant.Baselines.Read";
export const BASELINES_FLEET_UNAUTHENTICATED = "request.unauthenticated";

export interface FleetDeviationStates {
  readonly open: number;
  readonly accepted: number;
  readonly customerSpecific: number;
  readonly denied: number;
  readonly deletePending: number;
  readonly resolved: number;
  readonly total: number;
}

export interface FleetBaselineRow {
  readonly id: string;
  readonly name: string;
  readonly stages: number;
  readonly assignedTenants: number;
  /** Share of assigned tenants in the `complete` rollout state (0-1). */
  readonly fleetCompliance: number;
  readonly lastRunAt: string | null;
}

export interface TenantNeedingAttention {
  readonly tenantId: string;
  readonly baselineId: string;
  readonly stage: number;
  readonly state: BaselineRollout["state"];
  readonly openDeviations: number;
}

export interface FleetOverview {
  readonly baselines: readonly FleetBaselineRow[];
  readonly deviationStates: FleetDeviationStates;
  readonly needsAttention: readonly TenantNeedingAttention[];
  readonly acceptedDenied: { readonly accepted: number; readonly denied: number };
}

export interface FleetStore {
  listBaselines(): Promise<readonly BaselineRecord[]>;
  /** Every rollout row across tenants. */
  listRollouts(): Promise<readonly BaselineRollout[]>;
  /** Aggregate deviation counts in the shared EPIC-009 vocabulary. */
  countDeviationsByState(): Promise<FleetDeviationStates>;
  /** Open (untriaged) deviation counts keyed by tenant. */
  openDeviationsByTenant(): Promise<Readonly<Record<string, number>>>;
}

export interface FleetRouteOptions {
  readonly store: FleetStore;
  readonly resolveCaller: (ctx: RequestContext) => Caller | undefined;
  readonly authorize?: (caller: Caller, permission: string) => void | Promise<void>;
}

// ─── Pure builders ────────────────────────────────────────────────────────────

export function buildFleetBaselineRows(
  baselines: readonly BaselineRecord[],
  rollouts: readonly BaselineRollout[],
): FleetBaselineRow[] {
  return baselines.map((baseline) => {
    const rows = rollouts.filter((rollout) => rollout.baselineId === baseline.id);
    const tenants = new Set(rows.map((rollout) => rollout.tenantId));
    const complete = rows.filter((rollout) => rollout.state === "complete").length;
    const lastRunAt = rows.reduce<string | null>(
      (latest, rollout) => (latest === null || rollout.lastRunAt > latest ? rollout.lastRunAt : latest),
      null,
    );
    return {
      id: baseline.id,
      name: baseline.name,
      stages: baseline.stages.length,
      assignedTenants: tenants.size,
      fleetCompliance: tenants.size === 0 ? 0 : complete / tenants.size,
      lastRunAt,
    };
  });
}

/**
 * Tenants needing attention: open deviations outstanding, or a rollout
 * sitting in a non-advanced stage (`active`, or `eligible` awaiting the
 * operator). Sorted by tenant, then baseline.
 */
export function buildTenantsNeedingAttention(
  rollouts: readonly BaselineRollout[],
  openByTenant: Readonly<Record<string, number>>,
): TenantNeedingAttention[] {
  return rollouts
    .filter(
      (rollout) =>
        rollout.state !== "complete" || (openByTenant[rollout.tenantId] ?? 0) > 0,
    )
    .map((rollout) => ({
      tenantId: rollout.tenantId,
      baselineId: rollout.baselineId,
      stage: rollout.stage,
      state: rollout.state,
      openDeviations: openByTenant[rollout.tenantId] ?? 0,
    }))
    .sort(
      (left, right) =>
        left.tenantId.localeCompare(right.tenantId) ||
        left.baselineId.localeCompare(right.baselineId),
    );
}

// ─── Route factory ────────────────────────────────────────────────────────────

async function ensureAuthorized(
  options: FleetRouteOptions,
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

function requireCaller(options: FleetRouteOptions, ctx: RequestContext): Caller {
  const caller = options.resolveCaller(ctx);
  if (!caller) {
    throw new AppError(BASELINES_FLEET_UNAUTHENTICATED, "authentication required", 401);
  }
  return caller;
}

export function createBaselinesFleetRoutes(options: FleetRouteOptions): Route[] {
  async function handleFleet(ctx: RequestContext): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, BASELINES_FLEET_PERMISSION);

    const [baselines, rollouts, deviationStates, openByTenant] = await Promise.all([
      options.store.listBaselines(),
      options.store.listRollouts(),
      options.store.countDeviationsByState(),
      options.store.openDeviationsByTenant(),
    ]);

    const overview: FleetOverview = {
      baselines: buildFleetBaselineRows(baselines, rollouts),
      deviationStates,
      needsAttention: buildTenantsNeedingAttention(rollouts, openByTenant),
      acceptedDenied: {
        accepted: deviationStates.accepted,
        denied: deviationStates.denied,
      },
    };
    return { status: 200, body: overview };
  }

  return [{ method: "GET", path: BASELINES_FLEET_PATH, handler: handleFleet }];
}

// ─── OpenAPI fragment (§6) ───────────────────────────────────────────────────

export const BASELINES_FLEET_OPENAPI = {
  "/v1/baselines/fleet": {
    get: {
      tags: ["Baselines"],
      operationId: "getBaselinesFleet",
      summary: "Fleet compliance, deviation states, and tenants needing attention.",
      permission: BASELINES_FLEET_PERMISSION,
      security: [{ bearerAuth: [] }],
      responses: {
        "200": { description: "Fleet overview.", content: { "application/json": { schema: { $ref: "#/components/schemas/BaselinesFleet" } } } },
        "401": { description: "Unauthenticated.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
} as const;
