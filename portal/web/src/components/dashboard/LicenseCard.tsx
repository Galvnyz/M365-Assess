"use client";

// LicenseCard widget (EPIC-004 SPEC.md §3.1, §4.1, T-0065).
// Displays Microsoft 365 license assignments, utilization rate, and top SKU breakdown.
// Renders empty-state affordance prompting an assessment run when no data exists.
// Strictly uses report theme tokens with zero colour literals.

import React, { type CSSProperties, type ReactElement } from "react";
import { WidgetCard } from "./WidgetCard";

export interface LicenseSkuItem {
  readonly name: string;
  readonly assigned: number;
  readonly total: number;
}

export interface LicenseWidget {
  readonly topSkus: readonly LicenseSkuItem[];
  readonly totalAssigned: number;
  readonly totalPurchased: number;
}

export interface LicenseCardProps {
  readonly licenses?: LicenseWidget | null;
  readonly isEmpty?: boolean;
  readonly onDrillDown?: (skuName?: string) => void;
  readonly onRunAssessment?: () => void;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export function LicenseCard(props: LicenseCardProps): ReactElement {
  const { licenses, isEmpty = false, onDrillDown, onRunAssessment, className, style } = props;

  const totalAssigned = licenses?.totalAssigned ?? 0;
  const totalPurchased = licenses?.totalPurchased ?? 0;
  const utilizationRate =
    totalPurchased > 0 ? Math.round((totalAssigned / totalPurchased) * 100) : 0;
  const topSkus = licenses?.topSkus ?? [];

  return (
    <WidgetCard
      title="License Utilization"
      subtitle="Active assignments across SKUs"
      isEmpty={isEmpty || !licenses}
      emptyMessage="No license assignment telemetry available. Run an assessment to discover SKUs."
      onRunAssessment={onRunAssessment}
      onDrillDown={() => onDrillDown?.()}
      drillDownLabel="View licenses →"
      testId="widget-license-card"
      className={className}
      style={style}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {/* Total Assigned & Utilization Headline */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            paddingBottom: "8px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div>
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>Assigned / Purchased</div>
            <div
              data-testid="license-total-assigned"
              style={{
                fontSize: "20px",
                fontWeight: 700,
                color: "var(--text)",
                fontFamily: "var(--font-display, var(--font-sans))",
              }}
            >
              {totalAssigned} / {totalPurchased}
            </div>
          </div>

          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>Utilization</div>
            <div
              data-testid="license-utilization-rate"
              style={{
                fontSize: "20px",
                fontWeight: 700,
                color: utilizationRate > 95 ? "var(--warn)" : "var(--accent)",
                fontFamily: "var(--font-display, var(--font-sans))",
              }}
            >
              {utilizationRate}%
            </div>
          </div>
        </div>

        {/* Top SKUs List */}
        <div
          data-testid="license-sku-list"
          style={{ display: "flex", flexDirection: "column", gap: "10px" }}
        >
          {topSkus.map((sku) => {
            const skuPct = sku.total > 0 ? Math.round((sku.assigned / sku.total) * 100) : 0;
            const skuSlug = sku.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
            return (
              <div
                key={sku.name}
                data-testid={`license-sku-item-${skuSlug}`}
                onClick={() => onDrillDown?.(sku.name)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  cursor: onDrillDown ? "pointer" : "default",
                  padding: "4px 0",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "12px",
                  }}
                >
                  <span
                    style={{
                      fontWeight: 600,
                      color: "var(--text)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: "200px",
                    }}
                    title={sku.name}
                  >
                    {sku.name}
                  </span>
                  <span style={{ color: "var(--text-soft)", fontVariantNumeric: "tabular-nums" }}>
                    {sku.assigned} / {sku.total} ({skuPct}%)
                  </span>
                </div>

                {/* SKU Progress Bar */}
                <div
                  style={{
                    width: "100%",
                    height: "6px",
                    background: "var(--track)",
                    borderRadius: "999px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, Math.max(0, skuPct))}%`,
                      height: "100%",
                      background: skuPct > 95 ? "var(--warn)" : "var(--accent)",
                      borderRadius: "999px",
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </WidgetCard>
  );
}
