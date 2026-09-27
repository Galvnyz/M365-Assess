// Intune policy CRUD API (EPIC-016 SPEC.md §4.1, §6, §7, §8; T-0302).
//
// Exposes:
//   POST   /v1/tenants/:tenantId/intune/:kind          — create (or preview plan)
//   PATCH  /v1/tenants/:tenantId/intune/:kind/:policyId — edit  (or preview diff)
//   DELETE /v1/tenants/:tenantId/intune/:kind/:policyId — delete (confirmation required for assigned)
//
// Routes through the T-0108 gated-write seam.
// Validates kind against the T-0301 registry.
// create/edit return a plan with settings diff + assignment changes.
// delete requires confirmName matching the policy name for assigned policies.
// Every write is audited.
import { AppError, ErrorCodes } from "../errors.js";
import { requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";
import { isKnownKind, supportedEntriesForKind } from "../domain/intune-policy-types.js";

export const INTUNE_CRUD_BASE_PATH = "/v1/tenants/:tenantId/intune/:kind";
export const INTUNE_CRUD_ITEM_PATH = "/v1/tenants/:tenantId/intune/:kind/:policyId";

export const INTUNE_WRITE_PERMISSION = "Endpoint.Intune.ReadWrite";
export const INTUNE_READ_PERMISSION = "Endpoint.Intune.Read";
export const REMEDIATION_APPLY_PERMISSION = "Remediation.Apply";
export const INTUNE_UNAUTHENTICATED = "request.unauthenticated";

export interface IntunePolicyAssignment {
  readonly id: string;
  readonly target: string;
  readonly targetType: string;
}

export interface IntunePlan {
  readonly action: "create" | "edit" | "delete";
  readonly kind: string;
  readonly policyId?: string;
  readonly targetName: string;
  readonly before?: Record<string, unknown> | null;
  readonly after?: Record<string, unknown> | null;
  readonly beforeAssignments?: readonly IntunePolicyAssignment[];
  readonly afterAssignments?: readonly IntunePolicyAssignment[];
  readonly diff: readonly string[];
  readonly valid: boolean;
  readonly dryRun: boolean;
  readonly requiresConfirmation: boolean;
}

export interface IntuneAuditEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly action: string;
  readonly targetId: string;
  readonly targetName: string;
  readonly kind: string;
  readonly timestamp: string;
  readonly before?: Record<string, unknown> | null;
  readonly after?: Record<string, unknown> | null;
}

export interface IntuneCrudResult {
  readonly success: boolean;
  readonly plan: IntunePlan;
  readonly result?: Record<string, unknown>;
  readonly auditEvent?: IntuneAuditEvent;
}

export interface IntunePolicyCreateInput {
  readonly displayName: string;
  readonly platform: string;
  /** Structured settings object (common types). */
  readonly settings?: Record<string, unknown>;
  /** Raw policy JSON (advanced types). */
  readonly policyJson?: string;
  readonly assignments?: readonly IntunePolicyAssignment[];
  readonly preview: boolean;
}

export interface IntunePolicyEditInput {
  readonly displayName?: string;
  readonly settings?: Record<string, unknown>;
  readonly policyJson?: string;
  readonly assignments?: readonly IntunePolicyAssignment[];
  readonly preview: boolean;
}

export interface IntuneCrudProvider {
  createPolicy(
    tenantId: string,
    kind: string,
    input: IntunePolicyCreateInput,
    preview: boolean,
  ): Promise<IntuneCrudResult | IntunePlan>;

  editPolicy(
    tenantId: string,
    kind: string,
    policyId: string,
    input: IntunePolicyEditInput,
    preview: boolean,
  ): Promise<IntuneCrudResult | IntunePlan>;

  deletePolicy(
    tenantId: string,
    kind: string,
    policyId: string,
    confirmName: string,
    preview: boolean,
  ): Promise<IntuneCrudResult | IntunePlan>;
}

export interface IntuneCrudCaller extends Caller {
  readonly userId?: string;
  readonly permissions?: readonly string[];
}

export type IntuneCrudAuthorizer = (
  caller: IntuneCrudCaller,
  permission: string,
) => void | Promise<void>;

export interface IntuneCrudRoutesOptions {
  readonly provider: IntuneCrudProvider;
  readonly resolveCaller: (ctx: RequestContext) => IntuneCrudCaller | undefined;
  readonly authorize?: IntuneCrudAuthorizer;
}

function unauthenticatedError(): AppError {
  return new AppError(INTUNE_UNAUTHENTICATED, "authentication required", 401);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => IntuneCrudCaller | undefined,
  ctx: RequestContext,
): IntuneCrudCaller {
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

function requireKindParam(ctx: RequestContext): string {
  const value = ctx.params["kind"];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "kind is required", 400, [
      { field: "kind", reason: "required" },
    ]);
  }
  return value.trim().toLowerCase();
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

function assertSupportedKind(kind: string): void {
  if (!isKnownKind(kind)) {
    throw new AppError(
      ErrorCodes.validationFailed,
      `unknown Intune policy kind '${kind}'; supported: configuration, compliance`,
      400,
      [{ field: "kind", reason: "unknown" }],
    );
  }
  const supported = supportedEntriesForKind(kind);
  if (supported === undefined || supported.length === 0) {
    throw new AppError(
      "intune.kind.unsupported",
      `Intune policy kind '${kind}' is not yet supported for write operations`,
      501,
    );
  }
}

