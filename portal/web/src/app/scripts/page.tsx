"use client";

// Custom Scripts page (EPIC-007 SPEC.md §3.3, §4.3; T-0130).
// Table: Name · Language (PowerShell) · Author · Enabled · Alerts · Last run ·
// Version. Row actions: Edit, View versions, Enable/Disable, Enable/Disable
// alerts, Run now (dry run), Delete, Save to GitHub (EPIC-039 placeholder).
// The editor appends a version on save; Run now renders output via the markdown
// template (T-0128 semantics).
// Zero colour literals: report theme tokens only.

import React, { useCallback, useEffect, useState, type CSSProperties, type ReactElement } from "react";
import {
  ScriptEditor,
  renderScriptOutput,
  type ScriptEditorScript,
} from "../../components/scripts/ScriptEditor.js";
import {
  ScriptVersionsDrawer,
  type ScriptVersionItem,
} from "../../components/scripts/ScriptVersionsDrawer.js";

export interface CustomScriptItem {
  readonly id: string;
  readonly name: string;
  readonly author: string;
  readonly enabled: boolean;
  readonly alertsEnabled: boolean;
  readonly currentVersionId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CustomScriptsPageProps {
  readonly fetcher?: typeof fetch;
  /** Tenant used by the Run now dry run. */
  readonly tenantId?: string;
}

const pageStyle: CSSProperties = {
  padding: "32px",
  maxWidth: "1400px",
  margin: "0 auto",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
  display: "flex",
  flexDirection: "column",
  gap: "24px",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "16px",
  borderBottom: "1px solid var(--border)",
  paddingBottom: "16px",
  flexWrap: "wrap",
};

const titleStyle: CSSProperties = {
  fontSize: "24px",
  fontWeight: 700,
  margin: 0,
  fontFamily: "var(--font-display, var(--font-sans))",
};

const buttonStyle: CSSProperties = {
  padding: "8px 14px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "14px",
  fontWeight: 500,
  cursor: "pointer",
};

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "var(--accent)",
  color: "var(--accent-text)",
  borderColor: "var(--accent)",
};

const disabledButtonStyle: CSSProperties = {
  ...buttonStyle,
  opacity: 0.4,
  cursor: "not-allowed",
};

const actionBtnStyle: CSSProperties = {
  ...buttonStyle,
  padding: "4px 8px",
  fontSize: "12px",
  whiteSpace: "nowrap",
};

const tableWrapperStyle: CSSProperties = {
  overflowX: "auto",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  boxShadow: "var(--shadow-card)",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "14px",
  textAlign: "left",
};

const thStyle: CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text-soft)",
  fontWeight: 600,
  fontSize: "12px",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  whiteSpace: "nowrap",
};

const tdStyle: CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid var(--border)",
  verticalAlign: "middle",
};

const monoStyle: CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  fontSize: "12px",
};

const inputStyle: CSSProperties = {
  padding: "8px 12px",
  background: "var(--input-bg, var(--bg))",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "14px",
};

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/** Parses sandbox output as JSON when possible so it can be template-rendered. */
export function parseScriptOutput(output: string): unknown {
  const trimmed = (output ?? "").trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return { output: trimmed };
  }
}

