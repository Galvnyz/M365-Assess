"use client";

// GroupTemplateTable — Group templates table with CRUD actions and Deploy wizard modal
// (EPIC-014 SPEC.md §3.2; T-0267).
import React, { useState, type CSSProperties } from "react";
import type { GroupTemplate } from "../../lib/groupsApi";
import { DeployWizard } from "./DeployWizard";
import { GroupTemplateForm } from "./GroupTemplateForm";

export interface GroupTemplateTableProps {
  readonly templates: readonly GroupTemplate[];
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onCreate?: (data: Partial<GroupTemplate>) => Promise<void> | void;
  readonly onUpdate?: (id: string, data: Partial<GroupTemplate>) => Promise<void> | void;
  readonly onDelete?: (id: string) => Promise<void> | void;
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  width: "100%",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
};

const headerBarStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "16px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
};

const primaryButtonStyle: CSSProperties = {
  padding: "8px 16px",
  background: "var(--primary, #2563eb)",
  color: "var(--primary-contrast, #ffffff)",
  border: "none",
  borderRadius: "6px",
  fontWeight: 600,
  fontSize: "14px",
  cursor: "pointer",
};

const actionBtnStyle: CSSProperties = {
  padding: "4px 8px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "4px",
  fontSize: "12px",
  cursor: "pointer",
  color: "var(--text)",
};

const tableWrapperStyle: CSSProperties = {
  overflowX: "auto",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  background: "var(--bg-elev)",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "14px",
  textAlign: "left",
};

const thStyle: CSSProperties = {
  padding: "12px 14px",
  borderBottom: "1px solid var(--border)",
  background: "var(--surface)",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const tdStyle: CSSProperties = {
  padding: "12px 14px",
  borderBottom: "1px solid var(--border)",
  verticalAlign: "middle",
};

export function GroupTemplateTable({
  templates = [],
  loading = false,
  error = null,
  onCreate,
  onUpdate,
  onDelete,
}: GroupTemplateTableProps): React.ReactElement {
  const [formOpen, setFormOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<GroupTemplate | null>(null);

  const [deployTemplate, setDeployTemplate] = useState<GroupTemplate | null>(null);
  const [deployWizardOpen, setDeployWizardOpen] = useState(false);

  const handleOpenCreate = () => {
    setEditingTemplate(null);
    setFormOpen(true);
  };

  const handleOpenEdit = (tpl: GroupTemplate) => {
    setEditingTemplate(tpl);
    setFormOpen(true);
  };

  const handleOpenDeploy = (tpl: GroupTemplate) => {
    setDeployTemplate(tpl);
    setDeployWizardOpen(true);
  };

  const handleSave = async (data: Partial<GroupTemplate>) => {
    if (editingTemplate) {
      await onUpdate?.(editingTemplate.id, data);
    } else {
      await onCreate?.(data);
    }
    setFormOpen(false);
    setEditingTemplate(null);
  };

  return (
    <div style={containerStyle} data-testid="group-template-table-container">
      <div style={headerBarStyle}>
        <div style={{ fontWeight: 600, fontSize: "16px" }}>Group Templates ({templates.length})</div>
        <button
          type="button"
          style={primaryButtonStyle}
          onClick={handleOpenCreate}
          data-testid="btn-add-template"
        >
          Add Template
        </button>
      </div>

      {loading && <div data-testid="templates-loading">Loading templates...</div>}
      {error && <div data-testid="templates-error" style={{ color: "var(--danger)" }}>{error}</div>}

      <div style={tableWrapperStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Naming Policy</th>
              <th style={thStyle}>Conflict Rule</th>
              <th style={thStyle}>Owners</th>
              <th style={thStyle}>Members</th>
              <th style={thStyle}>Licensing</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {templates.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: "var(--text-muted)" }}>
                  No templates created yet
                </td>
              </tr>
            ) : (
              templates.map((tpl) => (
                <tr key={tpl.id} data-testid={`template-row-${tpl.id}`}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{tpl.name}</td>
                  <td style={{ ...tdStyle, textTransform: "capitalize" }}>{tpl.groupType}</td>
                  <td style={tdStyle}>
                    <code>
                      {tpl.naming?.prefix || ""}&#123;name&#125;{tpl.naming?.suffix || ""}
                    </code>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                      {tpl.naming?.conflictBehavior === "appendSuffix" ? "Append suffix" : "Block"}
                    </span>
                  </td>
                  <td style={tdStyle}>{tpl.owners?.length ?? 0}</td>
                  <td style={tdStyle}>{tpl.members?.length ?? 0}</td>
                  <td style={tdStyle}>{tpl.licensing?.length ? tpl.licensing.join(", ") : "—"}</td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        type="button"
                        style={{ ...actionBtnStyle, background: "rgba(37, 99, 235, 0.1)", color: "#2563eb", fontWeight: 600 }}
                        onClick={() => handleOpenDeploy(tpl)}
                        data-testid={`action-deploy-${tpl.id}`}
                      >
                        Deploy
                      </button>
                      <button
                        type="button"
                        style={actionBtnStyle}
                        onClick={() => handleOpenEdit(tpl)}
                        data-testid={`action-edit-${tpl.id}`}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        style={{ ...actionBtnStyle, color: "var(--danger, #dc2626)" }}
                        onClick={() => onDelete?.(tpl.id)}
                        data-testid={`action-delete-${tpl.id}`}
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

      {formOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          data-testid="template-form-modal"
        >
          <GroupTemplateForm
            initialTemplate={editingTemplate}
            onSave={handleSave}
            onCancel={() => {
              setFormOpen(false);
              setEditingTemplate(null);
            }}
          />
        </div>
      )}

      {deployTemplate && (
        <DeployWizard
          template={deployTemplate}
          open={deployWizardOpen}
          onClose={() => {
            setDeployWizardOpen(false);
            setDeployTemplate(null);
          }}
        />
      )}
    </div>
  );
}
