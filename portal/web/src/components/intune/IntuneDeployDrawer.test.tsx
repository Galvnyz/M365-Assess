/** @vitest-environment jsdom */
// Tests for IntuneDeployDrawer and IntuneTemplateTable (T-0307).
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { IntuneDeployDrawer, resolveDeployTargets } from "./IntuneDeployDrawer";
import { IntuneTemplateEditDialog, IntuneTemplateTable } from "./IntuneTemplateTable";
import type { IntuneDeployPreview, IntuneTemplate } from "../../lib/intuneApi";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const TEMPLATES: IntuneTemplate[] = [
  {
    id: "tpl-1",
    name: "Win Baseline",
    platform: "windows10",
    policyType: "compliance",
    policyJson: { displayName: "Win Baseline", "@odata.type": "#microsoft.graph.windows10CompliancePolicy" },
    assignments: [{ target: "IT Group", targetType: "groupAssignmentTarget" }],
    source: "local",
    createdAt: "2026-09-20T10:00:00Z",
    updatedAt: "2026-09-21T10:00:00Z",
  },
  {
    id: "tpl-2",
    name: "Defender Config",
    platform: "windows10",
    policyType: "configuration",
    policyJson: { name: "Defender Config", "@odata.type": "#microsoft.graph.deviceManagementConfigurationPolicy" },
    assignments: [],
    source: "local",
    createdAt: "2026-09-20T10:00:00Z",
    updatedAt: "2026-09-22T10:00:00Z",
  },
];

const TENANTS = [
  { id: "t-a", displayName: "Contoso" },
  { id: "t-b", displayName: "Fabrikam" },
  { id: "t-c", displayName: "Northwind" },
];

const TENANT_GROUPS = [{ id: "g-eu", name: "EU customers", memberTenantIds: ["t-b", "t-c"] }];

const PREVIEW_OK: IntuneDeployPreview = {
  templateId: "tpl-1",
  preview: true,
  targetCount: 2,
  allValid: true,
  plans: [
    {
      tenantId: "t-a",
      policyName: "Win Baseline",
      action: "create",
      conflict: false,
      groupsToCreate: ["Pilot"],
      assignments: ["Pilot"],
      issues: [],
      diff: ["+ Create group: Pilot", "+ Policy: Win Baseline"],
      valid: true,
    },
    {
      tenantId: "t-b",
      policyName: "Win Baseline",
      action: "update",
      conflict: false,
      groupsToCreate: [],
      assignments: ["Pilot"],
      issues: [],
      diff: ["~ passwordMinimumLength: 8 -> 12"],
      valid: true,
    },
  ],
};

function renderDrawer(overrides: Partial<React.ComponentProps<typeof IntuneDeployDrawer>> = {}) {
  const onClose = vi.fn();
  const onDeployed = vi.fn();
  render(
    <IntuneDeployDrawer
      templates={TEMPLATES}
      initialTemplateId="tpl-1"
      tenants={TENANTS}
      tenantGroups={TENANT_GROUPS}
      onClose={onClose}
      onDeployed={onDeployed}
      {...overrides}
    />,
  );
  return { onClose, onDeployed };
}

describe("resolveDeployTargets (T-0307)", () => {
  it("unions tenants with tenant-group members without duplicates", () => {
    expect(resolveDeployTargets(["t-a", "t-b"], ["g-eu"], TENANT_GROUPS)).toEqual(["t-a", "t-b", "t-c"]);
    expect(resolveDeployTargets([], [], TENANT_GROUPS)).toEqual([]);
  });
});

