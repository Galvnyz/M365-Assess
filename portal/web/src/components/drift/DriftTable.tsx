"use client";

// Manage Drift table (EPIC-009 SPEC.md §3.1; T-0168).
// Breakdown `.kpi-strip` by triage state, a filters card (state, standard,
// resource type), bulk actions (Accept, Denied-Delete, Denied-Remediate), a
// `DataTable` (Standard/Property mono, Current, Expected, `status-badge`
// State, Reason, Expires, Last seen), and a row detail drawer with triage
// actions. Data comes from the T-0164 API; triage callbacks are owned by the
// page. Zero colour literals: report theme tokens only.

import React, { useMemo, useState, type CSSProperties, type ReactElement } from "react";
import type { DriftBreakdown, DriftDeviation, DriftDeviationState, DriftBulkAction } from "../../lib/driftApi";

export type DriftRowAction = "accept" | "override" | "deny";

export interface DriftTableProps {
  readonly deviations?: readonly DriftDeviation[];
  readonly breakdown?: DriftBreakdown | null;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onAccept?: (deviation: DriftDeviation) => void;
  readonly onOverride?: (deviation: DriftDeviation) => void;
  readonly onDeny?: (deviation: DriftDeviation) => void;
  readonly onBulk?: (action: DriftBulkAction, deviationIds: string[]) => void;
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  width: "100%",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
};

const kpiStripStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: "12px",
};

const kpiCardStyle: CSSProperties = {
  padding: "14px 16px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  boxShadow: "var(--shadow-card)",
  display: "flex",
  flexDirection: "column",
  gap: "4px",
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

const filterBarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
  alignItems: "center",
  padding: "12px 16px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
};

const inputStyle: CSSProperties = {
  padding: "8px 12px",
  background: "var(--input-bg, var(--bg))",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "14px",
};

const selectStyle: CSSProperties = { ...inputStyle, cursor: "pointer" };

const buttonStyle: CSSProperties = {
  padding: "8px 14px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "14px",
  fontWeight: 500,
  cursor: "pointer",
};

const tableWrapStyle: CSSProperties = {
  overflowX: "auto",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "13px",
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid var(--border)",
  color: "var(--text-soft)",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const tdStyle: CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--border)",
  verticalAlign: "top",
};

const monoStyle: CSSProperties = {
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: "12px",
  wordBreak: "break-all",
};

const statusBadgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 600,
  background: "var(--accent-soft)",
  color: "var(--accent-text)",
  border: "1px solid var(--accent)",
  whiteSpace: "nowrap",
};

const drawerStyle: CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  bottom: 0,
  width: "min(480px, 100vw)",
  background: "var(--bg-elev)",
  borderLeft: "1px solid var(--border)",
  boxShadow: "var(--shadow-card)",
  padding: "24px",
  overflowY: "auto",
  zIndex: 90,
  display: "flex",
  flexDirection: "column",
  gap: "14px",
  color: "var(--text)",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
};

const preStyle: CSSProperties = {
  ...monoStyle,
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  padding: "10px 12px",
  whiteSpace: "pre-wrap",
  margin: 0,
};

