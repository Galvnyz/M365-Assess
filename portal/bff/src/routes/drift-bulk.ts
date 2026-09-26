// Bulk drift triage API (EPIC-009 SPEC.md §3.1, §6; T-0167).
//
//   POST /v1/drift/bulk
//
// Applies the T-0165/T-0166 per-item semantics across a selection within one
// tenant. Selection membership is validated all-or-nothing: if any requested id
// is unknown or belongs to another tenant, the whole batch is rejected and
// nothing is written. Per-item eligibility is best-effort, so the response
// carries a partial-result shape (`applied` / `skipped`).
//
// `Denied-Delete` carries the same destructive confirmation token as the
// single-item path. Every item is audited with the actor and reason.

import { AppError } from "../errors.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";
import { requirePermission, requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { Permission } from "../rbac/roles.js";
import type { DriftDeviationRecord, DriftDeviationState } from "./drift.js";
import { buildAcceptPatch, type DriftTriagePatch } from "../domain/drift-triage.js";
import {
  buildDeleteInstruction,
  buildDeletePendingPatch,
  buildDenyPatch,
  isDeletionDue,
  DRIFT_DENY_CONFIRMATION_REQUIRED,
  type DriftDeleteInstruction,
} from "../domain/drift-delete-queue.js";

export const DRIFT_BULK_PATH = "/v1/drift/bulk";

export const DRIFT_BULK_ACTIONS = ["accept", "deny-delete", "deny-remediate"] as const;
export type DriftBulkAction = (typeof DRIFT_BULK_ACTIONS)[number];

export const DRIFT_BULK_PERMISSIONS = {
  triage: "drift.triage",
  remediate: "drift.remediate",
  apply: "Remediation.Apply",
} as const;

export const DRIFT_BULK_UNAUTHENTICATED = "request.unauthenticated";
export const DRIFT_BULK_INVALID = "drift.bulk_invalid";
export const DRIFT_BULK_SELECTION_INVALID = "drift.bulk_selection_invalid";

export interface DriftBulkStore {
  getDeviationById(deviationId: string): Promise<DriftDeviationRecord | undefined>;
  applyTriageByDeviationId(
    deviationId: string,
    patch: DriftTriagePatch,
  ): Promise<DriftDeviationRecord | undefined>;
}

export interface DriftBulkRemediationPort {
  queueDeletion(instruction: DriftDeleteInstruction): Promise<string>;
}

export interface DriftBulkAuditPort {
  record(event: Record<string, unknown>): Promise<void> | void;
}

export interface DriftBulkOptions {
  readonly store: DriftBulkStore;
  readonly remediation: DriftBulkRemediationPort;
  readonly resolveCaller: (ctx: RequestContext) => Caller | undefined;
  readonly authorize?: (caller: Caller, permission: string) => void | Promise<void>;
  readonly audit?: DriftBulkAuditPort;
  readonly now?: () => Date;
}

export interface DriftBulkRequest extends RequestContext {
  readonly body?: unknown;
}

export interface DriftBulkInput {
  readonly tenantId: string;
  readonly action: DriftBulkAction;
  readonly deviationIds: readonly string[];
  readonly reason: string;
  readonly confirm: boolean;
  readonly delayDays: number;
  readonly expiresOn: string | null;
  readonly autoRemediateOnExpiry: boolean;
}

export interface DriftBulkOutcome {
  readonly deviationId: string;
  readonly state: DriftDeviationState;
}

export interface DriftBulkSkipped {
  readonly deviationId: string;
  readonly reason: string;
}

export interface DriftBulkResult {
  readonly tenantId: string;
  readonly action: DriftBulkAction;
  readonly applied: readonly DriftBulkOutcome[];
  readonly skipped: readonly DriftBulkSkipped[];
}

const INELIGIBLE_STATES: readonly DriftDeviationState[] = ["deletePending", "resolved"];

function asRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError(DRIFT_BULK_INVALID, "Request body must be a JSON object", 400, [
      { field: "body", reason: "invalid" },
    ]);
  }
  return body as Record<string, unknown>;
}

function parseBulkInput(body: unknown): DriftBulkInput {
  const record = asRecord(body);
  const tenantId = record["tenantId"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new AppError(DRIFT_BULK_INVALID, "Field 'tenantId' is required", 400, [
      { field: "tenantId", reason: "required" },
    ]);
  }
  const action = record["action"];
  if (typeof action !== "string" || !(DRIFT_BULK_ACTIONS as readonly string[]).includes(action)) {
    throw new AppError(DRIFT_BULK_INVALID, "Field 'action' is invalid", 400, [
      { field: "action", reason: "invalid" },
    ]);
  }
  const ids = record["deviationIds"];
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new AppError(DRIFT_BULK_INVALID, "Field 'deviationIds' must be a non-empty array of ids", 400, [
      { field: "deviationIds", reason: "invalid" },
    ]);
  }
  const reason = record["reason"];
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new AppError(DRIFT_BULK_INVALID, "Field 'reason' is required", 400, [
      { field: "reason", reason: "required" },
    ]);
  }
  const parsedAction = action as DriftBulkAction;
  const rawExpires = record["expiresOn"];
  const expiresOn = typeof rawExpires === "string" && rawExpires.length > 0 ? rawExpires : null;
  if (parsedAction === "accept" && expiresOn === null) {
    throw new AppError(DRIFT_BULK_INVALID, "Field 'expiresOn' is required for accept", 400, [
      { field: "expiresOn", reason: "required" },
    ]);
  }
  const rawDelay = record["delayDays"];
  const delayDays =
    typeof rawDelay === "number" && Number.isFinite(rawDelay) && rawDelay >= 0 ? Math.floor(rawDelay) : 0;
  return {
    tenantId,
    action: parsedAction,
    deviationIds: ids as readonly string[],
    reason: reason.trim(),
    confirm: record["confirm"] === true,
    delayDays,
    expiresOn,
    autoRemediateOnExpiry: record["autoRemediateOnExpiry"] === true,
  };
}

