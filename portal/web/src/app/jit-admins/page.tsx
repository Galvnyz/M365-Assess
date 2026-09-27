"use client";

// JIT Admins page (EPIC-013 SPEC.md §3.4; T-0249).
// Page title: JIT Admins.
// Tabs: JIT Grants / JIT Admin Templates. Also provides schedule request dialog.
// Strictly uses report theme tokens with zero colour literals.

import React, { useState, type CSSProperties, type ReactElement } from "react";
import { JitGrantsTable } from "../../components/roles/JitGrantsTable";
import { JitTemplatesTab } from "../../components/roles/JitTemplatesTab";
import { ScheduleRequestDialog } from "../../components/roles/ScheduleRequestDialog";
import { RequireTenant } from "../../components/shell/RequireTenant";
import { useCurrentTenantId } from "../../lib/useCurrentTenant";

type TabId = "grants" | "templates";

const pageStyle: CSSProperties = {
  padding: "32px",
  maxWidth: "1400px",
  margin: "0 auto",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
  display: "flex",
  flexDirection: "column",
  gap: "24px",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  borderBottom: "1px solid var(--border)",
  paddingBottom: "16px",
  flexWrap: "wrap",
  gap: "16px",
};

const titleStyle: CSSProperties = {
  fontSize: "24px",
  fontWeight: 700,
  margin: 0,
  fontFamily: "var(--font-display, var(--font-sans))",
};

const subtitleStyle: CSSProperties = {
  margin: "4px 0 0",
  color: "var(--muted)",
  fontSize: "14px",
};

const tabsBarStyle: CSSProperties = {
  display: "flex",
  borderBottom: "1px solid var(--border)",
  gap: "8px",
};

function getTabButtonStyle(active: boolean): CSSProperties {
  return {
    padding: "10px 18px",
    cursor: "pointer",
    background: "transparent",
    border: "none",
    borderBottom: active ? "2px solid var(--primary, var(--accent))" : "2px solid transparent",
    color: active ? "var(--text)" : "var(--muted)",
    fontWeight: active ? 600 : 400,
    fontSize: "14px",
  };
}

export default function JitAdminsPage(): ReactElement {
  const activeTenant = useCurrentTenantId() ?? "";
  const [activeTab, setActiveTab] = useState<TabId>("grants");
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);

  return (
    <main style={pageStyle} data-testid="jit-admins-page">
      <header style={headerStyle}>
        <div>
          <h1 style={titleStyle}>JIT Admins</h1>
          <p style={subtitleStyle}>
            Just-in-Time privileged access grants, JIT role templates, and schedule requests.
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setShowScheduleDialog(true)}
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              background: "var(--primary, var(--surface))",
              color: "var(--text)",
              fontWeight: 600,
              fontSize: "14px",
              cursor: "pointer",
            }}
            data-testid="btn-open-schedule-request"
          >
            + Request Activation
          </button>

        </div>
      </header>

      <nav style={tabsBarStyle} aria-label="JIT navigation">
        <button
          type="button"
          data-testid="tab-jit-grants"
          style={getTabButtonStyle(activeTab === "grants")}
          onClick={() => setActiveTab("grants")}
        >
          JIT Grants
        </button>
        <button
          type="button"
          data-testid="tab-jit-templates"
          style={getTabButtonStyle(activeTab === "templates")}
          onClick={() => setActiveTab("templates")}
        >
          JIT Admin Templates
        </button>
      </nav>

      <section style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {activeTab === "grants" && (
          <RequireTenant tenantId={activeTenant}>
            <JitGrantsTable tenantId={activeTenant} />
          </RequireTenant>
        )}
        {activeTab === "templates" && <JitTemplatesTab />}
      </section>

      {showScheduleDialog && activeTenant && (
        <ScheduleRequestDialog
          tenantId={activeTenant}
          onClose={() => setShowScheduleDialog(false)}
        />
      )}
    </main>
  );
}
