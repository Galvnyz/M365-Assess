"use client";

// GroupDetailDrawer — off-canvas drawer showing members, owners, and settings (EPIC-014 SPEC.md §3.1; T-0263).
import React, { type CSSProperties } from "react";
import type { GroupItem } from "../../lib/groupsApi";

export interface GroupDetailDrawerProps {
  readonly group: GroupItem | null;
  readonly open: boolean;
  readonly onClose: () => void;
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: "rgba(0, 0, 0, 0.5)",
  zIndex: 1000,
  display: "flex",
  justifyContent: "flex-end",
};

const drawerStyle: CSSProperties = {
  width: "480px",
  maxWidth: "90vw",
  height: "100%",
  background: "var(--bg-elev, #ffffff)",
  color: "var(--text, #111827)",
  borderLeft: "1px solid var(--border, #e5e7eb)",
  padding: "24px",
  display: "flex",
  flexDirection: "column",
  gap: "20px",
  overflowY: "auto",
  boxShadow: "-4px 0 16px rgba(0, 0, 0, 0.1)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  borderBottom: "1px solid var(--border, #e5e7eb)",
  paddingBottom: "12px",
};

const sectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
};

const labelStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 600,
  color: "var(--text-muted, #6b7280)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const valueStyle: CSSProperties = {
  fontSize: "14px",
  color: "var(--text, #111827)",
};

export function GroupDetailDrawer({
  group,
  open,
  onClose,
}: GroupDetailDrawerProps): React.ReactElement | null {
  if (!open || !group) return null;

  return (
    <div style={overlayStyle} onClick={onClose} data-testid="group-detail-drawer-overlay">
      <div
        style={drawerStyle}
        onClick={(e) => e.stopPropagation()}
        data-testid="group-detail-drawer"
        role="dialog"
        aria-label="Group Details"
      >
        <div style={headerStyle}>
          <div>
            <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>{group.name}</h2>
            <span style={{ fontSize: "13px", color: "var(--text-muted, #6b7280)" }}>
              {group.type}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "20px",
              cursor: "pointer",
              color: "var(--text, #111827)",
            }}
            data-testid="drawer-close-btn"
          >
            ×
          </button>
        </div>

        {/* Group Settings */}
        <div style={sectionStyle} data-testid="drawer-settings-section">
          <div style={labelStyle}>Settings</div>
          <div style={valueStyle}>
            <strong>ID:</strong> <code style={{ fontFamily: "monospace" }}>{group.id}</code>
          </div>
          {group.mail && (
            <div style={valueStyle}>
              <strong>Email:</strong> {group.mail}
            </div>
          )}
          {group.description && (
            <div style={valueStyle}>
              <strong>Description:</strong> {group.description}
            </div>
          )}
          <div style={valueStyle}>
            <strong>Hidden from GAL:</strong> {group.hiddenFromAddressListsEnabled ? "Yes" : "No"}
          </div>
          <div style={valueStyle}>
            <strong>Delivery Management:</strong> {group.deliveryManagementEnabled ? "Enabled" : "Disabled"}
          </div>
          {group.isDynamic && (
            <div style={valueStyle}>
              <strong>Dynamic Rule:</strong>{" "}
              <code style={{ fontFamily: "monospace", display: "block", marginTop: "4px", background: "var(--surface)", padding: "4px 8px", borderRadius: "4px" }}>
                {group.dynamicRule || "(no rule specified)"}
              </code>
            </div>
          )}
        </div>

        {/* Owners */}
        <div style={sectionStyle} data-testid="drawer-owners-section">
          <div style={labelStyle}>Owners ({group.ownerCount})</div>
          {group.owners && group.owners.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "14px" }}>
              {group.owners.map((owner) => (
                <li key={owner.id}>
                  {owner.displayName} {owner.userPrincipalName ? `(${owner.userPrincipalName})` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ fontSize: "13px", color: "var(--text-muted, #6b7280)" }}>
              {group.ownerCount > 0 ? `${group.ownerCount} owner(s) assigned` : "No owners"}
            </div>
          )}
        </div>

        {/* Members */}
        <div style={sectionStyle} data-testid="drawer-members-section">
          <div style={labelStyle}>Members ({group.membershipCount})</div>
          {group.members && group.members.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "14px" }}>
              {group.members.map((member) => (
                <li key={member.id}>
                  {member.displayName} {member.userPrincipalName ? `(${member.userPrincipalName})` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ fontSize: "13px", color: "var(--text-muted, #6b7280)" }}>
              {group.membershipCount > 0 ? `${group.membershipCount} member(s)` : "No members"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
