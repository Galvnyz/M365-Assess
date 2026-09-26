"use client";

// P2GateNotice component (EPIC-013 SPEC §3.1, §9, §11.4; T-0248).
// Explains the Microsoft Entra ID P2 requirement instead of failing when PIM is unavailable
// (adopting CIPP's license-missing UX pattern).
// Strictly uses report theme tokens with zero colour literals.

import React, { type CSSProperties, type ReactElement } from "react";
import type { PimLicenseGateResult } from "../../lib/rolesApi";

export interface P2GateNoticeProps {
  readonly gate?: PimLicenseGateResult;
}

const containerStyle: CSSProperties = {
  padding: "24px",
  borderRadius: "8px",
  background: "var(--warning-soft, var(--surface))",
  border: "1px solid var(--border)",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
};

const badgeStyle: CSSProperties = {
  display: "inline-block",
  padding: "4px 8px",
  borderRadius: "4px",
  fontSize: "12px",
  fontWeight: 600,
  background: "var(--surface)",
  border: "1px solid var(--border)",
  color: "var(--warning, var(--text))",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "16px",
  fontWeight: 600,
  color: "var(--text)",
};

const messageStyle: CSSProperties = {
  margin: 0,
  fontSize: "14px",
  lineHeight: "1.5",
  color: "var(--muted)",
};

const linkStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--accent, var(--primary))",
  textDecoration: "underline",
  width: "fit-content",
};

export function P2GateNotice({ gate }: P2GateNoticeProps): ReactElement {
  const message =
    gate?.message ??
    "Privileged Identity Management (PIM) requires Microsoft Entra ID P2 (or Microsoft 365 E5) licenses. Without Entra ID P2, eligible role assignments, just-in-time activations, and role settings templates cannot be configured for this tenant.";

  const docUrl =
    gate?.documentationUrl ??
    "https://learn.microsoft.com/entra/id-governance/pim-overview";

  return (
    <div data-testid="p2-gate-notice" style={containerStyle}>
      <div style={headerStyle}>
        <span style={badgeStyle}>License Requirement</span>
        <h3 style={titleStyle}>Microsoft Entra ID P2 Required</h3>
      </div>
      <p style={messageStyle}>{message}</p>
      <a
        href={docUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={linkStyle}
      >
        Learn more about Microsoft Entra ID P2 & PIM licensing
      </a>
    </div>
  );
}
