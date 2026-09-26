"use client";

// IntunePolicyDetailDrawer — Off-canvas detail panel for an Intune policy (EPIC-016 SPEC.md §3.1; T-0303).
// Shows settings and assignments. Provides Clone to template action.
import React, { type CSSProperties } from "react";
import type { IntunePolicyItem } from "../../lib/intuneApi";
import type { IntunePolicyRowAction } from "./IntunePolicyTable";

export interface IntunePolicyDetailDrawerProps {
  readonly policy: IntunePolicyItem;
  readonly tenantId?: string;
  readonly onClose: () => void;
  readonly onAction?: (action: IntunePolicyRowAction) => void;
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  zIndex: 200,
  display: "flex",
  justifyContent: "flex-end",
};

const drawerStyle: CSSProperties = {
  width: "420px",
  maxWidth: "90vw",
  height: "100%",
  background: "var(--bg, #ffffff)",
  boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const drawerHeaderStyle: CSSProperties = {
  padding: "20px 24px 16px",
  borderBottom: "1px solid var(--border, #e5e7eb)",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
};

const drawerBodyStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "20px 24px",
  display: "flex",
  flexDirection: "column",
  gap: "20px",
};

const sectionTitleStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  color: "var(--text-muted, #6b7280)",
  marginBottom: "8px",
};

const metaGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "12px",
};

const metaItemStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
};

const metaLabelStyle: CSSProperties = {
  fontSize: "11px",
  color: "var(--text-muted, #6b7280)",
  fontWeight: 500,
};

const metaValueStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 500,
  color: "var(--text, #111827)",
};

const closeBtnStyle: CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: "20px",
  lineHeight: 1,
  color: "var(--text-muted, #6b7280)",
  padding: "0 4px",
};

const actionBtnStyle: CSSProperties = {
  padding: "6px 12px",
  fontSize: "13px",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "6px",
  background: "var(--bg, #ffffff)",
  cursor: "pointer",
  color: "var(--text, #111827)",
};

const cloneBtnStyle: CSSProperties = {
  ...actionBtnStyle,
  background: "var(--accent, #2563eb)",
  color: "#ffffff",
  border: "none",
};

const assignmentBadgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "4px",
  padding: "3px 10px",
  borderRadius: "9999px",
  fontSize: "12px",
  background: "var(--accent-light, #dbeafe)",
  color: "var(--accent, #2563eb)",
  fontWeight: 500,
};

function formatDate(dt: string | null | undefined): string {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dt;
  }
}

export function IntunePolicyDetailDrawer({
  policy,
  tenantId,
  onClose,
  onAction,
}: IntunePolicyDetailDrawerProps) {
  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Policy detail">
      <div style={drawerStyle}>
        {/* Header */}
        <div style={drawerHeaderStyle}>
          <div>
            <h3
              style={{ margin: 0, fontSize: "16px", fontWeight: 700, marginBottom: "4px" }}
            >
              {policy.displayName || policy.name}
            </h3>
            <span style={{ fontSize: "12px", color: "var(--text-muted, #6b7280)" }}>
              {policy.policyType} · {policy.platform}
            </span>
          </div>
          <button style={closeBtnStyle} onClick={onClose} aria-label="Close drawer">
            ×
          </button>
        </div>

        {/* Body */}
        <div style={drawerBodyStyle}>
          {/* Meta */}
          <div>
            <div style={sectionTitleStyle}>Details</div>
            <div style={metaGridStyle}>
              <div style={metaItemStyle}>
                <span style={metaLabelStyle}>Platform</span>
                <span style={metaValueStyle}>{policy.platform}</span>
              </div>
              <div style={metaItemStyle}>
                <span style={metaLabelStyle}>Type</span>
                <span style={metaValueStyle}>{policy.policyType}</span>
              </div>
              <div style={metaItemStyle}>
                <span style={metaLabelStyle}>Last modified</span>
                <span style={metaValueStyle}>{formatDate(policy.lastModifiedDateTime)}</span>
              </div>
              <div style={metaItemStyle}>
                <span style={metaLabelStyle}>Modified by</span>
                <span style={metaValueStyle}>{policy.modifiedBy ?? "—"}</span>
              </div>
            </div>
          </div>

          {/* Assignments */}
          <div>
            <div style={sectionTitleStyle}>
              Assignments ({policy.assignedToCount})
            </div>
            {policy.assignments.length === 0 ? (
              <p style={{ margin: 0, color: "var(--text-muted, #6b7280)", fontSize: "13px" }}>
                No assignments.
              </p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {policy.assignments.map((a) => (
                  <span key={a.id} style={assignmentBadgeStyle}>
                    {a.target}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Settings summary */}
          {policy.settingsSummary && Object.keys(policy.settingsSummary).length > 0 && (
            <div>
              <div style={sectionTitleStyle}>Settings</div>
              <pre
                style={{
                  fontSize: "12px",
                  background: "var(--bg-elev, #f9fafb)",
                  border: "1px solid var(--border, #e5e7eb)",
                  borderRadius: "6px",
                  padding: "12px",
                  overflowX: "auto",
                  margin: 0,
                }}
              >
                {JSON.stringify(policy.settingsSummary, null, 2)}
              </pre>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "4px" }}>
            <button
              style={cloneBtnStyle}
              onClick={() => onAction?.("cloneToTemplate")}
              aria-label="Clone to template"
            >
              Clone to template
            </button>
            <button
              style={actionBtnStyle}
              onClick={() => onAction?.("edit")}
              aria-label="Edit policy"
            >
              Edit
            </button>
            <button
              style={actionBtnStyle}
              onClick={() => onAction?.("assign")}
              aria-label="Assign policy"
            >
              Assign
            </button>
            <button
              style={actionBtnStyle}
              onClick={() => onAction?.("compare")}
              aria-label="Compare policy"
            >
              Compare
            </button>
            <button
              style={actionBtnStyle}
              onClick={() => onAction?.("export")}
              aria-label="Export policy"
            >
              Export
            </button>
            <button
              style={{ ...actionBtnStyle, color: "var(--danger, #dc2626)" }}
              onClick={() => onAction?.("delete")}
              aria-label="Delete policy"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
