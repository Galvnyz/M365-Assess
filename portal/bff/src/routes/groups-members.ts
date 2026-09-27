// Bulk group membership and owners API (EPIC-014 SPEC.md §3.3, §4.3, §6, §8; T-0268).
// Exposes POST /v1/tenants/:tenantId/groups/:groupId/members/bulk and .../owners/bulk.
// Computes preview diff without writing; applies batched changes and returns per-row results with per-change audit records.
import { AppError, ErrorCodes } from "../errors.js";
import { requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const GROUP_MEMBERS_BULK_PATH = "/v1/tenants/:tenantId/groups/:groupId/members/bulk";
export const GROUP_OWNERS_BULK_PATH = "/v1/tenants/:tenantId/groups/:groupId/owners/bulk";

export const GROUPS_WRITE_PERMISSION = "Identity.Group.ReadWrite";
export const REMEDIATION_APPLY_PERMISSION = "Remediation.Apply";
export const GROUPS_MEMBERS_UNAUTHENTICATED = "request.unauthenticated";

export type BulkMembershipRole = "members" | "owners";
export type BulkMembershipOperation = "add" | "remove";

export interface BulkMembershipPlanRow {
  readonly user: string;
  readonly action: "add" | "remove" | "skip";
  readonly reason: string;
}

export interface BulkMembershipPlan {
  readonly tenantId: string;
  readonly groupId: string;
  readonly role: BulkMembershipRole;
  readonly operation: BulkMembershipOperation;
  readonly total: number;
  readonly toAdd: number;
  readonly toRemove: number;
  readonly toSkip: number;
  readonly diff: readonly string[];
  readonly planRows: readonly BulkMembershipPlanRow[];
  readonly dryRun: boolean;
}

export interface BulkMembershipRowResult {
  readonly user: string;
  readonly status: "added" | "removed" | "skipped" | "failed";
  readonly reason?: string;
  readonly error?: string;
}

export interface BulkMembershipResult {
  readonly success: boolean;
  readonly plan: BulkMembershipPlan;
  readonly results: readonly BulkMembershipRowResult[];
  readonly auditEvents?: readonly Record<string, unknown>[];
}

export interface BulkMembershipInput {
  readonly operation: BulkMembershipOperation;
  readonly users: readonly string[];
  readonly preview?: boolean;
}

export interface GroupMembersProvider {
  invokeBulkMembership(
    tenantId: string,
    groupId: string,
    role: BulkMembershipRole,
    input: BulkMembershipInput,
    preview: boolean,
  ): Promise<BulkMembershipPlan | BulkMembershipResult>;
}

export interface GroupMembersCaller extends Caller {
  readonly userId?: string;
}

export type GroupMembersAuthorizer = (
  caller: GroupMembersCaller,
  permission: string,
) => void | Promise<void>;

export interface GroupMembersRoutesOptions {
  readonly provider: GroupMembersProvider;
  readonly resolveCaller: (ctx: RequestContext) => GroupMembersCaller | undefined;
  readonly authorize?: GroupMembersAuthorizer;
}

function unauthenticatedError(): AppError {
  return new AppError(GROUPS_MEMBERS_UNAUTHENTICATED, "authentication required", 401);
}

function validationError(message: string, field: string): AppError {
  return new AppError(ErrorCodes.validationFailed, message, 400, [
    { field, reason: "invalid" },
  ]);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => GroupMembersCaller | undefined,
  ctx: RequestContext,
): GroupMembersCaller {
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

async function authorizeWrite(
  options: GroupMembersRoutesOptions,
  caller: GroupMembersCaller,
): Promise<void> {
  if (options.authorize) {
    await options.authorize(caller, GROUPS_WRITE_PERMISSION);
  } else {
    const permissions = caller.permissions ?? [];
    const hasPermission =
      permissions.includes(GROUPS_WRITE_PERMISSION) ||
      permissions.includes(REMEDIATION_APPLY_PERMISSION) ||
      permissions.includes("*");
    if (!hasPermission) {
      throw new AppError(
        ErrorCodes.forbidden,
        "forbidden: missing groups.write or remediation.apply permission",
        403,
      );
    }
  }
}

function parseBulkInput(ctx: RequestContext): { input: BulkMembershipInput; isPreview: boolean } {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const operation = body.operation as BulkMembershipOperation;
  if (operation !== "add" && operation !== "remove") {
    throw validationError("operation must be 'add' or 'remove'", "operation");
  }

  if (!Array.isArray(body.users) || body.users.length === 0) {
    throw validationError("users must be a non-empty array of user identifiers", "users");
  }

  const users = body.users.map((u) => String(u).trim()).filter(Boolean);
  const isPreview = Boolean(body.preview || ctx.query.get("preview") === "true");

  return {
    input: { operation, users, preview: isPreview },
    isPreview,
  };
}

export function createGroupMembersRoutes(options: GroupMembersRoutesOptions): Route[] {
  const createHandler = (role: BulkMembershipRole) => {
    return async (ctx: RequestContext): Promise<RouteResponse> => {
      const caller = requireCaller(options.resolveCaller, ctx);
      const tenantId = requireParam(ctx, "tenantId");
      const groupId = requireParam(ctx, "groupId");

      requireTenantInScope(caller, tenantId);
      await authorizeWrite(options, caller);

      const { input, isPreview } = parseBulkInput(ctx);
      const result = await options.provider.invokeBulkMembership(
        tenantId,
        groupId,
        role,
        input,
        isPreview,
      );

      return {
        status: isPreview ? 200 : 200,
        headers: { "content-type": "application/json" },
        body: result,
      };
    };
  };

  return [
    {
      method: "POST",
      path: GROUP_MEMBERS_BULK_PATH,
      handler: createHandler("members"),
    },
    {
      method: "POST",
      path: GROUP_OWNERS_BULK_PATH,
      handler: createHandler("owners"),
    },
  ];
}
