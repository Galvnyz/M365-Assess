/** @vitest-environment jsdom */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ResetMfaDialog } from "./ResetMfaDialog";
import { TapDialog, SendPushDialog, DefaultMethodDialog } from "./TapDialog";
import * as mfaApi from "../../lib/mfaApi";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const USER_1 = {
  userId: "user-1",
  userPrincipalName: "alice@example.invalid",
  displayName: "Alice Admin",
  methods: ["fido2", "microsoftAuthenticator"],
  defaultMethod: "fido2",
};

const USER_2 = {
  userId: "user-2",
  userPrincipalName: "bob@example.invalid",
  displayName: "Bob User",
  methods: ["sms"],
  defaultMethod: "sms",
};

describe("ResetMfaDialog (T-0229)", () => {
  it("renders warning banner and single reset form requiring reason and confirmation", async () => {
    const resetSpy = vi.spyOn(mfaApi, "resetUserMfa").mockResolvedValue({
      userId: "user-1",
      status: "applied",
      methods: [],
      state: "notRegistered",
      error: null,
    });
    const onSuccess = vi.fn();
    const onClose = vi.fn();

    render(
      <ResetMfaDialog
        isOpen={true}
        onClose={onClose}
        tenantId="tenant-123"
        targetUsers={[USER_1]}
        onSuccess={onSuccess}
      />,
    );

    expect(screen.getByTestId("reset-mfa-dialog")).toBeTruthy();
    expect(screen.getByTestId("reset-mfa-warning")).toBeTruthy();

    const submitBtn = screen.getByTestId("reset-submit-button") as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    // Enter reason only - still disabled because confirmation checkbox is not checked
    fireEvent.change(screen.getByTestId("reset-reason-input"), { target: { value: "User lost device" } });
    expect(submitBtn.disabled).toBe(true);

    // Check confirmation checkbox - now enabled
    fireEvent.click(screen.getByTestId("reset-confirm-checkbox"));
    expect(submitBtn.disabled).toBe(false);

    // Submit form
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(resetSpy).toHaveBeenCalledWith("tenant-123", "user-1", {
        reason: "User lost device",
        confirm: true,
      });
      expect(screen.getByTestId("reset-success-message")).toBeTruthy();
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it("handles single reset failure inline", async () => {
    vi.spyOn(mfaApi, "resetUserMfa").mockResolvedValue({
      userId: "user-1",
      status: "failed",
      methods: ["fido2"],
      state: "registered",
      error: "Graph API timeout",
    });

    render(
      <ResetMfaDialog
        isOpen={true}
        onClose={vi.fn()}
        tenantId="tenant-123"
        targetUsers={[USER_1]}
      />,
    );

    fireEvent.change(screen.getByTestId("reset-reason-input"), { target: { value: "Incident 42" } });
    fireEvent.click(screen.getByTestId("reset-confirm-checkbox"));
    fireEvent.click(screen.getByTestId("reset-submit-button"));

    await waitFor(() => {
      expect(screen.getByTestId("reset-error-message").textContent).toContain("Graph API timeout");
    });
  });

  it("requires count confirmation for batch reset (EPIC-006 pattern)", async () => {
    const bulkSpy = vi.spyOn(mfaApi, "bulkResetMfa").mockResolvedValue({
      rows: [
        { userId: "user-1", status: "applied", methods: [], state: "notRegistered", error: null },
        { userId: "user-2", status: "applied", methods: [], state: "notRegistered", error: null },
      ],
      summary: { total: 2, applied: 2, planned: 0, failed: 0 },
    });
    const onSuccess = vi.fn();

    render(
      <ResetMfaDialog
        isOpen={true}
        onClose={vi.fn()}
        tenantId="tenant-123"
        targetUsers={[USER_1, USER_2]}
        onSuccess={onSuccess}
      />,
    );

    const submitBtn = screen.getByTestId("reset-submit-button") as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    fireEvent.change(screen.getByTestId("reset-reason-input"), { target: { value: "Security compromise" } });
    fireEvent.click(screen.getByTestId("reset-confirm-checkbox"));
    // Count not matching yet
    fireEvent.change(screen.getByTestId("reset-confirm-count-input"), { target: { value: "1" } });
    expect(submitBtn.disabled).toBe(true);

    // Exact count matching
    fireEvent.change(screen.getByTestId("reset-confirm-count-input"), { target: { value: "2" } });
    expect(submitBtn.disabled).toBe(false);

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(bulkSpy).toHaveBeenCalledWith("tenant-123", {
        userIds: ["user-1", "user-2"],
        reason: "Security compromise",
        confirmCount: 2,
        confirm: true,
      });
      expect(screen.getByTestId("reset-success-message").textContent).toContain("2 users");
      expect(onSuccess).toHaveBeenCalled();
    });
  });
});

