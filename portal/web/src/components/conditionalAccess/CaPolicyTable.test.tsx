/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { CaPolicyTable } from "./CaPolicyTable";
import type { CaPolicyItem } from "../../lib/caApi";

afterEach(() => {
  cleanup();
});

const SAMPLE_POLICIES: CaPolicyItem[] = [
  {
    id: "ca-001",
    name: "Require MFA for Admins",
    displayName: "Require MFA for Admins",
    state: "enabled",
    usersTargeted: {
      includeRoles: ["62e90394-69f5-4237-9190-012177145e10"],
      excludeUsers: ["breakglass@contoso.com"],
      summary: "1 roles (excludes 1)",
    },
    apps: {
      includeApplications: ["All"],
      summary: "All cloud apps",
    },
    grantControls: {
      operator: "OR",
      builtInControls: ["mfa"],
      summary: "Grant: mfa",
    },
    conditions: {
      clientAppTypes: ["all"],
      signInRiskLevels: [],
      userRiskLevels: [],
      summary: "Locations",
    },
    createdDateTime: "2026-01-01T00:00:00Z",
    modifiedDateTime: "2026-09-20T12:00:00Z",
    modifiedBy: "admin@contoso.com",
  },
  {
    id: "ca-002",
    name: "Block Legacy Auth",
    displayName: "Block Legacy Auth",
    state: "enabledForReportingButNotEnforced",
    usersTargeted: {
      includeUsers: ["All"],
      excludeUsers: ["breakglass@contoso.com"],
      summary: "All users (excludes 1)",
    },
    apps: {
      includeApplications: ["All"],
      summary: "All cloud apps",
    },
    grantControls: {
      operator: "OR",
      builtInControls: ["block"],
      summary: "Block",
    },
    conditions: {
      clientAppTypes: ["exchangeActiveSync", "other"],
      signInRiskLevels: [],
      userRiskLevels: [],
      summary: "Client apps",
    },
    createdDateTime: "2026-02-01T00:00:00Z",
    modifiedDateTime: "2026-09-22T14:30:00Z",
    modifiedBy: "secops@contoso.com",
  },
  {
    id: "ca-003",
    name: "Compliant Devices for Salesforce",
    displayName: "Compliant Devices for Salesforce",
    state: "disabled",
    usersTargeted: {
      includeGroups: ["grp-sales"],
      summary: "1 groups",
    },
    apps: {
      includeApplications: ["app-salesforce"],
      summary: "Salesforce",
    },
    grantControls: {
      operator: "AND",
      builtInControls: ["compliantDevice"],
      summary: "Grant: compliantDevice",
    },
    conditions: {
      summary: "Platforms",
    },
    createdDateTime: "2026-03-01T00:00:00Z",
    modifiedDateTime: "2026-08-10T09:00:00Z",
    modifiedBy: "helpdesk@contoso.com",
  },
];

