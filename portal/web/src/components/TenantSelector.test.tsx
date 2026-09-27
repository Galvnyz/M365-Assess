/** @vitest-environment jsdom */
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TenantSelector, type TenantItem } from "./TenantSelector";
import { TenantMultiSelect, type TenantOption, type TenantGroupOption, type TypedTenantOption } from "./TenantMultiSelect";
import {
  CURRENT_TENANT_KEY,
  RECENT_TENANTS_KEY,
  FAVORITE_TENANTS_KEY,
  getCurrentTenantId,
  setCurrentTenantId,
  getRecentTenantIds,
  getFavoriteTenantIds,
  toggleFavoriteTenantId,
  getTenantPreference,
  setTenantPreference,
} from "../lib/tenant-preference";

const SAMPLE_TENANTS: TenantItem[] = [
  { id: "tenant-contoso", displayName: "Contoso Corp", defaultDomain: "contoso.com" },
  { id: "tenant-fabrikam", displayName: "Fabrikam Ltd", defaultDomain: "fabrikam.com" },
  { id: "tenant-woodgrove", displayName: "Woodgrove Bank", defaultDomain: "woodgrove.com" },
  { id: "tenant-forbidden", displayName: "Forbidden Org", defaultDomain: "forbidden.com" },
];

const SAMPLE_GROUPS: TenantGroupOption[] = [
  { id: "group-enterprise", name: "Enterprise Tenants", memberTenantIds: ["tenant-contoso", "tenant-fabrikam"] },
  { id: "group-smb", name: "SMB Tenants", memberTenantIds: ["tenant-woodgrove"] },
];

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("Tenant Selector and Preferences (T-0067)", () => {
  describe("tenant-preference library", () => {
    it("persists current tenant and updates recent tenants", () => {
      expect(getCurrentTenantId()).toBeNull();

      setCurrentTenantId("tenant-contoso");
      expect(getCurrentTenantId()).toBe("tenant-contoso");
      expect(window.localStorage.getItem(CURRENT_TENANT_KEY)).toBe("tenant-contoso");
      expect(getRecentTenantIds()).toContain("tenant-contoso");

      setCurrentTenantId(null);
      expect(getCurrentTenantId()).toBeNull();
      expect(window.localStorage.getItem(CURRENT_TENANT_KEY)).toBeNull();
    });

    it("manages favorite tenants with toggle", () => {
      expect(getFavoriteTenantIds()).toEqual([]);

      const added = toggleFavoriteTenantId("tenant-fabrikam");
      expect(added).toBe(true);
      expect(getFavoriteTenantIds()).toContain("tenant-fabrikam");

      const removed = toggleFavoriteTenantId("tenant-fabrikam");
      expect(removed).toBe(false);
      expect(getFavoriteTenantIds()).not.toContain("tenant-fabrikam");
    });

    it("persists per-tenant view state under <key>-<tenantId> per 02-ui-design.md §7.4", () => {
      setTenantPreference("table-sort", "tenant-contoso", { column: "score", direction: "desc" });
      expect(window.localStorage.getItem("table-sort-tenant-contoso")).toBe(
        JSON.stringify({ column: "score", direction: "desc" })
      );

      const pref = getTenantPreference<{ column: string; direction: string }>(
        "table-sort",
        "tenant-contoso"
      );
      expect(pref).toEqual({ column: "score", direction: "desc" });

      // Non-matching tenant returns default or null
      expect(getTenantPreference("table-sort", "tenant-fabrikam", null)).toBeNull();
    });
  });

  describe("TenantSelector header component", () => {
    it("renders trigger with fleet option when no tenant is selected", () => {
      render(<TenantSelector tenants={SAMPLE_TENANTS} />);
      const trigger = screen.getByTestId("tenant-selector-trigger");
      expect(trigger).toBeDefined();
      expect(screen.getByTestId("tenant-selector-current-label").textContent).toBe(
        "All Tenants (Fleet View)"
      );
    });

    it("opens dropdown and selects a tenant, persisting to storage and notifying callback", () => {
      const handleChange = vi.fn();
      render(<TenantSelector tenants={SAMPLE_TENANTS} onTenantChange={handleChange} />);

      // Click to open
      fireEvent.click(screen.getByTestId("tenant-selector-trigger"));
      expect(screen.getByTestId("tenant-selector-dropdown")).toBeDefined();

      // Click Contoso option
      const contosoItem = screen.getByTestId("tenant-item-tenant-contoso");
      fireEvent.click(contosoItem);

      expect(handleChange).toHaveBeenCalledWith("tenant-contoso");
      expect(getCurrentTenantId()).toBe("tenant-contoso");
      expect(screen.getByTestId("tenant-selector-current-label").textContent).toBe("Contoso Corp");

      // Dropdown closes after selection
      expect(screen.queryByTestId("tenant-selector-dropdown")).toBeNull();
    });

    it("can select All Tenants (Fleet View) to clear tenant selection", () => {
      setCurrentTenantId("tenant-contoso");
      const handleChange = vi.fn();
      render(<TenantSelector tenants={SAMPLE_TENANTS} onTenantChange={handleChange} />);

      fireEvent.click(screen.getByTestId("tenant-selector-trigger"));
      const fleetItem = screen.getByTestId("tenant-option-fleet");
      fireEvent.click(fleetItem);

      expect(handleChange).toHaveBeenCalledWith(null);
      expect(getCurrentTenantId()).toBeNull();
      expect(screen.getByTestId("tenant-selector-current-label").textContent).toBe(
        "All Tenants (Fleet View)"
      );
    });

    it("limits selectable tenants to caller's allowedTenantIds (RBAC scope)", () => {
      render(
        <TenantSelector
          tenants={SAMPLE_TENANTS}
          allowedTenantIds={["tenant-contoso", "tenant-fabrikam"]}
        />
      );

      fireEvent.click(screen.getByTestId("tenant-selector-trigger"));

      expect(screen.getByTestId("tenant-item-tenant-contoso")).toBeDefined();
      expect(screen.getByTestId("tenant-item-tenant-fabrikam")).toBeDefined();
      expect(screen.queryByTestId("tenant-item-tenant-woodgrove")).toBeNull();
      expect(screen.queryByTestId("tenant-item-tenant-forbidden")).toBeNull();
    });

    it("allows toggling favorite tenants from dropdown", () => {
      render(<TenantSelector tenants={SAMPLE_TENANTS} />);
      fireEvent.click(screen.getByTestId("tenant-selector-trigger"));

      const favBtn = screen.getByTestId("toggle-fav-tenant-fabrikam");
      fireEvent.click(favBtn);

      expect(getFavoriteTenantIds()).toContain("tenant-fabrikam");
    });

    it("filters tenants using search input", () => {
      render(<TenantSelector tenants={SAMPLE_TENANTS} />);
      fireEvent.click(screen.getByTestId("tenant-selector-trigger"));

      const searchInput = screen.getByTestId("tenant-selector-search");
      fireEvent.change(searchInput, { target: { value: "woodgrove" } });

      expect(screen.getByTestId("tenant-item-tenant-woodgrove")).toBeDefined();
      expect(screen.queryByTestId("tenant-item-tenant-contoso")).toBeNull();
    });
  });

  describe("TenantMultiSelect typed options and scope", () => {
    it("emits typed options for tenant and group selections", () => {
      const handleTypedChange = vi.fn();
      const handleNormalChange = vi.fn();

      render(
        <TenantMultiSelect
          tenants={SAMPLE_TENANTS}
          groups={SAMPLE_GROUPS}
          selectedTenantIds={[]}
          selectedGroupIds={[]}
          onSelectionChange={handleNormalChange}
          onTypedSelectionChange={handleTypedChange}
        />
      );

      // Select Contoso tenant
      const contosoOption = screen.getByTestId("tenant-option-tenant-contoso");
      fireEvent.click(contosoOption);

      expect(handleNormalChange).toHaveBeenCalledWith(["tenant-contoso"], []);
      expect(handleTypedChange).toHaveBeenCalledWith([
        { label: "Contoso Corp", value: "tenant-contoso", type: "tenant" },
      ]);

      // Switch to Groups tab and select Enterprise group
      fireEvent.click(screen.getByTestId("tab-groups"));
      const groupOption = screen.getByTestId("group-option-group-enterprise");
      fireEvent.click(groupOption);

      expect(handleNormalChange).toHaveBeenCalledWith([], ["group-enterprise"]);
      expect(handleTypedChange).toHaveBeenCalledWith([
        { label: "Enterprise Tenants", value: "group-enterprise", type: "group" },
      ]);
    });

    it("emits global typed option when allowGlobal is enabled and selected", () => {
      const handleTypedChange = vi.fn();

      render(
        <TenantMultiSelect
          tenants={SAMPLE_TENANTS}
          allowGlobal={true}
          onTypedSelectionChange={handleTypedChange}
        />
      );

      // Click Global tab
      fireEvent.click(screen.getByTestId("tab-global"));
      const globalOption = screen.getByTestId("option-global");
      fireEvent.click(globalOption);

      expect(handleTypedChange).toHaveBeenCalledWith([
        { label: "All Tenants (Global)", value: "global", type: "global" },
      ]);
      expect(screen.getByTestId("selected-global-chip")).toBeDefined();
    });

    it("strictly limits available options to caller's allowedTenantIds (RBAC scope)", () => {
      render(
        <TenantMultiSelect
          tenants={SAMPLE_TENANTS}
          allowedTenantIds={["tenant-contoso"]}
        />
      );

      expect(screen.getByTestId("tenant-option-tenant-contoso")).toBeDefined();
      expect(screen.queryByTestId("tenant-option-tenant-fabrikam")).toBeNull();
      expect(screen.queryByTestId("tenant-option-tenant-forbidden")).toBeNull();
    });
  });

  describe("zero colour literals", () => {
    it("strictly enforces report theme tokens with zero colour literals in all selector components", () => {
      const files = [
        "src/components/TenantSelector.tsx",
        "src/components/TenantMultiSelect.tsx",
        "src/lib/tenant-preference.ts",
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
