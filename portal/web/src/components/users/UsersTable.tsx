"use client";

// Users table and list component (EPIC-011 SPEC.md §3.1, T-0209).
// Renders every §3.1 column (display name, UPN mono, type, licenses, MFA
// state, last sign-in, status, department), supports status/type/license/MFA/
// department/sign-in-age filters, provides row actions (T-0204 lifecycle
// actions plus View/BEC/offboard callbacks), supports bulk selection with
// disable and property-patch bulk actions, and opens an off-canvas row detail
// with a More info item. Actions whose endpoints belong to later epics
// (Reset MFA → EPIC-012, licence/group writes → EPIC-033/EPIC-014, single
// edit and delete → later tickets) render disabled with a reason. Strictly
// uses report theme tokens with zero colour literals.

import React, { useMemo, useState, type CSSProperties, type ReactElement } from "react";
import type { TenantUser, UserLifecycleAction } from "../../lib/usersApi";

export type UserRowAction =
  | UserLifecycleAction
  | "offboard"
  | "becCheck";

export interface UsersTableProps {
  readonly users?: readonly TenantUser[];
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onView?: (user: TenantUser) => void;
  readonly onAction?: (action: UserRowAction, user: TenantUser) => void;
  readonly onBulkDisable?: (users: readonly TenantUser[]) => void;
  readonly onBulkPatch?: (users: readonly TenantUser[]) => void;
  readonly onAddUser?: () => void;
  readonly onAddBulk?: () => void;
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
  fontSize: "14px",
  fontWeight: 500,
  cursor: "pointer",
};

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "var(--accent)",
  color: "var(--accent-text)",
  borderColor: "var(--accent)",
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
  color: "var(--text)",
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
  textDecoration: "none",
};

const disabledActionBtnStyle: CSSProperties = {
  ...actionBtnStyle,
  opacity: 0.4,
  cursor: "not-allowed",
};

const drawerOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--overlay)",
  zIndex: 60,
};

const drawerStyle: CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  bottom: 0,
  width: "min(420px, 100vw)",
  background: "var(--bg-elev)",
  borderLeft: "1px solid var(--border)",
  boxShadow: "var(--shadow-card)",
  zIndex: 61,
  padding: "24px",
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};

function badgeStyle(kind: "ok" | "warn" | "muted" | "bad"): CSSProperties {
  const tones = {
    ok: { bg: "var(--success-soft)", text: "var(--success-text)", border: "var(--success)" },
    warn: { bg: "var(--warning-soft)", text: "var(--warning-text)", border: "var(--warning)" },
    muted: { bg: "var(--surface)", text: "var(--text-soft)", border: "var(--border)" },
    bad: { bg: "var(--danger-soft)", text: "var(--danger-text)", border: "var(--danger)" },
  }[kind];
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 600,
    textTransform: "capitalize",
    background: tones.bg,
    color: tones.text,
    border: `1px solid ${tones.border}`,
  };
}

export function mfaBadgeKind(mfaState: TenantUser["mfaState"]): "ok" | "warn" | "muted" {
  if (mfaState === "registered") return "ok";
  if (mfaState === "notRegistered") return "warn";
  return "muted";
}

export function formatLastSignIn(value: string | null): string {
  if (!value) return "Never";
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) return value;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return value;
  }
}

export function signInAgeDays(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (isNaN(time)) return null;
  return Math.floor((now - time) / 86400000);
}

interface RowActionDef {
  readonly key: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly reason?: string;
  readonly run?: (user: TenantUser) => void;
}

