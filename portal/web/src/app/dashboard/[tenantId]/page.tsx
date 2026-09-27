"use client";

// Per-tenant dashboard page (EPIC-004 SPEC.md §3.1, §3.2, §4.1, T-0066).
// Loads DashboardPayload from GET /v1/dashboard/:tenantId (BFF read model, never direct tenant calls).
// Renders EmptyState if no completed run exists, or full 2x2 identity widgets + tabs when populated.
// Strictly uses report theme tokens with zero colour literals.

import React, { useEffect, useState, use, type CSSProperties, type ReactElement } from "react";
import { DashboardGrid } from "../../../components/dashboard/DashboardGrid";
import { TenantInfoCard } from "../../../components/dashboard/TenantInfoCard";
import { TenantMetricsGrid } from "../../../components/dashboard/TenantMetricsGrid";
import { AssessmentCard } from "../../../components/dashboard/AssessmentCard";
import { AlertsOverviewCard } from "../../../components/dashboard/AlertsOverviewCard";
import { SecureScoreCard } from "../../../components/dashboard/SecureScoreCard";
import { AuthMethodCard } from "../../../components/dashboard/AuthMethodCard";
import { MFACard } from "../../../components/dashboard/MFACard";
import { LicenseCard } from "../../../components/dashboard/LicenseCard";
import { IdentityDevicesTabs } from "../../../components/dashboard/IdentityDevicesTabs";
import { EmptyState } from "../../../components/dashboard/EmptyState";

export interface TenantDashboardPageProps {
  readonly params: Promise<{ tenantId: string }> | { tenantId: string };
}

interface DashboardPayloadData {
  readonly schemaVersion: string;
  readonly tenantId: string;
  readonly tenantInfo: any;
  readonly isEmpty: boolean;
  readonly emptyState: { reason: string; message: string } | null;
  readonly score: any;
  readonly assessment: any;
  readonly metrics: any;
  readonly alerts: any;
  readonly authMethods: any;
  readonly mfa: any;
  readonly licenses: any;
  readonly identity: any;
  readonly devices: any;
  readonly generatedAt: string;
}

const pageStyle: CSSProperties = {
  padding: "32px",
  maxWidth: "1600px",
  margin: "0 auto",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
  display: "flex",
  flexDirection: "column",
  gap: "24px",
};

const backLinkStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  color: "var(--accent-text)",
  textDecoration: "none",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
};

export default function TenantDashboardPage(props: TenantDashboardPageProps): ReactElement {
  // Unwrap Next.js dynamic params
  const resolvedParams =
    typeof (props.params as Promise<{ tenantId: string }>).then === "function"
      ? use(props.params as Promise<{ tenantId: string }>)
      : (props.params as { tenantId: string });

  const tenantId = resolvedParams.tenantId;

  const [payload, setPayload] = useState<DashboardPayloadData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = async (): Promise<void> => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/v1/dashboard/${encodeURIComponent(tenantId)}`);
      if (!res.ok) {
        throw new Error(`Failed to load tenant dashboard: ${res.statusText}`);
      }
      const data: DashboardPayloadData = await res.json();
      setPayload(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDashboard();
  }, [tenantId]);

  if (loading) {
    return (
      <div style={pageStyle} data-testid="tenant-dashboard-loading">
        <a href="/dashboard" style={backLinkStyle}>
          ← Fleet Dashboard
        </a>
        <div style={{ padding: "64px 0", textAlign: "center", color: "var(--muted)" }}>
          Loading posture metrics for {tenantId}...
        </div>
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div style={pageStyle} data-testid="tenant-dashboard-error">
        <a href="/dashboard" style={backLinkStyle}>
          ← Fleet Dashboard
        </a>
        <div
          style={{
            padding: "24px",
            background: "var(--danger-soft)",
            border: "1px solid var(--danger)",
            borderRadius: "var(--radius, 8px)",
            color: "var(--danger-text)",
          }}
        >
          <strong>Error loading dashboard:</strong> {error ?? "Tenant posture not found"}
        </div>
      </div>
    );
  }

  const tenantName = payload.tenantInfo?.displayName || payload.tenantInfo?.defaultDomain || tenantId;

  return (
    <div style={pageStyle} data-testid="tenant-dashboard-page">
      {/* Top Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: "16px",
          borderBottom: "1px solid var(--border)",
          paddingBottom: "16px",
        }}
      >
        <div>
          <a href="/dashboard" style={backLinkStyle} data-testid="back-to-fleet-link">
            ← Fleet Dashboard
          </a>
          <h1
            data-testid="tenant-dashboard-name"
            style={{
              margin: "8px 0 0 0",
              fontSize: "26px",
              fontWeight: 800,
              color: "var(--text)",
              fontFamily: "var(--font-display, var(--font-sans))",
            }}
          >
            {tenantName}
          </h1>
          {payload.tenantInfo?.defaultDomain && (
            <div style={{ fontSize: "13px", color: "var(--muted)", marginTop: "2px" }}>
              {payload.tenantInfo.defaultDomain}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <a
            href={`/runs/new?tenantId=${encodeURIComponent(tenantId)}`}
            data-testid="tenant-new-run-button"
            style={{
              padding: "8px 16px",
              fontSize: "13px",
              fontWeight: 600,
              background: "var(--accent)",
              color: "var(--accent-text)",
              border: "1px solid var(--accent)",
              borderRadius: "var(--radius, 6px)",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            + Run Assessment
          </a>
        </div>
      </div>

      {/* When tenant has no completed runs, prompt empty-state run card */}
      {payload.isEmpty ? (
        <EmptyState
          tenantId={tenantId}
          message={payload.emptyState?.message}
          onRunAssessment={() => {
            window.location.href = `/runs/new?tenantId=${encodeURIComponent(tenantId)}`;
          }}
        />
      ) : (
        <IdentityDevicesTabs
          overviewContent={
            <DashboardGrid
              overviewRow={
                <>
                  <TenantInfoCard tenantInfo={payload.tenantInfo} />
                  <TenantMetricsGrid metrics={payload.metrics} />
                  <AssessmentCard assessment={payload.assessment} />
                </>
              }
              alertsRow={<AlertsOverviewCard alerts={payload.alerts} />}
              identityBlock={
                <>
                  <SecureScoreCard score={payload.score} />
                  <AuthMethodCard authMethods={payload.authMethods} />
                  <MFACard mfa={payload.mfa} />
                  <LicenseCard licenses={payload.licenses} />
                </>
              }
            />
          }
          identityContent={
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                gap: "20px",
              }}
            >
              <SecureScoreCard score={payload.score} />
              <MFACard mfa={payload.mfa} />
              <AuthMethodCard authMethods={payload.authMethods} />
              <LicenseCard licenses={payload.licenses} />
            </div>
          }
          devicesContent={
            <div
              data-testid="devices-tab-content"
              style={{
                padding: "48px 24px",
                textAlign: "center",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius, 10px)",
                color: "var(--muted)",
                fontSize: "14px",
              }}
            >
              Endpoint compliance & Defender device posture will populate upon Intune collector execution.
            </div>
          }
          customContent={
            <div
              data-testid="custom-tab-content"
              style={{
                padding: "48px 24px",
                textAlign: "center",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius, 10px)",
                color: "var(--muted)",
                fontSize: "14px",
              }}
            >
              Customizable widget canvas: drag, resize, and configure widgets.
            </div>
          }
        />
      )}
    </div>
  );
}
