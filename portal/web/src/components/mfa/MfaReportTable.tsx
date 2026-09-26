"use client";

// MFA report table and list component (EPIC-012 SPEC.md §3.1, T-0228).
// Renders every §3.1 column (User, UPN mono, Methods registered, Default method,
// Phishing-resistant?, Last auth, State), supports filters (registered, method,
// phishing-resistant, license, admin role), provides row and bulk actions.
// Strictly uses report theme tokens with zero colour literals.

import React, { useMemo, useState, type CSSProperties, type ReactElement } from "react";
import type { MfaUserRow } from "../../lib/mfaApi";

export type MfaRowAction =
  | "resetMfa"
  | "requireReregistration"
  | "sendPush"
  | "setDefaultMethod"
  | "createTap"
  | "viewUser";

export interface MfaReportTableProps {
  readonly rows?: readonly MfaUserRow[];
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onViewUser?: (row: MfaUserRow) => void;
  readonly onAction?: (action: MfaRowAction, row: MfaUserRow) => void;
  readonly onBulkReset?: (rows: readonly MfaUserRow[]) => void;
  readonly onBulkPush?: (rows: readonly MfaUserRow[]) => void;
  readonly disabledReasons?: Partial<Record<MfaRowAction | "bulkReset" | "bulkPush", string>>;
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  width: "100%",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
};

const headerBarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "12px",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "16px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
};

const filterRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
  alignItems: "center",
};

const inputStyle: CSSProperties = {
  padding: "8px 12px",
  background: "var(--input-bg, var(--bg))",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "14px",
};

const selectStyle: CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
};

const buttonStyle: CSSProperties = {
  padding: "8px 14px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
};

const tableContainerStyle: CSSProperties = {
  overflowX: "auto",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 8px)",
  background: "var(--surface)",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "13px",
  textAlign: "left",
};

const thStyle: CSSProperties = {
  padding: "12px 14px",
  background: "var(--bg-elev)",
  borderBottom: "1px solid var(--border)",
  fontWeight: 600,
  color: "var(--muted)",
};

const tdStyle: CSSProperties = {
  padding: "12px 14px",
  borderBottom: "1px solid var(--border)",
  verticalAlign: "middle",
};

const badgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: "12px",
  fontSize: "12px",
  fontWeight: 600,
  border: "1px solid var(--border)",
  background: "var(--bg-elev)",
  color: "var(--text)",
};

const chipStyle: CSSProperties = {
  display: "inline-block",
  padding: "2px 6px",
  margin: "2px",
  borderRadius: "4px",
  fontSize: "11px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  color: "var(--text)",
};

