/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { UsersTable } from "./UsersTable";
import type { TenantUser } from "../../lib/usersApi";

afterEach(() => {
  cleanup();
});

const RECENT = new Date(Date.now() - 2 * 86400000).toISOString();
const STALE = new Date(Date.now() - 100 * 86400000).toISOString();

const SAMPLE_USERS: TenantUser[] = [
  {
    id: "user-1",
    displayName: "Member One",
    userPrincipalName: "member.one@example.invalid",
    userType: "member",
    licenses: ["sku-1"],
    mfaState: "registered",
    lastSignInDateTime: RECENT,
    status: "enabled",
    department: "Engineering",
  },
  {
    id: "user-2",
    displayName: "Guest Two",
    userPrincipalName: "guest.two@example.invalid",
    userType: "guest",
    licenses: [],
    mfaState: "notRegistered",
    lastSignInDateTime: STALE,
    status: "enabled",
    department: "Finance",
  },
  {
    id: "user-3",
    displayName: "Member Three",
    userPrincipalName: "member.three@example.invalid",
    userType: "member",
    licenses: [],
    mfaState: "unknown",
    lastSignInDateTime: null,
    status: "disabled",
    department: null,
  },
];

function rows(): HTMLElement[] {
  return screen.queryAllByTestId(/^user-row-/);
}

