// Registration campaign route (EPIC-012 SPEC.md §3.4, §4.4 US-7; T-0226).
// GET returns the campaign state, configuration, and eligible user count.
// PUT toggles the campaign (enabled/disabled) with included/excluded groups
// and snooze days, routing through EPIC-006 gating and audit.

import { AppError, ErrorCodes } from "../errors.js";
import { requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const REGISTRATION_CAMPAIGN_PATH = "/v1/tenants/:tenantId/registration-campaign";

export const REGISTRATION_CAMPAIGN_READ_PERMISSION = "mfa.read";
export const REGISTRATION_CAMPAIGN_WRITE_PERMISSION = "mfa.policy";

export const REGISTRATION_CAMPAIGN_UNAUTHENTICATED = "request.unauthenticated";
export const REGISTRATION_CAMPAIGN_CONFIRM_REQUIRED = "registrationCampaign.confirm_required";

export type CampaignState = "enabled" | "disabled";

export interface RegistrationCampaignState {
  readonly tenantId: string;
  readonly state: CampaignState;
  readonly snoozeDurationInDays: number;
  readonly includeTargets: readonly string[];
  readonly excludeTargets: readonly string[];
  readonly eligibleUserCount: number;
  readonly retrievedAt: string;
}

export interface RegistrationCampaignConfig {
  readonly state: CampaignState;
  readonly snoozeDurationInDays: number;
  readonly includeTargets: readonly string[];
  readonly excludeTargets: readonly string[];
}

export interface RegistrationCampaignProvider {
  getCampaign(tenantId: string): Promise<{
    state: CampaignState;
    snoozeDurationInDays: number;
    includeTargets: readonly string[];
    excludeTargets: readonly string[];
    eligibleUserCount: number;
    retrievedAt: string;
  }>;
  setCampaign(
    tenantId: string,
    config: RegistrationCampaignConfig,
  ): Promise<{
    state: CampaignState;
    snoozeDurationInDays: number;
    includeTargets: readonly string[];
    excludeTargets: readonly string[];
    eligibleUserCount: number;
    appliedAt: string;
  }>;
}

export interface RegistrationCampaignCaller extends Caller {
  readonly userId?: string;
}

export type RegistrationCampaignAuthorizer = (
  caller: RegistrationCampaignCaller,
  permission: string,
) => void | Promise<void>;

export interface RegistrationCampaignAuditEvent {
  readonly tenantId: string;
  readonly action: "mfa.registrationCampaign";
  readonly state: CampaignState;
  readonly before: RegistrationCampaignConfig | null;
  readonly after: RegistrationCampaignConfig;
  readonly reason: string;
  readonly actorUserId: string | null;
  readonly correlationId: string;
  readonly createdAt: string;
}

export interface RegistrationCampaignRequestContext extends RequestContext {
  readonly body?: unknown;
}

export interface RegistrationCampaignRouteOptions {
  readonly provider: RegistrationCampaignProvider;
  readonly resolveCaller: (ctx: RequestContext) => RegistrationCampaignCaller | undefined;
  readonly authorize?: RegistrationCampaignAuthorizer;
  readonly readBody?: (ctx: RegistrationCampaignRequestContext) => unknown;
  readonly recordAudit?: (event: RegistrationCampaignAuditEvent) => Promise<void>;
  readonly now?: () => string;
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => RegistrationCampaignCaller | undefined,
  ctx: RequestContext,
): RegistrationCampaignCaller {
  const caller = resolveCaller(ctx);
  if (caller === undefined) {
    throw new AppError(REGISTRATION_CAMPAIGN_UNAUTHENTICATED, "authentication required", 401);
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

function readJsonBody(
  ctx: RequestContext,
  readBody: ((ctx: RegistrationCampaignRequestContext) => unknown) | undefined,
): Record<string, unknown> {
  let body = readBody ? readBody(ctx as RegistrationCampaignRequestContext) : (ctx as RegistrationCampaignRequestContext).body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      throw new AppError(ErrorCodes.validationFailed, "request body is not valid JSON", 400, [
        { field: "body", reason: "invalid_json" },
      ]);
    }
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError(ErrorCodes.validationFailed, "request body must be a JSON object", 400, [
      { field: "body", reason: "invalid" },
    ]);
  }
  return body as Record<string, unknown>;
}

export function parseCampaignInput(body: Record<string, unknown>): {
  config: RegistrationCampaignConfig;
  confirm: boolean;
  reason: string;
} {
  const state = body["state"];
  if (state !== "enabled" && state !== "disabled") {
    throw new AppError(ErrorCodes.validationFailed, "state must be 'enabled' or 'disabled'", 400, [
      { field: "state", reason: "invalid" },
    ]);
  }

  let snoozeDays = 1;
  if (body["snoozeDurationInDays"] !== undefined) {
    const rawSnooze = body["snoozeDurationInDays"];
    if (typeof rawSnooze !== "number" || !Number.isInteger(rawSnooze) || rawSnooze < 1 || rawSnooze > 14) {
      throw new AppError(ErrorCodes.validationFailed, "snoozeDurationInDays must be an integer between 1 and 14", 400, [
        { field: "snoozeDurationInDays", reason: "invalid" },
      ]);
    }
    snoozeDays = rawSnooze;
  }

  const parseGroupList = (field: string): string[] => {
    const val = body[field];
    if (val === undefined) return [];
    if (!Array.isArray(val) || val.some((item) => typeof item !== "string" || item.trim().length === 0)) {
      throw new AppError(ErrorCodes.validationFailed, `${field} must be an array of strings`, 400, [
        { field, reason: "invalid" },
      ]);
    }
    return val.map((s) => s.trim());
  };

  const includeTargets = parseGroupList("includeTargets");
  const excludeTargets = parseGroupList("excludeTargets");

  const confirm = body["confirm"] === true;
  const reason = typeof body["reason"] === "string" ? body["reason"].trim() : "";

  return {
    config: {
      state,
      snoozeDurationInDays: snoozeDays,
      includeTargets,
      excludeTargets,
    },
    confirm,
    reason,
  };
}

export function createRegistrationCampaignRoute(options: RegistrationCampaignRouteOptions): Route[] {
  const now = options.now ?? (() => new Date().toISOString());

  const getHandler = async (ctx: RequestContext): Promise<RouteResponse> => {
    const caller = requireCaller(options.resolveCaller, ctx);
    const tenantId = requireTenantParam(ctx);
    requireTenantInScope(caller, tenantId);

    if (options.authorize) {
      await options.authorize(caller, REGISTRATION_CAMPAIGN_READ_PERMISSION);
    }

    const campaign = await options.provider.getCampaign(tenantId);
    const result: RegistrationCampaignState = {
      tenantId,
      state: campaign.state,
      snoozeDurationInDays: campaign.snoozeDurationInDays,
      includeTargets: campaign.includeTargets,
      excludeTargets: campaign.excludeTargets,
      eligibleUserCount: campaign.eligibleUserCount,
      retrievedAt: campaign.retrievedAt,
    };
    return { status: 200, body: result };
  };

  const putHandler = async (ctx: RequestContext): Promise<RouteResponse> => {
    const caller = requireCaller(options.resolveCaller, ctx);
    const tenantId = requireTenantParam(ctx);
    requireTenantInScope(caller, tenantId);

    if (options.authorize) {
      await options.authorize(caller, REGISTRATION_CAMPAIGN_WRITE_PERMISSION);
    }

    const body = readJsonBody(ctx, options.readBody);
    const parsed = parseCampaignInput(body);

    if (!parsed.confirm) {
      throw new AppError(
        REGISTRATION_CAMPAIGN_CONFIRM_REQUIRED,
        "updating registration campaign requires confirm: true with a reason",
        400,
        [{ field: "confirm", reason: "required" }],
      );
    }
    if (parsed.reason.length === 0) {
      throw new AppError(ErrorCodes.validationFailed, "reason is required", 400, [
        { field: "reason", reason: "required" },
      ]);
    }

    let beforeConfig: RegistrationCampaignConfig | null = null;
    try {
      const prior = await options.provider.getCampaign(tenantId);
      beforeConfig = {
        state: prior.state,
        snoozeDurationInDays: prior.snoozeDurationInDays,
        includeTargets: prior.includeTargets,
        excludeTargets: prior.excludeTargets,
      };
    } catch {
      // Prior read failure is non-fatal for audit capture
    }

    const applied = await options.provider.setCampaign(tenantId, parsed.config);

    if (options.recordAudit) {
      await options.recordAudit({
        tenantId,
        action: "mfa.registrationCampaign",
        state: applied.state,
        before: beforeConfig,
        after: parsed.config,
        reason: parsed.reason,
        actorUserId: caller.userId ?? null,
        correlationId: ctx.correlationId,
        createdAt: now(),
      });
    }

    const result: RegistrationCampaignState = {
      tenantId,
      state: applied.state,
      snoozeDurationInDays: applied.snoozeDurationInDays,
      includeTargets: applied.includeTargets,
      excludeTargets: applied.excludeTargets,
      eligibleUserCount: applied.eligibleUserCount,
      retrievedAt: applied.appliedAt,
    };
    return { status: 200, body: result };
  };

  return [
    { method: "GET", path: REGISTRATION_CAMPAIGN_PATH, handler: getHandler },
    { method: "PUT", path: REGISTRATION_CAMPAIGN_PATH, handler: putHandler },
  ];
}
