/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  GroupUsageReport,
  type GroupUsageReportData,
} from "./GroupUsageReport";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mockReport: GroupUsageReportData = {
  tenantId: "tenant-test",
  generatedAt: "2026-09-26T12:00:00Z",
  inactiveDaysThreshold: 90,
  summary: {
    totalGroups: 15,
    ownerlessGroupsCount: 2,
    inactiveGroupsCount: 3,
    totalGuestsCount: 8,
    totalMembersCount: 150,
  },
  membershipGrowth: [
    { period: "2026-06", memberCount: 120 },
    { period: "2026-07", memberCount: 130 },
    { period: "2026-08", memberCount: 140 },
    { period: "2026-09", memberCount: 150 },
  ],
  ownerlessGroups: [
    {
      id: "grp-orphan-1",
      displayName: "Legacy Project",
      mail: "legacy@contoso.com",
      groupType: "m365",
      membersCount: 4,
      lastActivityDate: "2026-08-01T00:00:00Z",
    },
    {
      id: "grp-orphan-2",
      displayName: "Abandoned SG",
      groupType: "security",
      membersCount: 1,
      lastActivityDate: null,
    },
  ],
  inactiveGroups: [
    {
      id: "grp-inactive-1",
      displayName: "Old Archive",
      mail: "archive@contoso.com",
      groupType: "distribution",
      membersCount: 25,
      ownersCount: 2,
      lastActivityDate: "2026-01-10T00:00:00Z",
      daysInactive: 259,
    },
  ],
  guestMetrics: {
    totalGuests: 8,
    groupsWithGuestsCount: 1,
    topGuestGroups: [
      { id: "grp-partner", displayName: "Partner Hub", guestCount: 8 },
    ],
  },
};

describe("GroupUsageReport (T-0270)", () => {
  it("renders loading state", () => {
    render(<GroupUsageReport loading={true} />);
    expect(screen.getByTestId("usage-loading")).toBeTruthy();
    expect(screen.getByText("Loading group usage report...")).toBeTruthy();
  });

  it("renders error state", () => {
    render(<GroupUsageReport error="Failed to fetch usage metrics" />);
    expect(screen.getByTestId("usage-error")).toBeTruthy();
    expect(screen.getByText(/Failed to fetch usage metrics/)).toBeTruthy();
  });

  it("renders empty state when no report is provided", () => {
    render(<GroupUsageReport report={null} />);
    expect(screen.getByTestId("usage-empty")).toBeTruthy();
  });

  it("renders summary KPIs, growth table, ownerless & inactive tables, and guest metrics", () => {
    const onThresholdChange = vi.fn();
    const onRefresh = vi.fn();

    render(
      <GroupUsageReport
        report={mockReport}
        inactiveDaysThreshold={90}
        onThresholdChange={onThresholdChange}
        onRefresh={onRefresh}
      />
    );

    // KPI cards
    expect(screen.getByTestId("kpi-total-groups").textContent).toContain("15");
    expect(screen.getByTestId("kpi-total-members").textContent).toContain("150");
    expect(screen.getByTestId("kpi-total-guests").textContent).toContain("8");
    expect(screen.getByTestId("kpi-ownerless-groups").textContent).toContain("2");
    expect(screen.getByTestId("kpi-inactive-groups").textContent).toContain("3");

    // Growth rows
    expect(screen.getByTestId("growth-row-2026-06")).toBeTruthy();
    expect(screen.getByText("120")).toBeTruthy();

    // Ownerless groups
    expect(screen.getByTestId("ownerless-row-grp-orphan-1")).toBeTruthy();
    expect(screen.getByText("Legacy Project")).toBeTruthy();
    expect(screen.getByTestId("link-ownerless-grp-orphan-1")).toBeTruthy();

    // Inactive groups
    expect(screen.getByTestId("inactive-row-grp-inactive-1")).toBeTruthy();
    expect(screen.getByText("Old Archive")).toBeTruthy();
    expect(screen.getByText("259 days")).toBeTruthy();
    expect(screen.getByTestId("link-inactive-grp-inactive-1")).toBeTruthy();

    // Guest metrics
    expect(screen.getByTestId("guest-row-grp-partner")).toBeTruthy();
    expect(screen.getByText("Partner Hub")).toBeTruthy();

    // Inactivity threshold selector
    const select = screen.getByTestId("select-threshold") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "180" } });
    expect(onThresholdChange).toHaveBeenCalledWith(180);

    // Refresh button
    const refreshBtn = screen.getByTestId("btn-refresh");
    fireEvent.click(refreshBtn);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    // Confirm read-only surface: no destructive/cleanup buttons
    expect(screen.queryByText(/delete/i)).toBeNull();
    expect(screen.queryByText(/cleanup/i)).toBeNull();
    expect(screen.queryByText(/remove group/i)).toBeNull();
  });
});