export function MfaReportTable({
  rows = [],
  loading = false,
  error = null,
  onViewUser,
  onAction,
  onBulkReset,
  onBulkPush,
  disabledReasons,
}: MfaReportTableProps): ReactElement {
  const [search, setSearch] = useState("");
  const [registeredFilter, setRegisteredFilter] = useState<string>("all");
  const [methodFilter, setMethodFilter] = useState<string>("all");
  const [phishingResistantFilter, setPhishingResistantFilter] = useState<string>("all");
  const [licenseFilter, setLicenseFilter] = useState<string>("all");
  const [adminRoleFilter, setAdminRoleFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());

  // Extract distinct method names across rows
  const availableMethods = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      for (const m of r.methods) {
        set.add(m);
      }
    }
    return Array.from(set).sort();
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (search) {
        const query = search.toLowerCase();
        const matchesName = r.displayName?.toLowerCase().includes(query) ?? false;
        const matchesUpn = r.userPrincipalName.toLowerCase().includes(query);
        if (!matchesName && !matchesUpn) return false;
      }
      if (registeredFilter !== "all" && r.state !== registeredFilter) {
        return false;
      }
      if (methodFilter !== "all" && !r.methods.includes(methodFilter)) {
        return false;
      }
      if (phishingResistantFilter !== "all") {
        const isPR = r.phishingResistant === "phishing-resistant";
        if (phishingResistantFilter === "yes" && !isPR) return false;
        if (phishingResistantFilter === "no" && isPR) return false;
      }
      if (licenseFilter !== "all") {
        const hasLicenses = r.licenses.length > 0;
        if (licenseFilter === "licensed" && !hasLicenses) return false;
        if (licenseFilter === "unlicensed" && hasLicenses) return false;
      }
      if (adminRoleFilter !== "all") {
        if (adminRoleFilter === "admin" && !r.isAdmin) return false;
        if (adminRoleFilter === "nonAdmin" && r.isAdmin) return false;
      }
      return true;
    });
  }, [rows, search, registeredFilter, methodFilter, phishingResistantFilter, licenseFilter, adminRoleFilter]);

  const isAllSelected = filteredRows.length > 0 && filteredRows.every((r) => selectedIds.has(r.userId));
  const selectedRows = useMemo(() => {
    return rows.filter((r) => selectedIds.has(r.userId));
  }, [rows, selectedIds]);

  const toggleSelectAll = (): void => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredRows.map((r) => r.userId)));
    }
  };

  const toggleSelectRow = (userId: string): void => {
    const next = new Set(selectedIds);
    if (next.has(userId)) {
      next.delete(userId);
    } else {
      next.add(userId);
    }
    setSelectedIds(next);
  };

  const bulkResetDisabled = selectedRows.length === 0 || Boolean(disabledReasons?.bulkReset);
  const bulkResetTitle = disabledReasons?.bulkReset || (selectedRows.length === 0 ? "Select users first" : "Require MFA re-registration for selected users");

  const bulkPushDisabled = selectedRows.length === 0 || Boolean(disabledReasons?.bulkPush);
  const bulkPushTitle = disabledReasons?.bulkPush || (selectedRows.length === 0 ? "Select users first" : "Send push notification to selected users");

  return (
    <div style={containerStyle} data-testid="mfa-report-table-root">
      <div style={headerBarStyle}>
        <div style={filterRowStyle}>
          <input
            style={inputStyle}
            type="search"
            placeholder="Search user or UPN..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="filter-search"
          />

          <select
            style={selectStyle}
            value={registeredFilter}
            onChange={(e) => setRegisteredFilter(e.target.value)}
            data-testid="filter-registered"
          >
            <option value="all">All states</option>
            <option value="registered">Registered</option>
            <option value="notRegistered">Not registered</option>
          </select>

          <select
            style={selectStyle}
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            data-testid="filter-method"
          >
            <option value="all">All methods</option>
            {availableMethods.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          <select
            style={selectStyle}
            value={phishingResistantFilter}
            onChange={(e) => setPhishingResistantFilter(e.target.value)}
            data-testid="filter-phishing-resistant"
          >
            <option value="all">Phishing resistance: All</option>
            <option value="yes">Phishing-resistant</option>
            <option value="no">Not phishing-resistant</option>
          </select>

          <select
            style={selectStyle}
            value={licenseFilter}
            onChange={(e) => setLicenseFilter(e.target.value)}
            data-testid="filter-license"
          >
            <option value="all">All licenses</option>
            <option value="licensed">Licensed</option>
            <option value="unlicensed">Unlicensed</option>
          </select>

          <select
            style={selectStyle}
            value={adminRoleFilter}
            onChange={(e) => setAdminRoleFilter(e.target.value)}
            data-testid="filter-admin"
          >
            <option value="all">All roles</option>
            <option value="admin">Admin</option>
            <option value="nonAdmin">Non-admin</option>
          </select>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }} data-testid="bulk-actions-bar">
          <span style={{ fontSize: "13px", color: "var(--muted)" }} data-testid="selection-count">
            {selectedRows.length} selected
          </span>
          <button
            style={{
              ...buttonStyle,
              ...(bulkResetDisabled ? { opacity: 0.6, cursor: "not-allowed" } : {}),
            }}
            type="button"
            disabled={bulkResetDisabled}
            onClick={() => onBulkReset?.(selectedRows)}
            data-testid="bulk-require-reregistration"
            title={bulkResetTitle}
          >
            Require re-registration
          </button>
          <button
            style={{
              ...buttonStyle,
              ...(bulkPushDisabled ? { opacity: 0.6, cursor: "not-allowed" } : {}),
            }}
            type="button"
            disabled={bulkPushDisabled}
            onClick={() => onBulkPush?.(selectedRows)}
            data-testid="bulk-send-push"
            title={bulkPushTitle}
          >
            Send push
          </button>
        </div>
      </div>

      {error ? (
        <div style={{ padding: "16px", color: "var(--danger)" }} data-testid="mfa-table-error">
          {error}
        </div>
      ) : null}

      <div style={tableContainerStyle}>
        <table style={tableStyle} data-testid="mfa-report-table">
          <thead>
            <tr>
              <th style={{ ...thStyle, width: "36px" }}>
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={toggleSelectAll}
                  aria-label="Select all users"
                  data-testid="select-all-mfa"
                />
              </th>
              <th style={thStyle}>User</th>
              <th style={thStyle}>UPN</th>
              <th style={thStyle}>Methods registered</th>
              <th style={thStyle}>Default method</th>
              <th style={thStyle}>Phishing-resistant?</th>
              <th style={thStyle}>Last auth</th>
              <th style={thStyle}>State</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} style={{ ...tdStyle, textAlign: "center", color: "var(--muted)" }}>
                  Loading MFA report...
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ ...tdStyle, textAlign: "center", color: "var(--muted)" }}>
                  No users found matching filters.
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => {
                const isSelected = selectedIds.has(row.userId);
                const isPhishingResistant = row.phishingResistant === "phishing-resistant";
                return (
                  <tr
                    key={row.userId}
                    style={{ background: isSelected ? "var(--bg-elev)" : "transparent" }}
                    data-testid={`mfa-row-${row.userId}`}
                  >
                    <td style={tdStyle}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectRow(row.userId)}
                        aria-label={`Select ${row.userPrincipalName}`}
                        data-testid={`select-user-${row.userId}`}
                      />
                    </td>
                    <td style={tdStyle}>{row.displayName || "—"}</td>
                    <td style={{ ...tdStyle, fontFamily: "var(--font-mono, monospace)" }}>
                      {row.userPrincipalName}
                    </td>
                    <td style={tdStyle}>
                      {row.methods.length === 0 ? (
                        <span style={{ color: "var(--muted)" }}>None</span>
                      ) : (
                        row.methods.map((m) => (
                          <span key={m} style={chipStyle}>
                            {m}
                          </span>
                        ))
                      )}
                    </td>
                    <td style={tdStyle}>{row.defaultMethod || "—"}</td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          ...badgeStyle,
                          borderColor: isPhishingResistant ? "var(--accent)" : "var(--border)",
                        }}
                      >
                        {isPhishingResistant ? "Phishing-resistant" : "Not phishing-resistant"}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      {row.lastAuthDateTime ? new Date(row.lastAuthDateTime).toLocaleDateString() : "Never"}
                    </td>
                    <td style={tdStyle}>
                      <span style={badgeStyle}>
                        {row.state === "registered" ? "Registered" : "Not registered"}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                      <div style={{ display: "inline-flex", gap: "6px" }}>
                        <button
                          style={{
                            ...buttonStyle,
                            ...(disabledReasons?.viewUser ? { opacity: 0.6, cursor: "not-allowed" } : {}),
                          }}
                          type="button"
                          disabled={Boolean(disabledReasons?.viewUser)}
                          title={disabledReasons?.viewUser}
                          onClick={() => onViewUser ? onViewUser(row) : onAction?.("viewUser", row)}
                          data-testid={`action-view-${row.userId}`}
                        >
                          View user
                        </button>
                        <button
                          style={{
                            ...buttonStyle,
                            ...(disabledReasons?.resetMfa ? { opacity: 0.6, cursor: "not-allowed" } : {}),
                          }}
                          type="button"
                          disabled={Boolean(disabledReasons?.resetMfa)}
                          title={disabledReasons?.resetMfa}
                          onClick={() => onAction?.("resetMfa", row)}
                          data-testid={`action-reset-${row.userId}`}
                        >
                          Reset MFA
                        </button>
                        <button
                          style={{
                            ...buttonStyle,
                            ...(disabledReasons?.requireReregistration ? { opacity: 0.6, cursor: "not-allowed" } : {}),
                          }}
                          type="button"
                          disabled={Boolean(disabledReasons?.requireReregistration)}
                          title={disabledReasons?.requireReregistration}
                          onClick={() => onAction?.("requireReregistration", row)}
                          data-testid={`action-require-reregistration-${row.userId}`}
                        >
                          Require re-registration
                        </button>
                        <button
                          style={{
                            ...buttonStyle,
                            ...(disabledReasons?.createTap ? { opacity: 0.6, cursor: "not-allowed" } : {}),
                          }}
                          type="button"
                          disabled={Boolean(disabledReasons?.createTap)}
                          title={disabledReasons?.createTap}
                          onClick={() => onAction?.("createTap", row)}
                          data-testid={`action-tap-${row.userId}`}
                        >
                          Create TAP
                        </button>
                        <button
                          style={{
                            ...buttonStyle,
                            ...(disabledReasons?.sendPush ? { opacity: 0.6, cursor: "not-allowed" } : {}),
                          }}
                          type="button"
                          disabled={Boolean(disabledReasons?.sendPush)}
                          title={disabledReasons?.sendPush}
                          onClick={() => onAction?.("sendPush", row)}
                          data-testid={`action-push-${row.userId}`}
                        >
                          Send push
                        </button>
                        <button
                          style={{
                            ...buttonStyle,
                            ...(disabledReasons?.setDefaultMethod ? { opacity: 0.6, cursor: "not-allowed" } : {}),
                          }}
                          type="button"
                          disabled={Boolean(disabledReasons?.setDefaultMethod)}
                          title={disabledReasons?.setDefaultMethod}
                          onClick={() => onAction?.("setDefaultMethod", row)}
                          data-testid={`action-default-${row.userId}`}
                        >
                          Set default method
                        </button>
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
