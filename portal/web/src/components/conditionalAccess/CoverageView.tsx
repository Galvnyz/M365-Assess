"use client";

// CoverageView — Conditional Access Coverage Evaluation & Gap Analysis (EPIC-015 SPEC §3.1, §4.4; T-0290).
// Visualizes user and application coverage, computes percentage, and identifies concrete gaps.
import React, { useState, useMemo, type CSSProperties } from "react";

export interface PolicyRef {
  readonly id: string;
  readonly displayName: string;
}

export interface CoveredUser {
  readonly id: string;
  readonly displayName: string;
  readonly userPrincipalName: string;
  readonly userType: string;
  readonly policies: readonly PolicyRef[];
}

export interface UncoveredUser {
  readonly id: string;
  readonly displayName: string;
  readonly userPrincipalName: string;
  readonly userType: string;
  readonly reason: string;
}

export interface CoveredApp {
  readonly appId: string;
  readonly displayName: string;
  readonly policies: readonly PolicyRef[];
}

export interface UncoveredApp {
  readonly appId: string;
  readonly displayName: string;
  readonly reason: string;
}

export interface CoverageGap {
  readonly category: string;
  readonly severity: "high" | "medium" | "low";
  readonly title: string;
  readonly description: string;
  readonly count: number;
}

export interface CaCoverageSummary {
  readonly totalUsers: number;
  readonly coveredUsersCount: number;
  readonly uncoveredUsersCount: number;
  readonly userCoveragePct: number;
  readonly totalApps: number;
  readonly coveredAppsCount: number;
  readonly uncoveredAppsCount: number;
  readonly appCoveragePct: number;
  readonly activePoliciesCount: number;
  readonly totalGapsCount: number;
}

export interface CoverageViewProps {
  readonly summary?: CaCoverageSummary;
  readonly gaps?: readonly CoverageGap[];
  readonly coveredUsers?: readonly CoveredUser[];
  readonly uncoveredUsers?: readonly UncoveredUser[];
  readonly coveredApps?: readonly CoveredApp[];
  readonly uncoveredApps?: readonly UncoveredApp[];
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onRefresh?: () => void;
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "24px",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text, #111827)",
};

const kpiGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
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
  fontSize: "24px",
  fontWeight: 700,
  color: "var(--text, #111827)",
};

const gapCardStyle: CSSProperties = {
  padding: "14px 18px",
  borderRadius: "8px",
  border: "1px solid #fed7aa",
  backgroundColor: "#fff7ed",
  display: "flex",
  flexDirection: "column",
  gap: "4px",
};

const tabNavStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  borderBottom: "1px solid var(--border, #e5e7eb)",
  paddingBottom: "8px",
};

const tabBtnStyle = (active: boolean): CSSProperties => ({
  padding: "8px 16px",
  borderRadius: "6px",
  border: "none",
  backgroundColor: active ? "var(--primary, #2563eb)" : "transparent",
  color: active ? "#ffffff" : "var(--text-secondary, #4b5563)",
  fontWeight: active ? 600 : 500,
  cursor: "pointer",
  fontSize: "13px",
});

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "13px",
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid var(--border, #e5e7eb)",
  color: "var(--text-secondary, #4b5563)",
  fontWeight: 600,
  backgroundColor: "var(--bg-secondary, #f9fafb)",
};

const tdStyle: CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--border, #f3f4f6)",
};

const badgeStyle = (bgColor: string, textColor: string): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: "12px",
  fontSize: "11px",
  fontWeight: 500,
  backgroundColor: bgColor,
  color: textColor,
});