describe("UsersTable (T-0209)", () => {
  it("renders the §3.1 columns with the UPN in mono", () => {
    render(<UsersTable users={SAMPLE_USERS} />);

    for (const header of ["Display name", "UPN", "Type", "Licenses", "MFA state", "Last sign-in", "Status", "Department"]) {
      expect(screen.getByText(header)).toBeTruthy();
    }
    const row = screen.getByTestId("user-row-user-1");
    expect(within(row).getByText("member.one@example.invalid")).toBeTruthy();
    expect(within(row).getByText("Engineering")).toBeTruthy();
    expect(rows()).toHaveLength(3);
  });

  it("narrows rows through every filter", () => {
    render(<UsersTable users={SAMPLE_USERS} />);

    fireEvent.change(screen.getByTestId("filter-status"), { target: { value: "disabled" } });
    expect(rows()).toHaveLength(1);
    fireEvent.change(screen.getByTestId("filter-status"), { target: { value: "all" } });

    fireEvent.change(screen.getByTestId("filter-type"), { target: { value: "guest" } });
    expect(rows()).toHaveLength(1);
    expect(screen.getByTestId("user-row-user-2")).toBeTruthy();
    fireEvent.change(screen.getByTestId("filter-type"), { target: { value: "all" } });

    fireEvent.change(screen.getByTestId("filter-license"), { target: { value: "licensed" } });
    expect(rows()).toHaveLength(1);
    fireEvent.change(screen.getByTestId("filter-license"), { target: { value: "all" } });

    fireEvent.change(screen.getByTestId("filter-mfa"), { target: { value: "registered" } });
    expect(rows()).toHaveLength(1);
    fireEvent.change(screen.getByTestId("filter-mfa"), { target: { value: "all" } });

    fireEvent.change(screen.getByTestId("filter-department"), { target: { value: "Finance" } });
    expect(rows()).toHaveLength(1);
    fireEvent.change(screen.getByTestId("filter-department"), { target: { value: "" } });

    fireEvent.change(screen.getByTestId("filter-signin-age"), { target: { value: "90" } });
    expect(rows()).toHaveLength(1);
    expect(screen.getByTestId("user-row-user-2")).toBeTruthy();
    fireEvent.change(screen.getByTestId("filter-signin-age"), { target: { value: "never" } });
    expect(rows()).toHaveLength(1);
    expect(screen.getByTestId("user-row-user-3")).toBeTruthy();
    fireEvent.change(screen.getByTestId("filter-signin-age"), { target: { value: "all" } });

    fireEvent.change(screen.getByTestId("filter-search"), { target: { value: "guest.two" } });
    expect(rows()).toHaveLength(1);
  });

  it("invokes row actions for the T-0204 lifecycle set", () => {
    const onAction = vi.fn();
    render(<UsersTable users={SAMPLE_USERS} onAction={onAction} />);

    fireEvent.click(screen.getByTestId("action-resetPassword-user-1"));
    expect(onAction).toHaveBeenCalledWith("resetPassword", SAMPLE_USERS[0]);

    fireEvent.click(screen.getByTestId("action-revokeSessions-user-1"));
    expect(onAction).toHaveBeenCalledWith("revokeSessions", SAMPLE_USERS[0]);

    fireEvent.click(screen.getByTestId("action-disable-user-1"));
    expect(onAction).toHaveBeenCalledWith("disable", SAMPLE_USERS[0]);

    fireEvent.click(screen.getByTestId("action-enable-user-3"));
    expect(onAction).toHaveBeenCalledWith("enable", SAMPLE_USERS[2]);

    fireEvent.click(screen.getByTestId("action-becCheck-user-1"));
    expect(onAction).toHaveBeenCalledWith("becCheck", SAMPLE_USERS[0]);

    fireEvent.click(screen.getByTestId("action-offboard-user-1"));
    expect(onAction).toHaveBeenCalledWith("offboard", SAMPLE_USERS[0]);
  });

  it("disables actions from later epics with a reason", () => {
    render(<UsersTable users={SAMPLE_USERS} />);

    const resetMfa = screen.getByTestId("action-resetMfa-user-1") as HTMLButtonElement;
    expect(resetMfa.disabled).toBe(true);
    expect(resetMfa.title).toContain("EPIC-012");

    const licenses = screen.getByTestId("action-licenses-user-1") as HTMLButtonElement;
    expect(licenses.disabled).toBe(true);
    expect(licenses.title).toContain("EPIC-033");

    const edit = screen.getByTestId("action-edit-user-1") as HTMLButtonElement;
    expect(edit.disabled).toBe(true);
  });

  it("opens an off-canvas row detail with a More info item", () => {
    const onView = vi.fn();
    render(<UsersTable users={SAMPLE_USERS} onView={onView} />);

    fireEvent.click(screen.getByTestId("action-view-user-1"));

    expect(onView).toHaveBeenCalledWith(SAMPLE_USERS[0]);
    const drawer = screen.getByTestId("user-detail-drawer");
    expect(drawer).toBeTruthy();
    expect(within(drawer).getByText("More info")).toBeTruthy();

    fireEvent.click(screen.getByTestId("close-user-detail"));
    expect(screen.queryByTestId("user-detail-drawer")).toBeNull();
  });

  it("runs bulk disable and patch over the selection only", () => {
    const onBulkDisable = vi.fn();
    const onBulkPatch = vi.fn();
    render(<UsersTable users={SAMPLE_USERS} onBulkDisable={onBulkDisable} onBulkPatch={onBulkPatch} />);

    fireEvent.click(screen.getByTestId("select-user-user-1"));
    fireEvent.click(screen.getByTestId("select-user-user-2"));
    fireEvent.click(screen.getByTestId("bulk-disable"));

    expect(onBulkDisable).toHaveBeenCalledTimes(1);
    expect(onBulkDisable.mock.calls[0]?.[0]).toHaveLength(2);

    fireEvent.click(screen.getByTestId("bulk-patch"));
    expect(onBulkPatch).toHaveBeenCalledTimes(1);
    expect(onBulkPatch.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it("disables bulk license and group writes with a reason", () => {
    render(<UsersTable users={SAMPLE_USERS} />);

    fireEvent.click(screen.getByTestId("select-user-user-1"));
    const assign = screen.getByTestId("bulk-license-assign") as HTMLButtonElement;
    expect(assign.disabled).toBe(true);
    expect(assign.title).toContain("EPIC-033");
    const group = screen.getByTestId("bulk-group-add") as HTMLButtonElement;
    expect(group.disabled).toBe(true);
    expect(group.title).toContain("EPIC-014");
  });

  it("uses report theme tokens with zero colour literals", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = (await import("node:path")).default;
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "UsersTable.tsx"), "utf8");
    for (const literal of ["#fff", "#000", "rgb(", "rgba("]) {
      expect(source).not.toContain(literal);
    }
    expect(source).toContain("var(--");
  });
});
