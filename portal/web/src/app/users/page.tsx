"use client";

// Users page (EPIC-011 SPEC.md §3.1, T-0209).
// Title Users with primary Add user and secondary Add bulk (CSV wizard)
// actions, the UsersTable with filters/row/bulk actions, and an off-canvas
// row detail. Lifecycle actions run through the T-0204 endpoints with
// confirmation for session-breaking writes; a returned one-time password is
// shown once in a dismissible banner and never persisted. Strictly uses
// report theme tokens with zero colour literals.

import React, { useCallback, useState, type CSSProperties, type ReactElement } from "react";
import { UsersTable, type UserRowAction } from "../../components/users/UsersTable";
import {
  createTenantUsers,
  executeUserAction,
  listTenantUsers,
  type TenantUser,
} from "../../lib/usersApi";

const pageStyle: CSSProperties = {
  padding: "32px",
  maxWidth: "1400px",
  margin: "0 auto",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
  display: "flex",
  flexDirection: "column",
  gap: "24px",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  borderBottom: "1px solid var(--border)",
  paddingBottom: "16px",
};

const titleStyle: CSSProperties = {
  fontSize: "24px",
  fontWeight: 700,
  margin: 0,
  fontFamily: "var(--font-display, var(--font-sans))",
};

const inputStyle: CSSProperties = {
  padding: "8px 12px",
  background: "var(--input-bg, var(--bg))",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "14px",
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

const bannerStyle: CSSProperties = {
  padding: "16px",
  borderRadius: "6px",
  background: "var(--warning-soft)",
  border: "1px solid var(--warning)",
  color: "var(--warning-text)",
  fontSize: "14px",
};

const dialogOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--overlay)",
  zIndex: 60,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const dialogStyle: CSSProperties = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  padding: "24px",
  width: "min(520px, 90vw)",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};

const CONFIRM_ACTIONS: ReadonlySet<string> = new Set(["revokeSessions", "disable"]);