async function ensureAuthorized(
  options: DriftBulkOptions,
  caller: Caller,
  permission: string,
): Promise<void> {
  if (options.authorize) {
    await options.authorize(caller, permission);
    return;
  }
  requirePermission(caller, permission as Permission);
}

function requireCaller(options: DriftBulkOptions, ctx: DriftBulkRequest): Caller {
  const caller = options.resolveCaller(ctx);
  if (!caller) {
    throw new AppError(DRIFT_BULK_UNAUTHENTICATED, "authentication required", 401);
  }
  return caller;
}

export function createDriftBulkRoutes(options: DriftBulkOptions): Route[] {
  const now = options.now ?? (() => new Date());

  async function handleBulk(ctx: DriftBulkRequest): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    const input = parseBulkInput(ctx.body);
    requireTenantInScope(caller, input.tenantId);

    // Destructive and remediating bulk actions need the higher privileges.
    if (input.action === "accept") {
      await ensureAuthorized(options, caller, DRIFT_BULK_PERMISSIONS.triage);
    } else {
      await ensureAuthorized(options, caller, DRIFT_BULK_PERMISSIONS.remediate);
      await ensureAuthorized(options, caller, DRIFT_BULK_PERMISSIONS.apply);
    }
    if (input.action === "deny-delete" && !input.confirm) {
      throw new AppError(
        DRIFT_DENY_CONFIRMATION_REQUIRED,
        "Bulk deny-delete requires confirm: true",
        409,
      );
    }

    // All-or-nothing selection membership: resolve every id first, within scope.
    const selected: DriftDeviationRecord[] = [];
    const foreign: string[] = [];
    for (const id of input.deviationIds) {
      const row = await options.store.getDeviationById(id);
      if (!row || row.tenantId !== input.tenantId) {
        foreign.push(id);
        continue;
      }
      selected.push(row);
    }
    if (foreign.length > 0) {
      throw new AppError(
        DRIFT_BULK_SELECTION_INVALID,
        `selection contains unknown or out-of-tenant deviations: ${foreign.join(", ")}`,
        400,
        [{ field: "deviationIds", reason: "invalid" }],
      );
    }

    const at = now();
    const applied: DriftBulkOutcome[] = [];
    const skipped: DriftBulkSkipped[] = [];

    for (const row of selected) {
      if (INELIGIBLE_STATES.includes(row.state)) {
        skipped.push({ deviationId: row.id, reason: `ineligible state: ${row.state}` });
        continue;
      }

      let patch: DriftTriagePatch;
      if (input.action === "accept") {
        patch = buildAcceptPatch({
          reason: input.reason,
          expiresOn: input.expiresOn!,
          autoRemediateOnExpiry: input.autoRemediateOnExpiry,
        });
      } else if (input.action === "deny-remediate") {
        // Denied but remediated when the (zero-length) window lapses.
        patch = {
          state: "denied",
          reason: input.reason,
          expiresOn: at.toISOString(),
          autoRemediateOnExpiry: true,
          overrideValue: null,
        };
      } else {
        patch = buildDenyPatch(
          { reason: input.reason, confirm: true, delayDays: input.delayDays },
          at,
        );
      }

      let updated = await options.store.applyTriageByDeviationId(row.id, patch);
      if (!updated) {
        skipped.push({ deviationId: row.id, reason: "not found" });
        continue;
      }

      if (input.action === "deny-delete" && isDeletionDue(updated, at)) {
        const pending = await options.store.applyTriageByDeviationId(row.id, buildDeletePendingPatch());
        if (pending) {
          updated = pending;
          const instruction = buildDeleteInstruction(
            {
              tenantId: pending.tenantId,
              standardKey: pending.standardKey,
              resourceId: pending.resourceId,
              state: pending.state,
              reason: input.reason,
              expiresOn: patch.expiresOn,
            },
            at,
          );
          await options.remediation.queueDeletion(instruction);
        }
      }

      applied.push({ deviationId: updated.id, state: updated.state });
      if (options.audit) {
        await options.audit.record({
          action: `drift.bulk.${input.action}`,
          tenantId: input.tenantId,
          resourceId: updated.id,
          standardKey: updated.standardKey,
          state: updated.state,
          reason: input.reason,
          correlationId: ctx.correlationId,
        });
      }
    }

    const result: DriftBulkResult = {
      tenantId: input.tenantId,
      action: input.action,
      applied,
      skipped,
    };
    return { status: 200, body: result };
  }

  return [{ method: "POST", path: DRIFT_BULK_PATH, handler: handleBulk }];
}

// ─── OpenAPI fragment (§6) ───────────────────────────────────────────────────

export const DRIFT_BULK_OPENAPI = {
  "/v1/drift/bulk": {
    post: {
      tags: ["Drift"],
      operationId: "bulkTriageDrift",
      summary: "Accept / deny-delete / deny-remediate a selection within a tenant.",
      permission: DRIFT_BULK_PERMISSIONS.triage,
      security: [{ bearerAuth: [] }],
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/DriftBulkRequest" } } } },
      responses: {
        "200": { description: "Bulk outcomes.", content: { "application/json": { schema: { $ref: "#/components/schemas/DriftBulkResponse" } } } },
        "400": { description: "Invalid body or selection.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "409": { description: "Confirmation required for deny-delete.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
} as const;
