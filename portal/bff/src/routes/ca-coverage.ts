// CA Coverage and Change History API (EPIC-015 SPEC.md §3.1, §4.4, §5, §6, §11.4; T-0290).
// Exposes GET /v1/tenants/:tenantId/ca/coverage
// and GET /v1/tenants/:tenantId/ca/history.
// Identifies covered vs uncovered users and applications with concrete gaps.
// Merges directory audit events with portal before/after change records per policy.
import { AppError, ErrorCodes } from "../errors.js";
import { requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const CA_COVERAGE_PATH = "/v1/tenants/:tenantId/ca/coverage";
export const CA_HISTORY_PATH = "/v1/tenants/:tenantId/ca/history";

export const CA_READ_PERMISSION = "Tenant.ConditionalAccess.Read";
export const CA_WRITE_PERMISSION = "Tenant.ConditionalAccess.ReadWrite";
export const REMEDIATION_APPLY_PERMISSION = "Remediation.Apply";
export const CA_DEPLOY_PERMISSION = "Tenant.ConditionalAccess.ReadWrite";
export const CA_UNAUTHENTICATED = "request.unauthenticated";

export interface PolicyRef {
  readonly id: string;
  readonly displayName: string;
}

export interface CoveredUser {
  readonly id: string;
  readonly displayName: string;
  readonly userPrincipalName: string;
  readonly userType: string;
  readonly policies: readonly PolicyRef[];
}

export interface UncoveredUser {
  readonly id: string;
  readonly displayName: string;
  readonly userPrincipalName: string;
  readonly userType: string;
  readonly reason: string;
}

export interface CoveredApp {
  readonly appId: string;
  readonly displayName: string;
  readonly policies: readonly PolicyRef[];
}

export interface UncoveredApp {
  readonly appId: string;
  readonly displayName: string;
  readonly reason: string;
}

export interface CoverageGap {
  readonly category: string;
  readonly severity: "high" | "medium" | "low";
  readonly title: string;
  readonly description: string;
  readonly count: number;
}

export interface CaCoverageSummary {
  readonly totalUsers: number;
  readonly coveredUsersCount: number;
  readonly uncoveredUsersCount: number;
  readonly userCoveragePct: number;
  readonly totalApps: number;
  readonly coveredAppsCount: number;
  readonly uncoveredAppsCount: number;
  readonly appCoveragePct: number;
  readonly activePoliciesCount: number;
  readonly totalGapsCount: number;
}

export interface CaCoverageResponse {
  readonly tenantId: string;
  readonly summary: CaCoverageSummary;
  readonly gaps: readonly CoverageGap[];
  readonly coveredUsers: readonly CoveredUser[];
  readonly uncoveredUsers: readonly UncoveredUser[];
  readonly coveredApps: readonly CoveredApp[];
  readonly uncoveredApps: readonly UncoveredApp[];
}

export interface CaPolicyChangeRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly policyId: string;
  readonly policyName: string;
  readonly timestamp: string;
  readonly initiatedBy: string;
  readonly action: string;
  readonly source: "portal" | "directoryAudit" | "merged";
  readonly diff?: readonly string[];
  readonly before?: Record<string, unknown> | null;
  readonly after?: Record<string, unknown> | null;
  readonly rawAudit?: Record<string, unknown>;
}

export interface CaHistoryResponse {
  readonly tenantId: string;
  readonly policyId?: string;
  readonly totalCount: number;
  readonly items: readonly CaPolicyChangeRecord[];
}

export interface CaHistoryFilter {
  readonly policyId?: string;
}

export interface CaCoverageProvider {
  getCoverage(tenantId: string): Promise<CaCoverageResponse>;
  getHistory(tenantId: string, filter?: CaHistoryFilter): Promise<CaHistoryResponse>;
}

export interface CaCoverageCaller extends Caller {
  readonly userId?: string;
}

export type CaCoverageAuthorizer = (
  caller: CaCoverageCaller,
  permission: string,
) => void | Promise<void>;

export interface CaCoverageRoutesOptions {
  readonly provider: CaCoverageProvider;
  readonly resolveCaller: (ctx: RequestContext) => CaCoverageCaller | undefined;
  readonly authorize?: CaCoverageAuthorizer;
}

function unauthenticatedError(): AppError {
  return new AppError(CA_UNAUTHENTICATED, "authentication required", 401);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => CaCoverageCaller | undefined,
  ctx: RequestContext,
): CaCoverageCaller {
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

async function authorizeRead(
  options: CaCoverageRoutesOptions,
  caller: CaCoverageCaller,
): Promise<void> {
  if (options.authorize) {
    await options.authorize(caller, CA_READ_PERMISSION);
    return;
  }
  const permissions = caller.permissions ?? [];
  const allowed =
    permissions.includes(CA_READ_PERMISSION) ||
    permissions.includes(CA_WRITE_PERMISSION) ||
    permissions.includes(REMEDIATION_APPLY_PERMISSION) ||
    permissions.includes(CA_DEPLOY_PERMISSION) ||
    permissions.includes("*");
  if (!allowed) {
    throw new AppError(
      ErrorCodes.forbidden,
      `forbidden: read requires ${CA_READ_PERMISSION}`,
      403,
    );
  }
}

export function createCaCoverageRoutes(options: CaCoverageRoutesOptions): Route[] {
  return [
    // GET /v1/tenants/:tenantId/ca/coverage
    {
      method: "GET",
      path: CA_COVERAGE_PATH,
      handler: async (ctx: RequestContext): Promise<RouteResponse> => {
        const caller = requireCaller(options.resolveCaller, ctx);
        const tenantId = requireTenantParam(ctx);
        requireTenantInScope(caller, tenantId);
        await authorizeRead(options, caller);

        const result = await options.provider.getCoverage(tenantId);
        return {
          status: 200,
          body: result,
        };
      },
    },

    // GET /v1/tenants/:tenantId/ca/history
    {
      method: "GET",
      path: CA_HISTORY_PATH,
      handler: async (ctx: RequestContext): Promise<RouteResponse> => {
        const caller = requireCaller(options.resolveCaller, ctx);
        const tenantId = requireTenantParam(ctx);
        requireTenantInScope(caller, tenantId);
        await authorizeRead(options, caller);

        const policyId = ctx.query.get("policyId") ?? undefined;
        const result = await options.provider.getHistory(tenantId, { policyId });
        return {
          status: 200,
          body: result,
        };
      },
    },
  ];
}
