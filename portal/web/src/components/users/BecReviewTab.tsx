"use client";

// BEC review tab (EPIC-011 SPEC.md §3.2, T-0210).
// Renders the 11-check compromise review with per-finding evidence and
// per-finding remediate actions. Automated remediations run after an explicit
// inline confirmation; manual-only findings show their recommended steps and
// expose no remediate button. Strictly uses report theme tokens with zero
// colour literals.

import React, { useState, type CSSProperties, type ReactElement } from "react";
import type { BecCheck, BecFinding } from "../../lib/offboardingApi";

export interface BecReviewTabProps {
  readonly checks?: readonly BecCheck[];
  readonly findings?: readonly BecFinding[];
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onRunCheck?: () => void;
  readonly onRemediate?: (finding: BecFinding, check: BecCheck | undefined) => void;
  readonly remediatingId?: string | null;
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
};

const checkCardStyle: CSSProperties = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  padding: "16px",
  display: "flex",
  flexDirection: "column",
  gap: "8px",
};

const buttonStyle: CSSProperties = {
  padding: "6px 12px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "13px",
  fontWeight: 500,
  cursor: "pointer",
  alignSelf: "flex-start",
};

const evidenceStyle: CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  fontSize: "12px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  padding: "8px 12px",
  overflowX: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

function stateBadgeStyle(state: BecCheck["state"]): CSSProperties {
  const tones = {
    finding: { bg: "var(--danger-soft)", text: "var(--danger-text)", border: "var(--danger)" },
    review: { bg: "var(--warning-soft)", text: "var(--warning-text)", border: "var(--warning)" },
    clear: { bg: "var(--success-soft)", text: "var(--success-text)", border: "var(--success)" },
    unknown: { bg: "var(--surface)", text: "var(--text-soft)", border: "var(--border)" },
  }[state];
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 600,
    textTransform: "capitalize",
    background: tones.bg,
    color: tones.text,
    border: `1px solid ${tones.border}`,
  };
}

export function BecReviewTab({
  checks = [],
  findings = [],
  loading = false,
  error = null,
  onRunCheck,
  onRemediate,
  remediatingId = null,
}: BecReviewTabProps): ReactElement {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const findingByCheck = new Map(findings.map((finding) => [finding.check, finding]));

  return (
    <div style={containerStyle} data-testid="bec-review-tab">
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <h3 style={{ margin: 0, fontSize: "16px" }}>Compromise remediation (BEC)</h3>
        {onRunCheck && (
          <button type="button" style={buttonStyle} onClick={onRunCheck} data-testid="bec-run-check-button">
            Run BEC check
          </button>
        )}
      </div>

      {loading && <div style={{ color: "var(--text-soft)" }}>Running the 11-check review...</div>}
      {error && (
        <div
          style={{
            padding: "12px",
            borderRadius: "6px",
            background: "var(--danger-soft)",
            border: "1px solid var(--danger)",
            color: "var(--danger-text)",
          }}
          role="alert"
        >
          {error}
        </div>
      )}

      {!loading && !error && checks.length === 0 && (
        <div style={{ color: "var(--text-soft)" }} data-testid="bec-empty-state">
          No review has run for this user yet.
        </div>
      )}

      {checks.map((check) => {
        const finding = findingByCheck.get(check.check);
        const automated = check.remediation?.automated === true && finding?.state === "open";
        return (
          <div key={check.check} style={checkCardStyle} data-testid={`bec-check-${check.check}`}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <strong style={{ fontSize: "14px" }}>{check.check}</strong>
              <span style={stateBadgeStyle(check.state)}>{check.state}</span>
              {finding && (
                <span style={{ fontSize: "12px", color: "var(--text-soft)" }}>
                  finding {finding.state}
                </span>
              )}
            </div>

            {check.evidence.length > 0 && (
              <div style={evidenceStyle} data-testid={`bec-evidence-${check.check}`}>
                {JSON.stringify(check.evidence.slice(0, 5), null, 2)}
              </div>
            )}

            {check.remediation && (
              <div style={{ fontSize: "13px", color: "var(--text-soft)" }}>
                {check.remediation.label}
              </div>
            )}

            {automated && finding && onRemediate && (
              <div>
                {confirmingId === finding.id ? (
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <span style={{ fontSize: "13px" }}>Remediate this finding?</span>
                    <button
                      type="button"
                      style={buttonStyle}
                      disabled={remediatingId === finding.id}
                      onClick={() => {
                        setConfirmingId(null);
                        onRemediate(finding, check);
                      }}
                      data-testid={`bec-confirm-remediate-${finding.id}`}
                    >
                      Confirm remediate
                    </button>
                    <button type="button" style={buttonStyle} onClick={() => setConfirmingId(null)} data-testid={`bec-cancel-remediate-${finding.id}`}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    style={buttonStyle}
                    onClick={() => setConfirmingId(finding.id)}
                    data-testid={`bec-remediate-${finding.id}`}
                  >
                    Remediate
                  </button>
                )}
              </div>
            )}

            {check.remediation && !check.remediation.automated && check.remediation.steps.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "13px", color: "var(--text-soft)" }}>
                {check.remediation.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
