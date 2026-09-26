"use client";

// User detail tabs (EPIC-011 SPEC.md §3.2, T-0210).
// Tabs: View · Edit · Exchange · OneDrive shortcuts · Compromise remediation
// (BEC) · Conditional Access. The BEC tab embeds the 11-check BecReviewTab
// with per-finding remediate actions. Sections without a dedicated EPIC-011
// backend render their live-read scope note instead of mock data. Strictly
// uses report theme tokens with zero colour literals.

import React, { useState, type CSSProperties, type ReactElement } from "react";
import { BecReviewTab } from "./BecReviewTab";
import type { TenantUser } from "../../lib/usersApi";
import type { BecCheck, BecFinding } from "../../lib/offboardingApi";

export type UserDetailTabId = "view" | "edit" | "exchange" | "onedrive" | "bec" | "ca";

export const USER_DETAIL_TABS: ReadonlyArray<{ id: UserDetailTabId; label: string }> = [
  { id: "view", label: "View" },
  { id: "edit", label: "Edit" },
  { id: "exchange", label: "Exchange" },
  { id: "onedrive", label: "OneDrive shortcuts" },
  { id: "bec", label: "Compromise remediation (BEC)" },
  { id: "ca", label: "Conditional Access" },
];

export interface UserDetailTabsProps {
  readonly user: TenantUser;
  readonly activeTab?: UserDetailTabId;
  readonly onTabChange?: (tab: UserDetailTabId) => void;
  readonly becChecks?: readonly BecCheck[];
  readonly becFindings?: readonly BecFinding[];
  readonly becLoading?: boolean;
  readonly becError?: string | null;
  readonly onRunBecCheck?: () => void;
  readonly onRemediateBecFinding?: (finding: BecFinding, check: BecCheck | undefined) => void;
  readonly becRemediatingId?: string | null;
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
};

const tabBarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "4px",
  borderBottom: "1px solid var(--border)",
};

const panelStyle: CSSProperties = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  padding: "16px",
  fontSize: "14px",
  display: "flex",
  flexDirection: "column",
  gap: "8px",
};

function tabStyle(active: boolean): CSSProperties {
  return {
    padding: "10px 16px",
    background: "transparent",
    border: "none",
    borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
    color: active ? "var(--accent-text)" : "var(--text-soft)",
    fontSize: "14px",
    fontWeight: active ? 600 : 400,
    cursor: "pointer",
  };
}

function fieldRow(label: string, value: string): ReactElement {
  return (
    <div key={label} style={{ display: "flex", gap: "12px" }}>
      <dt style={{ width: "160px", color: "var(--text-soft)" }}>{label}</dt>
      <dd style={{ margin: 0 }}>{value}</dd>
    </div>
  );
}

export function UserDetailTabs({
  user,
  activeTab,
  onTabChange,
  becChecks = [],
  becFindings = [],
  becLoading = false,
  becError = null,
  onRunBecCheck,
  onRemediateBecFinding,
  becRemediatingId = null,
}: UserDetailTabsProps): ReactElement {
  const [internalTab, setInternalTab] = useState<UserDetailTabId>("view");
  const tab = activeTab ?? internalTab;

  function select(next: UserDetailTabId): void {
    setInternalTab(next);
    onTabChange?.(next);
  }

  return (
    <div style={containerStyle} data-testid="user-detail-tabs">
      <nav style={tabBarStyle} aria-label="User detail tabs">
        {USER_DETAIL_TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            style={tabStyle(tab === entry.id)}
            onClick={() => select(entry.id)}
            data-testid={`user-tab-${entry.id}`}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {tab === "view" && (
        <dl style={panelStyle} data-testid="user-tab-panel-view">
          {fieldRow("Display name", user.displayName ?? "—")}
          {fieldRow("UPN", user.userPrincipalName)}
          {fieldRow("Type", user.userType)}
          {fieldRow("Status", user.status)}
          {fieldRow("Department", user.department ?? "—")}
          {fieldRow("Licenses", user.licenses.join(", ") || "—")}
          {fieldRow("MFA state", user.mfaState)}
          {fieldRow("Last sign-in", user.lastSignInDateTime ?? "Never")}
        </dl>
      )}

      {tab === "edit" && (
        <div style={panelStyle} data-testid="user-tab-panel-edit">
          <p style={{ margin: 0, color: "var(--text-soft)" }}>
            Single-user edit arrives with a later ticket; bulk property edits run through the patch
            wizard on the Users page.
          </p>
        </div>
      )}

      {tab === "exchange" && (
        <div style={panelStyle} data-testid="user-tab-panel-exchange">
          <p style={{ margin: 0, color: "var(--text-soft)" }}>
            Mailbox settings, quotas, permissions, and rules for {user.userPrincipalName} are read
            live from Exchange Online by the mailbox administration work.
          </p>
        </div>
      )}

      {tab === "onedrive" && (
        <div style={panelStyle} data-testid="user-tab-panel-onedrive">
          <p style={{ margin: 0, color: "var(--text-soft)" }}>
            OneDrive usage and sharing shortcuts for {user.userPrincipalName} are read live from
            SharePoint by the OneDrive overview work.
          </p>
        </div>
      )}

      {tab === "bec" && (
        <div data-testid="user-tab-panel-bec">
          <BecReviewTab
            checks={becChecks}
            findings={becFindings}
            loading={becLoading}
            error={becError}
            onRunCheck={onRunBecCheck}
            onRemediate={onRemediateBecFinding}
            remediatingId={becRemediatingId}
          />
        </div>
      )}

      {tab === "ca" && (
        <div style={panelStyle} data-testid="user-tab-panel-ca">
          <p style={{ margin: 0, color: "var(--text-soft)" }}>
            Conditional Access evaluation for {user.userPrincipalName} lives with the Conditional
            Access policy work (EPIC-015).
          </p>
        </div>
      )}
    </div>
  );
}
