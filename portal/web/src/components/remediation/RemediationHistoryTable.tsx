"use client";

// Remediation history table (EPIC-006 SPEC.md §3.4, T-0113).
// Append-only log: timestamp, actor, tenant, check ID, command, before -> after,
// result, correlation ID. Zero colour literals: report theme tokens only.

import React, { type CSSProperties, type ReactElement } from "react";
import {
  formatTransition,
  type RemediationHistoryRow,
} from "../../lib/remediationApi";
import { statusBadgeStyle } from "./RemediationPlanTable";

export interface RemediationHistoryTableProps {
  readonly rows?: readonly RemediationHistoryRow[];
  readonly loading?: boolean;
  readonly error?: string | null;
  /** Fallback tenant label for tenant-scoped rows that omit it. */
  readonly tenantId?: string;
}

const containerStyle: CSSProperties = {
  width: "100%",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
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
  verticalAlign: "top",
};

const monoStyle: CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  fontSize: "12px",
};

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function RemediationHistoryTable({
  rows = [],
  loading = false,
  error = null,
  tenantId = "",
}: RemediationHistoryTableProps): ReactElement {
  return (
    <div style={containerStyle} data-testid="remediation-history-table">
      {loading && (
        <div style={{ padding: "32px", textAlign: "center", color: "var(--text-soft)" }}>
          Loading remediation history...
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
            marginBottom: "16px",
          }}
          role="alert"
        >
          {error}
        </div>
      )}

      {!loading && !error && (
        <div style={tableWrapperStyle}>
          <table style={tableStyle} aria-label="Remediation history">
            <thead>
              <tr>
                <th style={thStyle}>Timestamp</th>
                <th style={thStyle}>Actor</th>
                <th style={thStyle}>Tenant</th>
                <th style={thStyle}>Check ID</th>
                <th style={thStyle}>Command</th>
                <th style={thStyle}>Before → After</th>
                <th style={thStyle}>Result</th>
                <th style={thStyle}>Correlation ID</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td style={{ ...tdStyle, textAlign: "center", color: "var(--text-soft)" }} colSpan={8} data-testid="empty-history-state">
                    No remediation history yet.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.id} data-testid={`history-row-${row.id}`}>
                  <td style={tdStyle}>{formatTimestamp(row.timestamp)}</td>
                  <td style={tdStyle}>{row.actor ?? "—"}</td>
                  <td style={tdStyle}>{row.tenantId ?? tenantId ?? "—"}</td>
                  <td style={tdStyle}>
                    <span style={monoStyle}>{row.check}</span>
                  </td>
                  <td style={tdStyle}>
                    <span style={monoStyle}>{row.command || "—"}</span>
                  </td>
                  <td style={{ ...tdStyle, ...monoStyle }}>{formatTransition(row.before, row.after)}</td>
                  <td style={tdStyle}>
                    <span className="status-badge" style={statusBadgeStyle(row.state)}>
                      {row.error ? "failed" : row.state}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, ...monoStyle }}>{row.correlationId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
