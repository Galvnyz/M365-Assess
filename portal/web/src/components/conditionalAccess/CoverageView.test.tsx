/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  CoverageView,
  type CaCoverageSummary,
  type CoverageGap,
  type CoveredUser,
  type UncoveredUser,
  type CoveredApp,
  type UncoveredApp,
} from "./CoverageView";
import {
  ChangeHistoryPanel,
  type CaPolicyChangeRecord,
} from "./ChangeHistoryPanel";

afterEach(() => {
  cleanup();
});

describe("CoverageView component (T-0290)", () => {
  const sampleSummary: CaCoverageSummary = {
    totalUsers: 100,
    coveredUsersCount: 92,
    uncoveredUsersCount: 8,
    userCoveragePct: 92,
    totalApps: 25,
    coveredAppsCount: 22,
    uncoveredAppsCount: 3,
    appCoveragePct: 88,
    activePoliciesCount: 5,
    totalGapsCount: 2,
  };

  const sampleGaps: CoverageGap[] = [
    {
      category: "Guest Accounts",
      severity: "high",
      title: "5 guest accounts without policy coverage",
      description: "External accounts missing MFA or location restrictions.",
      count: 5,
    },
    {
      category: "Cloud Apps",
      severity: "medium",
      title: "3 cloud apps omitted from policy scope",
      description: "Unprotected applications allow direct authentication without grants.",
      count: 3,
    },
  ];

  const sampleCoveredUsers: CoveredUser[] = [
    {
      id: "u-1",
      displayName: "Megan Bowen",
      userPrincipalName: "megan@contoso.com",
      userType: "Member",
      policies: [{ id: "pol-1", displayName: "Require MFA" }],
    },
  ];

  const sampleUncoveredUsers: UncoveredUser[] = [
    {
      id: "u-2",
      displayName: "Guest Vendor",
      userPrincipalName: "vendor#EXT#@contoso.com",
      userType: "Guest",
      reason: "No active Conditional Access policy targets this user",
    },
  ];

  const sampleCoveredApps: CoveredApp[] = [
    {
      appId: "app-1",
      displayName: "Exchange Online",
      policies: [{ id: "pol-1", displayName: "Require MFA" }],
    },
  ];

  const sampleUncoveredApps: UncoveredApp[] = [
    {
      appId: "app-2",
      displayName: "Legacy Intranet",
      reason: "No active Conditional Access policy targets this cloud application",
    },
  ];

  it("renders coverage KPIs and gap callouts", () => {
    render(
      <CoverageView
        summary={sampleSummary}
        gaps={sampleGaps}
        coveredUsers={sampleCoveredUsers}
        uncoveredUsers={sampleUncoveredUsers}
        coveredApps={sampleCoveredApps}
        uncoveredApps={sampleUncoveredApps}
      />,
    );

    expect(screen.getByTestId("user-coverage-pct").textContent).toBe("92%");
    expect(screen.getByTestId("app-coverage-pct").textContent).toBe("88%");
    expect(screen.getByTestId("gaps-count").textContent).toBe("2");
    expect(screen.getByTestId("active-policies-count").textContent).toBe("5");

    const gapCard = screen.getByTestId("gap-item-0");
    expect(gapCard.textContent).toContain("5 guest accounts without policy coverage");
    expect(gapCard.textContent).toContain("HIGH");
  });

  it("renders uncovered users and applications in gaps tab", () => {
    render(
      <CoverageView
        summary={sampleSummary}
        gaps={sampleGaps}
        uncoveredUsers={sampleUncoveredUsers}
        uncoveredApps={sampleUncoveredApps}
      />,
    );

    const usersTable = screen.getByTestId("uncovered-users-table");
    expect(usersTable.textContent).toContain("Guest Vendor");
    expect(usersTable.textContent).toContain("vendor#EXT#@contoso.com");
    expect(usersTable.textContent).toContain("Guest");

    const appsTable = screen.getByTestId("uncovered-apps-table");
    expect(appsTable.textContent).toContain("Legacy Intranet");
    expect(appsTable.textContent).toContain("app-2");
  });

  it("switches tabs to view covered users and covered apps", () => {
    render(
      <CoverageView
        summary={sampleSummary}
        coveredUsers={sampleCoveredUsers}
        coveredApps={sampleCoveredApps}
      />,
    );

    fireEvent.click(screen.getByTestId("tab-covered-users"));
    const usersTab = screen.getByTestId("tab-content-covered-users");
    expect(usersTab.textContent).toContain("Megan Bowen");
    expect(usersTab.textContent).toContain("Require MFA");

    fireEvent.click(screen.getByTestId("tab-covered-apps"));
    const appsTab = screen.getByTestId("tab-content-covered-apps");
    expect(appsTab.textContent).toContain("Exchange Online");
    expect(appsTab.textContent).toContain("Require MFA");
  });

  it("filters search term across identities", () => {
    render(
      <CoverageView
        summary={sampleSummary}
        uncoveredUsers={sampleUncoveredUsers}
      />,
    );

    const searchInput = screen.getByTestId("coverage-search-input");
    fireEvent.change(searchInput, { target: { value: "NonExistent" } });

    expect(screen.queryByText("Guest Vendor")).toBeNull();

    fireEvent.change(searchInput, { target: { value: "Vendor" } });
    expect(screen.getByText("Guest Vendor")).toBeTruthy();
  });
});

