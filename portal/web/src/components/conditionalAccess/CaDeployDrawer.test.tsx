/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { CaDeployDrawer } from "./CaDeployDrawer";
import type { CaDeployPlan, CaDeployResult, CaTemplate } from "../../lib/caApi";

afterEach(() => {
  cleanup();
});

const SAMPLE_TEMPLATE: CaTemplate = {
  id: "tmpl-mfa",
  name: "Require MFA Baseline",
  source: "local",
  category: "Identity",
  version: 1,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  deletedAt: null,
  policyJson: {
    displayName: "Require MFA Baseline",
    conditions: {
      users: { includeUsers: ["All"] },
    },
    grantControls: { builtInControls: ["mfa"] },
  },
};

describe("CaDeployDrawer component (T-0287)", () => {
  it("renders drawer with all controls and defaults state to report-only", () => {
    const onClose = vi.fn();

    render(
      <CaDeployDrawer
        template={SAMPLE_TEMPLATE}
        tenantId="tenant-test"
        isOpen={true}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("Deploy CA Template")).toBeTruthy();
    expect(screen.getByDisplayValue("Require MFA Baseline")).toBeTruthy();

    // Policy state radio defaults to report-only
    const reportOnlyRadio = screen.getByTestId("state-reportonly") as HTMLInputElement;
    expect(reportOnlyRadio.checked).toBe(true);

    const onRadio = screen.getByTestId("state-enabled") as HTMLInputElement;
    expect(onRadio.checked).toBe(false);

    // Group/user handling defaults to all
    const allRadio = screen.getByTestId("handling-all") as HTMLInputElement;
    expect(allRadio.checked).toBe(true);

    // Switches present
    expect(screen.getByTestId("switch-overwrite")).toBeTruthy();
    expect(screen.getByTestId("switch-disable-security-defaults")).toBeTruthy();
    expect(screen.getByTestId("switch-create-groups")).toBeTruthy();
  });

  it("surfaces explicit callout when disable-security-defaults is checked", () => {
    render(
      <CaDeployDrawer
        template={SAMPLE_TEMPLATE}
        tenantId="tenant-test"
        isOpen={true}
        onClose={vi.fn()}
      />,
    );

    // Callout should not be present initially
    expect(screen.queryByTestId("security-defaults-callout")).toBeNull();

    // Check disable-security-defaults
    const secDefaultsSwitch = screen.getByTestId("switch-disable-security-defaults");
    fireEvent.click(secDefaultsSwitch);

    // Explicit callout must now appear
    expect(screen.getByTestId("security-defaults-callout")).toBeTruthy();
    expect(screen.getByText(/Disabling Security Defaults will allow custom Conditional Access/)).toBeTruthy();
  });

  it("generates plan preview and renders diff before deploy", async () => {
    const fakePlan: CaDeployPlan = {
      action: "create",
      tenantId: "tenant-test",
      templateId: "tmpl-mfa",
      policyName: "Require MFA Baseline",
      policyState: "enabledForReportingButNotEnforced",
      disableSecurityDefaults: true,
      overwrite: false,
      conflict: false,
      diff: [
        "! Security Defaults will be disabled in the target tenant",
        "+ Policy: Require MFA Baseline (State: enabledForReportingButNotEnforced)",
      ],
      groupsToCreate: [],
      valid: true,
      dryRun: true,
    };
    const onPreview = vi.fn().mockResolvedValue(fakePlan);

    render(
      <CaDeployDrawer
        template={SAMPLE_TEMPLATE}
        tenantId="tenant-test"
        isOpen={true}
        onClose={vi.fn()}
        onPreviewPlan={onPreview}
      />,
    );

    const previewBtn = screen.getByTestId("preview-deploy-btn");
    fireEvent.click(previewBtn);

    expect(onPreview).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByTestId("ca-deploy-plan-box")).toBeTruthy();
    });

    expect(screen.getByText("! Security Defaults will be disabled in the target tenant")).toBeTruthy();
    expect(screen.getByText("+ Policy: Require MFA Baseline (State: enabledForReportingButNotEnforced)")).toBeTruthy();
  });

  it("executes deploy and displays success message", async () => {
    const fakeResult: CaDeployResult = {
      success: true,
      plan: {
        action: "create",
        tenantId: "tenant-test",
        templateId: "tmpl-mfa",
        policyName: "Require MFA Baseline",
        policyState: "enabledForReportingButNotEnforced",
        disableSecurityDefaults: false,
        overwrite: false,
        conflict: false,
        diff: ["+ Policy deployed"],
        groupsToCreate: [],
        valid: true,
        dryRun: false,
      },
      result: { id: "new-policy-id" },
    };
    const onExecute = vi.fn().mockResolvedValue(fakeResult);

    render(
      <CaDeployDrawer
        template={SAMPLE_TEMPLATE}
        tenantId="tenant-test"
        isOpen={true}
        onClose={vi.fn()}
        onExecuteDeploy={onExecute}
      />,
    );

    const deployBtn = screen.getByTestId("execute-deploy-btn");
    fireEvent.click(deployBtn);

    expect(onExecute).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByTestId("ca-deploy-success")).toBeTruthy();
    });

    expect(screen.getByText("Deployment Succeeded!")).toBeTruthy();
  });
});
