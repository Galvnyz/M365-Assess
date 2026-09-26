"use client";

// Authentication Methods & Registration Campaign page (EPIC-012 SPEC.md §3.3, §3.4; T-0230).
// Page title "Authentication Methods", hosts AuthMethodsPolicyEditor with plan preview/diff
// and RegistrationCampaignPanel for campaign configuration and eligible user tracking.
// Strictly uses report theme tokens with zero colour literals.

import React, { useState, type CSSProperties, type ReactElement } from "react";
import { AuthMethodsPolicyEditor } from "../../components/auth-methods/AuthMethodsPolicyEditor";
import { RegistrationCampaignPanel } from "../../components/auth-methods/RegistrationCampaignPanel";

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

export default function AuthMethodsPage(): ReactElement {
  const [tenantId, setTenantId] = useState("");
  const [activeTenant, setActiveTenant] = useState("");

  const handleLoad = (): void => {
    setActiveTenant(tenantId.trim());
  };

  return (
    <div style={pageStyle} data-testid="auth-methods-page">
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>Authentication Methods</h1>
          <p style={subtitleStyle}>
            Configure directory-wide authentication methods policy presets and Microsoft Authenticator registration campaign.
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
            data-testid="auth-methods-tenant-input"
          />
          <button
            type="button"
            style={{
              padding: "8px 14px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              color: "var(--text)",
              fontSize: "14px",
              fontWeight: 500,
              cursor: "pointer",
            }}
            onClick={handleLoad}
            data-testid="auth-methods-load-button"
          >
            Load
          </button>
        </div>
      </div>

      <AuthMethodsPolicyEditor tenantId={activeTenant || tenantId} />

      <RegistrationCampaignPanel tenantId={activeTenant || tenantId} />
    </div>
  );
}
