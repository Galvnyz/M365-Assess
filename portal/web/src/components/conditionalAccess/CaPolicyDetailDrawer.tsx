"use client";

// CaPolicyDetailDrawer — Full inspection drawer for a Conditional Access policy (EPIC-015 SPEC.md §3.1; T-0283).
import React, { type CSSProperties } from "react";
import type { CaPolicyItem } from "../../lib/caApi";

export interface CaPolicyDetailDrawerProps {
  readonly policy: CaPolicyItem | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onAction?: (action: string, policy: CaPolicyItem) => void;
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: "rgba(0, 0, 0, 0.45)",
  zIndex: 1000,
  display: "flex",
  justifyContent: "flex-end",
};

const drawerStyle: CSSProperties = {
  width: "100%",
  maxWidth: "520px",
  height: "100%",
  backgroundColor: "var(--bg, #ffffff)",
  boxShadow: "-4px 0 20px rgba(0, 0, 0, 0.15)",
  display: "flex",
  flexDirection: "column",
  zIndex: 1001,
  overflowY: "auto",
};

const headerStyle: CSSProperties = {
  padding: "20px 24px",
  borderBottom: "1px solid var(--border, #e5e7eb)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  backgroundColor: "var(--bg-elev, #f9fafb)",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "18px",
  fontWeight: 600,
  color: "var(--text, #111827)",
};

const closeButtonStyle: CSSProperties = {
  background: "none",
  border: "none",
  fontSize: "20px",
  cursor: "pointer",
  color: "var(--text-muted, #6b7280)",
  padding: "4px 8px",
};

const contentStyle: CSSProperties = {
  padding: "24px",
  display: "flex",
  flexDirection: "column",
  gap: "20px",
  flex: 1,
};

const sectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  padding: "16px",
  borderRadius: "8px",
  border: "1px solid var(--border, #e5e7eb)",
  backgroundColor: "var(--bg-elev, #f9fafb)",
};

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "13px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--text-muted, #6b7280)",
};

const badgeBaseStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: "9999px",
  fontSize: "12px",
  fontWeight: 600,
};

function getStateBadge(state: string) {
  const s = state.toLowerCase();
  if (s === "enabled" || s === "on") {
    return (
      <span
        style={{
          ...badgeBaseStyle,
          backgroundColor: "#dcfce7",
          color: "#166534",
        }}
      >
        Enabled
      </span>
    );
  }
  if (s === "enabledforreportingbutnotenforced" || s === "report-only" || s === "reportonly") {
    return (
      <span
        style={{
          ...badgeBaseStyle,
          backgroundColor: "#fef3c7",
          color: "#92400e",
        }}
      >
        Report-only
      </span>
    );
  }
  return (
    <span
      style={{
        ...badgeBaseStyle,
        backgroundColor: "#f3f4f6",
        color: "#4b5563",
      }}
    >
      Disabled
    </span>
  );
}

const footerStyle: CSSProperties = {
  padding: "16px 24px",
  borderTop: "1px solid var(--border, #e5e7eb)",
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
  backgroundColor: "var(--bg-elev, #f9fafb)",
};

const buttonStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: "6px",
  fontSize: "13px",
  fontWeight: 500,
  cursor: "pointer",
  border: "1px solid var(--border, #d1d5db)",
  backgroundColor: "var(--bg, #ffffff)",
  color: "var(--text, #111827)",
};

