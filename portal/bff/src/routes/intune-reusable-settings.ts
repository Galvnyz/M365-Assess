// Intune reusable settings API (EPIC-016 SPEC.md §3.3, §4.3, §6, §7, §11.3; T-0308).
//
// Tenant routes (live settings via the Sync-ReusableSettings worker):
//   GET  /v1/tenants/:tenantId/intune/reusable-settings        — list live settings + scope type
//   POST /v1/tenants/:tenantId/intune/reusable-settings        — apply one template ({ templateId })
//   POST /v1/tenants/:tenantId/intune/reusable-settings/sync   — sync templates ({ templateIds? })
// Template routes (ReusableSettingTemplate persistence):
//   GET/POST /v1/intune-reusable-setting-templates, GET/PATCH/DELETE .../:id
//
// Apply and sync preview by default and write only when the body says `preview: false`;
// the preview is a per-setting diff plus the policies referencing each setting. Templates
// outside the v1 sync scope are rejected on write and again before any sync. Every write's
// audit event is recorded and returned.
import { AppError, ErrorCodes, type ErrorDetail } from "../errors.js";
import { RbacErrorCodes, requireTenantInScope, type Caller } from "../rbac/authorize.js";
import {
  collectCreateIssues,
  collectUpdateIssues,
  REUSABLE_SETTING_TYPES,
  reusableSettingTypeOf,
  type ReusableSettingTemplate,
  type ReusableSettingTemplateCreateInput,
  type ReusableSettingTemplateRepository,
  type ReusableSettingTemplateUpdateInput,
  type ValidationIssue,
} from "../repository/reusable-setting-templates.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const REUSABLE_SETTINGS_PATH = "/v1/tenants/:tenantId/intune/reusable-settings";
export const REUSABLE_SETTINGS_SYNC_PATH = "/v1/tenants/:tenantId/intune/reusable-settings/sync";
export const REUSABLE_SETTING_TEMPLATES_PATH = "/v1/intune-reusable-setting-templates";
export const REUSABLE_SETTING_TEMPLATE_PATH = "/v1/intune-reusable-setting-templates/:id";

export const REUSABLE_SETTINGS_PERMISSIONS = {
  read: "Endpoint.Intune.Read",
  write: "Endpoint.Intune.ReadWrite",
  remediationApply: "Remediation.Apply",
  templates: "Endpoint.IntuneTemplate.ReadWrite",
} as const;

export const ErrorCodesReusableTemplateNotFound = "reusable_setting_template.not_found" as const;
export const ErrorCodesReusableSettingOutOfScope = "reusable_setting.out_of_scope" as const;

export interface LiveReusableSetting {
  readonly id: string;
  readonly displayName: string;
  readonly settingDefinitionId: string;
  /** v1 scope type key, or null when the setting is outside the sync scope. */
  readonly type: string | null;
  readonly inScope: boolean;
  readonly referencingPolicyCount: number;
}

export interface ReusableSettingChange {
  readonly templateId: string;
  readonly displayName: string;
  readonly type: string;
  readonly action: "create" | "update" | "none";
  readonly settingId: string | null;
  readonly diff: readonly string[];
  readonly referencingPolicies: readonly { readonly id: string; readonly name: string }[];
}

export interface ReusableSettingWriteResult {
  readonly templateId: string;
  readonly displayName: string;
  readonly status: "succeeded" | "failed" | "skipped";
  readonly settingId: string | null;
  readonly error: string | null;
}

export interface ReusableSettingsSyncResult {
  readonly tenantId: string;
  readonly preview: boolean;
  readonly changes: readonly ReusableSettingChange[];
  readonly results: readonly ReusableSettingWriteResult[];
  readonly auditEvents: readonly Record<string, unknown>[];
}

/** Runs the Sync-ReusableSettings worker for one tenant. */
export interface ReusableSettingsProvider {
  listSettings(tenantId: string): Promise<readonly LiveReusableSetting[]>;
  sync(
    tenantId: string,
    templates: readonly ReusableSettingTemplate[],
    options: { readonly preview: boolean; readonly actor: string },
  ): Promise<ReusableSettingsSyncResult>;
}

export interface ReusableSettingsCaller extends Caller {
  readonly userId?: string;
}

/** Same seam as the T-0305 template routes: body and resolved permissions ride on the context. */
export interface ReusableSettingsRequestContext extends RequestContext {
  readonly body?: unknown;
  readonly permissions?: readonly string[];
}

export type ReusableSettingsAuthorizer = (ctx: ReusableSettingsRequestContext, permission: string) => boolean;

export interface ReusableSettingsRoutesOptions {
  readonly repository: ReusableSettingTemplateRepository;
  readonly provider: ReusableSettingsProvider;
  /** Resolves the caller's tenant scope for the tenant routes; undefined means unauthenticated. */
  readonly resolveCaller: (ctx: RequestContext) => ReusableSettingsCaller | undefined;
  readonly authorize?: ReusableSettingsAuthorizer;
  readonly recordAudit?: (event: Record<string, unknown>) => Promise<void>;
}

