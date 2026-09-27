// CA template deploy API (EPIC-015 SPEC.md §3.2, §4.2, §6, §8; T-0286).
// Exposes POST /v1/ca-templates/:id/deploy behind gated-write seam.
// Accepts deploy-drawer options: group/user handling, policy state (report-only default),
// overwrite switch, disable-security-defaults switch, create-groups toggle.
// Returns a plan preview before apply; enforces T-0282 guardrails; audits each created policy.
import {
  validateCaPolicy,
  type CaPolicyPayload,
} from "../domain/ca-policy-validation.js";
import { AppError, ErrorCodes } from "../errors.js";
import { requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { CaTemplate, CaTemplateRepository } from "../repository/ca-templates.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const CA_TEMPLATE_DEPLOY_PATH = "/v1/ca-templates/:id/deploy";

export const CA_DEPLOY_PERMISSION = "Tenant.ConditionalAccess.ReadWrite";
export const REMEDIATION_APPLY_PERMISSION = "Remediation.Apply";
export const CA_DEPLOY_UNAUTHENTICATED = "request.unauthenticated";
export const ErrorCodesTemplateNotFound = "ca_template.not_found" as const;

export interface CaDeployDrawerOptions {
  readonly tenantId: string;
  readonly policyName?: string;
  readonly policyState?: string;
  readonly groupUserHandling?: "all" | "assigned" | "custom" | string;
  readonly createGroups?: boolean;
  readonly overwrite?: boolean;
  readonly disableSecurityDefaults?: boolean;
  readonly breakGlassExclusions?: readonly string[];
  readonly preview?: boolean;
}

export interface CaDeployPlan {
  readonly action: "create" | "update";
  readonly tenantId: string;
  readonly templateId: string;
  readonly policyName: string;
  readonly policyState: string;
  readonly disableSecurityDefaults: boolean;
  readonly overwrite: boolean;
  readonly conflict: boolean;
  readonly conflictMessage?: string | null;
  readonly diff: readonly string[];
  readonly groupsToCreate: readonly string[];
  readonly valid: boolean;
  readonly dryRun: boolean;
}

export interface CaDeployResult {
  readonly success: boolean;
  readonly plan: CaDeployPlan;
  readonly result?: Record<string, unknown>;
  readonly auditEvent?: Record<string, unknown>;
}

export interface CaTemplateDeployProvider {
  planDeploy(
    template: CaTemplate,
    options: CaDeployDrawerOptions,
  ): Promise<CaDeployPlan>;

  executeDeploy(
    template: CaTemplate,
    options: CaDeployDrawerOptions,
  ): Promise<CaDeployResult>;
}

export interface CaDeployCaller extends Caller {
  readonly userId?: string;
}

export type CaDeployAuthorizer = (
  caller: CaDeployCaller,
  permission: string,
) => void | Promise<void>;

export interface CaTemplateDeployRouteOptions {
  readonly repository: CaTemplateRepository;
  readonly provider: CaTemplateDeployProvider;
  readonly resolveCaller: (ctx: RequestContext) => CaDeployCaller | undefined;
  readonly authorize?: CaDeployAuthorizer;
}

function unauthenticatedError(): AppError {
  return new AppError(CA_DEPLOY_UNAUTHENTICATED, "authentication required", 401);
}

function validationError(message: string, field: string): AppError {
  return new AppError(ErrorCodes.validationFailed, message, 400, [
    { field, reason: "invalid" },
  ]);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => CaDeployCaller | undefined,
  ctx: RequestContext,
): CaDeployCaller {
  const caller = resolveCaller(ctx);
  if (caller === undefined) {
    throw unauthenticatedError();
  }
  return caller;
}

function requireIdParam(ctx: RequestContext): string {
  const value = ctx.params["id"];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "template id is required", 400, [
      { field: "id", reason: "required" },
    ]);
  }
  return value.trim();
}

async function authorizeDeploy(
  options: CaTemplateDeployRouteOptions,
  caller: CaDeployCaller,
): Promise<void> {
  if (options.authorize) {
    await options.authorize(caller, CA_DEPLOY_PERMISSION);
    return;
  }
  const permissions = caller.permissions ?? [];
  const allowed =
    permissions.includes(CA_DEPLOY_PERMISSION) ||
    permissions.includes(REMEDIATION_APPLY_PERMISSION) ||
    permissions.includes("*") ||
    permissions.includes("CIPP.Admin.*");
  if (!allowed) {
    throw new AppError(
      ErrorCodes.forbidden,
      `forbidden: deploy requires ${CA_DEPLOY_PERMISSION} or ${REMEDIATION_APPLY_PERMISSION}`,
      403,
    );
  }
}

export function createCaTemplateDeployRoute(options: CaTemplateDeployRouteOptions): Route {
  return {
    method: "POST",
    path: CA_TEMPLATE_DEPLOY_PATH,
    handler: async (ctx: RequestContext): Promise<RouteResponse> => {
      const caller = requireCaller(options.resolveCaller, ctx);
      const templateId = requireIdParam(ctx);

      const template = await options.repository.get(templateId);
      if (!template) {
        throw new AppError(
          ErrorCodesTemplateNotFound,
          `CA template '${templateId}' not found`,
          404,
        );
      }

      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
      if (!tenantId) {
        throw validationError("tenantId is required in deploy request", "tenantId");
      }

      requireTenantInScope(caller, tenantId);
      await authorizeDeploy(options, caller);

      const isPreview = Boolean(body.preview || ctx.query.get("preview") === "true");
      const policyState =
        typeof body.policyState === "string" && body.policyState.trim()
          ? body.policyState.trim()
          : "enabledForReportingButNotEnforced";

      const breakGlassExclusions = Array.isArray(body.breakGlassExclusions)
        ? body.breakGlassExclusions.map((x) => String(x))
        : [];

      // Validate template with T-0282 guardrails
      const policyPayload: CaPolicyPayload = {
        displayName:
          typeof body.policyName === "string" && body.policyName.trim()
            ? body.policyName.trim()
            : template.name,
        state: policyState,
        conditions: {
          ...(template.policyJson.conditions as any),
          users: {
            ...((template.policyJson.conditions as any)?.users || {}),
            excludeUsers: [
              ...(((template.policyJson.conditions as any)?.users?.excludeUsers as string[]) || []),
              ...breakGlassExclusions,
            ],
          },
        },
        grantControls: template.policyJson.grantControls as any,
      };

      const validation = validateCaPolicy(policyPayload, { isCreate: true });
      if (!validation.valid) {
        const firstErr = validation.errors[0]!;
        throw new AppError(ErrorCodes.validationFailed, firstErr.message, 400, [
          { field: firstErr.field ?? "template", reason: firstErr.code },
        ]);
      }

      const deployOptions: CaDeployDrawerOptions = {
        tenantId,
        policyName: policyPayload.displayName,
        policyState,
        groupUserHandling: typeof body.groupUserHandling === "string" ? body.groupUserHandling : "all",
        createGroups: Boolean(body.createGroups),
        overwrite: Boolean(body.overwrite),
        disableSecurityDefaults: Boolean(body.disableSecurityDefaults),
        breakGlassExclusions,
        preview: isPreview,
      };

      if (isPreview) {
        const plan = await options.provider.planDeploy(template, deployOptions);
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: plan,
        };
      }

      const result = await options.provider.executeDeploy(template, deployOptions);
      return {
        status: 201,
        headers: { "content-type": "application/json" },
        body: result,
      };
    },
  };
}
