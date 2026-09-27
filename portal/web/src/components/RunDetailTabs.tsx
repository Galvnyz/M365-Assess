"use client";

// Run detail tabs component (EPIC-003 SPEC.md §3.3, §4.3, §4.4, T-0052).
// Renders all five tabs: Progress, Summary, Findings, Artifacts, and Issues.
// Supports status-gated Cancel and Retry actions, artifact downloads via T-0048,
// and progress streaming. Report theme tokens only with zero colour literals.

import React, { useState, useMemo, useCallback, type CSSProperties, type ReactElement } from "react";
import { useRunEvents } from "../lib/useRunEvents";
import type { ProgressEvent } from "@m365-assess/contracts/events";

export type RunDetailTabId = "progress" | "summary" | "findings" | "artifacts" | "issues";

export interface RunSectionDetail {
  readonly id?: string;
  readonly runId?: string;
  readonly tenantId?: string;
  readonly section: string;
  readonly collector?: string | null;
  readonly status: string;
  readonly startedAt?: string | null;
  readonly finishedAt?: string | null;
  readonly completed?: number;
  readonly total?: number;
  readonly message?: string;
  readonly checks?: readonly { id: string; message: string; at?: string }[];
}

export interface RunFindingDetail {
  readonly id: string;
  readonly runId: string;
  readonly tenantId: string;
  readonly status: string; // Pass, Fail, Warning, Review, Skipped, NotLicensed
  readonly severity?: string | null; // Critical, High, Medium, Low
  readonly category?: string | null;
  readonly collector?: string | null;
  readonly controlName?: string | null;
  readonly currentValue?: string | null;
  readonly recommendedValue?: string | null;
  readonly frameworkRefs?: readonly string[];
  readonly [key: string]: unknown;
}

export interface RunArtifactDetail {
  readonly name: string;
  readonly path?: string;
  readonly contentType: string;
  readonly size: number;
  readonly redacted?: boolean;
  readonly isRedacted?: boolean;
  readonly extension?: string;
  readonly mtime?: string;
}

export interface RunIssueDetail {
  readonly id?: string;
  readonly timestamp?: string;
  readonly level?: "INFO" | "WARNING" | "ERROR" | string;
  readonly section?: string | null;
  readonly collector?: string | null;
  readonly message: string;
  readonly exception?: string | null;
}

export interface RunSummaryCounts {
  readonly pass: number;
  readonly fail: number;
  readonly warning: number;
  readonly review: number;
  readonly skipped: number;
  readonly notLicensed: number;
  readonly total: number;
}

export interface RunDetailData {
  readonly id: string;
  readonly tenantId: string;
  readonly tenantDisplayName?: string | null;
  readonly parentRunId?: string | null;
  readonly trigger: string;
  readonly status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "partial" | string;
  readonly startedAt?: string | null;
  readonly finishedAt?: string | null;
  readonly sections?: readonly RunSectionDetail[];
  readonly summaryCounts?: RunSummaryCounts | null;
  readonly options?: Record<string, unknown> | null;
  readonly artifactPath?: string | null;
  readonly children?: readonly RunDetailData[];
}

