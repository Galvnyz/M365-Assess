"use client";

// Roles & Assignments Table component (EPIC-013 SPEC §3.1, §4.1; T-0248).
// Table: Role · Principal · Type (permanent/eligible/active) · Scope · Start · End · Status.
// Filters: role, principal type, assignment type, scope.
// Visual distinction for permanent vs eligible/active.
// P2GateNotice shown when P2 is missing in PIM view.
// Strictly uses report theme tokens with zero colour literals.

import React, { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import {
  fetchPimAssignments,
  fetchRoleAssignments,
  type PimAssignment,
  type PimLicenseGateResult,
  type RoleAssignment,
  type RoleAssignmentType,
  type RolePrincipalType,
} from "../../lib/rolesApi";
import { P2GateNotice } from "./P2GateNotice";

export interface RolesAssignmentsTableProps {
  readonly tenantId: string;
  readonly isPimView?: boolean;
}

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "14px",
  color: "var(--text)",
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "12px 16px",
  borderBottom: "1px solid var(--border)",
  color: "var(--muted)",
  fontWeight: 600,
};

const tdStyle: CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid var(--border)",
  verticalAlign: "middle",
};

const filterBarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "12px",
  alignItems: "center",
  paddingBottom: "12px",
};

const inputStyle: CSSProperties = {
  padding: "6px 10px",
  background: "var(--input-bg, var(--bg))",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "13px",
};

const actionBtnStyle: CSSProperties = {
  padding: "4px 8px",
  borderRadius: "4px",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  fontSize: "12px",
  cursor: "pointer",
  marginRight: "4px",
};

function getBadgeStyle(type: RoleAssignmentType | "eligible" | "active"): CSSProperties {
  if (type === "permanent") {
    return {
      padding: "2px 8px",
      borderRadius: "12px",
      fontSize: "12px",
      fontWeight: 600,
      background: "var(--warning-soft, var(--surface))",
      color: "var(--warning, var(--text))",
      border: "1px solid var(--border)",
    };
  }
  if (type === "active") {
    return {
      padding: "2px 8px",
      borderRadius: "12px",
      fontSize: "12px",
      fontWeight: 600,
      background: "var(--success-soft, var(--surface))",
      color: "var(--success, var(--text))",
      border: "1px solid var(--border)",
    };
  }
  return {
    padding: "2px 8px",
    borderRadius: "12px",
    fontSize: "12px",
    fontWeight: 600,
    background: "var(--accent-soft, var(--surface))",
    color: "var(--accent, var(--text))",
    border: "1px solid var(--border)",
  };
}

