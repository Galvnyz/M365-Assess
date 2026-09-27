// Group GAL and delivery management API (EPIC-014 SPEC.md §3.4, §4.4, §6; T-0269).
// Exposes POST /v1/tenants/:tenantId/groups/:groupId/gal and .../delivery behind gated-write seam.
// Isolated per-tenant child process runs Exchange Online session.
import { AppError, ErrorCodes } from "../errors.js";
import { requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const GROUP_GAL_PATH = "/v1/tenants/:tenantId/groups/:groupId/gal";
export const GROUP_DELIVERY_PATH = "/v1/tenants/:tenantId/groups/:groupId/delivery";

export const GROUPS_WRITE_PERMISSION = "Identity.Group.ReadWrite";
export const REMEDIATION_APPLY_PERMISSION = "Remediation.Apply";
export const GROUPS_GAL_UNAUTHENTICATED = "request.unauthenticated";

export interface GroupGalInput {
  readonly hiddenFromAddressListsEnabled: boolean;
  readonly preview?: boolean;
}

export interface GroupDeliveryInput {
  readonly requireSenderAuthenticationEnabled: boolean;
  readonly grantSendOnBehalfTo?: readonly string[];
  readonly preview?: boolean;
}

export interface GroupGalDeliveryPlan {
  readonly tenantId: string;
  readonly groupId: string;
  readonly target: "gal" | "delivery";
  readonly before: Record<string, unknown>;
  readonly after: Record<string, unknown>;
  readonly diff: readonly string[];
  readonly dryRun: boolean;
}

export interface GroupGalDeliveryResult {
  readonly success: boolean;
  readonly plan: GroupGalDeliveryPlan;
  readonly before: Record<string, unknown>;
  readonly after: Record<string, unknown>;
  readonly auditEvent?: Record<string, unknown>;
}

export interface GroupGalDeliveryProvider {
  setGal(
    tenantId: string,
    groupId: string,
    input: GroupGalInput,
    preview: boolean,
  ): Promise<GroupGalDeliveryPlan | GroupGalDeliveryResult>;

  setDelivery(
    tenantId: string,
    groupId: string,
    input: GroupDeliveryInput,
    preview: boolean,
  ): Promise<GroupGalDeliveryPlan | GroupGalDeliveryResult>;
}

export interface GroupGalCaller extends Caller {
  readonly userId?: string;
}

export type GroupGalAuthorizer = (
  caller: GroupGalCaller,
  permission: string,
) => void | Promise<void>;

export interface GroupGalRoutesOptions {
  readonly provider: GroupGalDeliveryProvider;
  readonly resolveCaller: (ctx: RequestContext) => GroupGalCaller | undefined;
  readonly authorize?: GroupGalAuthorizer;
}

function unauthenticatedError(): AppError {
  return new AppError(GROUPS_GAL_UNAUTHENTICATED, "authentication required", 401);
}

function validationError(message: string, field: string): AppError {
  return new AppError(ErrorCodes.validationFailed, message, 400, [
    { field, reason: "invalid" },
  ]);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => GroupGalCaller | undefined,
  ctx: RequestContext,
): GroupGalCaller {
  const caller = resolveCaller(ctx);
  if (caller === undefined) {
    throw unauthenticatedError();
  }
  return caller;
}

function requireParam(ctx: RequestContext, name: string): string {
  const value = ctx.params[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, `${name} is required`, 400, [
      { field: name, reason: "required" },
    ]);
  }
  return value.trim();
}

async function authorizeWrite(
  options: GroupGalRoutesOptions,
  caller: GroupGalCaller,
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

export function createGroupGalDeliveryRoutes(options: GroupGalRoutesOptions): Route[] {
  return [
    // POST /v1/tenants/:tenantId/groups/:groupId/gal
    {
      method: "POST",
      path: GROUP_GAL_PATH,
      handler: async (ctx: RequestContext): Promise<RouteResponse> => {
        const caller = requireCaller(options.resolveCaller, ctx);
        const tenantId = requireParam(ctx, "tenantId");
        const groupId = requireParam(ctx, "groupId");

        requireTenantInScope(caller, tenantId);
        await authorizeWrite(options, caller);

        const body = (ctx.body ?? {}) as Record<string, unknown>;
        if (body.hiddenFromAddressListsEnabled === undefined) {
          throw validationError(
            "hiddenFromAddressListsEnabled is required",
            "hiddenFromAddressListsEnabled",
          );
        }

        const isPreview = Boolean(body.preview || ctx.query.get("preview") === "true");
        const input: GroupGalInput = {
          hiddenFromAddressListsEnabled: Boolean(body.hiddenFromAddressListsEnabled),
          preview: isPreview,
        };

        const result = await options.provider.setGal(tenantId, groupId, input, isPreview);
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: result,
        };
      },
    },

    // POST /v1/tenants/:tenantId/groups/:groupId/delivery
    {
      method: "POST",
      path: GROUP_DELIVERY_PATH,
      handler: async (ctx: RequestContext): Promise<RouteResponse> => {
        const caller = requireCaller(options.resolveCaller, ctx);
        const tenantId = requireParam(ctx, "tenantId");
        const groupId = requireParam(ctx, "groupId");

        requireTenantInScope(caller, tenantId);
        await authorizeWrite(options, caller);

        const body = (ctx.body ?? {}) as Record<string, unknown>;
        if (body.requireSenderAuthenticationEnabled === undefined) {
          throw validationError(
            "requireSenderAuthenticationEnabled is required",
            "requireSenderAuthenticationEnabled",
          );
        }

        let sendOnBehalf: string[] = [];
        if (body.grantSendOnBehalfTo !== undefined) {
          if (!Array.isArray(body.grantSendOnBehalfTo)) {
            throw validationError("grantSendOnBehalfTo must be an array", "grantSendOnBehalfTo");
          }
          sendOnBehalf = (body.grantSendOnBehalfTo as string[]).map((s) => String(s).trim());
          if (sendOnBehalf.some((s) => s.length === 0)) {
            throw validationError(
              "grantSendOnBehalfTo cannot contain empty entries",
              "grantSendOnBehalfTo",
            );
          }
        }

        const isPreview = Boolean(body.preview || ctx.query.get("preview") === "true");
        const input: GroupDeliveryInput = {
          requireSenderAuthenticationEnabled: Boolean(body.requireSenderAuthenticationEnabled),
          grantSendOnBehalfTo: sendOnBehalf,
          preview: isPreview,
        };

        const result = await options.provider.setDelivery(tenantId, groupId, input, isPreview);
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: result,
        };
      },
    },
  ];
}
