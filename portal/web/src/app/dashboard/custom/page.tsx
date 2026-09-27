"use client";

// Custom Dashboard Page (EPIC-004 SPEC.md §3.4, §4.3, T-0068).
// Provides custom configurable dashboard canvas where operators can add, remove,
// reorder, and resize widgets with per-user/tenant layout persistence.
// Strictly uses report theme tokens with zero colour literals.

import React, { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import { CustomDashboard } from "../../../components/dashboard/CustomDashboard";

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

export default function CustomDashboardPage(): ReactElement {
  const [tenantId, setTenantId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const tid = params.get("tenantId");
      if (tid && tid.trim().length > 0) {
        setTenantId(tid.trim());
      }
    }
  }, []);

  const backHref = tenantId ? `/dashboard/${encodeURIComponent(tenantId)}` : "/dashboard";

  return (
    <div style={pageStyle} data-testid="custom-dashboard-page">
      {/* Header */}
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
          <a href={backHref} style={backLinkStyle} data-testid="custom-back-link">
            ← {tenantId ? "Back to Tenant Dashboard" : "Back to Fleet Dashboard"}
          </a>
          <h1
            data-testid="custom-page-title"
            style={{
              margin: "8px 0 0 0",
              fontSize: "26px",
              fontWeight: 800,
              color: "var(--text)",
              fontFamily: "var(--font-display, var(--font-sans))",
            }}
          >
            Custom Dashboard Canvas
          </h1>
          <p style={{ margin: "4px 0 0 0", fontSize: "14px", color: "var(--muted)" }}>
            Customize your layout: add or remove widgets, drag/reorder, and resize columns.
          </p>
        </div>
      </div>

      {/* Custom Dashboard Canvas */}
      <CustomDashboard tenantId={tenantId} />
    </div>
  );
}