export function RolesAssignmentsTable({
  tenantId,
  isPimView = false,
}: RolesAssignmentsTableProps): ReactElement {
  const [items, setItems] = useState<Array<RoleAssignment | PimAssignment>>([]);
  const [gate, setGate] = useState<PimLicenseGateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [roleFilter, setRoleFilter] = useState("");
  const [principalTypeFilter, setPrincipalTypeFilter] = useState<RolePrincipalType | "">("");
  const [assignmentTypeFilter, setAssignmentTypeFilter] = useState<RoleAssignmentType | "">("");
  const [scopeFilter, setScopeFilter] = useState("");
  const [search, setSearch] = useState("");

  const loadData = async (): Promise<void> => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      if (isPimView) {
        const res = await fetchPimAssignments(tenantId, {
          role: roleFilter || undefined,
          principalType: principalTypeFilter || undefined,
          assignmentType: (assignmentTypeFilter as "eligible" | "active") || undefined,
          scope: scopeFilter || undefined,
          search: search || undefined,
        });
        setGate(res.gate);
        setItems(res.items);
      } else {
        const res = await fetchRoleAssignments(tenantId, {
          role: roleFilter || undefined,
          principalType: principalTypeFilter || undefined,
          assignmentType: assignmentTypeFilter || undefined,
          scope: scopeFilter || undefined,
          search: search || undefined,
        });
        setItems(res.items);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load role assignments");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [tenantId, isPimView, roleFilter, principalTypeFilter, assignmentTypeFilter, scopeFilter, search]);

  if (isPimView && gate && !gate.supported) {
    return <P2GateNotice gate={gate} />;
  }

  return (
    <div data-testid="roles-assignments-table-container" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Filters Bar */}
      <div style={filterBarStyle}>
        <input
          type="text"
          placeholder="Search role or principal…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, minWidth: "200px" }}
          data-testid="filter-search"
        />

        <input
          type="text"
          placeholder="Filter role name…"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          style={inputStyle}
          data-testid="filter-role"
        />

        <select
          value={principalTypeFilter}
          onChange={(e) => setPrincipalTypeFilter(e.target.value as RolePrincipalType | "")}
          style={inputStyle}
          data-testid="filter-principal-type"
        >
          <option value="">All Principal Types</option>
          <option value="user">User</option>
          <option value="group">Group</option>
          <option value="servicePrincipal">Service Principal</option>
        </select>

        <select
          value={assignmentTypeFilter}
          onChange={(e) => setAssignmentTypeFilter(e.target.value as RoleAssignmentType | "")}
          style={inputStyle}
          data-testid="filter-assignment-type"
        >
          <option value="">All Assignment Types</option>
          {!isPimView && <option value="permanent">Permanent</option>}
          <option value="eligible">Eligible</option>
          <option value="active">Active</option>
        </select>

        <input
          type="text"
          placeholder="Scope (e.g. /)…"
          value={scopeFilter}
          onChange={(e) => setScopeFilter(e.target.value)}
          style={{ ...inputStyle, width: "120px" }}
          data-testid="filter-scope"
        />
      </div>

      {loading && <p style={{ color: "var(--muted)" }}>Loading assignments…</p>}
      {error && <p role="alert" style={{ color: "var(--error)" }}>{error}</p>}

      {!loading && !error && items.length === 0 && (
        <p style={{ color: "var(--muted)" }}>No role assignments found matching criteria.</p>
      )}

      {!loading && items.length > 0 && (
        <table style={tableStyle} data-testid="roles-table">
          <thead>
            <tr>
              <th style={thStyle}>Role</th>
              <th style={thStyle}>Principal</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Scope</th>
              <th style={thStyle}>Start</th>
              <th style={thStyle}>End</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 600 }}>{row.roleName}</div>
                  <div style={{ fontSize: "12px", color: "var(--muted)" }}>{row.roleDefinitionId}</div>
                </td>
                <td style={tdStyle}>
                  <div>{row.principalDisplayName ?? row.principalId}</div>
                  {row.principalEmail && (
                    <div style={{ fontSize: "12px", color: "var(--muted)" }}>{row.principalEmail}</div>
                  )}
                </td>
                <td style={tdStyle}>
                  <span
                    data-testid={`badge-${row.assignmentType}`}
                    style={getBadgeStyle(row.assignmentType)}
                  >
                    {row.assignmentType}
                  </span>
                </td>
                <td style={tdStyle}>{row.scope}</td>
                <td style={tdStyle}>{row.startDateTime ? new Date(row.startDateTime).toLocaleDateString() : "—"}</td>
                <td style={tdStyle}>{row.endDateTime ? new Date(row.endDateTime).toLocaleDateString() : "Permanent"}</td>
                <td style={tdStyle}>{row.status}</td>
                <td style={tdStyle}>
                  <button type="button" style={actionBtnStyle}>
                    View
                  </button>
                  <button
                    type="button"
                    style={{ ...actionBtnStyle, opacity: 0.6 }}
                    disabled
                    title="Requires tenant write authorization"
                  >
                    Remove
                  </button>
                  {row.assignmentType === "eligible" && (
                    <button
                      type="button"
                      style={actionBtnStyle}
                      title="Activate eligible PIM assignment"
                    >
                      Activate
                    </button>
                  )}
                  {row.assignmentType === "active" && (
                    <button
                      type="button"
                      style={actionBtnStyle}
                      title="Extend active assignment window"
                    >
                      Extend
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
