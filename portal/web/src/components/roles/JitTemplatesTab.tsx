"use client";

// JIT Templates Tab component (EPIC-013 SPEC §3.4, §5; T-0249).
// CRUD for JIT Admin Templates (allowed roles, duration, justification, approval).
// Strictly uses report theme tokens with zero colour literals.

import React, { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import {
  createJitTemplate,
  deleteJitTemplate,
  fetchJitTemplates,
  type JitAdminTemplate,
} from "../../lib/jitApi";

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "14px",
  color: "var(--text)",
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "12px 16px",
  borderBottom: "1px solid var(--border)",
  color: "var(--muted)",
  fontWeight: 600,
};

const tdStyle: CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid var(--border)",
  verticalAlign: "middle",
};

const actionBtnStyle: CSSProperties = {
  padding: "4px 8px",
  borderRadius: "4px",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  fontSize: "12px",
  cursor: "pointer",
  marginRight: "6px",
};

const modalBackdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
};

const modalContentStyle: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  padding: "24px",
  maxWidth: "500px",
  width: "100%",
  display: "flex",
  flexDirection: "column",
  gap: "14px",
  color: "var(--text)",
};

const inputStyle: CSSProperties = {
  padding: "8px 12px",
  background: "var(--input-bg, var(--bg))",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "14px",
};

export function JitTemplatesTab(): ReactElement {
  const [templates, setTemplates] = useState<JitAdminTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New Template Modal state
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [allowedRolesStr, setAllowedRolesStr] = useState("");
  const [duration, setDuration] = useState(8);
  const [maxDuration, setMaxDuration] = useState(24);
  const [justificationRequired, setJustificationRequired] = useState(true);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadTemplates = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJitTemplates();
      setTemplates(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load JIT templates");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTemplates();
  }, []);

  const handleCreate = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setActionError(null);
    const roles = allowedRolesStr
      .split(",")
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    if (roles.length === 0) {
      setActionError("At least one allowed role must be specified.");
      return;
    }

    try {
      await createJitTemplate({
        name: name.trim(),
        description: description.trim() || null,
        allowedRoles: roles,
        duration,
        maxDuration,
        justificationRequired,
        approvalRequired,
      });

      setShowCreate(false);
      setName("");
      setDescription("");
      setAllowedRolesStr("");
      await loadTemplates();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to create template");
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    try {
      await deleteJitTemplate(id);
      await loadTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete template");
    }
  };

  return (
    <div data-testid="jit-templates-tab" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: "18px" }}>JIT Admin Templates</h3>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          style={{
            padding: "8px 16px",
            borderRadius: "6px",
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text)",
            fontWeight: 600,
            fontSize: "14px",
            cursor: "pointer",
          }}
          data-testid="btn-new-template"
        >
          + New Template
        </button>
      </div>

      {loading && <p style={{ color: "var(--muted)" }}>Loading templates…</p>}
      {error && <p role="alert" style={{ color: "var(--error)" }}>{error}</p>}

      {!loading && !error && templates.length === 0 && (
        <p style={{ color: "var(--muted)" }}>No JIT admin templates found.</p>
      )}

      {!loading && templates.length > 0 && (
        <table style={tableStyle} data-testid="jit-templates-table">
          <thead>
            <tr>
              <th style={thStyle}>Template Name</th>
              <th style={thStyle}>Allowed Roles</th>
              <th style={thStyle}>Default Duration</th>
              <th style={thStyle}>Max Duration</th>
              <th style={thStyle}>Justification</th>
              <th style={thStyle}>Approval</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((tpl) => (
              <tr key={tpl.id}>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 600 }}>{tpl.name}</div>
                  {tpl.description && (
                    <div style={{ fontSize: "12px", color: "var(--muted)" }}>{tpl.description}</div>
                  )}
                </td>
                <td style={tdStyle}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                    {tpl.allowedRoles.map((r) => (
                      <span
                        key={r}
                        style={{
                          padding: "2px 6px",
                          borderRadius: "4px",
                          fontSize: "12px",
                          background: "var(--surface)",
                          border: "1px solid var(--border)",
                        }}
                      >
                        {r}
                      </span>
                    ))}
                  </div>
                </td>
                <td style={tdStyle}>{tpl.duration}h</td>
                <td style={tdStyle}>{tpl.maxDuration}h</td>
                <td style={tdStyle}>{tpl.justificationRequired ? "Required" : "Optional"}</td>
                <td style={tdStyle}>{tpl.approvalRequired ? "Required" : "Not Required"}</td>
                <td style={tdStyle}>
                  <button
                    type="button"
                    style={{ ...actionBtnStyle, color: "var(--error)" }}
                    onClick={() => handleDelete(tpl.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showCreate && (
        <div style={modalBackdropStyle} onClick={() => setShowCreate(false)}>
          <div style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Create JIT Template</h3>
              <button type="button" style={actionBtnStyle} onClick={() => setShowCreate(false)}>
                ✕
              </button>
            </div>

            {actionError && <p role="alert" style={{ color: "var(--error)", margin: 0 }}>{actionError}</p>}

            <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" }}>
                Template Name
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Incident Response Admin"
                  style={inputStyle}
                  data-testid="input-tpl-name"
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" }}>
                Allowed Roles (comma-separated)
                <input
                  type="text"
                  required
                  value={allowedRolesStr}
                  onChange={(e) => setAllowedRolesStr(e.target.value)}
                  placeholder="role-ga, role-sa"
                  style={inputStyle}
                  data-testid="input-tpl-roles"
                />
              </label>

              <div style={{ display: "flex", gap: "12px" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px", flex: 1 }}>
                  Duration (hours)
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    style={inputStyle}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px", flex: 1 }}>
                  Max Duration (hours)
                  <input
                    type="number"
                    min={1}
                    max={48}
                    value={maxDuration}
                    onChange={(e) => setMaxDuration(Number(e.target.value))}
                    style={inputStyle}
                  />
                </label>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={justificationRequired}
                  onChange={(e) => setJustificationRequired(e.target.checked)}
                />
                Require justification from operator
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={approvalRequired}
                  onChange={(e) => setApprovalRequired(e.target.checked)}
                />
                Require administrative approval (pending state)
              </label>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" }}>
                <button type="button" style={actionBtnStyle} onClick={() => setShowCreate(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ ...actionBtnStyle, background: "var(--primary, var(--surface))", fontWeight: 600 }}
                  data-testid="btn-save-template"
                >
                  Save Template
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
