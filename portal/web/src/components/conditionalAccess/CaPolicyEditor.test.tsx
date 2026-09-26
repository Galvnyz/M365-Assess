/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import { CaPolicyEditor } from "./CaPolicyEditor";
import type { CaPlan, CaPolicyItem } from "../../lib/caApi";

afterEach(() => {
  cleanup();
});

const EXISTING_POLICY: CaPolicyItem = {
  id: "ca-100",
  name: "Enforce MFA for Admins",
  displayName: "Enforce MFA for Admins",
  state: "enabled",
  usersTargeted: {
    includeUsers: ["All"],
    excludeUsers: ["breakglass@contoso.com"],
    excludeRoles: ["62e90394-69f5-4237-9190-012177145e10"],
    summary: "All users (excludes 2)",
  },
  apps: {
    includeApplications: ["All"],
    summary: "All cloud apps",
  },
  grantControls: {
    operator: "OR",
    builtInControls: ["mfa"],
    summary: "Grant: mfa",
  },
  conditions: {
    clientAppTypes: ["browser"],
    summary: "Client apps: browser",
  },
};

describe("CaPolicyEditor component (T-0284)", () => {
  it("renders with default report-only state selected for new policies", () => {
    render(<CaPolicyEditor isNew={true} />);

    expect(screen.getByText("New Conditional Access Policy")).toBeTruthy();
    expect(screen.getByTestId("ca-policy-name-input")).toBeTruthy();

    const reportOnlyRadio = screen.getByTestId("ca-state-reportonly") as HTMLInputElement;
    expect(reportOnlyRadio.checked).toBe(true);

    const onRadio = screen.getByTestId("ca-state-on") as HTMLInputElement;
    expect(onRadio.checked).toBe(false);
  });

  it("warns when All users is targeted with no admin role exclusion", () => {
    render(<CaPolicyEditor isNew={true} />);

    // Default includes "All" with empty exclusions -> should show warning banner
    expect(screen.getByTestId("ca-warning-banner")).toBeTruthy();
    expect(screen.getByText(/Policy targets/)).toBeTruthy();

    // Click quick add break-glass button in warning
    const quickAddBtn = screen.getByTestId("warning-quick-add-btn");
    fireEvent.click(quickAddBtn);

    // Warning should disappear
    expect(screen.queryByTestId("ca-warning-banner")).toBeNull();
    // Excluded chip should appear
    expect(screen.getByText("breakglass@contoso.com")).toBeTruthy();
  });

  it("hard-blocks All users + Block control without break-glass exclusion", () => {
    render(<CaPolicyEditor isNew={true} />);

    // Select Block control
    const blockRadio = screen.getByTestId("ca-control-block");
    fireEvent.click(blockRadio);

    // Hard-block error banner should appear
    expect(screen.getByTestId("ca-hardblock-banner")).toBeTruthy();
    expect(screen.getByText(/Cannot target/)).toBeTruthy();

    // Apply button should be disabled
    const applyBtn = screen.getByTestId("apply-policy-btn") as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);

    // Click + Add Break-Glass Exclusion in hard-block banner
    const addBreakGlassBtn = screen.getByTestId("hardblock-quick-add-btn");
    fireEvent.click(addBreakGlassBtn);

    // Hard-block banner should disappear and apply button should be enabled
    expect(screen.queryByTestId("ca-hardblock-banner")).toBeNull();
    expect(applyBtn.disabled).toBe(false);
  });

  it("executes preview plan and renders JSON diff lines", async () => {
    const fakePlan: CaPlan = {
      action: "create",
      policyId: "new-ca-1",
      targetName: "Test Policy",
      diff: [
        "+ Policy: Test Policy (State: enabledForReportingButNotEnforced)",
        "+ Conditions: All users",
        "+ Controls: mfa",
      ],
      valid: true,
      dryRun: true,
      requiresConfirmation: false,
    };
    const onPreview = vi.fn().mockResolvedValue(fakePlan);

    render(<CaPolicyEditor isNew={true} onPreviewPlan={onPreview} />);

    const nameInput = screen.getByTestId("ca-policy-name-input");
    fireEvent.change(nameInput, { target: { value: "Test Policy" } });

    const previewBtn = screen.getByTestId("preview-plan-btn");
    fireEvent.click(previewBtn);

    expect(onPreview).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByTestId("ca-plan-preview-box")).toBeTruthy();
    });
    expect(screen.getByText("+ Policy: Test Policy (State: enabledForReportingButNotEnforced)")).toBeTruthy();
    expect(screen.getByText("+ Controls: mfa")).toBeTruthy();
  });

  it("submits configured payload on apply", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<CaPolicyEditor initialPolicy={EXISTING_POLICY} isNew={false} onSave={onSave} />);

    const applyBtn = screen.getByTestId("apply-policy-btn");
    await fireEvent.click(applyBtn);

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    expect(payload.displayName).toBe("Enforce MFA for Admins");
    expect(payload.state).toBe("enabled");
    expect(payload.grantControls.builtInControls).toContain("mfa");
  });
});
