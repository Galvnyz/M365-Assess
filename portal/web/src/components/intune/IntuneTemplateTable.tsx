"use client";

// IntuneTemplateTable — Policy Templates list (EPIC-016 SPEC.md §3.2; T-0307), plus the
// template edit dialog. Columns: Name · Platform · Type · Assignments · Updated.
// Row actions: Deploy, Edit, Clone, Export, Delete.
import React, { useMemo, useState, type CSSProperties } from "react";
import type { IntuneTemplate, IntuneTemplateInput } from "../../lib/intuneApi";
import { JsonSettingsEditor, validatePolicyJson } from "./JsonSettingsEditor";

export type IntuneTemplateRowAction = "deploy" | "edit" | "clone" | "export" | "delete";

export interface IntuneTemplateTableProps {
  readonly templates: readonly IntuneTemplate[];
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onAction?: (action: IntuneTemplateRowAction, template: IntuneTemplate) => void;
  readonly onDeploy?: () => void;
}

const ROW_ACTIONS: readonly { readonly action: IntuneTemplateRowAction; readonly label: string }[] = [
  { action: "deploy", label: "Deploy" },
  { action: "edit", label: "Edit" },
  { action: "clone", label: "Clone" },
  { action: "export", label: "Export" },
  { action: "delete", label: "Delete" },
];

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text, #111827)",
};

const barStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "8px",
  flexWrap: "wrap",
  padding: "16px",
  background: "var(--bg-elev, #f9fafb)",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "8px",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "14px",
  background: "var(--bg, #ffffff)",
  border: "1px solid var(--border, #e5e7eb)",
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "10px 14px",
  background: "var(--bg-elev, #f3f4f6)",
  fontSize: "12px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--text-muted, #6b7280)",
  borderBottom: "1px solid var(--border, #e5e7eb)",
};

const tdStyle: CSSProperties = {
  padding: "10px 14px",
  borderBottom: "1px solid var(--border, #e5e7eb)",
};

const inputStyle: CSSProperties = {
  padding: "6px 10px",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "6px",
  fontSize: "13px",
  background: "var(--bg, #ffffff)",
  color: "var(--text, #111827)",
};

const actionBtnStyle: CSSProperties = {
  padding: "3px 8px",
  fontSize: "12px",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "4px",
  background: "var(--bg, #ffffff)",
  color: "var(--text, #111827)",
  cursor: "pointer",
  marginRight: "4px",
};

const primaryStyle: CSSProperties = {
  padding: "8px 16px",
  background: "var(--accent, #2563eb)",
  color: "#ffffff",
  border: "none",
  borderRadius: "6px",
  cursor: "pointer",
  fontSize: "13px",
  fontWeight: 600,
};

function formatDate(dt: string): string {
  const d = new Date(dt);
  return Number.isNaN(d.getTime())
    ? dt
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function IntuneTemplateTable({
  templates,
  loading = false,
  error = null,
  onAction,
  onDeploy,
}: IntuneTemplateTableProps) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter(
      (t) => (!typeFilter || t.policyType === typeFilter) && (!q || t.name.toLowerCase().includes(q)),
    );
  }, [templates, search, typeFilter]);

  return (
    <div style={containerStyle}>
      <div style={barStyle}>
        <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>Policy Templates</h2>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <input
            style={inputStyle}
            type="search"
            placeholder="Search templates…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search templates"
          />
          <select
            style={inputStyle}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            aria-label="Filter by type"
          >
            <option value="">All types</option>
            <option value="configuration">Configuration</option>
            <option value="compliance">Compliance</option>
          </select>
          {onDeploy && (
            <button style={primaryStyle} onClick={onDeploy} disabled={templates.length === 0}>
              Deploy template
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          style={{ padding: "12px 16px", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "8px", color: "#b91c1c" }}
        >
          {error}
        </div>
      )}
      {loading && <div style={{ padding: "24px", textAlign: "center" }}>Loading policy templates…</div>}

      {!loading && !error && (
        <table style={tableStyle} aria-label="Policy Templates">
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Platform</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Assignments</th>
              <th style={thStyle}>Updated</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ ...tdStyle, textAlign: "center", color: "var(--text-muted, #6b7280)" }}>
                  No policy templates found. Use “Clone to template” on a policy to create one.
                </td>
              </tr>
            ) : (
              visible.map((t) => (
                <tr key={t.id} data-testid={`template-${t.id}`}>
                  <td style={tdStyle}>{t.name}</td>
                  <td style={tdStyle}>{t.platform}</td>
                  <td style={tdStyle}>{t.policyType}</td>
                  <td style={tdStyle}>{t.assignments?.length ?? 0}</td>
                  <td style={tdStyle}>{formatDate(t.updatedAt)}</td>
                  <td style={tdStyle}>
                    {ROW_ACTIONS.map(({ action, label }) => (
                      <button
                        key={action}
                        style={action === "delete" ? { ...actionBtnStyle, color: "var(--danger, #dc2626)" } : actionBtnStyle}
                        onClick={() => onAction?.(action, t)}
                        aria-label={`${label} ${t.name}`}
                      >
                        {label}
                      </button>
                    ))}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

export interface IntuneTemplateEditDialogProps {
  readonly template: IntuneTemplate;
  readonly onSave: (patch: Pick<IntuneTemplateInput, "name" | "policyJson">) => Promise<void>;
  readonly onClose: () => void;
}

/** Edit a template's name and policy JSON; JSON is validated against the T-0301 registry. */
export function IntuneTemplateEditDialog({ template, onSave, onClose }: IntuneTemplateEditDialogProps) {
  const [name, setName] = useState(template.name);
  const [jsonText, setJsonText] = useState(JSON.stringify(template.policyJson, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) {
      setError("Template name is required.");
      return;
    }
    // Templates store "windows10"/"windows81"; the registry mirror names the platform "windows".
    const platform = template.platform.startsWith("windows") ? "windows" : template.platform;
    const parsed = validatePolicyJson(jsonText, template.policyType, platform);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    try {
      await onSave({ name: name.trim(), policyJson: parsed.value });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save template.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit template"
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div
        style={{
          width: "640px",
          maxWidth: "calc(100vw - 32px)",
          background: "var(--bg, #ffffff)",
          color: "var(--text, #111827)",
          borderRadius: "10px",
          padding: "20px 24px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "18px" }}>Edit template</h2>
        <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" }}>
          Name
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <JsonSettingsEditor
          value={jsonText}
          error={error}
          onChange={(text) => {
            setJsonText(text);
            setError(null);
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button style={actionBtnStyle} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button style={primaryStyle} onClick={() => void save()} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
