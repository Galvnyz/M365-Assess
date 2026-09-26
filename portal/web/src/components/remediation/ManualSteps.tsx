"use client";

// Manual remediation steps (EPIC-006 SPEC.md §3.1, T-0111).
// Renders the registry/doc portal path as a breadcrumb plus numbered steps, each
// a row, with a Copy steps action. Zero colour literals: report theme tokens only.

import React, { type CSSProperties, type ReactElement } from "react";

export interface ManualStepsProps {
  readonly portalPath?: string | null;
  readonly steps?: readonly string[];
  readonly notes?: string | null;
  readonly onCopy?: (text: string) => void;
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
};

const breadcrumbStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "6px",
  fontSize: "13px",
  color: "var(--text-soft)",
};

const crumbStyle: CSSProperties = {
  color: "var(--text)",
  fontWeight: 500,
};

const stepRowStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  alignItems: "flex-start",
  padding: "8px 12px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
};

const stepIndexStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: "22px",
  height: "22px",
  borderRadius: "999px",
  background: "var(--accent-soft)",
  color: "var(--accent-text)",
  fontSize: "12px",
  fontWeight: 700,
  flexShrink: 0,
};

const buttonStyle: CSSProperties = {
  alignSelf: "flex-start",
  padding: "6px 12px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "13px",
  cursor: "pointer",
};

const notesStyle: CSSProperties = {
  padding: "10px 12px",
  background: "var(--warning-soft)",
  border: "1px solid var(--warning)",
  borderRadius: "6px",
  color: "var(--warning-text)",
  fontSize: "13px",
  whiteSpace: "pre-wrap",
};

export function splitPortalPath(portalPath: string): string[] {
  return portalPath
    .split(/\s*(?:>|→)\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Renders the instruction as copyable plain text. */
export function manualStepsToText(
  portalPath: string | null | undefined,
  steps: readonly string[],
): string {
  const lines: string[] = [];
  if (portalPath) lines.push(portalPath);
  steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
  return lines.join("\n");
}

export function ManualSteps({
  portalPath = null,
  steps = [],
  notes = null,
  onCopy,
}: ManualStepsProps): ReactElement {
  const crumbs = portalPath ? splitPortalPath(portalPath) : [];

  const handleCopy = (): void => {
    const text = manualStepsToText(portalPath, steps);
    onCopy?.(text);
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
    }
  };

  return (
    <div style={containerStyle} data-testid="manual-steps">
      {crumbs.length > 0 && (
        <div style={breadcrumbStyle} data-testid="manual-breadcrumb">
          {crumbs.map((crumb, index) => (
            <React.Fragment key={`${crumb}-${index}`}>
              {index > 0 && <span aria-hidden="true">›</span>}
              <span style={crumbStyle}>{crumb}</span>
            </React.Fragment>
          ))}
        </div>
      )}

      {steps.length === 0 ? (
        <div style={{ color: "var(--text-soft)", fontSize: "13px" }} data-testid="manual-steps-empty">
          No steps defined.
        </div>
      ) : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
          {steps.map((step, index) => (
            <li key={index} style={stepRowStyle} data-testid={`manual-step-${index}`}>
              <span style={stepIndexStyle}>{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      )}

      {notes && (
        <div style={notesStyle} data-testid="manual-notes">
          {notes}
        </div>
      )}

      {steps.length > 0 && (
        <button type="button" style={buttonStyle} onClick={handleCopy} data-testid="copy-steps">
          Copy steps
        </button>
      )}
    </div>
  );
}