describe("ChangeHistoryPanel component (T-0290)", () => {
  const sampleHistory: CaPolicyChangeRecord[] = [
    {
      id: "hist-1",
      tenantId: "tenant-1",
      policyId: "pol-10",
      policyName: "Require MFA for Admins",
      timestamp: "2026-09-26T15:00:00Z",
      initiatedBy: "security-lead@contoso.com",
      action: "ca.policy.edit",
      source: "portal",
      diff: ["~ State: report-only -> enabled", "+ Exclude Users: breakglass@contoso.com"],
      before: { state: "enabledForReportingButNotEnforced" },
      after: { state: "enabled" },
    },
    {
      id: "hist-2",
      tenantId: "tenant-1",
      policyId: "pol-10",
      policyName: "Require MFA for Admins",
      timestamp: "2026-09-26T14:45:00Z",
      initiatedBy: "admin@contoso.com",
      action: "Update conditional access policy",
      source: "directoryAudit",
    },
  ];

  it("renders change history items with provenance badges", () => {
    render(<ChangeHistoryPanel items={sampleHistory} />);

    expect(screen.getAllByText("Require MFA for Admins")).toHaveLength(2);
    expect(screen.getByText("security-lead@contoso.com")).toBeTruthy();

    const badges = screen.getAllByTestId("source-badge");
    expect(badges[0]?.textContent).toBe("Portal Audit");
    expect(badges[1]?.textContent).toBe("Directory Audit");
  });

  it("toggles before/after diff view", () => {
    render(<ChangeHistoryPanel items={sampleHistory} />);

    expect(screen.queryByTestId("diff-box-hist-1")).toBeNull();

    const toggleBtn = screen.getByTestId("toggle-diff-btn-hist-1");
    fireEvent.click(toggleBtn);

    const diffBox = screen.getByTestId("diff-box-hist-1");
    expect(diffBox).toBeTruthy();
    expect(diffBox.textContent).toContain("State: report-only -> enabled");
    expect(diffBox.textContent).toContain("+ Exclude Users: breakglass@contoso.com");

    fireEvent.click(toggleBtn);
    expect(screen.queryByTestId("diff-box-hist-1")).toBeNull();
  });

  it("filters history by search term", () => {
    render(<ChangeHistoryPanel items={sampleHistory} />);

    const searchInput = screen.getByTestId("history-search-input");
    fireEvent.change(searchInput, { target: { value: "security-lead" } });

    expect(screen.getByTestId("history-item-hist-1")).toBeTruthy();
    expect(screen.queryByTestId("history-item-hist-2")).toBeNull();
  });
});
