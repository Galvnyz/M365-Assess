/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { GroupsTable } from "./GroupsTable";
import type { GroupItem } from "../../lib/groupsApi";

afterEach(() => {
  cleanup();
});

const SAMPLE_GROUPS: GroupItem[] = [
  {
    id: "grp-m365",
    name: "Engineering Team",
    displayName: "Engineering Team",
    description: "Core engineering group",
    type: "m365",
    groupType: "m365",
    membershipCount: 24,
    ownerCount: 2,
    hiddenFromAddressListsEnabled: false,
    deliveryManagementEnabled: false,
    dynamicRule: "",
    isDynamic: false,
    mail: "eng@contoso.com",
    owners: [{ id: "u-1", displayName: "Alice Lead", userPrincipalName: "alice@contoso.com" }],
    members: [{ id: "u-2", displayName: "Bob Dev", userPrincipalName: "bob@contoso.com" }],
  },
  {
    id: "grp-sec",
    name: "SG-Admins",
    displayName: "SG-Admins",
    description: "Security admins",
    type: "security",
    groupType: "security",
    membershipCount: 4,
    ownerCount: 1,
    hiddenFromAddressListsEnabled: true,
    deliveryManagementEnabled: false,
    dynamicRule: "",
    isDynamic: false,
    mail: undefined,
  },
  {
    id: "grp-dist",
    name: "All Staff Announcement",
    displayName: "All Staff Announcement",
    description: "Distribution list for all employees",
    type: "distribution",
    groupType: "distribution",
    membershipCount: 0,
    ownerCount: 1,
    hiddenFromAddressListsEnabled: false,
    deliveryManagementEnabled: true,
    dynamicRule: "",
    isDynamic: false,
    mail: "staff@contoso.com",
  },
  {
    id: "grp-dyn",
    name: "Dynamic Sales USA",
    displayName: "Dynamic Sales USA",
    description: "Auto-assigned sales team",
    type: "dynamic",
    groupType: "dynamic",
    membershipCount: 120,
    ownerCount: 2,
    hiddenFromAddressListsEnabled: false,
    deliveryManagementEnabled: false,
    dynamicRule: '(user.department -eq "Sales")',
    isDynamic: true,
    mail: "sales-us@contoso.com",
  },
];

function rows(): HTMLElement[] {
  return screen.queryAllByTestId(/^group-row-/);
}

