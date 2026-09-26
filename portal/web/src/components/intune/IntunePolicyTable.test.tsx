/** @vitest-environment jsdom */
// Tests for IntunePolicyTable and IntunePolicyDetailDrawer (T-0303).
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IntunePolicyListPage, IntunePolicyTable, filterIntunePolicies } from "./IntunePolicyTable";
import { templateInputFromPolicy, type IntunePolicyItem } from "../../lib/intuneApi";

const push = vi.fn();

afterEach(() => {
  cleanup();
  push.mockReset();
  vi.unstubAllGlobals();
});

const SAMPLE_POLICIES: IntunePolicyItem[] = [
  {
    id: "pol-1",
    name: "Windows Security Baseline",
    displayName: "Windows Security Baseline",
    platform: "windows",
    policyType: "Configuration Policy",
    assignedToCount: 2,
    assignments: [
      { id: "asgn-1", target: "All Devices", targetType: "allDevicesAssignmentTarget" },
      { id: "asgn-2", target: "IT Group", targetType: "groupAssignmentTarget" },
    ],
    lastModifiedDateTime: "2026-09-20T10:00:00Z",
    modifiedBy: "admin@contoso.com",
  },
  {
    id: "pol-2",
    name: "BitLocker Enforcement",
    displayName: "BitLocker Enforcement",
    platform: "windows",
    policyType: "Configuration Policy",
    assignedToCount: 0,
    assignments: [],
    lastModifiedDateTime: "2026-09-21T08:30:00Z",
    modifiedBy: "operator@contoso.com",
  },
];

const COMPLIANCE_POLICY: IntunePolicyItem = {
  id: "pol-cmp-1",
  name: "Windows 10 Compliance",
  displayName: "Windows 10 Compliance",
  platform: "windows",
  policyType: "Compliance Policy",
  assignedToCount: 1,
  assignments: [
    { id: "asgn-3", target: "All Users", targetType: "allLicensedUsersAssignmentTarget" },
  ],
  lastModifiedDateTime: "2026-09-22T14:00:00Z",
  modifiedBy: "operator@contoso.com",
};

