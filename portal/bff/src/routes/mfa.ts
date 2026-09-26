// MFA report and actions (EPIC-012 SPEC.md §3-§4, §6-§8).
// The BFF owns validation, RBAC/tenant scope, and response shaping; every
// tenant read or write runs in the PowerShell workers through injected
// provider seams, so this module holds no Graph client and issues no tenant
// write itself. Reads require `mfa.read`; per-user writes require
// `mfa.write`; policy writes additionally require `mfa.policy` (SPEC §7)
// intersected with the caller tenant scope.
import { AppError, ErrorCodes } from "../errors.js";
import { parsePagination } from "../pagination.js";
import { requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const MFA_REPORT_PATH = "/v1/tenants/:tenantId/mfa-report";

export const MFA_PERMISSIONS = {
  read: "mfa.read",
  write: "mfa.write",
  policy: "mfa.policy",
} as const;

export const MFA_UNAUTHENTICATED = "request.unauthenticated";

export type MfaUserState = "registered" | "notRegistered";

export type MfaPhishingResistant =
  | "phishing-resistant"
  | "not-phishing-resistant"
  | "unknown";

export interface MfaUserRow {
  readonly userId: string;
  readonly displayName: string | null;
  readonly userPrincipalName: string;
  readonly methods: readonly string[];
  readonly defaultMethod: string | null;
  readonly phishingResistant: MfaPhishingResistant;
  readonly lastAuthDateTime: string | null;
  readonly state: MfaUserState;
  readonly licenses: readonly string[];
  readonly isAdmin: boolean;
}

export interface MfaReportKpis {
  readonly total: number;
  readonly registered: number;
  readonly notRegistered: number;
  readonly phishingResistant: number;
  readonly perMethod: Record<string, number>;
}

export type MfaRegisteredFilter = "registered" | "notRegistered";
export type MfaLicenseFilter = "licensed" | "unlicensed";

export interface MfaReportFilter {
  readonly registered?: MfaRegisteredFilter;
  readonly method?: string;
  readonly phishingResistant?: boolean;
  readonly license?: MfaLicenseFilter;
  readonly adminRole?: boolean;
  readonly cursor: string | null;
  readonly limit: number;
}

export interface MfaReport {
  readonly tenantId: string;
  readonly rows: readonly MfaUserRow[];
  readonly kpis: MfaReportKpis;
  readonly nextCursor: string | null;
  readonly retrievedAt: string;
}

// Queue-backed seam for the report read: the production wiring enqueues a
// Get-MfaReport worker job for (tenantId, filter) and serves the worker page.
// Depending on the seam keeps Graph and process code out of the BFF.
export interface MfaReportProvider {
  getMfaReport(
    tenantId: string,
    filter: MfaReportFilter,
  ): Promise<{ rows: readonly MfaUserRow[]; nextCursor: string | null; retrievedAt: string }>;
}

export interface MfaCaller extends Caller {
  readonly userId?: string;
}

export type MfaAuthorizer = (
  caller: MfaCaller,
  permission: string,
) => void | Promise<void>;

export interface MfaRequestContext extends RequestContext {
  readonly body?: unknown;
}

export type MfaWriteAction = "mfa.reset" | "mfa.tap" | "mfa.push" | "mfa.defaultMethod";

export interface MfaAuditEvent {
  readonly tenantId: string;
  readonly action: MfaWriteAction;
  readonly targetId: string;
  readonly result: "success" | "failure";
  readonly error: string | null;
  readonly actorUserId: string | null;
  readonly correlationId: string;
  readonly createdAt: string;
}

export interface MfaRouteOptions {
  readonly report: MfaReportProvider;
  readonly resolveCaller: (ctx: RequestContext) => MfaCaller | undefined;
  readonly authorize?: MfaAuthorizer;
  readonly reset?: MfaResetProvider;
  readonly tap?: TapProvider;
  readonly tapRecords?: TapRecordStore;
  readonly actions?: MfaActionProvider;
  readonly readBody?: (ctx: MfaRequestContext) => unknown;
  readonly recordAudit?: (event: MfaAuditEvent) => Promise<void>;
  readonly now?: () => string;
}

function readJsonBody(
  ctx: RequestContext,
  readBody: ((ctx: MfaRequestContext) => unknown) | undefined,
): Record<string, unknown> {
  let body = readBody ? readBody(ctx as MfaRequestContext) : (ctx as MfaRequestContext).body;
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

function parseReason(body: Record<string, unknown>): string {
  const reason = body["reason"];
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "reason is required", 400, [
      { field: "reason", reason: "required" },
    ]);
  }
  return reason.trim();
}

function parseDryRun(body: Record<string, unknown>): boolean {
  const dryRun = body["dryRun"];
  if (dryRun !== undefined && typeof dryRun !== "boolean") {
    throw validationError("dryRun must be a boolean", "dryRun");
  }
  return dryRun === true;
}

