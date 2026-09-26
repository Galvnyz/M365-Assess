// Baseline history, run events, and trend sampling (EPIC-010 SPEC.md §4.5,
// §5, §9, §11.5; T-0188).
//
// Every evaluation appends one `BaselineHistory` row and one `BaselineTrend`
// point (per-run sampling). History is append-only: rows are never mutated
// or deleted except by retention pruning inside the configured window
// (03-database.md §7). The fleet chart downsamples points for display.

export interface HistoryEventInput {
  readonly baselineId: string;
  readonly tenantId: string;
  readonly event: string;
  readonly detail?: Record<string, unknown>;
  readonly at?: string;
}

export interface HistoryEvent extends Required<Omit<HistoryEventInput, "detail">> {
  readonly id: string;
  readonly detail: Record<string, unknown>;
}

export interface TrendPoint {
  readonly baselineId: string;
  readonly tenantId: string;
  readonly at: string;
  /** Share of satisfied stage conditions for the run (0-1). */
  readonly compliance: number;
}

/** Builds the history row for one evaluation plus its trend point. */
export function buildEvaluationRecords(input: {
  baselineId: string;
  tenantId: string;
  stage: number;
  satisfied: number;
  evaluated: number;
  state: string;
  at?: string;
}): { history: HistoryEventInput; trend: TrendPoint } {
  const at = input.at ?? new Date().toISOString();
  const compliance =
    input.evaluated === 0 ? 1 : Math.min(1, Math.max(0, input.satisfied / input.evaluated));
  return {
    history: {
      baselineId: input.baselineId,
      tenantId: input.tenantId,
      event: "stage.evaluated",
      detail: { stage: input.stage, satisfied: input.satisfied, evaluated: input.evaluated, state: input.state },
      at,
    },
    trend: { baselineId: input.baselineId, tenantId: input.tenantId, at, compliance },
  };
}

/** Sampling helper shared by evaluations: satisfied share clamped to 0-1. */
export function sampleTrendCompliance(
  results: readonly { satisfied: boolean }[],
): number {
  if (results.length === 0) return 1;
  const satisfied = results.filter((result) => result.satisfied).length;
  return satisfied / results.length;
}

/** ISO cutoff for retention pruning: rows older than this may be deleted. */
export function historyRetentionCutoff(retentionDays: number, now: Date = new Date()): string {
  if (!Number.isFinite(retentionDays) || retentionDays < 0) {
    throw new Error("retentionDays must be a non-negative number");
  }
  return new Date(now.getTime() - retentionDays * 86400 * 1000).toISOString();
}

/** True when a history row is old enough to prune under the window. */
export function isHistoryPrunable(at: string, cutoffIso: string): boolean {
  return at < cutoffIso;
}
