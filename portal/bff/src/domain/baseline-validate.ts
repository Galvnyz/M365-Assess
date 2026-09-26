// Baseline save-gate validation (EPIC-010 SPEC.md §4.1, §10; T-0182).
//
// Save is blocked until a name, an assignment, and at least one staged
// standard exist. The gate is pure so the builder can preview it client-side
// and the routes can reject with a structured error. Stage ordering
// (unique, contiguous from zero) is validated here too so a bad order fails
// with a 400 rather than a storage error.

export const BASELINE_SAVE_BLOCKED = "baseline.save_blocked";
export const BASELINE_INVALID_STAGES = "baseline.invalid_stages";

export interface BaselineSaveCondition {
  readonly key: string;
  readonly expected: unknown;
}

export interface BaselineSaveStage {
  readonly order: number;
  readonly conditions: readonly BaselineSaveCondition[];
  readonly action: string;
}

export interface BaselineSaveAssignment {
  readonly targetType: string;
  readonly targetId?: string | null;
}

export interface BaselineSaveInput {
  readonly name: string;
  readonly assignments: readonly BaselineSaveAssignment[];
  readonly stages: readonly BaselineSaveStage[];
}

export interface BaselineSaveViolation {
  readonly field: string;
  readonly reason: string;
}

export class BaselineValidationError extends Error {
  readonly code: string;
  readonly violations: readonly BaselineSaveViolation[];

  constructor(code: string, violations: readonly BaselineSaveViolation[]) {
    super(violations.map((violation) => `${violation.field}: ${violation.reason}`).join("; "));
    this.name = "BaselineValidationError";
    this.code = code;
    this.violations = violations;
  }
}

/** Stages must be uniquely ordered and contiguous from zero. */
export function validateStageOrdering(stages: readonly BaselineSaveStage[]): BaselineSaveViolation[] {
  const violations: BaselineSaveViolation[] = [];
  const orders = stages.map((stage) => stage.order);
  const sorted = [...orders].sort((left, right) => left - right);
  for (let index = 0; index < sorted.length; index += 1) {
    if (sorted[index] !== index) {
      violations.push({
        field: "stages",
        reason: `stage orders must be unique and contiguous from 0; found ${JSON.stringify(orders)}`,
      });
      break;
    }
  }
  for (const stage of stages) {
    if (stage.action !== "report" && stage.action !== "remediate") {
      violations.push({
        field: `stages[${stage.order}].action`,
        reason: "stage action must be 'report' or 'remediate'",
      });
    }
    for (const condition of stage.conditions) {
      if (typeof condition.key !== "string" || condition.key.length === 0) {
        violations.push({
          field: `stages[${stage.order}].conditions`,
          reason: "every condition needs a non-empty standard key",
        });
        break;
      }
    }
  }
  return violations;
}

/**
 * The T-0182 save gate: name + assignment + at least one staged standard.
 * Throws BaselineValidationError with every violation found.
 */
export function assertBaselineSavable(input: BaselineSaveInput): void {
  const violations: BaselineSaveViolation[] = [];
  if (input.name.trim().length === 0) {
    violations.push({ field: "name", reason: "a baseline name is required before saving" });
  }
  if (input.assignments.length === 0) {
    violations.push({
      field: "assignments",
      reason: "assign at least one tenant or group before saving",
    });
  }
  const stagedStandards = input.stages.reduce((count, stage) => count + stage.conditions.length, 0);
  if (stagedStandards === 0) {
    violations.push({
      field: "stages",
      reason: "add standards to at least one stage before saving",
    });
  }
  if (violations.length > 0) {
    throw new BaselineValidationError(BASELINE_SAVE_BLOCKED, violations);
  }
}

/** Full input validation: ordering first, then the save gate. */
export function validateBaselineInput(input: BaselineSaveInput): void {
  const ordering = validateStageOrdering(input.stages);
  if (ordering.length > 0) {
    throw new BaselineValidationError(BASELINE_INVALID_STAGES, ordering);
  }
  assertBaselineSavable(input);
}
