// Group templates CRUD API (EPIC-014 SPEC.md §3.2, §5, §6, §7; T-0265).
// Exposes GET/POST/PATCH/DELETE /v1/group-templates behind RBAC `Identity.GroupTemplate.ReadWrite`.
// Templates persist only locally in SQLite repository; no tenant writes are introduced here.
import { AppError, ErrorCodes } from "../errors.js";
import type { Caller } from "../rbac/authorize.js";
import type {
  GroupTemplateCreateInput,
  GroupTemplateRepository,
  GroupTemplateUpdateInput,
} from "../repository/group-templates.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const GROUP_TEMPLATES_PATH = "/v1/group-templates";
export const GROUP_TEMPLATE_ITEM_PATH = "/v1/group-templates/:id";

export const GROUP_TEMPLATES_PERMISSION = "Identity.GroupTemplate.ReadWrite";
export const GROUP_TEMPLATES_UNAUTHENTICATED = "request.unauthenticated";

export interface GroupTemplatesCaller extends Caller {
  readonly userId?: string;
}

export type GroupTemplatesAuthorizer = (
  caller: GroupTemplatesCaller,
  permission: string,
) => void | Promise<void>;

export interface GroupTemplatesRoutesOptions {
  readonly repository: GroupTemplateRepository;
  readonly resolveCaller: (ctx: RequestContext) => GroupTemplatesCaller | undefined;
  readonly authorize?: GroupTemplatesAuthorizer;
}

function unauthenticatedError(): AppError {
  return new AppError(GROUP_TEMPLATES_UNAUTHENTICATED, "authentication required", 401);
}

function notFoundError(id: string): AppError {
  return new AppError(ErrorCodes.notFound, `Group template '${id}' not found`, 404);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => GroupTemplatesCaller | undefined,
  ctx: RequestContext,
): GroupTemplatesCaller {
  const caller = resolveCaller(ctx);
  if (caller === undefined) {
    throw unauthenticatedError();
  }
  return caller;
}

function requireIdParam(ctx: RequestContext): string {
  const value = ctx.params["id"];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "id is required", 400, [
      { field: "id", reason: "required" },
    ]);
  }
  return value.trim();
}

async function authorizePermission(
  options: GroupTemplatesRoutesOptions,
  caller: GroupTemplatesCaller,
): Promise<void> {
  if (options.authorize) {
    await options.authorize(caller, GROUP_TEMPLATES_PERMISSION);
  } else {
    const permissions = caller.permissions ?? [];
    if (!permissions.includes(GROUP_TEMPLATES_PERMISSION) && !permissions.includes("*")) {
      throw new AppError(
        ErrorCodes.forbidden,
        "forbidden: missing groups.templates permission",
        403,
      );
    }
  }
}

export function createGroupTemplatesRoutes(options: GroupTemplatesRoutesOptions): Route[] {
  return [
    // GET /v1/group-templates - list
    {
      method: "GET",
      path: GROUP_TEMPLATES_PATH,
      handler: async (ctx: RequestContext): Promise<RouteResponse> => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorizePermission(options, caller);

        const templates = await options.repository.list();
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: { items: templates, totalCount: templates.length },
        };
      },
    },

    // POST /v1/group-templates - create
    {
      method: "POST",
      path: GROUP_TEMPLATES_PATH,
      handler: async (ctx: RequestContext): Promise<RouteResponse> => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorizePermission(options, caller);

        const body = (ctx.body ?? {}) as Record<string, unknown>;
        const input: GroupTemplateCreateInput = {
          name: typeof body.name === "string" ? body.name : "",
          groupType: typeof body.groupType === "string" ? body.groupType : "",
          naming: body.naming as any,
          owners: body.owners as any,
          members: body.members as any,
          settings: body.settings as any,
          licensing: body.licensing as any,
        };

        const created = await options.repository.create(input);
        return {
          status: 201,
          headers: { "content-type": "application/json" },
          body: created,
        };
      },
    },

    // GET /v1/group-templates/:id - get
    {
      method: "GET",
      path: GROUP_TEMPLATE_ITEM_PATH,
      handler: async (ctx: RequestContext): Promise<RouteResponse> => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorizePermission(options, caller);

        const id = requireIdParam(ctx);
        const template = await options.repository.get(id);
        if (!template) {
          throw notFoundError(id);
        }

        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: template,
        };
      },
    },

    // PATCH /v1/group-templates/:id - edit
    {
      method: "PATCH",
      path: GROUP_TEMPLATE_ITEM_PATH,
      handler: async (ctx: RequestContext): Promise<RouteResponse> => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorizePermission(options, caller);

        const id = requireIdParam(ctx);
        const body = (ctx.body ?? {}) as Record<string, unknown>;
        const updateInput: GroupTemplateUpdateInput = {
          name: typeof body.name === "string" ? body.name : undefined,
          groupType: typeof body.groupType === "string" ? body.groupType : undefined,
          naming: body.naming as any,
          owners: body.owners as any,
          members: body.members as any,
          settings: body.settings as any,
          licensing: body.licensing as any,
        };

        const updated = await options.repository.update(id, updateInput);
        if (!updated) {
          throw notFoundError(id);
        }

        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: updated,
        };
      },
    },

    // DELETE /v1/group-templates/:id - delete
    {
      method: "DELETE",
      path: GROUP_TEMPLATE_ITEM_PATH,
      handler: async (ctx: RequestContext): Promise<RouteResponse> => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorizePermission(options, caller);

        const id = requireIdParam(ctx);
        const deleted = await options.repository.delete(id);
        if (!deleted) {
          throw notFoundError(id);
        }

        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: { deleted: true, id },
        };
      },
    },
  ];
}