function parseConfirmed(body: Record<string, unknown>, action: string): void {
  if (body["confirm"] !== true) {
    throw new AppError(
      MFA_RESET_CONFIRM_REQUIRED,
      `action '${action}' removes authentication methods and requires { "confirm": true } with a reason`,
      400,
      [{ field: "confirm", reason: "required" }],
    );
  }
}

function unauthenticatedError(): AppError {
  return new AppError(MFA_UNAUTHENTICATED, "authentication required", 401);
}

function validationError(message: string, field: string): AppError {
  return new AppError(ErrorCodes.validationFailed, message, 400, [
    { field, reason: "invalid" },
  ]);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => MfaCaller | undefined,
  ctx: RequestContext,
): MfaCaller {
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

function optionalText(query: URLSearchParams, name: string): string | undefined {
  const value = query.get(name);
  if (value === null || value.length === 0) {
    return undefined;
  }
  return value;
}

const MFA_REGISTERED_VALUES: readonly MfaRegisteredFilter[] = [
  "registered",
  "notRegistered",
];
const MFA_LICENSE_VALUES: readonly MfaLicenseFilter[] = ["licensed", "unlicensed"];

function parseBooleanFilter(
  query: URLSearchParams,
  name: string,
): boolean | undefined {
  const value = optionalText(query, name);
  if (value === undefined) {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw validationError(`${name} must be 'true' or 'false'`, name);
}

// ─── MFA report read (EPIC-012 SPEC §3.1, §4.1 US-1; T-0221) ────────────────
//
// GET /v1/tenants/{id}/mfa-report aggregates users plus authenticationMethods
// into registration, method, and phishing-resistant state with the §3.1 table
// columns. Phishing-resistance is read from Graph by the worker through the
// T-0227 classifier, never inferred here. No user method data is mirrored:
// the provider serves the worker page live and this module shapes it.

export function parseMfaReportFilter(query: URLSearchParams): MfaReportFilter {
  const pagination = parsePagination(query);
  const registeredRaw = optionalText(query, "registered");
  if (registeredRaw !== undefined && !(MFA_REGISTERED_VALUES as readonly string[]).includes(registeredRaw)) {
    throw validationError("registered must be one of: registered, notRegistered", "registered");
  }
  const licenseRaw = optionalText(query, "license");
  if (licenseRaw !== undefined && !(MFA_LICENSE_VALUES as readonly string[]).includes(licenseRaw)) {
    throw validationError("license must be one of: licensed, unlicensed", "license");
  }
  const filter: {
    -readonly [K in keyof MfaReportFilter]: MfaReportFilter[K];
  } = {
    cursor: pagination.cursor,
    limit: pagination.limit,
  };
  if (registeredRaw !== undefined) {
    filter.registered = registeredRaw as MfaRegisteredFilter;
  }
  const method = optionalText(query, "method");
  if (method !== undefined) {
    filter.method = method;
  }
  const phishingResistant = parseBooleanFilter(query, "phishingResistant");
  if (phishingResistant !== undefined) {
    filter.phishingResistant = phishingResistant;
  }
  if (licenseRaw !== undefined) {
    filter.license = licenseRaw as MfaLicenseFilter;
  }
  const adminRole = parseBooleanFilter(query, "adminRole");
  if (adminRole !== undefined) {
    filter.adminRole = adminRole;
  }
  return filter;
}

// KPI aggregates are derived from the served rows, so the strip reconciles
// with the table by construction. perMethod counts a method once per user
// that holds it.
export function computeMfaKpis(rows: readonly MfaUserRow[]): MfaReportKpis {
  const perMethod: Record<string, number> = {};
  let registered = 0;
  let phishingResistant = 0;
  for (const row of rows) {
    if (row.state === "registered") {
      registered += 1;
    }
    if (row.phishingResistant === "phishing-resistant") {
      phishingResistant += 1;
    }
    for (const method of new Set(row.methods)) {
      perMethod[method] = (perMethod[method] ?? 0) + 1;
    }
  }
  return {
    total: rows.length,
    registered,
    notRegistered: rows.length - registered,
    phishingResistant,
    perMethod,
  };
}

export async function getMfaReport(
  provider: MfaReportProvider,
  tenantId: string,
  filter: MfaReportFilter,
): Promise<{ status: number; body: MfaReport }> {
  if (tenantId.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "tenantId is required", 400, [
      { field: "tenantId", reason: "required" },
    ]);
  }
  const page = await provider.getMfaReport(tenantId, filter);
  return {
    status: 200,
    body: {
      tenantId,
      rows: [...page.rows],
      kpis: computeMfaKpis(page.rows),
      nextCursor: page.nextCursor,
      retrievedAt: page.retrievedAt,
    },
  };
}

// ─── Reset MFA, single and gated bulk (EPIC-012 SPEC §3.2, §4.2 US-2; T-0222)
//
// Reset removes the user's authentication methods and requires
// re-registration, so it is a gated write: single reset needs an explicit
// `{ "confirm": true }` plus a reason, and bulk reset additionally needs a
// batch count (`confirmCount` equal to the user list length, the T-0113 batch
// confirmation shape) with the count shown back. `dryRun: true` plans only.
// Every applied row emits one audit event; the provider applies through the
// EPIC-006-gated Reset-UserMfa worker path and returns the post-reset method
// state.

export const MFA_RESET_PATH = "/v1/tenants/:tenantId/users/:userId/mfa/reset";
export const MFA_BULK_RESET_PATH = "/v1/tenants/:tenantId/users/mfa/reset";

export const MFA_RESET_CONFIRM_REQUIRED = "mfa.confirm_required";
export const MFA_RESET_UNAVAILABLE = "mfa.reset_unavailable";
export const MFA_BULK_COUNT_REQUIRED = "mfa.bulk_count_required";

export type MfaResetStatus = "applied" | "planned" | "failed";

export interface MfaResetResult {
  readonly userId: string;
  readonly status: MfaResetStatus;
  readonly methods: readonly string[];
  readonly state: MfaUserState;
  readonly error: string | null;
}

export interface ProviderMfaResetOutcome {
  readonly status: "applied" | "failed";
  readonly methods?: readonly string[];
  readonly state?: MfaUserState;
  readonly error?: string | null;
}

// Queue-backed seam for the reset path: the production wiring enqueues one
// Reset-UserMfa worker job and serves the post-reset method state. Depending
// on the seam keeps Graph and process code out of the BFF.
export interface MfaResetProvider {
  resetMfa(
    tenantId: string,
    userId: string,
    options: { dryRun: boolean },
  ): Promise<ProviderMfaResetOutcome>;
}

export interface MfaBulkResetResponse {
  readonly rows: readonly MfaResetResult[];
  readonly summary: { readonly total: number; readonly applied: number; readonly planned: number; readonly failed: number };
}

async function writeMfaAudit(
  options: MfaRouteOptions,
  ctx: RequestContext,
  caller: MfaCaller,
  tenantId: string,
  action: MfaWriteAction,
  targetId: string,
  result: "success" | "failure",
  error: string | null,
): Promise<void> {
  if (!options.recordAudit) {
    return;
  }
  const now = options.now ?? (() => new Date().toISOString());
  await options.recordAudit({
    tenantId,
    action,
    targetId,
    result,
    error,
    actorUserId: caller.userId ?? null,
    correlationId: ctx.correlationId,
    createdAt: now(),
  });
}

export async function postMfaReset(
  options: MfaRouteOptions,
  ctx: RequestContext,
  tenantId: string,
  caller: MfaCaller,
  userId: string,
): Promise<{ status: number; body: MfaResetResult }> {
  if (userId.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "userId is required", 400, [
      { field: "userId", reason: "required" },
    ]);
  }
  const body = readJsonBody(ctx, options.readBody);
  const dryRun = parseDryRun(body);
  const reason = parseReason(body);
  void reason;
  if (!dryRun) {
    parseConfirmed(body, "mfa.reset");
  }
  if (dryRun) {
    return {
      status: 200,
      body: { userId, status: "planned", methods: [], state: "notRegistered", error: null },
    };
  }
  if (options.reset === undefined) {
    throw new AppError(MFA_RESET_UNAVAILABLE, "MFA reset is not wired for this tenant", 501);
  }
  let outcome: ProviderMfaResetOutcome;
  try {
    outcome = await options.reset.resetMfa(tenantId, userId, { dryRun: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "reset failed without a provider result";
    const failed: MfaResetResult = { userId, status: "failed", methods: [], state: "notRegistered", error: message };
    await writeMfaAudit(options, ctx, caller, tenantId, "mfa.reset", userId, "failure", message);
    return { status: 200, body: failed };
  }
  const result: MfaResetResult =
    outcome.status === "failed"
      ? {
          userId,
          status: "failed",
          methods: outcome.methods ?? [],
          state: outcome.state ?? "notRegistered",
          error: outcome.error ?? "reset failed without a provider result",
        }
      : {
          userId,
          status: "applied",
          methods: outcome.methods ?? [],
          state: outcome.state ?? "notRegistered",
          error: null,
        };
  await writeMfaAudit(
    options,
    ctx,
    caller,
    tenantId,
    "mfa.reset",
    userId,
    result.status === "applied" ? "success" : "failure",
    result.error,
  );
  return { status: 200, body: result };
}

export async function postMfaBulkReset(
  options: MfaRouteOptions,
  ctx: RequestContext,
  tenantId: string,
  caller: MfaCaller,
): Promise<{ status: number; body: MfaBulkResetResponse }> {
  const body = readJsonBody(ctx, options.readBody);
  if (!Array.isArray(body["users"]) && !Array.isArray(body["userIds"])) {
    throw validationError("userIds must be a non-empty array", "userIds");
  }
  const rawIds = (body["users"] ?? body["userIds"]) as unknown[];
  const userIds = rawIds.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new AppError(ErrorCodes.validationFailed, `userIds[${index}] must be a non-empty string`, 400, [
        { field: "userIds", reason: "invalid" },
      ]);
    }
    return entry.trim();
  });
  if (userIds.length === 0) {
    throw validationError("userIds must be a non-empty array", "userIds");
  }
  const dryRun = parseDryRun(body);
  const reason = parseReason(body);
  void reason;
  if (!dryRun) {
    parseConfirmed(body, "mfa.reset");
    const confirmCount = body["confirmCount"];
    if (typeof confirmCount !== "number" || !Number.isInteger(confirmCount) || confirmCount !== userIds.length) {
      throw new AppError(
        MFA_BULK_COUNT_REQUIRED,
        `bulk reset affects ${userIds.length} users and requires { "confirmCount": ${userIds.length} }`,
        400,
        [{ field: "confirmCount", reason: "required" }],
      );
    }
  }
  if (options.reset === undefined) {
    throw new AppError(MFA_RESET_UNAVAILABLE, "MFA reset is not wired for this tenant", 501);
  }
  const rows: MfaResetResult[] = [];
  for (const userId of userIds) {
    if (dryRun) {
      rows.push({ userId, status: "planned", methods: [], state: "notRegistered", error: null });
      continue;
    }
    try {
      const outcome = await options.reset.resetMfa(tenantId, userId, { dryRun: false });
      const row: MfaResetResult =
        outcome.status === "failed"
          ? {
              userId,
              status: "failed",
              methods: outcome.methods ?? [],
              state: outcome.state ?? "notRegistered",
              error: outcome.error ?? "reset failed without a provider result",
            }
          : {
              userId,
              status: "applied",
              methods: outcome.methods ?? [],
              state: outcome.state ?? "notRegistered",
              error: null,
            };
      rows.push(row);
      await writeMfaAudit(
        options,
        ctx,
        caller,
        tenantId,
        "mfa.reset",
        userId,
        row.status === "applied" ? "success" : "failure",
        row.error,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "reset failed without a provider result";
      rows.push({ userId, status: "failed", methods: [], state: "notRegistered", error: message });
      await writeMfaAudit(options, ctx, caller, tenantId, "mfa.reset", userId, "failure", message);
    }
  }
  return {
    status: 200,
    body: {
      rows,
      summary: {
        total: rows.length,
        applied: rows.filter((row) => row.status === "applied").length,
        planned: rows.filter((row) => row.status === "planned").length,
        failed: rows.filter((row) => row.status === "failed").length,
      },
    },
  };
}

