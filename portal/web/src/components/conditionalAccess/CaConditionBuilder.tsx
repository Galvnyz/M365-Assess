"use client";

// CaConditionBuilder — Builder for Conditional Access conditions (EPIC-015 SPEC.md §3.3; T-0284).
// Manages users/groups/roles, applications, client app types, platforms, locations, and risk.
import React, { type CSSProperties } from "react";
import type { CaPolicyConditions, CaPolicyUsersTargeted, CaPolicyAppsTargeted } from "../../lib/caApi";

export interface CaConditionBuilderProps {
  readonly users: CaPolicyUsersTargeted;
  readonly apps: CaPolicyAppsTargeted;
  readonly conditions: CaPolicyConditions;
  readonly onChangeUsers: (users: CaPolicyUsersTargeted) => void;
  readonly onChangeApps: (apps: CaPolicyAppsTargeted) => void;
  readonly onChangeConditions: (conditions: CaPolicyConditions) => void;
  readonly onQuickAddBreakGlass?: () => void;
}

const cardStyle: CSSProperties = {
  padding: "16px",
  borderRadius: "8px",
  border: "1px solid var(--border, #e5e7eb)",
  backgroundColor: "var(--bg, #ffffff)",
  display: "flex",
  flexDirection: "column",
  gap: "14px",
};

const labelStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 600,
  color: "var(--text, #111827)",
  display: "block",
};

const inputStyle: CSSProperties = {
  padding: "8px 12px",
  background: "var(--bg, #ffffff)",
  border: "1px solid var(--border, #d1d5db)",
  borderRadius: "6px",
  color: "var(--text, #111827)",
  fontSize: "13px",
  width: "100%",
};

const chipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "2px 8px",
  borderRadius: "4px",
  backgroundColor: "#f3f4f6",
  color: "#374151",
  fontSize: "12px",
};

const removeChipBtnStyle: CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "#9ca3af",
  padding: 0,
  fontSize: "14px",
  lineHeight: 1,
};

