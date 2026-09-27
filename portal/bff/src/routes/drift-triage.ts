// Drift triage API (EPIC-009 SPEC.md §3.2, §4.2, §6; T-0165).
//
//   POST   /v1/drift/deviations/{deviationId}/accept    -> accepted (+ reason/expiry)
//   POST   /v1/drift/deviations/{deviationId}/override  -> customerSpecific (+ tenant value)
//   DELETE /v1/drift/deviations/{deviationId}/override  -> revert to the template value
//
// Accept and override are non-destructive. Deny/queue-deletion is T-0166. Writes
// require `Tenant.Drift.ReadWrite` and are audited. The store seam applies the triage by
// deviation id (the concrete adapter resolves the id to the T-0162 triage key).

import { AppError, ErrorCodes } from "../errors.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";
import { requirePermission, type Caller } from "../rbac/authorize.js";
import type { Permission } from "../rbac/roles.js";
import {
  DriftTriageInputError,
  buildAcceptPatch,
  buildOverridePatch,
  buildRevertPatch,
  parseAcceptInput,
  parseOverrideInput,
  type DriftTriagePatch,
} from "../domain/drift-triage.js";
import type { DriftDeviationRecord } from "./drift.js";

export const DRIFT_ACCEPT_PATH = "/v1/drift/deviations/:deviationId/accept";
export const DRIFT_OVERRIDE_PATH = "/v1/drift/deviations/:deviationId/override";

export const DRIFT_TRIAGE_PERMISSION = "Tenant.Drift.ReadWrite";
export const DRIFT_TRIAGE_UNAUTHENTICATED = "request.unauthenticated";
export const DRIFT_DEVIATION_NOT_FOUND = "drift.deviation_not_found";

export interface DriftTriageStore {
  /** Apply a triage patch by deviation id; undefined when the id is unknown. */
  applyTriageByDeviationId(
    deviationId: string,
    patch: DriftTriagePatch,
  ): Promise<DriftDeviationRecord | undefined>;
}

export interface DriftTriageAuditPort {
  record(event: Record<string, unknown>): Promise<void> | void;
}

export interface DriftTriageOptions {
  readonly store: DriftTriageStore;
  readonly resolveCaller: (ctx: RequestContext) => Caller | undefined;
  readonly authorize?: (caller: Caller, permission: string) => void | Promise<void>;
  readonly audit?: DriftTriageAuditPort;
}

export interface DriftTriageRequest extends RequestContext {
  readonly body?: unknown;
}

async function ensureAuthorized(
  options: DriftTriageOptions,
  caller: Caller,
  permission: string,
): Promise<void> {
  if (options.authorize) {
    await options.authorize(caller, permission);
    return;
  }
  // drift.* is not in the roles.ts union yet (EPIC-038); deny without a seam.
  requirePermission(caller, permission as Permission);
}

function requireCaller(options: DriftTriageOptions, ctx: DriftTriageRequest): Caller {
  const caller = options.resolveCaller(ctx);
  if (!caller) {
    throw new AppError(DRIFT_TRIAGE_UNAUTHENTICATED, "authentication required", 401);
  }
  return caller;
}

function requireParam(ctx: DriftTriageRequest, name: string): string {
  const value = ctx.params[name];
  if (!value || value.length === 0) {
    throw new AppError(ErrorCodes.validationFailed, `Missing route parameter '${name}'`, 400, [
      { field: name, reason: "required" },
    ]);
  }
  return value;
}

function toInputError(error: unknown): AppError {
  if (error instanceof DriftTriageInputError) {
    return new AppError(error.code, error.message, 400, [{ field: error.field, reason: "invalid" }]);
  }
  throw error;
}

export function createDriftTriageRoutes(options: DriftTriageOptions): Route[] {
  async function applyTriage(
    ctx: DriftTriageRequest,
    build: () => DriftTriagePatch,
    action: string,
  ): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, DRIFT_TRIAGE_PERMISSION);

    const deviationId = requireParam(ctx, "deviationId");
    let patch: DriftTriagePatch;
    try {
      patch = build();
    } catch (error) {
      throw toInputError(error);
    }

    const updated = await options.store.applyTriageByDeviationId(deviationId, patch);
    if (!updated) {
      throw new AppError(
        DRIFT_DEVIATION_NOT_FOUND,
        `Drift deviation ${deviationId} not found`,
        404,
      );
    }

    if (options.audit) {
      await options.audit.record({
        action,
        tenantId: updated.tenantId,
        resourceId: deviationId,
        standardKey: updated.standardKey,
        state: updated.state,
        correlationId: ctx.correlationId,
      });
    }

    return { status: 200, body: { deviation: updated } };
  }

  return [
    {
      method: "POST",
      path: DRIFT_ACCEPT_PATH,
      handler: (ctx: DriftTriageRequest) =>
        applyTriage(ctx, () => buildAcceptPatch(parseAcceptInput(ctx.body)), "drift.accept"),
    },
    {
      method: "POST",
      path: DRIFT_OVERRIDE_PATH,
      handler: (ctx: DriftTriageRequest) =>
        applyTriage(ctx, () => buildOverridePatch(parseOverrideInput(ctx.body)), "drift.override"),
    },
    {
      method: "DELETE",
      path: DRIFT_OVERRIDE_PATH,
      handler: (ctx: DriftTriageRequest) =>
        applyTriage(ctx, () => buildRevertPatch(), "drift.override_removed"),
    },
  ];
}

// ─── OpenAPI fragment (§6) ───────────────────────────────────────────────────

export const DRIFT_TRIAGE_OPENAPI = {
  "/v1/drift/deviations/{deviationId}/accept": {
    post: {
      tags: ["Drift"],
      operationId: "acceptDriftDeviation",
      summary: "Accept a deviation with a reason and expiry.",
      permission: DRIFT_TRIAGE_PERMISSION,
      security: [{ bearerAuth: [] }],
      parameters: [{ name: "deviationId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "Accepted.", content: { "application/json": { schema: { $ref: "#/components/schemas/DriftDeviationResponse" } } } },
        "403": { description: "Forbidden.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "404": { description: "Not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
  "/v1/drift/deviations/{deviationId}/override": {
    post: {
      tags: ["Drift"],
      operationId: "overrideDriftDeviation",
      summary: "Set a tenant-specific expected value (customer specific).",
      permission: DRIFT_TRIAGE_PERMISSION,
      security: [{ bearerAuth: [] }],
      parameters: [{ name: "deviationId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "Overridden.", content: { "application/json": { schema: { $ref: "#/components/schemas/DriftDeviationResponse" } } } },
        "404": { description: "Not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
    delete: {
      tags: ["Drift"],
      operationId: "removeDriftOverride",
      summary: "Remove a tenant override, reverting to the template value.",
      permission: DRIFT_TRIAGE_PERMISSION,
      security: [{ bearerAuth: [] }],
      parameters: [{ name: "deviationId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "Reverted.", content: { "application/json": { schema: { $ref: "#/components/schemas/DriftDeviationResponse" } } } },
        "404": { description: "Not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
} as const;
