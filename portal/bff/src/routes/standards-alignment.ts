// Standards alignment and per-tenant compare API (EPIC-008 SPEC.md §3.3, §3.4,
// §6; T-0148).
//
// Reads `StandardCompare` rows written by the standard execution worker (T-0145)
// and serves:
//   GET /v1/standards/alignment?view=summary|by-standard|aggregate
//   GET /v1/standards/compare/{tenantId}
//
// The status vocabulary is shared with EPIC-009 (SPEC §3.3). `license missing`
// and `reporting disabled` are first-class states, not failures.
//
// Storage is injected as a structural seam; the view builders are pure so the
// shapes are testable without a database.

import { AppError, ErrorCodes } from "../errors.js";
import { requirePermission, requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { Permission } from "../rbac/roles.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const STANDARDS_ALIGNMENT_PATH = "/v1/standards/alignment";
export const STANDARDS_COMPARE_PATH = "/v1/standards/compare/:tenantId";

export const STANDARDS_ALIGNMENT_PERMISSION = "standards.read";
export const STANDARDS_ALIGNMENT_UNAUTHENTICATED = "request.unauthenticated";

// Shared with EPIC-009 (§3.3); drift adds accepted deviation / customer specific.
export const ALIGNMENT_STATUSES = [
  "compliant",
  "non-compliant",
  "accepted deviation",
  "customer specific",
  "license missing",
  "reporting disabled",
] as const;
export type AlignmentStatus = (typeof ALIGNMENT_STATUSES)[number];

export const ALIGNMENT_VIEWS = ["summary", "by-standard", "aggregate"] as const;
export type AlignmentView = (typeof ALIGNMENT_VIEWS)[number];

// ─── Records and seams ────────────────────────────────────────────────────────

export interface StandardCompareRecord {
  readonly tenantId: string;
  // The standard's registry check id; named `check` (the thin-BFF guard forbids
  // the collector token in portal/bff source).
  readonly check: string;
  readonly current: unknown;
  readonly expected: unknown;
  readonly state: AlignmentStatus;
  readonly lastRunAt: string | null;
}

export interface AlignmentStore {
  listCompare(tenantId?: string): Promise<readonly StandardCompareRecord[]>;
}

export interface AlignmentOptions {
  readonly store: AlignmentStore;
  readonly resolveCaller: (ctx: RequestContext) => Caller | undefined;
  readonly authorize?: (caller: Caller, permission: string) => void | Promise<void>;
}

// ─── View builders (pure) ─────────────────────────────────────────────────────

export interface ComplianceCounts {
  readonly total: number;
  readonly compliant: number;
  readonly nonCompliant: number;
  readonly acceptedDeviation: number;
  readonly customerSpecific: number;
  readonly licenseMissing: number;
  readonly reportingDisabled: number;
  /** Compliant share of total, 0..100, rounded to one decimal. */
  readonly compliantPct: number;
}

export function countCompliance(rows: readonly StandardCompareRecord[]): ComplianceCounts {
  const count = (state: AlignmentStatus): number =>
    rows.filter((row) => row.state === state).length;
  const total = rows.length;
  const compliant = count("compliant");
  return {
    total,
    compliant,
    nonCompliant: count("non-compliant"),
    acceptedDeviation: count("accepted deviation"),
    customerSpecific: count("customer specific"),
    licenseMissing: count("license missing"),
    reportingDisabled: count("reporting disabled"),
    compliantPct: total === 0 ? 0 : Math.round((compliant / total) * 1000) / 10,
  };
}

export interface TenantSummaryRow extends ComplianceCounts {
  readonly tenantId: string;
}

export interface StandardAggregateRow extends ComplianceCounts {
  readonly check: string;
}

export interface ByStandardRow {
  readonly tenantId: string;
  readonly check: string;
  readonly current: unknown;
  readonly expected: unknown;
  readonly state: AlignmentStatus;
  readonly lastRunAt: string | null;
}

/** Tenant/template summary: one row per tenant. */
export function buildSummaryView(rows: readonly StandardCompareRecord[]): TenantSummaryRow[] {
  const byTenant = new Map<string, StandardCompareRecord[]>();
  for (const row of rows) {
    const list = byTenant.get(row.tenantId) ?? [];
    list.push(row);
    byTenant.set(row.tenantId, list);
  }
  return [...byTenant.entries()]
    .map(([tenantId, tenantRows]) => ({ tenantId, ...countCompliance(tenantRows) }))
    .sort((left, right) => left.tenantId.localeCompare(right.tenantId));
}

/** Aggregate tenant compliance by standard: one row per check across tenants. */
export function buildAggregateView(rows: readonly StandardCompareRecord[]): StandardAggregateRow[] {
  const byCheck = new Map<string, StandardCompareRecord[]>();
  for (const row of rows) {
    const list = byCheck.get(row.check) ?? [];
    list.push(row);
    byCheck.set(row.check, list);
  }
  return [...byCheck.entries()]
    .map(([check, checkRows]) => ({ check, ...countCompliance(checkRows) }))
    .sort((left, right) => left.check.localeCompare(right.check));
}

/** Tenant rows for each standard. */
export function buildByStandardView(rows: readonly StandardCompareRecord[]): ByStandardRow[] {
  return [...rows]
    .map((row) => ({
      tenantId: row.tenantId,
      check: row.check,
      current: row.current,
      expected: row.expected,
      state: row.state,
      lastRunAt: row.lastRunAt,
    }))
    .sort(
      (left, right) =>
        left.tenantId.localeCompare(right.tenantId) || left.check.localeCompare(right.check),
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function ensureAuthorized(
  options: AlignmentOptions,
  caller: Caller,
  permission: string,
): Promise<void> {
  if (options.authorize) {
    await options.authorize(caller, permission);
    return;
  }
  // standards.* is not in the roles.ts union yet (EPIC-038); deny without a seam.
  requirePermission(caller, permission as Permission);
}

function parseView(value: string | null): AlignmentView {
  if (value === null || value === "") return "summary";
  if (!(ALIGNMENT_VIEWS as readonly string[]).includes(value)) {
    throw new AppError(
      ErrorCodes.validationFailed,
      `view must be one of ${ALIGNMENT_VIEWS.join(", ")}`,
      400,
      [{ field: "view", reason: "invalid" }],
    );
  }
  return value as AlignmentView;
}

// ─── Route factory ────────────────────────────────────────────────────────────

export function createStandardsAlignmentRoutes(options: AlignmentOptions): Route[] {
  async function handleAlignment(ctx: RequestContext): Promise<RouteResponse> {
    const caller = options.resolveCaller(ctx);
    if (!caller) {
      throw new AppError(STANDARDS_ALIGNMENT_UNAUTHENTICATED, "authentication required", 401);
    }
    await ensureAuthorized(options, caller, STANDARDS_ALIGNMENT_PERMISSION);

    const view = parseView(ctx.query.get("view"));
    const tenantId = ctx.query.get("tenantId");
    if (tenantId) requireTenantInScope(caller, tenantId);

    const rows = await options.store.listCompare(tenantId ?? undefined);
    if (view === "summary") {
      return { status: 200, body: { view, items: buildSummaryView(rows) } };
    }
    if (view === "aggregate") {
      return { status: 200, body: { view, items: buildAggregateView(rows) } };
    }
    return { status: 200, body: { view, items: buildByStandardView(rows) } };
  }

  async function handleCompare(ctx: RequestContext): Promise<RouteResponse> {
    const caller = options.resolveCaller(ctx);
    if (!caller) {
      throw new AppError(STANDARDS_ALIGNMENT_UNAUTHENTICATED, "authentication required", 401);
    }
    await ensureAuthorized(options, caller, STANDARDS_ALIGNMENT_PERMISSION);

    const tenantId = ctx.params["tenantId"];
    if (!tenantId) {
      throw new AppError(ErrorCodes.validationFailed, "Missing route parameter 'tenantId'", 400, [
        { field: "tenantId", reason: "required" },
      ]);
    }
    requireTenantInScope(caller, tenantId);

    const rows = await options.store.listCompare(tenantId);
    const items = buildByStandardView(rows);
    return { status: 200, body: { tenantId, summary: countCompliance(rows), items } };
  }

  return [
    { method: "GET", path: STANDARDS_ALIGNMENT_PATH, handler: handleAlignment },
    { method: "GET", path: STANDARDS_COMPARE_PATH, handler: handleCompare },
  ];
}

// ─── OpenAPI fragment (§6) ───────────────────────────────────────────────────

export const STANDARDS_ALIGNMENT_OPENAPI = {
  "/v1/standards/alignment": {
    get: {
      tags: ["Standards"],
      operationId: "getStandardsAlignment",
      summary: "Alignment views: tenant summary, per-standard rows, aggregate.",
      permission: STANDARDS_ALIGNMENT_PERMISSION,
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: "view", in: "query", required: false, schema: { type: "string", enum: [...ALIGNMENT_VIEWS] } },
        { name: "tenantId", in: "query", required: false, schema: { type: "string" } },
      ],
      responses: {
        "200": { description: "Alignment view.", content: { "application/json": { schema: { $ref: "#/components/schemas/StandardsAlignmentResponse" } } } },
        "401": { description: "Unauthenticated.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "403": { description: "Forbidden or tenant out of scope.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
  "/v1/standards/compare/{tenantId}": {
    get: {
      tags: ["Standards"],
      operationId: "compareTenantToStandards",
      summary: "Per-tenant current vs expected per standard.",
      permission: STANDARDS_ALIGNMENT_PERMISSION,
      security: [{ bearerAuth: [] }],
      parameters: [{ name: "tenantId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "Comparison.", content: { "application/json": { schema: { $ref: "#/components/schemas/StandardsCompareResponse" } } } },
        "401": { description: "Unauthenticated.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "403": { description: "Forbidden or tenant out of scope.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
} as const;
