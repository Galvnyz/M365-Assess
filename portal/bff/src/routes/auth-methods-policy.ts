// Authentication-methods policy read/apply (EPIC-012 SPEC.md §3.3, §4.3 US-6;
// T-0225). GET returns the current tenant policy; PUT takes a named v1 preset
// or a concrete policy shape and supports a preview mode returning the
// current-vs-proposed diff with no write. Apply is the highest-risk MFA write:
// it requires `mfa.policy` plus `Remediation.Apply` (SPEC §4.3), an explicit
// confirmation with a reason, and an audit record. The BFF validates and
// expands here; the worker applies the concrete shape through the EPIC-006
// gated executor path.
import { AppError, ErrorCodes } from "../errors.js";
import {
  AuthMethodPresetError,
  parseAuthMethodPreset,
  presetPolicy,
  validatePolicyShape,
  type AuthMethodPolicyShape,
  type AuthMethodPresetId,
} from "../domain/auth-methods/presets.js";
import { requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const AUTH_METHODS_POLICY_PATH = "/v1/tenants/:tenantId/auth-methods-policy";

export const AUTH_METHODS_READ_PERMISSION = "mfa.read";
export const AUTH_METHODS_POLICY_PERMISSION = "mfa.policy";
export const REMEDIATION_APPLY_PERMISSION = "Remediation.Apply";

export const AUTH_METHODS_UNAUTHENTICATED = "request.unauthenticated";
export const AUTH_METHODS_UNAVAILABLE = "authMethods.unavailable";
export const AUTH_METHODS_CONFIRM_REQUIRED = "authMethods.confirm_required";

export interface AuthMethodsCaller extends Caller {
  readonly userId?: string;
}

export type AuthMethodsAuthorizer = (
  caller: AuthMethodsCaller,
  permission: string,
) => void | Promise<void>;

export interface AuthMethodsPolicySnapshot {
  readonly policy: AuthMethodPolicyShape;
  readonly retrievedAt: string;
}

// Queue-backed seam for the policy path: the production wiring enqueues one
// worker job per call and serves the live policy. Depending on the seam keeps
// Graph and process code out of the BFF.
export interface AuthMethodsPolicyProvider {
  getPolicy(tenantId: string): Promise<AuthMethodsPolicySnapshot>;
  applyPolicy(
    tenantId: string,
    policy: AuthMethodPolicyShape,
    options: { dryRun: boolean },
  ): Promise<{ policy: AuthMethodPolicyShape }>;
}

export interface AuthMethodsPolicyAuditEvent {
  readonly tenantId: string;
  readonly action: "mfa.policyApply";
  readonly targetId: string;
  readonly result: "success" | "failure";
  readonly before: AuthMethodPolicyShape | null;
  readonly after: AuthMethodPolicyShape | null;
  readonly error: string | null;
  readonly actorUserId: string | null;
  readonly correlationId: string;
  readonly createdAt: string;
}

export interface AuthMethodsRequestContext extends RequestContext {
  readonly body?: unknown;
}

export interface AuthMethodsPolicyRouteOptions {
  readonly provider: AuthMethodsPolicyProvider;
  readonly resolveCaller: (ctx: RequestContext) => AuthMethodsCaller | undefined;
  readonly authorize?: AuthMethodsAuthorizer;
  readonly readBody?: (ctx: AuthMethodsRequestContext) => unknown;
  readonly recordAudit?: (event: AuthMethodsPolicyAuditEvent) => Promise<void>;
  readonly now?: () => string;
}

function unauthenticatedError(): AppError {
  return new AppError(AUTH_METHODS_UNAUTHENTICATED, "authentication required", 401);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => AuthMethodsCaller | undefined,
  ctx: RequestContext,
): AuthMethodsCaller {
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

function readJsonBody(
  ctx: RequestContext,
  readBody: ((ctx: AuthMethodsRequestContext) => unknown) | undefined,
): Record<string, unknown> {
  let body = readBody ? readBody(ctx as AuthMethodsRequestContext) : (ctx as AuthMethodsRequestContext).body;
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

function toAppError(error: unknown): AppError {
  if (error instanceof AuthMethodPresetError) {
    const status = error.code === "authMethods.unknown_preset" ? 400 : 400;
    return new AppError(error.code, error.message, status, [{ field: "policy", reason: "invalid" }]);
  }
  throw error;
}

export interface ResolvedPolicy {
  readonly preset: AuthMethodPresetId | null;
  readonly policy: AuthMethodPolicyShape;
}

// Resolves the PUT body to a concrete policy: exactly one of `preset` or
// `policy` must be present. A preset expands through the v1 catalogue; a raw
// shape is validated so a partial write can never slip through.
export function resolveProposedPolicy(body: Record<string, unknown>): ResolvedPolicy {
  const hasPreset = body["preset"] !== undefined;
  const hasPolicy = body["policy"] !== undefined;
  if (hasPreset === hasPolicy) {
    throw new AppError(ErrorCodes.validationFailed, "provide exactly one of 'preset' or 'policy'", 400, [
      { field: "preset", reason: "invalid" },
    ]);
  }
  if (hasPreset) {
    try {
      const preset = parseAuthMethodPreset(body["preset"]);
      return { preset, policy: presetPolicy(preset) };
    } catch (error) {
      throw toAppError(error);
    }
  }
  try {
    return { preset: null, policy: validatePolicyShape(body["policy"]) };
  } catch (error) {
    throw toAppError(error);
  }
}

export interface AuthMethodPolicyDiff {
  readonly id: string;
  readonly before: string;
  readonly after: string;
}

// Current-vs-proposed diff over the canonical vocabulary, changed methods
// only, in catalogue order.
export function diffAuthMethodPolicy(
  current: AuthMethodPolicyShape,
  proposed: AuthMethodPolicyShape,
): AuthMethodPolicyDiff[] {
  const before = new Map(current.methods.map((entry) => [entry.id, entry.state]));
  const diffs: AuthMethodPolicyDiff[] = [];
  for (const entry of proposed.methods) {
    const prior = before.get(entry.id) ?? "unknown";
    if (prior !== entry.state) {
      diffs.push({ id: entry.id, before: prior, after: entry.state });
    }
  }
  return diffs;
}

export interface AuthMethodsPolicyPreview {
  readonly current: AuthMethodPolicyShape;
  readonly proposed: AuthMethodPolicyShape;
  readonly diff: AuthMethodPolicyDiff[];
  readonly applied: AuthMethodPolicyShape | null;
}

export async function getAuthMethodsPolicy(
  provider: AuthMethodsPolicyProvider,
  tenantId: string,
): Promise<{ status: number; body: AuthMethodsPolicySnapshot & { tenantId: string } }> {
  if (tenantId.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "tenantId is required", 400, [
      { field: "tenantId", reason: "required" },
    ]);
  }
  const snapshot = await provider.getPolicy(tenantId);
  return { status: 200, body: { tenantId, policy: snapshot.policy, retrievedAt: snapshot.retrievedAt } };
}

export async function putAuthMethodsPolicy(
  options: AuthMethodsPolicyRouteOptions,
  ctx: RequestContext,
  tenantId: string,
  caller: AuthMethodsCaller,
): Promise<{ status: number; body: AuthMethodsPolicyPreview }> {
  const body = readJsonBody(ctx, options.readBody);
  const resolved = resolveProposedPolicy(body);
  const previewRaw = body["preview"];
  if (previewRaw !== undefined && typeof previewRaw !== "boolean") {
    throw new AppError(ErrorCodes.validationFailed, "preview must be a boolean", 400, [
      { field: "preview", reason: "invalid" },
    ]);
  }
  const snapshot = await options.provider.getPolicy(tenantId);
  const diff = diffAuthMethodPolicy(snapshot.policy, resolved.policy);
  if (previewRaw === true) {
    return { status: 200, body: { current: snapshot.policy, proposed: resolved.policy, diff, applied: null } };
  }
  if (options.authorize) {
    await options.authorize(caller, REMEDIATION_APPLY_PERMISSION);
  }
  const reason = body["reason"];
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "reason is required", 400, [
      { field: "reason", reason: "required" },
    ]);
  }
  if (body["confirm"] !== true) {
    throw new AppError(
      AUTH_METHODS_CONFIRM_REQUIRED,
      "applying the authentication-methods policy requires { \"confirm\": true } with a reason",
      400,
      [{ field: "confirm", reason: "required" }],
    );
  }
  let applied: AuthMethodPolicyShape;
  try {
    const outcome = await options.provider.applyPolicy(tenantId, resolved.policy, { dryRun: false });
    applied = outcome.policy;
  } catch (error) {
    const message = error instanceof Error ? error.message : "policy apply failed without a provider result";
    await writePolicyAudit(options, ctx, caller, tenantId, snapshot.policy, null, "failure", message);
    throw new AppError(AUTH_METHODS_UNAVAILABLE, message, 502);
  }
  await writePolicyAudit(options, ctx, caller, tenantId, snapshot.policy, applied, "success", null);
  return { status: 200, body: { current: snapshot.policy, proposed: resolved.policy, diff, applied } };
}

