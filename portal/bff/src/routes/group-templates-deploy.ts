// Group template deploy API (EPIC-014 SPEC.md §4.2, §5, §6, §8, §11.2; T-0266).
// Exposes POST /v1/group-templates/:id/deploy behind gated-write seam.
// Resolves template + variables -> plan -> apply, per target, with partial failures reported.
import { randomUUID } from "node:crypto";
import { AppError, ErrorCodes } from "../errors.js";
import { requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { GroupTemplate, GroupTemplateRepository } from "../repository/group-templates.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const GROUP_TEMPLATE_DEPLOY_PATH = "/v1/group-templates/:id/deploy";

export const GROUPS_TEMPLATES_PERMISSION = "groups.templates";
export const GROUPS_WRITE_PERMISSION = "groups.write";
export const REMEDIATION_APPLY_PERMISSION = "remediation.apply";
export const GROUPS_DEPLOY_UNAUTHENTICATED = "request.unauthenticated";

export interface GroupTemplateDeployment {
  readonly id: string;
  readonly templateId: string;
  readonly tenantId: string;
  readonly state: "succeeded" | "failed" | "partial";
  readonly results: readonly Record<string, unknown>[];
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TargetDeployPlan {
  readonly tenantId: string;
  readonly targetName: string;
  readonly diff: readonly string[];
  readonly valid: boolean;
  readonly conflict?: boolean;
  readonly conflictError?: string | null;
}

export interface DeployTemplateResult {
  readonly targetId: string;
  readonly tenantId: string;
  readonly deployment: GroupTemplateDeployment;
  readonly auditEvent: Record<string, unknown>;
}

export interface GroupTemplateDeployProvider {
  planDeploy(
    template: GroupTemplate,
    targets: readonly string[],
    variables?: Record<string, string>,
  ): Promise<readonly TargetDeployPlan[]>;

  executeDeploy(
    template: GroupTemplate,
    targets: readonly string[],
    variables?: Record<string, string>,
    createdBy?: string,
  ): Promise<readonly DeployTemplateResult[]>;
}

export interface GroupTemplateDeployCaller extends Caller {
  readonly userId?: string;
}

export type GroupTemplateDeployAuthorizer = (
  caller: GroupTemplateDeployCaller,
  permission: string,
) => void | Promise<void>;

export interface GroupTemplateDeployRoutesOptions {
  readonly repository: GroupTemplateRepository;
  readonly provider: GroupTemplateDeployProvider;
  readonly resolveCaller: (ctx: RequestContext) => GroupTemplateDeployCaller | undefined;
  readonly authorize?: GroupTemplateDeployAuthorizer;
}

function unauthenticatedError(): AppError {
  return new AppError(GROUPS_DEPLOY_UNAUTHENTICATED, "authentication required", 401);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => GroupTemplateDeployCaller | undefined,
  ctx: RequestContext,
): GroupTemplateDeployCaller {
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

async function authorizeDeploy(
  options: GroupTemplateDeployRoutesOptions,
  caller: GroupTemplateDeployCaller,
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

export function createGroupTemplatesDeployRoute(options: GroupTemplateDeployRoutesOptions): Route {
  return {
    method: "POST",
    path: GROUP_TEMPLATE_DEPLOY_PATH,
    handler: async (ctx: RequestContext): Promise<RouteResponse> => {
      const caller = requireCaller(options.resolveCaller, ctx);
      await authorizeDeploy(options, caller);

      const templateId = requireIdParam(ctx);
      const template = await options.repository.get(templateId);
      if (!template) {
        throw new AppError(ErrorCodes.notFound, `Group template '${templateId}' not found`, 404);
      }

      const body = (ctx.body ?? {}) as Record<string, unknown>;
      const targets = Array.isArray(body.targets)
        ? (body.targets as string[]).map((t) => String(t).trim()).filter(Boolean)
        : typeof body.tenantId === "string" && body.tenantId.trim()
        ? [body.tenantId.trim()]
        : [];

      if (targets.length === 0) {
        throw new AppError(
          ErrorCodes.validationFailed,
          "At least one target tenant must be specified in 'targets' or 'tenantId'",
          400,
          [{ field: "targets", reason: "required" }],
        );
      }

      // Check caller scope for all target tenants
      for (const target of targets) {
        requireTenantInScope(caller, target);
      }

      const variables = typeof body.variables === "object" && body.variables !== null
        ? (body.variables as Record<string, string>)
        : {};

      const isPreview = Boolean(body.preview || ctx.query.get("preview") === "true");

      if (isPreview) {
        const plans = await options.provider.planDeploy(template, targets, variables);
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: {
            templateId,
            preview: true,
            plans,
            allValid: plans.every((p) => p.valid),
          },
        };
      }

      const createdBy = caller.userId ?? "system";
      const results = await options.provider.executeDeploy(template, targets, variables, createdBy);

      const allSucceeded = results.every((r) => r.deployment.state === "succeeded");
      const anyPartial = results.some((r) => r.deployment.state === "partial");

      return {
        status: allSucceeded ? 200 : anyPartial ? 207 : 422,
        headers: { "content-type": "application/json" },
        body: {
          templateId,
          success: allSucceeded || anyPartial,
          deployments: results.map((r) => r.deployment),
          auditEvents: results.map((r) => r.auditEvent),
        },
      };
    },
  };
}
