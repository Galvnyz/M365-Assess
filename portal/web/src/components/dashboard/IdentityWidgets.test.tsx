/** @vitest-environment jsdom */
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SecureScoreCard, type SecureScoreWidget } from "./SecureScoreCard";
import { MFACard, type MFAWidget } from "./MFACard";
import { AuthMethodCard, type AuthMethodWidget } from "./AuthMethodCard";
import { LicenseCard, type LicenseWidget } from "./LicenseCard";
import {
  IdentityDevicesTabs,
  DASHBOARD_TABS,
  type DashboardTabId,
} from "./IdentityDevicesTabs";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const SAMPLE_SECURE_SCORE: SecureScoreWidget = {
  current: 287,
  max: 350,
  percentage: 82,
  evaluatedCount: 42,
};

const SAMPLE_MFA: MFAWidget = {
  enforcedPercentage: 75,
  registeredCount: 90,
  totalUsers: 120,
  adminMfaPercentage: 100,
};

const SAMPLE_AUTH_METHODS: AuthMethodWidget = {
  phishingResistant: 35,
  authenticatorApp: 55,
  smsOrVoice: 20,
  passwordOnly: 10,
  totalUsers: 120,
};

const SAMPLE_LICENSES: LicenseWidget = {
  totalAssigned: 185,
  totalPurchased: 200,
  topSkus: [
    { name: "Microsoft 365 E5", assigned: 100, total: 100 },
    { name: "Microsoft 365 Business Premium", assigned: 75, total: 80 },
    { name: "Microsoft Entra ID P2", assigned: 10, total: 20 },
  ],
};

