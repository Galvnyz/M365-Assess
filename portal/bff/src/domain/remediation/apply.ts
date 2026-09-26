// Gated remediation apply — BFF domain logic (EPIC-006 SPEC.md §4.3, §6, §8;
// T-0108).
//
// Pure helpers only: request-body validation, Idempotency-Key parsing, the
// apply-handle shape persisted for replay, and selection of plan actions to
// apply. The actual action execution, gating, dry-run, and audit writes happen
// in the PowerShell worker (Invoke-RemediationApply.ps1) per ADR-0014; this
// module performs no tenant writes and never names a command.
//
// The thin-BFF guard forbids the collector identifier token in portal/bff
// source, so records carry `check` (the adapter maps the entity field).

// ─── Errors ───────────────────────────────────────────────────────────────────

export const REMEDIATION_IDEMPOTENCY_REQUIRED = "remediation.idempotency_key_required";
export const REMEDIATION_INVALID_IDEMPOTENCY_KEY = "remediation.invalid_idempotency_key";
export const REMEDIATION_APPLY_INVALID_BODY = "remediation.apply_invalid_body";

export class RemediationApplyInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RemediationApplyInputError";
    this.code = code;
  }
}

// ─── Idempotency-Key ──────────────────────────────────────────────────────────

export const MAX_IDEMPOTENCY_KEY_LENGTH = 256;

/**
 * Parses an apply Idempotency-Key. Required on apply (SPEC §6): a missing or
 * blank key is an error, not a silent pass.
 */
export function parseRemediationIdempotencyKey(value: unknown): string {
  const header = Array.isArray(value) ? value[0] : value;
  if (header === undefined || header === null) {
    throw new RemediationApplyInputError(
      REMEDIATION_IDEMPOTENCY_REQUIRED,
      "Idempotency-Key header is required for apply",
    );
  }
  if (typeof header !== "string") {
    throw new RemediationApplyInputError(
      REMEDIATION_INVALID_IDEMPOTENCY_KEY,
      "Idempotency-Key must be a string",
    );
  }
  const key = header.trim();
  if (key.length === 0) {
    throw new RemediationApplyInputError(
      REMEDIATION_IDEMPOTENCY_REQUIRED,
      "Idempotency-Key header is required for apply",
    );
  }
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new RemediationApplyInputError(
      REMEDIATION_INVALID_IDEMPOTENCY_KEY,
      `Idempotency-Key exceeds ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
    );
  }
  return key;
}

/** Composite scope so the same key under two tenants never collides. */
export function remediationIdempotencyScope(tenantId: string, key: string): string {
  return `${tenantId}\n${key}`;
}

// ─── Apply handle (persisted for replay) ──────────────────────────────────────

export interface RemediationApplyHandle {
  readonly planId: string;
  readonly tenantId: string;
  readonly jobId: string;
  readonly requestId: string;
  readonly dryRun: boolean;
  readonly status: "queued";
}

export interface RemediationIdempotencyStore {
  find(tenantId: string, key: string): Promise<RemediationApplyHandle | undefined>;
  save(tenantId: string, key: string, handle: RemediationApplyHandle): Promise<void>;
}

export function createMemoryRemediationIdempotencyStore(): RemediationIdempotencyStore {
  const handles = new Map<string, RemediationApplyHandle>();
  return {
    async find(tenantId: string, key: string): Promise<RemediationApplyHandle | undefined> {
      return handles.get(remediationIdempotencyScope(tenantId, key));
    },
    async save(tenantId: string, key: string, handle: RemediationApplyHandle): Promise<void> {
      handles.set(remediationIdempotencyScope(tenantId, key), handle);
    },
  };
}

// ─── Apply body ───────────────────────────────────────────────────────────────

export interface RemediationApplyRequest {
  readonly dryRun: boolean;
  readonly continueOnFailure: boolean;
  readonly actionIds: readonly string[];
  readonly reason: string | null;
}

function asBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new RemediationApplyInputError(
      REMEDIATION_APPLY_INVALID_BODY,
      `Field '${field}' must be a boolean`,
    );
  }
  return value;
}

/**
 * Validates an apply request body. `dryRun` defaults to true: an absent flag
 * must never imply a live write (SPEC §4.3 step 6, 06-remediation §3.2).
 */
export function parseRemediationApplyBody(body: Record<string, unknown>): RemediationApplyRequest {
  const dryRun = asBoolean(body["dryRun"], "dryRun") ?? true;
  const continueOnFailure = asBoolean(body["continueOnFailure"], "continueOnFailure") ?? false;

  let actionIds: readonly string[] = [];
  const rawIds = body["actionIds"];
  if (rawIds !== undefined && rawIds !== null) {
    if (!Array.isArray(rawIds) || rawIds.some((id) => typeof id !== "string" || id.length === 0)) {
      throw new RemediationApplyInputError(
        REMEDIATION_APPLY_INVALID_BODY,
        "Field 'actionIds' must be an array of non-empty strings",
      );
    }
    actionIds = rawIds as string[];
  }

  const rawReason = body["reason"];
  let reason: string | null = null;
  if (rawReason !== undefined && rawReason !== null && rawReason !== "") {
    if (typeof rawReason !== "string") {
      throw new RemediationApplyInputError(
        REMEDIATION_APPLY_INVALID_BODY,
        "Field 'reason' must be a string",
      );
    }
    reason = rawReason;
  }

  return { dryRun, continueOnFailure, actionIds, reason };
}

// ─── Selection ────────────────────────────────────────────────────────────────

export interface RemediationActionRef {
  readonly id: string;
  readonly check: string;
  readonly state: string;
}

/**
 * Selects the actions to apply. An explicit `actionIds` list is honoured;
 * otherwise every action in the plan is a candidate. Ineligible actions are not
 * filtered here — the worker gates each one and records a skip, so the caller
 * sees exactly why an action did not apply.
 */
export function selectApplyActions(
  actions: readonly RemediationActionRef[],
  actionIds: readonly string[],
): readonly RemediationActionRef[] {
  if (actionIds.length === 0) return actions;
  const wanted = new Set(actionIds);
  return actions.filter((action) => wanted.has(action.id));
}
