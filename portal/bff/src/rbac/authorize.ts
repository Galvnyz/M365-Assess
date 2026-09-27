// Permission-check layer for EPIC-001. Route code calls these guards; a denied
// caller gets a structured AppError (05-programming.md §3) that the server maps
// to a `{ code, message, details, correlationId }` response. No secrets are
// included in any error detail.

import { AppError } from "../errors.js";
import {
  AdminPermission,
  RunPermissions,
  permissionsForRoles,
  type Permission,
  type RoleId,
} from "./roles.js";
import { isTenantAllowed, type TenantScope } from "./scope.js";

export const RbacErrorCodes = {
  forbidden: "auth.forbidden",
} as const;

// The authorization shape route code depends on. `PortalUser` (auth) extends it,
// so RBAC stays decoupled from the concrete identity provider.
export interface Caller {
  readonly roles: readonly RoleId[];
  readonly tenantScope: TenantScope;
  readonly permissions?: readonly string[];
}

export function hasPermission(caller: Caller, permission: Permission): boolean {
  return permissionsForRoles(caller.roles).has(permission);
}

export function requirePermission(caller: Caller, permission: Permission): void {
  if (!hasPermission(caller, permission)) {
    throw new AppError(RbacErrorCodes.forbidden, "not permitted to perform this action", 403, [
      { field: "permission", reason: permission },
    ]);
  }
}

export function isAdmin(caller: Caller): boolean {
  return hasPermission(caller, AdminPermission);
}

export function requireTenantInScope(caller: Caller, tenantId: string): void {
  if (!isTenantAllowed(caller.tenantScope, tenantId)) {
    throw new AppError(RbacErrorCodes.forbidden, "tenant is outside the caller scope", 403, [
      { field: "tenantId", reason: "out_of_scope" },
    ]);
  }
}

export const RunActions = Object.freeze({
  read: RunPermissions.read,
  create: RunPermissions.create,
  cancel: RunPermissions.cancel,
} as const);

export type RunAction = keyof typeof RunActions;

// Single gate for the run endpoints: permission first, then tenant scope.
export function requireRunAccess(caller: Caller, action: RunAction, tenantId: string): void {
  requirePermission(caller, RunActions[action]);
  requireTenantInScope(caller, tenantId);
}
