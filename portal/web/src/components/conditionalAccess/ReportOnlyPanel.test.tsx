/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  ReportOnlyPanel,
  type CaReportOnlyPolicyResult,
  type CaReportOnlySummary,
} from "./ReportOnlyPanel";

afterEach(() => {
  cleanup();
});

describe("ReportOnlyPanel component (T-0289)", () => {
  const samplePolicies: CaReportOnlyPolicyResult[] = [
    {
      policyId: "pol-ro-1",
      policyName: "Require MFA for Remote Users",
      state: "enabledForReportingButNotEnforced",
      controlsSummary: "Grant: mfa",
      totalEvaluated: 120,
      wouldBlockCount: 15,
      wouldGrantCount: 95,
      notAppliedCount: 10,
      affectedUsers: [
        { userPrincipalName: "adele@contoso.com", failCount: 10 },
        { userPrincipalName: "patti@contoso.com", failCount: 5 },
      ],
      affectedApps: [
        { appDisplayName: "Office 365 Exchange Online", failCount: 12 },
        { appDisplayName: "Microsoft Teams", failCount: 3 },
      ],
      sampleEvents: [
        {
          id: "evt-1",
          createdDateTime: "2026-09-26T14:00:00Z",
          userPrincipalName: "adele@contoso.com",
          appDisplayName: "Office 365 Exchange Online",
          ipAddress: "198.51.100.22",
          location: "Chicago, US",
          result: "reportOnlyFailure",
          wouldBlock: true,
        },
      ],
    },
  ];

  const sampleSummary: CaReportOnlySummary = {
    totalReportOnlyPolicies: 1,
    totalEvaluated: 120,
    totalWouldBlock: 15,
  };

  it("renders KPI summary metrics", () => {
    render(
      <ReportOnlyPanel
        policies={samplePolicies}
        summary={sampleSummary}
      />,
    );

    expect(screen.getByTestId("kpi-policies-count").textContent).toBe("1");
    expect(screen.getByTestId("kpi-evaluated-count").textContent).toBe("120");
    expect(screen.getByTestId("kpi-would-block-count").textContent).toBe("15");
  });

  it("renders policy cards with breakdown of would-block and would-grant counts", () => {
    render(
      <ReportOnlyPanel
        policies={samplePolicies}
        summary={sampleSummary}
      />,
    );

    const card = screen.getByTestId("policy-card-pol-ro-1");
    expect(card).toBeTruthy();
    expect(card.textContent).toContain("Require MFA for Remote Users");
    expect(card.textContent).toContain("Report-Only");
    expect(card.textContent).toContain("Grant: mfa");

    const wouldBlockMetric = screen.getByTestId("would-block-metric");
    expect(wouldBlockMetric.textContent).toBe("15");
  });

  it("displays affected users and applications", () => {
    render(
      <ReportOnlyPanel
        policies={samplePolicies}
        summary={sampleSummary}
      />,
    );

    const usersSection = screen.getByTestId("affected-users-section");
    expect(usersSection.textContent).toContain("adele@contoso.com");
    expect(usersSection.textContent).toContain("10 failed");

    const appsSection = screen.getByTestId("affected-apps-section");
    expect(appsSection.textContent).toContain("Office 365 Exchange Online");
    expect(appsSection.textContent).toContain("12 failed");
  });

  it("provides a link to promote to enforced without any inline write triggers", () => {
    render(
      <ReportOnlyPanel
        policies={samplePolicies}
        summary={sampleSummary}
      />,
    );

    const promoteLink = screen.getByTestId("promote-link-pol-ro-1") as HTMLAnchorElement;
    expect(promoteLink).toBeTruthy();
    expect(promoteLink.tagName).toBe("A");
    expect(promoteLink.href).toContain("/tenant/conditional-access/policies/pol-ro-1?promote=true");

    // Verify there are no mutating buttons (no save, deploy, or apply buttons)
    expect(screen.queryByTestId("save-btn")).toBeNull();
    expect(screen.queryByTestId("apply-btn")).toBeNull();
    expect(screen.queryByTestId("deploy-btn")).toBeNull();
  });

  it("toggles the sample events table view", () => {
    render(
      <ReportOnlyPanel
        policies={samplePolicies}
        summary={sampleSummary}
      />,
    );

    const toggleBtn = screen.getByTestId("toggle-events-btn-pol-ro-1");
    expect(screen.queryByTestId("events-table-pol-ro-1")).toBeNull();

    fireEvent.click(toggleBtn);
    const table = screen.getByTestId("events-table-pol-ro-1");
    expect(table).toBeTruthy();
    expect(table.textContent).toContain("adele@contoso.com");
    expect(table.textContent).toContain("Would Block");

    fireEvent.click(toggleBtn);
    expect(screen.queryByTestId("events-table-pol-ro-1")).toBeNull();
  });

  it("filters policies by search query", () => {
    render(
      <ReportOnlyPanel
        policies={samplePolicies}
        summary={sampleSummary}
      />,
    );

    const searchInput = screen.getByTestId("policy-search-input");
    fireEvent.change(searchInput, { target: { value: "Non-existent" } });

    expect(screen.queryByTestId("policy-card-pol-ro-1")).toBeNull();

    fireEvent.change(searchInput, { target: { value: "Remote Users" } });
    expect(screen.getByTestId("policy-card-pol-ro-1")).toBeTruthy();
  });

  it("renders empty state when no report-only policies exist", () => {
    render(
      <ReportOnlyPanel
        policies={[]}
        summary={{ totalReportOnlyPolicies: 0, totalEvaluated: 0, totalWouldBlock: 0 }}
      />,
    );

    expect(screen.getByTestId("empty-state")).toBeTruthy();
    expect(screen.getByText(/No Report-Only Policies Found/)).toBeTruthy();
  });
});