describe("Identity and Device Widgets (T-0065)", () => {
  describe("SecureScoreCard", () => {
    it("renders secure score percentage, points ratio, and evaluated controls count", () => {
      const handleDrill = vi.fn();
      render(<SecureScoreCard score={SAMPLE_SECURE_SCORE} onDrillDown={handleDrill} />);

      expect(screen.getByTestId("secure-score-percentage").textContent).toBe("82%");
      expect(screen.getByTestId("secure-score-points").textContent).toBe("287 / 350 pts");
      expect(screen.getByTestId("secure-score-evaluated").textContent).toContain("42 controls evaluated");
      expect(screen.getByTestId("secure-score-progress-bar")).toBeDefined();

      const drillBtn = screen.getByTestId("drill-down-secure-score");
      fireEvent.click(drillBtn);
      expect(handleDrill).toHaveBeenCalledTimes(1);
    });

    it("renders empty state when score is null or isEmpty is true", () => {
      const handleRun = vi.fn();
      render(<SecureScoreCard isEmpty={true} onRunAssessment={handleRun} />);

      expect(screen.getByTestId("widget-card-empty-state")).toBeDefined();
      expect(screen.getByText(/No Secure Score data available/i)).toBeDefined();
      expect(screen.queryByTestId("secure-score-percentage")).toBeNull();

      const runBtn = screen.getByTestId("widget-run-assessment-button");
      fireEvent.click(runBtn);
      expect(handleRun).toHaveBeenCalledTimes(1);
    });
  });

  describe("MFACard", () => {
    it("renders MFA enforced percentage, registered users count, and admin MFA rate", () => {
      const handleDrill = vi.fn();
      render(<MFACard mfa={SAMPLE_MFA} onDrillDown={handleDrill} />);

      expect(screen.getByTestId("mfa-enforced-percentage").textContent).toBe("75%");
      expect(screen.getByTestId("mfa-registered-users").textContent).toBe("90 of 120 users registered");
      expect(screen.getByTestId("mfa-admin-percentage").textContent).toBe("100% admin MFA");
      expect(screen.getByTestId("mfa-progress-bar")).toBeDefined();

      const drillBtn = screen.getByTestId("drill-down-mfa-adoption");
      fireEvent.click(drillBtn);
      expect(handleDrill).toHaveBeenCalledTimes(1);
    });

    it("renders empty state when mfa is null or isEmpty is true", () => {
      const handleRun = vi.fn();
      render(<MFACard mfa={null} isEmpty={true} onRunAssessment={handleRun} />);

      expect(screen.getByTestId("widget-card-empty-state")).toBeDefined();
      expect(screen.getByText(/No MFA telemetry available/i)).toBeDefined();
      expect(screen.queryByTestId("mfa-enforced-percentage")).toBeNull();

      const runBtn = screen.getByTestId("widget-run-assessment-button");
      fireEvent.click(runBtn);
      expect(handleRun).toHaveBeenCalledTimes(1);
    });
  });

  describe("AuthMethodCard", () => {
    it("renders distribution of auth methods, total users, and allows drill-down per method", () => {
      const handleDrill = vi.fn();
      render(<AuthMethodCard authMethods={SAMPLE_AUTH_METHODS} onDrillDown={handleDrill} />);

      expect(screen.getByTestId("auth-method-total-users").textContent).toBe("120 users");
      expect(screen.getByTestId("auth-method-distribution-bar")).toBeDefined();

      const fidoItem = screen.getByTestId("auth-method-phishing-resistant");
      expect(fidoItem.textContent).toContain("35");
      expect(fidoItem.textContent).toContain("29%");

      const authAppItem = screen.getByTestId("auth-method-authenticator");
      expect(authAppItem.textContent).toContain("55");
      expect(authAppItem.textContent).toContain("46%");

      const smsItem = screen.getByTestId("auth-method-sms-voice");
      expect(smsItem.textContent).toContain("20");

      const pwItem = screen.getByTestId("auth-method-password-only");
      expect(pwItem.textContent).toContain("10");

      fireEvent.click(fidoItem);
      expect(handleDrill).toHaveBeenCalledWith("phishing-resistant");
    });

    it("renders empty state when authMethods is null or isEmpty is true", () => {
      const handleRun = vi.fn();
      render(<AuthMethodCard authMethods={null} onRunAssessment={handleRun} />);

      expect(screen.getByTestId("widget-card-empty-state")).toBeDefined();
      expect(screen.getByText(/No auth method distribution data available/i)).toBeDefined();
      expect(screen.queryByTestId("auth-method-total-users")).toBeNull();
    });
  });

  describe("LicenseCard", () => {
    it("renders total assigned/purchased ratio, utilization rate, and top SKUs", () => {
      const handleDrill = vi.fn();
      render(<LicenseCard licenses={SAMPLE_LICENSES} onDrillDown={handleDrill} />);

      expect(screen.getByTestId("license-total-assigned").textContent).toBe("185 / 200");
      expect(screen.getByTestId("license-utilization-rate").textContent).toBe("93%");
      expect(screen.getByTestId("license-sku-list")).toBeDefined();

      const e5Item = screen.getByTestId("license-sku-item-microsoft-365-e5");
      expect(e5Item.textContent).toContain("Microsoft 365 E5");
      expect(e5Item.textContent).toContain("100 / 100");

      fireEvent.click(e5Item);
      expect(handleDrill).toHaveBeenCalledWith("Microsoft 365 E5");
    });

    it("renders empty state when licenses is null or isEmpty is true", () => {
      const handleRun = vi.fn();
      render(<LicenseCard licenses={null} onRunAssessment={handleRun} />);

      expect(screen.getByTestId("widget-card-empty-state")).toBeDefined();
      expect(screen.getByText(/No license assignment telemetry available/i)).toBeDefined();
      expect(screen.queryByTestId("license-total-assigned")).toBeNull();
    });
  });

  describe("IdentityDevicesTabs", () => {
    it("renders all four sub-tabs: Overview, Identity, Devices, and Custom", () => {
      render(
        <IdentityDevicesTabs
          overviewContent={<div data-testid="overview-pane">Overview View</div>}
          identityContent={<div data-testid="identity-pane">Identity View</div>}
          devicesContent={<div data-testid="devices-pane">Devices View</div>}
          customContent={<div data-testid="custom-pane">Custom View</div>}
        />
      );

      for (const tab of DASHBOARD_TABS) {
        const tabEl = screen.getByTestId(`tab-${tab.id}`);
        expect(tabEl).toBeDefined();
        expect(tabEl.textContent).toContain(tab.label);
      }

      // Default active tab is Overview
      expect(screen.getByTestId("tab-overview").getAttribute("aria-selected")).toBe("true");
      expect(screen.getByTestId("overview-pane")).toBeDefined();
      expect(screen.queryByTestId("identity-pane")).toBeNull();
    });

    it("switches tabs without page reload on click", () => {
      const handleTabChange = vi.fn();
      render(
        <IdentityDevicesTabs
          onTabChange={handleTabChange}
          overviewContent={<div data-testid="overview-pane">Overview View</div>}
          identityContent={<div data-testid="identity-pane">Identity View</div>}
          devicesContent={<div data-testid="devices-pane">Devices View</div>}
          customContent={<div data-testid="custom-pane">Custom View</div>}
        />
      );

      // Click on Identity tab
      const identityTab = screen.getByTestId("tab-identity");
      fireEvent.click(identityTab);

      expect(handleTabChange).toHaveBeenCalledWith("identity");
      expect(screen.getByTestId("tab-identity").getAttribute("aria-selected")).toBe("true");
      expect(screen.getByTestId("tab-overview").getAttribute("aria-selected")).toBe("false");
      expect(screen.getByTestId("identity-pane")).toBeDefined();
      expect(screen.queryByTestId("overview-pane")).toBeNull();

      // Click on Devices tab
      const devicesTab = screen.getByTestId("tab-devices");
      fireEvent.click(devicesTab);

      expect(handleTabChange).toHaveBeenCalledWith("devices");
      expect(screen.getByTestId("tab-devices").getAttribute("aria-selected")).toBe("true");
      expect(screen.getByTestId("devices-pane")).toBeDefined();

      // Click on Custom tab
      const customTab = screen.getByTestId("tab-custom");
      fireEvent.click(customTab);

      expect(handleTabChange).toHaveBeenCalledWith("custom");
      expect(screen.getByTestId("tab-custom").getAttribute("aria-selected")).toBe("true");
      expect(screen.getByTestId("custom-pane")).toBeDefined();
    });

    it("supports controlled activeTab prop", () => {
      const handleTabChange = vi.fn();
      const { rerender } = render(
        <IdentityDevicesTabs
          activeTab="devices"
          onTabChange={handleTabChange}
          devicesContent={<div data-testid="devices-pane">Devices Content</div>}
        />
      );

      expect(screen.getByTestId("tab-devices").getAttribute("aria-selected")).toBe("true");
      expect(screen.getByTestId("devices-pane")).toBeDefined();

      rerender(
        <IdentityDevicesTabs
          activeTab="custom"
          onTabChange={handleTabChange}
          customContent={<div data-testid="custom-pane">Custom Content</div>}
        />
      );

      expect(screen.getByTestId("tab-custom").getAttribute("aria-selected")).toBe("true");
      expect(screen.getByTestId("custom-pane")).toBeDefined();
    });
  });

  describe("zero colour literals", () => {
    it("strictly enforces report theme tokens and contains zero colour literals in all identity components", () => {
      const files = [
        "SecureScoreCard.tsx",
        "MFACard.tsx",
        "AuthMethodCard.tsx",
        "LicenseCard.tsx",
        "IdentityDevicesTabs.tsx",
      ];
      const dir = join(process.cwd(), "src/components/dashboard");

      for (const file of files) {
        const code = readFileSync(join(dir, file), "utf8");

        expect(code, `${file} contains hex color literal`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(code, `${file} contains rgb color literal`).not.toMatch(/\brgba?\s*\(/i);
        expect(code, `${file} contains hsl color literal`).not.toMatch(/\bhsla?\s*\(/i);
      }
    });
  });
});
