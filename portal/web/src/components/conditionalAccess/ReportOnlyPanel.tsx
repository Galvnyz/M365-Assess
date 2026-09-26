"use client";

// ReportOnlyPanel — Conditional Access Report-Only Evaluation Surface (EPIC-015 SPEC §3.5, §6; T-0289).
// Renders what report-only policies would have done (sign-in impact) so operators can safely promote them.
// Read-only surface: promotion routes through the policy editor link-out (no inline write path).
import React, { useState, useMemo, type CSSProperties } from "react";

export interface CaReportOnlyAffectedUser {
  readonly userPrincipalName: string;
  readonly failCount: number;
}

export interface CaReportOnlyAffectedApp {
  readonly appDisplayName: string;
  readonly failCount: number;
}

export interface CaReportOnlySampleEvent {
  readonly id: string;
  readonly createdDateTime: string;
  readonly userPrincipalName: string;
  readonly appDisplayName: string;
  readonly ipAddress: string;
  readonly location: string;
  readonly result: string;
  readonly wouldBlock: boolean;
}

export interface CaReportOnlyPolicyResult {
  readonly policyId: string;
  readonly policyName: string;
  readonly state: "enabledForReportingButNotEnforced";
  readonly controlsSummary: string;
  readonly totalEvaluated: number;
  readonly wouldBlockCount: number;
  readonly wouldGrantCount: number;
  readonly notAppliedCount: number;
  readonly affectedUsers: readonly CaReportOnlyAffectedUser[];
  readonly affectedApps: readonly CaReportOnlyAffectedApp[];
  readonly sampleEvents: readonly CaReportOnlySampleEvent[];
}

export interface CaReportOnlySummary {
  readonly totalReportOnlyPolicies: number;
  readonly totalEvaluated: number;
  readonly totalWouldBlock: number;
}

export interface ReportOnlyPanelProps {
  readonly policies?: readonly CaReportOnlyPolicyResult[];
  readonly summary?: CaReportOnlySummary;
  readonly tenantId?: string;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onRefresh?: () => void;
}

const panelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "24px",
  maxWidth: "1100px",
  margin: "0 auto",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text, #111827)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  paddingBottom: "16px",
  borderBottom: "1px solid var(--border, #e5e7eb)",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "22px",
  fontWeight: 600,
  color: "var(--text, #111827)",
};

const subtitleStyle: CSSProperties = {
  margin: "4px 0 0 0",
  fontSize: "14px",
  color: "var(--text-secondary, #4b5563)",
};

const kpiGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "16px",
};

const kpiCardStyle: CSSProperties = {
  padding: "16px",
  borderRadius: "8px",
  border: "1px solid var(--border, #e5e7eb)",
  backgroundColor: "var(--bg, #ffffff)",
  display: "flex",
  flexDirection: "column",
  gap: "4px",
};

const kpiLabelStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--text-secondary, #4b5563)",
  fontWeight: 500,
};

const kpiValueStyle: CSSProperties = {
  fontSize: "26px",
  fontWeight: 700,
  color: "var(--text, #111827)",
};

const policyCardStyle: CSSProperties = {
  padding: "20px",
  borderRadius: "8px",
  border: "1px solid var(--border, #e5e7eb)",
  backgroundColor: "var(--bg, #ffffff)",
  display: "flex",
  flexDirection: "column",
  gap: "16px",
};

const badgeStyle = (bgColor: string, textColor: string): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: "12px",
  fontSize: "12px",
  fontWeight: 500,
  backgroundColor: bgColor,
  color: textColor,
});

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "13px",
  marginTop: "8px",
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "8px",
  borderBottom: "1px solid var(--border, #e5e7eb)",
  color: "var(--text-secondary, #4b5563)",
  fontWeight: 600,
};

const tdStyle: CSSProperties = {
  padding: "8px",
  borderBottom: "1px solid var(--border, #f3f4f6)",
};

const linkBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "4px",
  color: "var(--primary, #2563eb)",
  textDecoration: "none",
  fontSize: "13px",
  fontWeight: 500,
  cursor: "pointer",
};

