// Drift read, refresh, and alignment API (EPIC-009 SPEC.md §3.1, §3.3, §6; T-0164).
//
//   GET  /v1/drift/{tenantId}            -> deviations + state breakdown
//   POST /v1/drift/{tenantId}/refresh     -> recompute now (upsert, triage preserved)
//   GET  /v1/drift/alignment             -> shared alignment views + extra-policy dimension
//
// Reads require `Tenant.Drift.Read`; a refresh requires `Tenant.Drift.ReadWrite` (it recomputes and
// upserts stored deviation rows). Tenant scope is enforced through the shared RBAC
// seam. The refresh delegates to an injected recompute seam so the BFF stays thin
// (the worker performs the tenant reads; T-0162's upsert preserves triage state).
//
// Route ordering matters: `/v1/drift/alignment` is a static path at the same depth
// as `/v1/drift/:tenantId`, so alignment is registered first and the matcher
// (first match wins) never captures "alignment" as a tenant id.

import { AppError, ErrorCodes } from "../errors.js";
import { requirePermission, requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { Permission } from "../rbac/roles.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const DRIFT_TENANT_PATH = "/v1/drift/:tenantId";
export const DRIFT_REFRESH_PATH = "/v1/drift/:tenantId/refresh";
export const DRIFT_ALIGNMENT_PATH = "/v1/drift/alignment";

export const DRIFT_PERMISSIONS = {
  read: "Tenant.Drift.Read",
  triage: "Tenant.Drift.ReadWrite",
} as const;

export const DRIFT_UNAUTHENTICATED = "request.unauthenticated";

export const DRIFT_DEVIATION_STATES = [
  "open",
  "accepted",
  "customerSpecific",
  "denied",
  "deletePending",
  "resolved",
] as const;
export type DriftDeviationState = (typeof DRIFT_DEVIATION_STATES)[number];

export const DRIFT_DEVIATION_KINDS = ["mismatch", "extra"] as const;
export type DriftDeviationKind = (typeof DRIFT_DEVIATION_KINDS)[number];

export const DRIFT_ALIGNMENT_VIEWS = ["summary", "by-standard", "aggregate"] as const;
export type DriftAlignmentView = (typeof DRIFT_ALIGNMENT_VIEWS)[number];

// ─── Records and seams ────────────────────────────────────────────────────────

export interface DriftDeviationRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly standardKey: string;
  readonly resourceId: string;
  readonly kind: DriftDeviationKind;
  readonly current: unknown;
  readonly expected: unknown;
  readonly state: DriftDeviationState;
  readonly reason: string | null;
  readonly expiresOn: string | null;
  readonly autoRemediateOnExpiry: boolean;
  readonly overrideValue: unknown;
  readonly lastSeenAt: string;
}

export interface DriftStore {
  listDeviations(
    tenantId: string,
    options?: { state?: DriftDeviationState; kind?: DriftDeviationKind },
  ): Promise<readonly DriftDeviationRecord[]>;
  /** Cross-tenant listing for the alignment views (optional seam). */
  listAllDeviations?(): Promise<readonly DriftDeviationRecord[]>;
}

export interface DriftRefreshResult {
  readonly recomputed: boolean;
  readonly inserted?: number;
  readonly updated?: number;
  readonly preserved?: number;
}

export interface DriftRefresh {
  /** Recompute the tenant's deviations now; the upsert preserves triage state. */
  refresh(tenantId: string): Promise<DriftRefreshResult>;
}

export interface DriftRouteOptions {
  readonly store: DriftStore;
  readonly refresh: DriftRefresh;
  readonly resolveCaller: (ctx: RequestContext) => Caller | undefined;
  readonly authorize?: (caller: Caller, permission: string) => void | Promise<void>;
}

// ─── Breakdown (pure) ─────────────────────────────────────────────────────────

export interface DriftBreakdown {
  readonly open: number;
  readonly accepted: number;
  readonly customerSpecific: number;
  readonly denied: number;
  readonly deletePending: number;
  readonly resolved: number;
  readonly total: number;
}

export function buildDriftBreakdown(
  deviations: readonly DriftDeviationRecord[],
): DriftBreakdown {
  const count = (state: DriftDeviationState): number =>
    deviations.filter((deviation) => deviation.state === state).length;
  return {
    open: count("open"),
    accepted: count("accepted"),
    customerSpecific: count("customerSpecific"),
    denied: count("denied"),
    deletePending: count("deletePending"),
    resolved: count("resolved"),
    total: deviations.length,
  };
}

