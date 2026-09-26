"use client";

// Remediation plan table (EPIC-006 SPEC.md §3.2, T-0112).
// Renders the KPI strip, the plan DataTable (Check ID, Finding, Severity, Mode,
// Action state, License, Target), filters (mode/severity/collector/state/
// eligible-only), row actions (View plan, View instructions, Apply, Skip), and a
// row detail drawer with command, before/after, and result.
// Zero colour literals: report theme tokens only.

import React, { useMemo, useState, type CSSProperties, type ReactElement } from "react";
import {
  computeKpis,
  deriveCollector,
  isActionEligible,
  type RemediationActionItem,
  type RemediationPlanResponse,
} from "../../lib/remediationApi.js";

export interface RemediationPlanTableProps {
  readonly plan?: RemediationPlanResponse | null;
  readonly loading?: boolean;
  readonly error?: string | null;
  /** True when the caller holds `remediation.apply`. */
  readonly canApply?: boolean;
  readonly onViewInstructions?: (action: RemediationActionItem) => void;
  readonly onApply?: (action: RemediationActionItem) => void;
  readonly onSkip?: (action: RemediationActionItem) => void;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: "12px",
};

const kpiCardStyle: CSSProperties = {
  padding: "16px",
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
  verticalAlign: "middle",
};

const monoStyle: CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  fontSize: "13px",
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

const disabledActionBtnStyle: CSSProperties = {
  ...actionBtnStyle,
  opacity: 0.4,
  cursor: "not-allowed",
};

const badgeBaseStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 600,
  textTransform: "capitalize",
};

export function statusBadgeStyle(state: string): CSSProperties {
  switch (state.toLowerCase()) {
    case "applied":
      return { ...badgeBaseStyle, background: "var(--success-soft)", color: "var(--success-text)", border: "1px solid var(--success)" };
    case "failed":
      return { ...badgeBaseStyle, background: "var(--danger-soft)", color: "var(--danger-text)", border: "1px solid var(--danger)" };
    case "planned":
    case "approved":
      return { ...badgeBaseStyle, background: "var(--accent-soft)", color: "var(--accent-text)", border: "1px solid var(--accent)" };
    case "skipped":
    default:
      return { ...badgeBaseStyle, background: "var(--surface)", color: "var(--text-soft)", border: "1px solid var(--border)" };
  }
}

export function severityBadgeStyle(severity: string): CSSProperties {
  switch (severity.toLowerCase()) {
    case "critical":
    case "high":
      return { ...badgeBaseStyle, background: "var(--danger-soft)", color: "var(--danger-text)", border: "1px solid var(--danger)" };
    case "medium":
      return { ...badgeBaseStyle, background: "var(--warning-soft)", color: "var(--warning-text)", border: "1px solid var(--warning)" };
    case "low":
    case "info":
      return { ...badgeBaseStyle, background: "var(--surface)", color: "var(--text-soft)", border: "1px solid var(--border)" };
    default:
      return { ...badgeBaseStyle, background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" };
  }
}

const drawerStyle: CSSProperties = {
  padding: "16px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};

const drawerGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "12px",
};

const codeBlockStyle: CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  fontSize: "12px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  padding: "8px",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  margin: 0,
};

function JsonBlock({ value }: { readonly value: unknown }): ReactElement {
  if (value === null || value === undefined) {
    return <span style={{ color: "var(--text-soft)" }}>—</span>;
  }
  return <pre style={codeBlockStyle}>{JSON.stringify(value, null, 2)}</pre>;
}

