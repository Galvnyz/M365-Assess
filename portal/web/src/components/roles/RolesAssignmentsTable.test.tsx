import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { RolesAssignmentsTable } from "./RolesAssignmentsTable";
import { PimSettingsTemplatesTab } from "./PimSettingsTemplatesTab";
import { P2GateNotice } from "./P2GateNotice";
import RolesPage from "../../app/roles/page";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mockRoleAssignments = {
  tenantId: "tenant-a",
  totalCount: 2,
  items: [
    {
      id: "ra-1",
      roleDefinitionId: "role-ga",
      roleName: "Global Administrator",
      principalId: "u-1",
      principalDisplayName: "Alice Admin",
      principalEmail: "alice@example.com",
      principalType: "user",
      assignmentType: "permanent",
      directoryScopeId: "/",
      scope: "/",
      startDateTime: null,
      endDateTime: null,
      status: "active",
    },
    {
      id: "ra-2",
      roleDefinitionId: "role-sa",
      roleName: "Security Administrator",
      principalId: "u-2",
      principalDisplayName: "Bob Security",
      principalEmail: "bob@example.com",
      principalType: "user",
      assignmentType: "eligible",
      directoryScopeId: "/",
      scope: "/",
      startDateTime: "2026-09-01T00:00:00Z",
      endDateTime: "2027-09-01T00:00:00Z",
      status: "eligible",
    },
  ],
  nextCursor: null,
};

const mockPimAssignmentsP2 = {
  tenantId: "tenant-a",
  gate: {
    supported: true,
    status: "licensed",
    requiredLicense: "Entra ID P2",
    message: null,
  },
  totalCount: 1,
  items: [
    {
      id: "pim-1",
      roleDefinitionId: "role-ga",
      roleName: "Global Administrator",
      principalId: "u-2",
      principalDisplayName: "Bob Security",
      principalEmail: "bob@example.com",
      principalType: "user",
      assignmentType: "eligible",
      directoryScopeId: "/",
      scope: "/",
      startDateTime: "2026-09-01T00:00:00Z",
      endDateTime: "2027-09-01T00:00:00Z",
      status: "eligible",
    },
  ],
  nextCursor: null,
};

const mockPimAssignmentsNoP2 = {
  tenantId: "tenant-no-p2",
  gate: {
    supported: false,
    status: "license-missing",
    requiredLicense: "Entra ID P2",
    message: "Privileged Identity Management (PIM) requires Microsoft Entra ID P2 (or Microsoft 365 E5) licenses.",
  },
  totalCount: 0,
  items: [],
  nextCursor: null,
};

const mockTemplates = {
  items: [
    {
      id: "tpl-1",
      name: "Default Admin Template",
      roleId: "role-ga",
      settings: {
        maximumDurationInHours: 8,
        requireMfa: true,
        requireJustification: true,
        requireApproval: false,
      },
      scope: "/",
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    },
  ],
};

describe("Roles & Assignments UI (T-0248)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/role-assignments")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockRoleAssignments),
        });
      }
      if (url.includes("/pim-settings-templates")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTemplates),
        });
      }
      if (url.includes("/pim")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockPimAssignmentsP2),
        });
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    });
  });

  it("renders role assignments with visual distinction for permanent vs eligible", async () => {
    render(<RolesAssignmentsTable tenantId="tenant-a" isPimView={false} />);

    await waitFor(() => {
      expect(screen.getByText("Alice Admin")).toBeDefined();
      expect(screen.getByText("Bob Security")).toBeDefined();
    });

    const permanentBadge = screen.getByTestId("badge-permanent");
    const eligibleBadge = screen.getByTestId("badge-eligible");

    expect(permanentBadge).toBeDefined();
    expect(eligibleBadge).toBeDefined();
    // They have different styles / badges
    expect(permanentBadge.textContent).toBe("permanent");
    expect(eligibleBadge.textContent).toBe("eligible");
  });

  it("shows P2GateNotice explaining the requirement when P2 is missing, not an error", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockPimAssignmentsNoP2),
    });

    render(<RolesAssignmentsTable tenantId="tenant-no-p2" isPimView={true} />);

    await waitFor(() => {
      expect(screen.getByTestId("p2-gate-notice")).toBeDefined();
    });

    expect(screen.getByText("Microsoft Entra ID P2 Required")).toBeDefined();
    expect(
      screen.getByText(/Privileged Identity Management \(PIM\) requires Microsoft Entra ID P2/),
    ).toBeDefined();
  });

  it("filters narrow the assignments table query", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockRoleAssignments),
    });
    global.fetch = fetchMock;

    render(<RolesAssignmentsTable tenantId="tenant-a" isPimView={false} />);

    await waitFor(() => {
      expect(screen.getByText("Alice Admin")).toBeDefined();
    });

    const searchInput = screen.getByTestId("filter-search");
    fireEvent.change(searchInput, { target: { value: "alice" } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("search=alice"));
    });
  });

  it("renders the three tabs on the Roles & Assignments page", async () => {
    render(<RolesPage />);

    expect(screen.getByTestId("roles-page")).toBeDefined();
    expect(screen.getByTestId("tab-assignments")).toBeDefined();
    expect(screen.getByTestId("tab-pim")).toBeDefined();
    expect(screen.getByTestId("tab-templates")).toBeDefined();

    // Click PIM tab
    fireEvent.click(screen.getByTestId("tab-pim"));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/pim"));
    });

    // Click Templates tab
    fireEvent.click(screen.getByTestId("tab-templates"));
    await waitFor(() => {
      expect(screen.getByTestId("pim-templates-tab")).toBeDefined();
    });
  });
});
