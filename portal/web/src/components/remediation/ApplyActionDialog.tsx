"use client";

// Apply confirmation dialog (EPIC-006 SPEC.md §3.3, T-0113).
// Lists the selected checkIds and target tenants, requires a reason, defaults
// dry-run on, shows a second count confirmation for batch applies, and renders
// per-action results inline with a View audit link.
// Zero colour literals: report theme tokens only.

import React, { useMemo, useState, type CSSProperties, type ReactElement } from "react";
import {
  applyRemediationPlan,
  type RemediationActionItem,
} from "../../lib/remediationApi";
import { statusBadgeStyle } from "./RemediationPlanTable";

export interface ApplyActionDialogProps {
  readonly planId: string;
  readonly tenantId: string;
  readonly actions: readonly RemediationActionItem[];
  readonly onClose?: () => void;
  readonly onApplied?: (result: { planId: string; jobId: string; dryRun: boolean; status: string }) => void;
  readonly fetcher?: typeof fetch;
  /** Injected for deterministic tests; defaults to crypto.randomUUID. */
  readonly idempotencyKeyFactory?: () => string;
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--overlay, rgba(0,0,0,0.5))",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px",
  zIndex: 50,
};

const dialogStyle: CSSProperties = {
  width: "100%",
  maxWidth: "640px",
  maxHeight: "85vh",
  overflowY: "auto",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  boxShadow: "var(--shadow-card)",
  padding: "20px",
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
};

const listStyle: CSSProperties = {
  margin: 0,
  padding: "8px 12px",
  listStyle: "none",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  fontFamily: "var(--font-mono, monospace)",
  fontSize: "13px",
  maxHeight: "160px",
  overflowY: "auto",
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

const dangerButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "var(--danger)",
  color: "var(--danger-text, var(--text))",
  borderColor: "var(--danger)",
};

const disabledButtonStyle: CSSProperties = {
  ...primaryButtonStyle,
  opacity: 0.4,
  cursor: "not-allowed",
};

function defaultKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `apply-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ApplyActionDialog({
  planId,
  tenantId,
  actions,
  onClose,
  onApplied,
  fetcher,
  idempotencyKeyFactory,
}: ApplyActionDialogProps): ReactElement {
  const [step, setStep] = useState<"confirm" | "batch" | "done">("confirm");
  const [reason, setReason] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<
    ReadonlyArray<{ id: string; check: string; state: string }>
  >([]);

  const isBatch = actions.length > 1;
  const canConfirm = reason.trim().length > 0 && !submitting;

  const tenants = useMemo(() => {
    const set = new Set<string>();
    if (tenantId) set.add(tenantId);
    return [...set];
  }, [tenantId]);

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const key = (idempotencyKeyFactory ?? defaultKey)();
      const result = await applyRemediationPlan(
        planId,
        { dryRun, reason: reason.trim(), actionIds: actions.map((a) => a.id), idempotencyKey: key },
        fetcher,
      );
      setResults(actions.map((a) => ({ id: a.id, check: a.check, state: dryRun ? "dryrun" : "queued" })));
      setStep("done");
      onApplied?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handlePrimary = (): void => {
    if (isBatch && step === "confirm") {
      setStep("batch");
      return;
    }
    void submit();
  };

  return (
    <div style={overlayStyle} data-testid="apply-action-dialog">
      <div style={dialogStyle} role="dialog" aria-modal="true" aria-label="Apply remediation actions">
        <div style={rowStyle}>
          <h2 style={{ margin: 0, fontSize: "18px" }}>Apply remediation actions</h2>
          <button type="button" style={buttonStyle} onClick={onClose} data-testid="apply-dialog-close">
            Close
          </button>
        </div>

        <div>
          <div style={{ fontSize: "12px", color: "var(--text-soft)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Selected checks ({actions.length})
          </div>
          <ul style={listStyle} data-testid="apply-selected-checks">
            {actions.map((action) => (
              <li key={action.id} data-testid={`apply-check-${action.id}`}>
                {action.check} · {action.mode} · {action.state}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div style={{ fontSize: "12px", color: "var(--text-soft)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Target tenants
          </div>
          <div data-testid="apply-target-tenants">{tenants.join(", ")}</div>
        </div>

        {step === "batch" && (
          <div
            style={{ padding: "12px", background: "var(--warning-soft)", border: "1px solid var(--warning)", borderRadius: "6px", color: "var(--warning-text)" }}
            data-testid="batch-confirmation"
          >
            Batch apply: {actions.length} actions will run. Confirm to continue.
          </div>
        )}

        {step === "done" ? (
          <div data-testid="apply-results">
            <div style={{ fontSize: "12px", color: "var(--text-soft)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>
              Results
            </div>
            {results.map((result) => (
              <div key={result.id} style={{ ...rowStyle, padding: "6px 0" }} data-testid={`apply-result-${result.id}`}>
                <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "13px" }}>{result.check}</span>
                <span style={{ display: "inline-flex", gap: "10px", alignItems: "center" }}>
                  <span className="status-badge" style={statusBadgeStyle(result.state)}>
                    {result.state}
                  </span>
                  <a
                    href={`/remediation/history?check=${encodeURIComponent(result.check)}`}
                    style={{ fontSize: "12px", color: "var(--accent)" }}
                    data-testid={`view-audit-${result.id}`}
                  >
                    View audit
                  </a>
                </span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "12px" }}>
              <button type="button" style={primaryButtonStyle} onClick={onClose} data-testid="apply-done-close">
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={{ fontSize: "14px", fontWeight: 600 }}>Reason (required)</span>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this being applied?"
                style={{ padding: "8px 12px", background: "var(--input-bg, var(--bg))", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text)", fontSize: "14px" }}
                data-testid="apply-reason"
              />
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px" }}>
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                data-testid="apply-dry-run"
              />
              Dry run (no tenant writes)
            </label>

            {error && (
              <div style={{ padding: "10px", background: "var(--danger-soft)", border: "1px solid var(--danger)", borderRadius: "6px", color: "var(--danger-text)" }} role="alert" data-testid="apply-error">
                {error}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button type="button" style={buttonStyle} onClick={onClose} data-testid="apply-cancel">
                Cancel
              </button>
              <button
                type="button"
                style={canConfirm ? dangerButtonStyle : disabledButtonStyle}
                disabled={!canConfirm}
                onClick={handlePrimary}
                data-testid="apply-confirm"
              >
                {step === "batch" ? `Confirm batch (${actions.length})` : dryRun ? "Run dry run" : "Apply"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
