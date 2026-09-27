// Tenant user directory read (EPIC-011 SPEC §3.1, §3.2, §4.1, §6, §11.2).
// GET /v1/tenants/{id}/users lists, searches, and filters tenant users with
// the §3.1 columns (display name, UPN, type, licenses, MFA state, last
// sign-in, status, department) as a cursor-paginated page. The inactive,
// guest, and sign-in report views share this read: `?report=` maps onto the
// same provider call with preset filters. User objects are never mirrored;
// the injected provider is backed by the worker queue (T-0010) running the
// Get-TenantUsers child job live against Graph, so this module holds no Graph
// client and issues no tenant write. Reads require `Identity.User.Read` (SPEC §7)
// intersected with the caller tenant scope.
import { AppError, ErrorCodes } from "../errors.js";
import {
  UserCsvError,
  parseUserCsv,
  validateUserCreateRecord,
  type ParsedUserCreate,
} from "../domain/users/csv.js";
import {
  computeUserPatchDiff,
  validatePatchProperties,
  type PatchableUserProperty,
} from "../domain/users/patch.js";
import { parsePagination } from "../pagination.js";
import { requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const TENANT_USERS_PATH = "/v1/tenants/:tenantId/users";
export const USER_ACTION_PATH = "/v1/tenants/:tenantId/users/:userId/actions/:action";
export const USERS_PERMISSION = "Identity.User.Read";
export const USERS_WRITE_PERMISSION = "Identity.User.ReadWrite";

export const USERS_UNAUTHENTICATED = "request.unauthenticated";
export const USERS_REPORT_CONFLICT = "users.report_conflict";
export const USERS_CREATE_UNAVAILABLE = "users.create_unavailable";
export const USER_ACTION_UNKNOWN = "users.unknown_action";
export const USER_ACTION_CONFIRM_REQUIRED = "users.confirm_required";

export type TenantUserType = "member" | "guest";
export type TenantUserStatus = "enabled" | "disabled";
export type TenantUserLicense = "licensed" | "unlicensed";
export type TenantUserMfaState = "registered" | "notRegistered" | "unknown";
export type TenantUsersReport = "inactive" | "guest" | "signin";

export interface TenantUser {
  readonly id: string;
  readonly displayName: string | null;
  readonly userPrincipalName: string;
  readonly userType: TenantUserType;
  readonly licenses: readonly string[];
  readonly mfaState: TenantUserMfaState;
  readonly lastSignInDateTime: string | null;
  readonly status: TenantUserStatus;
  readonly department: string | null;
}

export interface TenantUsersFilter {
  readonly search?: string;
  readonly status?: TenantUserStatus;
  readonly type?: TenantUserType;
  readonly license?: TenantUserLicense;
  readonly mfaState?: TenantUserMfaState;
  readonly department?: string;
  readonly inactiveDays?: number;
  readonly report?: TenantUsersReport;
  readonly cursor: string | null;
  readonly limit: number;
}

export interface TenantUsersPage {
  readonly items: readonly TenantUser[];
  readonly nextCursor: string | null;
}

// Queue-backed seam for the directory read: the production wiring enqueues a
// tenant-users worker job for (tenantId, filter) and serves the worker page.
// Depending on the seam keeps Graph and process code out of the BFF.
export interface TenantUsersProvider {
  listUsers(tenantId: string, filter: TenantUsersFilter): Promise<TenantUsersPage>;
}

export interface UsersCaller extends Caller {
  readonly userId?: string;
}

export type UsersAuthorizer = (
  caller: UsersCaller,
  permission: string,
) => void | Promise<void>;

export interface TenantUsersRouteOptions {
  readonly provider: TenantUsersProvider;
  readonly resolveCaller: (ctx: RequestContext) => UsersCaller | undefined;
  readonly authorize?: UsersAuthorizer;
  readonly create?: UserCreateProvider;
  readonly execute?: UserActionProvider;
  readonly patch?: UserPatchProvider;
  readonly readBody?: (ctx: UsersCreateRequestContext) => unknown;
  readonly resolveExistingUpns?: (tenantId: string) => Promise<readonly string[]>;
  readonly knownLicenses?: readonly string[];
  readonly recordAudit?: (event: UserCreateAuditEvent | UserActionAuditEvent | UserPatchAuditEvent) => Promise<void>;
  readonly now?: () => string;
}

function unauthenticatedError(): AppError {
  return new AppError(USERS_UNAUTHENTICATED, "authentication required", 401);
}

function validationError(message: string, field: string): AppError {
  return new AppError(ErrorCodes.validationFailed, message, 400, [
    { field, reason: "invalid" },
  ]);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => UsersCaller | undefined,
  ctx: RequestContext,
): UsersCaller {
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

function parseEnum<T extends string>(
  query: URLSearchParams,
  name: string,
  allowed: readonly T[],
): T | undefined {
  const value = optionalText(query, name);
  if (value === undefined) {
    return undefined;
  }
  if (!(allowed as readonly string[]).includes(value)) {
    throw validationError(`${name} must be one of: ${allowed.join(", ")}`, name);
  }
  return value as T;
}

function parseInactiveDays(query: URLSearchParams): number | undefined {
  const value = optionalText(query, "inactiveDays");
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650) {
    throw validationError("inactiveDays must be an integer between 1 and 3650", "inactiveDays");
  }
  return parsed;
}

const USER_STATUSES: readonly TenantUserStatus[] = ["enabled", "disabled"];
const USER_TYPES: readonly TenantUserType[] = ["member", "guest"];
const USER_LICENSES: readonly TenantUserLicense[] = ["licensed", "unlicensed"];
const USER_MFA_STATES: readonly TenantUserMfaState[] = ["registered", "notRegistered", "unknown"];
const USER_REPORTS: readonly TenantUsersReport[] = ["inactive", "guest", "signin"];

export const DEFAULT_INACTIVE_REPORT_DAYS = 90;

export function parseTenantUsersFilter(query: URLSearchParams): TenantUsersFilter {
  const pagination = parsePagination(query);
  const report = parseEnum(query, "report", USER_REPORTS);
  const type = parseEnum(query, "type", USER_TYPES);
  if (report === "guest" && type !== undefined && type !== "guest") {
    throw new AppError(
      USERS_REPORT_CONFLICT,
      "report=guest cannot be combined with a non-guest type filter",
      400,
      [{ field: "type", reason: "conflict" }],
    );
  }
  const inactiveDays = parseInactiveDays(query);
  const search = optionalText(query, "search");
  const status = parseEnum(query, "status", USER_STATUSES);
  const license = parseEnum(query, "license", USER_LICENSES);
  const mfaState = parseEnum(query, "mfaState", USER_MFA_STATES);
  const department = optionalText(query, "department");
  const filter: { -readonly [K in keyof TenantUsersFilter]: TenantUsersFilter[K] } = {
    cursor: pagination.cursor,
    limit: pagination.limit,
  };
  if (search !== undefined) {
    filter.search = search;
  }
  if (status !== undefined) {
    filter.status = status;
  }
  if (license !== undefined) {
    filter.license = license;
  }
  if (mfaState !== undefined) {
    filter.mfaState = mfaState;
  }
  if (department !== undefined) {
    filter.department = department;
  }
  if (report === "guest") {
    filter.type = "guest";
  } else if (type !== undefined) {
    filter.type = type;
  }
  if (report === "inactive") {
    filter.report = report;
    filter.inactiveDays = inactiveDays ?? DEFAULT_INACTIVE_REPORT_DAYS;
  } else {
    if (inactiveDays !== undefined) {
      filter.inactiveDays = inactiveDays;
    }
    if (report !== undefined) {
      filter.report = report;
    }
  }
  return filter;
}

export async function getTenantUsers(
  provider: TenantUsersProvider,
  tenantId: string,
  filter: TenantUsersFilter,
): Promise<{ status: number; body: TenantUsersPage }> {
  if (tenantId.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "tenantId is required", 400, [
      { field: "tenantId", reason: "required" },
    ]);
  }
  const page = await provider.listUsers(tenantId, filter);
  return { status: 200, body: { items: [...page.items], nextCursor: page.nextCursor } };
}

