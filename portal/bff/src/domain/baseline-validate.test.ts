// T-0182 — baseline save-gate validation.
import { describe, expect, it } from "vitest";
import {
  BASELINE_INVALID_STAGES,
  BASELINE_SAVE_BLOCKED,
  BaselineValidationError,
  assertBaselineSavable,
  validateBaselineInput,
  validateStageOrdering,
  type BaselineSaveInput,
} from "./baseline-validate.js";

function savable(overrides: Partial<BaselineSaveInput> = {}): BaselineSaveInput {
  return {
    name: "Server baseline",
    assignments: [{ targetType: "tenant", targetId: "contoso" }],
    stages: [{ order: 0, conditions: [{ key: "CA-REPORTONLY-001", expected: 1 }], action: "report" }],
    ...overrides,
  };
}

describe("assertBaselineSavable (T-0182)", () => {
  it("accepts a named, assigned baseline with a staged standard", () => {
    expect(() => assertBaselineSavable(savable())).not.toThrow();
  });

  it("blocks a save without a name, an assignment, or a staged standard", () => {
    try {
      assertBaselineSavable(savable({ name: "  ", assignments: [], stages: [] }));
      expect.unreachable("expected the save gate to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(BaselineValidationError);
      const validation = error as BaselineValidationError;
      expect(validation.code).toBe(BASELINE_SAVE_BLOCKED);
      expect(validation.violations.map((violation) => violation.field)).toEqual(
        expect.arrayContaining(["name", "assignments", "stages"]),
      );
    }
  });

  it("blocks a save whose stages hold no standards", () => {
    try {
      assertBaselineSavable(savable({ stages: [{ order: 0, conditions: [], action: "report" }] }));
      expect.unreachable("expected the save gate to throw");
    } catch (error) {
      expect((error as BaselineValidationError).code).toBe(BASELINE_SAVE_BLOCKED);
    }
  });
});

describe("validateStageOrdering (T-0182)", () => {
  it("accepts contiguous zero-based ordering", () => {
    expect(
      validateStageOrdering([
        { order: 1, conditions: [], action: "report" },
        { order: 0, conditions: [], action: "report" },
      ]),
    ).toEqual([]);
  });

  it("rejects duplicates, gaps, bad actions, and keyless conditions", () => {
    expect(
      validateStageOrdering([
        { order: 0, conditions: [], action: "report" },
        { order: 0, conditions: [], action: "report" },
      ]),
    ).toHaveLength(1);
    expect(
      validateStageOrdering([{ order: 2, conditions: [], action: "report" }]),
    ).toHaveLength(1);
    expect(
      validateStageOrdering([{ order: 0, conditions: [], action: "delete" }]),
    ).toHaveLength(1);
    expect(
      validateStageOrdering([{ order: 0, conditions: [{ key: "", expected: 1 }], action: "report" }]),
    ).toHaveLength(1);
  });
});

describe("validateBaselineInput (T-0182)", () => {
  it("reports ordering failures before the save gate", () => {
    try {
      validateBaselineInput(savable({ stages: [{ order: 5, conditions: [], action: "report" }] }));
      expect.unreachable("expected ordering to throw first");
    } catch (error) {
      expect((error as BaselineValidationError).code).toBe(BASELINE_INVALID_STAGES);
    }
  });
});
