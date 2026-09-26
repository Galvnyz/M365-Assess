// Group usage report API (EPIC-014 SPEC.md §3.5, §6, §11.3; T-0270).
// Exposes GET /v1/tenants/:tenantId/groups/usage behind RBAC groups.read.
// Read-only: no write or cleanup path is exposed here.
import { AppError, ErrorCodes } from "../errors.js";
import { requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const GROUP_USAGE_PATH = "/v1/tenants/:tenantId/groups/usage";
export const GROUPS_READ_PERMISSION = "groups.read";
export const GROUPS_USAGE_UNAUTHENTICATED = "request.unauthenticated";

export interface GroupUsageSummary {
  readonly totalGroups: number;
  readonly ownerlessGroupsCount: number;
  readonly inactiveGroupsCount: number;
  readonly totalGuestsCount: number;
  readonly totalMembersCount: number;
}

export interface GroupMembershipGrowthPoint {
  readonly period: string;
  readonly memberCount: number;
}

export interface OwnerlessGroupItem {
  readonly id: string;
  readonly displayName: string;
  readonly mail?: string;
  readonly groupType: string;
  readonly membersCount: number;
  readonly lastActivityDate?: string | null;
}

export interface InactiveGroupItem {
  readonly id: string;
  readonly displayName: string;
  readonly mail?: string;
  readonly groupType: string;
  readonly membersCount: number;
  readonly ownersCount: number;
  readonly lastActivityDate?: string | null;
  readonly daysInactive: number;
}

export interface GroupGuestMetrics {
  readonly totalGuests: number;
  readonly groupsWithGuestsCount: number;
  readonly topGuestGroups: ReadonlyArray<{
    readonly id: string;
    readonly displayName: string;
    readonly guestCount: number;
  }>;
}

export interface GroupUsageReport {
  readonly tenantId: string;
  readonly generatedAt: string;
  readonly inactiveDaysThreshold: number;
  readonly summary: GroupUsageSummary;
  readonly membershipGrowth: readonly GroupMembershipGrowthPoint[];
  readonly ownerlessGroups: readonly OwnerlessGroupItem[];
  readonly inactiveGroups: readonly InactiveGroupItem[];
  readonly guestMetrics: GroupGuestMetrics;
}

export interface GroupUsageProvider {
  getUsage(tenantId: string, inactiveDaysThreshold: number): Promise<GroupUsageReport>;
}

export interface GroupUsageCaller extends Caller {
  readonly userId?: string;
}

export type GroupUsageAuthorizer = (
  caller: GroupUsageCaller,
  permission: string,
) => void | Promise<void>;

export interface GroupUsageRoutesOptions {
  readonly provider: GroupUsageProvider;
  readonly resolveCaller: (ctx: RequestContext) => GroupUsageCaller | undefined;
  readonly authorize?: GroupUsageAuthorizer;
}

function unauthenticatedError(): AppError {
  return new AppError(GROUPS_USAGE_UNAUTHENTICATED, "authentication required", 401);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => GroupUsageCaller | undefined,
  ctx: RequestContext,
): GroupUsageCaller {
  const caller = resolveCaller(ctx);
  if (caller === undefined) {
    throw unauthenticatedError();
  }
  return caller;
}

function requireParam(ctx: RequestContext, name: string): string {
  const value = ctx.params[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, `${name} is required`, 400, [
      { field: name, reason: "required" },
    ]);
  }
  return value.trim();
}

async function authorizeRead(
  options: GroupUsageRoutesOptions,
  caller: GroupUsageCaller,
): Promise<void> {
  if (options.authorize) {
    await options.authorize(caller, GROUPS_READ_PERMISSION);
  } else {
    const permissions = caller.permissions ?? [];
    const hasPermission =
      permissions.includes(GROUPS_READ_PERMISSION) ||
      permissions.includes("groups.write") ||
      permissions.includes("*");
    if (!hasPermission) {
      throw new AppError(
        ErrorCodes.forbidden,
        "forbidden: missing groups.read permission",
        403,
      );
    }
  }
}

export function createGroupUsageRoutes(options: GroupUsageRoutesOptions): Route[] {
  return [
    {
      method: "GET",
      path: GROUP_USAGE_PATH,
      handler: async (ctx: RequestContext): Promise<RouteResponse> => {
        const caller = requireCaller(options.resolveCaller, ctx);
        const tenantId = requireParam(ctx, "tenantId");

        requireTenantInScope(caller, tenantId);
        await authorizeRead(options, caller);

        let threshold = 90;
        const thresholdParam = ctx.query.get("inactiveDaysThreshold");
        if (thresholdParam) {
          const parsed = parseInt(thresholdParam, 10);
          if (isNaN(parsed) || parsed <= 0) {
            throw new AppError(
              ErrorCodes.validationFailed,
              "inactiveDaysThreshold must be a positive integer",
              400,
              [{ field: "inactiveDaysThreshold", reason: "invalid" }],
            );
          }
          threshold = parsed;
        }

        const report = await options.provider.getUsage(tenantId, threshold);
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: report,
        };
      },
    },
  ];
}