// Grant while the auth seam has not resolved permissions (T-0305 behaviour), otherwise
// require the permission or an admin scope.
function defaultAuthorize(ctx: ReusableSettingsRequestContext, permission: string): boolean {
  const granted = ctx.permissions;
  if (granted === undefined) return true;
  return granted.includes(permission) || granted.includes("CIPP.Admin.*") || granted.includes("*");
}

function forbidden(message: string): AppError {
  return new AppError(RbacErrorCodes.forbidden, message, 403);
}

function validationError(message: string, details: ErrorDetail[]): AppError {
  return new AppError(ErrorCodes.validationFailed, message, 400, details);
}

function issueDetails(issues: ValidationIssue[]): ErrorDetail[] {
  return issues.map((issue) => ({ field: issue.field, reason: issue.reason }));
}

function asBody(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw validationError("Request body must be a JSON object", [{ field: "body", reason: "must be a JSON object" }]);
  }
  return value as Record<string, unknown>;
}

function requireParam(ctx: RequestContext, name: string): string {
  const value = ctx.params[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError(`${name} is required`, [{ field: name, reason: "required" }]);
  }
  return value.trim();
}

function templateNotFound(id: string): AppError {
  return new AppError(ErrorCodesReusableTemplateNotFound, `Reusable setting template '${id}' not found`, 404);
}