export function createTenantUsersRoute(options: TenantUsersRouteOptions): Route[] {
  const getHandler = async (ctx: RequestContext): Promise<RouteResponse> => {
    const caller = requireCaller(options.resolveCaller, ctx);
    if (options.authorize) {
      await options.authorize(caller, USERS_PERMISSION);
    }
    const tenantId = requireTenantParam(ctx);
    requireTenantInScope(caller, tenantId);
    const filter = parseTenantUsersFilter(ctx.query);
    const result = await getTenantUsers(options.provider, tenantId, filter);
    return { status: result.status, body: result.body };
  };
  const postHandler = async (ctx: RequestContext): Promise<RouteResponse> => {
    const caller = requireCaller(options.resolveCaller, ctx);
    if (options.authorize) {
      await options.authorize(caller, USERS_WRITE_PERMISSION);
    }
    const tenantId = requireTenantParam(ctx);
    requireTenantInScope(caller, tenantId);
    const result = await postTenantUsers(options, ctx, tenantId, caller);
    return { status: result.status, body: result.body };
  };
  const postActionHandler = async (ctx: RequestContext): Promise<RouteResponse> => {
    const caller = requireCaller(options.resolveCaller, ctx);
    if (options.authorize) {
      await options.authorize(caller, USERS_WRITE_PERMISSION);
    }
    const tenantId = requireTenantParam(ctx);
    requireTenantInScope(caller, tenantId);
    const userId = ctx.params["userId"] ?? "";
    const action = ctx.params["action"] ?? "";
    const result = await postUserAction(options, ctx, tenantId, caller, userId, action);
    return { status: result.status, body: result.body };
  };
  const postPatchHandler = async (ctx: RequestContext): Promise<RouteResponse> => {
    const caller = requireCaller(options.resolveCaller, ctx);
    if (options.authorize) {
      await options.authorize(caller, USERS_WRITE_PERMISSION);
    }
    const tenantId = requireTenantParam(ctx);
    requireTenantInScope(caller, tenantId);
    const result = await postUsersBulkPatch(options, ctx, tenantId, caller);
    return { status: result.status, body: result.body };
  };
  return [
    { method: "GET", path: TENANT_USERS_PATH, handler: getHandler },
    { method: "POST", path: TENANT_USERS_PATH, handler: postHandler },
    { method: "POST", path: USER_ACTION_PATH, handler: postActionHandler },
    { method: "POST", path: USERS_BULK_PATCH_PATH, handler: postPatchHandler },
  ];
}

