// T-0188 — baseline history, trend sampling, and retention.
import { describe, expect, it } from "vitest";
import {
  buildEvaluationRecords,
  historyRetentionCutoff,
  isHistoryPrunable,
  sampleTrendCompliance,
} from "./baseline-history.js";

describe("buildEvaluationRecords (T-0188)", () => {
  it("appends one history event and one trend point per evaluation", () => {
    const { history, trend } = buildEvaluationRecords({
      baselineId: "bl-1",
      tenantId: "contoso",
      stage: 0,
      satisfied: 3,
      evaluated: 4,
      state: "active",
      at: "2026-09-26T00:00:00.000Z",
    });
    expect(history.event).toBe("stage.evaluated");
    expect(history.detail).toMatchObject({ stage: 0, satisfied: 3, evaluated: 4 });
    expect(trend.compliance).toBe(0.75);
    expect(trend.at).toBe("2026-09-26T00:00:00.000Z");
  });

  it("treats an empty stage as fully compliant", () => {
    const { trend } = buildEvaluationRecords({
      baselineId: "bl-1",
      tenantId: "contoso",
      stage: 0,
      satisfied: 0,
      evaluated: 0,
      state: "complete",
    });
    expect(trend.compliance).toBe(1);
  });
});

describe("sampleTrendCompliance (T-0188)", () => {
  it("returns the satisfied share", () => {
    expect(
      sampleTrendCompliance([{ satisfied: true }, { satisfied: false }, { satisfied: true }]),
    ).toBeCloseTo(2 / 3);
    expect(sampleTrendCompliance([])).toBe(1);
  });
});

describe("retention (T-0188)", () => {
  it("prunes only rows older than the configured window", () => {
    const cutoff = historyRetentionCutoff(30, new Date("2026-09-26T00:00:00.000Z"));
    expect(isHistoryPrunable("2026-08-01T00:00:00.000Z", cutoff)).toBe(true);
    expect(isHistoryPrunable("2026-09-20T00:00:00.000Z", cutoff)).toBe(false);
  });

  it("rejects a negative window", () => {
    expect(() => historyRetentionCutoff(-1)).toThrowError(/non-negative/);
  });
});
