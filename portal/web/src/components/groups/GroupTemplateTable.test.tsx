/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import { GroupTemplateTable } from "./GroupTemplateTable";
import type { GroupTemplate } from "../../lib/groupsApi";
import * as groupsApi from "../../lib/groupsApi";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SAMPLE_TEMPLATES: GroupTemplate[] = [
  {
    id: "tpl-1",
    name: "Engineering Team Template",
    groupType: "m365",
    naming: {
      prefix: "ENG-",
      suffix: "-Team",
      pattern: "{prefix}{name}{suffix}",
      conflictBehavior: "block",
    },
    owners: ["alice@contoso.com"],
    members: ["bob@contoso.com", "carol@contoso.com"],
    licensing: ["SPE_E5"],
  },
  {
    id: "tpl-2",
    name: "Security Distro Template",
    groupType: "distribution",
    naming: {
      prefix: "DL-",
      suffix: "",
      conflictBehavior: "appendSuffix",
    },
    owners: [],
    members: [],
    licensing: [],
  },
];

describe("GroupTemplateTable and DeployWizard (T-0267)", () => {
  it("renders templates table with naming policy and row actions", () => {
    render(<GroupTemplateTable templates={SAMPLE_TEMPLATES} />);

    expect(screen.getByText("Engineering Team Template")).toBeTruthy();
    expect(screen.getByText("Security Distro Template")).toBeTruthy();

    const row1 = screen.getByTestId("template-row-tpl-1");
    expect(within(row1).getByText("ENG-{name}-Team")).toBeTruthy();
    expect(within(row1).getByText("Block")).toBeTruthy();

    const row2 = screen.getByTestId("template-row-tpl-2");
    expect(within(row2).getByText("DL-{name}")).toBeTruthy();
    expect(within(row2).getByText("Append suffix")).toBeTruthy();
  });

  it("opens create form and submits naming policy and details", async () => {
    const onCreate = vi.fn();
    render(<GroupTemplateTable templates={SAMPLE_TEMPLATES} onCreate={onCreate} />);

    fireEvent.click(screen.getByTestId("btn-add-template"));
    expect(screen.getByTestId("template-form-modal")).toBeTruthy();

    fireEvent.change(screen.getByTestId("input-template-name"), {
      target: { value: "Finance Standard" },
    });
    fireEvent.change(screen.getByTestId("input-naming-prefix"), {
      target: { value: "FIN-" },
    });
    fireEvent.change(screen.getByTestId("input-naming-suffix"), {
      target: { value: "-Grp" },
    });
    fireEvent.change(screen.getByTestId("input-naming-conflict"), {
      target: { value: "appendSuffix" },
    });

    fireEvent.click(screen.getByTestId("btn-save-template"));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Finance Standard",
        naming: {
          prefix: "FIN-",
          suffix: "-Grp",
          pattern: undefined,
          conflictBehavior: "appendSuffix",
        },
      }),
    );
  });

  it("walks through DeployWizard steps and renders plan and results", async () => {
    vi.spyOn(groupsApi, "deployGroupTemplate")
      .mockResolvedValueOnce({
        templateId: "tpl-1",
        preview: true,
        plans: [
          {
            tenantId: "tenant-a",
            targetName: "ENG-Engineering-Team",
            diff: ["Create group ENG-Engineering-Team"],
            valid: true,
            conflict: false,
          },
        ],
        allValid: true,
      } as any)
      .mockResolvedValueOnce({
        templateId: "tpl-1",
        success: true,
        deployments: [
          {
            id: "dep-1",
            templateId: "tpl-1",
            tenantId: "tenant-a",
            state: "succeeded",
            results: [{ step: "createGroup", status: "succeeded" }],
            createdBy: "admin",
          },
        ],
      } as any);

    render(<GroupTemplateTable templates={SAMPLE_TEMPLATES} />);

    // Click Deploy on row 1
    fireEvent.click(screen.getByTestId("action-deploy-tpl-1"));
    expect(screen.getByTestId("deploy-wizard")).toBeTruthy();
    expect(screen.getByTestId("wizard-step-1")).toBeTruthy();

    // Step 1: Targets
    fireEvent.change(screen.getByTestId("input-wizard-targets"), {
      target: { value: "tenant-a" },
    });
    fireEvent.click(screen.getByTestId("btn-wizard-next-1"));

    // Step 2: Variables
    expect(screen.getByTestId("wizard-step-2")).toBeTruthy();
    fireEvent.click(screen.getByTestId("btn-wizard-preview"));

    // Step 3: Plan Preview
    await waitFor(() => {
      expect(screen.getByTestId("wizard-step-3")).toBeTruthy();
    });
    expect(screen.getByTestId("plan-target-tenant-a")).toBeTruthy();
    expect(screen.getByText("ENG-Engineering-Team")).toBeTruthy();

    // Confirm & Deploy
    fireEvent.click(screen.getByTestId("btn-wizard-confirm"));

    // Step 4: Results
    await waitFor(() => {
      expect(screen.getByTestId("wizard-step-4")).toBeTruthy();
    });
    expect(screen.getByTestId("result-target-tenant-a")).toBeTruthy();
    expect(screen.getByTestId("state-target-tenant-a").textContent).toBe("succeeded");

    // Done button closes wizard
    fireEvent.click(screen.getByTestId("btn-wizard-done"));
    expect(screen.queryByTestId("deploy-wizard")).toBeNull();
  });
});