export interface RunDetailTabsProps {
  /** Run details */
  readonly run: RunDetailData;
  /** Finding records from /v1/runs/:runId/results */
  readonly findings?: readonly RunFindingDetail[];
  /** Artifacts from /v1/runs/:runId/artifacts */
  readonly artifacts?: readonly RunArtifactDetail[];
  /** Issue log from /v1/runs/:runId/results */
  readonly issues?: readonly RunIssueDetail[];
  /** Controlled active tab */
  readonly activeTab?: RunDetailTabId;
  /** Active tab change callback */
  readonly onTabChange?: (tab: RunDetailTabId) => void;
  /** Default active tab */
  readonly defaultTab?: RunDetailTabId;
  /** Cancel action handler */
  readonly onCancel?: (runId: string) => void | Promise<void>;
  /** Retry action handler */
  readonly onRetry?: (runId: string) => void | Promise<void>;
  /** Artifact download handler */
  readonly onDownloadArtifact?: (runId: string, artifactName: string) => void | Promise<void>;
  /** Whether to stream live progress events */
  readonly streamEvents?: boolean;
  /** Base API URL */
  readonly baseUrl?: string;
  /** Custom class name */
  readonly className?: string;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTimestamp(isoString?: string | null): string {
  if (!isoString) return "—";
  try {
    return new Date(isoString).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return isoString;
  }
}

export function isRunCancellable(status: string): boolean {
  const s = status.toLowerCase();
  return s === "queued" || s === "running";
}

export function isRunRetryable(status: string, summaryCounts?: RunSummaryCounts | null): boolean {
  const s = status.toLowerCase();
  if (s === "failed" || s === "partial") return true;
  if (s === "succeeded" && summaryCounts && summaryCounts.fail > 0) return true;
  return false;
}

export function calculateComplianceScore(summaryCounts?: RunSummaryCounts | null): number {
  if (!summaryCounts) return 0;
  const evaluated = summaryCounts.pass + summaryCounts.fail + (summaryCounts.warning || 0);
  if (evaluated <= 0) {
    return summaryCounts.pass > 0 ? 100 : 0;
  }
  return Math.round((summaryCounts.pass / evaluated) * 100);
}

export function RunDetailTabs(props: RunDetailTabsProps): ReactElement {
  const {
    run: initialRun,
    findings = [],
    artifacts = [],
    issues = [],
    activeTab: controlledTab,
    onTabChange,
    defaultTab = "summary",
    onCancel,
    onRetry,
    onDownloadArtifact,
    streamEvents = true,
    baseUrl = "",
    className,
  } = props;

  const [internalTab, setInternalTab] = useState<RunDetailTabId>(defaultTab);
  const currentTab = controlledTab !== undefined ? controlledTab : internalTab;

  const handleSelectTab = useCallback(
    (tab: RunDetailTabId) => {
      if (controlledTab === undefined) {
        setInternalTab(tab);
      }
      onTabChange?.(tab);
    },
    [controlledTab, onTabChange]
  );

  const [run, setRun] = useState<RunDetailData>(initialRun);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [findingSearch, setFindingSearch] = useState("");
  const [findingStatusFilter, setFindingStatusFilter] = useState("all");

  React.useEffect(() => {
    setRun(initialRun);
  }, [initialRun]);

  // Handle live progress events if stream is active and run is running
  const handleProgressEvent = useCallback((event: ProgressEvent) => {
    if (event.runId !== initialRun.id) return;

    setRun((prev) => {
      const nextRun = { ...prev, status: event.state };
      if (event.section) {
        const sections = Array.from(prev.sections || []);
        const sIdx = sections.findIndex((s) => s.section === event.section);
        const checkItem = event.message
          ? { id: event.eventId, message: event.message, at: event.at }
          : undefined;

        if (sIdx >= 0) {
          const s = sections[sIdx];
          sections[sIdx] = {
            ...s,
            status: event.sectionState || s.status,
            completed: event.completed ?? s.completed,
            total: event.total ?? s.total,
            message: event.message ?? s.message,
            checks: checkItem ? [...(s.checks || []), checkItem] : s.checks,
          };
        } else {
          sections.push({
            section: event.section,
            status: event.sectionState || "running",
            completed: event.completed,
            total: event.total,
            message: event.message,
            checks: checkItem ? [checkItem] : [],
          });
        }
        nextRun.sections = sections;
      }
      return nextRun;
    });
  }, [initialRun.id]);

  useRunEvents({
    runId: run.id,
    enabled: streamEvents && isRunCancellable(run.status),
    baseUrl,
    onEvent: handleProgressEvent,
  });

  const toggleSection = (sectionName: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [sectionName]: !prev[sectionName],
    }));
  };

  const handleCancel = async () => {
    if (!onCancel || cancelling) return;
    setCancelling(true);
    try {
      await onCancel(run.id);
    } finally {
      setCancelling(false);
    }
  };

  const handleRetry = async () => {
    if (!onRetry || retrying) return;
    setRetrying(true);
    try {
      await onRetry(run.id);
    } finally {
      setRetrying(false);
    }
  };

  const cancellable = isRunCancellable(run.status);
  const retryable = isRunRetryable(run.status, run.summaryCounts);
  const complianceScore = calculateComplianceScore(run.summaryCounts);

  // Framework rollups calculated from findings
  const frameworkRollup = useMemo(() => {
    const map = new Map<string, { total: number; pass: number }>();
    for (const f of findings) {
      const frameworks = f.frameworkRefs && f.frameworkRefs.length > 0 ? f.frameworkRefs : ["Default Baseline"];
      const isPass = f.status.toLowerCase() === "pass";
      for (const fw of frameworks) {
        const curr = map.get(fw) || { total: 0, pass: 0 };
        curr.total += 1;
        if (isPass) curr.pass += 1;
        map.set(fw, curr);
      }
    }
    return Array.from(map.entries()).map(([framework, stat]) => ({
      framework,
      total: stat.total,
      pass: stat.pass,
      percentage: stat.total > 0 ? Math.round((stat.pass / stat.total) * 100) : 0,
    }));
  }, [findings]);

  // Filtered findings list
  const filteredFindings = useMemo(() => {
    return findings.filter((f) => {
      const matchSearch =
        findingSearch.trim() === "" ||
        (f.controlName && f.controlName.toLowerCase().includes(findingSearch.toLowerCase())) ||
        (f.category && f.category.toLowerCase().includes(findingSearch.toLowerCase()));
      const matchStatus =
        findingStatusFilter === "all" || f.status.toLowerCase() === findingStatusFilter.toLowerCase();
      return matchSearch && matchStatus;
    });
  }, [findings, findingSearch, findingStatusFilter]);

  return (
    <div
      className={className}
      data-testid="run-detail-tabs-root"
      style={{
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        color: "var(--text)",
        display: "flex",
        flexDirection: "column",
        gap: "24px",
      }}
    >
      {/* Header Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: "16px",
          paddingBottom: "16px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "6px" }}>
            <h1
              style={{
                margin: 0,
                fontSize: "24px",
                fontWeight: 700,
                fontFamily: "var(--font-display, var(--font-sans))",
              }}
            >
              {run.tenantDisplayName || run.tenantId}
            </h1>
            <span
              data-testid="run-detail-status-badge"
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "2px 10px",
                borderRadius: "999px",
                fontSize: "12px",
                fontWeight: 600,
                textTransform: "capitalize",
                background:
                  run.status === "succeeded"
                    ? "var(--success-soft)"
                    : run.status === "failed"
                      ? "var(--danger-soft)"
                      : run.status === "running"
                        ? "var(--accent-soft)"
                        : "var(--surface)",
                color:
                  run.status === "succeeded"
                    ? "var(--success-text)"
                    : run.status === "failed"
                      ? "var(--danger-text)"
                      : run.status === "running"
                        ? "var(--accent-text)"
                        : "var(--text-soft)",
                border:
                  run.status === "succeeded"
                    ? "1px solid var(--success)"
                    : run.status === "failed"
                      ? "1px solid var(--danger)"
                      : run.status === "running"
                        ? "1px solid var(--accent)"
                        : "1px solid var(--border)",
              }}
            >
              {run.status}
            </span>
          </div>

          <div
            style={{
              fontSize: "13px",
              color: "var(--muted)",
              display: "flex",
              flexWrap: "wrap",
              gap: "16px",
            }}
          >
            <span>
              <strong>Run ID:</strong> <code style={{ fontFamily: "var(--font-mono, monospace)" }}>{run.id}</code>
            </span>
            <span>
              <strong>Trigger:</strong> {run.trigger}
            </span>
            <span>
              <strong>Started:</strong> {formatTimestamp(run.startedAt)}
            </span>
            <span>
              <strong>Finished:</strong> {formatTimestamp(run.finishedAt)}
            </span>
          </div>
        </div>

        {/* Action Buttons: Cancel and Retry */}
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {cancellable && onCancel && (
            <button
              type="button"
              data-testid="detail-cancel-button"
              onClick={handleCancel}
              disabled={cancelling}
              style={{
                padding: "8px 16px",
                fontSize: "13px",
                fontWeight: 600,
                background: "var(--danger-soft)",
                color: "var(--danger-text)",
                border: "1px solid var(--danger)",
                borderRadius: "var(--radius, 6px)",
                cursor: cancelling ? "not-allowed" : "pointer",
                opacity: cancelling ? 0.6 : 1,
              }}
            >
              {cancelling ? "Cancelling..." : "Cancel Run"}
            </button>
          )}

          {retryable && onRetry && (
            <button
              type="button"
              data-testid="detail-retry-button"
              onClick={handleRetry}
              disabled={retrying}
              style={{
                padding: "8px 16px",
                fontSize: "13px",
                fontWeight: 600,
                background: "var(--accent-soft)",
                color: "var(--accent-text)",
                border: "1px solid var(--accent)",
                borderRadius: "var(--radius, 6px)",
                cursor: retrying ? "not-allowed" : "pointer",
                opacity: retrying ? 0.6 : 1,
              }}
            >
              {retrying ? "Retrying..." : "Retry Failed"}
            </button>
          )}
        </div>
      </div>

      {/* Tabs Navigation */}
      <div
        role="tablist"
        aria-label="Run Detail Tabs"
        style={{
          display: "flex",
          gap: "8px",
          borderBottom: "1px solid var(--border)",
          paddingBottom: "2px",
        }}
      >
        {(
          [
            { id: "summary", label: "Summary" },
            { id: "progress", label: "Progress" },
            { id: "findings", label: `Findings (${findings.length})` },
            { id: "artifacts", label: `Artifacts (${artifacts.length})` },
            { id: "issues", label: `Issues (${issues.length})` },
          ] as const
        ).map((tab) => {
          const isActive = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              id={`tab-${tab.id}`}
              data-testid={`tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.id}`}
              onClick={() => handleSelectTab(tab.id)}
              style={{
                padding: "8px 16px",
                fontSize: "14px",
                fontWeight: 600,
                color: isActive ? "var(--accent-text)" : "var(--muted)",
                background: isActive ? "var(--accent-soft)" : "transparent",
                border: "none",
                borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                borderRadius: "var(--radius, 6px) var(--radius, 6px) 0 0",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* TAB PANEL 1: Summary */}
      {currentTab === "summary" && (
        <div
          role="tabpanel"
          id="tabpanel-summary"
          aria-labelledby="tab-summary"
          data-testid="tabpanel-summary"
          style={{ display: "flex", flexDirection: "column", gap: "24px" }}
        >
          {/* Top Row: Score Card + KPI Strip */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "240px 1fr",
              gap: "20px",
              alignItems: "stretch",
            }}
          >
            {/* Score Card */}
            <div
              data-testid="summary-score-card"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius, 10px)",
                padding: "20px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                textAlign: "center",
                boxShadow: "var(--shadow-card)",
              }}
            >
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  marginBottom: "8px",
                }}
              >
                Compliance Score
              </div>
              <div
                data-testid="score-card-hero"
                style={{
                  fontSize: "52px",
                  fontWeight: 800,
                  lineHeight: 1,
                  background: "var(--accent-grad, var(--accent))",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  color: "var(--accent)",
                  fontFamily: "var(--font-display, var(--font-sans))",
                  margin: "8px 0",
                }}
              >
                {complianceScore}%
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-soft)" }}>
                {run.summaryCounts?.pass ?? 0} pass / {run.summaryCounts?.total ?? 0} total checks
              </div>
            </div>

            {/* KPI Strip */}
            <div
              className="kpi-strip"
              data-testid="kpi-strip"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(6, 1fr)",
                gap: "12px",
              }}
            >
              {[
                {
                  label: "Pass",
                  count: run.summaryCounts?.pass ?? 0,
                  bg: "var(--success-soft)",
                  color: "var(--success-text)",
                  border: "var(--success)",
                  testId: "kpi-pass",
                },
                {
                  label: "Fail",
                  count: run.summaryCounts?.fail ?? 0,
                  bg: "var(--danger-soft)",
                  color: "var(--danger-text)",
                  border: "var(--danger)",
                  testId: "kpi-fail",
                },
                {
                  label: "Warning",
                  count: run.summaryCounts?.warning ?? 0,
                  bg: "var(--warn-soft)",
                  color: "var(--warn-text)",
                  border: "var(--warn)",
                  testId: "kpi-warning",
                },
                {
                  label: "Review",
                  count: run.summaryCounts?.review ?? 0,
                  bg: "var(--accent-soft)",
                  color: "var(--accent-text)",
                  border: "var(--accent)",
                  testId: "kpi-review",
                },
                {
                  label: "Skipped",
                  count: run.summaryCounts?.skipped ?? 0,
                  bg: "var(--surface)",
                  color: "var(--muted)",
                  border: "var(--border)",
                  testId: "kpi-skipped",
                },
                {
                  label: "Not Licensed",
                  count: run.summaryCounts?.notLicensed ?? 0,
                  bg: "var(--surface)",
                  color: "var(--accent-text)",
                  border: "var(--border)",
                  testId: "kpi-not-licensed",
                },
              ].map((kpi) => (
                <div
                  key={kpi.label}
                  data-testid={kpi.testId}
                  style={{
                    background: kpi.bg,
                    border: `1px solid ${kpi.border}`,
                    borderRadius: "var(--radius, 8px)",
                    padding: "16px 12px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      fontSize: "24px",
                      fontWeight: 700,
                      color: kpi.color,
                      lineHeight: 1.2,
                    }}
                  >
                    {kpi.count}
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: kpi.color,
                      marginTop: "4px",
                    }}
                  >
                    {kpi.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Framework Rollup */}
          <div
            data-testid="framework-rollup"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius, 10px)",
              padding: "20px",
            }}
          >
            <h3 style={{ margin: "0 0 16px 0", fontSize: "16px", fontWeight: 600 }}>Framework Rollup</h3>
            {frameworkRollup.length === 0 ? (
              <div style={{ color: "var(--muted)", fontSize: "13px" }}>
                No framework compliance data available for this run.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {frameworkRollup.map((fw) => (
                  <div key={fw.framework}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: "13px",
                        fontWeight: 500,
                        marginBottom: "4px",
                      }}
                    >
                      <span>{fw.framework}</span>
                      <span>
                        {fw.pass} / {fw.total} passed ({fw.percentage}%)
                      </span>
                    </div>
                    <div
                      style={{
                        height: "8px",
                        background: "var(--track)",
                        borderRadius: "999px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${fw.percentage}%`,
                          background: "var(--accent)",
                          boxShadow: "var(--bar-glow)",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB PANEL 2: Progress */}
      {currentTab === "progress" && (
        <div
          role="tabpanel"
          id="tabpanel-progress"
          aria-labelledby="tab-progress"
          data-testid="tabpanel-progress"
          style={{ display: "flex", flexDirection: "column", gap: "16px" }}
        >
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius, 10px)",
              padding: "20px",
            }}
          >
            <h3 style={{ margin: "0 0 16px 0", fontSize: "16px", fontWeight: 600 }}>
              Section Progress ({run.sections?.length ?? 0} sections)
            </h3>

            {!run.sections || run.sections.length === 0 ? (
              <div style={{ color: "var(--muted)", fontSize: "14px" }}>No section progress recorded yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {run.sections.map((sec) => {
                  const isExpanded = !!expandedSections[sec.section];
                  const hasChecks = sec.checks && sec.checks.length > 0;

                  return (
                    <div
                      key={sec.section}
                      data-testid={`progress-section-${sec.section}`}
                      style={{
                        background: "var(--bg-elev)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius, 8px)",
                        padding: "12px 16px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <div>
                          <span style={{ fontWeight: 600, fontSize: "14px", color: "var(--text)" }}>
                            {sec.section}
                          </span>
                          {sec.message && (
                            <div style={{ fontSize: "12px", color: "var(--text-soft)", marginTop: "2px" }}>
                              {sec.message}
                            </div>
                          )}
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <span
                            style={{
                              padding: "2px 8px",
                              borderRadius: "999px",
                              fontSize: "12px",
                              fontWeight: 600,
                              textTransform: "capitalize",
                              background:
                                sec.status === "succeeded"
                                  ? "var(--success-soft)"
                                  : sec.status === "failed"
                                    ? "var(--danger-soft)"
                                    : sec.status === "running"
                                      ? "var(--accent-soft)"
                                      : "var(--surface)",
                              color:
                                sec.status === "succeeded"
                                  ? "var(--success-text)"
                                  : sec.status === "failed"
                                    ? "var(--danger-text)"
                                    : sec.status === "running"
                                      ? "var(--accent-text)"
                                      : "var(--muted)",
                              border:
                                sec.status === "succeeded"
                                  ? "1px solid var(--success)"
                                  : sec.status === "failed"
                                    ? "1px solid var(--danger)"
                                    : sec.status === "running"
                                      ? "1px solid var(--accent)"
                                      : "1px solid var(--border)",
                            }}
                          >
                            {sec.status}
                          </span>

                          {hasChecks && (
                            <button
                              type="button"
                              data-testid={`toggle-checks-${sec.section}`}
                              onClick={() => toggleSection(sec.section)}
                              aria-expanded={isExpanded}
                              style={{
                                background: "transparent",
                                border: "none",
                                color: "var(--accent-text)",
                                fontSize: "12px",
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              {isExpanded ? "Hide checks" : `Checks (${sec.checks!.length})`}
                            </button>
                          )}
                        </div>
                      </div>

                      {isExpanded && hasChecks && (
                        <ul
                          data-testid={`checks-list-${sec.section}`}
                          style={{
                            marginTop: "10px",
                            paddingTop: "8px",
                            borderTop: "1px dashed var(--border)",
                            listStyle: "none",
                            paddingLeft: 0,
                            margin: "10px 0 0 0",
                            display: "flex",
                            flexDirection: "column",
                            gap: "6px",
                          }}
                        >
                          {sec.checks!.map((c) => (
                            <li
                              key={c.id}
                              style={{
                                fontSize: "12px",
                                color: "var(--text-soft)",
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                              }}
                            >
                              <span style={{ color: "var(--accent)", fontSize: "8px" }}>●</span>
                              <span>{c.message}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB PANEL 3: Findings */}
      {currentTab === "findings" && (
        <div
          role="tabpanel"
          id="tabpanel-findings"
          aria-labelledby="tab-findings"
          data-testid="tabpanel-findings"
          style={{ display: "flex", flexDirection: "column", gap: "16px" }}
        >
          {/* Controls: Search and Status filter */}
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <input
              type="text"
              placeholder="Search findings by control or category..."
              data-testid="findings-search-input"
              value={findingSearch}
              onChange={(e) => setFindingSearch(e.target.value)}
              style={{
                flex: 1,
                padding: "8px 12px",
                background: "var(--input-bg, var(--surface))",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius, 6px)",
                color: "var(--text)",
                fontSize: "14px",
              }}
            />
            <select
              data-testid="findings-status-filter"
              value={findingStatusFilter}
              onChange={(e) => setFindingStatusFilter(e.target.value)}
              style={{
                padding: "8px 12px",
                background: "var(--input-bg, var(--surface))",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius, 6px)",
                color: "var(--text)",
                fontSize: "14px",
              }}
            >
              <option value="all">All statuses</option>
              <option value="fail">Fail</option>
              <option value="pass">Pass</option>
              <option value="warning">Warning</option>
              <option value="review">Review</option>
              <option value="skipped">Skipped</option>
            </select>
          </div>

          {/* Findings Table */}
          {filteredFindings.length === 0 ? (
            <div
              data-testid="findings-empty"
              style={{
                padding: "36px",
                textAlign: "center",
                color: "var(--muted)",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius, 8px)",
              }}
            >
              No findings recorded for this run.
            </div>
          ) : (
            <div
              style={{
                overflowX: "auto",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius, 8px)",
                background: "var(--surface)",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elev)" }}>
                    <th style={{ padding: "10px 14px", textAlign: "left" }}>Status</th>
                    <th style={{ padding: "10px 14px", textAlign: "left" }}>Severity</th>
                    <th style={{ padding: "10px 14px", textAlign: "left" }}>Control</th>
                    <th style={{ padding: "10px 14px", textAlign: "left" }}>Category</th>
                    <th style={{ padding: "10px 14px", textAlign: "left" }}>Values</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFindings.map((finding) => (
                    <tr
                      key={finding.id}
                      data-testid={`finding-row-${finding.id}`}
                      style={{ borderBottom: "1px solid var(--border)" }}
                    >
                      <td style={{ padding: "10px 14px" }}>
                        <span
                          style={{
                            padding: "2px 6px",
                            borderRadius: "999px",
                            fontSize: "11px",
                            fontWeight: 600,
                            textTransform: "capitalize",
                            background:
                              finding.status.toLowerCase() === "pass"
                                ? "var(--success-soft)"
                                : finding.status.toLowerCase() === "fail"
                                  ? "var(--danger-soft)"
                                  : "var(--warn-soft)",
                            color:
                              finding.status.toLowerCase() === "pass"
                                ? "var(--success-text)"
                                : finding.status.toLowerCase() === "fail"
                                  ? "var(--danger-text)"
                                  : "var(--warn-text)",
                            border:
                              finding.status.toLowerCase() === "pass"
                                ? "1px solid var(--success)"
                                : finding.status.toLowerCase() === "fail"
                                  ? "1px solid var(--danger)"
                                  : "1px solid var(--warn)",
                          }}
                        >
                          {finding.status}
                        </span>
                      </td>
                      <td style={{ padding: "10px 14px", fontWeight: 600, color: "var(--text-soft)" }}>
                        {finding.severity || "—"}
                      </td>
                      <td style={{ padding: "10px 14px", fontWeight: 500, color: "var(--text)" }}>
                        {finding.controlName || finding.id}
                      </td>
                      <td style={{ padding: "10px 14px", color: "var(--muted)" }}>
                        {finding.category || "General"}
                      </td>
                      <td style={{ padding: "10px 14px", color: "var(--text-soft)", fontSize: "12px" }}>
                        {finding.currentValue && <div>Current: {finding.currentValue}</div>}
                        {finding.recommendedValue && <div>Expected: {finding.recommendedValue}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB PANEL 4: Artifacts */}
      {currentTab === "artifacts" && (
        <div
          role="tabpanel"
          id="tabpanel-artifacts"
          aria-labelledby="tab-artifacts"
          data-testid="tabpanel-artifacts"
          style={{ display: "flex", flexDirection: "column", gap: "16px" }}
        >
          {artifacts.length === 0 ? (
            <div
              data-testid="artifacts-empty"
              style={{
                padding: "36px",
                textAlign: "center",
                color: "var(--muted)",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius, 8px)",
              }}
            >
              No artifacts published for this run.
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                gap: "16px",
              }}
            >
              {artifacts.map((artifact) => {
                const isRedacted = artifact.isRedacted || artifact.redacted;
                const downloadUrl = `${baseUrl}/v1/runs/${encodeURIComponent(run.id)}/artifacts/${encodeURIComponent(artifact.name)}`;

                return (
                  <div
                    key={artifact.name}
                    data-testid={`artifact-card-${artifact.name}`}
                    style={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius, 8px)",
                      padding: "16px",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      gap: "12px",
                      boxShadow: "var(--shadow-card)",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginBottom: "4px",
                        }}
                      >
                        <span
                          style={{
                            fontWeight: 600,
                            fontSize: "14px",
                            color: "var(--text)",
                            wordBreak: "break-all",
                          }}
                        >
                          {artifact.name}
                        </span>
                        {isRedacted && (
                          <span
                            data-testid={`artifact-redacted-badge-${artifact.name}`}
                            style={{
                              padding: "1px 6px",
                              borderRadius: "999px",
                              fontSize: "11px",
                              fontWeight: 600,
                              background: "var(--accent-soft)",
                              color: "var(--accent-text)",
                              border: "1px solid var(--accent)",
                            }}
                          >
                            Redacted
                          </span>
                        )}
                      </div>

                      <div
                        style={{
                          fontSize: "12px",
                          color: "var(--muted)",
                          display: "flex",
                          flexDirection: "column",
                          gap: "2px",
                          fontFamily: "var(--font-mono, monospace)",
                        }}
                      >
                        <span data-testid={`artifact-content-type-${artifact.name}`}>
                          Type: {artifact.contentType}
                        </span>
                        <span>Size: {formatFileSize(artifact.size)}</span>
                      </div>
                    </div>

                    <a
                      href={downloadUrl}
                      download={artifact.name}
                      data-testid={`download-artifact-${artifact.name}`}
                      onClick={(e) => {
                        if (onDownloadArtifact) {
                          e.preventDefault();
                          void onDownloadArtifact(run.id, artifact.name);
                        }
                      }}
                      style={{
                        padding: "6px 12px",
                        fontSize: "13px",
                        fontWeight: 600,
                        background: "var(--accent)",
                        color: "var(--accent-text)",
                        border: "1px solid var(--accent)",
                        borderRadius: "var(--radius, 6px)",
                        textDecoration: "none",
                        textAlign: "center",
                        cursor: "pointer",
                        display: "inline-block",
                      }}
                    >
                      Download
                    </a>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB PANEL 5: Issues */}
      {currentTab === "issues" && (
        <div
          role="tabpanel"
          id="tabpanel-issues"
          aria-labelledby="tab-issues"
          data-testid="tabpanel-issues"
          style={{ display: "flex", flexDirection: "column", gap: "16px" }}
        >
          {issues.length === 0 ? (
            <div
              data-testid="issues-empty"
              style={{
                padding: "36px",
                textAlign: "center",
                color: "var(--muted)",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius, 8px)",
              }}
            >
              No issues or errors recorded for this run.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {issues.map((issue, idx) => (
                <div
                  key={issue.id || `issue-${idx}`}
                  data-testid={`issue-item-${idx}`}
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius, 8px)",
                    padding: "16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: "999px",
                          fontSize: "11px",
                          fontWeight: 700,
                          background:
                            issue.level === "ERROR"
                              ? "var(--danger-soft)"
                              : issue.level === "WARNING"
                                ? "var(--warn-soft)"
                                : "var(--surface)",
                          color:
                            issue.level === "ERROR"
                              ? "var(--danger-text)"
                              : issue.level === "WARNING"
                                ? "var(--warn-text)"
                                : "var(--text-soft)",
                          border:
                            issue.level === "ERROR"
                              ? "1px solid var(--danger)"
                              : issue.level === "WARNING"
                                ? "1px solid var(--warn)"
                                : "1px solid var(--border)",
                        }}
                      >
                        {issue.level || "ERROR"}
                      </span>
                      {issue.section && (
                        <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-soft)" }}>
                          Section: {issue.section}
                        </span>
                      )}
                    </div>
                    {issue.timestamp && (
                      <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                        {formatTimestamp(issue.timestamp)}
                      </span>
                    )}
                  </div>

                  <div style={{ fontSize: "14px", color: "var(--text)", fontWeight: 500 }}>
                    {issue.message}
                  </div>

                  {issue.exception && (
                    <pre
                      style={{
                        margin: "4px 0 0 0",
                        padding: "8px 12px",
                        background: "var(--bg-elev)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius, 6px)",
                        fontSize: "11px",
                        fontFamily: "var(--font-mono, monospace)",
                        color: "var(--danger-text)",
                        overflowX: "auto",
                      }}
                    >
                      {issue.exception}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
