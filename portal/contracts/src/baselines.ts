// Baselines contracts (EPIC-010 SPEC.md §5, §11.1, §11.3). A `Baseline` rolls
// desired state out in ordered stages across assigned tenants; each stage holds
// standards with `and`-only conditions for v1 (§9 rollout-complexity risk).
//
// This ticket builds on the shared EPIC-008 standards/conditions model rather
// than a parallel one: a stage condition names a standard by key with the
// expected value, and each condition is individually removable (§3.3).
//
// The shape is shared by storage and the BFF/UI. `portal/db` restates the shape
// locally (the same workspace-boundary pattern used for drift/standards)
// because this module is not an exported subpath of @m365-assess/contracts.

/** v1 supports `and`-only stage logic (SPEC §9); full boolean logic is deferred. */
export const BASELINE_LOGIC_VALUES = ["and"] as const;
export type BaselineLogic = (typeof BASELINE_LOGIC_VALUES)[number];

export function isBaselineLogic(value: unknown): value is BaselineLogic {
  return value === "and";
}

/** What a stage does once its conditions are satisfied (SPEC §4.2, §8). */
export const BASELINE_STAGE_ACTIONS = ["report", "remediate"] as const;
export type BaselineStageAction = (typeof BASELINE_STAGE_ACTIONS)[number];

export function isBaselineStageAction(value: unknown): value is BaselineStageAction {
  return (
    typeof value === "string" &&
    (BASELINE_STAGE_ACTIONS as readonly string[]).includes(value)
  );
}

/**
 * One staged standard: the standard key with the expected value for this
 * stage. Individually removable in the builder (§3.3).
 */
export interface BaselineCondition {
  readonly key: string;
  readonly expected: unknown;
}

export interface BaselineStage {
  readonly baselineId: string;
  /** Zero-based position; stages are unique and contiguous per baseline. */
  readonly order: number;
  readonly conditions: readonly BaselineCondition[];
  readonly action: BaselineStageAction;
}

/** Alerting card on the builder (SPEC §3.3); delivery ties into EPIC-029. */
export interface BaselineAlerting {
  readonly enabled: boolean;
}

export interface Baseline {
  readonly id: string;
  readonly name: string;
  readonly stages: readonly BaselineStage[];
  readonly logic: BaselineLogic;
  readonly alerting: BaselineAlerting;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Assignment targets mirror the EPIC-008 three-tier vocabulary (SPEC §4.1). */
export const BASELINE_TARGET_TYPES = ["allTenants", "group", "tenant"] as const;
export type BaselineTargetType = (typeof BASELINE_TARGET_TYPES)[number];

export function isBaselineTargetType(value: unknown): value is BaselineTargetType {
  return (
    typeof value === "string" &&
    (BASELINE_TARGET_TYPES as readonly string[]).includes(value)
  );
}

export interface BaselineAssignment {
  readonly baselineId: string;
  readonly targetType: BaselineTargetType;
  /** Tenant/group id; null for an `allTenants` target. */
  readonly targetId: string | null;
  readonly precedence: number;
}