export const CaPolicyDetailDrawer: React.FC<CaPolicyDetailDrawerProps> = ({
  policy,
  isOpen,
  onClose,
  onAction,
}) => {
  if (!isOpen || !policy) {
    return null;
  }

  const users = policy.usersTargeted || {};
  const apps = policy.apps || {};
  const grant = policy.grantControls || {};
  const conds = policy.conditions || {};

  return (
    <div style={overlayStyle} onClick={onClose} data-testid="ca-drawer-overlay">
      <div
        style={drawerStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ca-drawer-title"
      >
        <div style={headerStyle}>
          <div>
            <h2 id="ca-drawer-title" style={titleStyle}>
              {policy.displayName || policy.name}
            </h2>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px" }}>
              {getStateBadge(policy.state)}
              <span style={{ fontSize: "12px", color: "var(--text-muted, #6b7280)" }}>
                ID: {policy.id}
              </span>
            </div>
          </div>
          <button style={closeButtonStyle} onClick={onClose} aria-label="Close drawer">
            ×
          </button>
        </div>

        <div style={contentStyle}>
          {/* Metadata */}
          <div style={sectionStyle}>
            <h3 style={sectionTitleStyle}>Modification Details</h3>
            <div style={{ fontSize: "13px", color: "var(--text, #111827)" }}>
              <div><strong>Modified:</strong> {policy.modifiedDateTime ? new Date(policy.modifiedDateTime).toLocaleString() : "Unknown"}</div>
              <div><strong>Modified By:</strong> {policy.modifiedBy || "—"}</div>
              <div><strong>Created:</strong> {policy.createdDateTime ? new Date(policy.createdDateTime).toLocaleString() : "Unknown"}</div>
            </div>
          </div>

          {/* Assignments / Users */}
          <div style={sectionStyle}>
            <h3 style={sectionTitleStyle}>Users & Groups Targeted</h3>
            <div style={{ fontSize: "13px" }}>
              <div><strong>Summary:</strong> {users.summary || "None"}</div>
              <div style={{ marginTop: "6px" }}>
                <strong>Include:</strong>
                <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                  {users.includeUsers?.length ? <li>Users: {users.includeUsers.join(", ")}</li> : null}
                  {users.includeGroups?.length ? <li>Groups: {users.includeGroups.join(", ")}</li> : null}
                  {users.includeRoles?.length ? <li>Roles: {users.includeRoles.join(", ")}</li> : null}
                </ul>
              </div>
              {(users.excludeUsers?.length || users.excludeGroups?.length || users.excludeRoles?.length) ? (
                <div style={{ marginTop: "6px" }}>
                  <strong>Exclude:</strong>
                  <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                    {users.excludeUsers?.length ? <li>Users: {users.excludeUsers.join(", ")}</li> : null}
                    {users.excludeGroups?.length ? <li>Groups: {users.excludeGroups.join(", ")}</li> : null}
                    {users.excludeRoles?.length ? <li>Roles: {users.excludeRoles.join(", ")}</li> : null}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>

          {/* Cloud Apps */}
          <div style={sectionStyle}>
            <h3 style={sectionTitleStyle}>Target Resources (Cloud Apps)</h3>
            <div style={{ fontSize: "13px" }}>
              <div><strong>Summary:</strong> {apps.summary || "None"}</div>
              {apps.includeApplications?.length ? (
                <div style={{ marginTop: "4px" }}>
                  <strong>Include:</strong> {apps.includeApplications.join(", ")}
                </div>
              ) : null}
              {apps.excludeApplications?.length ? (
                <div style={{ marginTop: "4px" }}>
                  <strong>Exclude:</strong> {apps.excludeApplications.join(", ")}
                </div>
              ) : null}
            </div>
          </div>

          {/* Conditions */}
          <div style={sectionStyle}>
            <h3 style={sectionTitleStyle}>Conditions</h3>
            <div style={{ fontSize: "13px" }}>
              <div><strong>Summary:</strong> {conds.summary || "Any"}</div>
              {conds.clientAppTypes?.length ? (
                <div style={{ marginTop: "4px" }}>
                  <strong>Client apps:</strong> {conds.clientAppTypes.join(", ")}
                </div>
              ) : null}
              {conds.signInRiskLevels?.length ? (
                <div style={{ marginTop: "4px" }}>
                  <strong>Sign-in risk:</strong> {conds.signInRiskLevels.join(", ")}
                </div>
              ) : null}
              {conds.userRiskLevels?.length ? (
                <div style={{ marginTop: "4px" }}>
                  <strong>User risk:</strong> {conds.userRiskLevels.join(", ")}
                </div>
              ) : null}
            </div>
          </div>

          {/* Access Controls */}
          <div style={sectionStyle}>
            <h3 style={sectionTitleStyle}>Access Controls (Grant)</h3>
            <div style={{ fontSize: "13px" }}>
              <div><strong>Summary:</strong> {grant.summary || "None"}</div>
              <div><strong>Operator:</strong> {grant.operator || "OR"}</div>
              {grant.builtInControls?.length ? (
                <div style={{ marginTop: "4px" }}>
                  <strong>Controls:</strong> {grant.builtInControls.join(", ")}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div style={footerStyle}>
          <button style={buttonStyle} onClick={() => onAction?.("edit", policy)}>
            Edit
          </button>
          <button style={buttonStyle} onClick={() => onAction?.("clone", policy)}>
            Clone
          </button>
          <button
            style={buttonStyle}
            onClick={() =>
              onAction?.(
                policy.state === "enabled" ? "disable" : "enable",
                policy,
              )
            }
          >
            {policy.state === "enabled" ? "Disable" : "Enable"}
          </button>
          <button style={buttonStyle} onClick={() => onAction?.("setReportOnly", policy)}>
            Set report-only
          </button>
          <button
            style={{ ...buttonStyle, color: "#dc2626", borderColor: "#fca5a5" }}
            onClick={() => onAction?.("delete", policy)}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};
