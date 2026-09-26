// CA policies read API (EPIC-015 SPEC.md §3.1, §6, §7; T-0281).
// Exposes GET /v1/tenants/:tenantId/ca/policies with §3.1 columns:
// Name, State, Users targeted, Apps, Grant/block controls, Conditions, Modified, Modified by
// and filters (state, target, control, condition, modified date, search).
// Requires RBAC `ca.read` and tenant in caller scope.
import { AppError, ErrorCodes } from "../errors.js";
import { parsePagination } from "../pagination.js";
import { requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const CA_POLICIES_PATH = "/v1/tenants/:tenantId/ca/policies";
export const CA_READ_PERMISSION = "ca.read";
export const CA_UNAUTHENTICATED = "request.unauthenticated";

export type CaPolicyState = "enabled" | "disabled" | "enabledForReportingButNotEnforced";

export interface CaPolicyUsersTargeted {
  readonly includeUsers: readonly string[];
  readonly excludeUsers: readonly string[];
  readonly includeGroups: readonly string[];
  readonly excludeGroups: readonly string[];
  readonly includeRoles: readonly string[];
  readonly excludeRoles: readonly string[];
  readonly summary: string;
}

export interface CaPolicyAppsTargeted {
  readonly includeApplications: readonly string[];
  readonly excludeApplications: readonly string[];
  readonly summary: string;
}

export interface CaPolicyGrantControls {
  readonly operator: string;
  readonly builtInControls: readonly string[];
  readonly authenticationStrength?: unknown;
  readonly summary: string;
}

export interface CaPolicyConditions {
  readonly clientAppTypes: readonly string[];
  readonly platforms?: unknown;
  readonly locations?: unknown;
  readonly signInRiskLevels: readonly string[];
  readonly userRiskLevels: readonly string[];
  readonly devices?: unknown;
  readonly summary: string;
}

export interface CaPolicyItem {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly state: CaPolicyState | string;
  readonly usersTargeted: CaPolicyUsersTargeted;
  readonly apps: CaPolicyAppsTargeted;
  readonly grantControls: CaPolicyGrantControls;
  readonly sessionControls?: Record<string, unknown>;
  readonly conditions: CaPolicyConditions;
  readonly createdDateTime?: string | null;
  readonly modifiedDateTime?: string | null;
  readonly modifiedBy?: string | null;
}

export interface CaPoliciesFilter {
  readonly state?: string;
  readonly target?: string;
  readonly control?: string;
  readonly condition?: string;
  readonly modifiedDate?: string;
  readonly search?: string;
  readonly cursor: string | null;
  readonly limit: number;
}

export interface CaPoliciesPage {
  readonly tenantId: string;
  readonly totalCount: number;
  readonly items: readonly CaPolicyItem[];
  readonly nextCursor: string | null;
}

export interface CaPoliciesProvider {
  listPolicies(tenantId: string, filter: CaPoliciesFilter): Promise<CaPoliciesPage>;
}

export interface CaCaller extends Caller {
  readonly userId?: string;
}

export type CaAuthorizer = (
  caller: CaCaller,
  permission: string,
) => void | Promise<void>;

export interface CaPoliciesRouteOptions {
  readonly provider: CaPoliciesProvider;
  readonly resolveCaller: (ctx: RequestContext) => CaCaller | undefined;
  readonly authorize?: CaAuthorizer;
}

function unauthenticatedError(): AppError {
  return new AppError(CA_UNAUTHENTICATED, "authentication required", 401);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => CaCaller | undefined,
  ctx: RequestContext,
): CaCaller {
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

export function parseCaPoliciesFilter(query: URLSearchParams): CaPoliciesFilter {
  const pagination = parsePagination(query);
  const state = optionalText(query, "state");
  const target = optionalText(query, "target");
  const control = optionalText(query, "control");
  const condition = optionalText(query, "condition");
  const modifiedDate = optionalText(query, "modifiedDate");
  const search = optionalText(query, "search");

  return {
    state,
    target,
    control,
    condition,
    modifiedDate,
    search,
    cursor: pagination.cursor,
    limit: pagination.limit,
  };
}

export function createCaPoliciesRoute(options: CaPoliciesRouteOptions): Route {
  return {
    method: "GET",
    path: CA_POLICIES_PATH,
    handler: async (ctx: RequestContext): Promise<RouteResponse> => {
      const caller = requireCaller(options.resolveCaller, ctx);
      const tenantId = requireTenantParam(ctx);

      requireTenantInScope(caller, tenantId);

      if (options.authorize) {
        await options.authorize(caller, CA_READ_PERMISSION);
      } else {
        const permissions = caller.permissions ?? [];
        if (!permissions.includes(CA_READ_PERMISSION) && !permissions.includes("*")) {
          throw new AppError(ErrorCodes.forbidden, "forbidden: missing ca.read", 403);
        }
      }

      const filter = parseCaPoliciesFilter(ctx.query);
      const page = await options.provider.listPolicies(tenantId, filter);

      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: page,
      };
    },
  };
}
