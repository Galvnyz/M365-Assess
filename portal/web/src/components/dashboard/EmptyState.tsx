"use client";

// Empty state widget / page container (EPIC-004 SPEC.md §4.1, T-0066).
// Displays an informative empty-state prompt when a tenant has no completed assessment runs,
// with an action directing operators to initiate a run via EPIC-003 (/runs/new).
// Strictly uses report theme tokens with zero colour literals.

import React, { type CSSProperties, type ReactElement } from "react";

export interface EmptyStateProps {
  /** Optional title override */
  readonly title?: string;
  /** Optional message override */
  readonly message?: string;
  /** Tenant ID to pre-populate in new-run link */
  readonly tenantId?: string;
  /** Optional callback to trigger an assessment */
  readonly onRunAssessment?: () => void;
  /** Optional custom URL for new run action */
  readonly runButtonHref?: string;
  /** Custom class name */
  readonly className?: string;
  /** Custom style */
  readonly style?: CSSProperties;
}

export function EmptyState(props: EmptyStateProps): ReactElement {
  const {
    title = "No Completed Assessment",
    message = "No completed assessment runs exist for this tenant. Run an assessment to populate posture scores, evaluated controls, alerts, and identity telemetry.",
    tenantId,
    onRunAssessment,
    runButtonHref,
    className,
    style,
  } = props;

  const targetHref = runButtonHref ?? (tenantId ? `/runs/new?tenantId=${encodeURIComponent(tenantId)}` : "/runs/new");

  return (
    <div
      data-testid="empty-state-container"
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "64px 32px",
        background: "var(--surface)",
        border: "1px dashed var(--border)",
        borderRadius: "var(--radius, 10px)",
        boxShadow: "var(--shadow-card)",
        color: "var(--text)",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        maxWidth: "680px",
        margin: "40px auto",
        gap: "20px",
        ...style,
      }}
    >
      {/* Icon Graphic */}
      <div
        style={{
          width: "56px",
          height: "56px",
          borderRadius: "50%",
          background: "var(--accent-soft)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--accent-text)",
          fontSize: "24px",
          border: "1px solid var(--accent)",
        }}
      >
        ⚡
      </div>

      {/* Copy */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxWidth: "480px" }}>
        <h3
          data-testid="empty-state-title"
          style={{
            margin: 0,
            fontSize: "20px",
            fontWeight: 700,
            color: "var(--text)",
            fontFamily: "var(--font-display, var(--font-sans))",
          }}
        >
          {title}
        </h3>
        <p
          data-testid="empty-state-message"
          style={{
            margin: 0,
            fontSize: "14px",
            color: "var(--muted)",
            lineHeight: 1.5,
          }}
        >
          {message}
        </p>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: "12px", alignItems: "center", marginTop: "8px" }}>
        {onRunAssessment ? (
          <button
            type="button"
            data-testid="empty-state-run-button"
            onClick={onRunAssessment}
            style={{
              padding: "10px 20px",
              fontSize: "14px",
              fontWeight: 600,
              background: "var(--accent)",
              color: "var(--on-accent)",
              border: "1px solid var(--accent)",
              borderRadius: "var(--radius, 6px)",
              cursor: "pointer",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            Start Assessment →
          </button>
        ) : (
          <a
            href={targetHref}
            data-testid="empty-state-run-button"
            style={{
              padding: "10px 20px",
              fontSize: "14px",
              fontWeight: 600,
              background: "var(--accent)",
              color: "var(--on-accent)",
              border: "1px solid var(--accent)",
              borderRadius: "var(--radius, 6px)",
              cursor: "pointer",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            Start Assessment →
          </a>
        )}

        <a
          href="/runs"
          data-testid="empty-state-runs-link"
          style={{
            padding: "10px 16px",
            fontSize: "14px",
            fontWeight: 500,
            background: "transparent",
            color: "var(--text-soft)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius, 6px)",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          View Runs
        </a>
      </div>
    </div>
  );
}
