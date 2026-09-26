"use client";

// Standards alignment report (EPIC-008 SPEC.md §3.3, T-0148).
// A three-way view switcher sharing the EPIC-009 status vocabulary. Zero colour
// literals: report theme tokens only.

import React, { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react";
import {
  ALIGNMENT_VIEW_LABELS,
  ALIGNMENT_VIEWS,
  type AlignmentAggregateRow,
  type AlignmentByStandardRow,
  type AlignmentStatus,
  type AlignmentSummaryRow,
  type AlignmentView,
} from "../../lib/standardsApi.js";

export interface AlignmentReportProps {
  readonly summary?: readonly AlignmentSummaryRow[];
  readonly byStandard?: readonly AlignmentByStandardRow[];
  readonly aggregate?: readonly AlignmentAggregateRow[];
  readonly view?: AlignmentView;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onViewChange?: (view: AlignmentView) => void;
  readonly onSelectTenant?: (tenantId: string) => void;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  width: "100%",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
};

const switcherStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "6px",
  padding: "8px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
};

const viewButtonStyle = (active: boolean): CSSProperties => ({
  padding: "8px 14px",
  border: active ? "1px solid var(--accent)" : "1px solid transparent",
  borderRadius: "6px",
  background: active ? "var(--accent-soft)" : "transparent",
  color: active ? "var(--accent-text)" : "var(--text-soft)",
  fontWeight: 600,
  fontSize: "13px",
  cursor: "pointer",
});

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

const badgeBaseStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 600,
};

