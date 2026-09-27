"use client";

// All-tenants fleet view dashboard page (EPIC-004 SPEC.md §3.3, §4.1, T-0066).
// Loads FleetPayload from GET /v1/dashboard (BFF read model, never direct tenant calls)
// and renders the fleet posture overview with sorting, filtering, and click-through.
// Strictly uses report theme tokens with zero colour literals.

import React, { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import { FleetTable, type FleetPayload } from "../../components/dashboard/FleetTable";
import { TenantSelector } from "../../components/TenantSelector";

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

export default function FleetDashboardPage(): ReactElement {
  const [fleet, setFleet] = useState<FleetPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFleet = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/v1/dashboard");
      if (!res.ok) {
        throw new Error(`Failed to load fleet dashboard: ${res.statusText}`);
      }
      const data: FleetPayload = await res.json();
      setFleet(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchFleet();
  }, []);

  const handleSelectTenant = (tenantId: string | null) => {
    if (tenantId) {
      window.location.href = `/dashboard/${encodeURIComponent(tenantId)}`;
    }
  };

  const handleRunAssessment = (tenantId: string) => {
    window.location.href = `/runs/new?tenantId=${encodeURIComponent(tenantId)}`;
  };

  return (
    <div style={pageStyle} data-testid="fleet-dashboard-page">
      {/* Top Header Row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: "16px",
          borderBottom: "1px solid var(--border)",
          paddingBottom: "20px",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "12px",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--muted)",
              marginBottom: "4px",
            }}
          >
            Posture Visibility
          </div>
          <h1
            data-testid="fleet-dashboard-title"
            style={{
              margin: 0,
              fontSize: "28px",
              fontWeight: 800,
              color: "var(--text)",
              fontFamily: "var(--font-display, var(--font-sans))",
            }}
          >
            Fleet Dashboard
          </h1>
          <p style={{ margin: "6px 0 0 0", fontSize: "14px", color: "var(--muted)" }}>
            At-a-glance security posture, compliance rates, and open alerts across all tenants in scope.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          {/* Header Tenant Switcher */}
          {fleet && (
            <TenantSelector
              tenants={fleet.items.map((i) => ({
                id: i.tenantId,
                displayName: i.displayName,
                defaultDomain: i.defaultDomain,
                status: i.status,
              }))}
              selectedTenantId={null}
              onTenantChange={handleSelectTenant}
              showFleetOption={true}
              fleetOptionLabel="Fleet View (All Tenants)"
            />
          )}

          <a
            href="/runs/new"
            data-testid="fleet-new-run-button"
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
              cursor: "pointer",
            }}
          >
            + New Assessment
          </a>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div
          data-testid="fleet-loading"
          style={{
            padding: "64px 0",
            textAlign: "center",
            color: "var(--muted)",
            fontSize: "14px",
          }}
        >
          Loading fleet posture data...
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div
          data-testid="fleet-error"
          style={{
            padding: "20px 24px",
            background: "var(--danger-soft)",
            border: "1px solid var(--danger)",
            borderRadius: "var(--radius, 8px)",
            color: "var(--danger-text)",
          }}
        >
          <strong>Error loading fleet:</strong> {error}
        </div>
      )}

      {/* Fleet Table Content */}
      {!loading && !error && (
        <FleetTable
          fleet={fleet}
          onSelectTenant={(id) => handleSelectTenant(id)}
          onRunAssessment={(id) => handleRunAssessment(id)}
        />
      )}
    </div>
  );
}
