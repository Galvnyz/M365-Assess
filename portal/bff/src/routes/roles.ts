// Directory role assignments read (EPIC-013 SPEC.md §3.1, §4.1, §6; T-0241).
// Exposes GET /v1/tenants/:tenantId/role-assignments with §3.1 columns
// (role, principal, assignment type permanent/eligible/active, scope, start, end, status)
// and filters (role, principalType, assignmentType, scope, search).
// The BFF route holds no M365 SDK call and issues no tenant write; reads are backed
// by the injected provider seam running the worker job live against Graph.
// Reads require `roles.read` intersected with the caller tenant scope.
import { AppError, ErrorCodes } from "../errors.js";
import { parsePagination } from "../pagination.js";
import { requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const ROLE_ASSIGNMENTS_PATH = "/v1/tenants/:tenantId/role-assignments";
export const ROLES_READ_PERMISSION = "roles.read";
export const ROLES_UNAUTHENTICATED = "request.unauthenticated";

export type RoleAssignmentType = "permanent" | "eligible" | "active";
export type RolePrincipalType = "user" | "group" | "servicePrincipal";

export interface RoleAssignment {
  readonly id: string;
  readonly roleDefinitionId: string;
  readonly roleName: string;
  readonly principalId: string;
  readonly principalDisplayName: string | null;
  readonly principalEmail: string | null;
  readonly principalType: RolePrincipalType;
  readonly assignmentType: RoleAssignmentType;
  readonly directoryScopeId: string;
  readonly scope: string;
  readonly startDateTime: string | null;
  readonly endDateTime: string | null;
  readonly status: string;
}

export interface RoleAssignmentsFilter {
  readonly role?: string;
  readonly principalType?: RolePrincipalType;
  readonly assignmentType?: RoleAssignmentType;
  readonly scope?: string;
  readonly search?: string;
  readonly cursor: string | null;
  readonly limit: number;
}

export interface RoleAssignmentsPage {
  readonly tenantId: string;
  readonly totalCount: number;
  readonly items: readonly RoleAssignment[];
  readonly nextCursor: string | null;
}

export interface RoleAssignmentsProvider {
  listRoleAssignments(
    tenantId: string,
    filter: RoleAssignmentsFilter,
  ): Promise<RoleAssignmentsPage>;
}

export interface RolesCaller extends Caller {
  readonly userId?: string;
}

export type RolesAuthorizer = (
  caller: RolesCaller,
  permission: string,
) => void | Promise<void>;

export interface RoleAssignmentsRouteOptions {
  readonly provider: RoleAssignmentsProvider;
  readonly resolveCaller: (ctx: RequestContext) => RolesCaller | undefined;
  readonly authorize?: RolesAuthorizer;
}

function unauthenticatedError(): AppError {
  return new AppError(ROLES_UNAUTHENTICATED, "authentication required", 401);
}

function validationError(message: string, field: string): AppError {
  return new AppError(ErrorCodes.validationFailed, message, 400, [
    { field, reason: "invalid" },
  ]);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => RolesCaller | undefined,
  ctx: RequestContext,
): RolesCaller {
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

export function parseRoleAssignmentsFilter(query: URLSearchParams): RoleAssignmentsFilter {
  const pagination = parsePagination(query);
  const role = optionalText(query, "role");
  const principalType = parseEnum<RolePrincipalType>(query, "principalType", [
    "user",
    "group",
    "servicePrincipal",
  ]);
  const assignmentType = parseEnum<RoleAssignmentType>(query, "assignmentType", [
    "permanent",
    "eligible",
    "active",
  ]);
  const scope = optionalText(query, "scope");
  const search = optionalText(query, "search");

  return {
    role,
    principalType,
    assignmentType,
    scope,
    search,
    cursor: pagination.cursor,
    limit: pagination.limit,
  };
}

export function createRoleAssignmentsRoute(options: RoleAssignmentsRouteOptions): Route {
  return {
    method: "GET",
    path: ROLE_ASSIGNMENTS_PATH,
    handler: async (ctx: RequestContext): Promise<RouteResponse> => {
      const caller = requireCaller(options.resolveCaller, ctx);
      const tenantId = requireTenantParam(ctx);

      requireTenantInScope(caller, tenantId);

      if (options.authorize) {
        await options.authorize(caller, ROLES_READ_PERMISSION);
      } else {
        const permissions = caller.permissions ?? [];
        if (!permissions.includes(ROLES_READ_PERMISSION) && !permissions.includes("*")) {
          throw new AppError(ErrorCodes.forbidden, "forbidden: missing roles.read", 403);
        }
      }

      const filter = parseRoleAssignmentsFilter(ctx.query);
      const page = await options.provider.listRoleAssignments(tenantId, filter);

      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: page,
      };
    },
  };
}