// ─── Alignment (pure; shared with EPIC-008 plus the extra dimension) ──────────

export interface DriftAlignmentRow extends DriftBreakdown {
  readonly extraPolicies: number;
}

export interface DriftAlignmentSummaryRow extends DriftAlignmentRow {
  readonly tenantId: string;
}

export interface DriftAlignmentAggregateRow extends DriftAlignmentRow {
  readonly standardKey: string;
}

export interface DriftAlignmentByStandardRow {
  readonly tenantId: string;
  readonly standardKey: string;
  readonly resourceId: string;
  readonly kind: DriftDeviationKind;
  readonly current: unknown;
  readonly expected: unknown;
  readonly state: DriftDeviationState;
  readonly lastSeenAt: string;
}

function extraCount(deviations: readonly DriftDeviationRecord[]): number {
  return deviations.filter((deviation) => deviation.kind === "extra").length;
}

export function buildDriftAlignmentSummary(
  deviations: readonly DriftDeviationRecord[],
): DriftAlignmentSummaryRow[] {
  const byTenant = new Map<string, DriftDeviationRecord[]>();
  for (const deviation of deviations) {
    const list = byTenant.get(deviation.tenantId) ?? [];
    list.push(deviation);
    byTenant.set(deviation.tenantId, list);
  }
  return [...byTenant.entries()]
    .map(([tenantId, rows]) => ({
      tenantId,
      ...buildDriftBreakdown(rows),
      extraPolicies: extraCount(rows),
    }))
    .sort((left, right) => left.tenantId.localeCompare(right.tenantId));
}

export function buildDriftAlignmentAggregate(
  deviations: readonly DriftDeviationRecord[],
): DriftAlignmentAggregateRow[] {
  const byStandard = new Map<string, DriftDeviationRecord[]>();
  for (const deviation of deviations) {
    const list = byStandard.get(deviation.standardKey) ?? [];
    list.push(deviation);
    byStandard.set(deviation.standardKey, list);
  }
  return [...byStandard.entries()]
    .map(([standardKey, rows]) => ({
      standardKey,
      ...buildDriftBreakdown(rows),
      extraPolicies: extraCount(rows),
    }))
    .sort((left, right) => left.standardKey.localeCompare(right.standardKey));
}

