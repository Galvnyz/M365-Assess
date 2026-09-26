"use client";

// Custom script editor (EPIC-007 SPEC.md §3.3, T-0130).
// ScriptContent code area, MarkdownTemplate area, TestParameters JSON, and an
// Explore data structure helper. Saving always appends a new immutable version
// (T-0125/T-0127): create posts /v1/scripts, edit appends /v1/scripts/{id}/versions.
//
// The markdown-template renderer mirrors T-0128's Format-ScriptOutput syntax
// (`{{ Token }}`, dotted paths, `{{#each Path}}`, explicit missing placeholder).
// Zero colour literals: report theme tokens only.

import React, { useMemo, useState, type CSSProperties, type ReactElement } from "react";

export interface ScriptEditorScript {
  readonly id?: string;
  readonly name: string;
  readonly author?: string;
  readonly enabled?: boolean;
  readonly alertsEnabled?: boolean;
  readonly content?: string;
  readonly markdownTemplate?: string | null;
  readonly parameters?: Record<string, unknown> | null;
}

export interface ScriptEditorProps {
  readonly mode?: "create" | "edit";
  readonly script?: ScriptEditorScript;
  readonly onSave?: (result: { scriptId: string; versionId: string }) => void;
  readonly onCancel?: () => void;
  readonly fetcher?: typeof fetch;
}

// ─── Template rendering (mirror of T-0128 Format-ScriptOutput) ───────────────

const MISSING = "_(missing: {0})_";

function readPath(context: unknown, path: string): { found: boolean; value: unknown } {
  let current: unknown = context;
  for (const segment of path.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") {
      return { found: false, value: null };
    }
    const record = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, segment)) {
      return { found: false, value: null };
    }
    current = record[segment];
  }
  return { found: true, value: current };
}

function stringify(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Renders an output object through a markdown template (T-0128 semantics). */
export function renderScriptOutput(
  template: string | null | undefined,
  output: unknown,
): string {
  if (!template) return "";
  const eachPattern = /\{\{#each\s+([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g;
  let rendered = template.replace(eachPattern, (_match, path: string, inner: string) => {
    const resolved = readPath(output, path);
    if (!resolved.found || resolved.value === null || resolved.value === undefined) {
      return MISSING.replace("{0}", path);
    }
    const elements = Array.isArray(resolved.value) ? resolved.value : [resolved.value];
    return elements.map((element) => renderScriptOutput(inner, element)).join("");
  });

  rendered = rendered.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}/g, (_match, path: string) => {
    const resolved = readPath(output, path);
    if (!resolved.found) return MISSING.replace("{0}", path);
    const text = stringify(resolved.value);
    return text === null ? MISSING.replace("{0}", path) : text;
  });

  return rendered;
}

// ─── Explore data structure ──────────────────────────────────────────────────

export interface DataStructureField {
  readonly path: string;
  readonly type: string;
}

/** Lists the flattened field paths and types of a value (Explore data structure). */
export function describeDataStructure(value: unknown, prefix = ""): DataStructureField[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    const first = value[0];
    const path = prefix ? `${prefix}[]` : "[]";
    if (first !== undefined && typeof first === "object" && first !== null) {
      return describeDataStructure(first, path);
    }
    return [{ path, type: "collection" }];
  }
  if (typeof value === "object") {
    const out: DataStructureField[] = [];
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (child !== null && typeof child === "object") {
        const nested = describeDataStructure(child, path);
        if (nested.length === 0) out.push({ path, type: "object" });
        else out.push(...nested);
      } else {
        out.push({ path, type: typeof child });
      }
    }
    return out;
  }
  return [{ path: prefix || "(value)", type: typeof value }];
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "14px",
  padding: "16px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  boxShadow: "var(--shadow-card)",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
};

const fieldLabelStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--text-soft)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const inputStyle: CSSProperties = {
  padding: "8px 12px",
  background: "var(--input-bg, var(--bg))",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "14px",
  width: "100%",
  boxSizing: "border-box",
};

