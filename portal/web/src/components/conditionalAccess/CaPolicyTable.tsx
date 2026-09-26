"use client";

// CaPolicyTable — Conditional Access policies data table with filters, detail drawer,
// and row actions (EPIC-015 SPEC.md §3.1; T-0283).
import React, { useMemo, useState, type CSSProperties } from "react";
import type { CaPolicyItem } from "../../lib/caApi";
import { CaPolicyDetailDrawer } from "./CaPolicyDetailDrawer";

export type CaPolicyRowAction =
  | "view"
  | "edit"
  | "clone"
  | "enable"
  | "disable"
  | "setReportOnly"
  | "delete"
  | "viewChangeHistory"
  | "assessCoverage";

export interface CaPolicyTableProps {
  readonly policies?: readonly CaPolicyItem[];
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onAddPolicy?: () => void;
  readonly onDeployFromTemplate?: () => void;
  readonly onAssessCoverage?: () => void;
  readonly onAction?: (action: CaPolicyRowAction, policy: CaPolicyItem) => void;
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  width: "100%",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text, #111827)",
};

const headerBarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "12px",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "16px",
  background: "var(--bg-elev, #f9fafb)",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "8px",
};

const filterRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
  alignItems: "center",
};

const inputStyle: CSSProperties = {
  padding: "8px 12px",
  background: "var(--bg, #ffffff)",
  border: "1px solid var(--border, #d1d5db)",
  borderRadius: "6px",
  color: "var(--text, #111827)",
  fontSize: "14px",
};

const primaryButtonStyle: CSSProperties = {
  padding: "8px 16px",
  background: "var(--primary, #2563eb)",
  color: "#ffffff",
  border: "none",
  borderRadius: "6px",
  fontWeight: 600,
  fontSize: "14px",
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  padding: "8px 16px",
  background: "var(--bg, #ffffff)",
  color: "var(--text, #111827)",
  border: "1px solid var(--border, #d1d5db)",
  borderRadius: "6px",
  fontWeight: 600,
  fontSize: "14px",
  cursor: "pointer",
};

const actionBtnStyle: CSSProperties = {
  padding: "4px 8px",
  borderRadius: "4px",
  border: "1px solid var(--border, #d1d5db)",
  background: "var(--bg, #ffffff)",
  fontSize: "12px",
  cursor: "pointer",
};

const tableContainerStyle: CSSProperties = {
  overflowX: "auto",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "8px",
  background: "var(--bg, #ffffff)",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "13px",
  textAlign: "left",
};

const thStyle: CSSProperties = {
  padding: "12px 14px",
  background: "var(--bg-elev, #f9fafb)",
  borderBottom: "1px solid var(--border, #e5e7eb)",
  color: "var(--text-muted, #4b5563)",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const tdStyle: CSSProperties = {
  padding: "12px 14px",
  borderBottom: "1px solid var(--border, #e5e7eb)",
  verticalAlign: "middle",
};

function renderStateBadge(state: string) {
  const s = state.toLowerCase();
  if (s === "enabled" || s === "on") {
    return (
      <span
        style={{
          display: "inline-block",
          padding: "2px 8px",
          borderRadius: "9999px",
          backgroundColor: "#dcfce7",
          color: "#166534",
          fontSize: "12px",
          fontWeight: 600,
        }}
      >
        Enabled
      </span>
    );
  }
  if (s === "enabledforreportingbutnotenforced" || s === "report-only" || s === "reportonly") {
    return (
      <span
        style={{
          display: "inline-block",
          padding: "2px 8px",
          borderRadius: "9999px",
          backgroundColor: "#fef3c7",
          color: "#92400e",
          fontSize: "12px",
          fontWeight: 600,
        }}
      >
        Report-only
      </span>
    );
  }
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: "9999px",
        backgroundColor: "#f3f4f6",
        color: "#4b5563",
        fontSize: "12px",
        fontWeight: 600,
      }}
    >
      Disabled
    </span>
  );
}

