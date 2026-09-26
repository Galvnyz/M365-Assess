"use client";

// Executive drift report component (EPIC-009 SPEC.md §3.4; T-0170).
// Renders the T-0170 report payload — counts by deviation state, top
// deviation categories, accepted items, and remediation status — with the
// EPIC-005 report theme/branding (theme tokens only, no colour literals).
// The trend series over time is a documented follow-on from EPIC-010's
// baseline history: the payload carries `trend: null` and this component
// renders the absence explicitly instead of inventing data.

import React, { type CSSProperties, type ReactElement } from "react";

export interface DriftReportStateCounts {
  readonly open: number;
  readonly accepted: number;
  readonly customerSpecific: number;
  readonly denied: number;
  readonly deletePending: number;
  readonly resolved: number;
  readonly total: number;
}

export interface DriftReportCategory {
  readonly standardKey: string;
  readonly count: number;
  readonly open: number;
}

export interface DriftReportRemediation {
  readonly accepted: number;
  readonly customerSpecific: number;
  readonly pendingDeletion: number;
  readonly resolved: number;
}

export interface ExecutiveDriftReportData {
  readonly tenantId: string;
  readonly generatedAt: string;
  readonly countsByState: DriftReportStateCounts;
  readonly topCategories: readonly DriftReportCategory[];
  readonly remediation: DriftReportRemediation;
  readonly trend: null;
}

export interface ExecutiveDriftReportProps {
  readonly report: ExecutiveDriftReportData | null;
  readonly loading?: boolean;
  readonly error?: string | null;
}

// ─── Styles (EPIC-005 report theme tokens) ────────────────────────────────────

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "20px",
  width: "100%",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
  background: "var(--report-bg, var(--bg))",
};

const sectionStyle: CSSProperties = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  boxShadow: "var(--shadow-card)",
  padding: "20px",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};

const sectionTitleStyle: CSSProperties = {
  fontSize: "16px",
  fontWeight: 700,
  margin: 0,
  fontFamily: "var(--font-display, var(--font-sans))",
};

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: "12px",
};

const cardStyle: CSSProperties = {
  padding: "14px 16px",
  background: "var(--report-card-bg, var(--bg))",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  display: "flex",
  flexDirection: "column",
  gap: "4px",
};

const valueStyle: CSSProperties = {
  fontSize: "24px",
  fontWeight: 700,
  fontFamily: "var(--font-display, var(--font-sans))",
};

const labelStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--text-soft)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "13px",
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "1px solid var(--border)",
  color: "var(--text-soft)",
  fontWeight: 600,
};

const tdStyle: CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid var(--border)",
};

const monoStyle: CSSProperties = {
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: "12px",
};

const metaStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--text-soft)",
  margin: 0,
};

function stateCards(counts: DriftReportStateCounts): ReadonlyArray<{ key: string; label: string; value: number }> {
  return [
    { key: "open", label: "Open deviations", value: counts.open },
    { key: "accepted", label: "Accepted", value: counts.accepted },
    { key: "customerSpecific", label: "Customer specific", value: counts.customerSpecific },
    { key: "denied", label: "Denied", value: counts.denied },
    { key: "deletePending", label: "Pending deletion", value: counts.deletePending },
    { key: "resolved", label: "Resolved", value: counts.resolved },
    { key: "total", label: "Total deviations", value: counts.total },
  ];
}

export function ExecutiveDriftReport({ report, loading = false, error = null }: ExecutiveDriftReportProps): ReactElement {
  if (loading) {
    return <div data-testid="drift-report-loading">Loading executive drift report…</div>;
  }
  if (error) {
    return (
      <div
        data-testid="drift-report-error"
        style={{
          padding: "10px 14px",
          background: "var(--danger-soft)",
          border: "1px solid var(--danger)",
          borderRadius: "6px",
          color: "var(--danger-text)",
          fontSize: "13px",
        }}
      >
        {error}
      </div>
    );
  }
  if (!report) {
    return (
      <div data-testid="drift-report-empty" style={metaStyle}>
        No drift report available for this tenant yet.
      </div>
    );
  }

  return (
    <div style={containerStyle} data-testid="drift-report">
      <p style={metaStyle} data-testid="drift-report-meta">
        Tenant {report.tenantId} · generated {report.generatedAt}
      </p>

      <section style={sectionStyle} aria-label="Deviations by state">
        <h2 style={sectionTitleStyle}>Deviations by state</h2>
        <div style={gridStyle} className="kpi-strip" data-testid="drift-report-states">
          {stateCards(report.countsByState).map((card) => (
            <div key={card.key} style={cardStyle} data-testid={`drift-report-state-${card.key}`}>
              <span style={valueStyle}>{card.value}</span>
              <span style={labelStyle}>{card.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section style={sectionStyle} aria-label="Top deviation categories">
        <h2 style={sectionTitleStyle}>Top deviation categories</h2>
        {report.topCategories.length === 0 ? (
          <p style={metaStyle} data-testid="drift-report-no-categories">
            No deviations recorded.
          </p>
        ) : (
          <table style={tableStyle} data-testid="drift-report-categories">
            <thead>
              <tr>
                <th style={thStyle}>Standard</th>
                <th style={thStyle}>Deviations</th>
                <th style={thStyle}>Still open</th>
              </tr>
            </thead>
            <tbody>
              {report.topCategories.map((category) => (
                <tr key={category.standardKey} data-testid={`drift-report-category-${category.standardKey}`}>
                  <td style={{ ...tdStyle, ...monoStyle }}>{category.standardKey}</td>
                  <td style={tdStyle} data-testid={`drift-report-category-count-${category.standardKey}`}>
                    {category.count}
                  </td>
                  <td style={tdStyle}>{category.open}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={sectionStyle} aria-label="Remediation status">
        <h2 style={sectionTitleStyle}>Remediation status</h2>
        <div style={gridStyle} data-testid="drift-report-remediation">
          <div style={cardStyle} data-testid="drift-report-accepted">
            <span style={valueStyle}>{report.remediation.accepted}</span>
            <span style={labelStyle}>Accepted items</span>
          </div>
          <div style={cardStyle} data-testid="drift-report-overrides">
            <span style={valueStyle}>{report.remediation.customerSpecific}</span>
            <span style={labelStyle}>Tenant overrides</span>
          </div>
          <div style={cardStyle} data-testid="drift-report-pending">
            <span style={valueStyle}>{report.remediation.pendingDeletion}</span>
            <span style={labelStyle}>Pending deletion</span>
          </div>
          <div style={cardStyle} data-testid="drift-report-resolved">
            <span style={valueStyle}>{report.remediation.resolved}</span>
            <span style={labelStyle}>Resolved</span>
          </div>
        </div>
      </section>

      <section style={sectionStyle} aria-label="Progress over time">
        <h2 style={sectionTitleStyle}>Progress over time</h2>
        <p style={metaStyle} data-testid="drift-report-trend">
          Trend history arrives with EPIC-010 baselines; this report covers the current snapshot only.
        </p>
      </section>
    </div>
  );
}
