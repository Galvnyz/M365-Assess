/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { AuthMethodsPolicyEditor } from "./AuthMethodsPolicyEditor";
import { RegistrationCampaignPanel } from "./RegistrationCampaignPanel";
import * as authApi from "../../lib/authMethodsApi";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SAMPLE_PREVIEW: authApi.AuthMethodsPolicyPreview = {
  current: {
    methods: [
      { id: "fido2", state: "enabled" },
      { id: "phone", state: "enabled" },
      { id: "softwareOath", state: "enabled" },
    ],
  },
  proposed: {
    methods: [
      { id: "fido2", state: "enabled" },
      { id: "phone", state: "disabled" },
      { id: "softwareOath", state: "disabled" },
    ],
  },
  diff: [
    { id: "phone", before: "enabled", after: "disabled" },
    { id: "softwareOath", before: "enabled", after: "disabled" },
  ],
  applied: null,
};

const SAMPLE_CAMPAIGN: authApi.RegistrationCampaignState = {
  tenantId: "tenant-123",
  state: "enabled",
  snoozeDurationInDays: 3,
  includeTargets: ["all_users"],
  excludeTargets: ["break-glass-group"],
  eligibleUserCount: 142,
  retrievedAt: "2026-09-26T12:00:00Z",
};

describe("AuthMethodsPolicyEditor (T-0230)", () => {
  it("renders preset selector and previews current-vs-proposed diff before apply", async () => {
    const previewSpy = vi.spyOn(authApi, "previewAuthMethodsPolicy").mockResolvedValue(SAMPLE_PREVIEW);

    render(<AuthMethodsPolicyEditor tenantId="tenant-123" />);

    expect(screen.getByTestId("auth-methods-policy-editor")).toBeTruthy();
    expect(screen.getByTestId("preset-select")).toBeTruthy();

    // Select phishing-resistant preset
    fireEvent.change(screen.getByTestId("preset-select"), {
      target: { value: "phishingResistantRequired" },
    });

    // Click preview
    fireEvent.click(screen.getByTestId("preview-policy-button"));

    await waitFor(() => {
      expect(previewSpy).toHaveBeenCalledWith("tenant-123", { preset: "phishingResistantRequired" });
      expect(screen.getByTestId("policy-diff-table")).toBeTruthy();
      expect(screen.getByTestId("diff-row-phone")).toBeTruthy();
      expect(screen.getByTestId("diff-row-softwareOath")).toBeTruthy();
    });
  });

  it("requires reason and confirmation, and applies policy when caller holds mfa.policy", async () => {
    vi.spyOn(authApi, "previewAuthMethodsPolicy").mockResolvedValue(SAMPLE_PREVIEW);
    const applySpy = vi.spyOn(authApi, "applyAuthMethodsPolicy").mockResolvedValue({
      ...SAMPLE_PREVIEW,
      applied: SAMPLE_PREVIEW.proposed,
    });
    const onApplySuccess = vi.fn();

    render(
      <AuthMethodsPolicyEditor
        tenantId="tenant-123"
        hasPolicyPermission={true}
        onApplySuccess={onApplySuccess}
      />,
    );

    // Preview changes first
    fireEvent.click(screen.getByTestId("preview-policy-button"));
    await waitFor(() => expect(screen.getByTestId("apply-policy-button")).toBeTruthy());

    const applyBtn = screen.getByTestId("apply-policy-button") as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);

    // Fill in reason
    fireEvent.change(screen.getByTestId("policy-reason-input"), { target: { value: "Security hardening" } });
    expect(applyBtn.disabled).toBe(true);

    // Check confirmation
    fireEvent.click(screen.getByTestId("policy-confirm-checkbox"));
    expect(applyBtn.disabled).toBe(false);

    // Apply
    fireEvent.click(applyBtn);

    await waitFor(() => {
      expect(applySpy).toHaveBeenCalledWith("tenant-123", {
        preset: "standard",
        reason: "Security hardening",
        confirm: true,
      });
      expect(screen.getByTestId("policy-success-message")).toBeTruthy();
      expect(onApplySuccess).toHaveBeenCalled();
    });
  });

  it("disables apply with a reason when caller lacks mfa.policy permission", async () => {
    vi.spyOn(authApi, "previewAuthMethodsPolicy").mockResolvedValue(SAMPLE_PREVIEW);

    render(<AuthMethodsPolicyEditor tenantId="tenant-123" hasPolicyPermission={false} />);

    expect(screen.getByTestId("permission-warning-badge")).toBeTruthy();

    fireEvent.click(screen.getByTestId("preview-policy-button"));
    await waitFor(() => expect(screen.getByTestId("apply-policy-button")).toBeTruthy());

    const applyBtn = screen.getByTestId("apply-policy-button") as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
    expect(applyBtn.title).toContain("mfa.policy");
  });
});