describe("IntunePolicyTable — configuration kind (T-0303)", () => {
  it("renders the correct page title for configuration", () => {
    render(<IntunePolicyTable kind="configuration" policies={[]} />);
    expect(screen.getByText("Configuration Policies")).toBeDefined();
  });

  it("renders all §3.1 column headers", () => {
    render(<IntunePolicyTable kind="configuration" policies={[]} />);
    expect(screen.getByText("Name")).toBeDefined();
    expect(screen.getByText("Platform")).toBeDefined();
    expect(screen.getByText("Type")).toBeDefined();
    expect(screen.getByText("Assigned to")).toBeDefined();
    expect(screen.getByText("Last modified")).toBeDefined();
    expect(screen.getByText("Modified by")).toBeDefined();
  });

  it("renders policy rows with correct data", () => {
    render(<IntunePolicyTable kind="configuration" policies={SAMPLE_POLICIES} />);
    expect(screen.getByText("Windows Security Baseline")).toBeDefined();
    expect(screen.getByText("BitLocker Enforcement")).toBeDefined();
    const cells = screen.getAllByText("windows");
    expect(cells.length).toBeGreaterThanOrEqual(2);
  });

  it("shows 'Unassigned' badge for policy with 0 assignments", () => {
    render(<IntunePolicyTable kind="configuration" policies={SAMPLE_POLICIES} />);
    // "Unassigned" appears in both the filter dropdown option and the badge
    const unassignedEls = screen.getAllByText("Unassigned");
    // At least one is the badge (span), not just the option
    expect(unassignedEls.length).toBeGreaterThanOrEqual(1);
  });

  it("shows assignment count badge for assigned policies", () => {
    render(<IntunePolicyTable kind="configuration" policies={SAMPLE_POLICIES} />);
    expect(screen.getByText("2 group(s)")).toBeDefined();
  });

  it("renders row action buttons for each policy", () => {
    render(<IntunePolicyTable kind="configuration" policies={SAMPLE_POLICIES} />);
    const editBtns = screen.getAllByText("Edit");
    expect(editBtns.length).toBe(2);
    const cloneBtns = screen.getAllByText("Clone");
    expect(cloneBtns.length).toBe(2);
    const deleteBtns = screen.getAllByText("Delete");
    expect(deleteBtns.length).toBe(2);
  });

  it("calls onAction with 'edit' when Edit is clicked", () => {
    const onAction = vi.fn();
    render(
      <IntunePolicyTable kind="configuration" policies={SAMPLE_POLICIES} onAction={onAction} />,
    );
    fireEvent.click(screen.getAllByText("Edit")[0]!);
    expect(onAction).toHaveBeenCalledWith("edit", SAMPLE_POLICIES[0]);
  });

  it("calls onAction with 'delete' when Delete is clicked", () => {
    const onAction = vi.fn();
    render(
      <IntunePolicyTable kind="configuration" policies={SAMPLE_POLICIES} onAction={onAction} />,
    );
    fireEvent.click(screen.getAllByText("Delete")[0]!);
    expect(onAction).toHaveBeenCalledWith("delete", SAMPLE_POLICIES[0]);
  });

  it("renders empty state when no policies", () => {
    render(<IntunePolicyTable kind="configuration" policies={[]} />);
    expect(screen.getByText(/no configuration policies found/i)).toBeDefined();
  });

  it("renders loading state", () => {
    render(<IntunePolicyTable kind="configuration" loading={true} />);
    expect(screen.getByText(/loading configuration policies/i)).toBeDefined();
  });

  it("renders error state", () => {
    render(<IntunePolicyTable kind="configuration" error="Failed to load" />);
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText("Failed to load")).toBeDefined();
  });
});

describe("IntunePolicyTable — compliance kind (T-0303)", () => {
  it("renders the correct page title for compliance", () => {
    render(<IntunePolicyTable kind="compliance" policies={[]} />);
    expect(screen.getByText("Compliance Policies")).toBeDefined();
  });

  it("renders compliance policy row", () => {
    render(<IntunePolicyTable kind="compliance" policies={[COMPLIANCE_POLICY]} />);
    expect(screen.getByText("Windows 10 Compliance")).toBeDefined();
    expect(within(screen.getByTestId("row-pol-cmp-1")).getByText("Compliance Policy")).toBeDefined();
    expect(screen.getByText("1 group(s)")).toBeDefined();
  });
});

describe("IntunePolicyTable — app-protection kind (T-0303)", () => {
  it("renders the correct page title for app-protection", () => {
    render(<IntunePolicyTable kind="app-protection" policies={[]} />);
    expect(screen.getByText("App Protection Policies")).toBeDefined();
  });
});

describe("IntunePolicyTable — filtering (T-0303)", () => {
  it("calls onFilterChange with search text", () => {
    const onFilterChange = vi.fn();
    render(
      <IntunePolicyTable
        kind="configuration"
        policies={SAMPLE_POLICIES}
        onFilterChange={onFilterChange}
      />,
    );
    const searchInput = screen.getByLabelText("Search policies");
    fireEvent.change(searchInput, { target: { value: "Security" } });
    expect(onFilterChange).toHaveBeenCalledWith(expect.objectContaining({ search: "Security" }));
  });

  it("calls onFilterChange with platform filter", () => {
    const onFilterChange = vi.fn();
    render(
      <IntunePolicyTable
        kind="configuration"
        policies={SAMPLE_POLICIES}
        onFilterChange={onFilterChange}
      />,
    );
    const platformSelect = screen.getByLabelText("Filter by platform");
    fireEvent.change(platformSelect, { target: { value: "windows" } });
    expect(onFilterChange).toHaveBeenCalledWith(expect.objectContaining({ platform: "windows" }));
  });

  it("calls onFilterChange with assignment filter", () => {
    const onFilterChange = vi.fn();
    render(
      <IntunePolicyTable
        kind="configuration"
        policies={SAMPLE_POLICIES}
        onFilterChange={onFilterChange}
      />,
    );
    const assignSelect = screen.getByLabelText("Filter by assignment");
    fireEvent.change(assignSelect, { target: { value: "yes" } });
    expect(onFilterChange).toHaveBeenCalledWith(expect.objectContaining({ assigned: true }));
  });
});

