/** @vitest-environment jsdom */
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import FleetDashboardPage from "./page";
import TenantDashboardPage from "./[tenantId]/page";
import { FleetTable, type FleetPayload } from "../../components/dashboard/FleetTable";
import { EmptyState } from "../../components/dashboard/EmptyState";

const SAMPLE_FLEET: FleetPayload = {
  schemaVersion: "v1",
  total: 2,
  generatedAt: "2026-09-26T12:00:00.000Z",
  items: [
    {
      tenantId: "tenant-contoso",
      displayName: "Contoso Corp",
      defaultDomain: "contoso.com",
      status: "active",
      hasCompletedRun: true,
      score: 84,
      complianceRate: 88,
      lastRunAt: "2026-09-26T10:00:00.000Z",
      lastRunId: "run-contoso-1",
      lastRunStatus: "succeeded",
      findingCounts: { pass: 40, fail: 3, warning: 2, total: 45 },
      openAlerts: { critical: 1, high: 2, medium: 3, low: 0, total: 6 },
    },
    {
      tenantId: "tenant-fabrikam",
      displayName: "Fabrikam Ltd",
      defaultDomain: "fabrikam.com",
      status: "active",
      hasCompletedRun: false,
      score: null,
      complianceRate: null,
      lastRunAt: null,
      lastRunId: null,
      lastRunStatus: null,
      findingCounts: null,
      openAlerts: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
    },
  ],
};

const SAMPLE_TENANT_POPULATED = {
  schemaVersion: "v1",
  tenantId: "tenant-contoso",
  isEmpty: false,
  emptyState: null,
  tenantInfo: {
    tenantId: "tenant-contoso",
    displayName: "Contoso Corp",
    defaultDomain: "contoso.com",
    initialDomain: "contoso.onmicrosoft.com",
    status: "active",
    source: "direct",
    lastRunAt: "2026-09-26T10:00:00.000Z",
  },
  score: {
    current: 287,
    max: 350,
    percentage: 82,
    evaluatedCount: 42,
  },
  assessment: {
    runId: "run-contoso-1",
    finishedAt: "2026-09-26T10:00:00.000Z",
    status: "succeeded",
    headlineScore: 84,
    summaryCounts: { pass: 40, fail: 3, warning: 2, review: 0, skipped: 0, notLicensed: 0, total: 45 },
  },
  metrics: {
    metrics: [
      { id: "score", label: "Security Score", value: "84%", status: "pass" },
      { id: "evaluated", label: "Evaluated", value: 45, status: "neutral" },
    ],
  },
  alerts: {
    critical: 1,
    high: 2,
    medium: 3,
    low: 0,
    total: 6,
  },
  authMethods: {
    phishingResistant: 30,
    authenticatorApp: 50,
    smsOrVoice: 10,
    passwordOnly: 10,
    totalUsers: 100,
  },
  mfa: {
    enforcedPercentage: 80,
    registeredCount: 85,
    totalUsers: 100,
    adminMfaPercentage: 100,
  },
  licenses: {
    topSkus: [{ name: "M365 E5", assigned: 80, total: 100 }],
    totalAssigned: 80,
    totalPurchased: 100,
  },
  identity: {
    mfaEnforcedCount: 80,
    adminCount: 5,
    riskyUserCount: 1,
    totalUsers: 100,
  },
  devices: {
    compliantCount: 120,
    nonCompliantCount: 10,
    totalDevices: 130,
  },
  generatedAt: "2026-09-26T12:00:00.000Z",
};

