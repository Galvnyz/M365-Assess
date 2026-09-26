// T-0169 — per-setting drift auto-remediation selection.
import { describe, expect, it } from "vitest";
import {
  isAutoRemediateEnabled,
  selectAutoRemediable,
  summarizeAutoRemediation,
  type AutoRemediationResult,
  type DriftMismatch,
} from "./drift-auto-remediate.js";

const mismatches: DriftMismatch[] = [
  { standardKey: "CA-REPORTONLY-001", resourceId: "p1", current: 1, expected: 2 },
  { standardKey: "ENTRA-SECDEFAULT-001", resourceId: "p2", current: 1, expected: 2 },
  { standardKey: "EXO-SHARING-001", resourceId: "p3", current: 1, expected: 2 },
];

describe("isAutoRemediateEnabled (T-0169)", () => {
  it("is opt-in: nothing is enabled by default", () => {
    expect(isAutoRemediateEnabled("CA-REPORTONLY-001", new Set())).toBe(false);
    expect(isAutoRemediateEnabled("CA-REPORTONLY-001", new Set(["CA-REPORTONLY-001"]))).toBe(true);
  });
});

describe("selectAutoRemediable (T-0169)", () => {
  it("selects only the mismatches whose setting is enabled", () => {
    const selected = selectAutoRemediable(mismatches, new Set(["CA-REPORTONLY-001", "EXO-SHARING-001"]));
    expect(selected.map((m) => m.standardKey)).toEqual(["CA-REPORTONLY-001", "EXO-SHARING-001"]);
  });

  it("returns nothing when no toggle is enabled (report-only)", () => {
    expect(selectAutoRemediable(mismatches, new Set())).toEqual([]);
  });
});

describe("summarizeAutoRemediation (T-0169)", () => {
  it("counts each outcome", () => {
    const results: AutoRemediationResult[] = [
      { standardKey: "a", resourceId: "r1", outcome: "remediated", reason: null },
      { standardKey: "b", resourceId: "r2", outcome: "skipped", reason: "not-allowlisted" },
      { standardKey: "c", resourceId: "r3", outcome: "failed", reason: "boom" },
      { standardKey: "d", resourceId: "r4", outcome: "remediated", reason: null },
    ];
    expect(summarizeAutoRemediation(results)).toEqual({
      total: 4,
      remediated: 2,
      skipped: 1,
      failed: 1,
    });
  });

  it("is all-zero for an empty run", () => {
    expect(summarizeAutoRemediation([])).toEqual({
      total: 0,
      remediated: 0,
      skipped: 0,
      failed: 0,
    });
  });
});
