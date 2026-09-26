// Groups read API (EPIC-014 SPEC.md §3.1, §6, §7; T-0261).
// Exposes GET /v1/tenants/:tenantId/groups with §3.1 columns:
// Name, Type, Membership count, Owners, Hidden from GAL, Delivery mgmt, Dynamic rule
// and filters (type, hidden, dynamic, membership size, search).
// Requires RBAC `groups.read` and tenant in caller scope.
import { AppError, ErrorCodes } from "../errors.js";
import { parsePagination } from "../pagination.js";
import { requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const GROUPS_PATH = "/v1/tenants/:tenantId/groups";
export const GROUPS_READ_PERMISSION = "groups.read";
export const GROUPS_UNAUTHENTICATED = "request.unauthenticated";

export type GroupType = "m365" | "security" | "mailEnabledSecurity" | "distribution" | "dynamic";

export interface GroupItem {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly type: GroupType;
  readonly groupType: GroupType;
  readonly membershipCount: number;
  readonly ownerCount: number;
  readonly hiddenFromAddressListsEnabled: boolean;
  readonly deliveryManagementEnabled: boolean;
  readonly dynamicRule: string;
  readonly isDynamic: boolean;
  readonly mail?: string;
}

export interface GroupsFilter {
  readonly type?: GroupType;
  readonly hidden?: boolean;
  readonly dynamic?: boolean;
  readonly membershipSize?: string;
  readonly search?: string;
  readonly cursor: string | null;
  readonly limit: number;
}

export interface GroupsPage {
  readonly tenantId: string;
  readonly totalCount: number;
  readonly items: readonly GroupItem[];
  readonly nextCursor: string | null;
}

export interface GroupsProvider {
  listGroups(tenantId: string, filter: GroupsFilter): Promise<GroupsPage>;
}

export interface GroupsCaller extends Caller {
  readonly userId?: string;
}

export type GroupsAuthorizer = (
  caller: GroupsCaller,
  permission: string,
) => void | Promise<void>;

export interface GroupsListRouteOptions {
  readonly provider: GroupsProvider;
  readonly resolveCaller: (ctx: RequestContext) => GroupsCaller | undefined;
  readonly authorize?: GroupsAuthorizer;
}

function unauthenticatedError(): AppError {
  return new AppError(GROUPS_UNAUTHENTICATED, "authentication required", 401);
}

function validationError(message: string, field: string): AppError {
  return new AppError(ErrorCodes.validationFailed, message, 400, [
    { field, reason: "invalid" },
  ]);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => GroupsCaller | undefined,
  ctx: RequestContext,
): GroupsCaller {
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

function parseBoolean(query: URLSearchParams, name: string): boolean | undefined {
  const value = optionalText(query, name);
  if (value === undefined) {
    return undefined;
  }
  const lower = value.toLowerCase();
  if (lower === "true" || lower === "1") {
    return true;
  }
  if (lower === "false" || lower === "0") {
    return false;
  }
  throw validationError(`${name} must be a boolean (true or false)`, name);
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

export function parseGroupsFilter(query: URLSearchParams): GroupsFilter {
  const pagination = parsePagination(query);
  const type = parseEnum<GroupType>(query, "type", [
    "m365",
    "security",
    "mailEnabledSecurity",
    "distribution",
    "dynamic",
  ]);
  const hidden = parseBoolean(query, "hidden");
  const dynamic = parseBoolean(query, "dynamic");
  const membershipSize = optionalText(query, "membershipSize");
  const search = optionalText(query, "search");

  return {
    type,
    hidden,
    dynamic,
    membershipSize,
    search,
    cursor: pagination.cursor,
    limit: pagination.limit,
  };
}

export function createGroupsListRoute(options: GroupsListRouteOptions): Route {
  return {
    method: "GET",
    path: GROUPS_PATH,
    handler: async (ctx: RequestContext): Promise<RouteResponse> => {
      const caller = requireCaller(options.resolveCaller, ctx);
      const tenantId = requireTenantParam(ctx);

      requireTenantInScope(caller, tenantId);

      if (options.authorize) {
        await options.authorize(caller, GROUPS_READ_PERMISSION);
      } else {
        const permissions = caller.permissions ?? [];
        if (!permissions.includes(GROUPS_READ_PERMISSION) && !permissions.includes("*")) {
          throw new AppError(ErrorCodes.forbidden, "forbidden: missing groups.read", 403);
        }
      }

      const filter = parseGroupsFilter(ctx.query);
      const page = await options.provider.listGroups(tenantId, filter);

      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: page,
      };
    },
  };
}