describe("TapDialog (T-0229)", () => {
  it("creates TAP and shows pass value once with copy button and warning", async () => {
    const tapSpy = vi.spyOn(mfaApi, "createTemporaryAccessPass").mockResolvedValue({
      id: "tap-record-1",
      userId: "user-1",
      status: "applied",
      lifetimeMinutes: 60,
      oneTime: true,
      startTime: null,
      expiresAt: "2026-09-26T18:00:00Z",
      temporaryAccessPass: "ABCD-1234-EFGH",
      error: null,
    });
    const onSuccess = vi.fn();

    // Mock clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    render(
      <TapDialog
        isOpen={true}
        onClose={vi.fn()}
        tenantId="tenant-123"
        user={USER_1}
        onSuccess={onSuccess}
      />,
    );

    expect(screen.getByTestId("tap-dialog")).toBeTruthy();
    expect(screen.getByTestId("tap-lifetime-input")).toBeTruthy();
    expect(screen.getByTestId("tap-onetime-input")).toBeTruthy();

    fireEvent.change(screen.getByTestId("tap-lifetime-input"), { target: { value: "120" } });
    fireEvent.change(screen.getByTestId("tap-reason-input"), { target: { value: "VIP user onboarding" } });

    fireEvent.click(screen.getByTestId("tap-submit-button"));

    await waitFor(() => {
      expect(tapSpy).toHaveBeenCalledWith("tenant-123", "user-1", expect.objectContaining({
        lifetimeMinutes: 120,
        oneTime: true,
        reason: "VIP user onboarding",
        confirm: true,
      }));
      expect(screen.getByTestId("tap-value-display").textContent).toBe("ABCD-1234-EFGH");
      expect(screen.getByTestId("tap-once-warning")).toBeTruthy();
      expect(screen.getByTestId("tap-copy-button")).toBeTruthy();
      expect(onSuccess).toHaveBeenCalled();
    });

    // Test copy control
    fireEvent.click(screen.getByTestId("tap-copy-button"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("ABCD-1234-EFGH");
  });

  it("handles TAP creation failure inline", async () => {
    vi.spyOn(mfaApi, "createTemporaryAccessPass").mockResolvedValue({
      id: null,
      userId: "user-1",
      status: "failed",
      lifetimeMinutes: 60,
      oneTime: true,
      startTime: null,
      expiresAt: null,
      temporaryAccessPass: null,
      error: "Tenant TAP policy is disabled",
    });

    render(
      <TapDialog
        isOpen={true}
        onClose={vi.fn()}
        tenantId="tenant-123"
        user={USER_1}
      />,
    );

    fireEvent.click(screen.getByTestId("tap-submit-button"));

    await waitFor(() => {
      expect(screen.getByTestId("tap-error-message").textContent).toContain("Tenant TAP policy is disabled");
    });
  });
});

describe("SendPushDialog (T-0229)", () => {
  it("sends push notification and renders inline success", async () => {
    const pushSpy = vi.spyOn(mfaApi, "sendPushNotification").mockResolvedValue({
      userId: "user-1",
      status: "applied",
      pushTarget: "iPhone 15 Pro",
      error: null,
    });
    const onSuccess = vi.fn();

    render(
      <SendPushDialog
        isOpen={true}
        onClose={vi.fn()}
        tenantId="tenant-123"
        user={USER_1}
        onSuccess={onSuccess}
      />,
    );

    fireEvent.change(screen.getByTestId("push-reason-input"), { target: { value: "Verify MFA registration" } });
    fireEvent.click(screen.getByTestId("push-submit-button"));

    await waitFor(() => {
      expect(pushSpy).toHaveBeenCalledWith("tenant-123", "user-1", {
        reason: "Verify MFA registration",
        confirm: true,
      });
      expect(screen.getByTestId("push-success-message").textContent).toContain("iPhone 15 Pro");
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it("renders inline error on push failure", async () => {
    vi.spyOn(mfaApi, "sendPushNotification").mockResolvedValue({
      userId: "user-1",
      status: "failed",
      pushTarget: null,
      error: "Device not reachable",
    });

    render(
      <SendPushDialog
        isOpen={true}
        onClose={vi.fn()}
        tenantId="tenant-123"
        user={USER_1}
      />,
    );

    fireEvent.click(screen.getByTestId("push-submit-button"));

    await waitFor(() => {
      expect(screen.getByTestId("push-error-message").textContent).toContain("Device not reachable");
    });
  });
});

describe("DefaultMethodDialog (T-0229)", () => {
  it("limits options strictly to user's registered methods and updates default method", async () => {
    const methodSpy = vi.spyOn(mfaApi, "setUserDefaultMethod").mockResolvedValue({
      userId: "user-1",
      status: "applied",
      methods: ["fido2", "microsoftAuthenticator"],
      defaultMethod: "microsoftAuthenticator",
      error: null,
    });
    const onSuccess = vi.fn();

    render(
      <DefaultMethodDialog
        isOpen={true}
        onClose={vi.fn()}
        tenantId="tenant-123"
        user={USER_1}
        onSuccess={onSuccess}
      />,
    );

    const select = screen.getByTestId("default-method-select") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(["fido2", "microsoftAuthenticator"]);
    expect(options).not.toContain("sms");

    fireEvent.change(select, { target: { value: "microsoftAuthenticator" } });
    fireEvent.change(screen.getByTestId("default-method-reason-input"), { target: { value: "Switch default" } });
    fireEvent.click(screen.getByTestId("default-method-submit-button"));

    await waitFor(() => {
      expect(methodSpy).toHaveBeenCalledWith("tenant-123", "user-1", {
        method: "microsoftAuthenticator",
        reason: "Switch default",
        confirm: true,
      });
      expect(screen.getByTestId("default-method-success-message").textContent).toContain("microsoftAuthenticator");
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it("shows warning when user has no registered methods", () => {
    render(
      <DefaultMethodDialog
        isOpen={true}
        onClose={vi.fn()}
        tenantId="tenant-123"
        user={{ ...USER_1, methods: [] }}
      />,
    );

    expect(screen.getByTestId("no-methods-warning")).toBeTruthy();
    expect(screen.queryByTestId("default-method-select")).toBeNull();
  });
});

describe("Report theme token enforcement (T-0229)", () => {
  it("uses report theme tokens and zero colour literals", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = (await import("node:path")).default;
    const currentDir = path.dirname(fileURLToPath(import.meta.url));

    const files = [
      path.join(currentDir, "ResetMfaDialog.tsx"),
      path.join(currentDir, "TapDialog.tsx"),
    ];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} contains hex color literal`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(source, `${file} contains rgb color literal`).not.toMatch(/\brgba?\s*\(/i);
      expect(source, `${file} contains hsl color literal`).not.toMatch(/\bhsla?\s*\(/i);
      expect(source, `${file} missing theme token var(--`).toContain("var(--");
    }
  });
});
