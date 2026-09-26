// JIT admin templates CRUD (EPIC-013 SPEC §3.4, §5; T-0247).
//
// Templates define allowed roles, duration, justification, and approval.
// Grants resolve allowed roles and duration from these templates.
// Deleting a template with active grants is refused with 409 and reports the affected grants.
import { AppError, ErrorCodes } from "../errors.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";
import type { Caller } from "../rbac/authorize.js";
import type {
  JitAdminTemplate,
  JitAdminTemplateInput,
  JitAdminTemplateUpdate,
  JitGrant,
} from "../../../db/src/repository.js";
import type { JitTemplatesRepository } from "../../../db/src/jit-templates-repository.js";

export const JIT_TEMPLATES_PATH = "/v1/jit-templates";
export const JIT_TEMPLATE_ITEM_PATH = "/v1/jit-templates/:id";

export const ROLES_READ_PERMISSION = "roles.read";
export const ROLES_WRITE_PERMISSION = "roles.write";
export const JIT_TEMPLATES_UNAUTHENTICATED = "request.unauthenticated";
export const JIT_TEMPLATE_IN_USE = "roles.jit_template_in_use";
export const JIT_ROLE_NOT_ALLOWED = "roles.role_not_allowed_by_template";

export interface ActiveGrantsResolver {
  getActiveGrantsForTemplate(templateId: string): Promise<readonly JitGrant[]>;
}

export interface JitTemplatesRouteOptions {
  readonly repository: JitTemplatesRepository;
  readonly activeGrantsResolver?: ActiveGrantsResolver;
  readonly resolveCaller: (ctx: RequestContext) => Caller | undefined;
  readonly authorize?: (caller: Caller, permission: string) => void | Promise<void>;
  readonly idGenerator?: () => string;
}

function unauthenticatedError(): AppError {
  return new AppError(JIT_TEMPLATES_UNAUTHENTICATED, "authentication required", 401);
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

export function validateGrantAgainstTemplate(
  template: JitAdminTemplate,
  roleId: string,
): void {
  const allowed = template.allowedRoles.map((r) => r.toLowerCase());
  if (!allowed.includes(roleId.toLowerCase())) {
    throw new AppError(
      JIT_ROLE_NOT_ALLOWED,
      `role '${roleId}' is not allowed by template '${template.name}' (allowed roles: ${template.allowedRoles.join(", ")})`,
      400,
      [{ field: "roleId", reason: "not_allowed_by_template" }],
    );
  }
}

export function createJitTemplatesRoutes(options: JitTemplatesRouteOptions): Route[] {
  const repo = options.repository;
  const generateId = options.idGenerator ?? (() => `jit-tpl-${Date.now()}`);

  const checkPerm = async (caller: Caller, perm: string) => {
    if (options.authorize) {
      await options.authorize(caller, perm);
    } else {
      const perms = caller.permissions ?? [];
      if (!perms.includes(perm) && !perms.includes("*")) {
        throw new AppError(ErrorCodes.forbidden, `forbidden: missing ${perm}`, 403);
      }
    }
  };

  // 1. List templates
  const listRoute: Route = {
    method: "GET",
    path: JIT_TEMPLATES_PATH,
    handler: async (ctx: RequestContext): Promise<RouteResponse> => {
      const caller = requireCaller(options.resolveCaller, ctx);
      await checkPerm(caller, ROLES_READ_PERMISSION);

      const items = await repo.listTemplates();
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { items },
      };
    },
  };

  // 2. Create template
  const createRoute: Route = {
    method: "POST",
    path: JIT_TEMPLATES_PATH,
    handler: async (ctx: RequestContext): Promise<RouteResponse> => {
      const caller = requireCaller(options.resolveCaller, ctx);
      await checkPerm(caller, ROLES_WRITE_PERMISSION);

      const body = (ctx.body ?? {}) as Partial<JitAdminTemplateInput>;
      if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
        throw validationError("name is required", "name");
      }
      if (!Array.isArray(body.allowedRoles) || body.allowedRoles.length === 0) {
        throw validationError("allowedRoles must be a non-empty list of roles", "allowedRoles");
      }

      const id = body.id ?? generateId();
      const template = await repo.createTemplate({
        id,
        name: body.name.trim(),
        description: body.description ?? null,
        allowedRoles: body.allowedRoles.map((r) => String(r).trim()),
        duration: body.duration ?? 8,
        maxDuration: body.maxDuration ?? 24,
        justificationRequired: body.justificationRequired !== false,
        approvalRequired: body.approvalRequired === true,
      });

      return {
        status: 201,
        headers: { "content-type": "application/json" },
        body: template,
      };
    },
  };

  // 3. Get template
  const getRoute: Route = {
    method: "GET",
    path: JIT_TEMPLATE_ITEM_PATH,
    handler: async (ctx: RequestContext): Promise<RouteResponse> => {
      const caller = requireCaller(options.resolveCaller, ctx);
      await checkPerm(caller, ROLES_READ_PERMISSION);

      const id = ctx.params["id"];
      if (!id) throw validationError("id is required", "id");

      const item = await repo.getTemplate(id);
      if (!item) {
        throw new AppError(ErrorCodes.notFound, `template '${id}' not found`, 404);
      }

      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: item,
      };
    },
  };

  // 4. Update template
  const updateRoute: Route = {
    method: "PATCH",
    path: JIT_TEMPLATE_ITEM_PATH,
    handler: async (ctx: RequestContext): Promise<RouteResponse> => {
      const caller = requireCaller(options.resolveCaller, ctx);
      await checkPerm(caller, ROLES_WRITE_PERMISSION);

      const id = ctx.params["id"];
      if (!id) throw validationError("id is required", "id");

      const body = (ctx.body ?? {}) as JitAdminTemplateUpdate;
      if (body.allowedRoles !== undefined && (!Array.isArray(body.allowedRoles) || body.allowedRoles.length === 0)) {
        throw validationError("allowedRoles cannot be empty", "allowedRoles");
      }

      const updated = await repo.updateTemplate(id, body);
      if (!updated) {
        throw new AppError(ErrorCodes.notFound, `template '${id}' not found`, 404);
      }

      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: updated,
      };
    },
  };

  // 5. Delete template (refused if active grants exist)
  const deleteRoute: Route = {
    method: "DELETE",
    path: JIT_TEMPLATE_ITEM_PATH,
    handler: async (ctx: RequestContext): Promise<RouteResponse> => {
      const caller = requireCaller(options.resolveCaller, ctx);
      await checkPerm(caller, ROLES_WRITE_PERMISSION);

      const id = ctx.params["id"];
      if (!id) throw validationError("id is required", "id");

      if (options.activeGrantsResolver) {
        const activeGrants = await options.activeGrantsResolver.getActiveGrantsForTemplate(id);
        if (activeGrants.length > 0) {
          throw new AppError(
            JIT_TEMPLATE_IN_USE,
            `cannot delete template '${id}': it has ${activeGrants.length} active grant(s)`,
            409,
            activeGrants.map((g) => ({ field: "grantId", reason: g.id })),
          );
        }
      }

      const ok = await repo.softDeleteTemplate(id);
      if (!ok) {
        throw new AppError(ErrorCodes.notFound, `template '${id}' not found`, 404);
      }

      return {
        status: 204,
        headers: {},
        body: null,
      };
    },
  };

  return [listRoute, createRoute, getRoute, updateRoute, deleteRoute];
}
