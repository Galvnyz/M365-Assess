"use client";

// Runs table and list component (EPIC-003 SPEC.md §3.1, T-0049).
// Renders every §3.1 column, supports status/trigger/tenant/date-range/section filters,
// provides row actions (View, Cancel, Retry failed, Download artifacts, Compare to previous),
// supports card view for mobile, and strictly uses report theme tokens with zero colour literals.

import React, { useState, useMemo, type CSSProperties, type ReactElement } from "react";

export interface RunItemSummaryCounts {
  readonly pass: number;
  readonly fail: number;
  readonly warning?: number;
  readonly review?: number;
  readonly skipped?: number;
  readonly notLicensed?: number;
  readonly total?: number;
}

export interface RunItem {
  readonly id: string;
  readonly tenantId: string;
  readonly tenantDisplayName?: string | null;
  readonly parentRunId?: string | null;
  readonly trigger: "manual" | "schedule" | "api" | string;
  readonly sections: readonly string[];
  readonly options?: Record<string, unknown> | null;
  readonly startedAt?: string | null;
  readonly finishedAt?: string | null;
  readonly status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "partial" | string;
  readonly progress?: {
    readonly completed: number;
    readonly total: number;
    readonly percentage?: number;
  } | number | null;
  readonly summaryCounts?: RunItemSummaryCounts | null;
  readonly artifactPath?: string | null;
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly children?: readonly RunItem[];
}

export interface RunsTableProps {
  readonly runs?: readonly RunItem[];
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onView?: (run: RunItem) => void;
  readonly onCancel?: (run: RunItem) => void;
  readonly onRetry?: (run: RunItem) => void;
  readonly onDownloadArtifacts?: (run: RunItem) => void;
  readonly onCompare?: (run: RunItem) => void;
  readonly onNewRun?: () => void;
  readonly defaultViewMode?: "table" | "card";
}

export function formatDuration(startedAt?: string | null, finishedAt?: string | null): string {
  if (!startedAt) return "—";
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  if (isNaN(start) || isNaN(end) || end < start) return "—";
  const diffSec = Math.floor((end - start) / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

export function formatDateTime(isoString?: string | null): string {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

export function calculateProgressPercentage(run: RunItem): number {
  if (typeof run.progress === "number") {
    return Math.min(100, Math.max(0, run.progress));
  }
  if (run.progress && typeof run.progress === "object") {
    if (typeof run.progress.percentage === "number") {
      return Math.min(100, Math.max(0, run.progress.percentage));
    }
    if (run.progress.total > 0) {
      return Math.min(100, Math.max(0, Math.round((run.progress.completed / run.progress.total) * 100)));
    }
  }
  if (run.status === "succeeded") return 100;
  if (run.status === "queued") return 0;
  if (run.status === "running") return 50;
  return 100;
}

export function getStatusBadgeStyle(status: string): CSSProperties {
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "2px 8px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 600,
    textTransform: "capitalize",
    fontFamily: "var(--font-sans, system-ui, sans-serif)",
  };

  switch (status.toLowerCase()) {
    case "succeeded":
      return {
        ...base,
        background: "var(--success-soft)",
        color: "var(--success-text)",
        border: "1px solid var(--success)",
      };
    case "failed":
      return {
        ...base,
        background: "var(--danger-soft)",
        color: "var(--danger-text)",
        border: "1px solid var(--danger)",
      };
    case "running":
      return {
        ...base,
        background: "var(--accent-soft)",
        color: "var(--accent-text)",
        border: "1px solid var(--accent)",
      };
    case "queued":
      return {
        ...base,
        background: "var(--surface)",
        color: "var(--text-soft)",
        border: "1px solid var(--border)",
      };
    case "cancelled":
      return {
        ...base,
        background: "var(--surface)",
        color: "var(--text-soft)",
        border: "1px solid var(--border)",
      };
    case "partial":
      return {
        ...base,
        background: "var(--warning-soft)",
        color: "var(--warning-text)",
        border: "1px solid var(--warning)",
      };
    default:
      return {
        ...base,
        background: "var(--surface)",
        color: "var(--text)",
        border: "1px solid var(--border)",
      };
  }
}

// Styling definitions using report theme tokens only
const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  width: "100%",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
};

const headerBarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "12px",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "16px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
};

const filterRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
  alignItems: "center",
};

const inputStyle: CSSProperties = {
  padding: "8px 12px",
  background: "var(--input-bg, var(--bg))",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "14px",
};