// ─── Temporary Access Pass (EPIC-012 SPEC §3.2, §4.2 US-3, §5, §9; T-0223) ─
//
// The TAP action configures lifetime, one-time-use, and start time, then
// shows the pass once. The pass value travels in the response body only: the
// persisted TAPRecord (via the injected store, backed by tap-repository)
// carries the non-secret metadata, and the audit event carries no secret
// field, so the value can never reach storage, logs, or audit. Apply needs an
// explicit `{ "confirm": true }` plus a reason; `dryRun: true` plans only.

export const MFA_TAP_PATH = "/v1/tenants/:tenantId/users/:userId/tap";

export const MFA_TAP_UNAVAILABLE = "mfa.tap_unavailable";

export const DEFAULT_TAP_LIFETIME_MINUTES = 60;
export const MIN_TAP_LIFETIME_MINUTES = 10;
export const MAX_TAP_LIFETIME_MINUTES = 43200;

export type TapCreateStatus = "applied" | "planned" | "failed";

export interface TapCreateInput {
  readonly lifetimeMinutes: number;
  readonly oneTime: boolean;
  readonly startTime: string | null;
  readonly dryRun: boolean;
}

export interface ProviderTapOutcome {
  readonly status: "applied" | "failed";
  readonly id: string;
  readonly expiresAt: string | null;
  readonly pass: string | null;
  readonly error?: string | null;
}

