"use client";

// MFA KPI strip component (EPIC-012 SPEC.md §3.1, T-0228).
// Displays aggregate metrics for total users, MFA-registered, not-registered,
// phishing-resistant, and per-method breakdown.
// Strictly uses report theme tokens with zero colour literals.

import React, { type CSSProperties, type ReactElement } from "react";
import type { MfaReportKpis } from "../../lib/mfaApi";

export interface MfaKpiStripProps {
  readonly kpis?: MfaReportKpis | null;
  readonly loading?: boolean;
}

const stripContainerStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "12px",
  width: "100%",
};

const cardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  padding: "16px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 8px)",
  color: "var(--text)",
};

const cardLabelStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--muted)",
};

const cardValueStyle: CSSProperties = {
  fontSize: "28px",
  fontWeight: 700,
  lineHeight: 1.1,
  color: "var(--text)",
};

const methodBreakdownStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "6px",
  marginTop: "4px",
};

const chipStyle: CSSProperties = {
  fontSize: "11px",
  padding: "2px 6px",
  borderRadius: "4px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  color: "var(--text)",
};

export function MfaKpiStrip({ kpis, loading }: MfaKpiStripProps): ReactElement {
  if (loading || !kpis) {
    return (
      <div style={stripContainerStyle} data-testid="mfa-kpi-strip-loading">
        <div style={cardStyle}>
          <span style={cardLabelStyle}>Loading metrics...</span>
        </div>
      </div>
    );
  }

  const methodEntries = Object.entries(kpis.perMethod || {});

  return (
    <div style={stripContainerStyle} data-testid="mfa-kpi-strip">
      <div style={cardStyle} data-testid="kpi-total">
        <span style={cardLabelStyle}>Total Users</span>
        <span style={cardValueStyle}>{kpis.total}</span>
      </div>

      <div style={cardStyle} data-testid="kpi-registered">
        <span style={cardLabelStyle}>MFA Registered</span>
        <span style={cardValueStyle}>{kpis.registered}</span>
      </div>

      <div style={cardStyle} data-testid="kpi-not-registered">
        <span style={cardLabelStyle}>Not Registered</span>
        <span style={cardValueStyle}>{kpis.notRegistered}</span>
      </div>

      <div style={cardStyle} data-testid="kpi-phishing-resistant">
        <span style={cardLabelStyle}>Phishing-Resistant</span>
        <span style={cardValueStyle}>{kpis.phishingResistant}</span>
      </div>

      <div style={{ ...cardStyle, gridColumn: "span 2" }} data-testid="kpi-methods">
        <span style={cardLabelStyle}>Methods Registered</span>
        <div style={methodBreakdownStyle}>
          {methodEntries.length === 0 ? (
            <span style={{ fontSize: "12px", color: "var(--muted)" }}>None</span>
          ) : (
            methodEntries.map(([method, count]) => (
              <span key={method} style={chipStyle} data-testid={`method-count-${method}`}>
                {method}: {count}
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