describe("GroupsTable (T-0263)", () => {
  it("renders the table columns, headers, and distinguishes types with badges", () => {
    render(<GroupsTable groups={SAMPLE_GROUPS} />);

    const thead = screen.getByRole("table").querySelector("thead")!;
    for (const header of ["Name", "Type", "Membership", "Owners", "Hidden from GAL", "Delivery mgmt", "Dynamic rule", "Actions"]) {
      expect(within(thead).getByText(header)).toBeTruthy();
    }

    expect(rows()).toHaveLength(4);

    const m365Badge = screen.getByTestId("badge-type-grp-m365");
    expect(m365Badge.textContent).toBe("m365");

    const dynBadge = screen.getByTestId("badge-type-grp-dyn");
    expect(dynBadge.textContent).toBe("dynamic");

    const secBadge = screen.getByTestId("badge-type-grp-sec");
    expect(secBadge.textContent).toBe("security");

    const distBadge = screen.getByTestId("badge-type-grp-dist");
    expect(distBadge.textContent).toBe("distribution");
  });

  it("filters groups through type, hidden, dynamic, size, and search filters", () => {
    render(<GroupsTable groups={SAMPLE_GROUPS} />);

    // Filter by type: distribution
    fireEvent.change(screen.getByTestId("filter-type"), { target: { value: "distribution" } });
    expect(rows()).toHaveLength(1);
    expect(screen.getByTestId("group-row-grp-dist")).toBeTruthy();
    fireEvent.change(screen.getByTestId("filter-type"), { target: { value: "all" } });

    // Filter by hidden: true
    fireEvent.change(screen.getByTestId("filter-hidden"), { target: { value: "true" } });
    expect(rows()).toHaveLength(1);
    expect(screen.getByTestId("group-row-grp-sec")).toBeTruthy();
    fireEvent.change(screen.getByTestId("filter-hidden"), { target: { value: "all" } });

    // Filter by dynamic: true
    fireEvent.change(screen.getByTestId("filter-dynamic"), { target: { value: "true" } });
    expect(rows()).toHaveLength(1);
    expect(screen.getByTestId("group-row-grp-dyn")).toBeTruthy();
    fireEvent.change(screen.getByTestId("filter-dynamic"), { target: { value: "all" } });

    // Filter by size: empty
    fireEvent.change(screen.getByTestId("filter-size"), { target: { value: "empty" } });
    expect(rows()).toHaveLength(1);
    expect(screen.getByTestId("group-row-grp-dist")).toBeTruthy();

    // Filter by size: large (>50)
    fireEvent.change(screen.getByTestId("filter-size"), { target: { value: "large" } });
    expect(rows()).toHaveLength(1);
    expect(screen.getByTestId("group-row-grp-dyn")).toBeTruthy();
    fireEvent.change(screen.getByTestId("filter-size"), { target: { value: "all" } });

    // Filter by search
    fireEvent.change(screen.getByTestId("filter-search"), { target: { value: "Engineering" } });
    expect(rows()).toHaveLength(1);
    expect(screen.getByTestId("group-row-grp-m365")).toBeTruthy();
  });

  it("renders all row actions and triggers onAction callback", () => {
    const onAction = vi.fn();
    render(<GroupsTable groups={SAMPLE_GROUPS} onAction={onAction} />);

    const row = screen.getByTestId("group-row-grp-m365");
    const actions = ["view", "edit", "manageMembers", "manageOwners", "gal", "delivery", "delete", "convert"];
    for (const act of actions) {
      expect(within(row).getByTestId(`action-${act}-grp-m365`)).toBeTruthy();
    }

    fireEvent.click(within(row).getByTestId("action-edit-grp-m365"));
    expect(onAction).toHaveBeenCalledWith("edit", SAMPLE_GROUPS[0]);

    fireEvent.click(within(row).getByTestId("action-manageMembers-grp-m365"));
    expect(onAction).toHaveBeenCalledWith("manageMembers", SAMPLE_GROUPS[0]);
  });

  it("clicking View opens off-canvas detail drawer with members, owners, and settings", () => {
    render(<GroupsTable groups={SAMPLE_GROUPS} />);

    expect(screen.queryByTestId("group-detail-drawer")).toBeNull();

    // Click View on Engineering Team
    fireEvent.click(screen.getByTestId("action-view-grp-m365"));

    const drawer = screen.getByTestId("group-detail-drawer");
    expect(drawer).toBeTruthy();

    expect(screen.getByTestId("drawer-settings-section")).toBeTruthy();
    expect(screen.getByTestId("drawer-owners-section")).toBeTruthy();
    expect(screen.getByTestId("drawer-members-section")).toBeTruthy();

    expect(within(drawer).getByText("Alice Lead (alice@contoso.com)")).toBeTruthy();
    expect(within(drawer).getByText("Bob Dev (bob@contoso.com)")).toBeTruthy();
    expect(within(drawer).getByText("eng@contoso.com")).toBeTruthy();

    // Close button works
    fireEvent.click(screen.getByTestId("drawer-close-btn"));
    expect(screen.queryByTestId("group-detail-drawer")).toBeNull();
  });

  it("renders Add group button and triggers callback", () => {
    const onAddGroup = vi.fn();
    render(<GroupsTable groups={SAMPLE_GROUPS} onAddGroup={onAddGroup} />);

    const addBtn = screen.getByTestId("add-group-btn");
    expect(addBtn).toBeTruthy();
    fireEvent.click(addBtn);
    expect(onAddGroup).toHaveBeenCalledTimes(1);
  });
});
