// Per-setting drift auto-remediation (EPIC-009 SPEC.md §4.3, §8, §11.5; T-0169).
//
// Drift is report-only unless a setting explicitly enables auto-remediation
// (§11.5). When enabled, only the mismatches whose setting is enabled become
// remediable; every write still routes through the EPIC-006 contract (no drift-
// specific executor, §8). A gate failure (licence/service/RBAC/scope/allowlist)
// skips that item and records why — it never writes directly.
//
// The per-setting toggle is passed as an explicit set of enabled standard keys,
// NOT parsed out of the expected value: the expected value is compared against
// the tenant's current state, so embedding a control flag inside it would make
// every setting permanently drift.

export interface DriftMismatch {
  readonly standardKey: string;
  readonly resourceId: string;
  readonly current: unknown;
  readonly expected: unknown;
}

/** True when a setting has opted into auto-remediation. */
export function isAutoRemediateEnabled(
  standardKey: string,
  enabledKeys: ReadonlySet<string>,
): boolean {
  return enabledKeys.has(standardKey);
}

/**
 * Selects the mismatches that may be auto-remediated. Extras never auto-
 * remediate: deleting a tenant resource is the destructive deny path (T-0166),
 * never an implicit action.
 */
export function selectAutoRemediable(
  mismatches: readonly DriftMismatch[],
  enabledKeys: ReadonlySet<string>,
): DriftMismatch[] {
  return mismatches.filter((mismatch) => isAutoRemediateEnabled(mismatch.standardKey, enabledKeys));
}

export type AutoRemediationOutcome = "remediated" | "skipped" | "failed";

export interface AutoRemediationResult {
  readonly standardKey: string;
  readonly resourceId: string;
  readonly outcome: AutoRemediationOutcome;
  /** Reason recorded for a skipped or failed item (gate failure, error). */
  readonly reason: string | null;
}

export interface AutoRemediationSummary {
  readonly total: number;
  readonly remediated: number;
  readonly skipped: number;
  readonly failed: number;
}

export function summarizeAutoRemediation(
  results: readonly AutoRemediationResult[],
): AutoRemediationSummary {
  const count = (outcome: AutoRemediationOutcome): number =>
    results.filter((result) => result.outcome === outcome).length;
  return {
    total: results.length,
    remediated: count("remediated"),
    skipped: count("skipped"),
    failed: count("failed"),
  };
}
