"use client";

// Script versions drawer (EPIC-007 SPEC.md §3.3, §5; T-0130).
// Lists a script's immutable versions and lets an operator view a past version
// read-only. There is deliberately no edit affordance: versions are append-only
// (T-0125). Zero colour literals: report theme tokens only.

import React, { type CSSProperties, type ReactElement } from "react";

export interface ScriptVersionItem {
  readonly id: string;
  readonly scriptId?: string;
  readonly content: string;
  readonly markdownTemplate?: string | null;
  readonly parameters?: Record<string, unknown> | null;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface ScriptVersionsDrawerProps {
  readonly versions?: readonly ScriptVersionItem[];
  readonly selectedVersionId?: string | null;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onSelect?: (version: ScriptVersionItem) => void;
  readonly onClose?: () => void;
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--overlay, rgba(0,0,0,0.5))",
  display: "flex",
  justifyContent: "flex-end",
  zIndex: 50,
};

const drawerStyle: CSSProperties = {
  width: "100%",
  maxWidth: "560px",
  height: "100%",
  overflowY: "auto",
  background: "var(--bg-elev)",
  borderLeft: "1px solid var(--border)",
  padding: "20px",
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
};

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  margin: 0,
  padding: 0,
  listStyle: "none",
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

const versionRowStyle = (selected: boolean): CSSProperties => ({
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  width: "100%",
  textAlign: "left",
  padding: "10px 12px",
  background: selected ? "var(--accent-soft)" : "var(--surface)",
  border: selected ? "1px solid var(--accent)" : "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  cursor: "pointer",
});

const monoStyle: CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  fontSize: "12px",
};

const codeBlockStyle: CSSProperties = {
  ...monoStyle,
  margin: 0,
  padding: "10px 12px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: "260px",
  overflowY: "auto",
};

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function ScriptVersionsDrawer({
  versions = [],
  selectedVersionId = null,
  loading = false,
  error = null,
  onSelect,
  onClose,
}: ScriptVersionsDrawerProps): ReactElement {
  const selected = versions.find((version) => version.id === selectedVersionId) ?? null;

  return (
    <div style={overlayStyle} data-testid="script-versions-drawer">
      <div style={drawerStyle} role="dialog" aria-modal="true" aria-label="Script versions">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: "16px" }}>Versions</h2>
          <button type="button" style={buttonStyle} onClick={onClose} data-testid="versions-close">
            Close
          </button>
        </div>

        <p style={{ margin: 0, fontSize: "13px", color: "var(--text-soft)" }}>
          Versions are append-only. A past version can be viewed but not edited.
        </p>

        {loading && <div style={{ color: "var(--text-soft)" }}>Loading versions...</div>}
        {error && (
          <div style={{ padding: "10px", background: "var(--danger-soft)", border: "1px solid var(--danger)", borderRadius: "6px", color: "var(--danger-text)" }} role="alert">
            {error}
          </div>
        )}

        {!loading && !error && (
          <ul style={listStyle}>
            {versions.length === 0 && (
              <li style={{ color: "var(--text-soft)" }} data-testid="empty-versions">
                No versions yet.
              </li>
            )}
            {versions.map((version, index) => (
              <li key={version.id}>
                <button
                  type="button"
                  style={versionRowStyle(version.id === selectedVersionId)}
                  onClick={() => onSelect?.(version)}
                  data-testid={`version-${version.id}`}
                >
                  <span style={{ fontWeight: 600 }}>
                    v{versions.length - index} · <span style={monoStyle}>{version.id}</span>
                  </span>
                  <span style={{ fontSize: "12px", color: "var(--text-soft)" }}>
                    {formatDateTime(version.createdAt)} · {version.createdBy}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {selected && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }} data-testid="version-viewer">
            <div style={{ fontSize: "12px", color: "var(--text-soft)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Viewing {selected.id} (read-only)
            </div>
            <pre style={codeBlockStyle} data-testid="version-content">
              {selected.content}
            </pre>
            {selected.markdownTemplate ? (
              <pre style={codeBlockStyle} data-testid="version-template">
                {selected.markdownTemplate}
              </pre>
            ) : null}
            {/* No edit control by design: versions are immutable. */}
          </div>
        )}
      </div>
    </div>
  );
}