describe("CaPolicyTable component (T-0283)", () => {
  it("renders page title, action buttons, and table rows", () => {
    const onAdd = vi.fn();
    const onDeploy = vi.fn();
    const onAssess = vi.fn();

    render(
      <CaPolicyTable
        policies={SAMPLE_POLICIES}
        onAddPolicy={onAdd}
        onDeployFromTemplate={onDeploy}
        onAssessCoverage={onAssess}
      />,
    );

    expect(screen.getByText("Conditional Access Policies")).toBeTruthy();
    expect(screen.getByTestId("add-policy-btn")).toBeTruthy();
    expect(screen.getByTestId("deploy-template-btn")).toBeTruthy();
    expect(screen.getByTestId("assess-coverage-btn")).toBeTruthy();

    expect(screen.getByText("Require MFA for Admins")).toBeTruthy();
    expect(screen.getByText("Block Legacy Auth")).toBeTruthy();
    expect(screen.getByText("Compliant Devices for Salesforce")).toBeTruthy();

    expect(screen.getAllByText("Enabled").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Report-only").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Disabled").length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByTestId("add-policy-btn"));
    expect(onAdd).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("deploy-template-btn"));
    expect(onDeploy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("assess-coverage-btn"));
    expect(onAssess).toHaveBeenCalledTimes(1);
  });

  it("filters policies by state", () => {
    render(<CaPolicyTable policies={SAMPLE_POLICIES} />);

    const stateSelect = screen.getByTestId("ca-state-select");

    // Filter to Enabled
    fireEvent.change(stateSelect, { target: { value: "enabled" } });
    expect(screen.getByText("Require MFA for Admins")).toBeTruthy();
    expect(screen.queryByText("Block Legacy Auth")).toBeNull();
    expect(screen.queryByText("Compliant Devices for Salesforce")).toBeNull();

    // Filter to Report-only
    fireEvent.change(stateSelect, { target: { value: "report-only" } });
    expect(screen.queryByText("Require MFA for Admins")).toBeNull();
    expect(screen.getByText("Block Legacy Auth")).toBeTruthy();
    expect(screen.queryByText("Compliant Devices for Salesforce")).toBeNull();

    // Filter to Disabled
    fireEvent.change(stateSelect, { target: { value: "disabled" } });
    expect(screen.queryByText("Require MFA for Admins")).toBeNull();
    expect(screen.queryByText("Block Legacy Auth")).toBeNull();
    expect(screen.getByText("Compliant Devices for Salesforce")).toBeTruthy();
  });

  it("filters policies by search query", () => {
    render(<CaPolicyTable policies={SAMPLE_POLICIES} />);

    const searchInput = screen.getByTestId("ca-search-input");
    fireEvent.change(searchInput, { target: { value: "legacy" } });

    expect(screen.getByText("Block Legacy Auth")).toBeTruthy();
    expect(screen.queryByText("Require MFA for Admins")).toBeNull();
  });

  it("filters policies by target", () => {
    render(<CaPolicyTable policies={SAMPLE_POLICIES} />);

    const targetInput = screen.getByTestId("ca-target-input");
    fireEvent.change(targetInput, { target: { value: "salesforce" } });

    expect(screen.getByText("Compliant Devices for Salesforce")).toBeTruthy();
    expect(screen.queryByText("Require MFA for Admins")).toBeNull();
  });

  it("filters policies by control", () => {
    render(<CaPolicyTable policies={SAMPLE_POLICIES} />);

    const controlSelect = screen.getByTestId("ca-control-select");
    fireEvent.change(controlSelect, { target: { value: "block" } });

    expect(screen.getByText("Block Legacy Auth")).toBeTruthy();
    expect(screen.queryByText("Require MFA for Admins")).toBeNull();
  });

  it("opens detail drawer on view action and triggers row actions", () => {
    const onAction = vi.fn();

    render(<CaPolicyTable policies={SAMPLE_POLICIES} onAction={onAction} />);

    const viewBtn = screen.getByTestId("action-view-ca-001");
    fireEvent.click(viewBtn);

    const drawer = screen.getByTestId("ca-drawer-overlay");
    expect(drawer).toBeTruthy();
    expect(within(drawer).getByText("Modification Details")).toBeTruthy();
    expect(within(drawer).getByText(/admin@contoso\.com/)).toBeTruthy();
    expect(within(drawer).getByText("Users & Groups Targeted")).toBeTruthy();

    // Close drawer
    const closeBtn = screen.getByLabelText("Close drawer");
    fireEvent.click(closeBtn);
    expect(screen.queryByTestId("ca-drawer-overlay")).toBeNull();

    // Test other row actions
    fireEvent.click(screen.getByTestId("action-edit-ca-001"));
    expect(onAction).toHaveBeenCalledWith("edit", SAMPLE_POLICIES[0]);

    fireEvent.click(screen.getByTestId("action-clone-ca-001"));
    expect(onAction).toHaveBeenCalledWith("clone", SAMPLE_POLICIES[0]);

    fireEvent.click(screen.getByTestId("action-toggle-ca-001"));
    expect(onAction).toHaveBeenCalledWith("disable", SAMPLE_POLICIES[0]);

    fireEvent.click(screen.getByTestId("action-reportonly-ca-001"));
    expect(onAction).toHaveBeenCalledWith("setReportOnly", SAMPLE_POLICIES[0]);

    fireEvent.click(screen.getByTestId("action-delete-ca-001"));
    expect(onAction).toHaveBeenCalledWith("delete", SAMPLE_POLICIES[0]);
  });
});
