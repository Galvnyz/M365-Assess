// Findings from an assessment's bridge export, `_Assessment*.json` (T-0833).
//
// The export is the assessment's one machine-readable list of check results
// (Export-AssessmentBridgeJson.ps1). This module turns it into finding rows plus the
// run's summary counts. It lives here rather than in the BFF, which must not read
// check-level output itself (the BFF's thin-backend guard).
import type { FindingInput, FindingStatus, Severity } from "./repository.js";

export class AssessmentExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssessmentExportError";
  }
}

export interface ImportedFindings {
  readonly findings: FindingInput[];
  /** Counts by status in the shape the run detail route reads, plus the total. */
  readonly summaryCounts: {
    pass: number;
    fail: number;
    warning: number;
    review: number;
    info: number;
    skipped: number;
    total: number;
  };
}

const STATUSES: ReadonlySet<string> = new Set<FindingStatus>(["Pass", "Fail", "Warning", "Review", "Info", "Skipped"]);

const SEVERITIES: Readonly<Record<string, Severity>> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
  informational: "Info",
};

const COUNT_KEY: Readonly<Record<FindingStatus, keyof ImportedFindings["summaryCounts"]>> = {
  Pass: "pass",
  Fail: "fail",
  Warning: "warning",
  Review: "review",
  Info: "info",
  Skipped: "skipped",
};

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s === "" ? null : s;
}

// ConvertTo-Json writes a one-item array as the bare item in older exports.
function strings(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === "string" && v !== "");
}

/**
 * Parses the export's JSON text. Throws AssessmentExportError when the file is not an
 * export, or a finding has no check or an unknown status, so a run is never shown
 * with silently dropped results.
 */
export function findingsFromAssessmentExport(
  json: string,
  target: { readonly tenantId: string; readonly runId: string; readonly now?: string },
): ImportedFindings {
  let parsed: unknown;
  try {
    // PowerShell writes UTF-8 with a byte order mark.
    parsed = JSON.parse(json.replace(/^﻿/, ""));
  } catch (error) {
    throw new AssessmentExportError(`assessment export is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || !("findings" in parsed)) {
    throw new AssessmentExportError("assessment export has no findings list");
  }
  const raw = (parsed as { findings: unknown }).findings;
  const rows = raw === null ? [] : Array.isArray(raw) ? raw : [raw];

  const now = target.now ?? new Date().toISOString();
  const summaryCounts = { pass: 0, fail: 0, warning: 0, review: 0, info: 0, skipped: 0, total: 0 };
  const findings = rows.map((row: unknown, index): FindingInput => {
    const r = (typeof row === "object" && row !== null ? row : {}) as Record<string, unknown>;
    const check = text(r["checkId"]);
    if (!check) throw new AssessmentExportError(`assessment export finding ${index} has no check id`);
    const status = r["status"];
    if (typeof status !== "string" || !STATUSES.has(status)) {
      throw new AssessmentExportError(`assessment export finding ${check} has unknown status ${JSON.stringify(status)}`);
    }
    summaryCounts[COUNT_KEY[status as FindingStatus]] += 1;
    summaryCounts.total += 1;

    const remediation = text(r["remediation"]);
    const effort = text(r["effort"]);
    const section = text(r["section"]);
    const evidence: Record<string, unknown> = {};
    if (remediation) evidence["remediation"] = remediation;
    if (effort) evidence["effort"] = effort;
    if (section) evidence["section"] = section;

    return {
      id: `${target.runId}:${index}`,
      runId: target.runId,
      tenantId: target.tenantId,
      checkId: check,
      controlName: text(r["setting"]),
      category: text(r["category"]),
      collector: text(r["collector"]),
      status: status as FindingStatus,
      severity: SEVERITIES[String(r["severity"] ?? "").toLowerCase()] ?? null,
      currentValue: text(r["currentValue"]),
      recommendedValue: text(r["recommendedValue"]),
      evidence: Object.keys(evidence).length > 0 ? evidence : null,
      frameworkRefs: strings(r["frameworks"]),
      remediationMode: null,
      createdAt: now,
      updatedAt: now,
    };
  });
  return { findings, summaryCounts };
}