const selectStyle: CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
};

const buttonStyle: CSSProperties = {
  padding: "8px 14px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "14px",
  fontWeight: 500,
  cursor: "pointer",
  transition: "background 0.2s ease",
};

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "var(--accent)",
  color: "var(--on-accent)",
  borderColor: "var(--accent)",
};

const tableWrapperStyle: CSSProperties = {
  overflowX: "auto",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  boxShadow: "var(--shadow-card)",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "14px",
  textAlign: "left",
};

const thStyle: CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text-soft)",
  fontWeight: 600,
  fontSize: "12px",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  whiteSpace: "nowrap",
};

const tdStyle: CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid var(--border)",
  color: "var(--text)",
  verticalAlign: "middle",
};

const monoStyle: CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  fontSize: "13px",
  color: "var(--text)",
};

const progressBarTrackStyle: CSSProperties = {
  width: "100px",
  height: "8px",
  borderRadius: "999px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  overflow: "hidden",
  position: "relative",
};

const progressBarStyle = (percent: number, status: string): CSSProperties => {
  let bg = "var(--accent)";
  if (status === "succeeded") bg = "var(--success)";
  else if (status === "failed") bg = "var(--danger)";
  else if (status === "cancelled") bg = "var(--text-soft)";
  else if (status === "partial") bg = "var(--warning)";

  return {
    width: `${Math.min(100, Math.max(0, percent))}%`,
    height: "100%",
    borderRadius: "999px",
    background: bg,
    boxShadow: "var(--bar-glow, 0 0 8px var(--accent))",
    transition: "width 0.3s ease",
  };
};

const actionBtnStyle: CSSProperties = {
  padding: "4px 8px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "4px",
  color: "var(--text)",
  fontSize: "12px",
  cursor: "pointer",
  whiteSpace: "nowrap",
  textDecoration: "none",
};

const disabledActionBtnStyle: CSSProperties = {
  ...actionBtnStyle,
  opacity: 0.4,
  cursor: "not-allowed",
  pointerEvents: "none",
};

const cardGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
  gap: "16px",
};

const cardStyle: CSSProperties = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  padding: "16px",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  boxShadow: "var(--shadow-card)",
};