export const CaPolicyTable: React.FC<CaPolicyTableProps> = ({
  policies = [],
  loading = false,
  error = null,
  onAddPolicy,
  onDeployFromTemplate,
  onAssessCoverage,
  onAction,
}) => {
  const [selectedPolicy, setSelectedPolicy] = useState<CaPolicyItem | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [targetFilter, setTargetFilter] = useState("");
  const [controlFilter, setControlFilter] = useState("all");
  const [conditionFilter, setConditionFilter] = useState("all");

  const filteredPolicies = useMemo(() => {
    return policies.filter((p) => {
      // Search
      if (search.trim()) {
        const q = search.toLowerCase();
        const nameMatch = (p.displayName || p.name || "").toLowerCase().includes(q);
        const idMatch = (p.id || "").toLowerCase().includes(q);
        if (!nameMatch && !idMatch) return false;
      }

      // State filter
      if (stateFilter !== "all") {
        const s = (p.state || "").toLowerCase();
        if (stateFilter === "enabled" && s !== "enabled") return false;
        if (stateFilter === "disabled" && s !== "disabled") return false;
        if (
          stateFilter === "report-only" &&
          s !== "enabledforreportingbutnotenforced" &&
          s !== "report-only"
        ) {
          return false;
        }
      }

      // Target filter
      if (targetFilter.trim()) {
        const q = targetFilter.toLowerCase();
        const userSummary = (p.usersTargeted?.summary || "").toLowerCase();
        const appSummary = (p.apps?.summary || "").toLowerCase();
        if (!userSummary.includes(q) && !appSummary.includes(q)) return false;
      }

      // Control filter
      if (controlFilter !== "all") {
        const ctrl = controlFilter.toLowerCase();
        const grantSummary = (p.grantControls?.summary || "").toLowerCase();
        const builtIn = (p.grantControls?.builtInControls || []).map((c) => c.toLowerCase());
        if (!grantSummary.includes(ctrl) && !builtIn.includes(ctrl)) return false;
      }

      // Condition filter
      if (conditionFilter !== "all") {
        const cond = conditionFilter.toLowerCase();
        const condSummary = (p.conditions?.summary || "").toLowerCase();
        if (!condSummary.includes(cond)) return false;
      }

      return true;
    });
  }, [policies, search, stateFilter, targetFilter, controlFilter, conditionFilter]);

  const handleOpenDrawer = (policy: CaPolicyItem) => {
    setSelectedPolicy(policy);
    setIsDrawerOpen(true);
    onAction?.("view", policy);
  };

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false);
    setSelectedPolicy(null);
  };

  const handleAction = (action: CaPolicyRowAction, policy: CaPolicyItem) => {
    if (action === "view") {
      handleOpenDrawer(policy);
    } else {
      onAction?.(action, policy);
    }
  };

  return (
    <div style={containerStyle} data-testid="ca-policy-table-container">
      {/* Header bar */}
      <div style={headerBarStyle}>
        <div>
          <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 700 }}>
            Conditional Access Policies
          </h1>
          <span style={{ fontSize: "13px", color: "var(--text-muted, #6b7280)" }}>
            Manage policies, enforcement states, controls, and guardrails
          </span>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {onAssessCoverage ? (
            <button
              style={secondaryButtonStyle}
              onClick={onAssessCoverage}
              data-testid="assess-coverage-btn"
            >
              Assess coverage
            </button>
          ) : null}
          {onDeployFromTemplate ? (
            <button
              style={secondaryButtonStyle}
              onClick={onDeployFromTemplate}
              data-testid="deploy-template-btn"
            >
              Deploy from template
            </button>
          ) : null}
          {onAddPolicy ? (
            <button
              style={primaryButtonStyle}
              onClick={onAddPolicy}
              data-testid="add-policy-btn"
            >
              Add policy
            </button>
          ) : null}
        </div>
      </div>

      {/* Filter Row */}
      <div style={filterRowStyle}>
        <input
          style={{ ...inputStyle, width: "220px" }}
          type="text"
          placeholder="Search by name or ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="ca-search-input"
        />

        <select
          style={inputStyle}
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          data-testid="ca-state-select"
        >
          <option value="all">All States</option>
          <option value="enabled">Enabled</option>
          <option value="report-only">Report-only</option>
          <option value="disabled">Disabled</option>
        </select>

        <input
          style={{ ...inputStyle, width: "160px" }}
          type="text"
          placeholder="Filter by target..."
          value={targetFilter}
          onChange={(e) => setTargetFilter(e.target.value)}
          data-testid="ca-target-input"
        />

        <select
          style={inputStyle}
          value={controlFilter}
          onChange={(e) => setControlFilter(e.target.value)}
          data-testid="ca-control-select"
        >
          <option value="all">All Controls</option>
          <option value="mfa">MFA</option>
          <option value="block">Block</option>
          <option value="compliantdevice">Compliant Device</option>
        </select>

        <select
          style={inputStyle}
          value={conditionFilter}
          onChange={(e) => setConditionFilter(e.target.value)}
          data-testid="ca-condition-select"
        >
          <option value="all">All Conditions</option>
          <option value="locations">Locations</option>
          <option value="platforms">Platforms</option>
          <option value="client apps">Client apps</option>
          <option value="risk">Risk</option>
        </select>
      </div>

      {/* Loading & Error States */}
      {loading ? (
        <div style={{ padding: "32px", textAlign: "center", color: "var(--text-muted, #6b7280)" }}>
          Loading Conditional Access policies...
        </div>
      ) : null}

      {error ? (
        <div style={{ padding: "16px", backgroundColor: "#fee2e2", color: "#dc2626", borderRadius: "6px" }}>
          {error}
        </div>
      ) : null}

      {/* Main Table */}
      {!loading && !error ? (
        <div style={tableContainerStyle}>
          <table style={tableStyle} aria-label="Conditional Access Policies Table">
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>State</th>
                <th style={thStyle}>Users targeted</th>
                <th style={thStyle}>Apps</th>
                <th style={thStyle}>Grant/block controls</th>
                <th style={thStyle}>Conditions</th>
                <th style={thStyle}>Modified</th>
                <th style={thStyle}>Modified by</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPolicies.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ ...tdStyle, textAlign: "center", padding: "32px", color: "var(--text-muted, #6b7280)" }}>
                    No Conditional Access policies found matching criteria.
                  </td>
                </tr>
              ) : (
                filteredPolicies.map((p) => (
                  <tr key={p.id} data-testid={`ca-policy-row-${p.id}`}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>
                      <button
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          color: "var(--primary, #2563eb)",
                          fontWeight: 600,
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                        onClick={() => handleAction("view", p)}
                      >
                        {p.displayName || p.name}
                      </button>
                    </td>
                    <td style={tdStyle}>{renderStateBadge(p.state)}</td>
                    <td style={tdStyle}>{p.usersTargeted?.summary || "None"}</td>
                    <td style={tdStyle}>{p.apps?.summary || "None"}</td>
                    <td style={tdStyle}>{p.grantControls?.summary || "None"}</td>
                    <td style={tdStyle}>{p.conditions?.summary || "Any"}</td>
                    <td style={tdStyle}>
                      {p.modifiedDateTime ? new Date(p.modifiedDateTime).toLocaleDateString() : "—"}
                    </td>
                    <td style={tdStyle}>{p.modifiedBy || "—"}</td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                        <button
                          style={actionBtnStyle}
                          onClick={() => handleAction("view", p)}
                          data-testid={`action-view-${p.id}`}
                        >
                          View
                        </button>
                        <button
                          style={actionBtnStyle}
                          onClick={() => handleAction("edit", p)}
                          data-testid={`action-edit-${p.id}`}
                        >
                          Edit
                        </button>
                        <button
                          style={actionBtnStyle}
                          onClick={() => handleAction("clone", p)}
                          data-testid={`action-clone-${p.id}`}
                        >
                          Clone
                        </button>
                        <button
                          style={actionBtnStyle}
                          onClick={() =>
                            handleAction(p.state === "enabled" ? "disable" : "enable", p)
                          }
                          data-testid={`action-toggle-${p.id}`}
                        >
                          {p.state === "enabled" ? "Disable" : "Enable"}
                        </button>
                        <button
                          style={actionBtnStyle}
                          onClick={() => handleAction("setReportOnly", p)}
                          data-testid={`action-reportonly-${p.id}`}
                        >
                          Report-only
                        </button>
                        <button
                          style={{ ...actionBtnStyle, color: "#dc2626" }}
                          onClick={() => handleAction("delete", p)}
                          data-testid={`action-delete-${p.id}`}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Detail Drawer */}
      <CaPolicyDetailDrawer
        policy={selectedPolicy}
        isOpen={isDrawerOpen}
        onClose={handleCloseDrawer}
        onAction={(action, policy) => handleAction(action as CaPolicyRowAction, policy)}
      />
    </div>
  );
};
