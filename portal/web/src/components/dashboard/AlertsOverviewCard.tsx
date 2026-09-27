"use client";

// AlertsOverviewCard widget (EPIC-004 SPEC.md §3.1, T-0064).
// Full-width card displaying open security alerts by severity (Critical, High, Medium, Low).
// Supports drill-down into findings by severity.
// Strictly uses report theme tokens with zero colour literals.

import React, { type CSSProperties, type ReactElement } from "react";
import { WidgetCard } from "./WidgetCard";

export interface AlertsOverviewWidget {
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
  readonly total: number;
}

export interface AlertsOverviewCardProps {
  readonly alerts?: AlertsOverviewWidget | null;
  readonly isEmpty?: boolean;
  readonly onDrillDown?: (severity?: string) => void;
  readonly onRunAssessment?: () => void;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export function AlertsOverviewCard(props: AlertsOverviewCardProps): ReactElement {
  const { alerts, isEmpty = false, onDrillDown, onRunAssessment, className, style } = props;

  const critical = alerts?.critical ?? 0;
  const high = alerts?.high ?? 0;
  const medium = alerts?.medium ?? 0;
  const low = alerts?.low ?? 0;
  const total = alerts?.total ?? (critical + high + medium + low);

  const getPercentage = (count: number): number => {
    return total > 0 ? (count / total) * 100 : 0;
  };

  const severityCardStyle = (bg: string, border: string, color: string): CSSProperties => ({
    background: bg,
    border: `1px solid ${border}`,
    borderRadius: "var(--radius, 8px)",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    cursor: onDrillDown ? "pointer" : "default",
  });

  return (
    <WidgetCard
      title="Alerts Overview"
      subtitle={`${total} open security alert${total === 1 ? "" : "s"} requiring attention`}
      isEmpty={isEmpty || !alerts}
      emptyMessage="No open security alerts or assessment data for this tenant."
      onRunAssessment={onRunAssessment}
      onDrillDown={() => onDrillDown?.()}
      drillDownLabel="All alerts →"
      colSpan={12}
      testId="widget-alerts-overview"
      className={className}
      style={style}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* Severity distribution bar */}
        {total > 0 && (
          <div
            data-testid="alerts-distribution-bar"
            style={{
              display: "flex",
              height: "10px",
              borderRadius: "999px",
              overflow: "hidden",
              background: "var(--track)",
              width: "100%",
            }}
          >
            {critical > 0 && (
              <div
                title={`Critical: ${critical}`}
                style={{
                  width: `${getPercentage(critical)}%`,
                  background: "var(--danger)",
                }}
              />
            )}
            {high > 0 && (
              <div
                title={`High: ${high}`}
                style={{
                  width: `${getPercentage(high)}%`,
                  background: "var(--danger-soft)",
                }}
              />
            )}
            {medium > 0 && (
              <div
                title={`Medium: ${medium}`}
                style={{
                  width: `${getPercentage(medium)}%`,
                  background: "var(--warn)",
                }}
              />
            )}
            {low > 0 && (
              <div
                title={`Low: ${low}`}
                style={{
                  width: `${getPercentage(low)}%`,
                  background: "var(--accent)",
                }}
              />
            )}
          </div>
        )}

        {/* Severity Count Cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: "12px",
          }}
        >
          {/* Critical */}
          <div
            data-testid="alert-count-critical"
            onClick={() => onDrillDown?.("critical")}
            style={severityCardStyle("var(--danger-soft)", "var(--danger)", "var(--danger-text)")}
          >
            <div style={{ fontSize: "28px", fontWeight: 800, color: "var(--danger-text)" }}>
              {critical}
            </div>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--danger-text)" }}>
              Critical
            </div>
          </div>

          {/* High */}
          <div
            data-testid="alert-count-high"
            onClick={() => onDrillDown?.("high")}
            style={severityCardStyle("var(--surface)", "var(--danger)", "var(--text)")}
          >
            <div style={{ fontSize: "28px", fontWeight: 800, color: "var(--text)" }}>{high}</div>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-soft)" }}>High</div>
          </div>

          {/* Medium */}
          <div
            data-testid="alert-count-medium"
            onClick={() => onDrillDown?.("medium")}
            style={severityCardStyle("var(--warn-soft)", "var(--warn)", "var(--warn-text)")}
          >
            <div style={{ fontSize: "28px", fontWeight: 800, color: "var(--warn-text)" }}>
              {medium}
            </div>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--warn-text)" }}>Medium</div>
          </div>

          {/* Low */}
          <div
            data-testid="alert-count-low"
            onClick={() => onDrillDown?.("low")}
            style={severityCardStyle("var(--surface)", "var(--border)", "var(--muted)")}
          >
            <div style={{ fontSize: "28px", fontWeight: 800, color: "var(--muted)" }}>{low}</div>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)" }}>Low</div>
          </div>
        </div>
      </div>
    </WidgetCard>
  );
}
