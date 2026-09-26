/** @vitest-environment jsdom */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { GroupForm } from "./GroupForm";
import * as groupsApi from "../../lib/groupsApi";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("GroupForm (T-0264)", () => {
  it("renders form fields and handles dynamic rule editing and validation", async () => {
    render(<GroupForm tenantId="tenant-test" mode="create" />);

    expect(screen.getByTestId("input-group-type")).toBeTruthy();
    expect(screen.getByTestId("input-group-name")).toBeTruthy();
    expect(screen.getByTestId("input-group-description")).toBeTruthy();
    expect(screen.getByTestId("input-hidden-gal")).toBeTruthy();
    expect(screen.getByTestId("input-delivery-mgmt")).toBeTruthy();

    // Select dynamic type
    fireEvent.change(screen.getByTestId("input-group-type"), { target: { value: "dynamic" } });

    // Dynamic rule editor appears
    expect(screen.getByTestId("dynamic-rule-editor")).toBeTruthy();

    // Type invalid rule
    fireEvent.change(screen.getByTestId("dynamic-rule-input"), {
      target: { value: "invalid rule without parentheses" },
    });

    expect(screen.getByTestId("dynamic-rule-error")).toBeTruthy();
    expect(screen.getByTestId("dynamic-rule-error").textContent).toContain("parentheses");

    // Type valid rule
    fireEvent.change(screen.getByTestId("dynamic-rule-input"), {
      target: { value: '(user.department -eq "Sales")' },
    });

    expect(screen.queryByTestId("dynamic-rule-error")).toBeNull();
  });

  it("submits preview request to API and renders returned plan diff", async () => {
    const createSpy = vi.spyOn(groupsApi, "createGroup").mockResolvedValue({
      action: "create",
      targetName: "Engineering Alpha",
      diff: ["Create security group 'Engineering Alpha'"],
      valid: true,
      dryRun: true,
      requiresConfirmation: false,
    });

    render(<GroupForm tenantId="tenant-test" mode="create" />);

    fireEvent.change(screen.getByTestId("input-group-name"), {
      target: { value: "Engineering Alpha" },
    });

    fireEvent.click(screen.getByTestId("btn-preview-plan"));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith("tenant-test", expect.objectContaining({
        displayName: "Engineering Alpha",
        preview: true,
      }));
    });

    expect(screen.getByTestId("plan-diff-preview")).toBeTruthy();
    expect(screen.getByTestId("diff-item-0").textContent).toBe("Create security group 'Engineering Alpha'");
    expect(screen.getByTestId("btn-confirm-apply")).toBeTruthy();
  });

  it("applies changes when Confirm & Apply is clicked and calls onSuccess", async () => {
    vi.spyOn(groupsApi, "createGroup")
      .mockResolvedValueOnce({
        action: "create",
        targetName: "Test Group",
        diff: ["Create group 'Test Group'"],
        valid: true,
        dryRun: true,
        requiresConfirmation: false,
      })
      .mockResolvedValueOnce({
        success: true,
        plan: {
          action: "create",
          targetName: "Test Group",
          diff: [],
          valid: true,
          dryRun: false,
          requiresConfirmation: false,
        },
        result: { id: "grp-new-1", displayName: "Test Group" },
      });

    const onSuccess = vi.fn();
    render(<GroupForm tenantId="tenant-test" mode="create" onSuccess={onSuccess} />);

    fireEvent.change(screen.getByTestId("input-group-name"), {
      target: { value: "Test Group" },
    });

    fireEvent.click(screen.getByTestId("btn-preview-plan"));

    await waitFor(() => {
      expect(screen.getByTestId("btn-confirm-apply")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("btn-confirm-apply"));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
      }));
    });
  });
});
