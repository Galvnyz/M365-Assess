"use client";

// Reusable widget chrome component (EPIC-004 SPEC.md §3.1, §4.1, T-0064).
// Renders card header, body, drill-through affordances, and empty states.
// Strictly uses report theme tokens with zero colour literals.

import React, { type CSSProperties, type ReactElement, type ReactNode } from "react";

export interface WidgetCardProps {
  /** Widget title */
  readonly title: string;
  /** Optional subtitle or metadata */
  readonly subtitle?: string;
  /** Optional icon or badge */
  readonly icon?: ReactNode;
  /** Optional action element in header */
  readonly action?: ReactNode;
  /** Drill-down click callback */
  readonly onDrillDown?: () => void;
  /** Label for drill-down link/button (default: "View details →") */
  readonly drillDownLabel?: string;
  /** Whether the widget has no data / is in empty state */
  readonly isEmpty?: boolean;
  /** Message explaining empty state */
  readonly emptyMessage?: string;
  /** Action callback to trigger a run from empty state */
  readonly onRunAssessment?: () => void;
  /** Grid column span (1-12, default: 12) */
  readonly colSpan?: number;
  /** Card body content */
  readonly children?: ReactNode;
  /** Optional custom class name */
  readonly className?: string;
  /** Optional custom inline style */
  readonly style?: CSSProperties;
  /** Test identifier */
  readonly testId?: string;
}

export function WidgetCard(props: WidgetCardProps): ReactElement {
  const {
    title,
    subtitle,
    icon,
    action,
    onDrillDown,
    drillDownLabel = "View details →",
    isEmpty = false,
    emptyMessage = "No assessment data available. Run an assessment to populate this widget.",
    onRunAssessment,
    colSpan = 12,
    children,
    className,
    style,
    testId,
  } = props;

  const cardStyle: CSSProperties = {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius, 10px)",
    boxShadow: "var(--shadow-card)",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    padding: "20px",
    fontFamily: "var(--font-sans, system-ui, sans-serif)",
    color: "var(--text)",
    gridColumn: `span ${colSpan}`,
    position: "relative",
    ...style,
  };

  const headerStyle: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "16px",
    gap: "12px",
  };

  const titleStyle: CSSProperties = {
    fontSize: "15px",
    fontWeight: 600,
    margin: 0,
    color: "var(--text)",
    display: "flex",
    alignItems: "center",
    gap: "8px",
  };

  const subtitleStyle: CSSProperties = {
    fontSize: "12px",
    color: "var(--muted)",
    margin: "2px 0 0 0",
  };

  const drillDownStyle: CSSProperties = {
    background: "transparent",
    border: "none",
    color: "var(--accent-text)",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
    padding: "2px 6px",
    borderRadius: "var(--radius, 4px)",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
  };

  const emptyContainerStyle: CSSProperties = {
    padding: "28px 16px",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    color: "var(--muted)",
    fontSize: "13px",
  };

  const runBtnStyle: CSSProperties = {
    padding: "6px 12px",
    fontSize: "12px",
    fontWeight: 600,
    background: "var(--accent)",
    color: "var(--on-accent)",
    border: "1px solid var(--accent)",
    borderRadius: "var(--radius, 6px)",
    cursor: "pointer",
  };

  return (
    <div
      className={className}
      data-testid={testId || `widget-card-${title.toLowerCase().replace(/\s+/g, "-")}`}
      style={cardStyle}
    >
      <div>
        {/* Header */}
        <div style={headerStyle}>
          <div>
            <h3 style={titleStyle}>
              {icon}
              <span>{title}</span>
            </h3>
            {subtitle && <p style={subtitleStyle}>{subtitle}</p>}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {action}
            {onDrillDown && !isEmpty && (
              <button
                type="button"
                data-testid={`drill-down-${title.toLowerCase().replace(/\s+/g, "-")}`}
                onClick={onDrillDown}
                style={drillDownStyle}
              >
                {drillDownLabel}
              </button>
            )}
          </div>
        </div>

        {/* Content or Empty State */}
        {isEmpty ? (
          <div data-testid="widget-card-empty-state" style={emptyContainerStyle}>
            <div>{emptyMessage}</div>
            {onRunAssessment && (
              <button
                type="button"
                data-testid="widget-run-assessment-button"
                onClick={onRunAssessment}
                style={runBtnStyle}
              >
                Run Assessment
              </button>
            )}
          </div>
        ) : (
          <div>{children}</div>
        )}
      </div>
    </div>
  );
}
