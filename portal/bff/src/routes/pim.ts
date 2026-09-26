// PIM eligible/active assignments view & Entra ID P2 license gate (EPIC-013 SPEC.md §3.1, §9, §11.4; T-0242).
// Exposes GET /v1/tenants/:tenantId/pim.
// Returns eligible and active role assignments when P2 is present; when Entra ID P2
// is absent, returns a structured license-missing gate payload explaining the requirement
// rather than failing, so the assignments view remains usable.
// The route holds no M365 SDK call and issues no tenant write.
import { AppError, ErrorCodes } from "../errors.js";
import { parsePagination } from "../pagination.js";
import { requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";
import {
  evaluatePimLicenseGate,
  type PimLicenseGateResult,
} from "../domain/pim/license-gate.js";

export const PIM_ASSIGNMENTS_PATH = "/v1/tenants/:tenantId/pim";
export const PIM_READ_PERMISSION = "roles.read";
export const PIM_UNAUTHENTICATED = "request.unauthenticated";

export type PimAssignmentType = "eligible" | "active";
export type PimPrincipalType = "user" | "group" | "servicePrincipal";

export interface PimAssignment {
  readonly id: string;
  readonly roleDefinitionId: string;
  readonly roleName: string;
  readonly principalId: string;
  readonly principalDisplayName: string | null;
  readonly principalEmail: string | null;
  readonly principalType: PimPrincipalType;
  readonly assignmentType: PimAssignmentType;
  readonly directoryScopeId: string;
  readonly scope: string;
  readonly startDateTime: string | null;
  readonly endDateTime: string | null;
  readonly status: string;
  readonly memberType?: string;
}

export interface PimAssignmentsFilter {
  readonly role?: string;
  readonly principalType?: PimPrincipalType;
  readonly assignmentType?: PimAssignmentType;
  readonly scope?: string;
  readonly search?: string;
  readonly cursor: string | null;
  readonly limit: number;
}

export interface PimAssignmentsPage {
  readonly tenantId: string;
  readonly gate: PimLicenseGateResult;
  readonly totalCount: number;
  readonly items: readonly PimAssignment[];
  readonly nextCursor: string | null;
}

export interface PimAssignmentsProvider {
  listPimAssignments(
    tenantId: string,
    filter: PimAssignmentsFilter,
  ): Promise<PimAssignmentsPage>;
}

export interface PimCaller extends Caller {
  readonly userId?: string;
}

export type PimAuthorizer = (
  caller: PimCaller,
  permission: string,
) => void | Promise<void>;

export interface PimRouteOptions {
  readonly provider: PimAssignmentsProvider;
  readonly resolveCaller: (ctx: RequestContext) => PimCaller | undefined;
  readonly authorize?: PimAuthorizer;
  readonly resolveTenantLicenses?: (tenantId: string) => Promise<readonly string[]>;
}

function unauthenticatedError(): AppError {
  return new AppError(PIM_UNAUTHENTICATED, "authentication required", 401);
}

function validationError(message: string, field: string): AppError {
  return new AppError(ErrorCodes.validationFailed, message, 400, [
    { field, reason: "invalid" },
  ]);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => PimCaller | undefined,
  ctx: RequestContext,
): PimCaller {
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

export function parsePimAssignmentsFilter(query: URLSearchParams): PimAssignmentsFilter {
  const pagination = parsePagination(query);
  const role = optionalText(query, "role");
  const principalType = parseEnum<PimPrincipalType>(query, "principalType", [
    "user",
    "group",
    "servicePrincipal",
  ]);
  const assignmentType = parseEnum<PimAssignmentType>(query, "assignmentType", [
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

export function createPimAssignmentsRoute(options: PimRouteOptions): Route {
  return {
    method: "GET",
    path: PIM_ASSIGNMENTS_PATH,
    handler: async (ctx: RequestContext): Promise<RouteResponse> => {
      const caller = requireCaller(options.resolveCaller, ctx);
      const tenantId = requireTenantParam(ctx);

      requireTenantInScope(caller, tenantId);

      if (options.authorize) {
        await options.authorize(caller, PIM_READ_PERMISSION);
      } else {
        const permissions = caller.permissions ?? [];
        if (
          !permissions.includes(PIM_READ_PERMISSION) &&
          !permissions.includes("roles.pim") &&
          !permissions.includes("*")
        ) {
          throw new AppError(ErrorCodes.forbidden, "forbidden: missing roles.read", 403);
        }
      }

      // Check licenses if a license resolver is provided
      if (options.resolveTenantLicenses) {
        const licenses = await options.resolveTenantLicenses(tenantId);
        const gateResult = evaluatePimLicenseGate(licenses);
        if (!gateResult.supported) {
          return {
            status: 200,
            headers: { "content-type": "application/json" },
            body: {
              tenantId,
              gate: gateResult,
              totalCount: 0,
              items: [],
              nextCursor: null,
            },
          };
        }
      }

      const filter = parsePimAssignmentsFilter(ctx.query);
      const page = await options.provider.listPimAssignments(tenantId, filter);

      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: page,
      };
    },
  };
}