const SAMPLE_TENANT_EMPTY = {
  schemaVersion: "v1",
  tenantId: "tenant-fabrikam",
  isEmpty: true,
  emptyState: {
    reason: "no_completed_run",
    message: "No completed assessment runs exist for Fabrikam Ltd. Run an assessment to generate posture data.",
  },
  tenantInfo: {
    tenantId: "tenant-fabrikam",
    displayName: "Fabrikam Ltd",
    defaultDomain: "fabrikam.com",
    initialDomain: "fabrikam.onmicrosoft.com",
    status: "active",
    source: "direct",
    lastRunAt: null,
  },
  score: null,
  assessment: null,
  metrics: null,
  alerts: null,
  authMethods: null,
  mfa: null,
  licenses: null,
  identity: null,
  devices: null,
  generatedAt: "2026-09-26T12:00:00.000Z",
};

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Dashboard Pages & Fleet View (T-0066)", () => {
  describe("FleetDashboardPage (/dashboard)", () => {
    it("fetches /v1/dashboard from BFF and renders FleetTable", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => SAMPLE_FLEET,
      } as Response);

      render(<FleetDashboardPage />);

      expect(screen.getByTestId("fleet-loading")).toBeDefined();

      await waitFor(() => {
        expect(screen.getByTestId("fleet-dashboard-title")).toBeDefined();
        expect(screen.getByTestId("fleet-table")).toBeDefined();
      });

      // Verify thin BFF contract: only /v1/dashboard called
      expect(fetchSpy).toHaveBeenCalledWith("/v1/dashboard");

      // Verify tenants rendered
      expect(screen.getByText("Contoso Corp")).toBeDefined();
      expect(screen.getByText("Fabrikam Ltd")).toBeDefined();
      expect(screen.getByTestId("score-value-tenant-contoso").textContent).toBe("84%");
    });

    it("filters fleet rows using search input", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => SAMPLE_FLEET,
      } as Response);

      render(<FleetDashboardPage />);

      await waitFor(() => {
        expect(screen.getByTestId("fleet-table")).toBeDefined();
      });

      const searchInput = screen.getByTestId("fleet-search-input");
      fireEvent.change(searchInput, { target: { value: "Fabrikam" } });

      expect(screen.getByText("Fabrikam Ltd")).toBeDefined();
      expect(screen.queryByText("Contoso Corp")).toBeNull();
    });

    it("sorts fleet rows by score column", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => SAMPLE_FLEET,
      } as Response);

      render(<FleetDashboardPage />);

      await waitFor(() => {
        expect(screen.getByTestId("fleet-table")).toBeDefined();
      });

      const sortScoreHeader = screen.getByTestId("sort-score");
      fireEvent.click(sortScoreHeader);

      const rows = screen.getAllByRole("row");
      expect(rows.length).toBeGreaterThanOrEqual(3); // header + 2 items
    });
  });

  describe("TenantDashboardPage (/dashboard/[tenantId])", () => {
    it("fetches /v1/dashboard/:tenantId and renders full widget grid for assessed tenant", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => SAMPLE_TENANT_POPULATED,
      } as Response);

      render(<TenantDashboardPage params={{ tenantId: "tenant-contoso" }} />);

      expect(screen.getByTestId("tenant-dashboard-loading")).toBeDefined();

      await waitFor(() => {
        expect(screen.getByTestId("tenant-dashboard-page")).toBeDefined();
      });

      expect(fetchSpy).toHaveBeenCalledWith("/v1/dashboard/tenant-contoso");
      expect(screen.getByTestId("tenant-dashboard-name").textContent).toBe("Contoso Corp");

      // Verify widgets rendered
      expect(screen.getByTestId("assessment-headline-score").textContent).toBe("84%");
      expect(screen.getByTestId("secure-score-percentage").textContent).toBe("82%");
      expect(screen.getByTestId("mfa-enforced-percentage").textContent).toBe("80%");
      expect(screen.getByTestId("auth-method-total-users").textContent).toBe("100 users");
      expect(screen.getByTestId("license-total-assigned").textContent).toBe("80 / 100");
    });

    it("renders EmptyState prompting a run when tenant has no completed assessment (isEmpty: true)", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => SAMPLE_TENANT_EMPTY,
      } as Response);

      render(<TenantDashboardPage params={{ tenantId: "tenant-fabrikam" }} />);

      await waitFor(() => {
        expect(screen.getByTestId("empty-state-container")).toBeDefined();
      });

      expect(screen.getByTestId("empty-state-title").textContent).toBe("No Completed Assessment");
      expect(screen.getByTestId("empty-state-message").textContent).toContain("No completed assessment runs exist for Fabrikam Ltd");

      const runButton = screen.getByTestId("empty-state-run-button");
      expect(runButton).toBeDefined();
    });
  });

  describe("EmptyState component standalone", () => {
    it("renders custom title, message, and triggers onRunAssessment callback", () => {
      const handleRun = vi.fn();
      render(
        <EmptyState
          title="Custom Empty State"
          message="Custom prompt message"
          tenantId="tenant-test"
          onRunAssessment={handleRun}
        />
      );

      expect(screen.getByTestId("empty-state-title").textContent).toBe("Custom Empty State");
      expect(screen.getByTestId("empty-state-message").textContent).toBe("Custom prompt message");

      const btn = screen.getByTestId("empty-state-run-button");
      fireEvent.click(btn);
      expect(handleRun).toHaveBeenCalledTimes(1);
    });
  });

  describe("zero colour literals", () => {
    it("strictly enforces report theme tokens with zero colour literals in all dashboard page components", () => {
      const files = [
        "src/components/dashboard/FleetTable.tsx",
        "src/components/dashboard/EmptyState.tsx",
        "src/app/dashboard/page.tsx",
        "src/app/dashboard/[tenantId]/page.tsx",
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