export function ReportOnlyPanel({
  policies = [],
  summary,
  loading = false,
  error = null,
  onRefresh,
}: ReportOnlyPanelProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedEvents, setExpandedEvents] = useState<Record<string, boolean>>({});

  const filteredPolicies = useMemo(() => {
    if (!searchTerm.trim()) return policies;
    const term = searchTerm.toLowerCase();
    return policies.filter(
      (p) =>
        p.policyName.toLowerCase().includes(term) ||
        p.controlsSummary.toLowerCase().includes(term),
    );
  }, [policies, searchTerm]);

  const totalReportOnly = summary?.totalReportOnlyPolicies ?? policies.length;
  const totalEvaluated =
    summary?.totalEvaluated ?? policies.reduce((acc, p) => acc + p.totalEvaluated, 0);
  const totalWouldBlock =
    summary?.totalWouldBlock ?? policies.reduce((acc, p) => acc + p.wouldBlockCount, 0);

  const toggleEvents = (policyId: string) => {
    setExpandedEvents((prev) => ({
      ...prev,
      [policyId]: !prev[policyId],
    }));
  };

  return (
    <div style={panelStyle} data-testid="report-only-panel">
      {/* Header */}
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>Report-Only Evaluation</h1>
          <p style={subtitleStyle}>
            Evaluate the sign-in impact of Conditional Access policies in report-only mode before enforcing them.
          </p>
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            style={{
              padding: "8px 14px",
              borderRadius: "6px",
              border: "1px solid var(--border, #d1d5db)",
              backgroundColor: "transparent",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 500,
            }}
            data-testid="refresh-btn"
          >
            Refresh Signals
          </button>
        )}
      </div>

      {/* KPI Summary Cards */}
      <div style={kpiGridStyle} data-testid="kpi-summary-cards">
        <div style={kpiCardStyle}>
          <span style={kpiLabelStyle}>Report-Only Policies</span>
          <span style={kpiValueStyle} data-testid="kpi-policies-count">
            {totalReportOnly}
          </span>
        </div>
        <div style={kpiCardStyle}>
          <span style={kpiLabelStyle}>Total Sign-ins Evaluated</span>
          <span style={kpiValueStyle} data-testid="kpi-evaluated-count">
            {totalEvaluated}
          </span>
        </div>
        <div style={kpiCardStyle}>
          <span style={kpiLabelStyle}>Sign-ins That Would Be Blocked</span>
          <span
            style={{
              ...kpiValueStyle,
              color: totalWouldBlock > 0 ? "#dc2626" : "var(--text, #111827)",
            }}
            data-testid="kpi-would-block-count"
          >
            {totalWouldBlock}
          </span>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: "6px",
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            fontSize: "14px",
          }}
          data-testid="report-only-error"
        >
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--text-muted, #6b7280)" }} data-testid="loading-indicator">
          Loading report-only signals and sign-in evaluations...
        </div>
      )}

      {/* Search Input */}
      {!loading && policies.length > 0 && (
        <div>
          <input
            type="text"
            placeholder="Search report-only policies..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid var(--border, #d1d5db)",
              fontSize: "14px",
              width: "100%",
              maxWidth: "360px",
            }}
            data-testid="policy-search-input"
          />
        </div>
      )}

      {/* Empty State */}
      {!loading && policies.length === 0 && !error && (
        <div
          style={{
            padding: "48px 24px",
            borderRadius: "8px",
            border: "1px dashed var(--border, #d1d5db)",
            textAlign: "center",
            backgroundColor: "var(--bg, #ffffff)",
          }}
          data-testid="empty-state"
        >
          <h3 style={{ margin: "0 0 8px 0", fontSize: "16px", fontWeight: 600 }}>
            No Report-Only Policies Found
          </h3>
          <p style={{ margin: 0, fontSize: "14px", color: "var(--text-secondary, #4b5563)", maxWidth: "480px", marginInline: "auto" }}>
            Policies configured in <strong>Report-only</strong> mode (enabledForReportingButNotEnforced)
            evaluate live sign-ins without disrupting user access. When configured, their impact will appear here.
          </p>
        </div>
      )}

      {/* Policy Impact Cards */}
      {!loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }} data-testid="policy-cards-list">
          {filteredPolicies.map((p) => {
            const isEventsOpen = Boolean(expandedEvents[p.policyId]);

            return (
              <div key={p.policyId} style={policyCardStyle} data-testid={`policy-card-${p.policyId}`}>
                {/* Header row */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 600 }}>
                        {p.policyName}
                      </h3>
                      <span style={badgeStyle("#e0e7ff", "#3730a3")}>
                        Report-Only
                      </span>
                    </div>
                    <span style={{ fontSize: "13px", color: "var(--text-secondary, #4b5563)" }}>
                      Controls: <strong>{p.controlsSummary}</strong> • ID: {p.policyId}
                    </span>
                  </div>

                  {/* Promote link out (strictly read-only / link-out to editor) */}
                  <a
                    href={`/tenant/conditional-access/policies/${p.policyId}?promote=true`}
                    style={linkBtnStyle}
                    data-testid={`promote-link-${p.policyId}`}
                  >
                    Promote to Enforced →
                  </a>
                </div>

                {/* Metrics Breakdown */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                    gap: "12px",
                    padding: "12px",
                    borderRadius: "6px",
                    backgroundColor: "var(--bg-secondary, #f9fafb)",
                  }}
                >
                  <div>
                    <span style={{ fontSize: "12px", color: "var(--text-secondary, #4b5563)" }}>Evaluated</span>
                    <div style={{ fontSize: "18px", fontWeight: 600 }}>{p.totalEvaluated}</div>
                  </div>
                  <div>
                    <span style={{ fontSize: "12px", color: "#dc2626" }}>Would Block / Fail</span>
                    <div style={{ fontSize: "18px", fontWeight: 600, color: "#dc2626" }} data-testid="would-block-metric">
                      {p.wouldBlockCount}
                    </div>
                  </div>
                  <div>
                    <span style={{ fontSize: "12px", color: "#16a34a" }}>Would Grant</span>
                    <div style={{ fontSize: "18px", fontWeight: 600, color: "#16a34a" }}>
                      {p.wouldGrantCount}
                    </div>
                  </div>
                  <div>
                    <span style={{ fontSize: "12px", color: "var(--text-secondary, #4b5563)" }}>Not Applied</span>
                    <div style={{ fontSize: "18px", fontWeight: 600 }}>{p.notAppliedCount}</div>
                  </div>
                </div>

                {/* Affected Users & Apps */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "16px" }}>
                  {/* Affected Users */}
                  <div data-testid="affected-users-section">
                    <h4 style={{ margin: "0 0 6px 0", fontSize: "13px", fontWeight: 600 }}>
                      Users Affected by Block/Failure ({p.affectedUsers.length})
                    </h4>
                    {p.affectedUsers.length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px" }}>
                        {p.affectedUsers.slice(0, 5).map((u, idx) => (
                          <li key={idx}>
                            <strong>{u.userPrincipalName}</strong> ({u.failCount} failed)
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p style={{ margin: 0, fontSize: "13px", color: "var(--text-muted, #6b7280)" }}>
                        No users would have been blocked.
                      </p>
                    )}
                  </div>

                  {/* Affected Apps */}
                  <div data-testid="affected-apps-section">
                    <h4 style={{ margin: "0 0 6px 0", fontSize: "13px", fontWeight: 600 }}>
                      Applications Affected ({p.affectedApps.length})
                    </h4>
                    {p.affectedApps.length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px" }}>
                        {p.affectedApps.slice(0, 5).map((a, idx) => (
                          <li key={idx}>
                            <strong>{a.appDisplayName}</strong> ({a.failCount} failed)
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p style={{ margin: 0, fontSize: "13px", color: "var(--text-muted, #6b7280)" }}>
                        No applications affected by block decisions.
                      </p>
                    )}
                  </div>
                </div>

                {/* Sample Evaluation Log Toggle */}
                {p.sampleEvents.length > 0 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => toggleEvents(p.policyId)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--primary, #2563eb)",
                        cursor: "pointer",
                        fontSize: "13px",
                        padding: 0,
                        fontWeight: 500,
                      }}
                      data-testid={`toggle-events-btn-${p.policyId}`}
                    >
                      {isEventsOpen
                        ? "▲ Hide Recent Evaluation Events"
                        : `▼ View Recent Evaluation Events (${p.sampleEvents.length})`}
                    </button>

                    {isEventsOpen && (
                      <table style={tableStyle} data-testid={`events-table-${p.policyId}`}>
                        <thead>
                          <tr>
                            <th style={thStyle}>Timestamp</th>
                            <th style={thStyle}>User</th>
                            <th style={thStyle}>Application</th>
                            <th style={thStyle}>IP / Location</th>
                            <th style={thStyle}>Hypothetical Result</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.sampleEvents.map((ev) => (
                            <tr key={ev.id}>
                              <td style={tdStyle}>{new Date(ev.createdDateTime).toLocaleTimeString()}</td>
                              <td style={tdStyle}>{ev.userPrincipalName}</td>
                              <td style={tdStyle}>{ev.appDisplayName}</td>
                              <td style={tdStyle}>{ev.ipAddress} ({ev.location})</td>
                              <td style={tdStyle}>
                                <span
                                  style={badgeStyle(
                                    ev.wouldBlock ? "#fee2e2" : "#dcfce7",
                                    ev.wouldBlock ? "#991b1b" : "#166534",
                                  )}
                                >
                                  {ev.wouldBlock ? "Would Block" : "Would Grant"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
