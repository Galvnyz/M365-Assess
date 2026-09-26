// Drift deny / queued-deletion state machine (EPIC-009 SPEC.md §3.2, §4.2, §8,
// §11.3; T-0166).
//
// Deny is the only destructive triage path: a denied deviation is queued for
// deletion and is DELETEed from the tenant on the next remediation run, and that
// cannot be undone. Three safety gates apply (SPEC §11.3):
//   1. explicit confirmation (the request must set confirm: true);
//   2. an optional delay/grace window before deletion becomes due;
//   3. deletion always routes through the EPIC-006 remediation contract — there
//      is no drift-specific executor (SPEC §8).
//
// The state flow is denied -> deletePending -> (remediation deletes) -> resolved.
// Nothing here deletes synchronously; it only plans and schedules.

import type { DriftDeviationState } from "../routes/drift.js";

/** Shown verbatim in the deny confirmation (SPEC §3.2, §8). */
export const DRIFT_DENY_WARNING =
  "DELETED from the tenant on the next remediation run; cannot be undone";

export const DRIFT_DENY_CONFIRMATION_REQUIRED = "drift.deny_confirmation_required";
export const DRIFT_DENY_INVALID_INPUT = "drift.deny_invalid_input";

export class DriftDenyInputError extends Error {
  readonly code: string;
  readonly field: string;

  constructor(code: string, field: string, message: string) {
    super(message);
    this.name = "DriftDenyInputError";
    this.code = code;
    this.field = field;
  }
}

export interface DenyInput {
  readonly reason: string;
  readonly confirm: true;
  readonly delayDays: number;
}

function asRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new DriftDenyInputError(DRIFT_DENY_INVALID_INPUT, "body", "Request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

/** Deny requires a reason, an explicit confirm, and an optional delay in days. */
export function parseDenyInput(body: unknown): DenyInput {
  const record = asRecord(body);
  if (record["confirm"] !== true) {
    throw new DriftDenyInputError(
      DRIFT_DENY_CONFIRMATION_REQUIRED,
      "confirm",
      `Deny is destructive and requires confirm: true. ${DRIFT_DENY_WARNING}.`,
    );
  }
  const reason = record["reason"];
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new DriftDenyInputError(DRIFT_DENY_INVALID_INPUT, "reason", "Field 'reason' is required");
  }
  const rawDelay = record["delayDays"];
  let delayDays = 0;
  if (rawDelay !== undefined && rawDelay !== null) {
    if (typeof rawDelay !== "number" || !Number.isFinite(rawDelay) || rawDelay < 0) {
      throw new DriftDenyInputError(DRIFT_DENY_INVALID_INPUT, "delayDays", "Field 'delayDays' must be a non-negative number");
    }
    delayDays = Math.floor(rawDelay);
  }
  return { reason: reason.trim(), confirm: true, delayDays };
}

export interface DriftTriagePatchLike {
  readonly state: DriftDeviationState;
  readonly reason: string | null;
  readonly expiresOn: string | null;
  readonly autoRemediateOnExpiry: boolean;
  readonly overrideValue: unknown;
}

/**
 * The first deny step: mark the deviation `denied` and record the deletion due
 * time in `expiresOn` (the grace window). Deletion is never synchronous.
 */
export function buildDenyPatch(input: DenyInput, now: Date): DriftTriagePatchLike {
  const deleteAfter = new Date(now.getTime() + input.delayDays * 24 * 60 * 60 * 1000);
  return {
    state: "denied",
    reason: input.reason,
    expiresOn: deleteAfter.toISOString(),
    autoRemediateOnExpiry: false,
    overrideValue: null,
  };
}

/** The second deny step: promote a due `denied` deviation to `deletePending`. */
export function buildDeletePendingPatch(): DriftTriagePatchLike {
  return {
    state: "deletePending",
    reason: null,
    expiresOn: null,
    autoRemediateOnExpiry: false,
    overrideValue: null,
  };
}

export interface DeletionDueDeviation {
  readonly state: DriftDeviationState;
  readonly expiresOn: string | null;
}

/** True when a denied deviation's grace window has elapsed. */
export function isDeletionDue(deviation: DeletionDueDeviation, now: Date): boolean {
  if (deviation.state !== "denied") return false;
  if (!deviation.expiresOn) return true;
  const at = Date.parse(deviation.expiresOn);
  return Number.isNaN(at) || at <= now.getTime();
}

/** Selects the denied deviations whose grace window has elapsed. */
export function promoteDueDenials<T extends DeletionDueDeviation>(
  deviations: readonly T[],
  now: Date,
): T[] {
  return deviations.filter((deviation) => isDeletionDue(deviation, now));
}

// ─── Deletion instruction handed to the EPIC-006 contract (SPEC §8) ───────────

export interface DriftDeleteInstruction {
  readonly kind: "drift-deny-delete";
  readonly tenantId: string;
  readonly standardKey: string;
  readonly resourceId: string;
  readonly reason: string | null;
  /** The deletion may not run before this instant (the grace window). */
  readonly notBefore: string;
}

export interface DeletionInstructionSource {
  readonly tenantId: string;
  readonly standardKey: string;
  readonly resourceId: string;
  readonly state: DriftDeviationState;
  readonly reason: string | null;
  readonly expiresOn: string | null;
}

/**
 * Builds the delete instruction for a `deletePending` deviation. There is no
 * drift-specific executor: this is handed to EPIC-006 (plan/apply/audit).
 */
export function buildDeleteInstruction(
  deviation: DeletionInstructionSource,
  now: Date,
): DriftDeleteInstruction {
  if (deviation.state !== "deletePending") {
    throw new DriftDenyInputError(
      DRIFT_DENY_INVALID_INPUT,
      "state",
      "only a delete-pending deviation can be queued for deletion",
    );
  }
  return {
    kind: "drift-deny-delete",
    tenantId: deviation.tenantId,
    standardKey: deviation.standardKey,
    resourceId: deviation.resourceId,
    reason: deviation.reason,
    notBefore: deviation.expiresOn ?? now.toISOString(),
  };
}