export function createReusableSettingsRoutes(options: ReusableSettingsRoutesOptions): Route[] {
  const authorize = options.authorize ?? defaultAuthorize;

  function requirePermission(ctx: ReusableSettingsRequestContext, permission: string): void {
    if (!authorize(ctx, permission)) throw forbidden(`forbidden: requires ${permission}`);
  }

  function requireWrite(ctx: ReusableSettingsRequestContext): void {
    if (
      !authorize(ctx, REUSABLE_SETTINGS_PERMISSIONS.write) &&
      !authorize(ctx, REUSABLE_SETTINGS_PERMISSIONS.remediationApply)
    ) {
      throw forbidden(
        `forbidden: requires ${REUSABLE_SETTINGS_PERMISSIONS.write} or ${REUSABLE_SETTINGS_PERMISSIONS.remediationApply}`,
      );
    }
  }

  /** Authenticated caller with the tenant in scope. */
  function tenantCaller(ctx: RequestContext): { caller: ReusableSettingsCaller; tenantId: string } {
    const caller = options.resolveCaller(ctx);
    if (caller === undefined) throw new AppError("request.unauthenticated", "authentication required", 401);
    const tenantId = requireParam(ctx, "tenantId");
    requireTenantInScope(caller, tenantId);
    return { caller, tenantId };
  }

  /** Defence in depth: stored templates were validated on write, but the scope may have narrowed. */
  function assertInScope(templates: readonly ReusableSettingTemplate[]): void {
    const outOfScope = templates.filter((t) => !reusableSettingTypeOf(t.settingsJson));
    if (outOfScope.length > 0) {
      throw new AppError(
        ErrorCodesReusableSettingOutOfScope,
        `Templates outside the v1 reusable-settings sync scope: ${outOfScope.map((t) => t.id).join(", ")}`,
        400,
        outOfScope.map((t) => ({ field: "templateIds", reason: `${t.id} is out of scope` })),
      );
    }
  }

  async function runSync(
    tenantId: string,
    caller: ReusableSettingsCaller,
    templates: readonly ReusableSettingTemplate[],
    preview: boolean,
  ): Promise<RouteResponse> {
    assertInScope(templates);
    const result = await options.provider.sync(tenantId, templates, {
      preview,
      actor: caller.userId ?? "system",
    });
    if (!preview && options.recordAudit) {
      for (const event of result.auditEvents) await options.recordAudit(event);
    }
    const failed = result.results.filter((r) => r.status === "failed").length;
    const written = result.results.filter((r) => r.status !== "skipped").length;
    const status = preview || failed === 0 ? 200 : failed === written ? 422 : 207;
    return { status, body: result };
  }

  /** Preview unless the body explicitly says `preview: false`. */
  function isPreview(body: Record<string, unknown>): boolean {
    return body.preview !== false;
  }

  return [
    {
      method: "GET",
      path: REUSABLE_SETTINGS_PATH,
      handler: async (ctx): Promise<RouteResponse> => {
        const context = ctx as ReusableSettingsRequestContext;
        const { tenantId } = tenantCaller(ctx);
        requirePermission(context, REUSABLE_SETTINGS_PERMISSIONS.read);
        const items = await options.provider.listSettings(tenantId);
        return {
          status: 200,
          body: {
            tenantId,
            items,
            syncScope: REUSABLE_SETTING_TYPES.map((t) => ({ key: t.key, displayName: t.displayName })),
          },
        };
      },
    },
    {
      method: "POST",
      path: REUSABLE_SETTINGS_PATH,
      handler: async (ctx): Promise<RouteResponse> => {
        const context = ctx as ReusableSettingsRequestContext;
        const { caller, tenantId } = tenantCaller(ctx);
        requireWrite(context);
        const body = asBody(context.body);
        if (typeof body.templateId !== "string" || !body.templateId.trim()) {
          throw validationError("templateId is required", [{ field: "templateId", reason: "required" }]);
        }
        const template = await options.repository.get(body.templateId.trim());
        if (!template) throw templateNotFound(body.templateId.trim());
        return runSync(tenantId, caller, [template], isPreview(body));
      },
    },
    {
      method: "POST",
      path: REUSABLE_SETTINGS_SYNC_PATH,
      handler: async (ctx): Promise<RouteResponse> => {
        const context = ctx as ReusableSettingsRequestContext;
        const { caller, tenantId } = tenantCaller(ctx);
        requireWrite(context);
        const body = asBody(context.body);
        let templates: ReusableSettingTemplate[];
        if (body.templateIds === undefined) {
          templates = await options.repository.list();
        } else if (Array.isArray(body.templateIds)) {
          templates = [];
          for (const raw of body.templateIds) {
            const id = String(raw).trim();
            const template = await options.repository.get(id);
            if (!template) throw templateNotFound(id);
            templates.push(template);
          }
        } else {
          throw validationError("templateIds must be an array", [{ field: "templateIds", reason: "must be an array" }]);
        }
        if (templates.length === 0) {
          throw validationError("no reusable setting templates to sync", [{ field: "templateIds", reason: "empty" }]);
        }
        return runSync(tenantId, caller, templates, isPreview(body));
      },
    },
    {
      method: "GET",
      path: REUSABLE_SETTING_TEMPLATES_PATH,
      handler: async (ctx): Promise<RouteResponse> => {
        requirePermission(ctx as ReusableSettingsRequestContext, REUSABLE_SETTINGS_PERMISSIONS.read);
        const items = await options.repository.list();
        return {
          status: 200,
          body: { items: items.map((t) => ({ ...t, type: reusableSettingTypeOf(t.settingsJson)?.key ?? null })) },
        };
      },
    },
    {
      method: "GET",
      path: REUSABLE_SETTING_TEMPLATE_PATH,
      handler: async (ctx): Promise<RouteResponse> => {
        requirePermission(ctx as ReusableSettingsRequestContext, REUSABLE_SETTINGS_PERMISSIONS.read);
        const id = requireParam(ctx, "id");
        const template = await options.repository.get(id);
        if (!template) throw templateNotFound(id);
        return { status: 200, body: template };
      },
    },
    {
      method: "POST",
      path: REUSABLE_SETTING_TEMPLATES_PATH,
      handler: async (ctx): Promise<RouteResponse> => {
        const context = ctx as ReusableSettingsRequestContext;
        requirePermission(context, REUSABLE_SETTINGS_PERMISSIONS.templates);
        const body = asBody(context.body);
        const input: ReusableSettingTemplateCreateInput = {
          ...(typeof body.id === "string" ? { id: body.id } : {}),
          name: typeof body.name === "string" ? body.name : "",
          settingsJson: body.settingsJson as Record<string, unknown>,
        };
        const issues = collectCreateIssues(input);
        if (issues.length > 0) throw validationError("Invalid reusable setting template", issueDetails(issues));
        return { status: 201, body: await options.repository.create(input) };
      },
    },
    {
      method: "PATCH",
      path: REUSABLE_SETTING_TEMPLATE_PATH,
      handler: async (ctx): Promise<RouteResponse> => {
        const context = ctx as ReusableSettingsRequestContext;
        requirePermission(context, REUSABLE_SETTINGS_PERMISSIONS.templates);
        const id = requireParam(ctx, "id");
        const body = asBody(context.body);
        const input: ReusableSettingTemplateUpdateInput = {
          ...(body.name !== undefined ? { name: body.name as string } : {}),
          ...(body.settingsJson !== undefined ? { settingsJson: body.settingsJson as Record<string, unknown> } : {}),
        };
        const issues = collectUpdateIssues(input);
        if (issues.length > 0) throw validationError("Invalid reusable setting template", issueDetails(issues));
        const updated = await options.repository.update(id, input);
        if (!updated) throw templateNotFound(id);
        return { status: 200, body: updated };
      },
    },
    {
      method: "DELETE",
      path: REUSABLE_SETTING_TEMPLATE_PATH,
      handler: async (ctx): Promise<RouteResponse> => {
        requirePermission(ctx as ReusableSettingsRequestContext, REUSABLE_SETTINGS_PERMISSIONS.templates);
        const id = requireParam(ctx, "id");
        if (!(await options.repository.remove(id))) throw templateNotFound(id);
        return { status: 204 };
      },
    },
  ];
}