describe("RegistrationCampaignPanel (T-0230)", () => {
  it("renders campaign configuration, eligible user count, and toggles state", async () => {
    const updateSpy = vi.spyOn(authApi, "updateRegistrationCampaign").mockResolvedValue({
      ...SAMPLE_CAMPAIGN,
      state: "disabled",
      eligibleUserCount: 142,
    });
    const onUpdateSuccess = vi.fn();

    render(
      <RegistrationCampaignPanel
        tenantId="tenant-123"
        initialCampaign={SAMPLE_CAMPAIGN}
        hasPolicyPermission={true}
        onUpdateSuccess={onUpdateSuccess}
      />,
    );

    expect(screen.getByTestId("campaign-state-display").textContent).toBe("enabled");
    expect(screen.getByTestId("eligible-user-count").textContent).toBe("142");

    // Toggle to disabled
    const toggle = screen.getByTestId("campaign-toggle") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(false);

    // Enter reason
    fireEvent.change(screen.getByTestId("campaign-reason-input"), {
      target: { value: "Pause campaign for maintenance" },
    });

    // Save
    fireEvent.click(screen.getByTestId("campaign-submit-button"));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith("tenant-123", {
        state: "disabled",
        snoozeDurationInDays: 3,
        includeTargets: ["all_users"],
        excludeTargets: ["break-glass-group"],
        reason: "Pause campaign for maintenance",
        confirm: true,
      });
      expect(screen.getByTestId("campaign-success-message")).toBeTruthy();
      expect(onUpdateSuccess).toHaveBeenCalled();
    });
  });

  it("disables campaign update with a reason when caller lacks mfa.policy", () => {
    render(
      <RegistrationCampaignPanel
        tenantId="tenant-123"
        initialCampaign={SAMPLE_CAMPAIGN}
        hasPolicyPermission={false}
      />,
    );

    expect(screen.getByTestId("campaign-permission-badge")).toBeTruthy();
    const submitBtn = screen.getByTestId("campaign-submit-button") as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
    expect(submitBtn.title).toContain("mfa.policy");
  });
});

describe("authMethodsApi client (T-0230)", () => {
  it("fetches policy and preview with correct endpoints", async () => {
    const mockFetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => SAMPLE_PREVIEW,
    });

    const preview = await authApi.previewAuthMethodsPolicy(
      "tenant-123",
      { preset: "standard" },
      mockFetcher as unknown as typeof fetch,
    );

    expect(mockFetcher).toHaveBeenCalledWith("/v1/tenants/tenant-123/auth-methods-policy", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ preset: "standard", preview: true }),
    });
    expect(preview).toEqual(SAMPLE_PREVIEW);
  });

  it("updates registration campaign with correct payload", async () => {
    const mockFetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => SAMPLE_CAMPAIGN,
    });

    const res = await authApi.updateRegistrationCampaign(
      "tenant-123",
      {
        state: "enabled",
        snoozeDurationInDays: 5,
        includeTargets: ["all_users"],
        excludeTargets: [],
        reason: "Expand rollout",
      },
      mockFetcher as unknown as typeof fetch,
    );

    expect(mockFetcher).toHaveBeenCalledWith("/v1/tenants/tenant-123/registration-campaign", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        state: "enabled",
        snoozeDurationInDays: 5,
        includeTargets: ["all_users"],
        excludeTargets: [],
        reason: "Expand rollout",
        confirm: true,
      }),
    });
    expect(res).toEqual(SAMPLE_CAMPAIGN);
  });
});

describe("Report theme token enforcement (T-0230)", () => {
  it("uses report theme tokens and zero colour literals", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = (await import("node:path")).default;
    const currentDir = path.dirname(fileURLToPath(import.meta.url));

    const files = [
      path.join(currentDir, "AuthMethodsPolicyEditor.tsx"),
      path.join(currentDir, "RegistrationCampaignPanel.tsx"),
      path.join(currentDir, "../../app/auth-methods/page.tsx"),
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
