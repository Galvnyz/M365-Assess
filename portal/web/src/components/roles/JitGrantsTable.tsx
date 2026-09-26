"use client";

// JIT Grants Table component (EPIC-013 SPEC §3.4, §4.4; T-0249).
// Table: User · Role · Type · Starts · Ends · State · Actions (Revoke, Extend).
// Grant dialog enforces template's allowed roles.
// Strictly uses report theme tokens with zero colour literals.

import React, { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import {
  createJitGrant,
  extendJitGrant,
  fetchJitGrants,
  fetchJitTemplates,
  revokeJitGrant,
  type JitAdminTemplate,
  type JitGrant,
} from "../../lib/jitApi";

export interface JitGrantsTableProps {
  readonly tenantId: string;
}

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

export function JitGrantsTable({ tenantId }: JitGrantsTableProps): ReactElement {
  const [grants, setGrants] = useState<JitGrant[]>([]);
  const [templates, setTemplates] = useState<JitAdminTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Grant dialog state
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [userId, setUserId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [durationHours, setDurationHours] = useState(8);
  const [justification, setJustification] = useState("");
  const [grantError, setGrantError] = useState<string | null>(null);

  // Extend dialog state
  const [extendingGrantId, setExtendingGrantId] = useState<string | null>(null);
  const [additionalHours, setAdditionalHours] = useState(4);

  const loadData = async (): Promise<void> => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const [grantsRes, tplsRes] = await Promise.all([
        fetchJitGrants(tenantId),
        fetchJitTemplates(),
      ]);
      setGrants(grantsRes.items);
      setTemplates(tplsRes.items);
      if (tplsRes.items.length > 0 && !selectedTemplateId) {
        setSelectedTemplateId(tplsRes.items[0]?.id ?? "");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load JIT data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [tenantId]);

  const activeTemplate = templates.find((t) => t.id === selectedTemplateId);

  const handleOpenGrantModal = (): void => {
    setGrantError(null);
    if (activeTemplate) {
      setRoleId(activeTemplate.allowedRoles[0] ?? "");
      setDurationHours(activeTemplate.duration);
    }
    setShowGrantModal(true);
  };

  const handleTemplateChange = (tplId: string): void => {
    setSelectedTemplateId(tplId);
    const tpl = templates.find((t) => t.id === tplId);
    if (tpl) {
      setRoleId(tpl.allowedRoles[0] ?? "");
      setDurationHours(tpl.duration);
    }
  };

  const handleCreateGrant = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setGrantError(null);

    if (activeTemplate && !activeTemplate.allowedRoles.includes(roleId)) {
      setGrantError(
        `Role '${roleId}' is not allowed by template '${activeTemplate.name}'. Allowed roles: ${activeTemplate.allowedRoles.join(", ")}`,
      );
      return;
    }

    if (activeTemplate?.justificationRequired && !justification.trim()) {
      setGrantError("Justification is required by this template.");
      return;
    }

    try {
      await createJitGrant(tenantId, {
        userId: userId.trim(),
        roleId: roleId.trim(),
        templateId: selectedTemplateId || undefined,
        durationHours,
        maxDurationHours: activeTemplate?.maxDuration ?? 24,
        justification: justification.trim() || undefined,
      });

      setShowGrantModal(false);
      setUserId("");
      setJustification("");
      await loadData();
    } catch (err) {
      setGrantError(err instanceof Error ? err.message : "Failed to grant JIT role");
    }
  };

  const handleRevoke = async (grantId: string): Promise<void> => {
    try {
      await revokeJitGrant(grantId);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke grant");
    }
  };

  const handleExtend = async (grantId: string): Promise<void> => {
    try {
      await extendJitGrant(grantId, additionalHours);
      setExtendingGrantId(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extend grant");
    }
  };

  return (
    <div data-testid="jit-grants-container" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: "18px" }}>Active &amp; Historical JIT Grants</h3>
        <button
          type="button"
          onClick={handleOpenGrantModal}
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
          data-testid="btn-grant-jit"
        >
          + Grant JIT Admin
        </button>
      </div>

      {loading && <p style={{ color: "var(--muted)" }}>Loading JIT grants…</p>}
      {error && <p role="alert" style={{ color: "var(--error)" }}>{error}</p>}

      {!loading && !error && grants.length === 0 && (
        <p style={{ color: "var(--muted)" }}>No JIT grants for this tenant.</p>
      )}

      {!loading && grants.length > 0 && (
        <table style={tableStyle} data-testid="jit-grants-table">
          <thead>
            <tr>
              <th style={thStyle}>User</th>
              <th style={thStyle}>Role</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Starts At</th>
              <th style={thStyle}>Ends At</th>
              <th style={thStyle}>State</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {grants.map((g) => (
              <tr key={g.id}>
                <td style={tdStyle}>{g.userId}</td>
                <td style={tdStyle}>{g.roleId}</td>
                <td style={tdStyle}>{g.assignmentType}</td>
                <td style={tdStyle}>{new Date(g.startsAt).toLocaleString()}</td>
                <td style={tdStyle}>{new Date(g.endsAt).toLocaleString()}</td>
                <td style={tdStyle}>
                  <span
                    data-testid={`grant-state-${g.state}`}
                    style={{
                      padding: "2px 8px",
                      borderRadius: "12px",
                      fontSize: "12px",
                      fontWeight: 600,
                      background:
                        g.state === "active"
                          ? "var(--success-soft, var(--surface))"
                          : "var(--surface)",
                      color:
                        g.state === "active"
                          ? "var(--success, var(--text))"
                          : "var(--muted)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    {g.state}
                  </span>
                </td>
                <td style={tdStyle}>
                  {g.state === "active" && (
                    <>
                      <button
                        type="button"
                        style={{ ...actionBtnStyle, color: "var(--error)" }}
                        onClick={() => handleRevoke(g.id)}
                        data-testid={`btn-revoke-${g.id}`}
                      >
                        Revoke
                      </button>
                      <button
                        type="button"
                        style={actionBtnStyle}
                        onClick={() => setExtendingGrantId(g.id)}
                        data-testid={`btn-extend-${g.id}`}
                      >
                        Extend
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Grant JIT Modal */}
      {showGrantModal && (
        <div style={modalBackdropStyle} onClick={() => setShowGrantModal(false)}>
          <div style={modalContentStyle} onClick={(e) => e.stopPropagation()} data-testid="grant-modal">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Grant JIT Admin</h3>
              <button type="button" style={actionBtnStyle} onClick={() => setShowGrantModal(false)}>
                ✕
              </button>
            </div>

            {grantError && (
              <p role="alert" data-testid="grant-error" style={{ color: "var(--error)", margin: 0, fontSize: "13px" }}>
                {grantError}
              </p>
            )}

            <form onSubmit={handleCreateGrant} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" }}>
                Template
                <select
                  value={selectedTemplateId}
                  onChange={(e) => handleTemplateChange(e.target.value)}
                  style={inputStyle}
                  data-testid="select-template"
                >
                  <option value="">Custom / Direct Grant</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.duration}h)
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" }}>
                User ID / UPN
                <input
                  type="text"
                  required
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder="admin@example.com"
                  style={inputStyle}
                  data-testid="input-grant-user"
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" }}>
                Target Role
                {activeTemplate && activeTemplate.allowedRoles.length > 0 ? (
                  <select
                    value={roleId}
                    onChange={(e) => setRoleId(e.target.value)}
                    style={inputStyle}
                    data-testid="select-grant-role"
                  >
                    {activeTemplate.allowedRoles.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    required
                    value={roleId}
                    onChange={(e) => setRoleId(e.target.value)}
                    placeholder="role-ga"
                    style={inputStyle}
                    data-testid="input-grant-role"
                  />
                )}
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" }}>
                Duration (hours)
                <input
                  type="number"
                  min={1}
                  max={activeTemplate?.maxDuration ?? 24}
                  value={durationHours}
                  onChange={(e) => setDurationHours(Number(e.target.value))}
                  style={inputStyle}
                  data-testid="input-grant-duration"
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" }}>
                Justification {activeTemplate?.justificationRequired && "(Required)"}
                <textarea
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  placeholder="Reason for temporary privileged role…"
                  rows={3}
                  style={{ ...inputStyle, resize: "vertical" }}
                  data-testid="input-grant-justification"
                />
              </label>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" }}>
                <button type="button" style={actionBtnStyle} onClick={() => setShowGrantModal(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ ...actionBtnStyle, background: "var(--primary, var(--surface))", fontWeight: 600 }}
                  data-testid="btn-submit-grant"
                >
                  Confirm Grant
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Extend Modal */}
      {extendingGrantId && (
        <div style={modalBackdropStyle} onClick={() => setExtendingGrantId(null)}>
          <div style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0 }}>Extend JIT Grant</h3>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" }}>
              Additional Hours
              <input
                type="number"
                min={1}
                max={24}
                value={additionalHours}
                onChange={(e) => setAdditionalHours(Number(e.target.value))}
                style={inputStyle}
                data-testid="input-extend-hours"
              />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button type="button" style={actionBtnStyle} onClick={() => setExtendingGrantId(null)}>
                Cancel
              </button>
              <button
                type="button"
                style={{ ...actionBtnStyle, background: "var(--primary, var(--surface))", fontWeight: 600 }}
                onClick={() => handleExtend(extendingGrantId)}
                data-testid="btn-confirm-extend"
              >
                Confirm Extension
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
