// CA policy CRUD API (EPIC-015 SPEC.md §4.1, §6, §7, §8, §11.1, §11.2; T-0282).
// Exposes POST /v1/tenants/:tenantId/ca/policies and PATCH/DELETE /v1/tenants/:tenantId/ca/policies/:policyId.
// Routes through plan preview (JSON diff), explicit confirmation, before/after capture, and audit.
// Validates guardrails: hard-block on 'All users' + 'Block' without break-glass exclusion;
// warns on 'All users' with no admin exclusion.
import {
  validateCaPolicy,
  type CaPolicyPayload,
  type ValidationIssue,
} from "../domain/ca-policy-validation.js";
import { AppError, ErrorCodes } from "../errors.js";
import { requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const CA_POLICIES_BASE_PATH = "/v1/tenants/:tenantId/ca/policies";
export const CA_POLICIES_ITEM_PATH = "/v1/tenants/:tenantId/ca/policies/:policyId";

export const CA_WRITE_PERMISSION = "Tenant.ConditionalAccess.ReadWrite";
export const REMEDIATION_APPLY_PERMISSION = "Remediation.Apply";
export const CA_DEPLOY_PERMISSION = "Tenant.ConditionalAccess.ReadWrite";
export const CA_UNAUTHENTICATED = "request.unauthenticated";

export interface CaPlan {
  readonly action: "create" | "edit" | "delete";
  readonly policyId?: string;
  readonly targetName: string;
  readonly before?: Record<string, unknown> | null;
  readonly after?: Record<string, unknown> | null;
  readonly diff: readonly string[];
  readonly valid: boolean;
  readonly warnings?: readonly ValidationIssue[];
  readonly dryRun: boolean;
  readonly requiresConfirmation: boolean;
}

export interface CaAuditEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly action: string;
  readonly targetId: string;
  readonly targetName: string;
  readonly timestamp: string;
  readonly before?: Record<string, unknown> | null;
  readonly after?: Record<string, unknown> | null;
}

export interface CaCrudResult {
  readonly success: boolean;
  readonly plan: CaPlan;
  readonly result?: Record<string, unknown>;
  readonly auditEvent?: CaAuditEvent;
}

export interface CaPolicyCreateInput extends CaPolicyPayload {
  readonly preview?: boolean;
}

export interface CaPolicyEditInput extends CaPolicyPayload {
  readonly preview?: boolean;
}

export interface CaPolicyCrudProvider {
  createPolicy(
    tenantId: string,
    input: CaPolicyCreateInput,
    preview: boolean,
  ): Promise<CaCrudResult | CaPlan>;

  editPolicy(
    tenantId: string,
    policyId: string,
    input: CaPolicyEditInput,
    preview: boolean,
  ): Promise<CaCrudResult | CaPlan>;

  deletePolicy(
    tenantId: string,
    policyId: string,
    confirmName: string,
    preview: boolean,
  ): Promise<CaCrudResult | CaPlan>;
}

export interface CaCrudCaller extends Caller {
  readonly userId?: string;
}

export type CaCrudAuthorizer = (
  caller: CaCrudCaller,
  permission: string,
) => void | Promise<void>;

export interface CaPoliciesCrudRoutesOptions {
  readonly provider: CaPolicyCrudProvider;
  readonly resolveCaller: (ctx: RequestContext) => CaCrudCaller | undefined;
  readonly authorize?: CaCrudAuthorizer;
}

function unauthenticatedError(): AppError {
  return new AppError(CA_UNAUTHENTICATED, "authentication required", 401);
}

function validationError(message: string, field: string): AppError {
  return new AppError(ErrorCodes.validationFailed, message, 400, [
    { field, reason: "invalid" },
  ]);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => CaCrudCaller | undefined,
  ctx: RequestContext,
): CaCrudCaller {
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

function requirePolicyIdParam(ctx: RequestContext): string {
  const value = ctx.params["policyId"];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "policyId is required", 400, [
      { field: "policyId", reason: "required" },
    ]);
  }
  return value.trim();
}

async function authorizeWrite(
  options: CaPoliciesCrudRoutesOptions,
  caller: CaCrudCaller,
): Promise<void> {
  if (options.authorize) {
    await options.authorize(caller, CA_WRITE_PERMISSION);
    return;
  }
  const permissions = caller.permissions ?? [];
  const allowed =
    permissions.includes(CA_WRITE_PERMISSION) ||
    permissions.includes(REMEDIATION_APPLY_PERMISSION) ||
    permissions.includes(CA_DEPLOY_PERMISSION) ||
    permissions.includes("*");
  if (!allowed) {
    throw new AppError(
      ErrorCodes.forbidden,
      `forbidden: write requires ${CA_WRITE_PERMISSION} or ${REMEDIATION_APPLY_PERMISSION}`,
      403,
    );
  }
}

