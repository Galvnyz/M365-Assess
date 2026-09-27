"use client";

// Roles & Assignments page (EPIC-013 SPEC.md §3.1, §3.2; T-0248).
// Page title: Roles & Assignments.
// Tabs: Assignments / PIM / Templates.
// Strictly uses report theme tokens with zero colour literals.

import React, { useState, type CSSProperties, type ReactElement } from "react";
import { RolesAssignmentsTable } from "../../components/roles/RolesAssignmentsTable";
import { PimSettingsTemplatesTab } from "../../components/roles/PimSettingsTemplatesTab";
import { RequireTenant } from "../../components/shell/RequireTenant";
import { useCurrentTenantId } from "../../lib/useCurrentTenant";

type TabId = "assignments" | "pim" | "templates";

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

export default function RolesPage(): ReactElement {
  const activeTenant = useCurrentTenantId() ?? "";
  const [activeTab, setActiveTab] = useState<TabId>("assignments");

  return (
    <main style={pageStyle} data-testid="roles-page">
      <header style={headerStyle}>
        <div>
          <h1 style={titleStyle}>Roles &amp; Assignments</h1>
          <p style={subtitleStyle}>
            Directory role assignments, Privileged Identity Management (PIM), and role settings templates.
          </p>
        </div>

      </header>

      <nav style={tabsBarStyle} aria-label="Role sections">
        <button
          type="button"
          data-testid="tab-assignments"
          style={getTabButtonStyle(activeTab === "assignments")}
          onClick={() => setActiveTab("assignments")}
        >
          Assignments
        </button>
        <button
          type="button"
          data-testid="tab-pim"
          style={getTabButtonStyle(activeTab === "pim")}
          onClick={() => setActiveTab("pim")}
        >
          PIM
        </button>
        <button
          type="button"
          data-testid="tab-templates"
          style={getTabButtonStyle(activeTab === "templates")}
          onClick={() => setActiveTab("templates")}
        >
          Templates
        </button>
      </nav>

      <RequireTenant tenantId={activeTenant}>
        <section style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {activeTab === "assignments" && (
            <RolesAssignmentsTable tenantId={activeTenant} isPimView={false} />
          )}
          {activeTab === "pim" && (
            <RolesAssignmentsTable tenantId={activeTenant} isPimView={true} />
          )}
          {activeTab === "templates" && (
            <PimSettingsTemplatesTab tenantId={activeTenant} />
          )}
        </section>
      </RequireTenant>
    </main>
  );
}
