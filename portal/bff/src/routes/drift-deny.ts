// Drift deny (queued deletion) API (EPIC-009 SPEC.md §3.2, §4.2, §6, §8; T-0166).
//
//   POST /v1/drift/deviations/{deviationId}/deny
//
// Deny is destructive: the deviation is marked denied, then queued for deletion
// (`deletePending`) and DELETED from the tenant on the next remediation run. It is
// never deleted synchronously. The request must set `confirm: true`; an optional
// `delayDays` grace window defers deletion. The actual delete is handed to the
// EPIC-006 remediation contract through an injected seam — there is no drift-
// specific executor. Requires `Remediation.Apply`.

import { AppError, ErrorCodes } from "../errors.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";
import { requirePermission, type Caller } from "../rbac/authorize.js";
import type { Permission } from "../rbac/roles.js";
import type { DriftDeviationRecord } from "./drift.js";
import {
  DriftDenyInputError,
  buildDeleteInstruction,
  buildDeletePendingPatch,
  buildDenyPatch,
  isDeletionDue,
  parseDenyInput,
  type DriftDeleteInstruction,
  type DriftTriagePatchLike,
} from "../domain/drift-delete-queue.js";

export const DRIFT_DENY_PATH = "/v1/drift/deviations/:deviationId/deny";

export const DRIFT_DENY_PERMISSIONS = {
  triage: "Remediation.Apply",
  remediate: "Remediation.Apply",
} as const;
export const DRIFT_DENY_UNAUTHENTICATED = "request.unauthenticated";
export const DRIFT_DEVIATION_NOT_FOUND = "drift.deviation_not_found";

export interface DriftDenyStore {
  applyTriageByDeviationId(
    deviationId: string,
    patch: DriftTriagePatchLike,
  ): Promise<DriftDeviationRecord | undefined>;
}

/** Hands the delete to the EPIC-006 contract; returns a job reference. */
export interface DriftRemediationPort {
  queueDeletion(instruction: DriftDeleteInstruction): Promise<string>;
}

export interface DriftDenyAuditPort {
  record(event: Record<string, unknown>): Promise<void> | void;
}

export interface DriftDenyOptions {
  readonly store: DriftDenyStore;
  readonly remediation: DriftRemediationPort;
  readonly resolveCaller: (ctx: RequestContext) => Caller | undefined;
  readonly authorize?: (caller: Caller, permission: string) => void | Promise<void>;
  readonly audit?: DriftDenyAuditPort;
  readonly now?: () => Date;
}

export interface DriftDenyRequest extends RequestContext {
  readonly body?: unknown;
}

async function ensureAuthorized(
  options: DriftDenyOptions,
  caller: Caller,
  permission: string,
): Promise<void> {
  if (options.authorize) {
    await options.authorize(caller, permission);
    return;
  }
  requirePermission(caller, permission as Permission);
}

function requireCaller(options: DriftDenyOptions, ctx: DriftDenyRequest): Caller {
  const caller = options.resolveCaller(ctx);
  if (!caller) {
    throw new AppError(DRIFT_DENY_UNAUTHENTICATED, "authentication required", 401);
  }
  return caller;
}

function requireParam(ctx: DriftDenyRequest, name: string): string {
  const value = ctx.params[name];
  if (!value || value.length === 0) {
    throw new AppError(ErrorCodes.validationFailed, `Missing route parameter '${name}'`, 400, [
      { field: name, reason: "required" },
    ]);
  }
  return value;
}

function toInputError(error: unknown): AppError {
  if (error instanceof DriftDenyInputError) {
    return new AppError(error.code, error.message, error.code === "drift.deny_confirmation_required" ? 409 : 400, [
      { field: error.field, reason: "invalid" },
    ]);
  }
  throw error;
}

export function createDriftDenyRoutes(options: DriftDenyOptions): Route[] {
  const now = options.now ?? (() => new Date());

  async function handleDeny(ctx: DriftDenyRequest): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    // Destructive: both the drift and the EPIC-006 apply permission are required.
    await ensureAuthorized(options, caller, DRIFT_DENY_PERMISSIONS.triage);
    await ensureAuthorized(options, caller, DRIFT_DENY_PERMISSIONS.remediate);

    const deviationId = requireParam(ctx, "deviationId");
    let input;
    try {
      input = parseDenyInput(ctx.body);
    } catch (error) {
      throw toInputError(error);
    }

    const at = now();
    const denied = await options.store.applyTriageByDeviationId(
      deviationId,
      buildDenyPatch(input, at),
    );
    if (!denied) {
      throw new AppError(DRIFT_DEVIATION_NOT_FOUND, `Drift deviation ${deviationId} not found`, 404);
    }

    if (options.audit) {
      await options.audit.record({
        action: "drift.deny",
        tenantId: denied.tenantId,
        resourceId: deviationId,
        standardKey: denied.standardKey,
        reason: input.reason,
        delayDays: input.delayDays,
        correlationId: ctx.correlationId,
      });
    }

    // Promote to deletePending when the (possibly zero-length) grace window has
    // elapsed, and hand the delete to EPIC-006. Never deletes here.
    if (!isDeletionDue(denied, at)) {
      return { status: 202, body: { deviation: denied, deletionQueued: false } };
    }

    const pending = await options.store.applyTriageByDeviationId(
      deviationId,
      buildDeletePendingPatch(),
    );
    if (!pending) {
      throw new AppError(DRIFT_DEVIATION_NOT_FOUND, `Drift deviation ${deviationId} not found`, 404);
    }

    const instruction = buildDeleteInstruction(
      {
        tenantId: pending.tenantId,
        standardKey: pending.standardKey,
        resourceId: pending.resourceId,
        state: pending.state,
        reason: denied.reason ?? input.reason,
        expiresOn: denied.expiresOn,
      },
      at,
    );
    const jobId = await options.remediation.queueDeletion(instruction);

    if (options.audit) {
      await options.audit.record({
        action: "drift.deny_queued",
        tenantId: pending.tenantId,
        resourceId: deviationId,
        standardKey: pending.standardKey,
        reason: denied.reason ?? input.reason,
        jobId,
        correlationId: ctx.correlationId,
      });
    }

    return {
      status: 202,
      body: { deviation: pending, deletionQueued: true, jobId, notBefore: instruction.notBefore },
    };
  }

  return [{ method: "POST", path: DRIFT_DENY_PATH, handler: handleDeny }];
}

// ─── OpenAPI fragment (§6) ───────────────────────────────────────────────────

export const DRIFT_DENY_OPENAPI = {
  "/v1/drift/deviations/{deviationId}/deny": {
    post: {
      tags: ["Drift"],
      operationId: "denyDriftDeviation",
      summary: "Queue a deviation for deletion (destructive; confirm required).",
      permission: DRIFT_DENY_PERMISSIONS.triage,
      additionalPermission: DRIFT_DENY_PERMISSIONS.remediate,
      security: [{ bearerAuth: [] }],
      parameters: [{ name: "deviationId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "202": { description: "Denied and queued.", content: { "application/json": { schema: { $ref: "#/components/schemas/DriftDeviationResponse" } } } },
        "403": { description: "Forbidden.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "404": { description: "Not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "409": { description: "Confirmation required.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
} as const;