export function createCaPoliciesCrudRoutes(options: CaPoliciesCrudRoutesOptions): Route[] {
  return [
    // POST /v1/tenants/:tenantId/ca/policies - Create policy or preview plan
    {
      method: "POST",
      path: CA_POLICIES_BASE_PATH,
      handler: async (ctx: RequestContext): Promise<RouteResponse> => {
        const caller = requireCaller(options.resolveCaller, ctx);
        const tenantId = requireTenantParam(ctx);
        requireTenantInScope(caller, tenantId);
        await authorizeWrite(options, caller);

        const body = (ctx.body ?? {}) as Record<string, unknown>;
        const isPreview = Boolean(body.preview || ctx.query.get("preview") === "true");

        const policyPayload: CaPolicyPayload = {
          displayName: typeof body.displayName === "string" ? body.displayName.trim() : "",
          state: typeof body.state === "string" ? body.state : undefined,
          conditions: body.conditions as any,
          grantControls: body.grantControls as any,
          sessionControls: body.sessionControls as any,
        };

        const validation = validateCaPolicy(policyPayload, { isCreate: true });
        if (!validation.valid) {
          const firstErr = validation.errors[0]!;
          throw new AppError(ErrorCodes.validationFailed, firstErr.message, 400, [
            { field: firstErr.field ?? "policy", reason: firstErr.code },
          ]);
        }

        const input: CaPolicyCreateInput = {
          ...policyPayload,
          state: validation.resolvedState,
          preview: isPreview,
        };

        const result = await options.provider.createPolicy(tenantId, input, isPreview);
        return {
          status: isPreview ? 200 : 201,
          headers: { "content-type": "application/json" },
          body: result,
        };
      },
    },

    // PATCH /v1/tenants/:tenantId/ca/policies/:policyId - Edit policy or preview diff
    {
      method: "PATCH",
      path: CA_POLICIES_ITEM_PATH,
      handler: async (ctx: RequestContext): Promise<RouteResponse> => {
        const caller = requireCaller(options.resolveCaller, ctx);
        const tenantId = requireTenantParam(ctx);
        const policyId = requirePolicyIdParam(ctx);
        requireTenantInScope(caller, tenantId);
        await authorizeWrite(options, caller);

        const body = (ctx.body ?? {}) as Record<string, unknown>;
        const isPreview = Boolean(body.preview || ctx.query.get("preview") === "true");

        const policyPayload: CaPolicyPayload = {
          displayName: typeof body.displayName === "string" ? body.displayName.trim() : undefined,
          state: typeof body.state === "string" ? body.state : undefined,
          conditions: body.conditions as any,
          grantControls: body.grantControls as any,
          sessionControls: body.sessionControls as any,
        };

        const validation = validateCaPolicy(policyPayload, { isCreate: false });
        if (!validation.valid) {
          const firstErr = validation.errors[0]!;
          throw new AppError(ErrorCodes.validationFailed, firstErr.message, 400, [
            { field: firstErr.field ?? "policy", reason: firstErr.code },
          ]);
        }

        const input: CaPolicyEditInput = {
          ...policyPayload,
          preview: isPreview,
        };

        const result = await options.provider.editPolicy(tenantId, policyId, input, isPreview);
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: result,
        };
      },
    },

    // DELETE /v1/tenants/:tenantId/ca/policies/:policyId - Delete policy with confirmation
    {
      method: "DELETE",
      path: CA_POLICIES_ITEM_PATH,
      handler: async (ctx: RequestContext): Promise<RouteResponse> => {
        const caller = requireCaller(options.resolveCaller, ctx);
        const tenantId = requireTenantParam(ctx);
        const policyId = requirePolicyIdParam(ctx);
        requireTenantInScope(caller, tenantId);
        await authorizeWrite(options, caller);

        const body = (ctx.body ?? {}) as Record<string, unknown>;
        const confirmName = typeof body.confirmName === "string"
          ? body.confirmName.trim()
          : ctx.query.get("confirmName")?.trim() ?? "";

        const isPreview = Boolean(body.preview || ctx.query.get("preview") === "true");

        const result = await options.provider.deletePolicy(tenantId, policyId, confirmName, isPreview);
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: result,
        };
      },
    },
  ];
}
