// Intune template deploy API (EPIC-016 SPEC.md §3.2, §4.2, §6, §7, §8; T-0306).
// Exposes POST /v1/intune-templates/:id/deploy behind the gated-write seam.
//
// Accepts the §3.2 deploy-drawer options (assignment mode, policy state, overwrite,
// create-groups) for one or many target tenants. `preview` returns a per-target plan
// and the target count; apply runs each target through the Deploy-IntuneTemplate
// worker, reporting per-target results so partial failures are visible. Applying to
// more than one tenant requires `confirmTargetCount` to echo the count the caller was
// shown (§8). Every policy write's audit event is recorded and returned.
import { AppError, ErrorCodes } from "../errors.js";
import { RbacErrorCodes, requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { IntuneTemplate, IntuneTemplateRepository } from "../repository/intune-templates.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";
import {
  ErrorCodesTemplateNotFound,
  INTUNE_TEMPLATE_ADMIN_SCOPE,
  INTUNE_TEMPLATE_PERMISSIONS,
  type IntuneTemplateRequestContext,
} from "./intune-templates.js";

export const INTUNE_TEMPLATE_DEPLOY_PATH = "/v1/intune-templates/:id/deploy";

export const INTUNE_WRITE_PERMISSION = "intune.write";
export const REMEDIATION_APPLY_PERMISSION = "remediation.apply";
export const INTUNE_DEPLOY_UNAUTHENTICATED = "request.unauthenticated";

export const INTUNE_ASSIGNMENT_MODES = [
  "template",
  "none",
  "allDevices",
  "allUsers",
  "allUsersAndDevices",
  "groups",
] as const;
export type IntuneAssignmentMode = (typeof INTUNE_ASSIGNMENT_MODES)[number];

/** "disabled" deploys the policy without assignments (Intune has no per-policy off switch). */
export const INTUNE_POLICY_STATES = ["enabled", "disabled"] as const;
export type IntunePolicyState = (typeof INTUNE_POLICY_STATES)[number];

export interface IntuneDeployOptions {
  readonly policyName?: string;
  readonly assignmentMode: IntuneAssignmentMode;
  readonly groups: readonly string[];
  readonly policyState: IntunePolicyState;
  readonly overwrite: boolean;
  readonly createGroups: boolean;
}

export interface IntuneTargetPlan {
  readonly tenantId: string;
  readonly policyName: string;
  readonly action: "create" | "update";
  readonly conflict: boolean;
  readonly conflictMessage?: string | null;
  readonly groupsToCreate: readonly string[];
  readonly assignments: readonly string[];
  readonly issues: readonly string[];
  readonly diff: readonly string[];
  readonly valid: boolean;
}

export interface IntuneDeployStep {
  readonly step: string;
  readonly target?: string;
  readonly status: "succeeded" | "failed";
  readonly error?: string;
}

export interface IntuneTargetResult {
  readonly tenantId: string;
  readonly state: "succeeded" | "partial" | "failed";
  readonly policyId?: string | null;
  readonly steps: readonly IntuneDeployStep[];
  readonly error?: string | null;
  readonly auditEvent?: Record<string, unknown> | null;
}

/** Runs the Deploy-IntuneTemplate worker for one target tenant. */
export interface IntuneTemplateDeployProvider {
  planTarget(
    template: IntuneTemplate,
    tenantId: string,
    options: IntuneDeployOptions,
  ): Promise<IntuneTargetPlan>;

  deployTarget(
    template: IntuneTemplate,
    tenantId: string,
    options: IntuneDeployOptions,
    createdBy: string,
  ): Promise<IntuneTargetResult>;
}

export interface IntuneDeployCaller extends Caller {
  readonly userId?: string;
}

/** Same seam as the T-0305 template routes: body and resolved permissions ride on the context. */
export type IntuneDeployRequestContext = IntuneTemplateRequestContext;

export type IntuneDeployAuthorizer = (ctx: IntuneDeployRequestContext, permission: string) => boolean;

export interface IntuneTemplateDeployRouteOptions {
  readonly repository: IntuneTemplateRepository;
  readonly provider: IntuneTemplateDeployProvider;
  /** Resolves the caller's tenant scope; undefined means unauthenticated. */
  readonly resolveCaller: (ctx: RequestContext) => IntuneDeployCaller | undefined;
  readonly authorize?: IntuneDeployAuthorizer;
  readonly recordAudit?: (event: Record<string, unknown>) => Promise<void>;
}

function validationError(message: string, field: string, reason = "invalid"): AppError {
  return new AppError(ErrorCodes.validationFailed, message, 400, [{ field, reason }]);
}

function requireIdParam(ctx: RequestContext): string {
  const value = ctx.params["id"];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError("template id is required", "id", "required");
  }
  return value.trim();
}

// Default authorizer mirrors the T-0305 template routes: grant while the auth seam
// has not resolved permissions, otherwise require the permission (or an admin scope).
function defaultAuthorize(ctx: IntuneDeployRequestContext, permission: string): boolean {
  const granted = ctx.permissions;
  if (granted === undefined) return true;
  return granted.includes(permission) || granted.includes(INTUNE_TEMPLATE_ADMIN_SCOPE) || granted.includes("*");
}

