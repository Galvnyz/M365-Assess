// T-0185 — baseline rollout evaluation and eligibility.
import { describe, expect, it } from "vitest";
import {
  beginBaselineEvaluation,
  endBaselineEvaluation,
  evaluateTenantStage,
  rolloutValuesEqual,
} from "./baseline-rollout.js";

describe("rolloutValuesEqual (T-0185)", () => {
  it("compares order-independently", () => {
    expect(rolloutValuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(rolloutValuesEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(rolloutValuesEqual(undefined, null)).toBe(true);
  });
});

describe("evaluateTenantStage (T-0185)", () => {
  const stage = {
    order: 0,
    conditions: [
      { key: "A", expected: 1 },
      { key: "B", expected: { state: "enabled" } },
    ],
  };

  it("marks a satisfied tenant eligible to advance", () => {
    const evaluation = evaluateTenantStage(stage, { A: 1, B: { state: "enabled" } }, true);
    expect(evaluation.satisfied).toBe(true);
    expect(evaluation.state).toBe("eligible");
    expect(evaluation.results).toEqual([
      { key: "A", satisfied: true },
      { key: "B", satisfied: true },
    ]);
  });

  it("keeps an unsatisfied tenant active", () => {
    const evaluation = evaluateTenantStage(stage, { A: 1, B: { state: "disabled" } }, true);
    expect(evaluation.satisfied).toBe(false);
    expect(evaluation.state).toBe("active");
  });

  it("marks the final satisfied stage complete", () => {
    const evaluation = evaluateTenantStage(stage, { A: 1, B: { state: "enabled" } }, false);
    expect(evaluation.state).toBe("complete");
  });
});

describe("single-flight (T-0185)", () => {
  it("runs one evaluation per baseline at a time", () => {
    expect(beginBaselineEvaluation("bl-1")).toBe(true);
    expect(beginBaselineEvaluation("bl-1")).toBe(false);
    endBaselineEvaluation("bl-1");
    expect(beginBaselineEvaluation("bl-1")).toBe(true);
    endBaselineEvaluation("bl-1");
  });
});
