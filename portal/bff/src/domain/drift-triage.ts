// Drift triage domain (EPIC-009 SPEC.md §3.2, §4.2; T-0165).
//
// Pure construction and validation for the two non-destructive triage paths:
//   - Accept deviation  -> state `accepted`, with reason + expiry, and an
//     optional "remediate automatically when the acceptance expires" flag.
//   - Tenant override   -> state `customerSpecific`, storing a tenant-specific
//     expected value so a later drift run treats the item as compliant.
// Removing an override reverts the deviation to `open` (template value).
//
// Deny/queue-deletion is destructive and lives in T-0166.

import type { DriftDeviationState } from "../routes/drift.js";

export const DRIFT_TRIAGE_INVALID_INPUT = "drift.triage_invalid_input";

export class DriftTriageInputError extends Error {
  readonly code = DRIFT_TRIAGE_INVALID_INPUT;
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "DriftTriageInputError";
    this.field = field;
  }
}

export interface DriftTriagePatch {
  readonly state: DriftDeviationState;
  readonly reason: string | null;
  readonly expiresOn: string | null;
  readonly autoRemediateOnExpiry: boolean;
  readonly overrideValue: unknown;
}

export interface AcceptInput {
  readonly reason: string;
  readonly expiresOn: string;
  readonly autoRemediateOnExpiry: boolean;
}

function asRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new DriftTriageInputError("body", "Request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

function requireNonEmptyString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DriftTriageInputError(field, `Field '${field}' is required`);
  }
  return value.trim();
}

/** Accept requires a reason and an expiry date (SPEC §3.2). */
export function parseAcceptInput(body: unknown): AcceptInput {
  const record = asRecord(body);
  const reason = requireNonEmptyString(record, "reason");
  const expiresOn = requireNonEmptyString(record, "expiresOn");
  const autoRemediateOnExpiry = record["autoRemediateOnExpiry"];
  if (autoRemediateOnExpiry !== undefined && typeof autoRemediateOnExpiry !== "boolean") {
    throw new DriftTriageInputError(
      "autoRemediateOnExpiry",
      "Field 'autoRemediateOnExpiry' must be a boolean",
    );
  }
  return {
    reason,
    expiresOn,
    autoRemediateOnExpiry: autoRemediateOnExpiry === true,
  };
}

export interface OverrideInput {
  readonly overrideValue: unknown;
  readonly reason: string | null;
}

/** Override requires the tenant-specific expected value. */
export function parseOverrideInput(body: unknown): OverrideInput {
  const record = asRecord(body);
  if (!("overrideValue" in record) || record["overrideValue"] === undefined) {
    throw new DriftTriageInputError(
      "overrideValue",
      "Field 'overrideValue' is required",
    );
  }
  const reason = record["reason"];
  if (reason !== undefined && reason !== null && typeof reason !== "string") {
    throw new DriftTriageInputError("reason", "Field 'reason' must be a string");
  }
  return {
    overrideValue: record["overrideValue"],
    reason: typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : null,
  };
}

export function buildAcceptPatch(input: AcceptInput): DriftTriagePatch {
  return {
    state: "accepted",
    reason: input.reason,
    expiresOn: input.expiresOn,
    autoRemediateOnExpiry: input.autoRemediateOnExpiry,
    overrideValue: null,
  };
}

export function buildOverridePatch(input: OverrideInput): DriftTriagePatch {
  return {
    state: "customerSpecific",
    reason: input.reason,
    expiresOn: null,
    autoRemediateOnExpiry: false,
    overrideValue: input.overrideValue,
  };
}

/** Removing an override reverts the deviation to the template value. */
export function buildRevertPatch(): DriftTriagePatch {
  return {
    state: "open",
    reason: null,
    expiresOn: null,
    autoRemediateOnExpiry: false,
    overrideValue: null,
  };
}

export interface TriageRelevantDeviation {
  readonly state: DriftDeviationState;
  readonly expiresOn: string | null;
  readonly autoRemediateOnExpiry: boolean;
  readonly overrideValue: unknown;
}

/** True when an acceptance has lapsed as of `now`. */
export function isAcceptanceExpired(
  deviation: Pick<TriageRelevantDeviation, "state" | "expiresOn">,
  now: Date,
): boolean {
  if (deviation.state !== "accepted" || !deviation.expiresOn) return false;
  const at = Date.parse(deviation.expiresOn);
  return !Number.isNaN(at) && at <= now.getTime();
}

/**
 * True when a lapsed acceptance was flagged to remediate on expiry, so the
 * deviation becomes remediable (SPEC §4.2). Consumed by the remediation path.
 */
export function shouldRemediateOnExpiry(
  deviation: TriageRelevantDeviation,
  now: Date,
): boolean {
  return deviation.autoRemediateOnExpiry && isAcceptanceExpired(deviation, now);
}

/**
 * The expected value a run should compare against: a customer-specific override
 * wins over the template value (SPEC §4.2, §11.1), so an overridden item reads
 * as compliant on the next run.
 */
export function effectiveExpected(
  deviation: Pick<TriageRelevantDeviation, "state" | "overrideValue">,
  templateExpected: unknown,
): unknown {
  if (deviation.state === "customerSpecific" && deviation.overrideValue !== undefined) {
    return deviation.overrideValue;
  }
  return templateExpected;
}