export function RemediationPlanTable({
  plan = null,
  loading = false,
  error = null,
  canApply = false,
  onViewInstructions,
  onApply,
  onSkip,
}: RemediationPlanTableProps): ReactElement {
  const [modeFilter, setModeFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [collectorFilter, setCollectorFilter] = useState<string>("all");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [eligibleOnly, setEligibleOnly] = useState<boolean>(false);
  const [selected, setSelected] = useState<string | null>(null);

  const actions = plan?.actions ?? [];
  const kpis = useMemo(() => computeKpis(actions), [actions]);

  const collectors = useMemo(() => {
    const set = new Set<string>();
    for (const action of actions) set.add(deriveCollector(action));
    return [...set].sort();
  }, [actions]);

  const filtered = useMemo(() => {
    return actions.filter((action) => {
      if (modeFilter !== "all" && action.mode !== modeFilter) return false;
      if (severityFilter !== "all" && (action.severity ?? "").toLowerCase() !== severityFilter) return false;
      if (collectorFilter !== "all" && deriveCollector(action) !== collectorFilter) return false;
      if (stateFilter !== "all" && action.state !== stateFilter) return false;
      if (eligibleOnly && !isActionEligible(action)) return false;
      return true;
    });
  }, [actions, modeFilter, severityFilter, collectorFilter, stateFilter, eligibleOnly]);

  const selectedAction = actions.find((a) => a.id === selected) ?? null;

  return (
    <div style={containerStyle} data-testid="remediation-plan-table">
      {/* KPI strip */}
      <div style={kpiStripStyle} data-testid="remediation-kpi-strip">
        <div style={kpiCardStyle}>
          <span style={kpiValueStyle} data-testid="kpi-total">{kpis.total}</span>
          <span style={kpiLabelStyle}>Total actions</span>
        </div>
        <div style={kpiCardStyle}>
          <span style={kpiValueStyle} data-testid="kpi-automated">{kpis.automated}</span>
          <span style={kpiLabelStyle}>Automated</span>
        </div>
        <div style={kpiCardStyle}>
          <span style={kpiValueStyle} data-testid="kpi-manual">{kpis.manual}</span>
          <span style={kpiLabelStyle}>Manual</span>
        </div>
        <div style={kpiCardStyle}>
          <span style={kpiValueStyle} data-testid="kpi-gated">{kpis.gated}</span>
          <span style={kpiLabelStyle}>Gated / skipped</span>
        </div>
      </div>

      {/* Filters */}
      <div style={filterBarStyle}>
        <select
          value={modeFilter}
          onChange={(e) => setModeFilter(e.target.value)}
          style={selectStyle}
          aria-label="Filter by mode"
          data-testid="filter-mode"
        >
          <option value="all">All modes</option>
          <option value="auto">Auto</option>
          <option value="manual">Manual</option>
        </select>

        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          style={selectStyle}
          aria-label="Filter by severity"
          data-testid="filter-severity"
        >
          <option value="all">All severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        <select
          value={collectorFilter}
          onChange={(e) => setCollectorFilter(e.target.value)}
          style={selectStyle}
          aria-label="Filter by collector"
          data-testid="filter-collector"
        >
          <option value="all">All collectors</option>
          {collectors.map((collector) => (
            <option key={collector} value={collector}>{collector}</option>
          ))}
        </select>

        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          style={selectStyle}
          aria-label="Filter by state"
          data-testid="filter-state"
        >
          <option value="all">All states</option>
          <option value="planned">Planned</option>
          <option value="approved">Approved</option>
          <option value="applied">Applied</option>
          <option value="failed">Failed</option>
          <option value="skipped">Skipped</option>
        </select>

        <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px" }}>
          <input
            type="checkbox"
            checked={eligibleOnly}
            onChange={(e) => setEligibleOnly(e.target.checked)}
            aria-label="Eligible only"
            data-testid="filter-eligible-only"
          />
          Eligible only
        </label>
      </div>

      {loading && (
        <div style={{ padding: "32px", textAlign: "center", color: "var(--text-soft)" }}>
          Loading remediation plan...
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
          }}
          role="alert"
        >
          {error}
        </div>
      )}

      {!loading && !error && (
        <div style={tableWrapperStyle}>
          <table style={tableStyle} aria-label="Remediation plan actions">
            <thead>
              <tr>
                <th style={thStyle}>Check ID</th>
                <th style={thStyle}>Finding</th>
                <th style={thStyle}>Severity</th>
                <th style={thStyle}>Mode</th>
                <th style={thStyle}>Action state</th>
                <th style={thStyle}>License</th>
                <th style={thStyle}>Target</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td style={{ ...tdStyle, textAlign: "center", color: "var(--text-soft)" }} colSpan={8} data-testid="empty-plan-state">
                    No remediation actions match the current filters.
                  </td>
                </tr>
              )}
              {filtered.map((action) => {
                const applicable = action.state === "planned" && canApply;
                return (
                  <tr key={action.id} data-testid={`plan-row-${action.id}`}>
                    <td style={tdStyle}>
                      <span style={monoStyle} data-testid={`check-${action.id}`}>{action.check}</span>
                    </td>
                    <td style={tdStyle}>{action.finding ?? "—"}</td>
                    <td style={tdStyle}>
                      {action.severity ? (
                        <span className="sev-badge" style={severityBadgeStyle(action.severity)}>
                          {action.severity}
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-soft)" }}>—</span>
                      )}
                    </td>
                    <td style={tdStyle} data-testid={`mode-${action.id}`}>{action.mode}</td>
                    <td style={tdStyle}>
                      <span className="status-badge" style={statusBadgeStyle(action.state)} data-testid={`state-${action.id}`}>
                        {action.state}
                      </span>
                    </td>
                    <td style={tdStyle}>{action.license ?? "—"}</td>
                    <td style={tdStyle}>{action.target ?? "—"}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: "6px", justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          style={actionBtnStyle}
                          onClick={() => setSelected(action.id)}
                          data-testid={`action-view-${action.id}`}
                        >
                          View plan
                        </button>
                        {onViewInstructions && (
                          <button
                            type="button"
                            style={actionBtnStyle}
                            onClick={() => onViewInstructions(action)}
                            data-testid={`action-instructions-${action.id}`}
                          >
                            View instructions
                          </button>
                        )}
                        {onApply && (
                          <button
                            type="button"
                            style={applicable ? actionBtnStyle : disabledActionBtnStyle}
                            disabled={!applicable}
                            onClick={() => applicable && onApply(action)}
                            title={canApply ? undefined : "Requires remediation.apply"}
                            data-testid={`action-apply-${action.id}`}
                          >
                            Apply
                          </button>
                        )}
                        {onSkip && (
                          <button
                            type="button"
                            style={action.state === "planned" ? actionBtnStyle : disabledActionBtnStyle}
                            disabled={action.state !== "planned"}
                            onClick={() => action.state === "planned" && onSkip(action)}
                            data-testid={`action-skip-${action.id}`}
                          >
                            Skip
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Row detail drawer */}
      {selectedAction && (
        <div style={drawerStyle} data-testid="plan-detail-drawer">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: "16px" }}>
              <span style={monoStyle}>{selectedAction.check}</span>
            </h3>
            <button type="button" style={actionBtnStyle} onClick={() => setSelected(null)} data-testid="drawer-close">
              Close
            </button>
          </div>
          <div style={drawerGridStyle}>
            <div>
              <div style={kpiLabelStyle}>Command</div>
              <pre style={codeBlockStyle}>{selectedAction.command || "—"}</pre>
            </div>
            <div>
              <div style={kpiLabelStyle}>Target</div>
              <pre style={codeBlockStyle}>{selectedAction.target || "—"}</pre>
            </div>
          </div>
          <div style={drawerGridStyle}>
            <div>
              <div style={kpiLabelStyle}>Before</div>
              <JsonBlock value={selectedAction.before} />
            </div>
            <div>
              <div style={kpiLabelStyle}>After</div>
              <JsonBlock value={selectedAction.after} />
            </div>
          </div>
          <div>
            <div style={kpiLabelStyle}>Result / error</div>
            <JsonBlock value={selectedAction.error ?? selectedAction.result ?? null} />
          </div>
        </div>
      )}
    </div>
  );
}
