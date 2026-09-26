"use client";

// CaTemplateTable — Conditional Access templates table with row actions (SPEC §3.2; T-0287).
// Supports View, Edit, Clone, Deploy, Delete, Export.
import React, { useState, type CSSProperties } from "react";
import type { CaTemplate, CaDeployDrawerOptions, CaDeployPlan, CaDeployResult } from "../../lib/caApi";
import { CaDeployDrawer } from "./CaDeployDrawer";

export type CaTemplateRowAction = "view" | "edit" | "clone" | "deploy" | "delete" | "export";

export interface CaTemplateTableProps {
  readonly templates?: readonly CaTemplate[];
  readonly tenantId?: string;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onCreateTemplate?: () => void;
  readonly onAction?: (action: CaTemplateRowAction, template: CaTemplate) => void;
  readonly onPreviewPlan?: (options: CaDeployDrawerOptions) => Promise<CaDeployPlan>;
  readonly onExecuteDeploy?: (options: CaDeployDrawerOptions) => Promise<CaDeployResult>;
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  width: "100%",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text, #111827)",
};

const headerBarStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "16px",
  background: "var(--bg-elev, #f9fafb)",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "8px",
};

const primaryButtonStyle: CSSProperties = {
  padding: "8px 16px",
  background: "var(--primary, #2563eb)",
  color: "#ffffff",
  border: "none",
  borderRadius: "6px",
  fontWeight: 600,
  fontSize: "14px",
  cursor: "pointer",
};

const actionBtnStyle: CSSProperties = {
  padding: "4px 8px",
  borderRadius: "4px",
  border: "1px solid var(--border, #d1d5db)",
  background: "var(--bg, #ffffff)",
  fontSize: "12px",
  cursor: "pointer",
};

const tableContainerStyle: CSSProperties = {
  overflowX: "auto",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "8px",
  background: "var(--bg, #ffffff)",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "13px",
  textAlign: "left",
};

const thStyle: CSSProperties = {
  padding: "12px 14px",
  background: "var(--bg-elev, #f9fafb)",
  borderBottom: "1px solid var(--border, #e5e7eb)",
  color: "var(--text-muted, #4b5563)",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const tdStyle: CSSProperties = {
  padding: "12px 14px",
  borderBottom: "1px solid var(--border, #e5e7eb)",
  verticalAlign: "middle",
};

export const CaTemplateTable: React.FC<CaTemplateTableProps> = ({
  templates = [],
  tenantId = "default-tenant",
  loading = false,
  error = null,
  onCreateTemplate,
  onAction,
  onPreviewPlan,
  onExecuteDeploy,
}) => {
  const [selectedForDeploy, setSelectedForDeploy] = useState<CaTemplate | null>(null);
  const [isDeployOpen, setIsDeployOpen] = useState(false);

  const handleAction = (action: CaTemplateRowAction, template: CaTemplate) => {
    if (action === "deploy") {
      setSelectedForDeploy(template);
      setIsDeployOpen(true);
    } else if (action === "export") {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(template, null, 2));
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `${template.name || "template"}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    }
    onAction?.(action, template);
  };

  return (
    <div style={containerStyle} data-testid="ca-template-table-container">
      <div style={headerBarStyle}>
        <div>
          <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 700 }}>CA Templates</h1>
          <span style={{ fontSize: "13px", color: "var(--text-muted, #6b7280)" }}>
            Reusable baseline templates for Conditional Access deployment
          </span>
        </div>
        {onCreateTemplate ? (
          <button style={primaryButtonStyle} onClick={onCreateTemplate} data-testid="create-template-btn">
            Create template
          </button>
        ) : null}
      </div>

      {loading ? (
        <div style={{ padding: "32px", textAlign: "center", color: "#6b7280" }}>Loading CA templates...</div>
      ) : null}

      {error ? (
        <div style={{ padding: "16px", backgroundColor: "#fee2e2", color: "#dc2626", borderRadius: "6px" }}>
          {error}
        </div>
      ) : null}

      {!loading && !error ? (
        <div style={tableContainerStyle}>
          <table style={tableStyle} aria-label="CA Templates Table">
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Category</th>
                <th style={thStyle}>Source</th>
                <th style={thStyle}>Version</th>
                <th style={thStyle}>Updated</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...tdStyle, textAlign: "center", padding: "32px", color: "#6b7280" }}>
                    No CA templates found.
                  </td>
                </tr>
              ) : (
                templates.map((t) => (
                  <tr key={t.id} data-testid={`template-row-${t.id}`}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{t.name}</td>
                    <td style={tdStyle}>{t.category || "General"}</td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: "4px",
                          backgroundColor: "#f3f4f6",
                          fontSize: "12px",
                          fontWeight: 500,
                        }}
                      >
                        {t.source}
                      </span>
                    </td>
                    <td style={tdStyle}>v{t.version || 1}</td>
                    <td style={tdStyle}>{t.updatedAt ? new Date(t.updatedAt).toLocaleDateString() : "—"}</td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                        <button
                          style={{ ...actionBtnStyle, background: "#2563eb", color: "#ffffff", border: "none" }}
                          onClick={() => handleAction("deploy", t)}
                          data-testid={`action-deploy-${t.id}`}
                        >
                          Deploy
                        </button>
                        <button
                          style={actionBtnStyle}
                          onClick={() => handleAction("view", t)}
                          data-testid={`action-view-${t.id}`}
                        >
                          View
                        </button>
                        <button
                          style={actionBtnStyle}
                          onClick={() => handleAction("edit", t)}
                          data-testid={`action-edit-${t.id}`}
                        >
                          Edit
                        </button>
                        <button
                          style={actionBtnStyle}
                          onClick={() => handleAction("clone", t)}
                          data-testid={`action-clone-${t.id}`}
                        >
                          Clone
                        </button>
                        <button
                          style={actionBtnStyle}
                          onClick={() => handleAction("export", t)}
                          data-testid={`action-export-${t.id}`}
                        >
                          Export
                        </button>
                        <button
                          style={{ ...actionBtnStyle, color: "#dc2626" }}
                          onClick={() => handleAction("delete", t)}
                          data-testid={`action-delete-${t.id}`}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      <CaDeployDrawer
        template={selectedForDeploy}
        tenantId={tenantId}
        isOpen={isDeployOpen}
        onClose={() => setIsDeployOpen(false)}
        onPreviewPlan={onPreviewPlan}
        onExecuteDeploy={onExecuteDeploy}
      />
    </div>
  );
};
