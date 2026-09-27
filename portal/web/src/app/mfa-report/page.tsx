"use client";

// MFA report page (EPIC-012 SPEC.md §3.1, T-0228).
// Page title "MFA Report", displays a KPI strip (total, registered, not-registered,
// phishing-resistant, per-method counts) and MfaReportTable with filters, row actions,
// and bulk actions wired to the typed mfaApi client.
// Strictly uses report theme tokens with zero colour literals.

import React, { useEffect, useCallback, useState, type CSSProperties, type ReactElement } from "react";
import { MfaKpiStrip } from "../../components/mfa/MfaKpiStrip";
import { MfaReportTable, type MfaRowAction } from "../../components/mfa/MfaReportTable";
import { fetchMfaReport, type MfaReport, type MfaUserRow } from "../../lib/mfaApi";
import { useCurrentTenantId } from "../../lib/useCurrentTenant";

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
  flexWrap: "wrap",
  gap: "16px",
};

const titleStyle: CSSProperties = {
  fontSize: "24px",
  fontWeight: 700,
  margin: 0,
  fontFamily: "var(--font-display, var(--font-sans))",
};

const subtitleStyle: CSSProperties = {
  margin: "4px 0 0",
  color: "var(--muted)",
  fontSize: "14px",
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

const DISABLED_REASONS = {
  resetMfa: "Reset MFA dialog will be mounted in T-0229",
  requireReregistration: "Require re-registration dialog will be mounted in T-0229",
  sendPush: "Send push dialog will be mounted in T-0229",
  setDefaultMethod: "Set default method dialog will be mounted in T-0229",
  createTap: "Create TAP dialog will be mounted in T-0229",
  bulkReset: "Bulk require re-registration dialog will be mounted in T-0229",
  bulkPush: "Bulk send push dialog will be mounted in T-0229",
};

export default function MfaReportPage(): ReactElement {
  const [tenantId, setTenantId] = useState("");
  // Follow the tenant chosen in the shell; the box still accepts another id.
  const currentTenant = useCurrentTenantId();
  useEffect(() => {
    if (currentTenant) {
      setTenantId(currentTenant);
      void loadReport(currentTenant);
    }
  }, [currentTenant]);
  const [report, setReport] = useState<MfaReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async (tenant: string): Promise<void> => {
    if (!tenant.trim()) {
      setError("Please provide a tenant ID.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMfaReport(tenant.trim());
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleAction = (_action: MfaRowAction, _row: MfaUserRow): void => {
    // Row actions will delegate to T-0229 dialogs once mounted
  };

  const handleBulkReset = (_rows: readonly MfaUserRow[]): void => {
    // Bulk reset will delegate to T-0229 dialogs once mounted
  };

  const handleBulkPush = (_rows: readonly MfaUserRow[]): void => {
    // Bulk push will delegate to T-0229 dialogs once mounted
  };

  return (
    <div style={pageStyle} data-testid="mfa-report-page">
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>MFA Report</h1>
          <p style={subtitleStyle}>
            Review MFA registration status, authentication methods, and phishing-resistance across tenant users.
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <input
            type="text"
            placeholder="Tenant ID..."
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            style={inputStyle}
            aria-label="Tenant ID"
            data-testid="mfa-tenant-input"
          />
          <button
            type="button"
            style={buttonStyle}
            onClick={() => void loadReport(tenantId)}
            data-testid="mfa-load-button"
          >
            Load
          </button>
        </div>
      </div>

      <MfaKpiStrip kpis={report?.kpis} loading={loading} />

      <MfaReportTable
        rows={report?.rows ?? []}
        loading={loading}
        error={error}
        onAction={handleAction}
        onBulkReset={handleBulkReset}
        onBulkPush={handleBulkPush}
        disabledReasons={DISABLED_REASONS}
      />
    </div>
  );
}
