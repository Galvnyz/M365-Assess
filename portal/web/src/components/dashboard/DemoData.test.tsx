/** @vitest-environment jsdom */
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  DEMO_DASHBOARD_PAYLOAD,
  DEMO_FLEET_PAYLOAD,
  WIDGET_TUTORIAL_MARKERS,
  DemoDashboard,
} from "../../data/dashboard-demo";

interface TourStep {
  readonly step: number;
  readonly widgetId: string;
  readonly tutorialMarker: string;
  readonly target: string;
  readonly title: string;
  readonly content: string;
}

interface TourDefinition {
  readonly tourId: string;
  readonly title: string;
  readonly description: string;
  readonly steps: readonly TourStep[];
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Dashboard Demo Data & Tour Markers (T-0070)", () => {
  describe("demo dataset validation", () => {
    it("conforms to the DashboardPayload contract with valid schemaVersion and non-empty status", () => {
      expect(DEMO_DASHBOARD_PAYLOAD.schemaVersion).toBe("v1");
      expect(DEMO_DASHBOARD_PAYLOAD.isEmpty).toBe(false);
      expect(DEMO_DASHBOARD_PAYLOAD.emptyState).toBeNull();
      expect(DEMO_DASHBOARD_PAYLOAD.tenantInfo).toBeDefined();
      expect(DEMO_DASHBOARD_PAYLOAD.score).toBeDefined();
      expect(DEMO_DASHBOARD_PAYLOAD.assessment).toBeDefined();
      expect(DEMO_DASHBOARD_PAYLOAD.metrics).toBeDefined();
      expect(DEMO_DASHBOARD_PAYLOAD.alerts).toBeDefined();
      expect(DEMO_DASHBOARD_PAYLOAD.authMethods).toBeDefined();
      expect(DEMO_DASHBOARD_PAYLOAD.mfa).toBeDefined();
      expect(DEMO_DASHBOARD_PAYLOAD.licenses).toBeDefined();
    });

    it("conforms to the FleetPayload contract", () => {
      expect(DEMO_FLEET_PAYLOAD.schemaVersion).toBe("v1");
      expect(DEMO_FLEET_PAYLOAD.total).toBe(3);
      expect(DEMO_FLEET_PAYLOAD.items.length).toBe(3);

      const assessedItem = DEMO_FLEET_PAYLOAD.items[0];
      expect(assessedItem.hasCompletedRun).toBe(true);
      expect(assessedItem.score).toBe(84);
      expect(assessedItem.findingCounts).toBeDefined();

      const unassessedItem = DEMO_FLEET_PAYLOAD.items[2];
      expect(unassessedItem.hasCompletedRun).toBe(false);
      expect(unassessedItem.score).toBeNull();
    });

    it("uses obvious placeholder identifiers only with no real tenant names or domains", () => {
      // Domains must use reserved example/demo TLDs
      expect(DEMO_DASHBOARD_PAYLOAD.tenantInfo.defaultDomain).toContain(".example");
      expect(DEMO_DASHBOARD_PAYLOAD.tenantInfo.initialDomain).toContain(".example");
      expect(DEMO_DASHBOARD_PAYLOAD.tenantInfo.displayName).toContain("Demo");
      expect(DEMO_DASHBOARD_PAYLOAD.tenantInfo.displayName).toContain("Sample");

      for (const item of DEMO_FLEET_PAYLOAD.items) {
        expect(item.defaultDomain).toContain(".example");
        expect(item.displayName).toContain("Demo");
        expect(item.tenantId).toMatch(/^demo-tenant-/);
      }
    });
  });

  describe("DemoDashboard component rendering & API isolation", () => {
    it("renders dashboard purely from the demo dataset without making any fetch API calls", () => {
      const fetchSpy = vi.spyOn(global, "fetch");

      render(<DemoDashboard />);

      // Must NOT make any API calls
      expect(fetchSpy).toHaveBeenCalledTimes(0);

      // Verify dashboard content is rendered
      expect(screen.getByTestId("demo-dashboard")).toBeDefined();
      expect(screen.getByTestId("tenant-info-name").textContent).toBe("Contoso Demo Corporation (Sample)");
      expect(screen.getByTestId("assessment-headline-score").textContent).toBe("84%");
      expect(screen.getByTestId("secure-score-percentage").textContent).toBe("84%");
      expect(screen.getByTestId("mfa-enforced-percentage").textContent).toBe("90%");
      expect(screen.getByTestId("auth-method-total-users").textContent).toBe("100 users");
    });

    it("exposes all data-tutorial markers specified in dashboard-overview.json for all 8 v1 widgets", () => {
      const tourJsonPath = join(process.cwd(), "src/data/tutorials/dashboard-overview.json");
      const tourRaw = readFileSync(tourJsonPath, "utf8");
      const tour: TourDefinition = JSON.parse(tourRaw);

      render(<DemoDashboard />);

      expect(tour.steps.length).toBe(8);

      for (const step of tour.steps) {
        // Query element by [data-tutorial='...'] selector
        const markerEl = document.querySelector(step.target);
        expect(
          markerEl,
          `Expected DOM element for tutorial marker ${step.tutorialMarker} (step: ${step.step} - ${step.title})`
        ).not.toBeNull();
      }
    });

    it("aligns WIDGET_TUTORIAL_MARKERS with tour definition", () => {
      const tourJsonPath = join(process.cwd(), "src/data/tutorials/dashboard-overview.json");
      const tourRaw = readFileSync(tourJsonPath, "utf8");
      const tour: TourDefinition = JSON.parse(tourRaw);

      for (const step of tour.steps) {
        const key = step.widgetId as keyof typeof WIDGET_TUTORIAL_MARKERS;
        expect(WIDGET_TUTORIAL_MARKERS[key]).toBe(step.tutorialMarker);
      }
    });
  });

  describe("zero colour literals", () => {
    it("strictly enforces report theme tokens with zero colour literals in demo dataset file", () => {
      const filePath = join(process.cwd(), "src/data/dashboard-demo.ts");
      const code = readFileSync(filePath, "utf8");

      expect(code, "dashboard-demo.ts contains hex color literal").not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(code, "dashboard-demo.ts contains rgb color literal").not.toMatch(/\brgba?\s*\(/i);
      expect(code, "dashboard-demo.ts contains hsl color literal").not.toMatch(/\bhsla?\s*\(/i);
    });
  });
});