export const CaConditionBuilder: React.FC<CaConditionBuilderProps> = ({
  users,
  apps,
  conditions,
  onChangeUsers,
  onChangeApps,
  onChangeConditions,
  onQuickAddBreakGlass,
}) => {
  const isAllUsers = (users.includeUsers || []).includes("All");

  const toggleAllUsers = (checked: boolean) => {
    if (checked) {
      onChangeUsers({
        ...users,
        includeUsers: ["All"],
        summary: "All users" + (users.excludeUsers?.length ? ` (excludes ${users.excludeUsers.length})` : ""),
      });
    } else {
      onChangeUsers({
        ...users,
        includeUsers: [],
        summary: "None",
      });
    }
  };

  const addExcludeUser = (user: string) => {
    if (!user.trim()) return;
    const current = users.excludeUsers || [];
    if (!current.includes(user.trim())) {
      const next = [...current, user.trim()];
      onChangeUsers({
        ...users,
        excludeUsers: next,
        summary: (isAllUsers ? "All users" : "Selected users") + ` (excludes ${next.length})`,
      });
    }
  };

  const removeExcludeUser = (user: string) => {
    const next = (users.excludeUsers || []).filter((u) => u !== user);
    onChangeUsers({
      ...users,
      excludeUsers: next,
      summary: (isAllUsers ? "All users" : "Selected users") + (next.length ? ` (excludes ${next.length})` : ""),
    });
  };

  const isAllApps = (apps.includeApplications || []).includes("All");
  const toggleAllApps = (checked: boolean) => {
    if (checked) {
      onChangeApps({
        ...apps,
        includeApplications: ["All"],
        summary: "All cloud apps",
      });
    } else {
      onChangeApps({
        ...apps,
        includeApplications: [],
        summary: "None",
      });
    }
  };

  const clientApps = conditions.clientAppTypes || [];
  const toggleClientApp = (type: string, checked: boolean) => {
    const next = checked ? [...clientApps, type] : clientApps.filter((t) => t !== type);
    onChangeConditions({
      ...conditions,
      clientAppTypes: next,
      summary: next.length ? "Client apps: " + next.join(", ") : "Any",
    });
  };

  const signInRisks = conditions.signInRiskLevels || [];
  const toggleSignInRisk = (level: string, checked: boolean) => {
    const next = checked ? [...signInRisks, level] : signInRisks.filter((l) => l !== level);
    onChangeConditions({
      ...conditions,
      signInRiskLevels: next,
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }} data-testid="ca-condition-builder">
      {/* Users and groups */}
      <div style={cardStyle}>
        <div>
          <span style={labelStyle}>Users and Groups</span>
          <span style={{ fontSize: "12px", color: "var(--text-muted, #6b7280)" }}>
            Select which users or groups this policy includes or excludes.
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            type="checkbox"
            id="ca-include-all-users"
            checked={isAllUsers}
            onChange={(e) => toggleAllUsers(e.target.checked)}
            data-testid="ca-include-all-users"
          />
          <label htmlFor="ca-include-all-users" style={{ fontSize: "13px", cursor: "pointer" }}>
            Target <strong>All users</strong>
          </label>
        </div>

        {/* Exclusions & Break-glass picker */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "4px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text, #111827)" }}>
              Excluded Users / Break-Glass Accounts:
            </span>
            {onQuickAddBreakGlass ? (
              <button
                type="button"
                style={{
                  background: "none",
                  border: "1px solid #3b82f6",
                  color: "#2563eb",
                  borderRadius: "4px",
                  padding: "2px 8px",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
                onClick={onQuickAddBreakGlass}
                data-testid="quick-add-breakglass-btn"
              >
                + Add Break-Glass Exclusion
              </button>
            ) : null}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }} data-testid="exclude-users-chips">
            {(users.excludeUsers || []).map((u) => (
              <span key={u} style={chipStyle}>
                {u}
                <button
                  type="button"
                  style={removeChipBtnStyle}
                  onClick={() => removeExcludeUser(u)}
                  aria-label={`Remove exclusion ${u}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>

          <input
            style={inputStyle}
            type="text"
            placeholder="Type UPN or user ID to exclude and press Enter..."
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addExcludeUser((e.target as HTMLInputElement).value);
                (e.target as HTMLInputElement).value = "";
              }
            }}
            data-testid="ca-add-exclude-user-input"
          />
        </div>
      </div>

      {/* Target resources / Cloud apps */}
      <div style={cardStyle}>
        <div>
          <span style={labelStyle}>Target Resources (Cloud Apps)</span>
          <span style={{ fontSize: "12px", color: "var(--text-muted, #6b7280)" }}>
            Select which cloud applications this policy applies to.
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            type="checkbox"
            id="ca-include-all-apps"
            checked={isAllApps}
            onChange={(e) => toggleAllApps(e.target.checked)}
            data-testid="ca-include-all-apps"
          />
          <label htmlFor="ca-include-all-apps" style={{ fontSize: "13px", cursor: "pointer" }}>
            Target <strong>All cloud apps</strong>
          </label>
        </div>
      </div>

      {/* Client App Types */}
      <div style={cardStyle}>
        <div>
          <span style={labelStyle}>Client Apps</span>
          <span style={{ fontSize: "12px", color: "var(--text-muted, #6b7280)" }}>
            Select which client application types trigger this policy.
          </span>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
            <input
              type="checkbox"
              checked={clientApps.includes("browser")}
              onChange={(e) => toggleClientApp("browser", e.target.checked)}
              data-testid="ca-client-browser"
            />
            Browser
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
            <input
              type="checkbox"
              checked={clientApps.includes("mobileAppsAndDesktopClients")}
              onChange={(e) => toggleClientApp("mobileAppsAndDesktopClients", e.target.checked)}
              data-testid="ca-client-mobile"
            />
            Mobile apps & desktop clients
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
            <input
              type="checkbox"
              checked={clientApps.includes("exchangeActiveSync")}
              onChange={(e) => toggleClientApp("exchangeActiveSync", e.target.checked)}
              data-testid="ca-client-eas"
            />
            Exchange ActiveSync
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
            <input
              type="checkbox"
              checked={clientApps.includes("other")}
              onChange={(e) => toggleClientApp("other", e.target.checked)}
              data-testid="ca-client-other"
            />
            Other legacy clients
          </label>
        </div>
      </div>

      {/* Risk levels */}
      <div style={cardStyle}>
        <div>
          <span style={labelStyle}>Sign-in Risk</span>
          <span style={{ fontSize: "12px", color: "var(--text-muted, #6b7280)" }}>
            Filter by user risk or sign-in risk levels.
          </span>
        </div>

        <div style={{ display: "flex", gap: "16px" }}>
          {["high", "medium", "low"].map((lvl) => (
            <label key={lvl} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", textTransform: "capitalize" }}>
              <input
                type="checkbox"
                checked={signInRisks.includes(lvl)}
                onChange={(e) => toggleSignInRisk(lvl, e.target.checked)}
                data-testid={`ca-risk-${lvl}`}
              />
              {lvl} risk
            </label>
          ))}
        </div>
      </div>
    </div>
  );
};