async function writePolicyAudit(
  options: AuthMethodsPolicyRouteOptions,
  ctx: RequestContext,
  caller: AuthMethodsCaller,
  tenantId: string,
  before: AuthMethodPolicyShape | null,
  after: AuthMethodPolicyShape | null,
  result: "success" | "failure",
  error: string | null,
): Promise<void> {
  if (!options.recordAudit) {
    return;
  }
  const now = options.now ?? (() => new Date().toISOString());
  await options.recordAudit({
    tenantId,
    action: "mfa.policyApply",
    targetId: tenantId,
    result,
    before,
    after,
    error,
    actorUserId: caller.userId ?? null,
    correlationId: ctx.correlationId,
    createdAt: now(),
  });
}

export function createAuthMethodsPolicyRoutes(options: AuthMethodsPolicyRouteOptions): Route[] {
  const getHandler = async (ctx: RequestContext): Promise<RouteResponse> => {
    const caller = requireCaller(options.resolveCaller, ctx);
    if (options.authorize) {
      await options.authorize(caller, AUTH_METHODS_READ_PERMISSION);
    }
    const tenantId = requireTenantParam(ctx);
    requireTenantInScope(caller, tenantId);
    const result = await getAuthMethodsPolicy(options.provider, tenantId);
    return { status: result.status, body: result.body };
  };
  const putHandler = async (ctx: RequestContext): Promise<RouteResponse> => {
    const caller = requireCaller(options.resolveCaller, ctx);
    if (options.authorize) {
      await options.authorize(caller, AUTH_METHODS_POLICY_PERMISSION);
    }
    const tenantId = requireTenantParam(ctx);
    requireTenantInScope(caller, tenantId);
    const result = await putAuthMethodsPolicy(options, ctx, tenantId, caller);
    return { status: result.status, body: result.body };
  };
  return [
    { method: "GET", path: AUTH_METHODS_POLICY_PATH, handler: getHandler },
    { method: "PUT", path: AUTH_METHODS_POLICY_PATH, handler: putHandler },
  ];
}

