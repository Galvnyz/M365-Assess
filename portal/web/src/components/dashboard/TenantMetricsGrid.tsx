"use client";

// TenantMetricsGrid widget (EPIC-004 SPEC.md §3.1, T-0064).
// Displays 2x3 metrics grid for tenant posture and check counts.
// Renders empty-state affordance if no completed assessment run exists.
// Strictly uses report theme tokens with zero colour literals.

import React, { type CSSProperties, type ReactElement } from "react";
import { WidgetCard } from "./WidgetCard";

export interface TenantMetricItem {
  readonly id: string;
  readonly label: string;
  readonly value: number | string;
  readonly status?: "pass" | "fail" | "warn" | "neutral" | string;
}

export interface TenantMetricsGridWidget {
  readonly metrics: readonly TenantMetricItem[];
}

export interface TenantMetricsGridProps {
  readonly metrics?: TenantMetricsGridWidget | null;
  readonly isEmpty?: boolean;
  readonly onDrillDown?: (metricId?: string) => void;
  readonly onRunAssessment?: () => void;
  readonly className?: string;
  readonly style?: CSSProperties;
}

const DEFAULT_METRICS: readonly TenantMetricItem[] = [
  { id: "score", label: "Security Score", value: "—", status: "neutral" },
  { id: "evaluated", label: "Evaluated Checks", value: "—", status: "neutral" },
  { id: "passed", label: "Passed Checks", value: "—", status: "pass" },
  { id: "failed", label: "Failed Checks", value: "—", status: "fail" },
  { id: "critical-high", label: "Critical/High Alerts", value: "—", status: "fail" },
  { id: "warnings", label: "Warnings & Review", value: "—", status: "warn" },
];

export function TenantMetricsGrid(props: TenantMetricsGridProps): ReactElement {
  const { metrics, isEmpty = false, onDrillDown, onRunAssessment, className, style } = props;

  const items = metrics?.metrics && metrics.metrics.length > 0 ? metrics.metrics : DEFAULT_METRICS;

  const gridStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gridTemplateRows: "repeat(2, auto)",
    gap: "10px",
  };

  const getMetricItemStyle = (status?: string): CSSProperties => {
    let bg = "var(--surface)";
    let border = "var(--border)";
    let color = "var(--text)";

    if (status === "pass") {
      bg = "var(--success-soft)";
      border = "var(--success)";
      color = "var(--success-text)";
    } else if (status === "fail") {
      bg = "var(--danger-soft)";
      border = "var(--danger)";
      color = "var(--danger-text)";
    } else if (status === "warn") {
      bg = "var(--warn-soft)";
      border = "var(--warn)";
      color = "var(--warn-text)";
    }

    return {
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: "var(--radius, 8px)",
      padding: "12px 10px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      cursor: onDrillDown ? "pointer" : "default",
      transition: "transform 0.1s ease",
    };
  };

  return (
    <WidgetCard
      title="Key Metrics"
      subtitle="Posture summary across 6 dimensions"
      isEmpty={isEmpty}
      emptyMessage="No assessment metrics available yet."
      onRunAssessment={onRunAssessment}
      onDrillDown={() => onDrillDown?.()}
      drillDownLabel="All findings →"
      testId="widget-tenant-metrics"
      className={className}
      style={style}
    >
      <div data-testid="tenant-metrics-grid" style={gridStyle}>
        {items.map((m) => (
          <div
            key={m.id}
            data-testid={`metric-item-${m.id}`}
            onClick={() => onDrillDown?.(m.id)}
            style={getMetricItemStyle(m.status)}
          >
            <div
              data-testid={`metric-value-${m.id}`}
              style={{
                fontSize: "20px",
                fontWeight: 700,
                lineHeight: 1.2,
                color: "var(--text)",
              }}
            >
              {m.value}
            </div>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 600,
                color: "var(--muted)",
                marginTop: "4px",
              }}
            >
              {m.label}
            </div>
          </div>
        ))}
      </div>
    </WidgetCard>
  );
}