const codeAreaStyle: CSSProperties = {
  ...inputStyle,
  fontFamily: "var(--font-mono, monospace)",
  fontSize: "13px",
  minHeight: "160px",
  resize: "vertical",
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

const structureStyle: CSSProperties = {
  margin: 0,
  padding: "10px 12px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  fontFamily: "var(--font-mono, monospace)",
  fontSize: "12px",
  maxHeight: "180px",
  overflowY: "auto",
  whiteSpace: "pre-wrap",
};

export function ScriptEditor({
  mode = "create",
  script,
  onSave,
  onCancel,
  fetcher,
}: ScriptEditorProps): ReactElement {
  const doFetch = fetcher ?? fetch;
  const [name, setName] = useState(script?.name ?? "");
  const [author, setAuthor] = useState(script?.author ?? "");
  const [content, setContent] = useState(script?.content ?? "");
  const [markdownTemplate, setMarkdownTemplate] = useState(script?.markdownTemplate ?? "");
  const [testParameters, setTestParameters] = useState(
    JSON.stringify(script?.parameters ?? {}, null, 2),
  );
  const [showStructure, setShowStructure] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedParameters = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(testParameters || "{}") };
    } catch {
      return { ok: false as const, value: null };
    }
  }, [testParameters]);

  const structure = useMemo(
    () => (parsedParameters.ok ? describeDataStructure(parsedParameters.value) : []),
    [parsedParameters],
  );

  const handleSave = async (): Promise<void> => {
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!parsedParameters.ok) {
      setError("Test parameters must be valid JSON.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        author: author.trim() || "unknown",
        content,
        markdownTemplate,
        parameters: parsedParameters.value,
      };
      const url = mode === "edit" && script?.id ? `/v1/scripts/${script.id}/versions` : "/v1/scripts";
      const res = await doFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.statusText}`);
      const result = (await res.json()) as { script?: { id: string }; version?: { id: string } };
      onSave?.({
        scriptId: result.script?.id ?? script?.id ?? "",
        versionId: result.version?.id ?? "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={containerStyle} data-testid="script-editor">
      <h2 style={{ margin: 0, fontSize: "16px" }}>
        {mode === "edit" ? `Edit ${script?.name ?? "script"}` : "New custom script"}
      </h2>

      <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <span style={fieldLabelStyle}>Name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} data-testid="script-name" />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <span style={fieldLabelStyle}>Author</span>
        <input type="text" value={author} onChange={(e) => setAuthor(e.target.value)} style={inputStyle} data-testid="script-author" />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <span style={fieldLabelStyle}>ScriptContent (PowerShell)</span>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          style={codeAreaStyle}
          data-testid="script-content"
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <span style={fieldLabelStyle}>MarkdownTemplate</span>
        <textarea
          value={markdownTemplate}
          onChange={(e) => setMarkdownTemplate(e.target.value)}
          style={codeAreaStyle}
          data-testid="script-template"
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <span style={fieldLabelStyle}>TestParameters (JSON)</span>
        <textarea
          value={testParameters}
          onChange={(e) => setTestParameters(e.target.value)}
          style={codeAreaStyle}
          data-testid="script-parameters"
        />
      </label>

      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <button type="button" style={buttonStyle} onClick={() => setShowStructure((v) => !v)} data-testid="explore-structure">
          Explore data structure
        </button>
        {!parsedParameters.ok && (
          <span style={{ color: "var(--danger-text)", fontSize: "13px" }} data-testid="parameters-invalid">
            Test parameters are not valid JSON.
          </span>
        )}
      </div>

      {showStructure && (
        <pre style={structureStyle} data-testid="structure-helper">
          {structure.length === 0
            ? "No fields. Enter valid JSON test parameters."
            : structure.map((field) => `${field.path}: ${field.type}`).join("\n")}
        </pre>
      )}

      {error && (
        <div style={{ padding: "10px", background: "var(--danger-soft)", border: "1px solid var(--danger)", borderRadius: "6px", color: "var(--danger-text)" }} role="alert" data-testid="editor-error">
          {error}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
        {onCancel && (
          <button type="button" style={buttonStyle} onClick={onCancel} data-testid="editor-cancel">
            Cancel
          </button>
        )}
        <button type="button" style={primaryButtonStyle} disabled={saving} onClick={handleSave} data-testid="editor-save">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
