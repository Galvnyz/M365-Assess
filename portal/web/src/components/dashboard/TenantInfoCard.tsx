"use client";

// TenantInfoCard widget (EPIC-004 SPEC.md §3.1, T-0064).
// Displays tenant overview facts: name, domains, source, status, and last run.
// Renders empty-state affordance if no completed assessment run exists.
// Strictly uses report theme tokens with zero colour literals.

import React, { type CSSProperties, type ReactElement } from "react";
import { WidgetCard } from "./WidgetCard";

export interface TenantInfoWidget {
  readonly tenantId: string;
  readonly displayName: string | null;
  readonly defaultDomain: string | null;
  readonly initialDomain?: string | null;
  readonly status: string;
  readonly source?: string;
  readonly lastRunAt?: string | null;
}

export interface TenantInfoCardProps {
  readonly tenantInfo?: TenantInfoWidget | null;
  readonly isEmpty?: boolean;
  readonly onDrillDown?: () => void;
  readonly onRunAssessment?: () => void;
  readonly className?: string;
  readonly style?: CSSProperties;
}

function formatTimestamp(isoString?: string | null): string {
  if (!isoString) return "Never";
  try {
    return new Date(isoString).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

export function TenantInfoCard(props: TenantInfoCardProps): ReactElement {
  const { tenantInfo, isEmpty = false, onDrillDown, onRunAssessment, className, style } = props;

  const itemStyle: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 0",
    borderBottom: "1px solid var(--border)",
    fontSize: "13px",
  };

  const labelStyle: CSSProperties = {
    color: "var(--muted)",
    fontWeight: 500,
  };

  const valueStyle: CSSProperties = {
    color: "var(--text)",
    fontWeight: 600,
    fontFamily: "var(--font-mono, monospace)",
  };

  return (
    <WidgetCard
      title="Tenant Overview"
      subtitle={tenantInfo?.displayName || tenantInfo?.tenantId || "Tenant Details"}
      isEmpty={isEmpty}
      emptyMessage="No assessment run completed for this tenant yet."
      onRunAssessment={onRunAssessment}
      onDrillDown={onDrillDown}
      drillDownLabel="Tenant settings →"
      testId="widget-tenant-info"
      className={className}
      style={style}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={itemStyle}>
          <span style={labelStyle}>Tenant Name</span>
          <span
            data-testid="tenant-info-name"
            style={{ ...valueStyle, fontFamily: "var(--font-sans, system-ui, sans-serif)" }}
          >
            {tenantInfo?.displayName || "—"}
          </span>
        </div>

        <div style={itemStyle}>
          <span style={labelStyle}>Default Domain</span>
          <span data-testid="tenant-info-domain" style={valueStyle}>
            {tenantInfo?.defaultDomain || "—"}
          </span>
        </div>

        <div style={itemStyle}>
          <span style={labelStyle}>Tenant ID</span>
          <span
            data-testid="tenant-info-id"
            style={{ ...valueStyle, fontSize: "11px", wordBreak: "break-all" }}
          >
            {tenantInfo?.tenantId || "—"}
          </span>
        </div>

        <div style={itemStyle}>
          <span style={labelStyle}>Onboarding Source</span>
          <span
            data-testid="tenant-info-source"
            style={{
              padding: "1px 6px",
              borderRadius: "999px",
              fontSize: "11px",
              fontWeight: 600,
              textTransform: "uppercase",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text-soft)",
            }}
          >
            {tenantInfo?.source || "direct"}
          </span>
        </div>

        <div style={itemStyle}>
          <span style={labelStyle}>Status</span>
          <span
            data-testid="tenant-info-status"
            style={{
              padding: "1px 6px",
              borderRadius: "999px",
              fontSize: "11px",
              fontWeight: 600,
              textTransform: "capitalize",
              background:
                tenantInfo?.status === "active" ? "var(--success-soft)" : "var(--warn-soft)",
              color:
                tenantInfo?.status === "active" ? "var(--success-text)" : "var(--warn-text)",
              border:
                tenantInfo?.status === "active" ? "1px solid var(--success)" : "1px solid var(--warn)",
            }}
          >
            {tenantInfo?.status || "active"}
          </span>
        </div>

        <div style={{ ...itemStyle, borderBottom: "none" }}>
          <span style={labelStyle}>Last Assessment</span>
          <span data-testid="tenant-info-last-run" style={valueStyle}>
            {formatTimestamp(tenantInfo?.lastRunAt)}
          </span>
        </div>
      </div>
    </WidgetCard>
  );
}
