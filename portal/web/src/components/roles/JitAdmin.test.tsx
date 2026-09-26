import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { JitGrantsTable } from "./JitGrantsTable";
import { JitTemplatesTab } from "./JitTemplatesTab";
import { ScheduleRequestDialog } from "./ScheduleRequestDialog";
import JitAdminsPage from "../../app/jit-admins/page";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mockGrants = {
  tenantId: "tenant-a",
  items: [
    {
      id: "grant-1",
      tenantId: "tenant-a",
      userId: "alice@example.com",
      roleId: "role-ga",
      assignmentType: "eligible",
      startsAt: "2026-09-26T12:00:00Z",
      endsAt: "2026-09-26T20:00:00Z",
      durationHours: 8,
      maxDurationHours: 24,
      state: "active",
      justification: "On-call weekend support",
      createdBy: "admin",
      createdAt: "2026-09-26T12:00:00Z",
      updatedAt: "2026-09-26T12:00:00Z",
    },
    {
      id: "grant-2",
      tenantId: "tenant-a",
      userId: "bob@example.com",
      roleId: "role-sa",
      assignmentType: "active",
      startsAt: "2026-09-25T12:00:00Z",
      endsAt: "2026-09-25T20:00:00Z",
      durationHours: 8,
      maxDurationHours: 24,
      state: "expired",
      justification: "Security audit",
      createdBy: "admin",
      createdAt: "2026-09-25T12:00:00Z",
      updatedAt: "2026-09-25T20:00:00Z",
    },
  ],
};

const mockTemplates = {
  items: [
    {
      id: "tpl-sec",
      name: "Security Investigation",
      description: "Window for SOC alerts",
      allowedRoles: ["role-sa", "role-ra"],
      duration: 4,
      maxDuration: 8,
      justificationRequired: true,
      approvalRequired: false,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    },
  ],
};

describe("JIT Admin & Schedule Request UI (T-0249)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/jit-grants") && init?.method === "POST" && url.includes("/revoke")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...mockGrants.items[0], state: "revoked" }),
        });
      }
      if (url.includes("/jit-grants") && init?.method === "POST" && url.includes("/extend")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...mockGrants.items[0], state: "extended", durationHours: 12 }),
        });
      }
      if (url.includes("/jit-grants") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockGrants.items[0]),
        });
      }
      if (url.includes("/jit-grants")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockGrants),
        });
      }
      if (url.includes("/jit-templates")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTemplates),
        });
      }
      if (url.includes("/pim/requests") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: "req-1",
              tenantId: "tenant-a",
              principalId: body.principalId,
              roleId: body.roleId,
              state: body.approvalRequired ? "pending" : "active",
              justification: body.justification,
              durationHours: body.durationHours ?? 8,
              startsAt: body.approvalRequired ? null : "2026-09-26T12:00:00Z",
              endsAt: body.approvalRequired ? null : "2026-09-26T20:00:00Z",
            }),
        });
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    });
  });

  it("renders active and expired grants and invokes revoke/extend APIs", async () => {
    render(<JitGrantsTable tenantId="tenant-a" />);

    await waitFor(() => {
      expect(screen.getByText("alice@example.com")).toBeDefined();
      expect(screen.getByText("bob@example.com")).toBeDefined();
    });

    expect(screen.getByTestId("grant-state-active")).toBeDefined();
    expect(screen.getByTestId("grant-state-expired")).toBeDefined();

    // Revoke
    const revokeBtn = screen.getByTestId("btn-revoke-grant-1");
    fireEvent.click(revokeBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/jit-grants/grant-1/revoke"),
        expect.anything(),
      );
    });

    // Extend
    const extendBtn = screen.getByTestId("btn-extend-grant-1");
    fireEvent.click(extendBtn);

    const confirmExtendBtn = screen.getByTestId("btn-confirm-extend");
    fireEvent.click(confirmExtendBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/jit-grants/grant-1/extend"),
        expect.anything(),
      );
    });
  });

  it("enforces template's allowed roles in the grant dialog", async () => {
    render(<JitGrantsTable tenantId="tenant-a" />);

    await waitFor(() => {
      expect(screen.getByTestId("btn-grant-jit")).toBeDefined();
    });

    // Open grant dialog
    fireEvent.click(screen.getByTestId("btn-grant-jit"));

    await waitFor(() => {
      expect(screen.getByTestId("grant-modal")).toBeDefined();
    });

    // Select the Security Investigation template
    const templateSelect = screen.getByTestId("select-template");
    fireEvent.change(templateSelect, { target: { value: "tpl-sec" } });

    // The role select should only contain the allowed roles
    const roleSelect = screen.getByTestId("select-grant-role");
    expect(roleSelect).toBeDefined();

    const options = roleSelect.querySelectorAll("option");
    const roleValues = Array.from(options).map((o) => o.value);
    expect(roleValues).toEqual(["role-sa", "role-ra"]);
  });

  it("schedule request requires justification and renders pending when approval configured", async () => {
    render(
      <ScheduleRequestDialog
        tenantId="tenant-a"
        defaultRoleId="role-ga"
        defaultPrincipalId="user-alice@example.com"
        onClose={vi.fn()}
      />,
    );

    const submitBtn = screen.getByTestId("btn-submit-schedule");

    // Submit without justification fails
    fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(screen.getByTestId("schedule-error")).toBeDefined();
      expect(screen.getByText(/Justification is mandatory/)).toBeDefined();
    });

    // Enter justification and check approval required
    const justificationInput = screen.getByTestId("input-justification");
    fireEvent.change(justificationInput, { target: { value: "Weekend disaster recovery drill" } });

    const approvalCheckbox = screen.getByTestId("checkbox-approval");
    fireEvent.click(approvalCheckbox);

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId("request-state-badge")).toBeDefined();
    });

    expect(screen.getByTestId("request-state-badge").textContent).toBe("PENDING");
    expect(screen.getByText(/requires approval before the role assignment is activated/)).toBeDefined();
  });

  it("renders JIT Admins page with tabs and dialog opener", async () => {
    render(<JitAdminsPage />);

    expect(screen.getByTestId("jit-admins-page")).toBeDefined();
    expect(screen.getByTestId("tab-jit-grants")).toBeDefined();
    expect(screen.getByTestId("tab-jit-templates")).toBeDefined();

    // Click templates tab
    fireEvent.click(screen.getByTestId("tab-jit-templates"));
    await waitFor(() => {
      expect(screen.getByTestId("jit-templates-tab")).toBeDefined();
    });

    // Open schedule request dialog
    fireEvent.click(screen.getByTestId("btn-open-schedule-request"));
    await waitFor(() => {
      expect(screen.getByTestId("schedule-request-dialog")).toBeDefined();
    });
  });
});