// ─── User create: single + bulk (EPIC-011 SPEC §4.1 US-2; T-0202) ─────────────
//
// Single create is form → plan → apply; bulk create is CSV upload (or a JSON
// users array) → validate → plan → apply per row. Validation lives in
// ../domain/users/csv.ts so the form path and the bulk path share one rule
// implementation: a row that fails validation is reported per row and is never
// forwarded to the provider, so a validation failure can never become a
// partial apply. Rows that pass validation are applied one by one through the
// injected provider — the production wiring enqueues a New-TenantUser worker
// job per row through the EPIC-006 gated executor — and a row that fails at
// apply time is reported per row without aborting its siblings.
//
// `dryRun: true` plans only: validation plus the would-be rows, no provider
// call, no audit record. Every applied row (created or failed) emits one audit
// event through the optional recordAudit seam.

export type UserCreateRowStatus = "created" | "planned" | "failed";

export interface UserCreateRowResult {
  readonly row: number;
  readonly userPrincipalName: string;
  readonly status: UserCreateRowStatus;
  readonly id: string | null;
  readonly error: string | null;
}

export interface UserCreateSummary {
  readonly total: number;
  readonly created: number;
  readonly planned: number;
  readonly failed: number;
}

export interface UserCreateResponse {
  readonly rows: readonly UserCreateRowResult[];
  readonly summary: UserCreateSummary;
}

export interface ProviderCreateRowResult {
  readonly userPrincipalName: string;
  readonly status: "created" | "failed";
  readonly id?: string | null;
  readonly error?: string | null;
}

// Queue-backed seam for the create path: the production wiring enqueues one
// New-TenantUser worker job per input user and serves the per-row outcomes.
// Results align positionally with the input users array. Depending on the seam
// keeps Graph and process code out of the BFF.
export interface UserCreateProvider {
  createUsers(
    tenantId: string,
    users: readonly ParsedUserCreate[],
    options: { dryRun: boolean },
  ): Promise<readonly ProviderCreateRowResult[]>;
}

export interface UserCreateAuditEvent {
  readonly tenantId: string;
  readonly action: "users.create";
  readonly targetId: string | null;
  readonly userPrincipalName: string;
  readonly result: "success" | "failure";
  readonly error: string | null;
  readonly actorUserId: string | null;
  readonly correlationId: string;
  readonly createdAt: string;
}

export interface UsersCreateRequestContext extends RequestContext {
  readonly body?: unknown;
}

