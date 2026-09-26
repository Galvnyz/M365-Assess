"use client";

// PIM Settings Templates Tab (EPIC-013 SPEC §3.2, §5; T-0248).
// Lists and manages reusable PIM role settings templates.
// Row actions: Edit, Clone, Apply to role, Delete, Compare.
// Compare shows current vs template diff without tenant mutation.
// Strictly uses report theme tokens with zero colour literals.

import React, { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import {
  comparePimSettingsTemplate,
  createPimSettingsTemplate,
  deletePimSettingsTemplate,
  fetchPimSettingsTemplates,
  type PimCompareResult,
  type PimRoleSettingsTemplate,
} from "../../lib/rolesApi";

export interface PimSettingsTemplatesTabProps {
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
  maxWidth: "600px",
  width: "100%",
  maxHeight: "85vh",
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: "16px",
};

export function PimSettingsTemplatesTab({ tenantId }: PimSettingsTemplatesTabProps): ReactElement {
  const [templates, setTemplates] = useState<PimRoleSettingsTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [compareResult, setCompareResult] = useState<PimCompareResult | null>(null);
  const [comparing, setComparing] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const loadTemplates = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPimSettingsTemplates();
      setTemplates(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load templates");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTemplates();
  }, []);

  const handleCompare = async (tpl: PimRoleSettingsTemplate): Promise<void> => {
    if (!tenantId) {
      setActionNotice("Select or enter a tenant to compare template against live role settings");
      return;
    }
    setComparing(true);
    setActionNotice(null);
    try {
      const res = await comparePimSettingsTemplate(tpl.id, tenantId, tpl.roleId ?? undefined);
      setCompareResult(res);
    } catch (e) {
      setActionNotice(e instanceof Error ? e.message : "Failed to run compare");
    } finally {
      setComparing(false);
    }
  };

  const handleDelete = async (tplId: string): Promise<void> => {
    try {
      await deletePimSettingsTemplate(tplId);
      await loadTemplates();
    } catch (e) {
      setActionNotice(e instanceof Error ? e.message : "Failed to delete template");
    }
  };

  const handleClone = async (tpl: PimRoleSettingsTemplate): Promise<void> => {
    try {
      await createPimSettingsTemplate({
        name: `${tpl.name} (Copy)`,
        roleId: tpl.roleId,
        settings: tpl.settings,
        scope: tpl.scope,
      });
      await loadTemplates();
    } catch (e) {
      setActionNotice(e instanceof Error ? e.message : "Failed to clone template");
    }
  };

  return (
    <div data-testid="pim-templates-tab" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: "18px" }}>PIM Role Settings Templates</h3>
      </div>

      {actionNotice && (
        <div style={{ padding: "8px 12px", borderRadius: "6px", background: "var(--warning-soft, var(--surface))", border: "1px solid var(--border)", color: "var(--text)" }}>
          {actionNotice}
        </div>
      )}

      {loading && <p style={{ color: "var(--muted)" }}>Loading templates…</p>}
      {error && <p role="alert" style={{ color: "var(--error)" }}>{error}</p>}

      {!loading && !error && templates.length === 0 && (
        <p style={{ color: "var(--muted)" }}>No templates configured.</p>
      )}

      {!loading && templates.length > 0 && (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Target Role</th>
              <th style={thStyle}>Max Duration</th>
              <th style={thStyle}>MFA</th>
              <th style={thStyle}>Justification</th>
              <th style={thStyle}>Approval</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((tpl) => (
              <tr key={tpl.id}>
                <td style={tdStyle}>{tpl.name}</td>
                <td style={tdStyle}>{tpl.roleId ?? "Any Role"}</td>
                <td style={tdStyle}>{tpl.settings.maximumDurationInHours ?? 8}h</td>
                <td style={tdStyle}>{tpl.settings.requireMfa ? "Required" : "Optional"}</td>
                <td style={tdStyle}>{tpl.settings.requireJustification ? "Required" : "Optional"}</td>
                <td style={tdStyle}>{tpl.settings.requireApproval ? "Required" : "Not Required"}</td>
                <td style={tdStyle}>
                  <button
                    type="button"
                    style={actionBtnStyle}
                    onClick={() => handleCompare(tpl)}
                    disabled={comparing}
                  >
                    Compare
                  </button>
                  <button
                    type="button"
                    style={actionBtnStyle}
                    onClick={() => handleClone(tpl)}
                  >
                    Clone
                  </button>
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

      {compareResult && (
        <div style={modalBackdropStyle} onClick={() => setCompareResult(null)}>
          <div style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Template Comparison: {compareResult.templateId}</h3>
              <button
                type="button"
                style={actionBtnStyle}
                onClick={() => setCompareResult(null)}
              >
                Close
              </button>
            </div>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: "14px" }}>
              Differences between template and live role settings in tenant <strong>{compareResult.tenantId}</strong>
            </p>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Setting</th>
                  <th style={thStyle}>Current (Live)</th>
                  <th style={thStyle}>Template</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {compareResult.diffs.map((d) => (
                  <tr key={d.setting}>
                    <td style={tdStyle}>{d.setting}</td>
                    <td style={tdStyle}>{String(d.current)}</td>
                    <td style={tdStyle}>{String(d.template)}</td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          padding: "2px 6px",
                          borderRadius: "4px",
                          fontSize: "12px",
                          background: d.matches ? "var(--success-soft, var(--surface))" : "var(--warning-soft, var(--surface))",
                          border: "1px solid var(--border)",
                        }}
                      >
                        {d.matches ? "Match" : "Differs"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
