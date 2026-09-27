"use client";

// Baselines fleet overview (EPIC-010 SPEC.md §3.1; T-0187).
// First-run welcome card, Deviation States counts in the shared EPIC-009
// vocabulary, Tenants Needing Attention table, and Accepted & Denied
// Deviations summary. The Fleet Compliance Trend chart is contributed by
// T-0188; this component renders the container it will fill. Zero colour
// literals: report theme tokens only.

import React, { type CSSProperties, type ReactElement } from "react";
import type { FleetOverview as FleetOverviewData } from "../../lib/baselinesApi";

export interface FleetOverviewProps {
  readonly overview: FleetOverviewData | null;
  readonly loading?: boolean;
  readonly error?: string | null;
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  width: "100%",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
};

const cardStyle: CSSProperties = {
  padding: "16px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  boxShadow: "var(--shadow-card)",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};

const titleStyle: CSSProperties = {
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

const kpiValueStyle: CSSProperties = {
  fontSize: "24px",
  fontWeight: 700,
  fontFamily: "var(--font-display, var(--font-sans))",
};

const kpiLabelStyle: CSSProperties = {
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

const metaStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--text-soft)",
  margin: 0,
};

function stateCards(states: FleetOverviewData["deviationStates"]): ReadonlyArray<{ key: string; label: string; value: number }> {
  return [
    { key: "open", label: "Open", value: states.open },
    { key: "accepted", label: "Accepted", value: states.accepted },
    { key: "customerSpecific", label: "Customer specific", value: states.customerSpecific },
    { key: "denied", label: "Denied", value: states.denied },
    { key: "deletePending", label: "Delete pending", value: states.deletePending },
    { key: "resolved", label: "Resolved", value: states.resolved },
    { key: "total", label: "Total", value: states.total },
  ];
}

export function FleetOverview({ overview, loading = false, error = null }: FleetOverviewProps): ReactElement {
  if (loading) {
    return <div data-testid="fleet-loading">Loading fleet overview…</div>;
  }
  if (error) {
    return (
      <div
        data-testid="fleet-error"
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
  if (!overview || overview.baselines.length === 0) {
    return (
      <div style={cardStyle} data-testid="fleet-welcome">
        <h2 style={titleStyle}>Welcome to Baselines</h2>
        <p style={metaStyle}>
          Define a staged rollout, assign tenants, and advance stages as tenants converge. Add
          your first baseline to see fleet compliance here.
        </p>
      </div>
    );
  }

  return (
    <div style={containerStyle} data-testid="fleet-overview">
      <section style={cardStyle} aria-label="Fleet compliance trend">
        <h2 style={titleStyle}>Fleet Compliance Trend</h2>
        {/* T-0188 contributes the trend chart here. */}
        <div data-testid="fleet-trend-container">
          <p style={metaStyle}>Trend history arrives with baseline run events (T-0188).</p>
        </div>
      </section>

      <section style={cardStyle} aria-label="Deviation states">
        <h2 style={titleStyle}>Deviation States</h2>
        <div style={gridStyle} className="kpi-strip" data-testid="fleet-deviation-states">
          {stateCards(overview.deviationStates).map((card) => (
            <div key={card.key} data-testid={`fleet-deviation-${card.key}`}>
              <div style={kpiValueStyle}>{card.value}</div>
              <div style={kpiLabelStyle}>{card.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={cardStyle} aria-label="Tenants needing attention">
        <h2 style={titleStyle}>Tenants Needing Attention</h2>
        {overview.needsAttention.length === 0 ? (
          <p style={metaStyle} data-testid="fleet-attention-empty">
            Every assigned tenant is converged with no open deviations.
          </p>
        ) : (
          <table style={tableStyle} data-testid="fleet-attention">
            <thead>
              <tr>
                <th style={thStyle}>Tenant</th>
                <th style={thStyle}>Baseline</th>
                <th style={thStyle}>Stage</th>
                <th style={thStyle}>State</th>
                <th style={thStyle}>Open deviations</th>
              </tr>
            </thead>
            <tbody>
              {overview.needsAttention.map((row) => (
                <tr key={`${row.tenantId}-${row.baselineId}`} data-testid={`fleet-attention-${row.tenantId}`}>
                  <td style={tdStyle}>{row.tenantId}</td>
                  <td style={tdStyle}>{row.baselineId}</td>
                  <td style={tdStyle}>{row.stage + 1}</td>
                  <td style={tdStyle}>{row.state}</td>
                  <td style={tdStyle}>{row.openDeviations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={cardStyle} aria-label="Accepted and denied deviations">
        <h2 style={titleStyle}>Accepted &amp; Denied Deviations</h2>
        <div style={gridStyle} data-testid="fleet-accepted-denied">
          <div data-testid="fleet-accepted">
            <div style={kpiValueStyle}>{overview.acceptedDenied.accepted}</div>
            <div style={kpiLabelStyle}>Accepted</div>
          </div>
          <div data-testid="fleet-denied">
            <div style={kpiValueStyle}>{overview.acceptedDenied.denied}</div>
            <div style={kpiLabelStyle}>Denied</div>
          </div>
        </div>
      </section>
    </div>
  );
}
