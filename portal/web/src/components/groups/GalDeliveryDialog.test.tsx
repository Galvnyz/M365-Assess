/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import {
  GalDeliveryDialog,
  GalDialog,
  DeliveryManagementDialog,
} from "./GalDeliveryDialog";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("GalDeliveryDialog (T-0269)", () => {
  it("does not render when isOpen is false", () => {
    const { container } = render(
      <GalDeliveryDialog
        isOpen={false}
        mode="gal"
        tenantId="tenant-1"
        groupId="grp-1"
        onClose={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("handles GAL mode: toggles hide, requests preview, and applies changes", async () => {
    const mockFetcher = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          target: "gal",
          dryRun: true,
          diff: ["hiddenFromAddressListsEnabled: false -> true"],
          before: { hiddenFromAddressListsEnabled: false },
          after: { hiddenFromAddressListsEnabled: true },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          before: { hiddenFromAddressListsEnabled: false },
          after: { hiddenFromAddressListsEnabled: true },
          auditEvent: { action: "group.gal.update" },
        }),
      });

    const onClose = vi.fn();
    const onSuccess = vi.fn();

    render(
      <GalDialog
        isOpen={true}
        tenantId="tenant-1"
        groupId="grp-1"
        groupName="Finance Team"
        initialHiddenFromAddressListsEnabled={false}
        onClose={onClose}
        onSuccess={onSuccess}
        fetcher={mockFetcher as any}
      />
    );

    expect(screen.getByTestId("gal-delivery-dialog")).toBeTruthy();
    expect(screen.getByText("Hide from GAL")).toBeTruthy();
    expect(screen.getByText("Finance Team")).toBeTruthy();

    const checkbox = screen.getByTestId("input-hide-gal") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    // Preview
    fireEvent.click(screen.getByTestId("btn-preview"));

    await waitFor(() => {
      expect(screen.getByTestId("preview-diff")).toBeTruthy();
    });

    expect(mockFetcher).toHaveBeenCalledWith(
      "/v1/tenants/tenant-1/groups/grp-1/gal?preview=true",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ hiddenFromAddressListsEnabled: true, preview: true }),
      }),
    );
    expect(screen.getByText("hiddenFromAddressListsEnabled: false -> true")).toBeTruthy();

    // Apply
    fireEvent.click(screen.getByTestId("btn-apply"));

    await waitFor(() => {
      expect(screen.getByTestId("apply-result")).toBeTruthy();
    });

    expect(mockFetcher).toHaveBeenCalledWith(
      "/v1/tenants/tenant-1/groups/grp-1/gal",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ hiddenFromAddressListsEnabled: true, preview: false }),
      }),
    );
    expect(screen.getByText("Changes successfully applied!")).toBeTruthy();
    expect(screen.getByText("group.gal.update")).toBeTruthy();
    expect(onSuccess).toHaveBeenCalled();

    // Close
    fireEvent.click(screen.getByTestId("btn-done"));
    expect(onClose).toHaveBeenCalled();
  });

  it("handles Delivery mode: manages sender auth and send-on-behalf list", async () => {
    const mockFetcher = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          target: "delivery",
          dryRun: true,
          diff: ["requireSenderAuthenticationEnabled: false -> true", "grantSendOnBehalfTo: [user1@contoso.com]"],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          auditEvent: { action: "group.delivery.update" },
        }),
      });

    const onClose = vi.fn();

    render(
      <DeliveryManagementDialog
        isOpen={true}
        tenantId="tenant-1"
        groupId="grp-1"
        initialRequireSenderAuthenticationEnabled={false}
        initialGrantSendOnBehalfTo={[]}
        onClose={onClose}
        fetcher={mockFetcher as any}
      />
    );

    expect(screen.getByText("Delivery Management")).toBeTruthy();

    // Check sender auth
    const authCheckbox = screen.getByTestId("input-require-sender-auth") as HTMLInputElement;
    fireEvent.click(authCheckbox);
    expect(authCheckbox.checked).toBe(true);

    // Add send-on-behalf entry
    const emailInput = screen.getByTestId("input-send-on-behalf");
    fireEvent.change(emailInput, { target: { value: "user1@contoso.com" } });
    fireEvent.click(screen.getByTestId("btn-add-send-on-behalf"));

    expect(screen.getByTestId("tag-send-on-behalf-user1@contoso.com")).toBeTruthy();

    // Prevent duplicate
    fireEvent.change(emailInput, { target: { value: "user1@contoso.com" } });
    fireEvent.click(screen.getByTestId("btn-add-send-on-behalf"));
    expect(screen.getByTestId("error-message")).toBeTruthy();

    // Preview
    fireEvent.click(screen.getByTestId("btn-preview"));

    await waitFor(() => {
      expect(screen.getByTestId("preview-diff")).toBeTruthy();
    });

    expect(mockFetcher).toHaveBeenCalledWith(
      "/v1/tenants/tenant-1/groups/grp-1/delivery?preview=true",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          requireSenderAuthenticationEnabled: true,
          grantSendOnBehalfTo: ["user1@contoso.com"],
          preview: true,
        }),
      }),
    );

    // Apply
    fireEvent.click(screen.getByTestId("btn-apply"));

    await waitFor(() => {
      expect(screen.getByTestId("apply-result")).toBeTruthy();
    });

    expect(mockFetcher).toHaveBeenCalledWith(
      "/v1/tenants/tenant-1/groups/grp-1/delivery",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          requireSenderAuthenticationEnabled: true,
          grantSendOnBehalfTo: ["user1@contoso.com"],
          preview: false,
        }),
      }),
    );
  });

  it("handles remove send-on-behalf item", () => {
    render(
      <DeliveryManagementDialog
        isOpen={true}
        tenantId="tenant-1"
        groupId="grp-1"
        initialGrantSendOnBehalfTo={["alice@contoso.com"]}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByTestId("tag-send-on-behalf-alice@contoso.com")).toBeTruthy();
    fireEvent.click(screen.getByTestId("btn-remove-alice@contoso.com"));
    expect(screen.queryByTestId("tag-send-on-behalf-alice@contoso.com")).toBeNull();
  });
});