export function UsersTable({
  users = [],
  loading = false,
  error = null,
  onView,
  onAction,
  onBulkDisable,
  onBulkPatch,
  onAddUser,
  onAddBulk,
}: UsersTableProps): ReactElement {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [licenseFilter, setLicenseFilter] = useState("all");
  const [mfaFilter, setMfaFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [signInAgeFilter, setSignInAgeFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailUser, setDetailUser] = useState<TenantUser | null>(null);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((user) => {
      if (query) {
        const haystack = `${user.displayName ?? ""} ${user.userPrincipalName}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (statusFilter !== "all" && user.status !== statusFilter) return false;
      if (typeFilter !== "all" && user.userType !== typeFilter) return false;
      if (licenseFilter === "licensed" && user.licenses.length === 0) return false;
      if (licenseFilter === "unlicensed" && user.licenses.length > 0) return false;
      if (mfaFilter !== "all" && user.mfaState !== mfaFilter) return false;
      if (departmentFilter.trim() && (user.department ?? "").toLowerCase() !== departmentFilter.trim().toLowerCase()) {
        return false;
      }
      if (signInAgeFilter !== "all") {
        const age = signInAgeDays(user.lastSignInDateTime);
        if (signInAgeFilter === "never" && age !== null) return false;
        if (signInAgeFilter === "30" && (age === null || age <= 30)) return false;
        if (signInAgeFilter === "90" && (age === null || age <= 90)) return false;
      }
      return true;
    });
  }, [users, search, statusFilter, typeFilter, licenseFilter, mfaFilter, departmentFilter, signInAgeFilter]);

  const allSelected = filteredUsers.length > 0 && filteredUsers.every((user) => selected.has(user.id));
  const selectedUsers = useMemo(
    () => filteredUsers.filter((user) => selected.has(user.id)),
    [filteredUsers, selected],
  );

  function toggleSelect(id: string): void {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectAll(): void {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredUsers.map((user) => user.id)));
    }
  }

  function rowActions(user: TenantUser): RowActionDef[] {
    const enabled = user.status === "enabled";
    return [
      { key: "view", label: "View", enabled: true, run: (target) => onView?.(target) },
      { key: "edit", label: "Edit", enabled: false, reason: "Single-user edit arrives with a later ticket" },
      { key: "resetPassword", label: "Reset password", enabled: true, run: (target) => onAction?.("resetPassword", target) },
      {
        key: "requirePasswordChange",
        label: "Require password change",
        enabled: true,
        run: (target) => onAction?.("requirePasswordChange", target),
      },
      { key: "revokeSessions", label: "Revoke sessions", enabled: true, run: (target) => onAction?.("revokeSessions", target) },
      enabled
        ? { key: "disable", label: "Disable", enabled: true, run: (target) => onAction?.("disable", target) }
        : { key: "enable", label: "Enable", enabled: true, run: (target) => onAction?.("enable", target) },
      { key: "resetMfa", label: "Reset MFA", enabled: false, reason: "MFA reset arrives with EPIC-012" },
      { key: "licenses", label: "Manage licenses", enabled: false, reason: "Licence management arrives with EPIC-033" },
      { key: "becCheck", label: "Run BEC check", enabled: true, run: (target) => onAction?.("becCheck", target) },
      { key: "offboard", label: "Offboard", enabled: true, run: (target) => onAction?.("offboard", target) },
      { key: "delete", label: "Delete", enabled: false, reason: "User delete arrives with a later ticket" },
    ];
  }

  return (
    <div style={containerStyle} data-testid="users-table-container">
      <div style={headerBarStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 600 }}>Users</h2>
          <span
            style={{
              padding: "2px 8px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "999px",
              fontSize: "12px",
              color: "var(--text-soft)",
            }}
          >
            {filteredUsers.length} {filteredUsers.length === 1 ? "user" : "users"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {onAddBulk && (
            <button type="button" style={buttonStyle} onClick={onAddBulk} data-testid="add-bulk-button">
              Add bulk
            </button>
          )}
          {onAddUser && (
            <button type="button" style={primaryButtonStyle} onClick={onAddUser} data-testid="add-user-button">
              Add user
            </button>
          )}
        </div>
      </div>

      <div style={{ ...headerBarStyle, padding: "12px 16px" }}>
        <div style={filterRowStyle}>
          <input
            type="text"
            placeholder="Search name or UPN..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={inputStyle}
            aria-label="Search users"
            data-testid="filter-search"
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle} aria-label="Filter by status" data-testid="filter-status">
            <option value="all">All statuses</option>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={selectStyle} aria-label="Filter by type" data-testid="filter-type">
            <option value="all">All types</option>
            <option value="member">Member</option>
            <option value="guest">Guest</option>
          </select>
          <select value={licenseFilter} onChange={(e) => setLicenseFilter(e.target.value)} style={selectStyle} aria-label="Filter by license" data-testid="filter-license">
            <option value="all">All licenses</option>
            <option value="licensed">Licensed</option>
            <option value="unlicensed">Unlicensed</option>
          </select>
          <select value={mfaFilter} onChange={(e) => setMfaFilter(e.target.value)} style={selectStyle} aria-label="Filter by MFA state" data-testid="filter-mfa">
            <option value="all">All MFA states</option>
            <option value="registered">MFA registered</option>
            <option value="notRegistered">MFA not registered</option>
            <option value="unknown">MFA unknown</option>
          </select>
          <input
            type="text"
            placeholder="Department..."
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            style={inputStyle}
            aria-label="Filter by department"
            data-testid="filter-department"
          />
          <select value={signInAgeFilter} onChange={(e) => setSignInAgeFilter(e.target.value)} style={selectStyle} aria-label="Filter by last sign-in age" data-testid="filter-signin-age">
            <option value="all">Any sign-in age</option>
            <option value="never">Never signed in</option>
            <option value="30">Inactive 30+ days</option>
            <option value="90">Inactive 90+ days</option>
          </select>
        </div>
      </div>

      {selectedUsers.length > 0 && (
        <div style={{ ...headerBarStyle, padding: "12px 16px" }} data-testid="bulk-actions-bar">
          <span style={{ fontSize: "14px", color: "var(--text-soft)" }}>
            {selectedUsers.length} selected
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              style={actionBtnStyle}
              disabled
              title="Licence assignment arrives with EPIC-033"
              data-testid="bulk-license-assign"
            >
              Assign license
            </button>
            <button
              type="button"
              style={actionBtnStyle}
              disabled
              title="Group management arrives with EPIC-014"
              data-testid="bulk-group-add"
            >
              Add to group
            </button>
            {onBulkDisable && (
              <button
                type="button"
                style={actionBtnStyle}
                onClick={() => onBulkDisable(selectedUsers)}
                data-testid="bulk-disable"
              >
                Disable
              </button>
            )}
            {onBulkPatch && (
              <button
                type="button"
                style={actionBtnStyle}
                onClick={() => onBulkPatch(selectedUsers)}
                data-testid="bulk-patch"
              >
                Patch properties
              </button>
            )}
          </div>
        </div>
      )}

      {loading && (
        <div style={{ padding: "32px", textAlign: "center", color: "var(--text-soft)" }}>
          Loading tenant users...
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

      {!loading && !error && filteredUsers.length === 0 && (
        <div
          style={{
            padding: "48px 16px",
            textAlign: "center",
            background: "var(--bg-elev)",
            borderRadius: "var(--radius, 10px)",
            border: "1px solid var(--border)",
            color: "var(--text-soft)",
          }}
          data-testid="empty-users-state"
        >
          No users found.
        </div>
      )}

      {!loading && !error && filteredUsers.length > 0 && (
        <div style={tableWrapperStyle}>
          <table style={tableStyle} aria-label="Tenant users">
            <thead>
              <tr>
                <th style={thStyle}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    aria-label="Select all users"
                    data-testid="select-all-users"
                  />
                </th>
                <th style={thStyle}>Display name</th>
                <th style={thStyle}>UPN</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Licenses</th>
                <th style={thStyle}>MFA state</th>
                <th style={thStyle}>Last sign-in</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Department</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id} data-testid={`user-row-${user.id}`}>
                  <td style={tdStyle}>
                    <input
                      type="checkbox"
                      checked={selected.has(user.id)}
                      onChange={() => toggleSelect(user.id)}
                      aria-label={`Select ${user.userPrincipalName}`}
                      data-testid={`select-user-${user.id}`}
                    />
                  </td>
                  <td style={tdStyle}>{user.displayName ?? "—"}</td>
                  <td style={tdStyle}>
                    <span style={monoStyle}>{user.userPrincipalName}</span>
                  </td>
                  <td style={tdStyle}>
                    <span style={badgeStyle("muted")}>{user.userType}</span>
                  </td>
                  <td style={tdStyle}>{user.licenses.length > 0 ? user.licenses.length : "—"}</td>
                  <td style={tdStyle}>
                    <span style={badgeStyle(mfaBadgeKind(user.mfaState))}>{user.mfaState}</span>
                  </td>
                  <td style={tdStyle}>{formatLastSignIn(user.lastSignInDateTime)}</td>
                  <td style={tdStyle}>
                    <span style={badgeStyle(user.status === "enabled" ? "ok" : "bad")}>{user.status}</span>
                  </td>
                  <td style={tdStyle}>{user.department ?? "—"}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <div style={{ display: "inline-flex", gap: "6px", justifyContent: "flex-end", flexWrap: "wrap" }}>
                      {rowActions(user).map((action) =>
                        action.enabled ? (
                          <button
                            key={action.key}
                            type="button"
                            style={actionBtnStyle}
                            onClick={() => {
                              if (action.key === "view") {
                                setDetailUser(user);
                              }
                              action.run?.(user);
                            }}
                            aria-label={`${action.label} ${user.userPrincipalName}`}
                            data-testid={`action-${action.key}-${user.id}`}
                          >
                            {action.label}
                          </button>
                        ) : (
                          <button
                            key={action.key}
                            type="button"
                            style={disabledActionBtnStyle}
                            disabled
                            title={action.reason ?? "Unavailable"}
                            aria-label={`${action.label} ${user.userPrincipalName} (unavailable: ${action.reason ?? "unavailable"})`}
                            data-testid={`action-${action.key}-${user.id}`}
                          >
                            {action.label}
                          </button>
                        ),
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detailUser && (
        <>
          <div
            style={drawerOverlayStyle}
            onClick={() => setDetailUser(null)}
            data-testid="user-detail-overlay"
          />
          <aside style={drawerStyle} role="dialog" aria-label={`User detail for ${detailUser.userPrincipalName}`} data-testid="user-detail-drawer">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: "18px" }}>{detailUser.displayName ?? detailUser.userPrincipalName}</h3>
              <button
                type="button"
                style={actionBtnStyle}
                onClick={() => setDetailUser(null)}
                aria-label="Close user detail"
                data-testid="close-user-detail"
              >
                Close
              </button>
            </div>
            <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: "8px", fontSize: "14px" }}>
              <div><dt style={{ color: "var(--text-soft)" }}>UPN</dt><dd style={{ ...monoStyle, margin: 0 }}>{detailUser.userPrincipalName}</dd></div>
              <div><dt style={{ color: "var(--text-soft)" }}>Type</dt><dd style={{ margin: 0 }}>{detailUser.userType}</dd></div>
              <div><dt style={{ color: "var(--text-soft)" }}>Status</dt><dd style={{ margin: 0 }}>{detailUser.status}</dd></div>
              <div><dt style={{ color: "var(--text-soft)" }}>Department</dt><dd style={{ margin: 0 }}>{detailUser.department ?? "—"}</dd></div>
              <div><dt style={{ color: "var(--text-soft)" }}>Licenses</dt><dd style={{ margin: 0 }}>{detailUser.licenses.join(", ") || "—"}</dd></div>
              <div><dt style={{ color: "var(--text-soft)" }}>MFA state</dt><dd style={{ margin: 0 }}>{detailUser.mfaState}</dd></div>
              <div><dt style={{ color: "var(--text-soft)" }}>Last sign-in</dt><dd style={{ margin: 0 }}>{formatLastSignIn(detailUser.lastSignInDateTime)}</dd></div>
              <div><dt style={{ color: "var(--text-soft)" }}>More info</dt><dd style={{ margin: 0 }}>Open the user detail page for Exchange, OneDrive, BEC, and Conditional Access tabs.</dd></div>
            </dl>
          </aside>
        </>
      )}
    </div>
  );
}
