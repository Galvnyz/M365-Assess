"use client";

// Finding remediation panel (EPIC-006 SPEC.md §3.1, T-0111).
// Tabbed block for the finding detail drawer:
//   - Automated: desired state, exact command (mono), precondition chips, Copy plan.
//   - Manual: registry/doc portal path breadcrumb + numbered steps, Copy steps.
//   - undetermined: triage empty state.
// Self-contained: mount it in EPIC-004's finding drawer when that lands.
// Zero colour literals: report theme tokens only.

import React, { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react";
import {
  fetchRemediationInstruction,
  type RemediationActionItem,
  type RemediationInstruction,
} from "../../lib/remediationApi";
import { ManualSteps } from "./ManualSteps";

export interface RemediationPrecondition {
  readonly label: string;
  readonly state: "met" | "unmet" | "unknown";
}

export interface FindingRemediationPanelProps {
  readonly check: string;
  readonly action?: RemediationActionItem | null;
  /** Pre-fetched instruction; when omitted the panel fetches it. */
  readonly instruction?: RemediationInstruction | null;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly fetcher?: typeof fetch;
  readonly onCopyPlan?: (text: string) => void;
  readonly onCopySteps?: (text: string) => void;
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
};

const tabBarStyle: CSSProperties = {
  display: "flex",
  gap: "4px",
  borderBottom: "1px solid var(--border)",
};

const tabStyle = (active: boolean): CSSProperties => ({
  padding: "8px 14px",
  background: "transparent",
  border: "none",
  borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
  color: active ? "var(--accent)" : "var(--text-soft)",
  fontWeight: 600,
  fontSize: "14px",
  cursor: "pointer",
});

const fieldLabelStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--text-soft)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const codeBlockStyle: CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  fontSize: "13px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  padding: "10px",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  margin: 0,
};

const badgeStyle = (state: RemediationPrecondition["state"]): CSSProperties => {
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 600,
  };
  if (state === "met") {
    return { ...base, background: "var(--success-soft)", color: "var(--success-text)", border: "1px solid var(--success)" };
  }
  if (state === "unmet") {
    return { ...base, background: "var(--danger-soft)", color: "var(--danger-text)", border: "1px solid var(--danger)" };
  }
  return { ...base, background: "var(--surface)", color: "var(--text-soft)", border: "1px solid var(--border)" };
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

const emptyStateStyle: CSSProperties = {
  padding: "24px 16px",
  textAlign: "center",
  background: "var(--surface)",
  border: "1px dashed var(--border)",
  borderRadius: "var(--radius, 10px)",
  color: "var(--text-soft)",
};

/** Derives the four gate preconditions from an action's gate result. */
export function derivePreconditions(action?: RemediationActionItem | null): RemediationPrecondition[] {
  const gateReason =
    action && action.result && typeof action.result["gateReason"] === "string"
      ? (action.result["gateReason"] as string)
      : "";
  const classify = (reason: string): RemediationPrecondition["state"] =>
    gateReason === reason ? "unmet" : "unknown";
  return [
    { label: `License${action?.license ? ` ${action.license}` : ""}`, state: action?.license ? "met" : classify("license-missing") },
    { label: "Service", state: classify("service-unavailable") },
    { label: "RBAC", state: classify("rbac-denied") },
    { label: "Allowlist", state: classify("not-allowlisted") },
  ];
}

/** Renders the automated action as copyable plain text. */
export function automatedPlanToText(action?: RemediationActionItem | null): string {
  if (!action) return "";
  const lines = [`${action.check} (${action.mode})`];
  if (action.command) lines.push(action.command);
  return lines.join("\n");
}

export function FindingRemediationPanel({
  check,
  action = null,
  instruction,
  loading = false,
  error = null,
  fetcher,
  onCopyPlan,
  onCopySteps,
}: FindingRemediationPanelProps): ReactElement {
  const undetermined = action?.classification === "undetermined";
  const [tab, setTab] = useState<"auto" | "manual">(
    action?.mode === "manual" || undetermined ? "manual" : "auto",
  );
  const [fetchedInstruction, setFetchedInstruction] = useState<RemediationInstruction | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (instruction !== undefined) return;
    let active = true;
    void (async () => {
      try {
        const result = await fetchRemediationInstruction(check, fetcher);
        if (active) setFetchedInstruction(result);
      } catch (err) {
        if (active) setFetchError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      active = false;
    };
  }, [check, instruction, fetcher]);

  const resolvedInstruction = instruction ?? fetchedInstruction;
  const preconditions = useMemo(() => derivePreconditions(action), [action]);
  const effectiveError = error ?? fetchError;

  const handleCopyPlan = (): void => {
    const text = automatedPlanToText(action);
    onCopyPlan?.(text);
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
    }
  };

  return (
    <div style={containerStyle} data-testid="finding-remediation-panel">
      <div style={tabBarStyle} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "auto"}
          style={tabStyle(tab === "auto")}
          onClick={() => setTab("auto")}
          data-testid="tab-automated"
        >
          Automated
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "manual"}
          style={tabStyle(tab === "manual")}
          onClick={() => setTab("manual")}
          data-testid="tab-manual"
        >
          Manual
        </button>
      </div>

      {loading && (
        <div style={{ padding: "16px", color: "var(--text-soft)" }}>Loading remediation...</div>
      )}

      {effectiveError && (
        <div style={{ padding: "12px", background: "var(--danger-soft)", border: "1px solid var(--danger)", borderRadius: "6px", color: "var(--danger-text)" }} role="alert">
          {effectiveError}
        </div>
      )}

      {!loading && undetermined && (
        <div style={emptyStateStyle} data-testid="remediation-empty-state">
          No remediation defined — triage required.
        </div>
      )}

      {!loading && !undetermined && tab === "auto" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }} data-testid="automated-tab">
          <div>
            <div style={fieldLabelStyle}>Desired state</div>
            <div>{action?.finding ?? "Apply the validated remediation for this check."}</div>
          </div>
          <div>
            <div style={fieldLabelStyle}>Command</div>
            <pre style={codeBlockStyle} data-testid="automated-command">
              {action?.command || "—"}
            </pre>
          </div>
          <div>
            <div style={fieldLabelStyle}>Preconditions</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "4px" }}>
              {preconditions.map((precondition) => (
                <span
                  key={precondition.label}
                  className="status-badge"
                  style={badgeStyle(precondition.state)}
                  data-testid={`precondition-${precondition.label.split(" ")[0]?.toLowerCase()}`}
                >
                  {precondition.label}
                </span>
              ))}
            </div>
          </div>
          <button type="button" style={buttonStyle} onClick={handleCopyPlan} data-testid="copy-plan">
            Copy plan
          </button>
        </div>
      )}

      {!loading && !undetermined && tab === "manual" && (
        <div data-testid="manual-tab">
          <ManualSteps
            portalPath={resolvedInstruction?.portalPath ?? action?.target ?? null}
            steps={resolvedInstruction?.steps ?? []}
            notes={resolvedInstruction?.notes ?? null}
            onCopy={onCopySteps}
          />
        </div>
      )}
    </div>
  );
}
