"use client";

// FindingsDrillThrough component (EPIC-004 SPEC.md §3.1, §4.2, T-0069).
// Shared findings table for widget drill-through with full nine-status and severity token vocabulary,
// interactive filter chips, search filtering, and finding detail navigation.
// Strictly uses report theme tokens with zero colour literals.

import React, { useState, useMemo, type CSSProperties, type ReactElement } from "react";
import {
  type FindingsFilter,
  type FindingLike,
  matchesFindingsFilter,
} from "../../lib/findings-filter";

export interface FindingItem extends FindingLike {
  readonly id: string;
  readonly runId?: string;
  readonly tenantId?: string;
  readonly status: string; // Pass, Fail, Warning, Review, Info, Skipped, Unknown, NotApplicable, NotLicensed
  readonly severity?: string | null; // Critical, High, Medium, Low
  readonly category?: string | null;
  readonly collector?: string | null;
  readonly controlName?: string | null;
  readonly title?: string;
  readonly message?: string;
  readonly currentValue?: string | null;
  readonly recommendedValue?: string | null;
  readonly frameworkRefs?: readonly string[];
}

export interface FindingsDrillThroughProps {
  /** Complete list of findings */
  readonly findings: readonly FindingItem[];
  /** Active findings filter */
  readonly filter?: FindingsFilter;
  /** Filter update callback */
  readonly onFilterChange?: (filter: FindingsFilter) => void;
  /** Drill-down click callback to view finding in detail */
  readonly onNavigateToFinding?: (findingId: string) => void;
  /** Custom class name */
  readonly className?: string;
  /** Custom inline style */
  readonly style?: CSSProperties;
}

// 02-ui-design.md §3.1: status token contract across all nine statuses
function getStatusBadgeStyle(status: string): CSSProperties {
  const s = status.toLowerCase();
  switch (s) {
    case "pass":
      return {
        background: "var(--success-soft)",
        color: "var(--success-text)",
        border: "1px solid var(--success)",
      };
    case "fail":
      return {
        background: "var(--danger-soft)",
        color: "var(--danger-text)",
        border: "1px solid var(--danger)",
      };
    case "warning":
    case "warn":
      return {
        background: "var(--warn-soft)",
        color: "var(--warn-text)",
        border: "1px solid var(--warn)",
      };
    case "review":
      return {
        background: "var(--accent-soft)",
        color: "var(--accent-text)",
        border: "1px solid var(--accent)",
      };
    case "info":
      return {
        background: "var(--subtle)",
        color: "var(--text-soft)",
        border: "1px solid var(--chip, var(--border))",
      };
    case "skipped":
      return {
        background: "var(--subtle)",
        color: "var(--muted)",
        border: "1px solid var(--chip, var(--border))",
      };
    case "unknown":
      return {
        background: "var(--warn-soft)",
        color: "var(--warn-text)",
        border: "1px solid var(--warn)",
      };
    case "notapplicable":
    case "na":
      return {
        background: "var(--subtle)",
        color: "var(--text-soft)",
        border: "1px solid var(--chip, var(--border))",
      };
    case "notlicensed":
      return {
        background: "var(--subtle)",
        color: "var(--accent-text)",
        border: "1px solid var(--chip, var(--border))",
      };
    default:
      return {
        background: "var(--subtle)",
        color: "var(--text-soft)",
        border: "1px solid var(--border)",
      };
  }
}

// Severity tokens: Critical, High, Medium, Low
function getSeverityBadgeStyle(severity?: string | null): CSSProperties {
  const s = (severity || "").toLowerCase();
  switch (s) {
    case "critical":
      return {
        background: "var(--danger-soft)",
        color: "var(--danger-text)",
        border: "1px solid var(--danger)",
      };
    case "high":
      return {
        background: "var(--warn-soft)",
        color: "var(--warn-text)",
        border: "1px solid var(--warn)",
      };
    case "medium":
      return {
        background: "var(--warn-soft)",
        color: "var(--warn-text)",
        border: "1px solid var(--warn)",
      };
    case "low":
      return {
        background: "var(--accent-soft)",
        color: "var(--accent-text)",
        border: "1px solid var(--accent)",
      };
    default:
      return {
        background: "var(--subtle)",
        color: "var(--muted)",
        border: "1px solid var(--border)",
      };
  }
}