function readCreateBody(
  ctx: RequestContext,
  readBody: ((ctx: UsersCreateRequestContext) => unknown) | undefined,
): unknown {
  let body = readBody ? readBody(ctx as UsersCreateRequestContext) : (ctx as UsersCreateRequestContext).body;
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

function optionalCreateText(record: Record<string, unknown>, name: string): string | undefined {
  const value = record[name];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw validationError(`${name} must be a string`, name);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

interface StagedCreateRow {
  readonly row: number;
  readonly record: Record<string, unknown>;
}

function stageCreateRows(body: Record<string, unknown>): { rows: StagedCreateRow[]; dryRun: boolean; defaultUsageLocation: string | undefined } {
  const hasUsers = body["users"] !== undefined;
  const hasCsv = body["csv"] !== undefined;
  if (hasUsers && hasCsv) {
    throw validationError("provide either 'users' or 'csv', not both", "users");
  }
  const dryRunRaw = body["dryRun"];
  if (dryRunRaw !== undefined && typeof dryRunRaw !== "boolean") {
    throw validationError("dryRun must be a boolean", "dryRun");
  }
  const dryRun = dryRunRaw === true;
  const defaultUsageLocation = optionalCreateText(body, "defaultUsageLocation");
  if (hasCsv) {
    if (typeof body["csv"] !== "string") {
      throw validationError("csv must be a string", "csv");
    }
    return { rows: [{ row: 0, record: { __csv: body["csv"] } }], dryRun, defaultUsageLocation };
  }
  if (hasUsers) {
    if (!Array.isArray(body["users"]) || body["users"].length === 0) {
      throw validationError("users must be a non-empty array", "users");
    }
    return {
      rows: (body["users"] as unknown[]).map((entry, index) => {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
          throw validationError(`users[${index}] must be an object`, "users");
        }
        return { row: index + 1, record: entry as Record<string, unknown> };
      }),
      dryRun,
      defaultUsageLocation,
    };
  }
  return { rows: [{ row: 1, record: body }], dryRun, defaultUsageLocation };
}

function toSummary(rows: readonly UserCreateRowResult[]): UserCreateSummary {
  return {
    total: rows.length,
    created: rows.filter((row) => row.status === "created").length,
    planned: rows.filter((row) => row.status === "planned").length,
    failed: rows.filter((row) => row.status === "failed").length,
  };
}

export async function postTenantUsers(
  options: TenantUsersRouteOptions,
  ctx: RequestContext,
  tenantId: string,
  caller: UsersCaller,
): Promise<{ status: number; body: UserCreateResponse }> {
  const body = readCreateBody(ctx, options.readBody) as Record<string, unknown>;
  const staged = stageCreateRows(body);
  const knownLicenses = options.knownLicenses;
  let existingUpns: readonly string[] | undefined;
  if (options.resolveExistingUpns) {
    existingUpns = await options.resolveExistingUpns(tenantId);
  }

  // CSV mode delegates parsing (including within-file duplicate detection) to
  // the domain module; JSON modes validate each record the same way.
  let validated: Array<{ row: number; user: ParsedUserCreate | null; errors: string[]; userPrincipalName: string }>;
  if (staged.rows.length === 1 && staged.rows[0]!.record["__csv"] !== undefined) {
    let parsed;
    try {
      parsed = parseUserCsv(staged.rows[0]!.record["__csv"] as string, {
        defaultUsageLocation: staged.defaultUsageLocation,
        knownLicenses,
        existingUpns,
      });
    } catch (error) {
      if (error instanceof UserCsvError) {
        throw new AppError(ErrorCodes.validationFailed, error.message, 400, [
          { field: "csv", reason: "invalid" },
        ]);
      }
      throw error;
    }
    validated = parsed.rows.map((row) => ({
      row: row.row,
      user: row.user,
      errors: [...row.errors],
      userPrincipalName: row.userPrincipalName.length > 0 ? row.userPrincipalName : `row ${row.row}`,
    }));
  } else {
    const seen = new Map<string, number>();
    validated = staged.rows.map((stagedRow) => {
      const { errors, user } = validateUserCreateRecord(stagedRow.record, {
        defaultUsageLocation: staged.defaultUsageLocation,
        knownLicenses,
      });
      const rowErrors = [...errors];
      const rawUpn = stagedRow.record["userPrincipalName"];
      const upn = user?.userPrincipalName ?? (typeof rawUpn === "string" ? rawUpn.trim() : "");
      if (user !== null) {
        const key = user.userPrincipalName.toLowerCase();
        const first = seen.get(key);
        if (first !== undefined) {
          rowErrors.push(`userPrincipalName '${user.userPrincipalName}' duplicates row ${first}`);
        } else {
          seen.set(key, stagedRow.row);
        }
        if (
          existingUpns !== undefined &&
          existingUpns.some((existing) => existing.toLowerCase() === key)
        ) {
          rowErrors.push(`userPrincipalName '${user.userPrincipalName}' already exists in the tenant`);
        }
      }
      return {
        row: stagedRow.row,
        user: rowErrors.length > 0 ? null : user,
        errors: rowErrors,
        userPrincipalName: upn.length > 0 ? upn : `row ${stagedRow.row}`,
      };
    });
  }

  const valid = validated.filter((entry) => entry.user !== null);
  if (staged.dryRun) {
    const rows: UserCreateRowResult[] = validated.map((entry) =>
      entry.user === null
        ? { row: entry.row, userPrincipalName: entry.userPrincipalName, status: "failed", id: null, error: entry.errors.join("; ") }
        : { row: entry.row, userPrincipalName: entry.userPrincipalName, status: "planned", id: null, error: null },
    );
    return { status: 200, body: { rows, summary: toSummary(rows) } };
  }

  if (valid.length > 0 && options.create === undefined) {
    throw new AppError(USERS_CREATE_UNAVAILABLE, "user create is not wired for this tenant", 501);
  }
  let applied: readonly ProviderCreateRowResult[] = [];
  if (valid.length > 0) {
    applied = await options.create!.createUsers(
      tenantId,
      valid.map((entry) => entry.user!),
      { dryRun: false },
    );
  }
  const appliedByUpn = new Map(applied.map((result) => [result.userPrincipalName.toLowerCase(), result]));
  const now = options.now ?? (() => new Date().toISOString());
  const rows: UserCreateRowResult[] = [];
  for (const entry of validated) {
    if (entry.user === null) {
      rows.push({
        row: entry.row,
        userPrincipalName: entry.userPrincipalName,
        status: "failed",
        id: null,
        error: entry.errors.join("; "),
      });
      continue;
    }
    const outcome = appliedByUpn.get(entry.userPrincipalName.toLowerCase());
    if (outcome === undefined || outcome.status === "failed") {
      const error = outcome?.error ?? "create failed without a provider result";
      rows.push({ row: entry.row, userPrincipalName: entry.userPrincipalName, status: "failed", id: null, error });
      if (options.recordAudit) {
        await options.recordAudit({
          tenantId,
          action: "users.create",
          targetId: null,
          userPrincipalName: entry.userPrincipalName,
          result: "failure",
          error,
          actorUserId: caller.userId ?? null,
          correlationId: ctx.correlationId,
          createdAt: now(),
        });
      }
      continue;
    }
    rows.push({
      row: entry.row,
      userPrincipalName: entry.userPrincipalName,
      status: "created",
      id: outcome.id ?? null,
      error: null,
    });
    if (options.recordAudit) {
      await options.recordAudit({
        tenantId,
        action: "users.create",
        targetId: outcome.id ?? null,
        userPrincipalName: entry.userPrincipalName,
        result: "success",
        error: null,
        actorUserId: caller.userId ?? null,
        correlationId: ctx.correlationId,
        createdAt: now(),
      });
    }
  }
  return { status: 200, body: { rows, summary: toSummary(rows) } };
}

// ─── Lifecycle actions (EPIC-011 SPEC §3.1, §4.3 US-4; T-0204) ───────────────
//
// Reset password, require password change, revoke sessions, disable/enable,
// and restore of a soft-deleted user are each a gated write: the route
// confirms (destructive and session-breaking actions need an explicit
// `confirm: true`), the injected provider applies through the EPIC-006-gated
// New-TenantUser-style worker path with before/after capture, and every
// applied action emits one audit event. `dryRun: true` plans only. Reset
// password returns a one-time value in the response transport; the route never
// persists or logs it. Unknown action names are rejected with a structured
// 400, never passed through.

export const USER_LIFECYCLE_ACTIONS = [
  "resetPassword",
  "requirePasswordChange",
  "revokeSessions",
  "disable",
  "enable",
  "restore",
] as const;

export type UserLifecycleAction = (typeof USER_LIFECYCLE_ACTIONS)[number];

const ACTIONS_REQUIRING_CONFIRM: readonly UserLifecycleAction[] = [
  "revokeSessions",
  "disable",
  "restore",
];

export type UserActionRowStatus = "applied" | "planned" | "failed";

export interface UserActionResult {
  readonly userId: string;
  readonly action: UserLifecycleAction;
  readonly status: UserActionRowStatus;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  readonly password: string | null;
  readonly error: string | null;
}

export interface ProviderActionResult {
  readonly status: "applied" | "failed";
  readonly before?: Record<string, unknown> | null;
  readonly after?: Record<string, unknown> | null;
  readonly password?: string | null;
  readonly error?: string | null;
}

// Queue-backed seam for the action path: the production wiring enqueues one
// Invoke-UserAction worker job and serves the outcome. Depending on the seam
// keeps Graph and process code out of the BFF.
export interface UserActionProvider {
  executeAction(
    tenantId: string,
    userId: string,
    action: UserLifecycleAction,
    options: { dryRun: boolean; password?: string },
  ): Promise<ProviderActionResult>;
}

export interface UserActionAuditEvent {
  readonly tenantId: string;
  readonly action: "users.action";
  readonly targetId: string;
  readonly lifecycleAction: UserLifecycleAction;
  readonly result: "success" | "failure";
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  readonly error: string | null;
  readonly actorUserId: string | null;
  readonly correlationId: string;
  readonly createdAt: string;
}

export function parseUserLifecycleAction(value: unknown): UserLifecycleAction {
  if (typeof value !== "string" || !(USER_LIFECYCLE_ACTIONS as readonly string[]).includes(value)) {
    throw new AppError(
      USER_ACTION_UNKNOWN,
      `unknown user action '${typeof value === "string" ? value : typeof value}'; expected one of: ${USER_LIFECYCLE_ACTIONS.join(", ")}`,
      400,
      [{ field: "action", reason: "unknown" }],
    );
  }
  return value as UserLifecycleAction;
}

export async function postUserAction(
  options: TenantUsersRouteOptions,
  ctx: RequestContext,
  tenantId: string,
  caller: UsersCaller,
  userId: string,
  actionRaw: string,
): Promise<{ status: number; body: UserActionResult }> {
  const action = parseUserLifecycleAction(actionRaw);
  if (userId.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "userId is required", 400, [
      { field: "userId", reason: "required" },
    ]);
  }
  const body = readCreateBody(ctx, options.readBody) as Record<string, unknown>;
  const dryRunRaw = body["dryRun"];
  if (dryRunRaw !== undefined && typeof dryRunRaw !== "boolean") {
    throw validationError("dryRun must be a boolean", "dryRun");
  }
  const confirmRaw = body["confirm"];
  if (confirmRaw !== undefined && typeof confirmRaw !== "boolean") {
    throw validationError("confirm must be a boolean", "confirm");
  }
  const dryRun = dryRunRaw === true;
  const confirmed = confirmRaw === true;
  if (!dryRun && ACTIONS_REQUIRING_CONFIRM.includes(action) && !confirmed) {
    throw new AppError(
      USER_ACTION_CONFIRM_REQUIRED,
      `action '${action}' breaks sessions or removes access and requires { "confirm": true }`,
      400,
      [{ field: "confirm", reason: "required" }],
    );
  }
  let password: string | undefined;
  if (body["password"] !== undefined) {
    if (typeof body["password"] !== "string" || body["password"].length === 0) {
      throw validationError("password must be a non-empty string when provided", "password");
    }
    password = body["password"];
  }

  if (dryRun) {
    return {
      status: 200,
      body: {
        userId,
        action,
        status: "planned",
        before: null,
        after: null,
        password: null,
        error: null,
      },
    };
  }
  if (options.execute === undefined) {
    throw new AppError(USERS_CREATE_UNAVAILABLE, "user actions are not wired for this tenant", 501);
  }
  let outcome: ProviderActionResult;
  try {
    outcome = await options.execute.executeAction(tenantId, userId, action, { dryRun: false, password });
  } catch (error) {
    const message = error instanceof Error ? error.message : "action failed without a provider result";
    const failed: UserActionResult = { userId, action, status: "failed", before: null, after: null, password: null, error: message };
    await writeActionAudit(options, ctx, caller, tenantId, userId, action, failed);
    return { status: 200, body: failed };
  }
  const result: UserActionResult =
    outcome.status === "failed"
      ? {
          userId,
          action,
          status: "failed",
          before: outcome.before ?? null,
          after: outcome.after ?? null,
          password: null,
          error: outcome.error ?? "action failed without a provider result",
        }
      : {
          userId,
          action,
          status: "applied",
          before: outcome.before ?? null,
          after: outcome.after ?? null,
          password: outcome.password ?? null,
          error: null,
        };
  await writeActionAudit(options, ctx, caller, tenantId, userId, action, result);
  return { status: 200, body: result };
}