// Route modules own their OpenAPI path items (portal.v1.yaml `paths` is empty
// by design); a wiring ticket merges this fragment into the served document.
export const AUTH_METHODS_POLICY_OPENAPI = {
  paths: {
    "/tenants/{tenantId}/auth-methods-policy": {
      get: {
        operationId: "getAuthMethodsPolicy",
        summary: "Read the current tenant authentication-methods policy",
        permission: AUTH_METHODS_READ_PERMISSION,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "tenantId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "The current policy with its capture time." },
          "401": { description: "Authentication required." },
          "403": { description: "The caller lacks mfa.read or the tenant is out of scope." },
        },
      },
      put: {
        operationId: "putAuthMethodsPolicy",
        summary: "Preview (preview: true) or apply a preset/concrete policy; apply needs mfa.policy plus Remediation.Apply, confirm, and a reason",
        permission: AUTH_METHODS_POLICY_PERMISSION,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "tenantId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "The current-vs-proposed diff, with the applied policy when not previewing." },
          "400": { description: "Unknown preset, invalid shape, or missing confirmation/reason." },
          "401": { description: "Authentication required." },
          "403": { description: "The caller lacks mfa.policy (or Remediation.Apply) or the tenant is out of scope." },
          "502": { description: "The worker could not apply the policy." },
        },
      },
    },
  },
} as const;