describe("IntuneDeployDrawer — §3.2 controls (T-0307)", () => {
  it("exposes template pick, assignment mode, policy state, overwrite, and create-groups", () => {
    renderDrawer();
    expect((screen.getByLabelText("Template") as HTMLSelectElement).value).toBe("tpl-1");
    expect(screen.getByLabelText("Assignment mode")).toBeDefined();
    expect(screen.getByLabelText("Policy state")).toBeDefined();
    expect(screen.getByRole("switch", { name: /Overwrite/ })).toBeDefined();
    const createGroups = screen.getByRole("switch", { name: /Create groups/ }) as HTMLInputElement;
    expect(createGroups.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Assignment mode"), { target: { value: "groups" } });
    expect(createGroups.disabled).toBe(false);
    expect(screen.getByLabelText(/Groups to assign/)).toBeDefined();
  });

  it("shows the target tenant and group count before apply", () => {
    renderDrawer();
    const count = screen.getByTestId("target-count");
    expect(count.textContent).toMatch(/Deploying to 0 tenants/);
    fireEvent.click(screen.getByLabelText("Contoso"));
    fireEvent.click(screen.getByLabelText("EU customers (2)"));
    expect(count.textContent).toMatch(/Deploying to 3 tenants/);
    fireEvent.change(screen.getByLabelText("Assignment mode"), { target: { value: "groups" } });
    fireEvent.change(screen.getByLabelText(/Groups to assign/), { target: { value: "Pilot, Finance" } });
    expect(count.textContent).toMatch(/2 assignment groups/);
    expect(screen.getByRole("button", { name: "Apply to 3 tenants" })).toBeDefined();
  });

  it("requires a target before previewing", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderDrawer();
    fireEvent.click(screen.getByText("Preview plan"));
    expect(screen.getByRole("alert").textContent).toMatch(/at least one target/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("IntuneDeployDrawer — plan and apply (T-0307)", () => {
  it("previews the per-target plan with the §3.2 options before enabling apply", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, PREVIEW_OK));
    vi.stubGlobal("fetch", fetchMock);
    renderDrawer();

    const apply = () => screen.getByRole("button", { name: /Apply to/ }) as HTMLButtonElement;
    fireEvent.click(screen.getByLabelText("Contoso"));
    fireEvent.click(screen.getByLabelText("Fabrikam"));
    fireEvent.change(screen.getByLabelText("Assignment mode"), { target: { value: "groups" } });
    fireEvent.change(screen.getByLabelText(/Groups to assign/), { target: { value: "Pilot" } });
    fireEvent.click(screen.getByRole("switch", { name: /Create groups/ }));
    fireEvent.click(screen.getByRole("switch", { name: /Overwrite/ }));
    expect(apply().disabled).toBe(true);

    fireEvent.click(screen.getByText("Preview plan"));
    const plan = await screen.findByRole("region", { name: "Deploy plan" });
    expect(within(plan).getByText("+ Create group: Pilot")).toBeDefined();
    expect(within(screen.getByTestId("plan-t-b")).getByText("~ passwordMinimumLength: 8 -> 12")).toBeDefined();
    expect(within(screen.getByTestId("plan-t-b")).getByText("update 'Win Baseline'")).toBeDefined();
    expect(apply().disabled).toBe(false);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/v1/intune-templates/tpl-1/deploy");
    expect(JSON.parse(init.body)).toEqual({
      targets: ["t-a", "t-b"],
      assignmentMode: "groups",
      groups: ["Pilot"],
      policyState: "enabled",
      overwrite: true,
      createGroups: true,
      preview: true,
    });
  });

  it("discards the plan when an option changes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, PREVIEW_OK)));
    renderDrawer();
    fireEvent.click(screen.getByLabelText("Contoso"));
    fireEvent.click(screen.getByText("Preview plan"));
    await screen.findByRole("region", { name: "Deploy plan" });
    fireEvent.change(screen.getByLabelText("Policy state"), { target: { value: "disabled" } });
    expect(screen.queryByRole("region", { name: "Deploy plan" })).toBeNull();
    expect((screen.getByRole("button", { name: /Apply to/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps apply disabled when any target is blocked", async () => {
    const blocked: IntuneDeployPreview = {
      ...PREVIEW_OK,
      allValid: false,
      plans: [
        PREVIEW_OK.plans[0]!,
        { ...PREVIEW_OK.plans[1]!, valid: false, conflict: true, conflictMessage: "Enable overwrite to update it." },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, blocked)));
    renderDrawer();
    fireEvent.click(screen.getByLabelText("Contoso"));
    fireEvent.click(screen.getByText("Preview plan"));
    await screen.findByText("Enable overwrite to update it.");
    expect(within(screen.getByTestId("plan-t-b")).getByText("blocked")).toBeDefined();
    expect((screen.getByRole("button", { name: /Apply to/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("applies with the confirmed target count and renders per-target results", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, PREVIEW_OK))
      .mockResolvedValueOnce(
        jsonResponse(207, {
          templateId: "tpl-1",
          targetCount: 2,
          success: true,
          summary: { succeeded: 1, partial: 1, failed: 0 },
          results: [
            { tenantId: "t-a", state: "succeeded", policyId: "p1", steps: [] },
            {
              tenantId: "t-b",
              state: "partial",
              policyId: "p2",
              steps: [{ step: "assign", target: "Pilot", status: "failed", error: "403 Forbidden" }],
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { onDeployed } = renderDrawer();
    fireEvent.click(screen.getByLabelText("Contoso"));
    fireEvent.click(screen.getByLabelText("Fabrikam"));
    fireEvent.click(screen.getByText("Preview plan"));
    await screen.findByRole("region", { name: "Deploy plan" });
    fireEvent.click(screen.getByRole("button", { name: "Apply to 2 tenants" }));

    const results = await screen.findByRole("region", { name: "Deploy results" });
    expect(within(results).getByText("1 succeeded · 1 partial · 0 failed")).toBeDefined();
    expect(within(screen.getByTestId("result-t-b")).getByText("partial")).toBeDefined();
    expect(within(screen.getByTestId("result-t-b")).getByText("assign (Pilot) failed: 403 Forbidden")).toBeDefined();
    const body = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(body).toMatchObject({ preview: false, confirmTargetCount: 2, targets: ["t-a", "t-b"] });
    expect(onDeployed).toHaveBeenCalledTimes(1);
  });
});

describe("IntuneTemplateTable (T-0307)", () => {
  it("lists templates with all row actions and filters by type", () => {
    const onAction = vi.fn();
    render(<IntuneTemplateTable templates={TEMPLATES} onAction={onAction} onDeploy={vi.fn()} />);
    for (const label of ["Deploy", "Edit", "Clone", "Export", "Delete"]) {
      fireEvent.click(screen.getByLabelText(`${label} Win Baseline`));
    }
    expect(onAction.mock.calls.map((c) => c[0])).toEqual(["deploy", "edit", "clone", "export", "delete"]);
    fireEvent.change(screen.getByLabelText("Filter by type"), { target: { value: "configuration" } });
    expect(screen.queryByTestId("template-tpl-1")).toBeNull();
    expect(screen.getByTestId("template-tpl-2")).toBeDefined();
  });

  it("edit dialog validates policy JSON against the registry before saving", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<IntuneTemplateEditDialog template={TEMPLATES[0]!} onSave={onSave} onClose={onClose} />);
    const editor = screen.getByLabelText("Policy JSON");
    fireEvent.change(editor, { target: { value: '{"@odata.type":"#microsoft.graph.iosCompliancePolicy"}' } });
    fireEvent.click(screen.getByText("Save"));
    expect(screen.getByRole("alert").textContent).toMatch(/@odata.type must be/);
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(editor, { target: { value: '{"displayName":"Win Baseline v2"}' } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Win Baseline v2" } });
    fireEvent.click(screen.getByText("Save"));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith({ name: "Win Baseline v2", policyJson: { displayName: "Win Baseline v2" } });
  });
});