async function writeActionAudit(
  options: TenantUsersRouteOptions,
  ctx: RequestContext,
  caller: UsersCaller,
  tenantId: string,
  userId: string,
  action: UserLifecycleAction,
  result: UserActionResult,
): Promise<void> {
  if (!options.recordAudit) {
    return;
  }
  const now = options.now ?? (() => new Date().toISOString());
  await options.recordAudit({
    tenantId,
    action: "users.action",
    targetId: userId,
    lifecycleAction: action,
    result: result.status === "applied" ? "success" : "failure",
    before: result.before,
    after: result.after,
    error: result.error,
    actorUserId: caller.userId ?? null,
    correlationId: ctx.correlationId,
    createdAt: now(),
  });
}

// ─── Bulk patch wizard (EPIC-011 SPEC §3.3, §4.2 US-3; T-0203) ──────────────
//
// Select users → choose properties → preview the diff → apply. `preview: true`
// returns the per-user diff with no tenant write; the apply call runs each
// patch through the EPIC-006-gated worker path and records before/after plus
// an audit record per patched row. Desired properties are validated here
// against the patch.ts catalogue: unknown properties and bad values fail the
// row and are never forwarded. A row that turns invalid between preview and
// apply is reported as a per-row failure, never skipped silently.

export const USERS_BULK_PATCH_PATH = "/v1/tenants/:tenantId/users/bulk-patch";

