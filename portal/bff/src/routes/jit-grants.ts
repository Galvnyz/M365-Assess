// JIT admin grants BFF route (EPIC-013 SPEC §3.4, §4.4, §5, §11.2; T-0246).
// Exposes POST /v1/tenants/:tenantId/jit-grants, POST /v1/jit-grants/:id/revoke, and POST /v1/jit-grants/:id/extend.
// Grants are bounded and audited; advisory first: never removes permanent assignments.
import { AppError, ErrorCodes } from "../errors.js";
import { requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";
import type {
  JitAssignmentType,
  JitGrant,
  JitGrantInput,
  JitGrantState,
} from "../../../db/src/repository.js";
import type { JitRepository } from "../../../db/src/jit-repository.js";

export const JIT_GRANTS_PATH = "/v1/tenants/:tenantId/jit-grants";
export const JIT_GRANT_ITEM_PATH = "/v1/tenants/:tenantId/jit-grants/:id";
export const JIT_GRANT_REVOKE_PATH = "/v1/jit-grants/:id/revoke";
export const JIT_GRANT_EXTEND_PATH = "/v1/jit-grants/:id/extend";

export const ROLES_READ_PERMISSION = "Identity.Role.Read";
export const ROLES_WRITE_PERMISSION = "Identity.Role.ReadWrite";
export const ROLES_JIT_PERMISSION = "Identity.Jit.ReadWrite";

export const JIT_UNAUTHENTICATED = "request.unauthenticated";
export const JIT_DURATION_EXCEEDED = "roles.jit_duration_exceeded";

export interface JitAuditEvent {
  readonly tenantId: string;
  readonly action: string;
  readonly targetId: string;
  readonly result: "success" | "failure";
  readonly before: unknown;
  readonly after: unknown;
  readonly callerId?: string;
  readonly reason?: string;
  readonly timestamp?: string;
}

export interface JitGrantExecutionProvider {
  grantRole(
    tenantId: string,
    grant: JitGrant,
  ): Promise<{ grantId: string; startsAt: string; endsAt: string }>;
  revokeRole(tenantId: string, grant: JitGrant): Promise<void>;
  extendRole(tenantId: string, grant: JitGrant, newEndsAt: string): Promise<void>;
}

export interface JitGrantsRouteOptions {
  readonly repository: JitRepository;
  readonly executionProvider?: JitGrantExecutionProvider;
  readonly resolveCaller: (ctx: RequestContext) => Caller | undefined;
  readonly authorize?: (caller: Caller, permission: string) => void | Promise<void>;
  readonly recordAudit?: (event: JitAuditEvent) => Promise<void>;
  readonly idGenerator?: () => string;
}

function unauthenticatedError(): AppError {
  return new AppError(JIT_UNAUTHENTICATED, "authentication required", 401);
}

function validationError(message: string, field: string): AppError {
  return new AppError(ErrorCodes.validationFailed, message, 400, [
    { field, reason: "invalid" },
  ]);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => Caller | undefined,
  ctx: RequestContext,
): Caller {
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

export function createJitGrantsRoutes(options: JitGrantsRouteOptions): Route[] {
  const repo = options.repository;
  const generateId = options.idGenerator ?? (() => `jit-${Date.now()}`);

  const checkPerm = async (caller: Caller, perm: string) => {
    if (options.authorize) {
      await options.authorize(caller, perm);
    } else {
      const perms = caller.permissions ?? [];
      if (!perms.includes(perm) && !perms.includes(ROLES_JIT_PERMISSION) && !perms.includes("*")) {
        throw new AppError(ErrorCodes.forbidden, `forbidden: missing ${perm}`, 403);
      }
    }
  };

  // 1. Create a bounded JIT grant
  const createRoute: Route = {
    method: "POST",
    path: JIT_GRANTS_PATH,
    handler: async (ctx: RequestContext): Promise<RouteResponse> => {
      const caller = requireCaller(options.resolveCaller, ctx);
      const tenantId = requireTenantParam(ctx);
      requireTenantInScope(caller, tenantId);
      await checkPerm(caller, ROLES_WRITE_PERMISSION);

      const body = (ctx.body ?? {}) as {
        userId?: string;
        roleId?: string;
        templateId?: string;
        assignmentType?: JitAssignmentType;
        durationHours?: number;
        maxDurationHours?: number;
        justification?: string;
      };

      if (!body.userId || typeof body.userId !== "string" || body.userId.trim().length === 0) {
        throw validationError("userId is required", "userId");
      }
      if (!body.roleId || typeof body.roleId !== "string" || body.roleId.trim().length === 0) {
        throw validationError("roleId is required", "roleId");
      }

      const durationHours = body.durationHours ?? 8;
      const maxDurationHours = body.maxDurationHours ?? 24;

      if (durationHours > maxDurationHours) {
        throw new AppError(
          JIT_DURATION_EXCEEDED,
          `requested duration (${durationHours} hours) exceeds maximum allowed duration (${maxDurationHours} hours)`,
          400,
          [{ field: "durationHours", reason: "exceeds_max" }],
        );
      }

      const now = new Date();
      const startsAt = now.toISOString();
      const endsAt = new Date(now.getTime() + durationHours * 3600 * 1000).toISOString();

      const callerUserId = (caller as { userId?: string }).userId ?? "unknown";

      const grantInput: JitGrantInput = {
        id: generateId(),
        tenantId,
        userId: body.userId.trim(),
        roleId: body.roleId.trim(),
        templateId: body.templateId ?? null,
        assignmentType: body.assignmentType ?? "eligible",
        startsAt,
        endsAt,
        durationHours,
        maxDurationHours,
        state: "active",
        justification: body.justification ?? null,
        createdBy: callerUserId,
      };

      if (options.executionProvider) {
        await options.executionProvider.grantRole(tenantId, grantInput as JitGrant);
      }

      const created = await repo.createGrant(grantInput);

      if (options.recordAudit) {
        await options.recordAudit({
          tenantId,
          action: "jit.grant",
          targetId: created.id,
          result: "success",
          before: null,
          after: created,
          callerId: callerUserId,
          reason: body.justification ?? undefined,
          timestamp: new Date().toISOString(),
        });
      }

      return {
        status: 201,
        headers: { "content-type": "application/json" },
        body: created,
      };
    },
  };

  // 2. List grants
  const listRoute: Route = {
    method: "GET",
    path: JIT_GRANTS_PATH,
    handler: async (ctx: RequestContext): Promise<RouteResponse> => {
      const caller = requireCaller(options.resolveCaller, ctx);
      const tenantId = requireTenantParam(ctx);
      requireTenantInScope(caller, tenantId);
      await checkPerm(caller, ROLES_READ_PERMISSION);

      const userId = ctx.query.get("userId") ?? undefined;
      const state = (ctx.query.get("state") as JitGrantState) ?? undefined;

      const items = await repo.listGrants(tenantId, { userId, state });
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { tenantId, items },
      };
    },
  };

  // 3. Revoke grant
  const revokeRoute: Route = {
    method: "POST",
    path: JIT_GRANT_REVOKE_PATH,
    handler: async (ctx: RequestContext): Promise<RouteResponse> => {
      const caller = requireCaller(options.resolveCaller, ctx);
      await checkPerm(caller, ROLES_WRITE_PERMISSION);

      const id = ctx.params["id"];
      if (!id) throw validationError("id is required", "id");

      const existing = await repo.getGrantById(id);
      if (!existing) {
        throw new AppError(ErrorCodes.notFound, `grant '${id}' not found`, 404);
      }

      requireTenantInScope(caller, existing.tenantId);

      const now = new Date().toISOString();
      const callerUserId = (caller as { userId?: string }).userId ?? "unknown";

      if (options.executionProvider) {
        await options.executionProvider.revokeRole(existing.tenantId, existing);
      }

      const updated = await repo.updateGrant(id, {
        state: "revoked",
        endsAt: now,
        revokedAt: now,
        revokedBy: callerUserId,
      });

      if (options.recordAudit) {
        await options.recordAudit({
          tenantId: existing.tenantId,
          action: "jit.revoke",
          targetId: id,
          result: "success",
          before: existing,
          after: updated,
          callerId: callerUserId,
          timestamp: new Date().toISOString(),
        });
      }

      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: updated,
      };
    },
  };

  // 4. Extend grant
  const extendRoute: Route = {
    method: "POST",
    path: JIT_GRANT_EXTEND_PATH,
    handler: async (ctx: RequestContext): Promise<RouteResponse> => {
      const caller = requireCaller(options.resolveCaller, ctx);
      await checkPerm(caller, ROLES_WRITE_PERMISSION);

      const id = ctx.params["id"];
      if (!id) throw validationError("id is required", "id");

      const existing = await repo.getGrantById(id);
      if (!existing) {
        throw new AppError(ErrorCodes.notFound, `grant '${id}' not found`, 404);
      }

      requireTenantInScope(caller, existing.tenantId);

      const body = (ctx.body ?? {}) as { additionalHours?: number };
      const additionalHours = body.additionalHours ?? 4;
      const newDuration = existing.durationHours + additionalHours;

      if (newDuration > existing.maxDurationHours) {
        throw new AppError(
          JIT_DURATION_EXCEEDED,
          `extended duration (${newDuration} hours) exceeds role maximum duration (${existing.maxDurationHours} hours)`,
          400,
          [{ field: "additionalHours", reason: "exceeds_max" }],
        );
      }

      const currentEnd = new Date(existing.endsAt).getTime();
      const newEndsAt = new Date(currentEnd + additionalHours * 3600 * 1000).toISOString();

      if (options.executionProvider) {
        await options.executionProvider.extendRole(existing.tenantId, existing, newEndsAt);
      }

      const updated = await repo.updateGrant(id, {
        state: "extended",
        durationHours: newDuration,
        endsAt: newEndsAt,
      });

      if (options.recordAudit) {
        await options.recordAudit({
          tenantId: existing.tenantId,
          action: "jit.extend",
          targetId: id,
          result: "success",
          before: existing,
          after: updated,
          callerId: (caller as { userId?: string }).userId,
          timestamp: new Date().toISOString(),
        });
      }

      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: updated,
      };
    },
  };

  return [createRoute, listRoute, revokeRoute, extendRoute];
}
