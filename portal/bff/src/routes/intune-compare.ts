// Intune policy compare API (EPIC-016 SPEC.md §3.4, §4.4, §6, §11.4; T-0310).
//
// GET /v1/tenants/:tenantId/intune/compare?left=<ref>&right=<ref>
//   ref := policy:<kind>:<policyId>   a live policy in :tenantId
//        | template:<templateId>      an Intune template (T-0305)
//
// Read-only: loads both objects and returns the structural diff of settings and
// assignments (domain/policy-compare). v1 compares policy<->policy and
// policy<->template within one tenant; cross-tenant compare is deferred (SPEC §11.4)
// and answers 501. Both sides must be the same policy kind.
import { isKnownKind } from "../domain/intune-policy-types.js";
import { comparePolicies, type CompareSubject } from "../domain/policy-compare.js";
import { AppError, ErrorCodes } from "../errors.js";
import { RbacErrorCodes, requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { IntuneTemplateRepository } from "../repository/intune-templates.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const INTUNE_COMPARE_PATH = "/v1/tenants/:tenantId/intune/compare";
export const INTUNE_COMPARE_PERMISSION = "intune.read";
export const ErrorCodesCrossTenantDeferred = "intune.compare.cross_tenant_deferred" as const;
export const ErrorCodesCompareNotFound = "intune.compare.not_found" as const;

/** Query parameters that would name a second tenant; any of them means cross-tenant compare. */
const CROSS_TENANT_PARAMS = ["leftTenantId", "rightTenantId", "otherTenantId", "compareTenantId"] as const;

export interface ComparePolicy {
  readonly id: string;
  readonly displayName: string;
  readonly platform: string;
  /** Full policy configuration as read from Graph. */
  readonly body: Record<string, unknown>;
  readonly assignments: readonly unknown[];
}

/** Loads one live policy with its full configuration (a Get-IntunePolicies worker read). */
export interface ComparePolicyProvider {
  getPolicy(tenantId: string, kind: string, policyId: string): Promise<ComparePolicy | undefined>;
}

export interface CompareRequestContext extends RequestContext {
  readonly permissions?: readonly string[];
}

export interface IntuneCompareRouteOptions {
  readonly provider: ComparePolicyProvider;
  readonly templates: IntuneTemplateRepository;
  readonly resolveCaller: (ctx: RequestContext) => Caller | undefined;
  readonly authorize?: (ctx: CompareRequestContext, permission: string) => boolean;
}

export type CompareRef =
  | { readonly source: "policy"; readonly kind: string; readonly id: string }
  | { readonly source: "template"; readonly id: string };

function badRef(field: string, reason: string): AppError {
  return new AppError(ErrorCodes.validationFailed, `invalid ${field} reference: ${reason}`, 400, [{ field, reason }]);
}

/** Parse `policy:<kind>:<id>` or `template:<id>`; a `@tenant` suffix is a cross-tenant ref. */
export function parseCompareRef(raw: string | null, field: string, tenantId: string): CompareRef {
  if (!raw || !raw.trim()) throw badRef(field, "required, e.g. policy:configuration:<id> or template:<id>");
  const value = raw.trim();
  const at = value.lastIndexOf("@");
  if (at !== -1) {
    const otherTenant = value.slice(at + 1);
    if (otherTenant && otherTenant !== tenantId) throw crossTenantDeferred();
    return parseCompareRef(value.slice(0, at), field, tenantId);
  }
  const [source, ...rest] = value.split(":");
  if (source === "policy") {
    const [kind, ...idParts] = rest;
    const id = idParts.join(":");
    if (!kind || !isKnownKind(kind)) throw badRef(field, `unknown policy kind '${kind ?? ""}'`);
    if (!id) throw badRef(field, "missing policy id");
    return { source: "policy", kind, id };
  }
  if (source === "template") {
    const id = rest.join(":");
    if (!id) throw badRef(field, "missing template id");
    return { source: "template", id };
  }
  throw badRef(field, "must start with 'policy:' or 'template:'");
}

function crossTenantDeferred(): AppError {
  return new AppError(
    ErrorCodesCrossTenantDeferred,
    "Cross-tenant compare is not supported in v1 (deferred, SPEC §11.4); compare objects within one tenant",
    501,
  );
}

function refString(ref: CompareRef): string {
  return ref.source === "policy" ? `policy:${ref.kind}:${ref.id}` : `template:${ref.id}`;
}

function defaultAuthorize(ctx: CompareRequestContext, permission: string): boolean {
  const granted = ctx.permissions;
  return granted === undefined || granted.includes(permission) || granted.includes("*");
}

export function createIntuneCompareRoute(options: IntuneCompareRouteOptions): Route {
  const authorize = options.authorize ?? defaultAuthorize;

  async function load(tenantId: string, ref: CompareRef): Promise<CompareSubject> {
    if (ref.source === "policy") {
      const policy = await options.provider.getPolicy(tenantId, ref.kind, ref.id);
      if (!policy) {
        throw new AppError(ErrorCodesCompareNotFound, `${ref.kind} policy '${ref.id}' not found in the tenant`, 404);
      }
      return {
        ref: refString(ref),
        label: policy.displayName,
        source: "policy",
        kind: ref.kind,
        platform: policy.platform,
        body: policy.body,
        assignments: policy.assignments,
      };
    }
    const template = await options.templates.get(ref.id);
    if (!template) throw new AppError(ErrorCodesCompareNotFound, `Intune template '${ref.id}' not found`, 404);
    return {
      ref: refString(ref),
      label: template.name,
      source: "template",
      kind: template.policyType,
      platform: template.platform,
      body: template.policyJson,
      assignments: template.assignments,
    };
  }

  return {
    method: "GET",
    path: INTUNE_COMPARE_PATH,
    handler: async (ctx): Promise<RouteResponse> => {
      const caller = options.resolveCaller(ctx);
      if (caller === undefined) throw new AppError("request.unauthenticated", "authentication required", 401);
      const tenantId = ctx.params["tenantId"]?.trim() ?? "";
      if (!tenantId) {
        throw new AppError(ErrorCodes.validationFailed, "tenantId is required", 400, [{ field: "tenantId", reason: "required" }]);
      }
      requireTenantInScope(caller, tenantId);
      if (!authorize(ctx as CompareRequestContext, INTUNE_COMPARE_PERMISSION)) {
        throw new AppError(RbacErrorCodes.forbidden, `forbidden: requires ${INTUNE_COMPARE_PERMISSION}`, 403);
      }
      for (const param of CROSS_TENANT_PARAMS) {
        const other = ctx.query.get(param);
        if (other && other.trim() && other.trim() !== tenantId) throw crossTenantDeferred();
      }

      const leftRef = parseCompareRef(ctx.query.get("left"), "left", tenantId);
      const rightRef = parseCompareRef(ctx.query.get("right"), "right", tenantId);
      if (leftRef.source === "template" && rightRef.source === "template") {
        throw badRef("right", "v1 compares policy<->policy or policy<->template; at least one side must be a policy");
      }
      if (refString(leftRef) === refString(rightRef)) throw badRef("right", "must differ from left");

      const [left, right] = await Promise.all([load(tenantId, leftRef), load(tenantId, rightRef)]);
      if (left.kind !== right.kind) {
        throw badRef("right", `cannot compare a ${left.kind} policy with a ${right.kind} object`);
      }
      return { status: 200, body: comparePolicies(left, right) };
    },
  };
}
