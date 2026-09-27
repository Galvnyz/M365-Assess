import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AssessmentExportError, findingsFromAssessmentExport } from "./findings-import.js";

// Written by Export-AssessmentBridgeJson; its Pester test keeps this file in step.
const FIXTURE = readFileSync(fileURLToPath(new URL("./fixtures/assessment-bridge.json", import.meta.url)), "utf8");
const target = { tenantId: "t-a", runId: "run-1", now: "2026-09-27T00:00:00.000Z" };

describe("findings from the assessment export (T-0833)", () => {
  it("maps each exported finding to a finding row", () => {
    const { findings } = findingsFromAssessmentExport(FIXTURE, target);
    expect(findings).toHaveLength(4);
    expect(findings[0]).toEqual({
      id: "run-1:0",
      runId: "run-1",
      tenantId: "t-a",
      checkId: "CA-REPORTONLY-001.1",
      controlName: "Report-only policies",
      category: "Conditional Access",
      collector: "Entra",
      status: "Warning",
      severity: "High",
      currentValue: "2 report-only",
      recommendedValue: "0 report-only",
      evidence: { remediation: "Move report-only policies to enabled.", effort: "medium", section: "Identity" },
      frameworkRefs: ["cis-m365-v6"],
      remediationMode: null,
      createdAt: target.now,
      updatedAt: target.now,
    });
    expect(findings[1]!.frameworkRefs).toEqual(["cis-m365-v6", "nist-800-53"]);
    expect(findings[2]).toMatchObject({ severity: "Critical", frameworkRefs: [] });
  });

  it("counts findings by status", () => {
    expect(findingsFromAssessmentExport(FIXTURE, target).summaryCounts).toEqual({
      pass: 1,
      fail: 1,
      warning: 1,
      review: 1,
      info: 0,
      skipped: 0,
      total: 4,
    });
  });

  it("reads older exports: a byte order mark, bare single items, and no descriptive fields", () => {
    const old = '﻿{"findings": {"checkId": "X-001.1", "status": "Pass", "severity": "medium", "frameworks": "cis-m365-v6", "currentValue": "on", "remediation": ""}}';
    const { findings, summaryCounts } = findingsFromAssessmentExport(old, target);
    expect(findings).toEqual([
      expect.objectContaining({ checkId: "X-001.1", controlName: null, category: null, frameworkRefs: ["cis-m365-v6"], evidence: null }),
    ]);
    expect(summaryCounts.total).toBe(1);
    expect(findingsFromAssessmentExport('{"findings": []}', target).findings).toEqual([]);
  });

  it("refuses output that is not a complete export", () => {
    expect(() => findingsFromAssessmentExport("<html>", target)).toThrow(AssessmentExportError);
    expect(() => findingsFromAssessmentExport('{"tenantId": "t"}', target)).toThrow(/no findings list/);
    expect(() => findingsFromAssessmentExport('{"findings": [{"status": "Pass"}]}', target)).toThrow(/no check id/);
    expect(() => findingsFromAssessmentExport('{"findings": [{"checkId": "X", "status": "Maybe"}]}', target)).toThrow(/unknown status/);
  });
});
