/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { OffboardingWizard, type OffboardingWizardApi } from "./OffboardingWizard";

afterEach(() => {
  cleanup();
});

const api: OffboardingWizardApi = {
  listUsers: async () => [
    {
      id: "user-1",
      displayName: "Member One",
      userPrincipalName: "member.one@example.invalid",
      userType: "member",
      licenses: [],
      mfaState: "unknown",
      lastSignInDateTime: null,
      status: "enabled",
      department: null,
    },
  ],
  listTemplates: async () => [],
  startJob: async (tenantId, userIds, options) => ({
    job: {
      id: "job-1",
      tenantId,
      userIds: [...userIds],
      options: { ...(options as Record<string, unknown>) },
      state: "running",
      createdAt: "2026-09-26T00:00:00.000Z",
      createdBy: "op",
    },
    steps: [
      { order: 1, action: "disable-sign-in", state: "succeeded", result: null, error: null, appliedAt: "x" },
      { order: 2, action: "remove-licenses", state: "failed", result: null, error: "boom", appliedAt: null },
    ],
  }),
  getProgress: async () => {
    throw new Error("no progress in smoke test");
  },
  rerunStep: async (jobId, order) => ({
    step: { order, action: "remove-licenses", state: "pending", result: null, error: null, appliedAt: null },
  }),
};

describe("OffboardingWizard (T-0210)", () => {
  it("collects tenant, users, options, mailbox access, confirms, and shows progress with re-run", async () => {
    const startJob = vi.spyOn(api, "startJob");
    render(<OffboardingWizard api={api} pollIntervalMs={60000} />);

    fireEvent.change(screen.getByTestId("wizard-tenant-input"), { target: { value: "tenant-a" } });
    fireEvent.click(screen.getByTestId("wizard-load-users-button"));
    await waitFor(() => expect(screen.getByTestId("wizard-select-user-user-1")).toBeTruthy());

    fireEvent.click(screen.getByTestId("wizard-select-user-user-1"));
    fireEvent.click(screen.getByTestId("wizard-option-convertMailbox"));
    fireEvent.click(screen.getByTestId("wizard-mailbox-mode-send-as"));
    fireEvent.click(screen.getByTestId("wizard-confirm-checkbox"));
    fireEvent.click(screen.getByTestId("wizard-submit-button"));

    await waitFor(() => expect(startJob).toHaveBeenCalledTimes(1));
    expect(startJob.mock.calls[0]?.[0]).toBe("tenant-a");
    expect(startJob.mock.calls[0]?.[1]).toEqual(["user-1"]);
    expect(startJob.mock.calls[0]?.[2]).toMatchObject({
      convertMailbox: true,
      mailboxAccess: { mode: "send-as", automap: false },
    });

    await waitFor(() => expect(screen.getByTestId("wizard-progress")).toBeTruthy());
    expect(screen.getByTestId("wizard-step-2").textContent).toContain("failed");
    expect(screen.getByTestId("wizard-rerun-2")).toBeTruthy();
    expect(screen.getByTestId("wizard-job-job-1")).toBeTruthy();

    fireEvent.click(screen.getByTestId("wizard-filter-running"));
    expect(screen.getByTestId("wizard-job-job-1")).toBeTruthy();
    fireEvent.click(screen.getByTestId("wizard-filter-completed"));
    expect(screen.queryByTestId("wizard-job-job-1")).toBeNull();
  });
});