export function statusBadgeStyle(status: AlignmentStatus | string): CSSProperties {
  switch (status) {
    case "compliant":
      return { ...badgeBaseStyle, background: "var(--success-soft)", color: "var(--success-text)", border: "1px solid var(--success)" };
    case "non-compliant":
      return { ...badgeBaseStyle, background: "var(--danger-soft)", color: "var(--danger-text)", border: "1px solid var(--danger)" };
    case "license missing":
      return { ...badgeBaseStyle, background: "var(--warning-soft)", color: "var(--warning-text)", border: "1px solid var(--warning)" };
    case "reporting disabled":
      return { ...badgeBaseStyle, background: "var(--surface)", color: "var(--text-soft)", border: "1px solid var(--border)" };
    case "accepted deviation":
    case "customer specific":
      return { ...badgeBaseStyle, background: "var(--accent-soft)", color: "var(--accent-text)", border: "1px solid var(--accent)" };
    default:
      return { ...badgeBaseStyle, background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" };
  }
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AlignmentReport({
  summary = [],
  byStandard = [],
  aggregate = [],
  view = "summary",
  loading = false,
  error = null,
  onViewChange,
  onSelectTenant,
}: AlignmentReportProps): ReactElement {
  const [internalView, setInternalView] = useState<AlignmentView>(view);
  // Keep the uncontrolled view in sync with the prop so a parent can drive it.
  useEffect(() => {
    setInternalView(view);
  }, [view]);
  const activeView = onViewChange ? view : internalView;

  const switchView = (next: AlignmentView): void => {
    setInternalView(next);
    onViewChange?.(next);
  };

  const isEmpty = useMemo(() => {
    if (activeView === "summary") return summary.length === 0;
    if (activeView === "aggregate") return aggregate.length === 0;
    return byStandard.length === 0;
  }, [activeView, summary, aggregate, byStandard]);

  return (
    <div style={containerStyle} data-testid="alignment-report">
      <div style={switcherStyle} role="tablist" aria-label="Alignment views">
        {ALIGNMENT_VIEWS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={activeView === value}
            style={viewButtonStyle(activeView === value)}
            onClick={() => switchView(value)}
            data-testid={`alignment-view-${value}`}
            title={ALIGNMENT_VIEW_LABELS[value]}
          >
            {ALIGNMENT_VIEW_LABELS[value]}
          </button>
        ))}
      </div>

      {loading && <div style={{ padding: "32px", textAlign: "center", color: "var(--text-soft)" }}>Loading alignment...</div>}

      {error && (
        <div style={{ padding: "16px", background: "var(--danger-soft)", border: "1px solid var(--danger)", borderRadius: "6px", color: "var(--danger-text)" }} role="alert">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div style={tableWrapperStyle}>
          {activeView === "summary" && (
            <table style={tableStyle} aria-label="Tenant/template summary" data-testid="alignment-summary">
              <thead>
                <tr>
                  <th style={thStyle}>Tenant</th>
                  <th style={thStyle}>Total</th>
                  <th style={thStyle}>Compliant</th>
                  <th style={thStyle}>Non-compliant</th>
                  <th style={thStyle}>License missing</th>
                  <th style={thStyle}>Reporting disabled</th>
                  <th style={thStyle}>Compliance</th>
                </tr>
              </thead>
              <tbody>
                {isEmpty && (
                  <tr>
                    <td style={{ ...tdStyle, textAlign: "center", color: "var(--text-soft)" }} colSpan={7} data-testid="alignment-empty">
                      No alignment data yet.
                    </td>
                  </tr>
                )}
                {summary.map((rowData) => (
                  <tr key={rowData.tenantId} data-testid={`summary-row-${rowData.tenantId}`}>
                    <td style={tdStyle}>
                      {onSelectTenant ? (
                        <button
                          type="button"
                          onClick={() => onSelectTenant(rowData.tenantId)}
                          style={{ background: "transparent", border: "none", color: "var(--accent-text)", cursor: "pointer", padding: 0, font: "inherit" }}
                        >
                          {rowData.tenantId}
                        </button>
                      ) : (
                        rowData.tenantId
                      )}
                    </td>
                    <td style={tdStyle}>{rowData.total}</td>
                    <td style={tdStyle}>{rowData.compliant}</td>
                    <td style={tdStyle}>{rowData.nonCompliant}</td>
                    <td style={tdStyle}>{rowData.licenseMissing}</td>
                    <td style={tdStyle}>{rowData.reportingDisabled}</td>
                    <td style={tdStyle}>{rowData.compliantPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {activeView === "by-standard" && (
            <table style={tableStyle} aria-label="Tenant rows for each standard" data-testid="alignment-by-standard">
              <thead>
                <tr>
                  <th style={thStyle}>Tenant</th>
                  <th style={thStyle}>Check</th>
                  <th style={thStyle}>Current</th>
                  <th style={thStyle}>Expected</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {isEmpty && (
                  <tr>
                    <td style={{ ...tdStyle, textAlign: "center", color: "var(--text-soft)" }} colSpan={5} data-testid="alignment-empty">
                      No alignment data yet.
                    </td>
                  </tr>
                )}
                {byStandard.map((rowData) => (
                  <tr key={`${rowData.tenantId}-${rowData.check}`} data-testid={`standard-row-${rowData.tenantId}-${rowData.check}`}>
                    <td style={tdStyle}>{rowData.tenantId}</td>
                    <td style={tdStyle}>{rowData.check}</td>
                    <td style={tdStyle}>{renderValue(rowData.current)}</td>
                    <td style={tdStyle}>{renderValue(rowData.expected)}</td>
                    <td style={tdStyle}>
                      <span className="status-badge" style={statusBadgeStyle(rowData.state)}>{rowData.state}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {activeView === "aggregate" && (
            <table style={tableStyle} aria-label="Aggregate tenant compliance by standard" data-testid="alignment-aggregate">
              <thead>
                <tr>
                  <th style={thStyle}>Check</th>
                  <th style={thStyle}>Tenants</th>
                  <th style={thStyle}>Compliant</th>
                  <th style={thStyle}>Non-compliant</th>
                  <th style={thStyle}>License missing</th>
                  <th style={thStyle}>Compliance</th>
                </tr>
              </thead>
              <tbody>
                {isEmpty && (
                  <tr>
                    <td style={{ ...tdStyle, textAlign: "center", color: "var(--text-soft)" }} colSpan={6} data-testid="alignment-empty">
                      No alignment data yet.
                    </td>
                  </tr>
                )}
                {aggregate.map((rowData) => (
                  <tr key={rowData.check} data-testid={`aggregate-row-${rowData.check}`}>
                    <td style={tdStyle}>{rowData.check}</td>
                    <td style={tdStyle}>{rowData.total}</td>
                    <td style={tdStyle}>{rowData.compliant}</td>
                    <td style={tdStyle}>{rowData.nonCompliant}</td>
                    <td style={tdStyle}>{rowData.licenseMissing}</td>
                    <td style={tdStyle}>{rowData.compliantPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
