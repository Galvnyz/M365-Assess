// PIM role settings templates CRUD, compare, and apply (EPIC-013 SPEC.md §3.2, §4.2, §5, §8, §11.3; T-0243, T-0244).
//
// Reusable role settings templates (max duration, MFA, justification, approval).
// In v1, templates are strictly per-role (scope = '/'); a template specifying a custom
// scope (role+scope) is rejected as out of scope (§11.3).
// Compare returns current-vs-template differences without writing to the tenant.
// Apply routes through EPIC-006 remediation semantics (confirmation, before/after, audit).
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
export const PIM_TEMPLATE_APPLY_PATH = "/v1/pim-settings-templates/:id/apply";

export const PIM_TEMPLATES_READ_PERMISSION = "Identity.Role.Read";
export const PIM_TEMPLATES_WRITE_PERMISSION = "Identity.Role.ReadWrite";
export const REMEDIATION_APPLY_PERMISSION = "Remediation.Apply";

export const PIM_TEMPLATES_UNAUTHENTICATED = "request.unauthenticated";
export const PIM_SCOPE_OUT_OF_SCOPE = "roles.pim_role_scope_unsupported";
export const PIM_NO_TARGET_ROLE = "roles.pim_no_target_role";
export const PIM_APPLY_CONFIRM_REQUIRED = "roles.pim_confirm_required";

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

export interface PimApplyResult {
  readonly templateId: string;
  readonly tenantId: string;
  readonly roleId: string;
  readonly dryRun: boolean;
  readonly current: PimRoleSettings;
  readonly proposed: PimRoleSettings;
  readonly diffs: readonly SettingDiff[];
  readonly applied: PimRoleSettings | null;
}

export interface LiveRoleSettingsProvider {
  getLiveRoleSettings(
    tenantId: string,
    roleId: string,
  ): Promise<PimRoleSettings | undefined>;
}

export interface PimSettingsApplyOutcome {
  readonly applied: PimRoleSettings;
  readonly before?: PimRoleSettings;
  readonly after?: PimRoleSettings;
}

export interface PimSettingsApplyProvider {
  applySettings(
    tenantId: string,
    roleId: string,
    settings: PimRoleSettings,
    options: { dryRun: boolean },
  ): Promise<PimSettingsApplyOutcome>;
}

export interface PimSettingsAuditEvent {
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

export interface PimSettingsRouteOptions {
  readonly repository: PimSettingsRepository;
  readonly liveSettingsProvider?: LiveRoleSettingsProvider;
  readonly applyProvider?: PimSettingsApplyProvider;
  readonly resolveCaller: (ctx: RequestContext) => Caller | undefined;
  readonly authorize?: (caller: Caller, permission: string) => void | Promise<void>;
  readonly recordAudit?: (event: PimSettingsAuditEvent) => Promise<void>;
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

  // 7. Apply template with plan preview (T-0244)
  const applyRoute: Route = {
    method: "POST",
    path: PIM_TEMPLATE_APPLY_PATH,
    handler: async (ctx: RequestContext): Promise<RouteResponse> => {
      const caller = requireCaller(options.resolveCaller, ctx);

      const id = ctx.params["id"];
      if (!id) throw validationError("id is required", "id");

      const template = await repo.getTemplate(id);
      if (!template) {
        throw new AppError(ErrorCodes.notFound, `template '${id}' not found`, 404);
      }

      const body = (ctx.body ?? {}) as {
        tenantId?: string;
        roleId?: string;
        preview?: boolean;
        confirm?: boolean;
        reason?: string;
      };

      const tenantId = body.tenantId ?? ctx.query.get("tenantId");
      if (!tenantId || typeof tenantId !== "string" || tenantId.trim().length === 0) {
        throw validationError("tenantId is required", "tenantId");
      }

      requireTenantInScope(caller, tenantId.trim());

      const targetRoleId = body.roleId ?? template.roleId;
      if (!targetRoleId) {
        throw new AppError(
          PIM_NO_TARGET_ROLE,
          "template has no target role specified and cannot be applied",
          400,
          [{ field: "roleId", reason: "missing_target_role" }],
        );
      }

      const preview = body.preview === true;

      const liveSettings = options.liveSettingsProvider
        ? (await options.liveSettingsProvider.getLiveRoleSettings(tenantId, targetRoleId)) ?? {}
        : {};

      const diffs = computeSettingsDiff(template.settings, liveSettings);

      if (preview) {
        // Preview mode: does NOT write anything
        await checkPerm(caller, PIM_TEMPLATES_READ_PERMISSION);

        const previewResult: PimApplyResult = {
          templateId: template.id,
          tenantId,
          roleId: targetRoleId,
          dryRun: true,
          current: liveSettings,
          proposed: template.settings,
          diffs,
          applied: null,
        };

        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: previewResult,
        };
      }

      // Apply mode: privileged write routed through EPIC-006 gate/executor
      await checkPerm(caller, REMEDIATION_APPLY_PERMISSION);

      if (body.confirm !== true) {
        throw new AppError(
          PIM_APPLY_CONFIRM_REQUIRED,
          'applying PIM role settings requires explicit confirmation: { "confirm": true } and a reason',
          400,
          [{ field: "confirm", reason: "required" }],
        );
      }

      if (!body.reason || typeof body.reason !== "string" || body.reason.trim().length === 0) {
        throw validationError("reason is required when applying PIM role settings", "reason");
      }

      if (!options.applyProvider) {
        throw new AppError(
          ErrorCodes.internalError,
          "applyProvider is not configured on PIM route",
          500,
        );
      }

      try {
        const outcome = await options.applyProvider.applySettings(
          tenantId,
          targetRoleId,
          template.settings,
          { dryRun: false },
        );

        if (options.recordAudit) {
          await options.recordAudit({
            tenantId,
            action: "pim.settingsApply",
            targetId: targetRoleId,
            result: "success",
            before: liveSettings,
            after: outcome.applied,
            callerId: (caller as { userId?: string }).userId,
            reason: body.reason.trim(),
            timestamp: new Date().toISOString(),
          });
        }

        const applyResult: PimApplyResult = {
          templateId: template.id,
          tenantId,
          roleId: targetRoleId,
          dryRun: false,
          current: liveSettings,
          proposed: template.settings,
          diffs,
          applied: outcome.applied,
        };

        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: applyResult,
        };
      } catch (err) {
        if (options.recordAudit) {
          await options.recordAudit({
            tenantId,
            action: "pim.settingsApply",
            targetId: targetRoleId,
            result: "failure",
            before: liveSettings,
            after: null,
            callerId: (caller as { userId?: string }).userId,
            reason: body.reason.trim(),
            timestamp: new Date().toISOString(),
          });
        }
        throw err;
      }
    },
  };

  return [listRoute, createRoute, getRoute, updateRoute, deleteRoute, compareRoute, applyRoute];
}
