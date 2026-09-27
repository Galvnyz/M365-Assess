"use client";

// FleetTable component (EPIC-004 SPEC.md §3.3, §4.1, T-0066).
// Renders all-tenants fleet posture view over FleetPayload with DataTable-style
// sorting, filtering, and row click-through to per-tenant dashboards (/dashboard/:tenantId).
// Strictly uses report theme tokens with zero colour literals.

import React, { useState, useMemo, type CSSProperties, type ReactElement } from "react";

export interface FleetFindingCounts {
  readonly pass: number;
  readonly fail: number;
  readonly warning: number;
  readonly total: number;
}

export interface AlertsOverviewWidget {
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
  readonly total: number;
}

export interface FleetTenantItem {
  readonly tenantId: string;
  readonly displayName: string | null;
  readonly defaultDomain: string | null;
  readonly status: string;
  readonly hasCompletedRun: boolean;
  readonly score: number | null;
  readonly complianceRate: number | null;
  readonly lastRunAt: string | null;
  readonly lastRunId: string | null;
  readonly lastRunStatus: string | null;
  readonly findingCounts: FleetFindingCounts | null;
  readonly openAlerts: AlertsOverviewWidget;
}

export interface FleetPayload {
  readonly schemaVersion: string;
  readonly items: readonly FleetTenantItem[];
  readonly total: number;
  readonly generatedAt: string;
}

export interface FleetTableProps {
  readonly fleet?: FleetPayload | null;
  readonly onSelectTenant?: (tenantId: string) => void;
  readonly onRunAssessment?: (tenantId: string) => void;
  readonly className?: string;
  readonly style?: CSSProperties;
}

type SortColumn = "name" | "status" | "score" | "compliance" | "alerts" | "lastRun";
type SortDirection = "asc" | "desc";

