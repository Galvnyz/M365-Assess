/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { BulkMembershipWizard } from "./BulkMembershipWizard";
import * as groupsApi from "../../lib/groupsApi";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("BulkMembershipWizard (T-0268)", () => {
  it("renders manual selection, parses input, generates preview diff, and applies changes", async () => {
    const invokeSpy = vi.spyOn(groupsApi, "invokeBulkMembership")
      .mockResolvedValueOnce({
        tenantId: "tenant-test",
        groupId: "grp-123",
        role: "members",
        operation: "add",
        total: 2,
        toAdd: 1,
        toRemove: 0,
        toSkip: 1,
        diff: ["Add alice@contoso.com to members"],
        planRows: [
          { user: "alice@contoso.com", action: "add", reason: "Will add" },
          { user: "bob@contoso.com", action: "skip", reason: "Already a member" },
        ],
        dryRun: true,
      })
      .mockResolvedValueOnce({
        success: true,
        plan: {} as any,
        results: [
          { user: "alice@contoso.com", status: "added" },
          { user: "bob@contoso.com", status: "skipped", reason: "Already a member" },
        ],
      });

    const onDone = vi.fn();
    render(
      <BulkMembershipWizard
        tenantId="tenant-test"
        groupId="grp-123"
        groupName="Engineering"
        onDone={onDone}
      />
    );

    expect(screen.getByTestId("bulk-step-1")).toBeTruthy();
    expect(screen.getByTestId("select-bulk-role")).toBeTruthy();
    expect(screen.getByTestId("select-bulk-operation")).toBeTruthy();
    expect(screen.getByTestId("input-bulk-users")).toBeTruthy();
    expect(screen.getByTestId("input-bulk-csv")).toBeTruthy();

    // Type users
    fireEvent.change(screen.getByTestId("input-bulk-users"), {
      target: { value: "alice@contoso.com\nbob@contoso.com" },
    });

    // Click Preview Diff
    fireEvent.click(screen.getByTestId("btn-bulk-preview"));

    await waitFor(() => {
      expect(screen.getByTestId("bulk-step-2")).toBeTruthy();
    });

    expect(invokeSpy).toHaveBeenCalledWith("tenant-test", "grp-123", "members", {
      operation: "add",
      users: ["alice@contoso.com", "bob@contoso.com"],
      preview: true,
    });

    expect(screen.getByTestId("bulk-diff-list")).toBeTruthy();
    expect(screen.getByText("Add alice@contoso.com to members")).toBeTruthy();

    // Confirm & Apply
    fireEvent.click(screen.getByTestId("btn-bulk-confirm"));

    await waitFor(() => {
      expect(screen.getByTestId("bulk-step-3")).toBeTruthy();
    });

    expect(invokeSpy).toHaveBeenCalledWith("tenant-test", "grp-123", "members", {
      operation: "add",
      users: ["alice@contoso.com", "bob@contoso.com"],
      preview: false,
    });

    expect(screen.getByTestId("row-result-alice@contoso.com")).toBeTruthy();
    expect(screen.getByTestId("row-result-bob@contoso.com")).toBeTruthy();

    // Click Done
    fireEvent.click(screen.getByTestId("btn-bulk-done"));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