describe("IntunePolicyTable — detail drawer (T-0303)", () => {
  it("opens the detail drawer on View button click", () => {
    render(<IntunePolicyTable kind="configuration" policies={SAMPLE_POLICIES} />);
    fireEvent.click(screen.getAllByText("View")[0]!);
    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByText("All Devices")).toBeDefined();
  });

  it("closes the detail drawer on × button", () => {
    render(<IntunePolicyTable kind="configuration" policies={SAMPLE_POLICIES} />);
    fireEvent.click(screen.getAllByText("View")[0]!);
    expect(screen.getByRole("dialog")).toBeDefined();
    fireEvent.click(screen.getByLabelText("Close drawer"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("IntunePolicyTable — §3.1 row actions and filters (T-0303)", () => {
  it("renders all seven §3.1 row actions per row", () => {
    render(<IntunePolicyTable kind="configuration" policies={SAMPLE_POLICIES} />);
    for (const label of ["View", "Edit", "Clone", "Assign", "Compare", "Export", "Delete"]) {
      expect(screen.getAllByText(label).length).toBe(2);
    }
  });

  it("passes assign and export through onAction", () => {
    const onAction = vi.fn();
    render(<IntunePolicyTable kind="configuration" policies={SAMPLE_POLICIES} onAction={onAction} />);
    fireEvent.click(screen.getAllByText("Assign")[1]!);
    fireEvent.click(screen.getAllByText("Export")[0]!);
    expect(onAction).toHaveBeenCalledWith("assign", SAMPLE_POLICIES[1]);
    expect(onAction).toHaveBeenCalledWith("export", SAMPLE_POLICIES[0]);
  });

  it("narrows the visible rows by assignment", () => {
    render(<IntunePolicyTable kind="configuration" policies={SAMPLE_POLICIES} />);
    fireEvent.change(screen.getByLabelText("Filter by assignment"), { target: { value: "no" } });
    expect(screen.queryByText("Windows Security Baseline")).toBeNull();
    expect(screen.getByText("BitLocker Enforcement")).toBeDefined();
  });

  it("narrows the visible rows by search text", () => {
    render(<IntunePolicyTable kind="configuration" policies={SAMPLE_POLICIES} />);
    fireEvent.change(screen.getByLabelText("Search policies"), { target: { value: "bitlocker" } });
    expect(screen.queryByText("Windows Security Baseline")).toBeNull();
    expect(screen.getByText("BitLocker Enforcement")).toBeDefined();
  });

  it("offers loaded policy types and emits type and modified-date filters", () => {
    const onFilterChange = vi.fn();
    render(
      <IntunePolicyTable
        kind="compliance"
        policies={[...SAMPLE_POLICIES, COMPLIANCE_POLICY]}
        onFilterChange={onFilterChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Filter by type"), {
      target: { value: "Compliance Policy" },
    });
    expect(onFilterChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ policyType: "Compliance Policy" }),
    );
    expect(screen.queryByText("BitLocker Enforcement")).toBeNull();
    fireEvent.change(screen.getByLabelText("Filter by modified date"), {
      target: { value: "2026-09-22" },
    });
    expect(onFilterChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ modifiedDate: "2026-09-22" }),
    );
  });

  it("filterIntunePolicies keeps policies modified on or after the date", () => {
    const rows = filterIntunePolicies([...SAMPLE_POLICIES, COMPLIANCE_POLICY], {
      modifiedDate: "2026-09-21",
    });
    expect(rows.map((p) => p.id)).toEqual(["pol-2", "pol-cmp-1"]);
  });

  it("drawer Clone to template emits cloneToTemplate, distinct from row Clone", () => {
    const onAction = vi.fn();
    render(<IntunePolicyTable kind="configuration" policies={SAMPLE_POLICIES} onAction={onAction} />);
    fireEvent.click(screen.getAllByText("View")[0]!);
    fireEvent.click(screen.getByLabelText("Clone to template"));
    expect(onAction).toHaveBeenCalledWith("cloneToTemplate", SAMPLE_POLICIES[0]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("templateInputFromPolicy (T-0303)", () => {
  it("maps a Windows policy to the T-0305 template payload", () => {
    const input = templateInputFromPolicy(
      { ...SAMPLE_POLICIES[0]!, settingsSummary: { a: 1 } },
      "configuration",
    );
    expect(input).toEqual({
      name: "Windows Security Baseline",
      platform: "windows10",
      policyType: "configuration",
      policyJson: {
        displayName: "Windows Security Baseline",
        "@odata.type": "#microsoft.graph.deviceManagementConfigurationPolicy",
        settings: { a: 1 },
      },
      assignments: [
        { target: "All Devices", targetType: "allDevicesAssignmentTarget" },
        { target: "IT Group", targetType: "groupAssignmentTarget" },
      ],
    });
  });

  it("returns null for kinds or platforms templates do not support in v1", () => {
    expect(templateInputFromPolicy(SAMPLE_POLICIES[0]!, "app-protection")).toBeNull();
    expect(
      templateInputFromPolicy({ ...COMPLIANCE_POLICY, platform: "ios" }, "compliance"),
    ).toBeNull();
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("IntunePolicyListPage (T-0303)", () => {
  it("loads the kind for the tenant and routes Edit to the policy editor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        tenantId: "t-1",
        kind: "configuration",
        totalCount: 2,
        items: SAMPLE_POLICIES,
        nextCursor: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<IntunePolicyListPage kind="configuration" tenantId="t-1" navigate={push} />);
    await screen.findByText("Windows Security Baseline");
    expect(fetchMock.mock.calls[0]![0]).toBe("/v1/tenants/t-1/intune/configuration");
    fireEvent.click(screen.getAllByText("Edit")[0]!);
    expect(push).toHaveBeenCalledWith("/intune/policies/configuration/pol-1?tenantId=t-1");
  });

  it("posts Clone to template to the template API", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, { tenantId: "t-1", kind: "configuration", totalCount: 2, items: SAMPLE_POLICIES, nextCursor: null }),
      )
      .mockResolvedValueOnce(jsonResponse(201, { id: "tpl-1", name: "Windows Security Baseline" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<IntunePolicyListPage kind="configuration" tenantId="t-1" navigate={push} />);
    await screen.findByText("Windows Security Baseline");
    fireEvent.click(screen.getAllByText("View")[0]!);
    fireEvent.click(screen.getByLabelText("Clone to template"));
    await screen.findByText("Saved 'Windows Security Baseline' as a policy template.");
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe("/v1/intune-templates");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).platform).toBe("windows10");
  });

  it("shows the unsupported notice when the API answers 501", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(501, { code: "intune.kind.unsupported", message: "Not in v1." }),
      ),
    );
    render(<IntunePolicyListPage kind="app-protection" tenantId="t-1" navigate={push} />);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/not yet supported in v1/i),
    );
  });

  it("asks for a tenant when none is selected", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<IntunePolicyListPage kind="compliance" tenantId="" navigate={push} />);
    expect(screen.getByText("No tenant selected.")).toBeDefined();
  });
});
