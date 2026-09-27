"use client";

// User reports page (EPIC-011 SPEC.md §3.2 US-8, T-0209).
// Renders the inactive, guest, and sign-in report views from the shared
// T-0201 read path via ?report= presets. Strictly uses report theme tokens
// with zero colour literals.

import React, { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import { listTenantUsers, type TenantUser, type TenantUsersReport } from "../../../lib/usersApi";
import { useCurrentTenantId } from "../../../lib/useCurrentTenant";

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

const sectionStyle: CSSProperties = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  padding: "16px",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "14px",
  textAlign: "left",
};

const thStyle: CSSProperties = {
  padding: "8px 12px",
  borderBottom: "1px solid var(--border)",
  color: "var(--text-soft)",
  fontWeight: 600,
  fontSize: "12px",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const tdStyle: CSSProperties = {
  padding: "8px 12px",
  borderBottom: "1px solid var(--border)",
  color: "var(--text)",
};

const monoStyle: CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  fontSize: "13px",
};

const REPORTS: ReadonlyArray<{ report: TenantUsersReport; title: string; description: string }> = [
  { report: "inactive", title: "Inactive users", description: "Users whose last sign-in is older than the threshold (or never)." },
  { report: "guest", title: "Guest users", description: "External guests in the tenant directory." },
  { report: "signin", title: "Sign-in report", description: "Users ordered by most recent sign-in." },
];

export default function UserReportsPage(): ReactElement {
  const [tenantId, setTenantId] = useState("");
  // Follow the tenant chosen in the shell; the box still accepts another id.
  const currentTenant = useCurrentTenantId();
  useEffect(() => {
    if (currentTenant) {
      setTenantId(currentTenant);
    }
  }, [currentTenant]);
  const [inactiveDays, setInactiveDays] = useState("90");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Partial<Record<TenantUsersReport, TenantUser[]>>>({});

  async function loadReports(): Promise<void> {
    const tenant = tenantId.trim();
    if (!tenant) {
      setError("Enter a tenant id to load the reports.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const days = Number(inactiveDays) || 90;
      const [inactive, guest, signin] = await Promise.all([
        listTenantUsers(tenant, { report: "inactive", inactiveDays: days, limit: 100 }),
        listTenantUsers(tenant, { report: "guest", limit: 100 }),
        listTenantUsers(tenant, { report: "signin", limit: 100 }),
      ]);
      setResults({ inactive: [...inactive.items], guest: [...guest.items], signin: [...signin.items] });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={pageStyle} data-testid="user-reports-page">
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>User reports</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-soft)", fontSize: "14px" }}>
            Inactive, guest, and sign-in views from the shared directory read.
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
            data-testid="reports-tenant-input"
          />
          <input
            type="number"
            min={1}
            value={inactiveDays}
            onChange={(e) => setInactiveDays(e.target.value)}
            style={{ ...inputStyle, width: "90px" }}
            aria-label="Inactive days threshold"
            data-testid="reports-inactive-days"
          />
          <button type="button" style={buttonStyle} onClick={() => void loadReports()} data-testid="reports-load-button">
            Load reports
          </button>
        </div>
      </div>

      {loading && <div style={{ color: "var(--text-soft)" }}>Loading user reports...</div>}
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

      {REPORTS.map(({ report, title, description }) => {
        const rows = results[report] ?? [];
        return (
          <section key={report} style={sectionStyle} data-testid={`report-section-${report}`}>
            <div>
              <h2 style={{ margin: 0, fontSize: "18px" }}>
                {title} ({rows.length})
              </h2>
              <p style={{ margin: "4px 0 0", color: "var(--text-soft)", fontSize: "13px" }}>{description}</p>
            </div>
            {rows.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table style={tableStyle} aria-label={title}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Display name</th>
                      <th style={thStyle}>UPN</th>
                      <th style={thStyle}>Status</th>
                      <th style={thStyle}>Last sign-in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((user) => (
                      <tr key={user.id} data-testid={`report-row-${report}-${user.id}`}>
                        <td style={tdStyle}>{user.displayName ?? "—"}</td>
                        <td style={tdStyle}><span style={monoStyle}>{user.userPrincipalName}</span></td>
                        <td style={tdStyle}>{user.status}</td>
                        <td style={tdStyle}>{user.lastSignInDateTime ?? "Never"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
