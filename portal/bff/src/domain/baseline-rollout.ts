// Baseline rollout evaluation (EPIC-010 SPEC.md §4.2, §5, §9; T-0185).
//
// A Baseline system timer (EPIC-007) evaluates each assigned tenant against
// its current stage: when the tenant satisfies the stage conditions it
// becomes eligible to advance (the operator moves it; T-0186), and each
// evaluation upserts a `BaselineRollout` row. Fleet runs stay cheap via
// per-baseline single-flight (§9 "long fleet runs" mitigation). History and
// trend writes are appended by T-0188; this module records the rollout state
// the trend later samples.

export const BASELINE_ROLLOUT_STATES = ["active", "eligible", "complete"] as const;
export type BaselineRolloutState = (typeof BASELINE_ROLLOUT_STATES)[number];

export interface RolloutStageCondition {
  readonly key: string;
  readonly expected: unknown;
}

export interface RolloutStage {
  readonly order: number;
  readonly conditions: readonly RolloutStageCondition[];
}

export interface BaselineRollout {
  readonly baselineId: string;
  readonly tenantId: string;
  readonly stage: number;
  readonly state: BaselineRolloutState;
  readonly lastRunAt: string;
}

export interface ConditionResult {
  readonly key: string;
  readonly satisfied: boolean;
}

export interface StageEvaluation {
  readonly order: number;
  readonly results: readonly ConditionResult[];
  /** Every condition in the stage is satisfied. */
  readonly satisfied: boolean;
  /** A later stage exists to advance into. */
  readonly hasNextStage: boolean;
  /** The rollout state this evaluation implies. */
  readonly state: BaselineRolloutState;
}

/** Order-independent comparison for condition values. */
export function rolloutValuesEqual(current: unknown, expected: unknown): boolean {
  return canonicalize(current) === canonicalize(expected);
}

function canonicalize(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return "null";
  if (depth > 12) return '"<max-depth>"';
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item, depth + 1)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item, depth + 1)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(String(value));
}

/**
 * Evaluates one tenant against its current stage. A satisfied tenant is
 * marked `eligible` when a later stage exists, `complete` on the final
 * stage; an unsatisfied tenant stays `active`.
 */
export function evaluateTenantStage(
  stage: RolloutStage,
  currentValues: Readonly<Record<string, unknown>>,
  hasNextStage: boolean,
): StageEvaluation {
  const results = stage.conditions.map((condition) => ({
    key: condition.key,
    satisfied: rolloutValuesEqual(currentValues[condition.key], condition.expected),
  }));
  const satisfied = results.every((result) => result.satisfied);
  return {
    order: stage.order,
    results,
    satisfied,
    hasNextStage,
    state: !satisfied ? "active" : hasNextStage ? "eligible" : "complete",
  };
}

// ─── Single-flight per baseline (§9) ──────────────────────────────────────────

const runningBaselines = new Set<string>();

/** Returns false when an evaluation for the baseline is already running. */
export function beginBaselineEvaluation(baselineId: string): boolean {
  if (runningBaselines.has(baselineId)) return false;
  runningBaselines.add(baselineId);
  return true;
}

export function endBaselineEvaluation(baselineId: string): void {
  runningBaselines.delete(baselineId);
}