export function RunsTable({
  runs = [],
  loading = false,
  error = null,
  onView,
  onCancel,
  onRetry,
  onDownloadArtifacts,
  onCompare,
  onNewRun,
  defaultViewMode = "table",
}: RunsTableProps): ReactElement {
  const [viewMode, setViewMode] = useState<"table" | "card">(defaultViewMode);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [triggerFilter, setTriggerFilter] = useState<string>("all");
  const [tenantFilter, setTenantFilter] = useState<string>("");
  const [sectionFilter, setSectionFilter] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const filteredRuns = useMemo(() => {
    return runs.filter((run) => {
      if (statusFilter !== "all" && run.status.toLowerCase() !== statusFilter.toLowerCase()) {
        return false;
      }
      if (triggerFilter !== "all" && run.trigger.toLowerCase() !== triggerFilter.toLowerCase()) {
        return false;
      }
      if (tenantFilter.trim()) {
        const query = tenantFilter.trim().toLowerCase();
        const matchesId = run.tenantId.toLowerCase().includes(query);
        const matchesName = (run.tenantDisplayName ?? "").toLowerCase().includes(query);
        if (!matchesId && !matchesName) return false;
      }
      if (sectionFilter.trim()) {
        const query = sectionFilter.trim().toLowerCase();
        const matchesSection = run.sections.some((s) => s.toLowerCase().includes(query));
        if (!matchesSection) return false;
      }
      if (fromDate) {
        const runTime = new Date(run.startedAt ?? run.createdAt).getTime();
        const fromTime = new Date(fromDate).getTime();
        if (!isNaN(runTime) && !isNaN(fromTime) && runTime < fromTime) {
          return false;
        }
      }
      if (toDate) {
        const runTime = new Date(run.startedAt ?? run.createdAt).getTime();
        const toTime = new Date(toDate).getTime() + 86400000; // end of day
        if (!isNaN(runTime) && !isNaN(toTime) && runTime > toTime) {
          return false;
        }
      }
      return true;
    });
  }, [runs, statusFilter, triggerFilter, tenantFilter, sectionFilter, fromDate, toDate]);

  return (
    <div style={containerStyle} data-testid="runs-table-container">
      {/* Header and Filter bar */}
      <div style={headerBarStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 600 }}>Runs</h2>
          <span
            style={{
              padding: "2px 8px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "999px",
              fontSize: "12px",
              color: "var(--text-soft)",
            }}
          >
            {filteredRuns.length} {filteredRuns.length === 1 ? "run" : "runs"}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {/* View mode toggle */}
          <div style={{ display: "flex", background: "var(--surface)", borderRadius: "6px", border: "1px solid var(--border)", padding: "2px" }}>
            <button
              type="button"
              aria-label="Table view"
              onClick={() => setViewMode("table")}
              style={{
                ...buttonStyle,
                border: "none",
                padding: "6px 12px",
                background: viewMode === "table" ? "var(--bg-elev)" : "transparent",
                color: viewMode === "table" ? "var(--accent)" : "var(--text-soft)",
              }}
            >
              Table
            </button>
            <button
              type="button"
              aria-label="Card view"
              onClick={() => setViewMode("card")}
              style={{
                ...buttonStyle,
                border: "none",
                padding: "6px 12px",
                background: viewMode === "card" ? "var(--bg-elev)" : "transparent",
                color: viewMode === "card" ? "var(--accent)" : "var(--text-soft)",
              }}
            >
              Cards
            </button>
          </div>

          {onNewRun && (
            <button
              type="button"
              style={primaryButtonStyle}
              onClick={onNewRun}
              data-testid="new-run-button"
            >
              New run
            </button>
          )}
        </div>
      </div>

      {/* Filter Row */}
      <div style={{ ...headerBarStyle, padding: "12px 16px" }}>
        <div style={filterRowStyle}>
          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={selectStyle}
            aria-label="Filter by status"
            data-testid="filter-status"
          >
            <option value="all">All statuses</option>
            <option value="queued">Queued</option>
            <option value="running">Running</option>
            <option value="succeeded">Succeeded</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
            <option value="partial">Partial</option>
          </select>

          {/* Trigger filter */}
          <select
            value={triggerFilter}
            onChange={(e) => setTriggerFilter(e.target.value)}
            style={selectStyle}
            aria-label="Filter by trigger"
            data-testid="filter-trigger"
          >
            <option value="all">All triggers</option>
            <option value="manual">Manual</option>
            <option value="schedule">Schedule</option>
            <option value="api">API</option>
          </select>

          {/* Tenant filter */}
          <input
            type="text"
            placeholder="Filter by tenant..."
            value={tenantFilter}
            onChange={(e) => setTenantFilter(e.target.value)}
            style={inputStyle}
            aria-label="Filter by tenant"
            data-testid="filter-tenant"
          />

          {/* Section filter */}
          <input
            type="text"
            placeholder="Filter by section..."
            value={sectionFilter}
            onChange={(e) => setSectionFilter(e.target.value)}
            style={inputStyle}
            aria-label="Filter by section"
            data-testid="filter-section"
          />

          {/* Date range */}
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            style={inputStyle}
            aria-label="From date"
            data-testid="filter-from-date"
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            style={inputStyle}
            aria-label="To date"
            data-testid="filter-to-date"
          />

          {(statusFilter !== "all" || triggerFilter !== "all" || tenantFilter || sectionFilter || fromDate || toDate) && (
            <button
              type="button"
              onClick={() => {
                setStatusFilter("all");
                setTriggerFilter("all");
                setTenantFilter("");
                setSectionFilter("");
                setFromDate("");
                setToDate("");
              }}
              style={{ ...buttonStyle, padding: "6px 12px" }}
              data-testid="clear-filters-button"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Loading & Error States */}
      {loading && (
        <div style={{ padding: "32px", textAlign: "center", color: "var(--text-soft)" }}>
          Loading assessment runs...
        </div>
      )}

      {error && (
        <div
          style={{
            padding: "16px",
            borderRadius: "6px",
            background: "var(--danger-soft)",
            border: "1px solid var(--danger)",
            color: "var(--danger-text)",
          }}
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && filteredRuns.length === 0 && (
        <div
          style={{
            padding: "48px 16px",
            textAlign: "center",
            background: "var(--bg-elev)",
            borderRadius: "var(--radius, 10px)",
            border: "1px solid var(--border)",
            color: "var(--text-soft)",
          }}
          data-testid="empty-runs-state"
        >
          No assessment runs found.
        </div>
      )}

      {/* Table View */}
      {!loading && !error && filteredRuns.length > 0 && viewMode === "table" && (
        <div style={tableWrapperStyle}>
          <table style={tableStyle} aria-label="Assessment runs">
            <thead>
              <tr>
                <th style={thStyle}>Run ID</th>
                <th style={thStyle}>Tenant(s)</th>
                <th style={thStyle}>Trigger</th>
                <th style={thStyle}>Sections</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Progress</th>
                <th style={thStyle}>Findings</th>
                <th style={thStyle}>Started</th>
                <th style={thStyle}>Duration</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRuns.map((run) => {
                const percent = calculateProgressPercentage(run);
                const isCancellable = run.status === "queued" || run.status === "running";
                const isRetryable = run.status === "failed" || run.status === "cancelled" || run.status === "partial";
                const hasArtifacts = Boolean(run.artifactPath || run.status === "succeeded" || run.status === "failed" || run.status === "partial");

                return (
                  <tr key={run.id} data-testid={`run-row-${run.id}`}>
                    {/* Run ID (mono) */}
                    <td style={tdStyle}>
                      <span style={monoStyle} title={run.id}>
                        {run.id.slice(0, 8)}…
                      </span>
                    </td>

                    {/* Tenant(s) */}
                    <td style={tdStyle}>
                      {run.tenantDisplayName || run.tenantId}
                      {run.children && run.children.length > 0 && (
                        <span
                          style={{
                            marginLeft: "6px",
                            padding: "1px 6px",
                            borderRadius: "999px",
                            fontSize: "11px",
                            background: "var(--surface)",
                            border: "1px solid var(--border)",
                            color: "var(--text-soft)",
                          }}
                        >
                          {run.children.length} tenants
                        </span>
                      )}
                    </td>

                    {/* Trigger */}
                    <td style={tdStyle}>
                      <span style={{ textTransform: "capitalize" }}>{run.trigger}</span>
                    </td>

                    {/* Sections */}
                    <td style={tdStyle}>
                      <span title={run.sections.join(", ")}>
                        {run.sections.length} {run.sections.length === 1 ? "section" : "sections"}
                      </span>
                    </td>

                    {/* Status */}
                    <td style={tdStyle}>
                      <span
                        className="status-badge"
                        style={getStatusBadgeStyle(run.status)}
                        data-testid={`status-badge-${run.id}`}
                      >
                        {run.status}
                      </span>
                    </td>

                    {/* Progress bar */}
                    <td style={tdStyle}>
                      <div style={progressBarTrackStyle} title={`${percent}%`}>
                        <div style={progressBarStyle(percent, run.status)} />
                      </div>
                    </td>

                    {/* Findings */}
                    <td style={tdStyle}>
                      {run.summaryCounts ? (
                        <div style={{ display: "flex", gap: "6px", fontSize: "12px" }}>
                          <span style={{ color: "var(--success)" }} title="Passed">
                            {run.summaryCounts.pass} pass
                          </span>
                          <span style={{ color: "var(--text-soft)" }}>·</span>
                          <span style={{ color: "var(--danger)" }} title="Failed">
                            {run.summaryCounts.fail} fail
                          </span>
                        </div>
                      ) : (
                        <span style={{ color: "var(--text-soft)" }}>—</span>
                      )}
                    </td>

                    {/* Started */}
                    <td style={tdStyle}>{formatDateTime(run.startedAt ?? run.createdAt)}</td>

                    {/* Duration */}
                    <td style={tdStyle}>{formatDuration(run.startedAt, run.finishedAt)}</td>

                    {/* Row actions */}
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: "6px", justifyContent: "flex-end" }}>
                        {onView && (
                          <button
                            type="button"
                            style={actionBtnStyle}
                            onClick={() => onView(run)}
                            aria-label={`View run ${run.id}`}
                            data-testid={`action-view-${run.id}`}
                          >
                            View
                          </button>
                        )}

                        {onCancel && (
                          <button
                            type="button"
                            style={isCancellable ? actionBtnStyle : disabledActionBtnStyle}
                            disabled={!isCancellable}
                            onClick={() => isCancellable && onCancel(run)}
                            aria-label={`Cancel run ${run.id}`}
                            data-testid={`action-cancel-${run.id}`}
                          >
                            Cancel
                          </button>
                        )}

                        {onRetry && (
                          <button
                            type="button"
                            style={isRetryable ? actionBtnStyle : disabledActionBtnStyle}
                            disabled={!isRetryable}
                            onClick={() => isRetryable && onRetry(run)}
                            aria-label={`Retry run ${run.id}`}
                            data-testid={`action-retry-${run.id}`}
                          >
                            Retry failed
                          </button>
                        )}

                        {onDownloadArtifacts && (
                          <button
                            type="button"
                            style={hasArtifacts ? actionBtnStyle : disabledActionBtnStyle}
                            disabled={!hasArtifacts}
                            onClick={() => hasArtifacts && onDownloadArtifacts(run)}
                            aria-label={`Download artifacts for run ${run.id}`}
                            data-testid={`action-download-${run.id}`}
                          >
                            Artifacts
                          </button>
                        )}

                        {onCompare && (
                          <button
                            type="button"
                            style={actionBtnStyle}
                            onClick={() => onCompare(run)}
                            aria-label={`Compare run ${run.id} to previous`}
                            data-testid={`action-compare-${run.id}`}
                          >
                            Compare
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Card View (Mobile) */}
      {!loading && !error && filteredRuns.length > 0 && viewMode === "card" && (
        <div style={cardGridStyle} data-testid="runs-card-grid">
          {filteredRuns.map((run) => {
            const percent = calculateProgressPercentage(run);
            const isCancellable = run.status === "queued" || run.status === "running";
            const isRetryable = run.status === "failed" || run.status === "cancelled" || run.status === "partial";
            const hasArtifacts = Boolean(run.artifactPath || run.status === "succeeded" || run.status === "failed" || run.status === "partial");

            return (
              <div key={run.id} style={cardStyle} data-testid={`run-card-${run.id}`}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={monoStyle}>{run.id.slice(0, 12)}…</span>
                  <span className="status-badge" style={getStatusBadgeStyle(run.status)}>
                    {run.status}
                  </span>
                </div>

                <div>
                  <div style={{ fontWeight: 600, fontSize: "15px" }}>
                    {run.tenantDisplayName || run.tenantId}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--text-soft)" }}>
                    Trigger: <span style={{ textTransform: "capitalize" }}>{run.trigger}</span> · {run.sections.length} sections
                  </div>
                </div>

                {/* Progress bar */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "4px" }}>
                    <span style={{ color: "var(--text-soft)" }}>Progress</span>
                    <span>{percent}%</span>
                  </div>
                  <div style={{ ...progressBarTrackStyle, width: "100%" }}>
                    <div style={progressBarStyle(percent, run.status)} />
                  </div>
                </div>

                {/* Findings & Timing */}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                  <div>
                    {run.summaryCounts ? (
                      <span>
                        <span style={{ color: "var(--success)" }}>{run.summaryCounts.pass} pass</span> ·{" "}
                        <span style={{ color: "var(--danger)" }}>{run.summaryCounts.fail} fail</span>
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-soft)" }}>No findings</span>
                    )}
                  </div>
                  <div style={{ color: "var(--text-soft)" }}>
                    {formatDuration(run.startedAt, run.finishedAt)}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
                  {onView && (
                    <button
                      type="button"
                      style={actionBtnStyle}
                      onClick={() => onView(run)}
                      data-testid={`card-action-view-${run.id}`}
                    >
                      View
                    </button>
                  )}
                  {onCancel && (
                    <button
                      type="button"
                      style={isCancellable ? actionBtnStyle : disabledActionBtnStyle}
                      disabled={!isCancellable}
                      onClick={() => isCancellable && onCancel(run)}
                      data-testid={`card-action-cancel-${run.id}`}
                    >
                      Cancel
                    </button>
                  )}
                  {onRetry && (
                    <button
                      type="button"
                      style={isRetryable ? actionBtnStyle : disabledActionBtnStyle}
                      disabled={!isRetryable}
                      onClick={() => isRetryable && onRetry(run)}
                      data-testid={`card-action-retry-${run.id}`}
                    >
                      Retry
                    </button>
                  )}
                  {onDownloadArtifacts && (
                    <button
                      type="button"
                      style={hasArtifacts ? actionBtnStyle : disabledActionBtnStyle}
                      disabled={!hasArtifacts}
                      onClick={() => hasArtifacts && onDownloadArtifacts(run)}
                      data-testid={`card-action-download-${run.id}`}
                    >
                      Artifacts
                    </button>
                  )}
                  {onCompare && (
                    <button
                      type="button"
                      style={actionBtnStyle}
                      onClick={() => onCompare(run)}
                      data-testid={`card-action-compare-${run.id}`}
                    >
                      Compare
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