export function CoverageView({
  summary,
  gaps = [],
  coveredUsers = [],
  uncoveredUsers = [],
  coveredApps = [],
  uncoveredApps = [],
  loading = false,
  error = null,
  onRefresh,
}: CoverageViewProps) {
  const [activeTab, setActiveTab] = useState<"gaps" | "covered-users" | "covered-apps">("gaps");
  const [searchTerm, setSearchTerm] = useState("");

  const filteredUncoveredUsers = useMemo(() => {
    if (!searchTerm.trim()) return uncoveredUsers;
    const term = searchTerm.toLowerCase();
    return uncoveredUsers.filter(
      (u) =>
        u.displayName.toLowerCase().includes(term) ||
        u.userPrincipalName.toLowerCase().includes(term),
    );
  }, [uncoveredUsers, searchTerm]);

  const filteredUncoveredApps = useMemo(() => {
    if (!searchTerm.trim()) return uncoveredApps;
    const term = searchTerm.toLowerCase();
    return uncoveredApps.filter((a) => a.displayName.toLowerCase().includes(term));
  }, [uncoveredApps, searchTerm]);

  const filteredCoveredUsers = useMemo(() => {
    if (!searchTerm.trim()) return coveredUsers;
    const term = searchTerm.toLowerCase();
    return coveredUsers.filter(
      (u) =>
        u.displayName.toLowerCase().includes(term) ||
        u.userPrincipalName.toLowerCase().includes(term),
    );
  }, [coveredUsers, searchTerm]);

  const filteredCoveredApps = useMemo(() => {
    if (!searchTerm.trim()) return coveredApps;
    const term = searchTerm.toLowerCase();
    return coveredApps.filter((a) => a.displayName.toLowerCase().includes(term));
  }, [coveredApps, searchTerm]);

  return (
    <div style={containerStyle} data-testid="coverage-view">
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 600 }}>Policy Coverage & Gaps</h2>
          <p style={{ margin: "4px 0 0 0", fontSize: "14px", color: "var(--text-secondary, #4b5563)" }}>
            Evaluate which directory identities and applications are shielded by Conditional Access policies.
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
            data-testid="refresh-coverage-btn"
          >
            Refresh Coverage
          </button>
        )}
      </div>

      {/* KPI Cards */}
      <div style={kpiGridStyle} data-testid="coverage-kpi-cards">
        <div style={kpiCardStyle}>
          <span style={kpiLabelStyle}>User Coverage</span>
          <span style={kpiValueStyle} data-testid="user-coverage-pct">
            {summary ? `${summary.userCoveragePct}%` : "—"}
          </span>
          <span style={{ fontSize: "12px", color: "var(--text-muted, #6b7280)" }}>
            {summary ? `${summary.coveredUsersCount} of ${summary.totalUsers} users` : ""}
          </span>
        </div>

        <div style={kpiCardStyle}>
          <span style={kpiLabelStyle}>Application Coverage</span>
          <span style={kpiValueStyle} data-testid="app-coverage-pct">
            {summary ? `${summary.appCoveragePct}%` : "—"}
          </span>
          <span style={{ fontSize: "12px", color: "var(--text-muted, #6b7280)" }}>
            {summary ? `${summary.coveredAppsCount} of ${summary.totalApps} cloud apps` : ""}
          </span>
        </div>

        <div style={kpiCardStyle}>
          <span style={kpiLabelStyle}>Identified Gaps</span>
          <span
            style={{
              ...kpiValueStyle,
              color: gaps.length > 0 ? "#ea580c" : "var(--text, #111827)",
            }}
            data-testid="gaps-count"
          >
            {summary?.totalGapsCount ?? gaps.length}
          </span>
          <span style={{ fontSize: "12px", color: "var(--text-muted, #6b7280)" }}>
            Uncovered categories
          </span>
        </div>

        <div style={kpiCardStyle}>
          <span style={kpiLabelStyle}>Active Policies</span>
          <span style={kpiValueStyle} data-testid="active-policies-count">
            {summary?.activePoliciesCount ?? 0}
          </span>
          <span style={{ fontSize: "12px", color: "var(--text-muted, #6b7280)" }}>
            Enforced policies
          </span>
        </div>
      </div>

      {/* Error display */}
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
          data-testid="coverage-error"
        >
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--text-muted, #6b7280)" }} data-testid="coverage-loading">
          Evaluating directory accounts and cloud applications coverage...
        </div>
      )}

      {/* Coverage Gap Callout Banners */}
      {!loading && gaps.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }} data-testid="gaps-callout-list">
          {gaps.map((g, idx) => (
            <div key={idx} style={gapCardStyle} data-testid={`gap-item-${idx}`}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span
                  style={badgeStyle(
                    g.severity === "high" ? "#fee2e2" : "#fef3c7",
                    g.severity === "high" ? "#991b1b" : "#92400e",
                  )}
                >
                  {g.severity.toUpperCase()}
                </span>
                <strong style={{ fontSize: "14px", color: "#9a3412" }}>{g.title}</strong>
              </div>
              <span style={{ fontSize: "13px", color: "#7c2d12" }}>{g.description}</span>
            </div>
          ))}
        </div>
      )}

      {/* Search Input */}
      {!loading && (
        <div>
          <input
            type="text"
            placeholder="Search accounts or applications..."
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
            data-testid="coverage-search-input"
          />
        </div>
      )}

      {/* Tab Navigation */}
      <div style={tabNavStyle}>
        <button
          type="button"
          style={tabBtnStyle(activeTab === "gaps")}
          onClick={() => setActiveTab("gaps")}
          data-testid="tab-gaps"
        >
          Uncovered Gaps ({uncoveredUsers.length + uncoveredApps.length})
        </button>
        <button
          type="button"
          style={tabBtnStyle(activeTab === "covered-users")}
          onClick={() => setActiveTab("covered-users")}
          data-testid="tab-covered-users"
        >
          Covered Users ({coveredUsers.length})
        </button>
        <button
          type="button"
          style={tabBtnStyle(activeTab === "covered-apps")}
          onClick={() => setActiveTab("covered-apps")}
          data-testid="tab-covered-apps"
        >
          Covered Apps ({coveredApps.length})
        </button>
      </div>

      {/* Tab Content: GAPS */}
      {!loading && activeTab === "gaps" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }} data-testid="tab-content-gaps">
          {/* Uncovered Users Section */}
          <div style={{ borderRadius: "8px", border: "1px solid var(--border, #e5e7eb)", overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", backgroundColor: "var(--bg-secondary, #f9fafb)", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
              <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600 }}>
                Uncovered Accounts ({filteredUncoveredUsers.length})
              </h3>
            </div>
            {filteredUncoveredUsers.length > 0 ? (
              <table style={tableStyle} data-testid="uncovered-users-table">
                <thead>
                  <tr>
                    <th style={thStyle}>Name</th>
                    <th style={thStyle}>User Principal Name</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUncoveredUsers.map((u) => (
                    <tr key={u.id}>
                      <td style={tdStyle}><strong>{u.displayName}</strong></td>
                      <td style={tdStyle}>{u.userPrincipalName}</td>
                      <td style={tdStyle}>
                        <span style={badgeStyle("#f3f4f6", "#374151")}>{u.userType}</span>
                      </td>
                      <td style={tdStyle}>
                        <span style={badgeStyle("#fee2e2", "#991b1b")}>Unprotected</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted, #6b7280)", fontSize: "13px" }}>
                All user accounts are covered by at least one policy.
              </div>
            )}
          </div>

          {/* Uncovered Apps Section */}
          <div style={{ borderRadius: "8px", border: "1px solid var(--border, #e5e7eb)", overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", backgroundColor: "var(--bg-secondary, #f9fafb)", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
              <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600 }}>
                Uncovered Cloud Applications ({filteredUncoveredApps.length})
              </h3>
            </div>
            {filteredUncoveredApps.length > 0 ? (
              <table style={tableStyle} data-testid="uncovered-apps-table">
                <thead>
                  <tr>
                    <th style={thStyle}>Application Name</th>
                    <th style={thStyle}>App ID</th>
                    <th style={thStyle}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUncoveredApps.map((a) => (
                    <tr key={a.appId}>
                      <td style={tdStyle}><strong>{a.displayName}</strong></td>
                      <td style={{ ...tdStyle, fontFamily: "monospace" }}>{a.appId}</td>
                      <td style={tdStyle}>
                        <span style={badgeStyle("#fee2e2", "#991b1b")}>Unprotected</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted, #6b7280)", fontSize: "13px" }}>
                All cloud applications are covered by at least one policy.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab Content: COVERED USERS */}
      {!loading && activeTab === "covered-users" && (
        <div style={{ borderRadius: "8px", border: "1px solid var(--border, #e5e7eb)", overflow: "hidden" }} data-testid="tab-content-covered-users">
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>User Principal Name</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Applied Policies</th>
              </tr>
            </thead>
            <tbody>
              {filteredCoveredUsers.map((u) => (
                <tr key={u.id}>
                  <td style={tdStyle}><strong>{u.displayName}</strong></td>
                  <td style={tdStyle}>{u.userPrincipalName}</td>
                  <td style={tdStyle}>
                    <span style={badgeStyle("#f3f4f6", "#374151")}>{u.userType}</span>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                      {u.policies.map((p) => (
                        <span key={p.id} style={badgeStyle("#dbeafe", "#1e40af")}>
                          {p.displayName}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab Content: COVERED APPS */}
      {!loading && activeTab === "covered-apps" && (
        <div style={{ borderRadius: "8px", border: "1px solid var(--border, #e5e7eb)", overflow: "hidden" }} data-testid="tab-content-covered-apps">
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Application Name</th>
                <th style={thStyle}>App ID</th>
                <th style={thStyle}>Applied Policies</th>
              </tr>
            </thead>
            <tbody>
              {filteredCoveredApps.map((a) => (
                <tr key={a.appId}>
                  <td style={tdStyle}><strong>{a.displayName}</strong></td>
                  <td style={{ ...tdStyle, fontFamily: "monospace" }}>{a.appId}</td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                      {a.policies.map((p) => (
                        <span key={p.id} style={badgeStyle("#dbeafe", "#1e40af")}>
                          {p.displayName}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