// Queue-backed seam for TAP creation: the production wiring enqueues one
// New-TemporaryAccessPass worker job and serves the one-time value. Depending
// on the seam keeps Graph and process code out of the BFF.
export interface TapProvider {
  createTap(
    tenantId: string,
    userId: string,
    input: TapCreateInput,
  ): Promise<ProviderTapOutcome>;
}

export interface TapRecordInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly createdBy: string | null;
  readonly lifetimeMinutes: number;
  readonly oneTime: boolean;
  readonly startTime: string | null;
}

// Persistence seam for the non-secret TAPRecord (backed by the db package's
// tap-repository). The record shape carries no pass value by construction.
export interface TapRecordStore {
  save(record: TapRecordInput): Promise<{ id: string; createdAt: string }>;
}

export interface TapCreateResult {
  readonly id: string | null;
  readonly userId: string;
  readonly status: TapCreateStatus;
  readonly lifetimeMinutes: number;
  readonly oneTime: boolean;
  readonly startTime: string | null;
  readonly expiresAt: string | null;
  readonly temporaryAccessPass: string | null;
  readonly error: string | null;
}

function parseTapLifetime(body: Record<string, unknown>): number {
  const raw = body["lifetimeMinutes"];
  if (raw === undefined) {
    return DEFAULT_TAP_LIFETIME_MINUTES;
  }
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < MIN_TAP_LIFETIME_MINUTES || raw > MAX_TAP_LIFETIME_MINUTES) {
    throw validationError(
      `lifetimeMinutes must be an integer between ${MIN_TAP_LIFETIME_MINUTES} and ${MAX_TAP_LIFETIME_MINUTES}`,
      "lifetimeMinutes",
    );
  }
  return raw;
}