async function authorizeWrite(
  options: IntuneCrudRoutesOptions,
  caller: IntuneCrudCaller,
): Promise<void> {
  if (options.authorize) {
    await options.authorize(caller, INTUNE_WRITE_PERMISSION);
    return;
  }
  const permissions = caller.permissions ?? [];
  const allowed =
    permissions.includes(INTUNE_WRITE_PERMISSION) ||
    permissions.includes(REMEDIATION_APPLY_PERMISSION) ||
    permissions.includes("*");
  if (!allowed) {
    throw new AppError(
      ErrorCodes.forbidden,
      `forbidden: missing ${INTUNE_WRITE_PERMISSION} or ${REMEDIATION_APPLY_PERMISSION}`,
      403,
    );
  }
}

export function createIntuneCrudRoutes(options: IntuneCrudRoutesOptions): Route[] {
  return [
    // POST /v1/tenants/:tenantId/intune/:kind — create policy or preview plan
    {
      method: "POST",
      path: INTUNE_CRUD_BASE_PATH,
      handler: async (ctx: RequestContext): Promise<RouteResponse> => {
        const caller = requireCaller(options.resolveCaller, ctx);
        const tenantId = requireTenantParam(ctx);
        const kind = requireKindParam(ctx);

        requireTenantInScope(caller, tenantId);
        await authorizeWrite(options, caller);
        assertSupportedKind(kind);

        const body = (ctx.body ?? {}) as Record<string, unknown>;
        const isPreview = Boolean(body.preview || ctx.query.get("preview") === "true");

        const displayName =
          typeof body.displayName === "string" ? body.displayName.trim() : "";
        if (!isPreview && displayName.length === 0) {
          throw new AppError(
            ErrorCodes.validationFailed,
            "displayName is required for create",
            400,
            [{ field: "displayName", reason: "required" }],
          );
        }

        const input: IntunePolicyCreateInput = {
          displayName,
          platform: typeof body.platform === "string" ? body.platform : "windows",
          settings:
            body.settings !== undefined
              ? (body.settings as Record<string, unknown>)
              : undefined,
          policyJson:
            typeof body.policyJson === "string" ? body.policyJson : undefined,
          assignments:
            Array.isArray(body.assignments)
              ? (body.assignments as IntunePolicyAssignment[])
              : undefined,
          preview: isPreview,
        };

        const result = await options.provider.createPolicy(tenantId, kind, input, isPreview);
        return {
          status: isPreview ? 200 : 201,
          body: result,
        };
      },
    },

    // PATCH /v1/tenants/:tenantId/intune/:kind/:policyId — edit policy or preview diff
    {
      method: "PATCH",
      path: INTUNE_CRUD_ITEM_PATH,
      handler: async (ctx: RequestContext): Promise<RouteResponse> => {
        const caller = requireCaller(options.resolveCaller, ctx);
        const tenantId = requireTenantParam(ctx);
        const kind = requireKindParam(ctx);
        const policyId = requirePolicyIdParam(ctx);

        requireTenantInScope(caller, tenantId);
        await authorizeWrite(options, caller);
        assertSupportedKind(kind);

        const body = (ctx.body ?? {}) as Record<string, unknown>;
        const isPreview = Boolean(body.preview || ctx.query.get("preview") === "true");

        const input: IntunePolicyEditInput = {
          displayName:
            typeof body.displayName === "string" ? body.displayName.trim() : undefined,
          settings:
            body.settings !== undefined
              ? (body.settings as Record<string, unknown>)
              : undefined,
          policyJson:
            typeof body.policyJson === "string" ? body.policyJson : undefined,
          assignments:
            Array.isArray(body.assignments)
              ? (body.assignments as IntunePolicyAssignment[])
              : undefined,
          preview: isPreview,
        };

        const result = await options.provider.editPolicy(
          tenantId,
          kind,
          policyId,
          input,
          isPreview,
        );
        return {
          status: 200,
          body: result,
        };
      },
    },

    // DELETE /v1/tenants/:tenantId/intune/:kind/:policyId — delete with confirmation
    {
      method: "DELETE",
      path: INTUNE_CRUD_ITEM_PATH,
      handler: async (ctx: RequestContext): Promise<RouteResponse> => {
        const caller = requireCaller(options.resolveCaller, ctx);
        const tenantId = requireTenantParam(ctx);
        const kind = requireKindParam(ctx);
        const policyId = requirePolicyIdParam(ctx);

        requireTenantInScope(caller, tenantId);
        await authorizeWrite(options, caller);
        assertSupportedKind(kind);

        const body = (ctx.body ?? {}) as Record<string, unknown>;
        const confirmName =
          typeof body.confirmName === "string"
            ? body.confirmName.trim()
            : (ctx.query.get("confirmName")?.trim() ?? "");
        const isPreview = Boolean(body.preview || ctx.query.get("preview") === "true");

        const result = await options.provider.deletePolicy(
          tenantId,
          kind,
          policyId,
          confirmName,
          isPreview,
        );
        return {
          status: 200,
          body: result,
        };
      },
    },
  ];
}