export type UserPatchRowStatus = "patched" | "previewed" | "failed";

export interface UserPatchRowResult {
  readonly userId: string;
  readonly status: UserPatchRowStatus;
  readonly diffs: ReadonlyArray<{ property: PatchableUserProperty; before: string | null; after: string | null }>;
  readonly error: string | null;
}

export interface UserPatchSummary {
  readonly total: number;
  readonly patched: number;
  readonly previewed: number;
  readonly failed: number;
}

export interface UserPatchResponse {
  readonly rows: readonly UserPatchRowResult[];
  readonly summary: UserPatchSummary;
}

export interface ProviderPatchOutcome {
  readonly userId: string;
  readonly status: "patched" | "failed";
  readonly before?: Record<string, unknown> | null;
  readonly after?: Record<string, unknown> | null;
  readonly error?: string | null;
}

// Queue-backed seam for the patch path: the production wiring enqueues one
// worker job per input row and serves the per-row before/after snapshots. The
// route diffs those snapshots through patch.ts. Results align positionally
// with the input rows. Depending on the seam keeps Graph code out of the BFF.
export interface UserPatchProvider {
  patchUsers(
    tenantId: string,
    patches: ReadonlyArray<{ userId: string; properties: Partial<Record<PatchableUserProperty, string | null>> }>,
    options: { preview: boolean },
  ): Promise<readonly ProviderPatchOutcome[]>;
}