export default function UsersPage(): ReactElement {
  const [tenantId, setTenantId] = useState("");
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [oneTimePassword, setOneTimePassword] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [formUpn, setFormUpn] = useState("");
  const [formDisplayName, setFormDisplayName] = useState("");
  const [formUsageLocation, setFormUsageLocation] = useState("");
  const [bulkCsv, setBulkCsv] = useState("");
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  const fetchUsers = useCallback(async (tenant: string): Promise<void> => {
    if (!tenant.trim()) {
      setError("Enter a tenant id to list its users.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const page = await listTenantUsers(tenant.trim(), { limit: 100 });
      setUsers([...page.items]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  async function handleAction(action: UserRowAction, user: TenantUser): Promise<void> {
    if (action === "becCheck") {
      window.location.href = `/users/${encodeURIComponent(user.id)}?tab=bec`;
      return;
    }
    if (action === "offboard") {
      window.location.href = `/offboarding?userId=${encodeURIComponent(user.id)}`;
      return;
    }
    const tenant = tenantId.trim();
    if (!tenant) {
      setError("Enter a tenant id before running lifecycle actions.");
      return;
    }
    if (CONFIRM_ACTIONS.has(action)) {
      const confirmed = window.confirm(`${action} ${user.userPrincipalName}? This breaks sessions or removes access.`);
      if (!confirmed) return;
    }
    setError(null);
    setNotice(null);
    setOneTimePassword(null);
    try {
      const result = await executeUserAction(tenant, user.id, action, {
        confirm: CONFIRM_ACTIONS.has(action) ? true : undefined,
      });
      if (result.status === "failed") {
        setError(result.error ?? `${action} failed without detail.`);
      } else {
        setNotice(`${action} applied to ${user.userPrincipalName}.`);
        if (result.password) {
          setOneTimePassword(result.password);
        }
      }
      await fetchUsers(tenant);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleBulkDisable(targets: readonly TenantUser[]): Promise<void> {
    const tenant = tenantId.trim();
    if (!tenant) {
      setError("Enter a tenant id before running bulk actions.");
      return;
    }
    const confirmed = window.confirm(`Disable ${targets.length} selected users?`);
    if (!confirmed) return;
    setError(null);
    try {
      for (const user of targets) {
        await executeUserAction(tenant, user.id, "disable", { confirm: true });
      }
      setNotice(`Disabled ${targets.length} users.`);
      await fetchUsers(tenant);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleBulkPatch(targets: readonly TenantUser[]): void {
    window.location.href = `/users/reports?bulkPatch=${targets.map((user) => encodeURIComponent(user.id)).join(",")}`;
  }

  async function handleCreate(): Promise<void> {
    const tenant = tenantId.trim();
    if (!tenant) {
      setError("Enter a tenant id before creating users.");
      return;
    }
    setError(null);
    try {
      const outcome = await createTenantUsers(tenant, {
        userPrincipalName: formUpn.trim(),
        displayName: formDisplayName.trim(),
        usageLocation: formUsageLocation.trim(),
      });
      const row = outcome.rows[0];
      if (!row || row.status !== "created") {
        setError(row?.error ?? "Create failed without detail.");
        return;
      }
      setCreateOpen(false);
      setFormUpn("");
      setFormDisplayName("");
      setFormUsageLocation("");
      setNotice(`Created ${row.userPrincipalName}.`);
      await fetchUsers(tenant);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleBulkCreate(): Promise<void> {
    const tenant = tenantId.trim();
    if (!tenant) {
      setError("Enter a tenant id before creating users.");
      return;
    }
    setError(null);
    setBulkResult(null);
    try {
      const outcome = await createTenantUsers(tenant, { csv: bulkCsv });
      const created = outcome.rows.filter((row) => row.status === "created").length;
      const failed = outcome.rows.filter((row) => row.status === "failed").length;
      setBulkResult(
        `${created} created, ${failed} failed.` +
          (failed > 0
            ? ` ${outcome.rows
                .filter((row) => row.status === "failed")
                .map((row) => `Row ${row.row}: ${row.error}`)
                .join(" ")}`
            : ""),
      );
      await fetchUsers(tenant);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div style={pageStyle} data-testid="users-page">
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>Users</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-soft)", fontSize: "14px" }}>
            List, search, and filter tenant users, then act on rows with gated lifecycle actions.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <input
            type="text"
            placeholder="Tenant id..."
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            style={inputStyle}
            aria-label="Tenant id"
            data-testid="users-tenant-input"
          />
          <button type="button" style={buttonStyle} onClick={() => void fetchUsers(tenantId)} data-testid="users-load-button">
            Load
          </button>
          <a href="/users/reports" style={{ ...buttonStyle, textDecoration: "none" }} data-testid="users-reports-link">
            Reports
          </a>
        </div>
      </div>

      {oneTimePassword && (
        <div style={bannerStyle} role="alert" data-testid="one-time-password-banner">
          One-time password (shown once, never stored): <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{oneTimePassword}</span>
          <button type="button" style={{ ...buttonStyle, marginLeft: "12px" }} onClick={() => setOneTimePassword(null)} data-testid="dismiss-password-button">
            Dismiss
          </button>
        </div>
      )}

      {notice && (
        <div
          style={{ ...bannerStyle, background: "var(--success-soft)", borderColor: "var(--success)", color: "var(--success-text)" }}
          data-testid="users-notice"
        >
          {notice}
        </div>
      )}

      <UsersTable
        users={users}
        loading={loading}
        error={error}
        onView={() => undefined}
        onAction={(action, user) => void handleAction(action, user)}
        onBulkDisable={(targets) => void handleBulkDisable(targets)}
        onBulkPatch={handleBulkPatch}
        onAddUser={() => setCreateOpen(true)}
        onAddBulk={() => setBulkOpen(true)}
      />

      {createOpen && (
        <div style={dialogOverlayStyle} data-testid="add-user-dialog" role="dialog" aria-modal="true" aria-label="Add user">
          <div style={dialogStyle}>
            <h3 style={{ margin: 0 }}>Add user</h3>
            <input type="text" placeholder="UPN (name@example.invalid)" value={formUpn} onChange={(e) => setFormUpn(e.target.value)} style={inputStyle} aria-label="User principal name" data-testid="create-upn-input" />
            <input type="text" placeholder="Display name" value={formDisplayName} onChange={(e) => setFormDisplayName(e.target.value)} style={inputStyle} aria-label="Display name" data-testid="create-displayname-input" />
            <input type="text" placeholder="Usage location (US)" value={formUsageLocation} onChange={(e) => setFormUsageLocation(e.target.value)} style={inputStyle} aria-label="Usage location" data-testid="create-usagelocation-input" />
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button type="button" style={buttonStyle} onClick={() => setCreateOpen(false)} data-testid="create-cancel-button">
                Cancel
              </button>
              <button type="button" style={{ ...buttonStyle, background: "var(--accent)", color: "var(--accent-text)", borderColor: "var(--accent)" }} onClick={() => void handleCreate()} data-testid="create-submit-button">
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkOpen && (
        <div style={dialogOverlayStyle} data-testid="add-bulk-dialog" role="dialog" aria-modal="true" aria-label="Add bulk users">
          <div style={dialogStyle}>
            <h3 style={{ margin: 0 }}>Add bulk (CSV)</h3>
            <p style={{ margin: 0, fontSize: "13px", color: "var(--text-soft)" }}>
              Columns: userPrincipalName, displayName, givenName, surname, usageLocation, licenses, groups.
            </p>
            <textarea
              value={bulkCsv}
              onChange={(e) => setBulkCsv(e.target.value)}
              rows={8}
              style={{ ...inputStyle, fontFamily: "var(--font-mono, monospace)", fontSize: "13px" }}
              aria-label="CSV body"
              data-testid="bulk-csv-input"
            />
            {bulkResult && (
              <div style={{ fontSize: "13px" }} data-testid="bulk-result">
                {bulkResult}
              </div>
            )}
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button type="button" style={buttonStyle} onClick={() => setBulkOpen(false)} data-testid="bulk-cancel-button">
                Close
              </button>
              <button type="button" style={{ ...buttonStyle, background: "var(--accent)", color: "var(--accent-text)", borderColor: "var(--accent)" }} onClick={() => void handleBulkCreate()} data-testid="bulk-submit-button">
                Validate and create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
