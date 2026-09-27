"use client";

// Per-standard accordion (EPIC-008 SPEC.md §3.2, T-0147).
// Shows the standard name/help, a multi-select of actions Report / Alert (warn)
// / Remediate, and an autoRemediate switch (US-2, US-3). Zero colour literals.

import React, { type CSSProperties, type ReactElement } from "react";
import type { StandardTemplateActions } from "../../lib/standardsApi";

export interface AccordionStandard {
  readonly key: string;
  readonly check: string;
  readonly name: string;
  readonly help?: string;
  readonly category?: string;
  readonly licenseState?: string | null;
}

export interface StandardAccordionProps {
  readonly standard: AccordionStandard;
  readonly actions: StandardTemplateActions;
  readonly autoRemediate: boolean;
  readonly expanded?: boolean;
  readonly onToggle?: () => void;
  readonly onChange?: (next: { actions: StandardTemplateActions; autoRemediate: boolean }) => void;
  readonly onRemove?: () => void;
}

const rootStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  background: "var(--bg-elev)",
  overflow: "hidden",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
  padding: "12px 16px",
  background: "var(--surface)",
  cursor: "pointer",
};

const bodyStyle: CSSProperties = {
  padding: "16px",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  borderTop: "1px solid var(--border)",
};

const helpStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--text-soft)",
  margin: 0,
};

const actionRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "16px",
  alignItems: "center",
};

const labelStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  fontSize: "14px",
};

const badgeBaseStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 600,
};

const buttonStyle: CSSProperties = {
  padding: "4px 8px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "4px",
  color: "var(--text)",
  fontSize: "12px",
  cursor: "pointer",
};

function licenseBadgeStyle(state: string): CSSProperties {
  if (state === "license-missing") {
    return { ...badgeBaseStyle, background: "var(--warning-soft)", color: "var(--warning-text)", border: "1px solid var(--warning)" };
  }
  if (state === "unknown-license") {
    return { ...badgeBaseStyle, background: "var(--surface)", color: "var(--text-soft)", border: "1px solid var(--border)" };
  }
  return { ...badgeBaseStyle, background: "var(--success-soft)", color: "var(--success-text)", border: "1px solid var(--success)" };
}

export const DEFAULT_ACTIONS: StandardTemplateActions = { report: true, alert: true, remediate: false };

export function StandardAccordion({
  standard,
  actions,
  autoRemediate,
  expanded = false,
  onToggle,
  onChange,
  onRemove,
}: StandardAccordionProps): ReactElement {
  const update = (patch: Partial<StandardTemplateActions> & { autoRemediate?: boolean }): void => {
    // autoRemediate implies remediate + report (SPEC §4.2).
    const nextAuto = patch.autoRemediate ?? autoRemediate;
    const nextActions: StandardTemplateActions = {
      report: nextAuto ? true : (patch.report ?? actions.report),
      alert: patch.alert ?? actions.alert,
      remediate: nextAuto ? true : (patch.remediate ?? actions.remediate),
    };
    onChange?.({ actions: nextActions, autoRemediate: nextAuto });
  };

  return (
    <div style={rootStyle} data-testid={`accordion-${standard.key}`}>
      <div
        style={headerStyle}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        data-testid={`accordion-header-${standard.key}`}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onToggle?.();
        }}
      >
        <span>
          <strong>{standard.name}</strong>
          <span style={{ marginLeft: "8px", fontSize: "12px", color: "var(--text-soft)", fontFamily: "var(--font-mono, monospace)" }}>
            {standard.check}
          </span>
          {standard.licenseState && standard.licenseState !== "eligible" && (
            <span style={{ ...licenseBadgeStyle(standard.licenseState), marginLeft: "8px" }} data-testid={`license-${standard.key}`}>
              {standard.licenseState === "license-missing" ? "license missing" : standard.licenseState}
            </span>
          )}
        </span>
        <span style={{ display: "inline-flex", gap: "8px", alignItems: "center" }}>
          <span style={{ fontSize: "12px", color: "var(--text-soft)" }}>{expanded ? "−" : "+"}</span>
          {onRemove && (
            <button
              type="button"
              style={buttonStyle}
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              data-testid={`remove-${standard.key}`}
            >
              Remove
            </button>
          )}
        </span>
      </div>

      {expanded && (
        <div style={bodyStyle} data-testid={`accordion-body-${standard.key}`}>
          {standard.help && <p style={helpStyle}>{standard.help}</p>}

          <div style={actionRowStyle}>
            <label style={labelStyle}>
              <input
                type="checkbox"
                checked={actions.report}
                onChange={(e) => update({ report: e.target.checked })}
                data-testid={`action-report-${standard.key}`}
              />
              Report
            </label>
            <label style={labelStyle}>
              <input
                type="checkbox"
                checked={actions.alert}
                onChange={(e) => update({ alert: e.target.checked })}
                data-testid={`action-alert-${standard.key}`}
              />
              Alert (warn)
            </label>
            <label style={labelStyle}>
              <input
                type="checkbox"
                checked={actions.remediate}
                onChange={(e) => update({ remediate: e.target.checked })}
                data-testid={`action-remediate-${standard.key}`}
              />
              Remediate
            </label>
            <label style={labelStyle}>
              <input
                type="checkbox"
                checked={autoRemediate}
                onChange={(e) => update({ autoRemediate: e.target.checked })}
                data-testid={`auto-remediate-${standard.key}`}
              />
              autoRemediate
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