export interface UserPatchAuditEvent {
  readonly tenantId: string;
  readonly action: "users.patch";
  readonly targetId: string;
  readonly result: "success" | "failure";
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  readonly error: string | null;
  readonly actorUserId: string | null;
  readonly correlationId: string;
  readonly createdAt: string;
}

export async function postUsersBulkPatch(
  options: TenantUsersRouteOptions,
  ctx: RequestContext,
  tenantId: string,
  caller: UsersCaller,
): Promise<{ status: number; body: UserPatchResponse }> {
  const body = readCreateBody(ctx, options.readBody) as Record<string, unknown>;
  if (!Array.isArray(body["users"]) || body["users"].length === 0) {
    throw validationError("users must be a non-empty array", "users");
  }
  const previewRaw = body["preview"];
  if (previewRaw !== undefined && typeof previewRaw !== "boolean") {
    throw validationError("preview must be a boolean", "preview");
  }
  const preview = previewRaw === true;

  const staged = (body["users"] as unknown[]).map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return { userId: `row ${index + 1}`, valid: null as null | { userId: string; properties: Partial<Record<PatchableUserProperty, string | null>> }, errors: [`users[${index}] must be an object`] };
    }
    const record = entry as Record<string, unknown>;
    const userId = typeof record["userId"] === "string" ? record["userId"].trim() : "";
    if (userId.length === 0) {
      return { userId: `row ${index + 1}`, valid: null, errors: [`users[${index}].userId is required`] };
    }
    const { errors, properties } = validatePatchProperties(record["properties"]);
    if (errors.length > 0) {
      return { userId, valid: null, errors };
    }
    return { userId, valid: { userId, properties }, errors: [] as string[] };
  });

  const applicable = staged.filter((entry) => entry.valid !== null);
  let outcomes: readonly ProviderPatchOutcome[] = [];
  if (applicable.length > 0) {
    if (options.patch === undefined) {
      throw new AppError(USERS_CREATE_UNAVAILABLE, "user patch is not wired for this tenant", 501);
    }
    outcomes = await options.patch.patchUsers(
      tenantId,
      applicable.map((entry) => entry.valid!),
      { preview },
    );
  }
  const outcomeByUser = new Map(outcomes.map((outcome) => [outcome.userId, outcome]));
  const now = options.now ?? (() => new Date().toISOString());
  const rows: UserPatchRowResult[] = [];
  for (const entry of staged) {
    if (entry.valid === null) {
      rows.push({ userId: entry.userId, status: "failed", diffs: [], error: entry.errors.join("; ") });
      continue;
    }
    const outcome = outcomeByUser.get(entry.userId);
    if (outcome === undefined || outcome.status === "failed") {
      const error = outcome?.error ?? "patch failed without a provider result";
      rows.push({ userId: entry.userId, status: "failed", diffs: [], error });
      if (!preview && options.recordAudit) {
        await options.recordAudit({
          tenantId,
          action: "users.patch",
          targetId: entry.userId,
          result: "failure",
          before: outcome?.before ?? null,
          after: outcome?.after ?? null,
          error,
          actorUserId: caller.userId ?? null,
          correlationId: ctx.correlationId,
          createdAt: now(),
        });
      }
      continue;
    }
    const diffs = computeUserPatchDiff(outcome.before ?? {}, outcome.after ?? {});
    if (preview) {
      rows.push({ userId: entry.userId, status: "previewed", diffs, error: null });
      continue;
    }
    rows.push({ userId: entry.userId, status: "patched", diffs, error: null });
    if (options.recordAudit) {
      await options.recordAudit({
        tenantId,
        action: "users.patch",
        targetId: entry.userId,
        result: "success",
        before: outcome.before ?? null,
        after: outcome.after ?? null,
        error: null,
        actorUserId: caller.userId ?? null,
        correlationId: ctx.correlationId,
        createdAt: now(),
      });
    }
  }
  return {
    status: 200,
    body: {
      rows,
      summary: {
        total: rows.length,
        patched: rows.filter((row) => row.status === "patched").length,
        previewed: rows.filter((row) => row.status === "previewed").length,
        failed: rows.filter((row) => row.status === "failed").length,
      },
    },
  };
}