const actionBtnStyle: CSSProperties = {
  padding: "4px 8px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "4px",
  color: "var(--text)",
  fontSize: "12px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

export const DRIFT_STATES: readonly DriftDeviationState[] = [
  "open",
  "accepted",
  "customerSpecific",
  "denied",
  "deletePending",
  "resolved",
];

function stateLabel(state: DriftDeviationState): string {
  switch (state) {
    case "customerSpecific":
      return "Customer specific";
    case "deletePending":
      return "Delete pending";
    default:
      return state.charAt(0).toUpperCase() + state.slice(1);
  }
}

function toShortText(value: unknown, max = 80): string {
  if (value === null || value === undefined) return "—";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function toFullText(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export function DriftTable({
  deviations = [],
  breakdown = null,
  loading = false,
  error = null,
  onAccept,
  onOverride,
  onDeny,
  onBulk,
}: DriftTableProps): ReactElement {
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [standardFilter, setStandardFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = standardFilter.trim().toLowerCase();
    return deviations.filter((deviation) => {
      if (stateFilter !== "all" && deviation.state !== stateFilter) return false;
      if (kindFilter !== "all" && deviation.kind !== kindFilter) return false;
      if (
        needle.length > 0 &&
        !deviation.standardKey.toLowerCase().includes(needle) &&
        !deviation.resourceId.toLowerCase().includes(needle)
      ) {
        return false;
      }
      return true;
    });
  }, [deviations, stateFilter, standardFilter, kindFilter]);

  const drawerDeviation = useMemo(
    () => deviations.find((deviation) => deviation.id === drawerId) ?? null,
    [deviations, drawerId],
  );

  const toggleSelect = (id: string): void => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = (): void => {
    setSelected((previous) => {
      if (filtered.every((deviation) => previous.has(deviation.id))) {
        const next = new Set(previous);
        for (const deviation of filtered) next.delete(deviation.id);
        return next;
      }
      return new Set([...previous, ...filtered.map((deviation) => deviation.id)]);
    });
  };

  const handleBulk = (action: DriftBulkAction): void => {
    if (selected.size === 0 || !onBulk) return;
    onBulk(action, [...selected]);
  };

  const kpis: ReadonlyArray<{ key: string; label: string; value: number }> = breakdown
    ? [
        { key: "open", label: "Open", value: breakdown.open },
        { key: "accepted", label: "Accepted", value: breakdown.accepted },
        { key: "customerSpecific", label: "Customer specific", value: breakdown.customerSpecific },
        { key: "denied", label: "Denied", value: breakdown.denied },
        { key: "deletePending", label: "Delete pending", value: breakdown.deletePending },
        { key: "resolved", label: "Resolved", value: breakdown.resolved },
        { key: "total", label: "Total", value: breakdown.total },
      ]
    : [];

  return (
    <div style={containerStyle} data-testid="drift-table-wrap">
      {/* Breakdown KPI strip */}
      {breakdown && (
        <div style={kpiStripStyle} className="kpi-strip" data-testid="drift-kpi-strip">
          {kpis.map((kpi) => (
            <div key={kpi.key} style={kpiCardStyle} data-testid={`drift-kpi-${kpi.key}`}>
              <span style={kpiValueStyle}>{kpi.value}</span>
              <span style={kpiLabelStyle}>{kpi.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Filters card */}
      <div style={filterBarStyle} data-testid="drift-filters">
        <select
          style={selectStyle}
          aria-label="Filter by state"
          data-testid="drift-filter-state"
          value={stateFilter}
          onChange={(event) => setStateFilter(event.target.value)}
        >
          <option value="all">All states</option>
          {DRIFT_STATES.map((state) => (
            <option key={state} value={state}>
              {stateLabel(state)}
            </option>
          ))}
        </select>
        <input
          style={inputStyle}
          aria-label="Filter by standard"
          data-testid="drift-filter-standard"
          placeholder="Filter by standard or resource…"
          value={standardFilter}
          onChange={(event) => setStandardFilter(event.target.value)}
        />
        <select
          style={selectStyle}
          aria-label="Filter by resource type"
          data-testid="drift-filter-kind"
          value={kindFilter}
          onChange={(event) => setKindFilter(event.target.value)}
        >
          <option value="all">All resource types</option>
          <option value="mismatch">Mismatch</option>
          <option value="extra">Extra policy</option>
        </select>
        <span style={{ fontSize: "13px", color: "var(--text-soft)" }} data-testid="drift-count">
          {filtered.length} of {deviations.length} deviations
          {selected.size > 0 ? ` · ${selected.size} selected` : ""}
        </span>
      </div>

      {/* Bulk actions */}
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }} data-testid="drift-bulk-actions">
        <button
          type="button"
          style={buttonStyle}
          data-testid="drift-bulk-accept"
          disabled={selected.size === 0}
          onClick={() => handleBulk("accept")}
        >
          Accept
        </button>
        <button
          type="button"
          style={buttonStyle}
          data-testid="drift-bulk-deny-delete"
          disabled={selected.size === 0}
          onClick={() => handleBulk("deny-delete")}
        >
          Denied-Delete
        </button>
        <button
          type="button"
          style={buttonStyle}
          data-testid="drift-bulk-deny-remediate"
          disabled={selected.size === 0}
          onClick={() => handleBulk("deny-remediate")}
        >
          Denied-Remediate
        </button>
      </div>

      {loading && <div data-testid="drift-loading">Loading drift deviations…</div>}
      {error && (
        <div
          data-testid="drift-error"
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
      )}

      {/* DataTable */}
      {!loading && !error && (
        <div style={tableWrapStyle}>
          <table style={tableStyle} className="DataTable" data-testid="drift-table">
            <thead>
              <tr>
                <th style={thStyle}>
                  <input
                    type="checkbox"
                    aria-label="Select all deviations"
                    data-testid="drift-select-all"
                    checked={filtered.length > 0 && filtered.every((d) => selected.has(d.id))}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th style={thStyle}>Standard / Property</th>
                <th style={thStyle}>Current</th>
                <th style={thStyle}>Expected</th>
                <th style={thStyle}>State</th>
                <th style={thStyle}>Reason</th>
                <th style={thStyle}>Expires</th>
                <th style={thStyle}>Last seen</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((deviation) => (
                <tr key={deviation.id} data-testid={`drift-row-${deviation.id}`}>
                  <td style={tdStyle}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${deviation.standardKey}`}
                      data-testid={`drift-select-${deviation.id}`}
                      checked={selected.has(deviation.id)}
                      onChange={() => toggleSelect(deviation.id)}
                    />
                  </td>
                  <td style={{ ...tdStyle, ...monoStyle }} data-testid={`drift-standard-${deviation.id}`}>
                    {deviation.standardKey}
                    {deviation.resourceId ? ` · ${deviation.resourceId}` : ""}
                  </td>
                  <td style={{ ...tdStyle, ...monoStyle }}>{toShortText(deviation.current)}</td>
                  <td style={{ ...tdStyle, ...monoStyle }}>{toShortText(deviation.expected)}</td>
                  <td style={tdStyle}>
                    <span className="status-badge" style={statusBadgeStyle} data-testid={`drift-state-${deviation.id}`}>
                      {stateLabel(deviation.state)}
                    </span>
                  </td>
                  <td style={tdStyle}>{deviation.reason ?? "—"}</td>
                  <td style={{ ...tdStyle, ...monoStyle }}>{deviation.expiresOn ?? "—"}</td>
                  <td style={{ ...tdStyle, ...monoStyle }}>{deviation.lastSeenAt || "—"}</td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        style={actionBtnStyle}
                        data-testid={`drift-view-${deviation.id}`}
                        onClick={() => setDrawerId(deviation.id)}
                      >
                        View
                      </button>
                      <button
                        type="button"
                        style={actionBtnStyle}
                        data-testid={`drift-accept-${deviation.id}`}
                        onClick={() => onAccept?.(deviation)}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        style={actionBtnStyle}
                        data-testid={`drift-override-${deviation.id}`}
                        onClick={() => onOverride?.(deviation)}
                      >
                        Override
                      </button>
                      <button
                        type="button"
                        style={actionBtnStyle}
                        data-testid={`drift-deny-${deviation.id}`}
                        onClick={() => onDeny?.(deviation)}
                      >
                        Deny
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ ...tdStyle, textAlign: "center", color: "var(--text-soft)" }} data-testid="drift-empty">
                    No deviations match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Row detail drawer */}
      {drawerDeviation && (
        <div style={drawerStyle} role="dialog" aria-label="Deviation detail" data-testid="drift-drawer">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0 }}>Deviation detail</h2>
            <button type="button" style={actionBtnStyle} data-testid="drift-drawer-close" onClick={() => setDrawerId(null)}>
              Close
            </button>
          </div>
          <div style={monoStyle} data-testid="drift-drawer-standard">
            {drawerDeviation.standardKey}
            {drawerDeviation.resourceId ? ` · ${drawerDeviation.resourceId}` : ""}
          </div>
          <div>
            <span className="status-badge" style={statusBadgeStyle} data-testid="drift-drawer-state">
              {stateLabel(drawerDeviation.state)}
            </span>
          </div>
          <div>
            <h3 style={{ fontSize: "13px", margin: "0 0 6px" }}>Current</h3>
            <pre style={preStyle} data-testid="drift-drawer-current">{toFullText(drawerDeviation.current)}</pre>
          </div>
          <div>
            <h3 style={{ fontSize: "13px", margin: "0 0 6px" }}>Expected</h3>
            <pre style={preStyle} data-testid="drift-drawer-expected">{toFullText(drawerDeviation.expected)}</pre>
          </div>
          <div style={{ fontSize: "13px" }}>
            <div data-testid="drift-drawer-reason">Reason: {drawerDeviation.reason ?? "—"}</div>
            <div data-testid="drift-drawer-expires">Expires: {drawerDeviation.expiresOn ?? "—"}</div>
            <div data-testid="drift-drawer-lastseen">Last seen: {drawerDeviation.lastSeenAt || "—"}</div>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              style={buttonStyle}
              data-testid="drift-drawer-accept"
              onClick={() => {
                setDrawerId(null);
                onAccept?.(drawerDeviation);
              }}
            >
              Accept
            </button>
            <button
              type="button"
              style={buttonStyle}
              data-testid="drift-drawer-override"
              onClick={() => {
                setDrawerId(null);
                onOverride?.(drawerDeviation);
              }}
            >
              Override
            </button>
            <button
              type="button"
              style={buttonStyle}
              data-testid="drift-drawer-deny"
              onClick={() => {
                setDrawerId(null);
                onDeny?.(drawerDeviation);
              }}
            >
              Deny
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
