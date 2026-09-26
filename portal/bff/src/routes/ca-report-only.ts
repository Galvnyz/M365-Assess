// CA report-only evaluation API (EPIC-015 SPEC.md §3.5, §6; T-0289).
// Exposes GET /v1/tenants/:tenantId/ca/report-only.
// Evaluates sign-in impact for policies in report-only mode (enabledForReportingButNotEnforced).
// Read-only surface; promotions route through policy edit path.
import { AppError, ErrorCodes } from "../errors.js";
import { requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const CA_REPORT_ONLY_PATH = "/v1/tenants/:tenantId/ca/report-only";

export const CA_READ_PERMISSION = "ca.read";
export const CA_WRITE_PERMISSION = "ca.write";
export const REMEDIATION_APPLY_PERMISSION = "remediation.apply";
export const CA_DEPLOY_PERMISSION = "ca.deploy";
export const CA_UNAUTHENTICATED = "request.unauthenticated";

export interface CaReportOnlyAffectedUser {
  readonly userPrincipalName: string;
  readonly failCount: number;
}

export interface CaReportOnlyAffectedApp {
  readonly appDisplayName: string;
  readonly failCount: number;
}

export interface CaReportOnlySampleEvent {
  readonly id: string;
  readonly createdDateTime: string;
  readonly userPrincipalName: string;
  readonly appDisplayName: string;
  readonly ipAddress: string;
  readonly location: string;
  readonly result: string;
  readonly wouldBlock: boolean;
}

export interface CaReportOnlyPolicyResult {
  readonly policyId: string;
  readonly policyName: string;
  readonly state: "enabledForReportingButNotEnforced";
  readonly controlsSummary: string;
  readonly totalEvaluated: number;
  readonly wouldBlockCount: number;
  readonly wouldGrantCount: number;
  readonly notAppliedCount: number;
  readonly affectedUsers: readonly CaReportOnlyAffectedUser[];
  readonly affectedApps: readonly CaReportOnlyAffectedApp[];
  readonly sampleEvents: readonly CaReportOnlySampleEvent[];
}

export interface CaReportOnlySummary {
  readonly totalReportOnlyPolicies: number;
  readonly totalEvaluated: number;
  readonly totalWouldBlock: number;
}

export interface CaReportOnlyResponse {
  readonly tenantId: string;
  readonly reportOnlyPolicies: readonly CaReportOnlyPolicyResult[];
  readonly summary: CaReportOnlySummary;
}

export interface CaReportOnlyFilter {
  readonly policyId?: string;
}

export interface CaReportOnlyProvider {
  getReportOnlyEvaluation(
    tenantId: string,
    filter?: CaReportOnlyFilter,
  ): Promise<CaReportOnlyResponse>;
}

export interface CaReportOnlyCaller extends Caller {
  readonly userId?: string;
}

export type CaReportOnlyAuthorizer = (
  caller: CaReportOnlyCaller,
  permission: string,
) => void | Promise<void>;

export interface CaReportOnlyRoutesOptions {
  readonly provider: CaReportOnlyProvider;
  readonly resolveCaller: (ctx: RequestContext) => CaReportOnlyCaller | undefined;
  readonly authorize?: CaReportOnlyAuthorizer;
}

function unauthenticatedError(): AppError {
  return new AppError(CA_UNAUTHENTICATED, "authentication required", 401);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => CaReportOnlyCaller | undefined,
  ctx: RequestContext,
): CaReportOnlyCaller {
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
  options: CaReportOnlyRoutesOptions,
  caller: CaReportOnlyCaller,
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

export function createCaReportOnlyRoutes(options: CaReportOnlyRoutesOptions): Route[] {
  return [
    {
      method: "GET",
      path: CA_REPORT_ONLY_PATH,
      handler: async (ctx: RequestContext): Promise<RouteResponse> => {
        const caller = requireCaller(options.resolveCaller, ctx);
        const tenantId = requireTenantParam(ctx);
        requireTenantInScope(caller, tenantId);
        await authorizeRead(options, caller);

        const policyId = ctx.query.get("policyId") ?? undefined;
        const result = await options.provider.getReportOnlyEvaluation(tenantId, {
          policyId,
        });

        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(result),
        };
      },
    },
  ];
}