// Deploy needs template rights (intune.templates) plus write semantics
// (intune.write or remediation.apply), per SPEC §7.
function authorizeDeploy(ctx: IntuneDeployRequestContext, authorize: IntuneDeployAuthorizer): void {
  if (!authorize(ctx, INTUNE_TEMPLATE_PERMISSIONS.templates)) {
    throw new AppError(
      RbacErrorCodes.forbidden,
      `forbidden: deploy requires ${INTUNE_TEMPLATE_PERMISSIONS.templates}`,
      403,
    );
  }
  if (!authorize(ctx, INTUNE_WRITE_PERMISSION) && !authorize(ctx, REMEDIATION_APPLY_PERMISSION)) {
    throw new AppError(
      RbacErrorCodes.forbidden,
      `forbidden: deploy requires ${INTUNE_WRITE_PERMISSION} or ${REMEDIATION_APPLY_PERMISSION}`,
      403,
    );
  }
}

function asBody(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw validationError("Request body must be a JSON object", "body");
  }
  return value as Record<string, unknown>;
}

function parseTargets(body: Record<string, unknown>): string[] {
  const raw = Array.isArray(body.targets)
    ? body.targets
    : typeof body.tenantId === "string"
      ? [body.tenantId]
      : [];
  const targets = [...new Set(raw.map((t) => String(t).trim()).filter(Boolean))];
  if (targets.length === 0) {
    throw validationError("at least one target tenant is required in 'targets'", "targets", "required");
  }
  return targets;
}

function parseOptions(body: Record<string, unknown>): IntuneDeployOptions {
  const assignmentMode = body.assignmentMode ?? "template";
  if (!(INTUNE_ASSIGNMENT_MODES as readonly unknown[]).includes(assignmentMode)) {
    throw validationError(
      `assignmentMode must be one of: ${INTUNE_ASSIGNMENT_MODES.join(", ")}`,
      "assignmentMode",
    );
  }
  const policyState = body.policyState ?? "enabled";
  if (!(INTUNE_POLICY_STATES as readonly unknown[]).includes(policyState)) {
    throw validationError(
      `policyState must be one of: ${INTUNE_POLICY_STATES.join(", ")}`,
      "policyState",
    );
  }
  const groups = Array.isArray(body.groups)
    ? body.groups.map((g) => String(g).trim()).filter(Boolean)
    : [];
  if (assignmentMode === "groups" && groups.length === 0) {
    throw validationError("assignmentMode 'groups' requires at least one group", "groups", "required");
  }
  const policyName = typeof body.policyName === "string" ? body.policyName.trim() : "";
  return {
    ...(policyName ? { policyName } : {}),
    assignmentMode: assignmentMode as IntuneAssignmentMode,
    groups,
    policyState: policyState as IntunePolicyState,
    overwrite: body.overwrite === true,
    createGroups: body.createGroups === true,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}


export function createIntuneTemplateDeployRoute(options: IntuneTemplateDeployRouteOptions): Route {
  return {
    method: "POST",
    path: INTUNE_TEMPLATE_DEPLOY_PATH,
    handler: async (ctx: RequestContext): Promise<RouteResponse> => {
      const context = ctx as IntuneDeployRequestContext;
      const caller = options.resolveCaller(ctx);
      if (caller === undefined) {
        throw new AppError(INTUNE_DEPLOY_UNAUTHENTICATED, "authentication required", 401);
      }
      authorizeDeploy(context, options.authorize ?? defaultAuthorize);

      const templateId = requireIdParam(ctx);
      const template = await options.repository.get(templateId);
      if (!template) {
        throw new AppError(ErrorCodesTemplateNotFound, `Intune template '${templateId}' not found`, 404);
      }

      const body = asBody(context.body);
      const targets = parseTargets(body);
      for (const tenantId of targets) {
        requireTenantInScope(caller, tenantId);
      }
      const deployOptions = parseOptions(body);
      const isPreview = body.preview === true || ctx.query.get("preview") === "true";

      if (isPreview) {
        const plans = await Promise.all(
          targets.map(async (tenantId): Promise<IntuneTargetPlan> => {
            try {
              return await options.provider.planTarget(template, tenantId, deployOptions);
            } catch (err: unknown) {
              return {
                tenantId,
                policyName: deployOptions.policyName ?? template.name,
                action: "create",
                conflict: false,
                groupsToCreate: [],
                assignments: [],
                issues: [errorMessage(err)],
                diff: [],
                valid: false,
              };
            }
          }),
        );
        return {
          status: 200,
          body: {
            templateId,
            preview: true,
            targetCount: targets.length,
            plans,
            allValid: plans.every((p) => p.valid),
          },
        };
      }

      if (targets.length > 1 && body.confirmTargetCount !== targets.length) {
        throw validationError(
          `deploying to ${targets.length} tenants requires confirmTargetCount: ${targets.length}`,
          "confirmTargetCount",
          "required",
        );
      }

      // Sequential per target: one tenant's failure never stops the others.
      const createdBy = caller.userId ?? "system";
      const results: IntuneTargetResult[] = [];
      for (const tenantId of targets) {
        let result: IntuneTargetResult;
        try {
          result = await options.provider.deployTarget(template, tenantId, deployOptions, createdBy);
        } catch (err: unknown) {
          result = { tenantId, state: "failed", steps: [], error: errorMessage(err), auditEvent: null };
        }
        if (result.auditEvent && options.recordAudit) {
          await options.recordAudit(result.auditEvent);
        }
        results.push(result);
      }

      const summary = {
        succeeded: results.filter((r) => r.state === "succeeded").length,
        partial: results.filter((r) => r.state === "partial").length,
        failed: results.filter((r) => r.state === "failed").length,
      };
      const status =
        summary.succeeded === results.length ? 200 : summary.failed === results.length ? 422 : 207;

      return {
        status,
        body: {
          templateId,
          targetCount: targets.length,
          success: summary.failed < results.length,
          summary,
          results,
          auditEvents: results.flatMap((r) => (r.auditEvent ? [r.auditEvent] : [])),
        },
      };
    },
  };
}
