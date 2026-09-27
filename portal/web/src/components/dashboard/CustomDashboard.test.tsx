/** @vitest-environment jsdom */
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { CustomDashboard, type DashboardLayout } from "./CustomDashboard";
import { WidgetPicker, type StockWidgetDefinition } from "./WidgetPicker";

const SAMPLE_WIDGETS: StockWidgetDefinition[] = [
  {
    id: "TenantInfoCard",
    name: "Tenant Overview",
    category: "overview",
    description: "Tenant details and status",
    defaultSize: { width: 4, height: 2 },
  },
  {
    id: "SecureScoreCard",
    name: "Secure Score",
    category: "identity",
    description: "Posture score and controls",
    defaultSize: { width: 4, height: 2 },
  },
  {
    id: "AlertsOverviewCard",
    name: "Alerts Overview",
    category: "alerts",
    description: "Open security alerts",
    defaultSize: { width: 12, height: 2 },
  },
  {
    id: "MFACard",
    name: "MFA Adoption",
    category: "identity",
    description: "MFA enforcement rate",
    defaultSize: { width: 4, height: 2 },
  },
];

const SAMPLE_INITIAL_LAYOUT: DashboardLayout = {
  id: "layout-1",
  userId: "user-123",
  scope: "global",
  tenantId: null,
  isDefault: true,
  createdAt: "2026-09-26T10:00:00.000Z",
  updatedAt: "2026-09-26T10:00:00.000Z",
  widgets: [
    { id: "TenantInfoCard", position: 0, size: { width: 4, height: 2 }, settings: {} },
    { id: "SecureScoreCard", position: 1, size: { width: 4, height: 2 }, settings: {} },
  ],
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Custom Dashboard Canvas and Editing (T-0068)", () => {
  describe("WidgetPicker modal", () => {
    it("renders available widgets, filters by category and search", () => {
      const handleAdd = vi.fn();
      const handleClose = vi.fn();

      render(
        <WidgetPicker
          isOpen={true}
          onClose={handleClose}
          availableWidgets={SAMPLE_WIDGETS}
          activeWidgetIds={["TenantInfoCard"]}
          onAddWidget={handleAdd}
        />
      );

      expect(screen.getByTestId("widget-picker-modal")).toBeDefined();
      expect(screen.getByText("Add Widget to Dashboard")).toBeDefined();

      // Active widget shows "Added" disabled button
      const tenantAddBtn = screen.getByTestId("add-widget-btn-TenantInfoCard");
      expect(tenantAddBtn.textContent).toBe("Added");
      expect((tenantAddBtn as HTMLButtonElement).disabled).toBe(true);

      // Inactive widget shows "+ Add"
      const scoreAddBtn = screen.getByTestId("add-widget-btn-SecureScoreCard");
      expect(scoreAddBtn.textContent).toBe("+ Add");
      expect((scoreAddBtn as HTMLButtonElement).disabled).toBe(false);

      // Filter by category "alerts"
      fireEvent.click(screen.getByTestId("category-filter-alerts"));
      expect(screen.getByText("Alerts Overview")).toBeDefined();
      expect(screen.queryByText("Secure Score")).toBeNull();

      // Search filter
      fireEvent.click(screen.getByTestId("category-filter-all"));
      const searchInput = screen.getByTestId("widget-picker-search");
      fireEvent.change(searchInput, { target: { value: "MFA" } });
      expect(screen.getByText("MFA Adoption")).toBeDefined();
      expect(screen.queryByText("Alerts Overview")).toBeNull();
    });

    it("triggers onAddWidget and closes modal when adding an available widget", () => {
      const handleAdd = vi.fn();
      const handleClose = vi.fn();

      render(
        <WidgetPicker
          isOpen={true}
          onClose={handleClose}
          availableWidgets={SAMPLE_WIDGETS}
          activeWidgetIds={[]}
          onAddWidget={handleAdd}
        />
      );

      const addBtn = screen.getByTestId("add-widget-btn-AlertsOverviewCard");
      fireEvent.click(addBtn);

      expect(handleAdd).toHaveBeenCalledWith(SAMPLE_WIDGETS[2]);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("CustomDashboard component", () => {
    it("loads initial layout and renders active widgets", async () => {
      vi.spyOn(global, "fetch").mockImplementation(async (url) => {
        const u = String(url);
        if (u.includes("/v1/dashboard/widgets")) {
          return { ok: true, json: async () => ({ widgets: SAMPLE_WIDGETS }) } as Response;
        }
        if (u.includes("/v1/dashboard/layout")) {
          return { ok: true, json: async () => ({ layout: SAMPLE_INITIAL_LAYOUT }) } as Response;
        }
        return { ok: false } as Response;
      });

      render(<CustomDashboard />);

      expect(screen.getByTestId("custom-dashboard-loading")).toBeDefined();

      await waitFor(() => {
        expect(screen.getByTestId("custom-dashboard-container")).toBeDefined();
      });

      expect(screen.getByTestId("canvas-widget-TenantInfoCard")).toBeDefined();
      expect(screen.getByTestId("canvas-widget-SecureScoreCard")).toBeDefined();
      expect(screen.getByTestId("layout-default-badge")).toBeDefined();
    });

    it("removes a widget, updates positions, and persists to PUT /v1/dashboard/layout", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url, init) => {
        const u = String(url);
        if (u.includes("/v1/dashboard/widgets")) {
          return { ok: true, json: async () => ({ widgets: SAMPLE_WIDGETS }) } as Response;
        }
        if (u.includes("/v1/dashboard/layout") && (!init || init.method === "GET")) {
          return { ok: true, json: async () => ({ layout: SAMPLE_INITIAL_LAYOUT }) } as Response;
        }
        if (u.includes("/v1/dashboard/layout") && init?.method === "PUT") {
          const body = JSON.parse(String(init.body));
          return {
            ok: true,
            json: async () => ({
              layout: {
                ...SAMPLE_INITIAL_LAYOUT,
                isDefault: false,
                widgets: body.widgets,
              },
            }),
          } as Response;
        }
        return { ok: false } as Response;
      });

      render(<CustomDashboard />);

      await waitFor(() => {
        expect(screen.getByTestId("canvas-widget-TenantInfoCard")).toBeDefined();
      });

      // Remove TenantInfoCard
      const removeBtn = screen.getByTestId("remove-widget-TenantInfoCard");
      fireEvent.click(removeBtn);

      await waitFor(() => {
        expect(screen.queryByTestId("canvas-widget-TenantInfoCard")).toBeNull();
      });

      // Verify PUT call
      expect(fetchSpy).toHaveBeenCalledWith(
        "/v1/dashboard/layout",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({
            widgets: [{ id: "SecureScoreCard", position: 0, size: { width: 4, height: 2 }, settings: {} }],
          }),
        })
      );
    });

    it("reorders widgets (Move Down) and persists new positions", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url, init) => {
        const u = String(url);
        if (u.includes("/v1/dashboard/widgets")) {
          return { ok: true, json: async () => ({ widgets: SAMPLE_WIDGETS }) } as Response;
        }
        if (u.includes("/v1/dashboard/layout") && (!init || init.method === "GET")) {
          return { ok: true, json: async () => ({ layout: SAMPLE_INITIAL_LAYOUT }) } as Response;
        }
        if (u.includes("/v1/dashboard/layout") && init?.method === "PUT") {
          const body = JSON.parse(String(init.body));
          return {
            ok: true,
            json: async () => ({
              layout: { ...SAMPLE_INITIAL_LAYOUT, isDefault: false, widgets: body.widgets },
            }),
          } as Response;
        }
        return { ok: false } as Response;
      });

      render(<CustomDashboard />);

      await waitFor(() => {
        expect(screen.getByTestId("canvas-widget-TenantInfoCard")).toBeDefined();
      });

      const moveDownBtn = screen.getByTestId("move-down-TenantInfoCard");
      fireEvent.click(moveDownBtn);

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          "/v1/dashboard/layout",
          expect.objectContaining({
            method: "PUT",
            body: JSON.stringify({
              widgets: [
                { id: "SecureScoreCard", position: 0, size: { width: 4, height: 2 }, settings: {} },
                { id: "TenantInfoCard", position: 1, size: { width: 4, height: 2 }, settings: {} },
              ],
            }),
          })
        );
      });
    });

    it("resizes widget width and persists to layout endpoint", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url, init) => {
        const u = String(url);
        if (u.includes("/v1/dashboard/widgets")) {
          return { ok: true, json: async () => ({ widgets: SAMPLE_WIDGETS }) } as Response;
        }
        if (u.includes("/v1/dashboard/layout") && (!init || init.method === "GET")) {
          return { ok: true, json: async () => ({ layout: SAMPLE_INITIAL_LAYOUT }) } as Response;
        }
        if (u.includes("/v1/dashboard/layout") && init?.method === "PUT") {
          const body = JSON.parse(String(init.body));
          return {
            ok: true,
            json: async () => ({
              layout: { ...SAMPLE_INITIAL_LAYOUT, isDefault: false, widgets: body.widgets },
            }),
          } as Response;
        }
        return { ok: false } as Response;
      });

      render(<CustomDashboard />);

      await waitFor(() => {
        expect(screen.getByTestId("resize-widget-TenantInfoCard")).toBeDefined();
      });

      const resizeSelect = screen.getByTestId("resize-widget-TenantInfoCard");
      fireEvent.change(resizeSelect, { target: { value: "12" } });

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          "/v1/dashboard/layout",
          expect.objectContaining({
            method: "PUT",
            body: JSON.stringify({
              widgets: [
                { id: "TenantInfoCard", position: 0, size: { width: 12, height: 2 }, settings: {} },
                { id: "SecureScoreCard", position: 1, size: { width: 4, height: 2 }, settings: {} },
              ],
            }),
          })
        );
      });
    });

    it("resets to stock default layout when Reset button is clicked", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url, init) => {
        const u = String(url);
        if (u.includes("/v1/dashboard/widgets")) {
          return { ok: true, json: async () => ({ widgets: SAMPLE_WIDGETS }) } as Response;
        }
        if (u.includes("/v1/dashboard/layout") && (!init || init.method === "GET")) {
          return { ok: true, json: async () => ({ layout: SAMPLE_INITIAL_LAYOUT }) } as Response;
        }
        if (u.includes("/v1/dashboard/layout") && init?.method === "PUT") {
          return {
            ok: true,
            json: async () => ({
              layout: { ...SAMPLE_INITIAL_LAYOUT, isDefault: true },
            }),
          } as Response;
        }
        return { ok: false } as Response;
      });

      render(<CustomDashboard />);

      await waitFor(() => {
        expect(screen.getByTestId("reset-layout-btn")).toBeDefined();
      });

      fireEvent.click(screen.getByTestId("reset-layout-btn"));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          "/v1/dashboard/layout",
          expect.objectContaining({
            method: "PUT",
            body: JSON.stringify({ reset: true }),
          })
        );
      });
    });

    it("reverts optimistic change when layout save fails", async () => {
      vi.spyOn(global, "fetch").mockImplementation(async (url, init) => {
        const u = String(url);
        if (u.includes("/v1/dashboard/widgets")) {
          return { ok: true, json: async () => ({ widgets: SAMPLE_WIDGETS }) } as Response;
        }
        if (u.includes("/v1/dashboard/layout") && (!init || init.method === "GET")) {
          return { ok: true, json: async () => ({ layout: SAMPLE_INITIAL_LAYOUT }) } as Response;
        }
        if (u.includes("/v1/dashboard/layout") && init?.method === "PUT") {
          return {
            ok: false,
            statusText: "Internal Server Error",
            json: async () => ({ message: "Database connection failed" }),
          } as Response;
        }
        return { ok: false } as Response;
      });

      render(<CustomDashboard />);

      await waitFor(() => {
        expect(screen.getByTestId("remove-widget-TenantInfoCard")).toBeDefined();
      });

      // Try removing TenantInfoCard
      fireEvent.click(screen.getByTestId("remove-widget-TenantInfoCard"));

      // Failure causes revert and error message
      await waitFor(() => {
        expect(screen.getByTestId("custom-dashboard-error")).toBeDefined();
        // TenantInfoCard should be back in the canvas
        expect(screen.getByTestId("canvas-widget-TenantInfoCard")).toBeDefined();
      });
    });
  });

  describe("zero colour literals", () => {
    it("strictly enforces report theme tokens with zero colour literals in all custom dashboard components", () => {
      const files = [
        "src/components/dashboard/CustomDashboard.tsx",
        "src/components/dashboard/WidgetPicker.tsx",
        "src/app/dashboard/custom/page.tsx",
      ];
      const rootDir = process.cwd();

      for (const file of files) {
        const code = readFileSync(join(rootDir, file), "utf8");

        expect(code, `${file} contains hex color literal`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(code, `${file} contains rgb color literal`).not.toMatch(/\brgba?\s*\(/i);
        expect(code, `${file} contains hsl color literal`).not.toMatch(/\bhsla?\s*\(/i);
      }
    });
  });
});