function formatTimestamp(isoString?: string | null): string {
  if (!isoString) return "Never";
  try {
    return new Date(isoString).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

export function FleetTable(props: FleetTableProps): ReactElement {
  const { fleet, onSelectTenant, onRunAssessment, className, style } = props;

  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "completed" | "unassessed" | "alerts">("all");
  const [sortCol, setSortCol] = useState<SortColumn>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  const items = useMemo(() => fleet?.items ?? [], [fleet]);

  const handleSort = (column: SortColumn) => {
    if (sortCol === column) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(column);
      setSortDir("asc");
    }
  };

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // 1. Text Search
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matchesName = (item.displayName ?? "").toLowerCase().includes(q);
        const matchesDomain = (item.defaultDomain ?? "").toLowerCase().includes(q);
        const matchesId = item.tenantId.toLowerCase().includes(q);
        if (!matchesName && !matchesDomain && !matchesId) return false;
      }

      // 2. Filter mode
      if (filterMode === "completed" && !item.hasCompletedRun) return false;
      if (filterMode === "unassessed" && item.hasCompletedRun) return false;
      if (filterMode === "alerts" && (item.openAlerts?.total ?? 0) <= 0) return false;

      return true;
    });
  }, [items, search, filterMode]);

  const sortedItems = useMemo(() => {
    const list = [...filteredItems];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "name":
          cmp = (a.displayName || a.tenantId).localeCompare(b.displayName || b.tenantId);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "score":
          cmp = (a.score ?? -1) - (b.score ?? -1);
          break;
        case "compliance":
          cmp = (a.complianceRate ?? -1) - (b.complianceRate ?? -1);
          break;
        case "alerts": {
          const totalA = a.openAlerts?.total ?? 0;
          const totalB = b.openAlerts?.total ?? 0;
          cmp = totalA - totalB;
          break;
        }
        case "lastRun": {
          const timeA = a.lastRunAt ? new Date(a.lastRunAt).getTime() : 0;
          const timeB = b.lastRunAt ? new Date(b.lastRunAt).getTime() : 0;
          cmp = timeA - timeB;
          break;
        }
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filteredItems, sortCol, sortDir]);

  return (
    <div
      data-testid="fleet-table-container"
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        width: "100%",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        color: "var(--text)",
        ...style,
      }}
    >
      {/* Controls Bar: Search & Filters */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        {/* Search */}
        <div style={{ position: "relative", minWidth: "260px" }}>
          <input
            type="text"
            data-testid="fleet-search-input"
            placeholder="Search fleet tenants..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: "8px 12px",
              background: "var(--input-bg, var(--bg))",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius, 6px)",
              color: "var(--text)",
              fontSize: "13px",
              width: "100%",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Filter Chips */}
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {(
            [
              { id: "all", label: `All (${items.length})` },
              { id: "completed", label: `Assessed (${items.filter((i) => i.hasCompletedRun).length})` },
              { id: "unassessed", label: `Unassessed (${items.filter((i) => !i.hasCompletedRun).length})` },
              { id: "alerts", label: `With Alerts (${items.filter((i) => (i.openAlerts?.total ?? 0) > 0).length})` },
            ] as const
          ).map((filter) => {
            const isActive = filterMode === filter.id;
            return (
              <button
                key={filter.id}
                type="button"
                data-testid={`fleet-filter-${filter.id}`}
                onClick={() => setFilterMode(filter.id)}
                style={{
                  padding: "5px 12px",
                  fontSize: "12px",
                  fontWeight: 600,
                  borderRadius: "999px",
                  border: isActive ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: isActive ? "var(--accent-soft)" : "var(--surface)",
                  color: isActive ? "var(--accent-text)" : "var(--text-soft)",
                  cursor: "pointer",
                }}
              >
                {filter.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table Container */}
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius, 10px)",
          boxShadow: "var(--shadow-card)",
          overflowX: "auto",
        }}
      >
        <table
          data-testid="fleet-table"
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "13px",
            textAlign: "left",
          }}
        >
          <thead>
            <tr
              style={{
                borderBottom: "1px solid var(--border)",
                background: "var(--bg-elev)",
                color: "var(--muted)",
                fontSize: "12px",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              <th
                data-testid="sort-name"
                onClick={() => handleSort("name")}
                style={{ padding: "12px 16px", cursor: "pointer" }}
              >
                Tenant {sortCol === "name" && (sortDir === "asc" ? "▲" : "▼")}
              </th>
              <th
                data-testid="sort-status"
                onClick={() => handleSort("status")}
                style={{ padding: "12px 16px", cursor: "pointer" }}
              >
                Status {sortCol === "status" && (sortDir === "asc" ? "▲" : "▼")}
              </th>
              <th
                data-testid="sort-score"
                onClick={() => handleSort("score")}
                style={{ padding: "12px 16px", cursor: "pointer" }}
              >
                Secure Score {sortCol === "score" && (sortDir === "asc" ? "▲" : "▼")}
              </th>
              <th
                data-testid="sort-compliance"
                onClick={() => handleSort("compliance")}
                style={{ padding: "12px 16px", cursor: "pointer" }}
              >
                Compliance {sortCol === "compliance" && (sortDir === "asc" ? "▲" : "▼")}
              </th>
              <th
                data-testid="sort-alerts"
                onClick={() => handleSort("alerts")}
                style={{ padding: "12px 16px", cursor: "pointer" }}
              >
                Open Alerts {sortCol === "alerts" && (sortDir === "asc" ? "▲" : "▼")}
              </th>
              <th
                data-testid="sort-lastRun"
                onClick={() => handleSort("lastRun")}
                style={{ padding: "12px 16px", cursor: "pointer" }}
              >
                Last Assessment {sortCol === "lastRun" && (sortDir === "asc" ? "▲" : "▼")}
              </th>
              <th style={{ padding: "12px 16px", textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedItems.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  data-testid="fleet-table-empty"
                  style={{
                    padding: "36px 16px",
                    textAlign: "center",
                    color: "var(--muted)",
                  }}
                >
                  No tenants match your search and filter criteria.
                </td>
              </tr>
            ) : (
              sortedItems.map((item) => {
                const totalAlerts = item.openAlerts?.total ?? 0;
                const criticalCount = item.openAlerts?.critical ?? 0;
                const highCount = item.openAlerts?.high ?? 0;

                return (
                  <tr
                    key={item.tenantId}
                    data-testid={`fleet-row-${item.tenantId}`}
                    onClick={() => onSelectTenant?.(item.tenantId)}
                    style={{
                      borderBottom: "1px solid var(--border)",
                      cursor: "pointer",
                      transition: "background 0.15s ease",
                    }}
                  >
                    {/* Tenant Name and Domain */}
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <a
                          href={`/dashboard/${encodeURIComponent(item.tenantId)}`}
                          data-testid={`fleet-link-${item.tenantId}`}
                          onClick={(e) => {
                            if (onSelectTenant) {
                              e.preventDefault();
                              onSelectTenant(item.tenantId);
                            }
                          }}
                          style={{
                            fontWeight: 600,
                            color: "var(--text)",
                            textDecoration: "none",
                          }}
                        >
                          {item.displayName || item.tenantId}
                        </a>
                        {item.defaultDomain && (
                          <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                            {item.defaultDomain}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Status */}
                    <td style={{ padding: "12px 16px" }}>
                      <span
                        data-testid={`status-badge-${item.tenantId}`}
                        style={{
                          fontSize: "11px",
                          fontWeight: 600,
                          padding: "2px 8px",
                          borderRadius: "999px",
                          textTransform: "capitalize",
                          background:
                            item.status === "active" ? "var(--success-soft)" : "var(--surface)",
                          color:
                            item.status === "active" ? "var(--success-text)" : "var(--text-soft)",
                          border:
                            item.status === "active"
                              ? "1px solid var(--success)"
                              : "1px solid var(--border)",
                        }}
                      >
                        {item.status}
                      </span>
                    </td>

                    {/* Secure Score */}
                    <td style={{ padding: "12px 16px" }}>
                      {item.score !== null ? (
                        <span
                          data-testid={`score-value-${item.tenantId}`}
                          style={{
                            fontWeight: 700,
                            fontVariantNumeric: "tabular-nums",
                            color: "var(--accent-text)",
                          }}
                        >
                          {item.score}%
                        </span>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>

                    {/* Compliance */}
                    <td style={{ padding: "12px 16px" }}>
                      {item.complianceRate !== null ? (
                        <span
                          data-testid={`compliance-value-${item.tenantId}`}
                          style={{
                            fontWeight: 600,
                            fontVariantNumeric: "tabular-nums",
                            color: item.complianceRate >= 80 ? "var(--success-text)" : "var(--warn-text)",
                          }}
                        >
                          {item.complianceRate}%
                        </span>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>

                    {/* Alerts */}
                    <td style={{ padding: "12px 16px" }}>
                      {totalAlerts > 0 ? (
                        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                          {criticalCount > 0 && (
                            <span
                              data-testid={`alert-crit-${item.tenantId}`}
                              style={{
                                fontSize: "11px",
                                fontWeight: 600,
                                padding: "1px 6px",
                                borderRadius: "999px",
                                background: "var(--danger-soft)",
                                color: "var(--danger-text)",
                                border: "1px solid var(--danger)",
                              }}
                            >
                              {criticalCount} Crit
                            </span>
                          )}
                          {highCount > 0 && (
                            <span
                              data-testid={`alert-high-${item.tenantId}`}
                              style={{
                                fontSize: "11px",
                                fontWeight: 600,
                                padding: "1px 6px",
                                borderRadius: "999px",
                                background: "var(--warn-soft)",
                                color: "var(--warn-text)",
                                border: "1px solid var(--warn)",
                              }}
                            >
                              {highCount} High
                            </span>
                          )}
                          <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                            {totalAlerts} total
                          </span>
                        </div>
                      ) : (
                        <span style={{ fontSize: "12px", color: "var(--success-text)" }}>
                          ✓ None
                        </span>
                      )}
                    </td>

                    {/* Last Assessment */}
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span
                          data-testid={`last-run-${item.tenantId}`}
                          style={{ fontSize: "12px", color: "var(--text)" }}
                        >
                          {formatTimestamp(item.lastRunAt)}
                        </span>
                        {item.lastRunStatus && (
                          <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                            Status: {item.lastRunStatus}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Actions */}
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      <div
                        style={{
                          display: "inline-flex",
                          gap: "8px",
                          alignItems: "center",
                          justifyContent: "flex-end",
                        }}
                      >
                        {!item.hasCompletedRun && onRunAssessment && (
                          <button
                            type="button"
                            data-testid={`fleet-run-btn-${item.tenantId}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onRunAssessment(item.tenantId);
                            }}
                            style={{
                              padding: "4px 8px",
                              fontSize: "11px",
                              fontWeight: 600,
                              background: "var(--accent)",
                              color: "var(--on-accent)",
                              border: "1px solid var(--accent)",
                              borderRadius: "var(--radius, 4px)",
                              cursor: "pointer",
                            }}
                          >
                            Run
                          </button>
                        )}

                        <a
                          href={`/dashboard/${encodeURIComponent(item.tenantId)}`}
                          data-testid={`view-dashboard-btn-${item.tenantId}`}
                          onClick={(e) => {
                            if (onSelectTenant) {
                              e.preventDefault();
                              onSelectTenant(item.tenantId);
                            }
                          }}
                          style={{
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "var(--accent-text)",
                            textDecoration: "none",
                            padding: "4px 8px",
                            borderRadius: "var(--radius, 4px)",
                          }}
                        >
                          Dashboard →
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