export default function CustomScriptsPage({
  fetcher,
  tenantId = "",
}: CustomScriptsPageProps): ReactElement {
  const doFetch = fetcher ?? fetch;
  const [scripts, setScripts] = useState<CustomScriptItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ScriptEditorScript | null>(null);
  const [versions, setVersions] = useState<ScriptVersionItem[] | null>(null);
  const [versionsScriptId, setVersionsScriptId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<{ scriptId: string; rendered: string; raw: string } | null>(null);
  const [runTenant, setRunTenant] = useState(tenantId);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await doFetch("/v1/scripts");
      if (!res.ok) throw new Error(`Failed to load scripts: ${res.statusText}`);
      const body = (await res.json()) as { items?: CustomScriptItem[] };
      setScripts(body.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setScripts([]);
    } finally {
      setLoading(false);
    }
  }, [doFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggle = async (script: CustomScriptItem, field: "enabled" | "alertsEnabled"): Promise<void> => {
    try {
      const res = await doFetch(`/v1/scripts/${script.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: !script[field] }),
      });
      if (!res.ok) throw new Error(`Update failed: ${res.statusText}`);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (script: CustomScriptItem): Promise<void> => {
    try {
      const res = await doFetch(`/v1/scripts/${script.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed: ${res.statusText}`);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleViewVersions = async (script: CustomScriptItem): Promise<void> => {
    setVersionsScriptId(script.id);
    setSelectedVersionId(null);
    setVersions([]);
    try {
      const res = await doFetch(`/v1/scripts/${script.id}/versions`);
      if (!res.ok) throw new Error(`Failed to load versions: ${res.statusText}`);
      const body = (await res.json()) as { items?: ScriptVersionItem[] };
      setVersions(body.items ?? []);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRunNow = async (script: CustomScriptItem): Promise<void> => {
    if (!runTenant.trim()) {
      alert("Enter a tenant id before running a dry run.");
      return;
    }
    try {
      const res = await doFetch(`/v1/scripts/${script.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: runTenant.trim(), dryRun: true }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `Run failed: ${res.statusText}`);
      }
      const body = (await res.json()) as { output?: string };

      // Render the output through the current version's markdown template.
      let template = "";
      const detail = await doFetch(`/v1/scripts/${script.id}`);
      if (detail.ok) {
        const detailBody = (await detail.json()) as { currentVersion?: { markdownTemplate?: string | null } };
        template = detailBody.currentVersion?.markdownTemplate ?? "";
      }
      const raw = body.output ?? "";
      setRunResult({ scriptId: script.id, raw, rendered: renderScriptOutput(template, parseScriptOutput(raw)) });
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const closeEditor = (): void => setEditing(null);

  return (
    <div style={pageStyle} data-testid="custom-scripts-page">
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>Custom Scripts</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-soft)", fontSize: "14px" }}>
            Author sandboxed PowerShell scripts. Saving appends an immutable version.
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <input
            type="text"
            placeholder="Tenant id for dry runs"
            value={runTenant}
            onChange={(e) => setRunTenant(e.target.value)}
            style={inputStyle}
            aria-label="Tenant id for dry runs"
            data-testid="run-tenant"
          />
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={() => setEditing({ name: "", author: "", content: "", markdownTemplate: "", parameters: {} })}
            data-testid="new-script-button"
          >
            New script
          </button>
        </div>
      </div>

      {editing && (
        <ScriptEditor
          mode={editing.id ? "edit" : "create"}
          script={editing}
          fetcher={fetcher}
          onCancel={closeEditor}
          onSave={() => {
            closeEditor();
            void load();
          }}
        />
      )}

      {loading && <div style={{ color: "var(--text-soft)" }}>Loading custom scripts...</div>}
      {error && (
        <div style={{ padding: "16px", background: "var(--danger-soft)", border: "1px solid var(--danger)", borderRadius: "6px", color: "var(--danger-text)" }} role="alert">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div style={tableWrapperStyle}>
          <table style={tableStyle} aria-label="Custom scripts">
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Language</th>
                <th style={thStyle}>Author</th>
                <th style={thStyle}>Enabled</th>
                <th style={thStyle}>Alerts</th>
                <th style={thStyle}>Last run</th>
                <th style={thStyle}>Version</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {scripts.length === 0 && (
                <tr>
                  <td style={{ ...tdStyle, textAlign: "center", color: "var(--text-soft)" }} colSpan={8} data-testid="empty-scripts-state">
                    No custom scripts yet.
                  </td>
                </tr>
              )}
              {scripts.map((script) => (
                <tr key={script.id} data-testid={`script-row-${script.id}`}>
                  <td style={tdStyle}>{script.name}</td>
                  <td style={tdStyle}>PowerShell</td>
                  <td style={tdStyle}>{script.author}</td>
                  <td style={tdStyle}>{script.enabled ? "Yes" : "No"}</td>
                  <td style={tdStyle}>{script.alertsEnabled ? "Yes" : "No"}</td>
                  <td style={tdStyle}>{formatDateTime(script.updatedAt)}</td>
                  <td style={{ ...tdStyle, ...monoStyle }}>{script.currentVersionId ? script.currentVersionId.slice(0, 8) : "—"}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <div style={{ display: "inline-flex", gap: "6px", justifyContent: "flex-end", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        style={actionBtnStyle}
                        onClick={async () => {
                          const res = await doFetch(`/v1/scripts/${script.id}`);
                          if (res.ok) {
                            const body = (await res.json()) as { script?: CustomScriptItem; currentVersion?: ScriptVersionItem };
                            setEditing({
                              id: script.id,
                              name: script.name,
                              author: script.author,
                              enabled: script.enabled,
                              alertsEnabled: script.alertsEnabled,
                              content: body.currentVersion?.content ?? "",
                              markdownTemplate: body.currentVersion?.markdownTemplate ?? "",
                              parameters: body.currentVersion?.parameters ?? {},
                            });
                          }
                        }}
                        data-testid={`edit-${script.id}`}
                      >
                        Edit
                      </button>
                      <button type="button" style={actionBtnStyle} onClick={() => void handleViewVersions(script)} data-testid={`versions-${script.id}`}>
                        View versions
                      </button>
                      <button type="button" style={actionBtnStyle} onClick={() => void handleToggle(script, "enabled")} data-testid={`toggle-${script.id}`}>
                        {script.enabled ? "Disable" : "Enable"}
                      </button>
                      <button type="button" style={actionBtnStyle} onClick={() => void handleToggle(script, "alertsEnabled")} data-testid={`toggle-alerts-${script.id}`}>
                        {script.alertsEnabled ? "Disable alerts" : "Enable alerts"}
                      </button>
                      <button type="button" style={actionBtnStyle} onClick={() => void handleRunNow(script)} data-testid={`run-${script.id}`}>
                        Run now
                      </button>
                      <button type="button" style={actionBtnStyle} onClick={() => void handleDelete(script)} data-testid={`delete-${script.id}`}>
                        Delete
                      </button>
                      <button type="button" style={disabledButtonStyle} disabled title="Available in EPIC-039" data-testid={`github-${script.id}`}>
                        Save to GitHub
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {runResult && (
        <div
          style={{ padding: "16px", background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: "var(--radius, 10px)" }}
          data-testid="dry-run-output"
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <strong>Dry run output (rendered)</strong>
            <button type="button" style={buttonStyle} onClick={() => setRunResult(null)} data-testid="dry-run-close">
              Close
            </button>
          </div>
          {runResult.rendered ? (
            <pre style={{ ...monoStyle, margin: 0, whiteSpace: "pre-wrap" }} data-testid="dry-run-rendered">
              {runResult.rendered}
            </pre>
          ) : (
            <pre style={{ ...monoStyle, margin: 0, whiteSpace: "pre-wrap" }} data-testid="dry-run-raw">
              {runResult.raw}
            </pre>
          )}
        </div>
      )}

      {versionsScriptId && (
        <ScriptVersionsDrawer
          versions={versions ?? []}
          selectedVersionId={selectedVersionId}
          loading={versions === null}
          onSelect={(version) => setSelectedVersionId(version.id)}
          onClose={() => {
            setVersionsScriptId(null);
            setVersions(null);
          }}
        />
      )}
    </div>
  );
}
