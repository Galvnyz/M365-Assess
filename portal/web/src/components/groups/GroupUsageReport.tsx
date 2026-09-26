"use client";

// GroupUsageReport — Group activity and usage metrics component (EPIC-014 SPEC.md §3.5, §11.3; T-0270).
// Read-only surface: shows membership growth, inactive groups, ownerless groups, and guest metrics.
// No cleanup write path is introduced here.
import React, { type CSSProperties, type ReactElement } from "react";

export interface GroupUsageSummary {
  readonly totalGroups: number;
  readonly ownerlessGroupsCount: number;
  readonly inactiveGroupsCount: number;
  readonly totalGuestsCount: number;
  readonly totalMembersCount: number;
}

export interface GroupMembershipGrowthPoint {
  readonly period: string;
  readonly memberCount: number;
}

export interface OwnerlessGroupItem {
  readonly id: string;
  readonly displayName: string;
  readonly mail?: string;
  readonly groupType: string;
  readonly membersCount: number;
  readonly lastActivityDate?: string | null;
}

export interface InactiveGroupItem {
  readonly id: string;
  readonly displayName: string;
  readonly mail?: string;
  readonly groupType: string;
  readonly membersCount: number;
  readonly ownersCount: number;
  readonly lastActivityDate?: string | null;
  readonly daysInactive: number;
}

export interface GroupGuestMetrics {
  readonly totalGuests: number;
  readonly groupsWithGuestsCount: number;
  readonly topGuestGroups: ReadonlyArray<{
    readonly id: string;
    readonly displayName: string;
    readonly guestCount: number;
  }>;
}

export interface GroupUsageReportData {
  readonly tenantId: string;
  readonly generatedAt: string;
  readonly inactiveDaysThreshold: number;
  readonly summary: GroupUsageSummary;
  readonly membershipGrowth: readonly GroupMembershipGrowthPoint[];
  readonly ownerlessGroups: readonly OwnerlessGroupItem[];
  readonly inactiveGroups: readonly InactiveGroupItem[];
  readonly guestMetrics: GroupGuestMetrics;
}

export interface GroupUsageReportProps {
  readonly report?: GroupUsageReportData | null;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly inactiveDaysThreshold?: number;
  readonly onThresholdChange?: (threshold: number) => void;
  readonly onRefresh?: () => void;
}

const cardStyle: CSSProperties = {
  background: "var(--bg-elev, #ffffff)",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "var(--radius, 8px)",
  padding: "16px 20px",
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  flex: "1 1 180px",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "13px",
  textAlign: "left",
};

const thStyle: CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--border, #e5e7eb)",
  fontWeight: 600,
  color: "var(--text-muted, #6b7280)",
  background: "var(--bg-muted, #f9fafb)",
};

const tdStyle: CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--border, #f3f4f6)",
  verticalAlign: "middle",
};

const sectionStyle: CSSProperties = {
  background: "var(--bg-elev, #ffffff)",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "var(--radius, 10px)",
  padding: "20px",
  display: "flex",
  flexDirection: "column",
  gap: "14px",
};