// Route modules own their OpenAPI path items (portal.v1.yaml `paths` is empty
// by design); a wiring ticket merges this fragment into the served document.
export const USERS_OPENAPI = {
  paths: {
    "/tenants/{tenantId}/users": {
      get: {
        operationId: "listTenantUsers",
        summary: "List, search, and filter tenant users (filter: status/type/license/mfaState/department/sign-in age/report)",
        permission: USERS_PERMISSION,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "tenantId", in: "path", required: true, schema: { type: "string" } },
          { name: "search", in: "query", required: false, schema: { type: "string" } },
          {
            name: "status",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["enabled", "disabled"] },
          },
          {
            name: "type",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["member", "guest"] },
          },
          {
            name: "license",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["licensed", "unlicensed"] },
          },
          {
            name: "mfaState",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["registered", "notRegistered", "unknown"] },
          },
          { name: "department", in: "query", required: false, schema: { type: "string" } },
          {
            name: "inactiveDays",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 3650 },
          },
          {
            name: "report",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["inactive", "guest", "signin"] },
          },
          { name: "cursor", in: "query", required: false, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer" } },
        ],
        responses: {
          "200": { description: "Cursor-paginated users with the §3.1 columns." },
          "400": { description: "An unsupported filter value was supplied." },
          "401": { description: "Authentication required." },
          "403": { description: "The caller lacks users.read or the tenant is out of scope." },
        },
      },
      post: {
        operationId: "createTenantUsers",
        summary: "Create one user or bulk-create from CSV/JSON with per-row results (dryRun plans only)",
        permission: USERS_WRITE_PERMISSION,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "tenantId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Per-row create outcomes; a row failure never aborts its siblings." },
          "400": { description: "The request shape or CSV is invalid." },
          "401": { description: "Authentication required." },
          "403": { description: "The caller lacks users.write or the tenant is out of scope." },
          "501": { description: "User create is not wired for this tenant." },
        },
      },
    },
    "/tenants/{tenantId}/users/{userId}/actions/{action}": {
      post: {
        operationId: "executeUserAction",
        summary: "Run a lifecycle action (resetPassword, requirePasswordChange, revokeSessions, disable, enable, restore)",
        permission: USERS_WRITE_PERMISSION,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "tenantId", in: "path", required: true, schema: { type: "string" } },
          { name: "userId", in: "path", required: true, schema: { type: "string" } },
          {
            name: "action",
            in: "path",
            required: true,
            schema: {
              type: "string",
              enum: ["resetPassword", "requirePasswordChange", "revokeSessions", "disable", "enable", "restore"],
            },
          },
        ],
        responses: {
          "200": { description: "The applied (or planned) action with before/after capture." },
          "400": { description: "Unknown action, missing confirmation, or invalid body." },
          "401": { description: "Authentication required." },
          "403": { description: "The caller lacks users.write or the tenant is out of scope." },
          "501": { description: "User actions are not wired for this tenant." },
        },
      },
    },
    "/tenants/{tenantId}/users/bulk-patch": {
      post: {
        operationId: "bulkPatchTenantUsers",
        summary: "Preview or apply bulk property patches with a per-user diff",
        permission: USERS_WRITE_PERMISSION,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "tenantId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Per-user patch outcomes with the before/after diff." },
          "400": { description: "The request shape or a property value is invalid." },
          "401": { description: "Authentication required." },
          "403": { description: "The caller lacks users.write or the tenant is out of scope." },
          "501": { description: "User patch is not wired for this tenant." },
        },
      },
    },
  },
} as const;
