"use client";

import React, { useEffect, useState, type CSSProperties, type ReactElement } from "react";

interface GdapRelationshipItem {
  readonly tenantId: string;
  readonly customerName?: string;
  readonly relationshipEnd?: string | null;
  readonly delegatedPrivilegeStatus?: string | null;
  readonly cpvConsentState?: string | null;
  readonly lastSynced?: string | null;
}

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

const primaryButtonStyle: CSSProperties = {
  padding: "10px 18px",
  background: "var(--accent)",
  color: "var(--on-accent)",
  border: "1px solid var(--accent)",
  borderRadius: "6px",
  fontWeight: 600,
  fontSize: "14px",
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
};

const tdStyle: CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid var(--border)",
  color: "var(--text)",
};

export default function GdapManagementPage(): ReactElement {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [relationships, setRelationships] = useState<GdapRelationshipItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const checkFeatureAndFetch = async (): Promise<void> => {
    setLoading(true);
    try {
      // Check if GDAP sync route is active
      const probeRes = await fetch("/v1/gdap/relationships");
      if (probeRes.status === 404 || probeRes.status === 501) {
        setEnabled(false);
        setLoading(false);
        return;
      }
      setEnabled(true);
      if (probeRes.ok) {
        const data = await probeRes.json();
        setRelationships(data.items ?? data ?? []);
      }
    } catch {
      // If error or endpoint unmounted, treated as disabled
      setEnabled(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void checkFeatureAndFetch();
  }, []);

  const handleSync = async (): Promise<void> => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch("/v1/gdap/sync", { method: "POST" });
      if (!res.ok) throw new Error(`Sync failed: HTTP ${res.status}`);
      const data = await res.json();
      setSyncMessage(`Sync completed: ${data.syncedCount ?? data.totalDiscovered ?? 0} relationship(s) processed.`);
      await checkFeatureAndFetch();
    } catch (err) {
      setSyncMessage(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div style={{ ...pageStyle, textAlign: "center", padding: "64px" }} data-testid="gdap-loading">
        <p style={{ color: "var(--text-soft)" }}>Checking GDAP feature status...</p>
      </div>
    );
  }

  // Acceptance criteria: The GDAP page renders only when the feature flag is enabled
  if (enabled === false) {
    return (
      <div style={pageStyle} data-testid="gdap-disabled-state">
        <div
          style={{
            padding: "48px 24px",
            textAlign: "center",
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius, 10px)",
            maxWidth: "600px",
            margin: "40px auto",
          }}
        >
          <h2 style={{ margin: "0 0 12px", fontSize: "20px" }}>GDAP Management Disabled</h2>
          <p style={{ margin: 0, color: "var(--text-soft)", fontSize: "14px", lineHeight: 1.6 }}>
            The Granular Delegated Admin Privileges (GDAP) tenant source is currently disabled.
            To enable Partner Center discovery and relationship management, configure the GDAP feature flag.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle} data-testid="gdap-management-page">
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>GDAP Management</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-soft)", fontSize: "14px" }}>
            Monitor delegated admin relationships, approved security roles, and CPV consent state.
          </p>
        </div>

        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          style={primaryButtonStyle}
          data-testid="gdap-sync-btn"
        >
          {syncing ? "Syncing GDAP..." : "Sync from Partner Center"}
        </button>
      </div>

      {syncMessage && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: "6px",
            background: "var(--accent-soft)",
            border: "1px solid var(--accent)",
            color: "var(--accent-text)",
            fontSize: "14px",
          }}
          data-testid="gdap-sync-banner"
        >
          {syncMessage}
        </div>
      )}

      {relationships.length === 0 ? (
        <div
          style={{
            padding: "48px 16px",
            textAlign: "center",
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius, 10px)",
            color: "var(--text-soft)",
          }}
          data-testid="gdap-empty-state"
        >
          No GDAP relationships discovered yet. Click "Sync from Partner Center" to enumerate active relationships.
        </div>
      ) : (
        <div style={tableWrapperStyle}>
          <table style={tableStyle} data-testid="gdap-relationships-table">
            <thead>
              <tr>
                <th style={thStyle}>Tenant ID</th>
                <th style={thStyle}>Customer Name</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Relationship End</th>
                <th style={thStyle}>CPV Consent</th>
                <th style={thStyle}>Last Synced</th>
              </tr>
            </thead>
            <tbody>
              {relationships.map((r) => (
                <tr key={r.tenantId} data-testid={`gdap-row-${r.tenantId}`}>
                  <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", fontSize: "13px" }}>
                    {r.tenantId}
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{r.customerName ?? "—"}</td>
                  <td style={tdStyle}>{r.delegatedPrivilegeStatus ?? "active"}</td>
                  <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>
                    {r.relationshipEnd ? new Date(r.relationshipEnd).toLocaleDateString() : "—"}
                  </td>
                  <td style={tdStyle}>{r.cpvConsentState ?? "active"}</td>
                  <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums", color: "var(--text-soft)" }}>
                    {r.lastSynced ? new Date(r.lastSynced).toLocaleString() : "Never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