export function GroupUsageReport({
  report,
  loading = false,
  error = null,
  inactiveDaysThreshold = 90,
  onThresholdChange,
  onRefresh,
}: GroupUsageReportProps): ReactElement {
  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted, #6b7280)" }} data-testid="usage-loading">
        Loading group usage report...
      </div>
    );
  }

  if (error) {
    return (
      <div
        data-testid="usage-error"
        style={{
          padding: "16px",
          background: "#fef2f2",
          border: "1px solid #fecaca",
          borderRadius: "8px",
          color: "#991b1b",
          fontSize: "14px",
        }}
      >
        <strong>Error loading report:</strong> {error}
      </div>
    );
  }

  if (!report) {
    return (
      <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted, #6b7280)" }} data-testid="usage-empty">
        No report data available.
      </div>
    );
  }

  const { summary, membershipGrowth, ownerlessGroups, inactiveGroups, guestMetrics } = report;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }} data-testid="group-usage-report">
      {/* Top Bar Controls */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <label htmlFor="select-threshold" style={{ fontSize: "13px", fontWeight: 600, color: "var(--text, #111827)" }}>
            Inactivity Window:
          </label>
          <select
            id="select-threshold"
            data-testid="select-threshold"
            value={inactiveDaysThreshold}
            onChange={(e) => onThresholdChange?.(parseInt(e.target.value, 10))}
            style={{
              padding: "6px 12px",
              borderRadius: "6px",
              border: "1px solid var(--border, #d1d5db)",
              background: "var(--input-bg, #ffffff)",
              fontSize: "13px",
            }}
          >
            <option value="30">30 days</option>
            <option value="60">60 days</option>
            <option value="90">90 days</option>
            <option value="180">180 days</option>
            <option value="365">1 year (365 days)</option>
          </select>
        </div>

        {onRefresh && (
          <button
            type="button"
            data-testid="btn-refresh"
            onClick={onRefresh}
            style={{
              padding: "6px 14px",
              background: "var(--bg-muted, #f3f4f6)",
              border: "1px solid var(--border, #d1d5db)",
              borderRadius: "6px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Refresh
          </button>
        )}
      </div>

      {/* KPI Cards */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }} data-testid="usage-kpis">
        <div style={cardStyle} data-testid="kpi-total-groups">
          <div style={{ fontSize: "12px", color: "var(--text-muted, #6b7280)", fontWeight: 500 }}>Total Groups</div>
          <div style={{ fontSize: "24px", fontWeight: 700, color: "var(--text, #111827)" }}>{summary.totalGroups}</div>
        </div>
        <div style={cardStyle} data-testid="kpi-total-members">
          <div style={{ fontSize: "12px", color: "var(--text-muted, #6b7280)", fontWeight: 500 }}>Total Memberships</div>
          <div style={{ fontSize: "24px", fontWeight: 700, color: "var(--text, #111827)" }}>{summary.totalMembersCount}</div>
        </div>
        <div style={cardStyle} data-testid="kpi-total-guests">
          <div style={{ fontSize: "12px", color: "var(--text-muted, #6b7280)", fontWeight: 500 }}>Total Guests</div>
          <div style={{ fontSize: "24px", fontWeight: 700, color: "#d97706" }}>{summary.totalGuestsCount}</div>
        </div>
        <div style={cardStyle} data-testid="kpi-ownerless-groups">
          <div style={{ fontSize: "12px", color: "var(--text-muted, #6b7280)", fontWeight: 500 }}>Ownerless Groups</div>
          <div style={{ fontSize: "24px", fontWeight: 700, color: summary.ownerlessGroupsCount > 0 ? "#dc2626" : "#166534" }}>
            {summary.ownerlessGroupsCount}
          </div>
        </div>
        <div style={cardStyle} data-testid="kpi-inactive-groups">
          <div style={{ fontSize: "12px", color: "var(--text-muted, #6b7280)", fontWeight: 500 }}>Inactive Groups ({report.inactiveDaysThreshold}d)</div>
          <div style={{ fontSize: "24px", fontWeight: 700, color: summary.inactiveGroupsCount > 0 ? "#ea580c" : "#166534" }}>
            {summary.inactiveGroupsCount}
          </div>
        </div>
      </div>

      {/* Membership Growth Trend */}
      <div style={sectionStyle} data-testid="section-membership-growth">
        <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0 }}>Membership Growth & Activity</h2>
        <table style={tableStyle} data-testid="table-membership-growth">
          <thead>
            <tr>
              <th style={thStyle}>Period</th>
              <th style={thStyle}>Total Member Count</th>
            </tr>
          </thead>
          <tbody>
            {membershipGrowth.map((point) => (
              <tr key={point.period} data-testid={`growth-row-${point.period}`}>
                <td style={tdStyle}>{point.period}</td>
                <td style={tdStyle}>{point.memberCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Ownerless Groups */}
      <div style={sectionStyle} data-testid="section-ownerless-groups">
        <div>
          <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0 }}>Ownerless Groups</h2>
          <div style={{ fontSize: "12px", color: "var(--text-muted, #6b7280)", marginTop: "2px" }}>
            Groups with no assigned owners. Read-only review list.
          </div>
        </div>

        {ownerlessGroups.length === 0 ? (
          <div style={{ fontSize: "13px", color: "#166534" }}>
            No ownerless groups detected.
          </div>
        ) : (
          <table style={tableStyle} data-testid="table-ownerless-groups">
            <thead>
              <tr>
                <th style={thStyle}>Group Name</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Members</th>
                <th style={thStyle}>Last Activity</th>
                <th style={thStyle}>Action</th>
              </tr>
            </thead>
            <tbody>
              {ownerlessGroups.map((g) => (
                <tr key={g.id} data-testid={`ownerless-row-${g.id}`}>
                  <td style={tdStyle}>
                    <strong>{g.displayName}</strong>
                    {g.mail && <div style={{ fontSize: "11px", color: "var(--text-muted, #6b7280)" }}>{g.mail}</div>}
                  </td>
                  <td style={tdStyle}>{g.groupType}</td>
                  <td style={tdStyle}>{g.membersCount}</td>
                  <td style={tdStyle}>{g.lastActivityDate ? new Date(g.lastActivityDate).toLocaleDateString() : "Never / Unknown"}</td>
                  <td style={tdStyle}>
                    <a
                      href={`/identity/groups?search=${encodeURIComponent(g.displayName)}`}
                      style={{ color: "var(--primary, #2563eb)", textDecoration: "none", fontWeight: 500 }}
                      data-testid={`link-ownerless-${g.id}`}
                    >
                      View Group
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Inactive Groups */}
      <div style={sectionStyle} data-testid="section-inactive-groups">
        <div>
          <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0 }}>
            Inactive Groups (&gt; {report.inactiveDaysThreshold} days)
          </h2>
          <div style={{ fontSize: "12px", color: "var(--text-muted, #6b7280)", marginTop: "2px" }}>
            Groups with no activity recorded beyond the configured threshold. Read-only review list.
          </div>
        </div>

        {inactiveGroups.length === 0 ? (
          <div style={{ fontSize: "13px", color: "#166534" }}>
            No inactive groups detected within this threshold.
          </div>
        ) : (
          <table style={tableStyle} data-testid="table-inactive-groups">
            <thead>
              <tr>
                <th style={thStyle}>Group Name</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Members</th>
                <th style={thStyle}>Owners</th>
                <th style={thStyle}>Days Inactive</th>
                <th style={thStyle}>Last Activity</th>
                <th style={thStyle}>Action</th>
              </tr>
            </thead>
            <tbody>
              {inactiveGroups.map((g) => (
                <tr key={g.id} data-testid={`inactive-row-${g.id}`}>
                  <td style={tdStyle}>
                    <strong>{g.displayName}</strong>
                    {g.mail && <div style={{ fontSize: "11px", color: "var(--text-muted, #6b7280)" }}>{g.mail}</div>}
                  </td>
                  <td style={tdStyle}>{g.groupType}</td>
                  <td style={tdStyle}>{g.membersCount}</td>
                  <td style={tdStyle}>{g.ownersCount}</td>
                  <td style={tdStyle}>
                    <span style={{ color: "#ea580c", fontWeight: 600 }}>{g.daysInactive} days</span>
                  </td>
                  <td style={tdStyle}>{g.lastActivityDate ? new Date(g.lastActivityDate).toLocaleDateString() : "Never / Unknown"}</td>
                  <td style={tdStyle}>
                    <a
                      href={`/identity/groups?search=${encodeURIComponent(g.displayName)}`}
                      style={{ color: "var(--primary, #2563eb)", textDecoration: "none", fontWeight: 500 }}
                      data-testid={`link-inactive-${g.id}`}
                    >
                      View Group
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Guest Metrics */}
      <div style={sectionStyle} data-testid="section-guest-metrics">
        <div>
          <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0 }}>Guest Metrics</h2>
          <div style={{ fontSize: "12px", color: "var(--text-muted, #6b7280)", marginTop: "2px" }}>
            Groups containing external guest accounts ({guestMetrics.groupsWithGuestsCount} groups with guests).
          </div>
        </div>

        {guestMetrics.topGuestGroups.length === 0 ? (
          <div style={{ fontSize: "13px", color: "var(--text-muted, #6b7280)" }}>
            No guest accounts found in any groups.
          </div>
        ) : (
          <table style={tableStyle} data-testid="table-guest-groups">
            <thead>
              <tr>
                <th style={thStyle}>Group Name</th>
                <th style={thStyle}>Guest Count</th>
              </tr>
            </thead>
            <tbody>
              {guestMetrics.topGuestGroups.map((g) => (
                <tr key={g.id} data-testid={`guest-row-${g.id}`}>
                  <td style={tdStyle}>
                    <strong>{g.displayName}</strong>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ fontWeight: 600 }}>{g.guestCount}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
