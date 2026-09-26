// PIM role settings templates CRUD and compare (EPIC-013 SPEC.md §3.2, §4.2, §5, §11.3; T-0243).
//
// Reusable role settings templates (max duration, MFA, justification, approval).
// In v1, templates are strictly per-role (scope = '/'); a template specifying a custom
// scope (role+scope) is rejected as out of scope (§11.3).
// Compare returns current-vs-template differences without writing to the tenant.
import { AppError, ErrorCodes } from "../errors.js";
import { requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";
import type {
  PimRoleSettings,
  PimRoleSettingsTemplate,
  PimRoleSettingsTemplateInput,
  PimRoleSettingsTemplateUpdate,
} from "../../../db/src/repository.js";
import type { PimSettingsRepository } from "../../../db/src/pim-settings-repository.js";

export const PIM_TEMPLATES_PATH = "/v1/pim-settings-templates";
export const PIM_TEMPLATE_ITEM_PATH = "/v1/pim-settings-templates/:id";
export const PIM_TEMPLATE_COMPARE_PATH = "/v1/pim-settings-templates/:id/compare";

export const PIM_TEMPLATES_READ_PERMISSION = "roles.read";
export const PIM_TEMPLATES_WRITE_PERMISSION = "roles.write";
export const PIM_TEMPLATES_UNAUTHENTICATED = "request.unauthenticated";
export const PIM_SCOPE_OUT_OF_SCOPE = "roles.pim_role_scope_unsupported";

export interface SettingDiff {
  readonly setting: string;
  readonly current: unknown;
  readonly template: unknown;
  readonly matches: boolean;
}

export interface PimCompareResult {
  readonly templateId: string;
  readonly tenantId: string;
  readonly roleId: string;
  readonly diffs: readonly SettingDiff[];
  readonly hasDifferences: boolean;
}

export interface LiveRoleSettingsProvider {
  getLiveRoleSettings(
    tenantId: string,
    roleId: string,
  ): Promise<PimRoleSettings | undefined>;
}

export interface PimSettingsRouteOptions {
  readonly repository: PimSettingsRepository;
  readonly liveSettingsProvider?: LiveRoleSettingsProvider;
  readonly resolveCaller: (ctx: RequestContext) => Caller | undefined;
  readonly authorize?: (caller: Caller, permission: string) => void | Promise<void>;
  readonly idGenerator?: () => string;
}

function unauthenticatedError(): AppError {
  return new AppError(PIM_TEMPLATES_UNAUTHENTICATED, "authentication required", 401);
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

function validateScope(scope: string | undefined): void {
  if (scope !== undefined && scope !== null && scope !== "" && scope !== "/") {
    throw new AppError(
      PIM_SCOPE_OUT_OF_SCOPE,
      "role+scope templates are out of scope for v1 (scope must be '/' or empty)",
      400,
      [{ field: "scope", reason: "out_of_scope" }],
    );
  }
}

export function computeSettingsDiff(
  templateSettings: PimRoleSettings,
  liveSettings: PimRoleSettings = {},
): SettingDiff[] {
  const keys = Array.from(
    new Set([...Object.keys(templateSettings), ...Object.keys(liveSettings)]),
  ).sort();

  return keys.map((key) => {
    const templateVal = templateSettings[key];
    const liveVal = liveSettings[key];
    const matches = JSON.stringify(templateVal) === JSON.stringify(liveVal);
    return {
      setting: key,
      current: liveVal !== undefined ? liveVal : null,
      template: templateVal !== undefined ? templateVal : null,
      matches,
    };
  });
}

export function createPimSettingsTemplatesRoutes(
  options: PimSettingsRouteOptions,
): Route[] {
  const repo = options.repository;
  const generateId = options.idGenerator ?? (() => `pim-tpl-${Date.now()}`);

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
    path: PIM_TEMPLATES_PATH,
    handler: async (ctx: RequestContext): Promise<RouteResponse> => {
      const caller = requireCaller(options.resolveCaller, ctx);
      await checkPerm(caller, PIM_TEMPLATES_READ_PERMISSION);

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
    path: PIM_TEMPLATES_PATH,
    handler: async (ctx: RequestContext): Promise<RouteResponse> => {
      const caller = requireCaller(options.resolveCaller, ctx);
      await checkPerm(caller, PIM_TEMPLATES_WRITE_PERMISSION);

      const body = (ctx.body ?? {}) as Partial<PimRoleSettingsTemplateInput>;
      if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
        throw validationError("name is required", "name");
      }

      validateScope(body.scope);

      const id = body.id ?? generateId();
      const template = await repo.createTemplate({
        id,
        name: body.name.trim(),
        roleId: body.roleId ? body.roleId.trim() : null,
        settings: body.settings ?? {},
        scope: body.scope ? body.scope.trim() : "/",
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
    path: PIM_TEMPLATE_ITEM_PATH,
    handler: async (ctx: RequestContext): Promise<RouteResponse> => {
      const caller = requireCaller(options.resolveCaller, ctx);
      await checkPerm(caller, PIM_TEMPLATES_READ_PERMISSION);

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
    path: PIM_TEMPLATE_ITEM_PATH,
    handler: async (ctx: RequestContext): Promise<RouteResponse> => {
      const caller = requireCaller(options.resolveCaller, ctx);
      await checkPerm(caller, PIM_TEMPLATES_WRITE_PERMISSION);

      const id = ctx.params["id"];
      if (!id) throw validationError("id is required", "id");

      const body = (ctx.body ?? {}) as PimRoleSettingsTemplateUpdate;
      if (body.scope !== undefined) {
        validateScope(body.scope);
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

  // 5. Delete template
  const deleteRoute: Route = {
    method: "DELETE",
    path: PIM_TEMPLATE_ITEM_PATH,
    handler: async (ctx: RequestContext): Promise<RouteResponse> => {
      const caller = requireCaller(options.resolveCaller, ctx);
      await checkPerm(caller, PIM_TEMPLATES_WRITE_PERMISSION);

      const id = ctx.params["id"];
      if (!id) throw validationError("id is required", "id");

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

  // 6. Compare template against live role settings
  const compareRoute: Route = {
    method: "POST",
    path: PIM_TEMPLATE_COMPARE_PATH,
    handler: async (ctx: RequestContext): Promise<RouteResponse> => {
      const caller = requireCaller(options.resolveCaller, ctx);
      await checkPerm(caller, PIM_TEMPLATES_READ_PERMISSION);

      const id = ctx.params["id"];
      if (!id) throw validationError("id is required", "id");

      const template = await repo.getTemplate(id);
      if (!template) {
        throw new AppError(ErrorCodes.notFound, `template '${id}' not found`, 404);
      }

      const body = (ctx.body ?? {}) as { tenantId?: string; roleId?: string };
      const tenantId = body.tenantId ?? ctx.query.get("tenantId");
      if (!tenantId || typeof tenantId !== "string" || tenantId.trim().length === 0) {
        throw validationError("tenantId is required for compare", "tenantId");
      }

      requireTenantInScope(caller, tenantId.trim());

      const targetRoleId = body.roleId ?? template.roleId;
      if (!targetRoleId) {
        throw validationError(
          "roleId must be specified in the template or request body for compare",
          "roleId",
        );
      }

      const liveSettings = options.liveSettingsProvider
        ? await options.liveSettingsProvider.getLiveRoleSettings(tenantId, targetRoleId)
        : {};

      const diffs = computeSettingsDiff(template.settings, liveSettings ?? {});
      const hasDifferences = diffs.some((d) => !d.matches);

      const result: PimCompareResult = {
        templateId: template.id,
        tenantId,
        roleId: targetRoleId,
        diffs,
        hasDifferences,
      };

      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: result,
      };
    },
  };

  return [listRoute, createRoute, getRoute, updateRoute, deleteRoute, compareRoute];
}
