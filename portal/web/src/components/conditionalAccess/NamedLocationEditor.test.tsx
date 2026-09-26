/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
import {
  NamedLocationEditor,
  isValidCidr,
  isValidCountryCode,
  type NamedLocationData,
  type NamedLocationPlan,
} from "./NamedLocationEditor";

describe("CIDR and Country code validators", () => {
  it("validates IPv4 and IPv6 CIDR notations", () => {
    expect(isValidCidr("192.168.1.0/24")).toBe(true);
    expect(isValidCidr("10.0.0.0/8")).toBe(true);
    expect(isValidCidr("0.0.0.0/0")).toBe(true);
    expect(isValidCidr("2001:db8::/32")).toBe(true);

    expect(isValidCidr("invalid")).toBe(false);
    expect(isValidCidr("192.168.1.1")).toBe(false);
    expect(isValidCidr("999.999.999.999/24")).toBe(false);
    expect(isValidCidr("")).toBe(false);
  });

  it("validates ISO 3166-1 alpha-2 country codes", () => {
    expect(isValidCountryCode("US")).toBe(true);
    expect(isValidCountryCode("GB")).toBe(true);
    expect(isValidCountryCode("ca")).toBe(true);

    expect(isValidCountryCode("USA")).toBe(false);
    expect(isValidCountryCode("12")).toBe(false);
    expect(isValidCountryCode("")).toBe(false);
  });
});

describe("NamedLocationEditor component (T-0288)", () => {
  const sampleIpLocation: NamedLocationData = {
    id: "loc-1",
    displayName: "Corporate HQ",
    locationType: "ip",
    isTrusted: true,
    ipRanges: ["192.168.1.0/24", "10.0.0.0/8"],
    referencingPolicies: [
      { id: "pol-1", displayName: "MFA for External Access" },
      { id: "pol-2", displayName: "Block High Risk Sign-ins" },
    ],
  };

  it("renders with initial IP location data", () => {
    render(<NamedLocationEditor initialLocation={sampleIpLocation} />);

    const nameInput = screen.getByTestId("location-name-input") as HTMLInputElement;
    expect(nameInput.value).toBe("Corporate HQ");

    const ipRadio = screen.getByTestId("location-type-ip") as HTMLInputElement;
    expect(ipRadio.checked).toBe(true);

    const trustedCheckbox = screen.getByTestId("is-trusted-checkbox") as HTMLInputElement;
    expect(trustedCheckbox.checked).toBe(true);

    const ipRangesInput = screen.getByTestId("ip-ranges-input") as HTMLTextAreaElement;
    expect(ipRangesInput.value).toContain("192.168.1.0/24");
    expect(ipRangesInput.value).toContain("10.0.0.0/8");

    // Check policy references list
    expect(screen.getByTestId("referencing-policies-list")).toBeTruthy();
    expect(screen.getByText(/MFA for External Access/)).toBeTruthy();
    expect(screen.getByText(/Block High Risk Sign-ins/)).toBeTruthy();
  });

  it("toggles between IP and Country location types", () => {
    render(<NamedLocationEditor isNew={true} />);

    // Defaults to IP
    expect(screen.getByTestId("ip-ranges-input")).toBeTruthy();
    expect(screen.queryByTestId("countries-input")).toBeNull();

    // Switch to country
    fireEvent.click(screen.getByTestId("location-type-country"));
    expect(screen.getByTestId("countries-input")).toBeTruthy();
    expect(screen.queryByTestId("ip-ranges-input")).toBeNull();
  });

  it("validates CIDR ranges and displays error on invalid format", () => {
    render(<NamedLocationEditor isNew={true} onSave={vi.fn()} />);

    fireEvent.change(screen.getByTestId("location-name-input"), {
      target: { value: "Branch Office" },
    });
    fireEvent.change(screen.getByTestId("ip-ranges-input"), {
      target: { value: "not-a-cidr" },
    });

    const errorBox = screen.getByTestId("validation-errors");
    expect(errorBox).toBeTruthy();
    expect(errorBox.textContent).toContain("Invalid CIDR range");

    const saveBtn = screen.getByTestId("save-btn") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it("validates country codes as ISO 3166-1 alpha-2", () => {
    render(<NamedLocationEditor isNew={true} onSave={vi.fn()} />);

    fireEvent.change(screen.getByTestId("location-name-input"), {
      target: { value: "Allowed Countries" },
    });
    fireEvent.click(screen.getByTestId("location-type-country"));

    fireEvent.change(screen.getByTestId("countries-input"), {
      target: { value: "USA, Canada" },
    });

    const errorBox = screen.getByTestId("validation-errors");
    expect(errorBox).toBeTruthy();
    expect(errorBox.textContent).toContain("Invalid country code");

    const saveBtn = screen.getByTestId("save-btn") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it("generates plan preview when preview plan button is clicked", async () => {
    const mockPreview = vi.fn().mockResolvedValue({
      action: "edit",
      locationId: "loc-1",
      targetName: "Corporate HQ",
      diff: ["~ DisplayName: 'Corporate HQ' -> 'Corporate HQ Updated'"],
      valid: true,
      inUse: true,
      requiresConfirmation: false,
    } as NamedLocationPlan);

    render(
      <NamedLocationEditor
        initialLocation={sampleIpLocation}
        onPreviewPlan={mockPreview}
      />,
    );

    fireEvent.change(screen.getByTestId("location-name-input"), {
      target: { value: "Corporate HQ Updated" },
    });

    const previewBtn = screen.getByTestId("preview-plan-btn");
    fireEvent.click(previewBtn);

    await waitFor(() => {
      expect(mockPreview).toHaveBeenCalled();
      const planBox = screen.getByTestId("plan-preview-box");
      expect(planBox).toBeTruthy();
      expect(planBox.textContent).toContain("Corporate HQ Updated");
    });
  });

  it("warns before deleting a location in use and requires typing confirm name", async () => {
    const mockDelete = vi.fn().mockResolvedValue(undefined);

    render(
      <NamedLocationEditor
        initialLocation={sampleIpLocation}
        onDelete={mockDelete}
      />,
    );

    const deleteBtn = screen.getByTestId("delete-btn");
    fireEvent.click(deleteBtn);

    const warningBox = screen.getByTestId("delete-warning-box");
    expect(warningBox).toBeTruthy();
    expect(warningBox.textContent).toContain("referenced by 2 Conditional Access policy/policies");

    const confirmBtn = screen.getByTestId("confirm-delete-btn") as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);

    // Type the wrong name
    const confirmInput = screen.getByTestId("confirm-delete-input");
    fireEvent.change(confirmInput, { target: { value: "Wrong Name" } });
    expect(confirmBtn.disabled).toBe(true);

    // Type the exact name
    fireEvent.change(confirmInput, { target: { value: "Corporate HQ" } });
    expect(confirmBtn.disabled).toBe(false);

    fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith("loc-1", "Corporate HQ");
    });
  });

  it("calls onSave when save button is clicked with valid data", async () => {
    const mockSave = vi.fn().mockResolvedValue(undefined);

    render(
      <NamedLocationEditor
        isNew={true}
        onSave={mockSave}
      />,
    );

    fireEvent.change(screen.getByTestId("location-name-input"), {
      target: { value: "Datacenter West" },
    });
    fireEvent.change(screen.getByTestId("ip-ranges-input"), {
      target: { value: "10.100.0.0/16" },
    });

    const saveBtn = screen.getByTestId("save-btn");
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: "Datacenter West",
          locationType: "ip",
          ipRanges: ["10.100.0.0/16"],
        }),
      );
    });
  });
});
