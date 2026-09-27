// Intune policy list API (EPIC-016 SPEC.md §3.1, §6, §7; T-0301).
//
// Exposes GET /v1/tenants/:tenantId/intune/:kind
// where kind ∈ { configuration, compliance, app-protection }.
//
// v1 supports Windows configuration and compliance only.
// Unknown kinds return 400; known-but-unsupported kinds return 501.
// Requires RBAC `Endpoint.Intune.Read` and the tenant in caller scope (T-0013).
import { AppError, ErrorCodes } from "../errors.js";
import { parsePagination } from "../pagination.js";
import { requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";
import { isKnownKind, supportedEntriesForKind } from "../domain/intune-policy-types.js";

export const INTUNE_POLICIES_PATH = "/v1/tenants/:tenantId/intune/:kind";
export const INTUNE_POLICY_PATH = "/v1/tenants/:tenantId/intune/:kind/:policyId";
export const INTUNE_READ_PERMISSION = "Endpoint.Intune.Read";
export const INTUNE_WRITE_PERMISSION = "Endpoint.Intune.ReadWrite";
export const INTUNE_UNAUTHENTICATED = "request.unauthenticated";

export type IntunePlatformFilter = string;

export interface IntunePolicyAssignment {
  readonly id: string;
  readonly target: string;
  readonly targetType: string;
}

export interface IntunePolicyItem {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  /** e.g. "windows", "android", "ios", "macos" */
  readonly platform: string;
  /** Human-readable type label (from OData type or description). */
  readonly policyType: string;
  /** Number of assignment targets. */
  readonly assignedToCount: number;
  readonly assignments: readonly IntunePolicyAssignment[];
  readonly lastModifiedDateTime: string | null;
  readonly modifiedBy: string | null;
  /** Raw settings summary (key/value pairs). */
  readonly settingsSummary?: Record<string, unknown>;
}

export interface IntunePoliciesFilter {
  readonly platform?: string;
  readonly policyType?: string;
  readonly assigned?: boolean;
  readonly modifiedDate?: string;
  readonly search?: string;
  readonly cursor: string | null;
  readonly limit: number;
}

export interface IntunePoliciesPage {
  readonly tenantId: string;
  readonly kind: string;
  readonly totalCount: number;
  readonly items: readonly IntunePolicyItem[];
  readonly nextCursor: string | null;
}

/** One policy's full configuration (T-0829): Graph body minus identity fields, raw assignments. */
export interface IntunePolicyDetail {
  readonly id: string;
  readonly displayName: string;
  readonly platform: string;
  readonly body: Record<string, unknown>;
  readonly assignments: readonly unknown[];
}

export interface IntunePoliciesProvider {
  /** Single-policy read for the editor; undefined when the policy does not exist. */
  getPolicy?(tenantId: string, kind: string, policyId: string): Promise<IntunePolicyDetail | undefined>;
  listPolicies(
    tenantId: string,
    kind: string,
    filter: IntunePoliciesFilter,
  ): Promise<IntunePoliciesPage>;
}

export interface IntuneCaller extends Caller {
  readonly userId?: string;
  readonly permissions?: readonly string[];
}

export type IntuneAuthorizer = (
  caller: IntuneCaller,
  permission: string,
) => void | Promise<void>;

export interface IntunePoliciesRoutesOptions {
  readonly provider: IntunePoliciesProvider;
  readonly resolveCaller: (ctx: RequestContext) => IntuneCaller | undefined;
  readonly authorize?: IntuneAuthorizer;
}

function unauthenticatedError(): AppError {
  return new AppError(INTUNE_UNAUTHENTICATED, "authentication required", 401);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => IntuneCaller | undefined,
  ctx: RequestContext,
): IntuneCaller {
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

function requireKindParam(ctx: RequestContext): string {
  const value = ctx.params["kind"];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "kind is required", 400, [
      { field: "kind", reason: "required" },
    ]);
  }
  return value.trim().toLowerCase();
}

