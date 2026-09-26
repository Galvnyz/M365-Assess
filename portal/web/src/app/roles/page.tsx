"use client";

// Roles & Assignments page (EPIC-013 SPEC.md §3.1, §3.2; T-0248).
// Page title: Roles & Assignments.
// Tabs: Assignments / PIM / Templates.
// Strictly uses report theme tokens with zero colour literals.

import React, { useState, type CSSProperties, type ReactElement } from "react";
import { RolesAssignmentsTable } from "../../components/roles/RolesAssignmentsTable";
import { PimSettingsTemplatesTab } from "../../components/roles/PimSettingsTemplatesTab";

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

const tenantInputStyle: CSSProperties = {
  padding: "8px 12px",
  background: "var(--input-bg, var(--bg))",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
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
  const [tenantInput, setTenantInput] = useState("tenant-a");
  const [activeTenant, setActiveTenant] = useState("tenant-a");
  const [activeTab, setActiveTab] = useState<TabId>("assignments");

  const handleApplyTenant = (): void => {
    setActiveTenant(tenantInput.trim());
  };

  return (
    <main style={pageStyle} data-testid="roles-page">
      <header style={headerStyle}>
        <div>
          <h1 style={titleStyle}>Roles &amp; Assignments</h1>
          <p style={subtitleStyle}>
            Directory role assignments, Privileged Identity Management (PIM), and role settings templates.
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <input
            type="text"
            placeholder="Tenant ID…"
            value={tenantInput}
            onChange={(e) => setTenantInput(e.target.value)}
            style={tenantInputStyle}
            data-testid="tenant-input"
          />
          <button
            type="button"
            onClick={handleApplyTenant}
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text)",
              fontWeight: 600,
              fontSize: "14px",
              cursor: "pointer",
            }}
          >
            Load
          </button>
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
    </main>
  );
}