function parseTapOneTime(body: Record<string, unknown>): boolean {
  const raw = body["oneTime"];
  if (raw === undefined) {
    return true;
  }
  if (typeof raw !== "boolean") {
    throw validationError("oneTime must be a boolean", "oneTime");
  }
  return raw;
}

function parseTapStartTime(body: Record<string, unknown>): string | null {
  const raw = body["startTime"];
  if (raw === undefined || raw === null) {
    return null;
  }
  if (typeof raw !== "string" || raw.trim().length === 0 || Number.isNaN(Date.parse(raw))) {
    throw validationError("startTime must be an ISO-8601 date-time string", "startTime");
  }
  return raw.trim();
}

export async function postTap(
  options: MfaRouteOptions,
  ctx: RequestContext,
  tenantId: string,
  caller: MfaCaller,
  userId: string,
): Promise<{ status: number; body: TapCreateResult }> {
  if (userId.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "userId is required", 400, [
      { field: "userId", reason: "required" },
    ]);
  }
  const body = readJsonBody(ctx, options.readBody);
  const dryRun = parseDryRun(body);
  const reason = parseReason(body);
  void reason;
  if (!dryRun) {
    parseConfirmed(body, "mfa.tap");
  }
  const lifetimeMinutes = parseTapLifetime(body);
  const oneTime = parseTapOneTime(body);
  const startTime = parseTapStartTime(body);
  if (dryRun) {
    return {
      status: 200,
      body: {
        id: null,
        userId,
        status: "planned",
        lifetimeMinutes,
        oneTime,
        startTime,
        expiresAt: null,
        temporaryAccessPass: null,
        error: null,
      },
    };
  }
  if (options.tap === undefined) {
    throw new AppError(MFA_TAP_UNAVAILABLE, "Temporary Access Pass creation is not wired for this tenant", 501);
  }
  let outcome: ProviderTapOutcome;
  try {
    outcome = await options.tap.createTap(tenantId, userId, { lifetimeMinutes, oneTime, startTime, dryRun: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "TAP creation failed without a provider result";
    await writeMfaAudit(options, ctx, caller, tenantId, "mfa.tap", userId, "failure", message);
    return {
      status: 200,
      body: {
        id: null,
        userId,
        status: "failed",
        lifetimeMinutes,
        oneTime,
        startTime,
        expiresAt: null,
        temporaryAccessPass: null,
        error: message,
      },
    };
  }
  if (outcome.status === "failed" || outcome.pass === null) {
    const message = outcome.error ?? "TAP creation failed without a pass value";
    await writeMfaAudit(options, ctx, caller, tenantId, "mfa.tap", userId, "failure", message);
    return {
      status: 200,
      body: {
        id: outcome.id ?? null,
        userId,
        status: "failed",
        lifetimeMinutes,
        oneTime,
        startTime,
        expiresAt: outcome.expiresAt,
        temporaryAccessPass: null,
        error: message,
      },
    };
  }
  // Persist the non-secret record only; the pass value is never stored.
  if (options.tapRecords) {
    await options.tapRecords.save({
      tenantId,
      userId,
      createdBy: caller.userId ?? null,
      lifetimeMinutes,
      oneTime,
      startTime,
    });
  }
  await writeMfaAudit(options, ctx, caller, tenantId, "mfa.tap", userId, "success", null);
  return {
    status: 200,
    body: {
      id: outcome.id,
      userId,
      status: "applied",
      lifetimeMinutes,
      oneTime,
      startTime,
      expiresAt: outcome.expiresAt,
      temporaryAccessPass: outcome.pass,
      error: null,
    },
  };
}

// ─── Push notification and default method (EPIC-012 SPEC §3.2, §4.2 US-4,
// US-5; T-0224) ─────────────────────────────────────────────────────────────
//
// Send push targets a registered Authenticator device; the provider refuses
// when no push-capable device is registered. The default method is accepted
// only from the user's registered set; anything else is a structured 4xx.
// Both are gated writes (confirm plus reason; dryRun plans only) and both are
// audited.

export const MFA_PUSH_PATH = "/v1/tenants/:tenantId/users/:userId/push";
export const MFA_DEFAULT_METHOD_PATH = "/v1/tenants/:tenantId/users/:userId/default-method";

export const MFA_ACTIONS_UNAVAILABLE = "mfa.actions_unavailable";
export const MFA_UNKNOWN_METHOD = "mfa.unknown_method";
export const MFA_NO_PUSH_DEVICE = "mfa.no_push_device";

export type MfaPushStatus = "applied" | "planned" | "failed";
export type MfaDefaultMethodStatus = "applied" | "planned" | "failed";

export interface MfaPushResult {
  readonly userId: string;
  readonly status: MfaPushStatus;
  readonly pushTarget: string | null;
  readonly error: string | null;
}

export interface MfaDefaultMethodResult {
  readonly userId: string;
  readonly status: MfaDefaultMethodStatus;
  readonly methods: readonly string[];
  readonly defaultMethod: string | null;
  readonly error: string | null;
}

export type MfaActionFailureCode = "unregistered_method" | "no_push_device";

export interface ProviderMfaActionOutcome {
  readonly status: "applied" | "failed";
  readonly methods?: readonly string[];
  readonly defaultMethod?: string | null;
  readonly pushTarget?: string | null;
  readonly error?: string | null;
  readonly code?: MfaActionFailureCode;
}

// Queue-backed seam for the push/default-method path: the production wiring
// enqueues one Invoke-MfaAction worker job and serves the outcome. Depending
// on the seam keeps Graph and process code out of the BFF.
export interface MfaActionProvider {
  sendPush(
    tenantId: string,
    userId: string,
    options: { dryRun: boolean },
  ): Promise<ProviderMfaActionOutcome>;
  setDefaultMethod(
    tenantId: string,
    userId: string,
    method: string,
    options: { dryRun: boolean },
  ): Promise<ProviderMfaActionOutcome>;
}

export async function postMfaPush(
  options: MfaRouteOptions,
  ctx: RequestContext,
  tenantId: string,
  caller: MfaCaller,
  userId: string,
): Promise<{ status: number; body: MfaPushResult }> {
  if (userId.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "userId is required", 400, [
      { field: "userId", reason: "required" },
    ]);
  }
  const body = readJsonBody(ctx, options.readBody);
  const dryRun = parseDryRun(body);
  const reason = parseReason(body);
  void reason;
  if (!dryRun) {
    parseConfirmed(body, "mfa.push");
  }
  if (dryRun) {
    return { status: 200, body: { userId, status: "planned", pushTarget: null, error: null } };
  }
  if (options.actions === undefined) {
    throw new AppError(MFA_ACTIONS_UNAVAILABLE, "MFA actions are not wired for this tenant", 501);
  }
  let outcome: ProviderMfaActionOutcome;
  try {
    outcome = await options.actions.sendPush(tenantId, userId, { dryRun: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "push failed without a provider result";
    const failed: MfaPushResult = { userId, status: "failed", pushTarget: null, error: message };
    await writeMfaAudit(options, ctx, caller, tenantId, "mfa.push", userId, "failure", message);
    return { status: 200, body: failed };
  }
  if (outcome.status === "failed") {
    if (outcome.code === "no_push_device") {
      throw new AppError(
        MFA_NO_PUSH_DEVICE,
        "no push-capable device is registered for this user",
        400,
        [{ field: "userId", reason: "no_push_device" }],
      );
    }
    const message = outcome.error ?? "push failed without a provider result";
    await writeMfaAudit(options, ctx, caller, tenantId, "mfa.push", userId, "failure", message);
    return { status: 200, body: { userId, status: "failed", pushTarget: null, error: message } };
  }
  await writeMfaAudit(options, ctx, caller, tenantId, "mfa.push", userId, "success", null);
  return {
    status: 200,
    body: { userId, status: "applied", pushTarget: outcome.pushTarget ?? null, error: null },
  };
}

export async function postMfaDefaultMethod(
  options: MfaRouteOptions,
  ctx: RequestContext,
  tenantId: string,
  caller: MfaCaller,
  userId: string,
): Promise<{ status: number; body: MfaDefaultMethodResult }> {
  if (userId.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "userId is required", 400, [
      { field: "userId", reason: "required" },
    ]);
  }
  const body = readJsonBody(ctx, options.readBody);
  const methodRaw = body["method"];
  if (typeof methodRaw !== "string" || methodRaw.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "method is required", 400, [
      { field: "method", reason: "required" },
    ]);
  }
  const method = methodRaw.trim();
  const dryRun = parseDryRun(body);
  const reason = parseReason(body);
  void reason;
  if (!dryRun) {
    parseConfirmed(body, "mfa.defaultMethod");
  }
  if (dryRun) {
    return {
      status: 200,
      body: { userId, status: "planned", methods: [], defaultMethod: method, error: null },
    };
  }
  if (options.actions === undefined) {
    throw new AppError(MFA_ACTIONS_UNAVAILABLE, "MFA actions are not wired for this tenant", 501);
  }
  let outcome: ProviderMfaActionOutcome;
  try {
    outcome = await options.actions.setDefaultMethod(tenantId, userId, method, { dryRun: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "default-method change failed without a provider result";
    const failed: MfaDefaultMethodResult = { userId, status: "failed", methods: [], defaultMethod: null, error: message };
    await writeMfaAudit(options, ctx, caller, tenantId, "mfa.defaultMethod", userId, "failure", message);
    return { status: 200, body: failed };
  }
  if (outcome.status === "failed") {
    if (outcome.code === "unregistered_method") {
      throw new AppError(
        MFA_UNKNOWN_METHOD,
        `method '${method}' is not in the user's registered set: ${(outcome.methods ?? []).join(", ")}`,
        400,
        [{ field: "method", reason: "unregistered" }],
      );
    }
    const message = outcome.error ?? "default-method change failed without a provider result";
    await writeMfaAudit(options, ctx, caller, tenantId, "mfa.defaultMethod", userId, "failure", message);
    return {
      status: 200,
      body: { userId, status: "failed", methods: outcome.methods ?? [], defaultMethod: null, error: message },
    };
  }
  await writeMfaAudit(options, ctx, caller, tenantId, "mfa.defaultMethod", userId, "success", null);
  return {
    status: 200,
    body: {
      userId,
      status: "applied",
      methods: outcome.methods ?? [],
      defaultMethod: outcome.defaultMethod ?? method,
      error: null,
    },
  };
}

export function createMfaRoutes(options: MfaRouteOptions): Route[] {
  const reportHandler = async (ctx: RequestContext): Promise<RouteResponse> => {
    const caller = requireCaller(options.resolveCaller, ctx);
    if (options.authorize) {
      await options.authorize(caller, MFA_PERMISSIONS.read);
    }
    const tenantId = requireTenantParam(ctx);
    requireTenantInScope(caller, tenantId);
    const filter = parseMfaReportFilter(ctx.query);
    const result = await getMfaReport(options.report, tenantId, filter);
    return { status: result.status, body: result.body };
  };
  const resetHandler = async (ctx: RequestContext): Promise<RouteResponse> => {
    const caller = requireCaller(options.resolveCaller, ctx);
    if (options.authorize) {
      await options.authorize(caller, MFA_PERMISSIONS.write);
    }
    const tenantId = requireTenantParam(ctx);
    requireTenantInScope(caller, tenantId);
    const userId = ctx.params["userId"] ?? "";
    const result = await postMfaReset(options, ctx, tenantId, caller, userId);
    return { status: result.status, body: result.body };
  };
  const bulkResetHandler = async (ctx: RequestContext): Promise<RouteResponse> => {
    const caller = requireCaller(options.resolveCaller, ctx);
    if (options.authorize) {
      await options.authorize(caller, MFA_PERMISSIONS.write);
    }
    const tenantId = requireTenantParam(ctx);
    requireTenantInScope(caller, tenantId);
    const result = await postMfaBulkReset(options, ctx, tenantId, caller);
    return { status: result.status, body: result.body };
  };
  const tapHandler = async (ctx: RequestContext): Promise<RouteResponse> => {
    const caller = requireCaller(options.resolveCaller, ctx);
    if (options.authorize) {
      await options.authorize(caller, MFA_PERMISSIONS.write);
    }
    const tenantId = requireTenantParam(ctx);
    requireTenantInScope(caller, tenantId);
    const userId = ctx.params["userId"] ?? "";
    const result = await postTap(options, ctx, tenantId, caller, userId);
    return { status: result.status, body: result.body };
  };
  const pushHandler = async (ctx: RequestContext): Promise<RouteResponse> => {
    const caller = requireCaller(options.resolveCaller, ctx);
    if (options.authorize) {
      await options.authorize(caller, MFA_PERMISSIONS.write);
    }
    const tenantId = requireTenantParam(ctx);
    requireTenantInScope(caller, tenantId);
    const userId = ctx.params["userId"] ?? "";
    const result = await postMfaPush(options, ctx, tenantId, caller, userId);
    return { status: result.status, body: result.body };
  };
  const defaultMethodHandler = async (ctx: RequestContext): Promise<RouteResponse> => {
    const caller = requireCaller(options.resolveCaller, ctx);
    if (options.authorize) {
      await options.authorize(caller, MFA_PERMISSIONS.write);
    }
    const tenantId = requireTenantParam(ctx);
    requireTenantInScope(caller, tenantId);
    const userId = ctx.params["userId"] ?? "";
    const result = await postMfaDefaultMethod(options, ctx, tenantId, caller, userId);
    return { status: result.status, body: result.body };
  };
  return [
    { method: "GET", path: MFA_REPORT_PATH, handler: reportHandler },
    { method: "POST", path: MFA_RESET_PATH, handler: resetHandler },
    { method: "POST", path: MFA_BULK_RESET_PATH, handler: bulkResetHandler },
    { method: "POST", path: MFA_TAP_PATH, handler: tapHandler },
    { method: "POST", path: MFA_PUSH_PATH, handler: pushHandler },
    { method: "POST", path: MFA_DEFAULT_METHOD_PATH, handler: defaultMethodHandler },
  ];
}

// Route modules own their OpenAPI path items (portal.v1.yaml `paths` is empty
// by design); a wiring ticket merges this fragment into the served document.
export const MFA_OPENAPI = {
  paths: {
    "/tenants/{tenantId}/mfa-report": {
      get: {
        operationId: "getMfaReport",
        summary: "MFA coverage report with per-user methods, default method, and phishing-resistant state",
        permission: MFA_PERMISSIONS.read,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "tenantId", in: "path", required: true, schema: { type: "string" } },
          {
            name: "registered",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["registered", "notRegistered"] },
          },
          { name: "method", in: "query", required: false, schema: { type: "string" } },
          {
            name: "phishingResistant",
            in: "query",
            required: false,
            schema: { type: "boolean" },
          },
          {
            name: "license",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["licensed", "unlicensed"] },
          },
          {
            name: "adminRole",
            in: "query",
            required: false,
            schema: { type: "boolean" },
          },
          { name: "cursor", in: "query", required: false, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer" } },
        ],
        responses: {
          "200": { description: "Per-user MFA rows with reconciling KPI aggregates." },
          "400": { description: "An unsupported filter value was supplied." },
          "401": { description: "Authentication required." },
          "403": { description: "The caller lacks mfa.read or the tenant is out of scope." },
        },
      },
    },
    "/tenants/{tenantId}/users/{userId}/mfa/reset": {
      post: {
        operationId: "resetUserMfa",
        summary: "Remove a user's authentication methods so re-registration is required (confirm plus reason; dryRun plans only)",
        permission: MFA_PERMISSIONS.write,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "tenantId", in: "path", required: true, schema: { type: "string" } },
          { name: "userId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "The applied (or planned) reset with the post-reset method state." },
          "400": { description: "Missing confirmation, reason, or invalid body." },
          "401": { description: "Authentication required." },
          "403": { description: "The caller lacks mfa.write or the tenant is out of scope." },
          "501": { description: "MFA reset is not wired for this tenant." },
        },
      },
    },
    "/tenants/{tenantId}/users/mfa/reset": {
      post: {
        operationId: "bulkResetUserMfa",
        summary: "Gated bulk MFA reset with an explicit batch count confirmation, audited per user",
        permission: MFA_PERMISSIONS.write,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "tenantId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Per-user reset outcomes with the applied/planned/failed summary." },
          "400": { description: "Missing confirmation, batch count, reason, or invalid body." },
          "401": { description: "Authentication required." },
          "403": { description: "The caller lacks mfa.write or the tenant is out of scope." },
          "501": { description: "MFA reset is not wired for this tenant." },
        },
      },
    },
    "/tenants/{tenantId}/users/{userId}/tap": {
      post: {
        operationId: "createTemporaryAccessPass",
        summary: "Create a Temporary Access Pass (shown once, never stored; confirm plus reason; dryRun plans only)",
        permission: MFA_PERMISSIONS.write,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "tenantId", in: "path", required: true, schema: { type: "string" } },
          { name: "userId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "The TAP metadata with the one-time value present only when applied." },
          "400": { description: "Missing confirmation, reason, invalid lifetime, or invalid body." },
          "401": { description: "Authentication required." },
          "403": { description: "The caller lacks mfa.write or the tenant is out of scope." },
          "501": { description: "TAP creation is not wired for this tenant." },
        },
      },
    },
    "/tenants/{tenantId}/users/{userId}/push": {
      post: {
        operationId: "sendMfaPush",
        summary: "Send an MFA push to a registered device (confirm plus reason; dryRun plans only)",
        permission: MFA_PERMISSIONS.write,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "tenantId", in: "path", required: true, schema: { type: "string" } },
          { name: "userId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "The push outcome with the targeted device." },
          "400": { description: "Missing confirmation, reason, no push-capable device, or invalid body." },
          "401": { description: "Authentication required." },
          "403": { description: "The caller lacks mfa.write or the tenant is out of scope." },
          "501": { description: "MFA actions are not wired for this tenant." },
        },
      },
    },
    "/tenants/{tenantId}/users/{userId}/default-method": {
      post: {
        operationId: "setMfaDefaultMethod",
        summary: "Change the default MFA method, accepted only from the registered set (confirm plus reason; dryRun plans only)",
        permission: MFA_PERMISSIONS.write,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "tenantId", in: "path", required: true, schema: { type: "string" } },
          { name: "userId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "The applied (or planned) default method with the registered set." },
          "400": { description: "Missing confirmation, reason, unregistered method, or invalid body." },
          "401": { description: "Authentication required." },
          "403": { description: "The caller lacks mfa.write or the tenant is out of scope." },
          "501": { description: "MFA actions are not wired for this tenant." },
        },
      },
    },
  },
} as const;
