/** @vitest-environment jsdom */
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FindingsDrillThrough, type FindingItem } from "./FindingsDrillThrough";
import {
  serializeFindingsFilter,
  parseFindingsFilter,
  buildFindingsUrl,
  filterFromWidgetMetric,
  matchesFindingsFilter,
  type FindingsFilter,
} from "../../lib/findings-filter";

const SAMPLE_FINDINGS: FindingItem[] = [
  {
    id: "SEC-001",
    controlName: "Require MFA for Global Administrators",
    status: "Fail",
    severity: "Critical",
    category: "Identity",
    collector: "EntraCollector",
    tenantId: "tenant-contoso",
    message: "2 of 3 global administrators do not have MFA enforced.",
  },
  {
    id: "SEC-002",
    controlName: "Block Legacy Authentication Protocols",
    status: "Warning",
    severity: "High",
    category: "Identity",
    collector: "EntraCollector",
    tenantId: "tenant-contoso",
    message: "Legacy authentication client apps were observed in recent sign-in logs.",
  },
  {
    id: "SEC-003",
    controlName: "Enable Audit Logging",
    status: "Pass",
    severity: "Low",
    category: "Security",
    collector: "ExchangeCollector",
    tenantId: "tenant-contoso",
    message: "Unified Audit Log ingestion is enabled across the tenant.",
  },
  {
    id: "SEC-004",
    controlName: "Review External Guest Access",
    status: "Review",
    severity: "Medium",
    category: "Collaboration",
    collector: "SharePointCollector",
    tenantId: "tenant-contoso",
    message: "5 guest users have been inactive for over 90 days.",
  },
  {
    id: "SEC-005",
    controlName: "Compliance Manager DLP Policies",
    status: "NotLicensed",
    severity: "Medium",
    category: "Compliance",
    collector: "PurviewCollector",
    tenantId: "tenant-contoso",
    message: "Purview Information Protection licensing not found.",
  },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Findings Filter & Drill-Through (T-0069)", () => {
  describe("findings-filter library", () => {
    it("round-trips filter context through URL serialization and parsing", () => {
      const initialFilter: FindingsFilter = {
        tenantId: "tenant-contoso",
        runId: "run-123",
        status: "Fail",
        severity: "Critical",
        category: "Identity",
        search: "MFA",
      };

      const queryString = serializeFindingsFilter(initialFilter);
      expect(queryString).toContain("tenantId=tenant-contoso");
      expect(queryString).toContain("status=Fail");
      expect(queryString).toContain("severity=Critical");

      const parsed = parseFindingsFilter(queryString);
      expect(parsed.tenantId).toBe("tenant-contoso");
      expect(parsed.runId).toBe("run-123");
      expect(parsed.status).toBe("Fail");
      expect(parsed.severity).toBe("Critical");
      expect(parsed.category).toBe("Identity");
      expect(parsed.search).toBe("MFA");

      const navUrl = buildFindingsUrl("/runs/run-123", initialFilter);
      expect(navUrl.startsWith("/runs/run-123?")).toBe(true);
    });

    it("derives correct FindingsFilter from widget metric drill-downs", () => {
      // Alerts Overview widget: Critical
      const alertCrit = filterFromWidgetMetric("AlertsOverviewCard", "critical", "tenant-contoso");
      expect(alertCrit.severity).toBe("Critical");
      expect(alertCrit.status).toBe("Fail");
      expect(alertCrit.tenantId).toBe("tenant-contoso");

      // Alerts Overview widget: High
      const alertHigh = filterFromWidgetMetric("AlertsOverviewCard", "high");
      expect(alertHigh.severity).toBe("High");
      expect(alertHigh.status).toBe("Fail");

      // Assessment Card: Fail
      const assessFail = filterFromWidgetMetric("AssessmentCard", "fail", "tenant-contoso", "run-1");
      expect(assessFail.status).toBe("Fail");
      expect(assessFail.tenantId).toBe("tenant-contoso");
      expect(assessFail.runId).toBe("run-1");

      // Metrics Grid: critical-high
      const metricCrit = filterFromWidgetMetric("TenantMetricsGrid", "critical-high");
      expect(metricCrit.severity).toBe("Critical");
      expect(metricCrit.status).toBe("Fail");

      // Auth methods: MFA
      const mfaFilter = filterFromWidgetMetric("AuthMethodCard", "mfa");
      expect(mfaFilter.category).toBe("Identity");
      expect(mfaFilter.search).toBe("mfa");
    });

    it("evaluates matchesFindingsFilter predicate accurately", () => {
      const f1 = SAMPLE_FINDINGS[0]; // Fail, Critical, Identity
      expect(matchesFindingsFilter(f1, { status: "Fail" })).toBe(true);
      expect(matchesFindingsFilter(f1, { status: "Pass" })).toBe(false);
      expect(matchesFindingsFilter(f1, { severity: "Critical" })).toBe(true);
      expect(matchesFindingsFilter(f1, { severity: "Low" })).toBe(false);
      expect(matchesFindingsFilter(f1, { search: "administrators" })).toBe(true);
      expect(matchesFindingsFilter(f1, { search: "nonexistent" })).toBe(false);
    });
  });

  describe("FindingsDrillThrough component", () => {
    it("renders findings matching active filter and displays filter chips", () => {
      const handleFilterChange = vi.fn();
      render(
        <FindingsDrillThrough
          findings={SAMPLE_FINDINGS}
          filter={{ status: "Fail", severity: "Critical" }}
          onFilterChange={handleFilterChange}
        />
      );

      // Only SEC-001 should be rendered
      expect(screen.getByTestId("finding-row-SEC-001")).toBeDefined();
      expect(screen.queryByTestId("finding-row-SEC-002")).toBeNull();
      expect(screen.queryByTestId("finding-row-SEC-003")).toBeNull();

      // Check filter chips
      expect(screen.getByTestId("active-filter-chip-status")).toBeDefined();
      expect(screen.getByTestId("active-filter-chip-severity")).toBeDefined();
      expect(screen.getByTestId("findings-count-badge").textContent).toBe("1 of 5 findings");
    });

    it("removes filter chip and notifies onFilterChange", () => {
      const handleFilterChange = vi.fn();
      render(
        <FindingsDrillThrough
          findings={SAMPLE_FINDINGS}
          filter={{ status: "Fail", severity: "Critical" }}
          onFilterChange={handleFilterChange}
        />
      );

      const removeSeverityBtn = screen.getByTestId("remove-filter-severity");
      fireEvent.click(removeSeverityBtn);

      expect(handleFilterChange).toHaveBeenCalledWith({
        status: "Fail",
        severity: null,
      });
    });

    it("clears all filters when Clear filters button is clicked", () => {
      const handleFilterChange = vi.fn();
      render(
        <FindingsDrillThrough
          findings={SAMPLE_FINDINGS}
          filter={{ status: "Fail", severity: "Critical" }}
          onFilterChange={handleFilterChange}
        />
      );

      const clearBtn = screen.getByTestId("clear-all-filters-btn");
      fireEvent.click(clearBtn);

      expect(handleFilterChange).toHaveBeenCalledWith({});
    });

    it("renders nine-status vocabulary tokens properly", () => {
      render(<FindingsDrillThrough findings={SAMPLE_FINDINGS} filter={{}} />);

      expect(screen.getByTestId("finding-status-SEC-001").textContent).toBe("Fail");
      expect(screen.getByTestId("finding-status-SEC-002").textContent).toBe("Warning");
      expect(screen.getByTestId("finding-status-SEC-003").textContent).toBe("Pass");
      expect(screen.getByTestId("finding-status-SEC-004").textContent).toBe("Review");
      expect(screen.getByTestId("finding-status-SEC-005").textContent).toBe("NotLicensed");
    });

    it("triggers onNavigateToFinding when finding row or action button is clicked", () => {
      const handleNavigate = vi.fn();
      render(
        <FindingsDrillThrough
          findings={SAMPLE_FINDINGS}
          filter={{}}
          onNavigateToFinding={handleNavigate}
        />
      );

      const actionBtn = screen.getByTestId("finding-action-btn-SEC-001");
      fireEvent.click(actionBtn);
      expect(handleNavigate).toHaveBeenCalledWith("SEC-001");
    });

    it("renders empty state message when no findings match", () => {
      render(
        <FindingsDrillThrough
          findings={SAMPLE_FINDINGS}
          filter={{ status: "Skipped" }}
        />
      );

      expect(screen.getByTestId("findings-table-empty")).toBeDefined();
    });
  });

  describe("zero colour literals", () => {
    it("strictly enforces report theme tokens with zero colour literals in all drill-through components", () => {
      const files = [
        "src/components/dashboard/FindingsDrillThrough.tsx",
        "src/lib/findings-filter.ts",
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