export function FindingsDrillThrough(props: FindingsDrillThroughProps): ReactElement {
  const {
    findings = [],
    filter: externalFilter,
    onFilterChange,
    onNavigateToFinding,
    className,
    style,
  } = props;

  const [internalFilter, setInternalFilter] = useState<FindingsFilter>({});
  const activeFilter = externalFilter !== undefined ? externalFilter : internalFilter;

  const updateFilter = (newFilter: FindingsFilter) => {
    if (externalFilter === undefined) {
      setInternalFilter(newFilter);
    }
    onFilterChange?.(newFilter);
  };

  const filteredFindings = useMemo(() => {
    return findings.filter((f) => matchesFindingsFilter(f, activeFilter));
  }, [findings, activeFilter]);

  const activeChips = useMemo(() => {
    const chips: { key: keyof FindingsFilter; label: string; value: string }[] = [];
    if (activeFilter.status) {
      chips.push({ key: "status", label: "Status", value: activeFilter.status });
    }
    if (activeFilter.severity) {
      chips.push({ key: "severity", label: "Severity", value: activeFilter.severity });
    }
    if (activeFilter.category) {
      chips.push({ key: "category", label: "Category", value: activeFilter.category });
    }
    if (activeFilter.collector) {
      chips.push({ key: "collector", label: "Collector", value: activeFilter.collector });
    }
    if (activeFilter.tenantId) {
      chips.push({ key: "tenantId", label: "Tenant", value: activeFilter.tenantId });
    }
    if (activeFilter.search) {
      chips.push({ key: "search", label: "Query", value: activeFilter.search });
    }
    return chips;
  }, [activeFilter]);

  const handleRemoveChip = (key: keyof FindingsFilter) => {
    const next = { ...activeFilter, [key]: null };
    updateFilter(next);
  };

  const handleClearAll = () => {
    updateFilter({});
  };

  return (
    <div
      data-testid="findings-drill-through-container"
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
      {/* Filter and Search Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius, 8px)",
          padding: "12px 16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: "260px" }}>
          <input
            type="text"
            data-testid="findings-search-input"
            placeholder="Search filtered findings..."
            value={activeFilter.search || ""}
            onChange={(e) => updateFilter({ ...activeFilter, search: e.target.value || null })}
            style={{
              padding: "7px 12px",
              background: "var(--input-bg, var(--bg))",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius, 6px)",
              color: "var(--text)",
              fontSize: "13px",
              width: "100%",
              maxWidth: "360px",
              boxSizing: "border-box",
            }}
          />

          <span
            data-testid="findings-count-badge"
            style={{ fontSize: "12px", color: "var(--muted)", whiteSpace: "nowrap" }}
          >
            {filteredFindings.length} of {findings.length} findings
          </span>
        </div>

        {/* Filter Chips */}
        {activeChips.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
            {activeChips.map((chip) => (
              <span
                key={chip.key}
                data-testid={`active-filter-chip-${chip.key}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "3px 8px",
                  borderRadius: "999px",
                  background: "var(--accent-soft)",
                  border: "1px solid var(--accent)",
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "var(--accent-text)",
                }}
              >
                <span>
                  {chip.label}: {chip.value}
                </span>
                <button
                  type="button"
                  data-testid={`remove-filter-${chip.key}`}
                  onClick={() => handleRemoveChip(chip.key)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--accent-text)",
                    cursor: "pointer",
                    padding: 0,
                    fontSize: "13px",
                    lineHeight: 1,
                  }}
                  aria-label={`Remove ${chip.label} filter`}
                >
                  ×
                </button>
              </span>
            ))}

            <button
              type="button"
              data-testid="clear-all-filters-btn"
              onClick={handleClearAll}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--muted)",
                fontSize: "12px",
                cursor: "pointer",
                padding: "2px 6px",
                textDecoration: "underline",
              }}
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* Findings Table */}
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
          data-testid="findings-table"
          style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", textAlign: "left" }}
        >
          <thead>
            <tr
              style={{
                borderBottom: "1px solid var(--border)",
                background: "var(--bg-elev)",
                color: "var(--muted)",
                fontSize: "11px",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              <th style={{ padding: "10px 14px" }}>Status</th>
              <th style={{ padding: "10px 14px" }}>Severity</th>
              <th style={{ padding: "10px 14px" }}>Control ID & Name</th>
              <th style={{ padding: "10px 14px" }}>Category</th>
              <th style={{ padding: "10px 14px" }}>Details</th>
              <th style={{ padding: "10px 14px", textAlign: "right" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredFindings.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  data-testid="findings-table-empty"
                  style={{ padding: "40px 16px", textAlign: "center", color: "var(--muted)" }}
                >
                  No findings match the current filter criteria.
                </td>
              </tr>
            ) : (
              filteredFindings.map((finding) => {
                const statusStyle = getStatusBadgeStyle(finding.status);
                const sevStyle = getSeverityBadgeStyle(finding.severity);

                return (
                  <tr
                    key={finding.id}
                    data-testid={`finding-row-${finding.id}`}
                    onClick={() => onNavigateToFinding?.(finding.id)}
                    style={{
                      borderBottom: "1px solid var(--border)",
                      cursor: onNavigateToFinding ? "pointer" : "default",
                      transition: "background 0.15s ease",
                    }}
                  >
                    {/* Status Badge */}
                    <td style={{ padding: "10px 14px" }}>
                      <span
                        data-testid={`finding-status-${finding.id}`}
                        style={{
                          fontSize: "11px",
                          fontWeight: 600,
                          padding: "2px 8px",
                          borderRadius: "999px",
                          display: "inline-block",
                          ...statusStyle,
                        }}
                      >
                        {finding.status}
                      </span>
                    </td>

                    {/* Severity Badge */}
                    <td style={{ padding: "10px 14px" }}>
                      {finding.severity ? (
                        <span
                          data-testid={`finding-severity-${finding.id}`}
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            padding: "2px 8px",
                            borderRadius: "999px",
                            display: "inline-block",
                            ...sevStyle,
                          }}
                        >
                          {finding.severity}
                        </span>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>

                    {/* Control ID & Name */}
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontWeight: 600, color: "var(--text)" }}>
                          {finding.controlName || finding.title || finding.id}
                        </span>
                        <code
                          style={{
                            fontSize: "11px",
                            color: "var(--muted)",
                            fontFamily: "var(--font-mono, monospace)",
                          }}
                        >
                          {finding.id}
                        </code>
                      </div>
                    </td>

                    {/* Category */}
                    <td style={{ padding: "10px 14px", color: "var(--text-soft)" }}>
                      {finding.category || "General"}
                    </td>

                    {/* Details / Message */}
                    <td style={{ padding: "10px 14px", color: "var(--muted)", maxWidth: "320px" }}>
                      <div
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={finding.message || ""}
                      >
                        {finding.message || "—"}
                      </div>
                    </td>

                    {/* Action */}
                    <td style={{ padding: "10px 14px", textAlign: "right" }}>
                      <button
                        type="button"
                        data-testid={`finding-action-btn-${finding.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onNavigateToFinding?.(finding.id);
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "var(--accent-text)",
                          fontSize: "12px",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Details →
                      </button>
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