export function buildDriftAlignmentByStandard(
  deviations: readonly DriftDeviationRecord[],
): DriftAlignmentByStandardRow[] {
  return [...deviations]
    .map((deviation) => ({
      tenantId: deviation.tenantId,
      standardKey: deviation.standardKey,
      resourceId: deviation.resourceId,
      kind: deviation.kind,
      current: deviation.current,
      expected: deviation.expected,
      state: deviation.state,
      lastSeenAt: deviation.lastSeenAt,
    }))
    .sort(
      (left, right) =>
        left.tenantId.localeCompare(right.tenantId) ||
        left.standardKey.localeCompare(right.standardKey) ||
        left.resourceId.localeCompare(right.resourceId),
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function ensureAuthorized(
  options: DriftRouteOptions,
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

function requireCaller(options: DriftRouteOptions, ctx: RequestContext): Caller {
  const caller = options.resolveCaller(ctx);
  if (!caller) {
    throw new AppError(DRIFT_UNAUTHENTICATED, "authentication required", 401);
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

function parseState(value: string | null): DriftDeviationState | undefined {
  if (!value) return undefined;
  if (!(DRIFT_DEVIATION_STATES as readonly string[]).includes(value)) {
    throw new AppError(ErrorCodes.validationFailed, "invalid state filter", 400, [
      { field: "state", reason: "invalid" },
    ]);
  }
  return value as DriftDeviationState;
}

function parseKind(value: string | null): DriftDeviationKind | undefined {
  if (!value) return undefined;
  if (!(DRIFT_DEVIATION_KINDS as readonly string[]).includes(value)) {
    throw new AppError(ErrorCodes.validationFailed, "invalid kind filter", 400, [
      { field: "kind", reason: "invalid" },
    ]);
  }
  return value as DriftDeviationKind;
}

function parseView(value: string | null): DriftAlignmentView {
  if (value === null || value === "") return "summary";
  if (!(DRIFT_ALIGNMENT_VIEWS as readonly string[]).includes(value)) {
    throw new AppError(ErrorCodes.validationFailed, "invalid alignment view", 400, [
      { field: "view", reason: "invalid" },
    ]);
  }
  return value as DriftAlignmentView;
}

// ─── Route factory ────────────────────────────────────────────────────────────

export function createDriftRoutes(options: DriftRouteOptions): Route[] {
  // GET /v1/drift/alignment — static path; registered before the :tenantId route.
  async function handleAlignment(ctx: RequestContext): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, DRIFT_PERMISSIONS.read);

    const view = parseView(ctx.query.get("view"));
    const rows = options.store.listAllDeviations
      ? await options.store.listAllDeviations()
      : [];
    const items =
      view === "aggregate"
        ? buildDriftAlignmentAggregate(rows)
        : view === "by-standard"
          ? buildDriftAlignmentByStandard(rows)
          : buildDriftAlignmentSummary(rows);
    return { status: 200, body: { view, items } };
  }

  // GET /v1/drift/:tenantId — deviations + breakdown.
  async function handleGet(ctx: RequestContext): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, DRIFT_PERMISSIONS.read);
    const tenantId = requireParam(ctx, "tenantId");
    requireTenantInScope(caller, tenantId);

    const state = parseState(ctx.query.get("state"));
    const kind = parseKind(ctx.query.get("kind"));
    const deviations = await options.store.listDeviations(tenantId, { state, kind });

    return {
      status: 200,
      body: {
        tenantId,
        breakdown: buildDriftBreakdown(deviations),
        items: deviations,
      },
    };
  }

  // POST /v1/drift/:tenantId/refresh — recompute now (triage state preserved).
  async function handleRefresh(ctx: RequestContext): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, DRIFT_PERMISSIONS.triage);
    const tenantId = requireParam(ctx, "tenantId");
    requireTenantInScope(caller, tenantId);

    const result = await options.refresh.refresh(tenantId);
    return { status: 202, body: { tenantId, status: "refreshed", result } };
  }

  return [
    { method: "GET", path: DRIFT_ALIGNMENT_PATH, handler: handleAlignment },
    { method: "GET", path: DRIFT_TENANT_PATH, handler: handleGet },
    { method: "POST", path: DRIFT_REFRESH_PATH, handler: handleRefresh },
  ];
}

// ─── OpenAPI fragment (§6) ───────────────────────────────────────────────────

export const DRIFT_OPENAPI = {
  "/v1/drift/{tenantId}": {
    get: {
      tags: ["Drift"],
      operationId: "getDrift",
      summary: "Deviations plus breakdown by state.",
      permission: DRIFT_PERMISSIONS.read,
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: "tenantId", in: "path", required: true, schema: { type: "string" } },
        { name: "state", in: "query", required: false, schema: { type: "string", enum: [...DRIFT_DEVIATION_STATES] } },
        { name: "kind", in: "query", required: false, schema: { type: "string", enum: [...DRIFT_DEVIATION_KINDS] } },
      ],
      responses: {
        "200": { description: "Deviations and breakdown.", content: { "application/json": { schema: { $ref: "#/components/schemas/DriftResponse" } } } },
        "401": { description: "Unauthenticated.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "403": { description: "Forbidden or tenant out of scope.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
  "/v1/drift/{tenantId}/refresh": {
    post: {
      tags: ["Drift"],
      operationId: "refreshDrift",
      summary: "Recompute deviations now; triage state is preserved.",
      permission: DRIFT_PERMISSIONS.triage,
      security: [{ bearerAuth: [] }],
      parameters: [{ name: "tenantId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "202": { description: "Refreshed.", content: { "application/json": { schema: { $ref: "#/components/schemas/DriftRefreshResponse" } } } },
        "403": { description: "Forbidden or tenant out of scope.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
  "/v1/drift/alignment": {
    get: {
      tags: ["Drift"],
      operationId: "getDriftAlignment",
      summary: "Shared alignment views plus the extra-policy dimension.",
      permission: DRIFT_PERMISSIONS.read,
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: "view", in: "query", required: false, schema: { type: "string", enum: [...DRIFT_ALIGNMENT_VIEWS] } },
      ],
      responses: {
        "200": { description: "Alignment view.", content: { "application/json": { schema: { $ref: "#/components/schemas/DriftAlignmentResponse" } } } },
        "401": { description: "Unauthenticated.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
} as const;