function optionalText(query: URLSearchParams, name: string): string | undefined {
  const value = query.get(name);
  if (value === null || value.length === 0) return undefined;
  return value;
}

function optionalBool(query: URLSearchParams, name: string): boolean | undefined {
  const value = query.get(name);
  if (value === null) return undefined;
  return value === "true";
}

async function authorizeRead(
  options: IntunePoliciesRoutesOptions,
  caller: IntuneCaller,
): Promise<void> {
  if (options.authorize) {
    await options.authorize(caller, INTUNE_READ_PERMISSION);
    return;
  }
  const permissions = caller.permissions ?? [];
  const allowed =
    permissions.includes(INTUNE_READ_PERMISSION) ||
    permissions.includes(INTUNE_WRITE_PERMISSION) ||
    permissions.includes("*");
  if (!allowed) {
    throw new AppError(
      ErrorCodes.forbidden,
      `forbidden: missing ${INTUNE_READ_PERMISSION}`,
      403,
    );
  }
}

export function parseIntunePoliciesFilter(query: URLSearchParams): IntunePoliciesFilter {
  const pagination = parsePagination(query);
  return {
    platform: optionalText(query, "platform"),
    policyType: optionalText(query, "policyType"),
    assigned: optionalBool(query, "assigned"),
    modifiedDate: optionalText(query, "modifiedDate"),
    search: optionalText(query, "search"),
    cursor: pagination.cursor,
    limit: pagination.limit,
  };
}

function requireSupportedKind(kind: string): void {
  if (!isKnownKind(kind)) {
    throw new AppError(
      ErrorCodes.validationFailed,
      `unknown Intune policy kind '${kind}'; supported: configuration, compliance, app-protection`,
      400,
      [{ field: "kind", reason: "unknown" }],
    );
  }
  const supportedEntries = supportedEntriesForKind(kind);
  if (supportedEntries === undefined || supportedEntries.length === 0) {
    throw new AppError(
      "intune.kind.unsupported",
      `Intune policy kind '${kind}' is not yet supported; supported kinds in v1: configuration (windows), compliance (windows)`,
      501,
    );
  }
}

export function createIntunePoliciesRoutes(options: IntunePoliciesRoutesOptions): Route[] {
  return [
    // GET /v1/tenants/:tenantId/intune/:kind
    {
      method: "GET",
      path: INTUNE_POLICIES_PATH,
      handler: async (ctx: RequestContext): Promise<RouteResponse> => {
        const caller = requireCaller(options.resolveCaller, ctx);
        const tenantId = requireTenantParam(ctx);
        const kind = requireKindParam(ctx);

        requireTenantInScope(caller, tenantId);
        await authorizeRead(options, caller);

        requireSupportedKind(kind);

        const filter = parseIntunePoliciesFilter(ctx.query);
        const page = await options.provider.listPolicies(tenantId, kind, filter);

        return {
          status: 200,
          body: page,
        };
      },
    },

    // GET /v1/tenants/:tenantId/intune/:kind/:policyId (T-0829)
    {
      method: "GET",
      path: INTUNE_POLICY_PATH,
      handler: async (ctx: RequestContext): Promise<RouteResponse> => {
        const caller = requireCaller(options.resolveCaller, ctx);
        const tenantId = requireTenantParam(ctx);
        const kind = requireKindParam(ctx);
        requireTenantInScope(caller, tenantId);
        await authorizeRead(options, caller);
        requireSupportedKind(kind);
        const policyId = ctx.params["policyId"]?.trim();
        if (!policyId) {
          throw new AppError(ErrorCodes.validationFailed, "policyId is required", 400, [
            { field: "policyId", reason: "required" },
          ]);
        }
        if (!options.provider.getPolicy) {
          throw new AppError("intune.detail.unsupported", "policy detail reads are not available", 501);
        }
        const policy = await options.provider.getPolicy(tenantId, kind, policyId);
        if (!policy) {
          throw new AppError(ErrorCodes.notFound, `${kind} policy '${policyId}' not found`, 404);
        }
        return { status: 200, body: policy };
      },
    },
  ];
}
