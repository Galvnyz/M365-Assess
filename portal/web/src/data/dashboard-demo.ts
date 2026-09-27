// Dashboard demo dataset and demo renderer (EPIC-004 SPEC.md §3.5, §11.1, T-0070).
// Provides typed placeholder data with no real tenant names, domains, or UPNs,
// mapping data-tutorial markers to v1 widgets for guided onboarding tours.
// Strictly uses report theme tokens with zero colour literals.

import React, { type CSSProperties, type ReactElement } from "react";
import { DashboardGrid } from "../components/dashboard/DashboardGrid";
import { TenantInfoCard } from "../components/dashboard/TenantInfoCard";
import { TenantMetricsGrid } from "../components/dashboard/TenantMetricsGrid";
import { AssessmentCard } from "../components/dashboard/AssessmentCard";
import { AlertsOverviewCard } from "../components/dashboard/AlertsOverviewCard";
import { SecureScoreCard } from "../components/dashboard/SecureScoreCard";
import { AuthMethodCard } from "../components/dashboard/AuthMethodCard";
import { MFACard } from "../components/dashboard/MFACard";
import { LicenseCard } from "../components/dashboard/LicenseCard";

export const WIDGET_TUTORIAL_MARKERS = {
  TenantInfoCard: "widget-tenant-info",
  TenantMetricsGrid: "widget-tenant-metrics",
  AssessmentCard: "widget-assessment",
  AlertsOverviewCard: "widget-alerts-overview",
  SecureScoreCard: "widget-secure-score",
  AuthMethodCard: "widget-auth-methods",
  MFACard: "widget-mfa",
  LicenseCard: "widget-licenses",
} as const;

export interface DemoDashboardPayload {
  readonly schemaVersion: "v1";
  readonly tenantId: string;
  readonly isEmpty: false;
  readonly emptyState: null;
  readonly tenantInfo: {
    readonly tenantId: string;
    readonly displayName: string;
    readonly defaultDomain: string;
    readonly initialDomain: string;
    readonly status: string;
    readonly source: string;
    readonly lastRunAt: string;
  };
  readonly score: {
    readonly current: number;
    readonly max: number;
    readonly percentage: number;
    readonly evaluatedCount: number;
  };
  readonly assessment: {
    readonly runId: string;
    readonly finishedAt: string;
    readonly status: string;
    readonly headlineScore: number;
    readonly summaryCounts: {
      readonly pass: number;
      readonly fail: number;
      readonly warning: number;
      readonly review: number;
      readonly skipped: number;
      readonly notLicensed: number;
      readonly total: number;
    };
  };
  readonly metrics: {
    readonly metrics: readonly {
      readonly id: string;
      readonly label: string;
      readonly value: string | number;
      readonly status: string;
    }[];
  };
  readonly alerts: {
    readonly critical: number;
    readonly high: number;
    readonly medium: number;
    readonly low: number;
    readonly total: number;
  };
  readonly authMethods: {
    readonly phishingResistant: number;
    readonly authenticatorApp: number;
    readonly smsOrVoice: number;
    readonly passwordOnly: number;
    readonly totalUsers: number;
  };
  readonly mfa: {
    readonly enforcedPercentage: number;
    readonly registeredCount: number;
    readonly totalUsers: number;
    readonly adminMfaPercentage: number;
  };
  readonly licenses: {
    readonly totalAssigned: number;
    readonly totalPurchased: number;
    readonly topSkus: readonly {
      readonly name: string;
      readonly assigned: number;
      readonly total: number;
    }[];
  };
  readonly identity: {
    readonly mfaEnforcedCount: number;
    readonly adminCount: number;
    readonly riskyUserCount: number;
    readonly totalUsers: number;
  };
  readonly devices: {
    readonly compliantCount: number;
    readonly nonCompliantCount: number;
    readonly totalDevices: number;
  };
  readonly generatedAt: string;
}

export interface DemoFleetPayload {
  readonly schemaVersion: "v1";
  readonly total: number;
  readonly generatedAt: string;
  readonly items: readonly {
    readonly tenantId: string;
    readonly displayName: string;
    readonly defaultDomain: string;
    readonly status: string;
    readonly hasCompletedRun: boolean;
    readonly score: number | null;
    readonly complianceRate: number | null;
    readonly lastRunAt: string | null;
    readonly lastRunId: string | null;
    readonly lastRunStatus: string | null;
    readonly findingCounts: {
      readonly pass: number;
      readonly fail: number;
      readonly warning: number;
      readonly total: number;
    } | null;
    readonly openAlerts: {
      readonly critical: number;
      readonly high: number;
      readonly medium: number;
      readonly low: number;
      readonly total: number;
    };
  }[];
}

export const DEMO_DASHBOARD_PAYLOAD: DemoDashboardPayload = {
  schemaVersion: "v1",
  tenantId: "demo-tenant-sample-01",
  isEmpty: false,
  emptyState: null,
  tenantInfo: {
    tenantId: "demo-tenant-sample-01",
    displayName: "Contoso Demo Corporation (Sample)",
    defaultDomain: "contoso.demo.example.com",
    initialDomain: "contosodemo.onmicrosoft.example",
    status: "active",
    source: "demo",
    lastRunAt: "2026-09-26T12:00:00.000Z",
  },
  score: {
    current: 295,
    max: 350,
    percentage: 84,
    evaluatedCount: 46,
  },
  assessment: {
    runId: "run-demo-sample-001",
    finishedAt: "2026-09-26T12:00:00.000Z",
    status: "succeeded",
    headlineScore: 84,
    summaryCounts: {
      pass: 42,
      fail: 3,
      warning: 2,
      review: 1,
      skipped: 0,
      notLicensed: 0,
      total: 48,
    },
  },
  metrics: {
    metrics: [
      { id: "score", label: "Security Score", value: "84%", status: "pass" },
      { id: "evaluated", label: "Evaluated Checks", value: 48, status: "neutral" },
      { id: "passed", label: "Passed Checks", value: 42, status: "pass" },
      { id: "failed", label: "Failed Checks", value: 3, status: "fail" },
      { id: "critical-high", label: "Critical/High Alerts", value: 2, status: "fail" },
      { id: "warnings", label: "Warnings & Review", value: 3, status: "warn" },
    ],
  },
  alerts: {
    critical: 1,
    high: 1,
    medium: 4,
    low: 6,
    total: 12,
  },
  authMethods: {
    phishingResistant: 35,
    authenticatorApp: 55,
    smsOrVoice: 8,
    passwordOnly: 2,
    totalUsers: 100,
  },
  mfa: {
    enforcedPercentage: 90,
    registeredCount: 95,
    totalUsers: 100,
    adminMfaPercentage: 100,
  },
  licenses: {
    totalAssigned: 85,
    totalPurchased: 100,
    topSkus: [
      { name: "Demo Microsoft 365 E5", assigned: 50, total: 50 },
      { name: "Demo Microsoft 365 Business Premium", assigned: 30, total: 40 },
      { name: "Demo Microsoft Entra ID P2", assigned: 5, total: 10 },
    ],
  },
  identity: {
    mfaEnforcedCount: 90,
    adminCount: 4,
    riskyUserCount: 1,
    totalUsers: 100,
  },
  devices: {
    compliantCount: 95,
    nonCompliantCount: 5,
    totalDevices: 100,
  },
  generatedAt: "2026-09-26T12:00:00.000Z",
};

export const DEMO_FLEET_PAYLOAD: DemoFleetPayload = {
  schemaVersion: "v1",
  total: 3,
  generatedAt: "2026-09-26T12:00:00.000Z",
  items: [
    {
      tenantId: "demo-tenant-sample-01",
      displayName: "Contoso Demo Corporation (Sample)",
      defaultDomain: "contoso.demo.example.com",
      status: "active",
      hasCompletedRun: true,
      score: 84,
      complianceRate: 88,
      lastRunAt: "2026-09-26T12:00:00.000Z",
      lastRunId: "run-demo-sample-001",
      lastRunStatus: "succeeded",
      findingCounts: { pass: 42, fail: 3, warning: 2, total: 47 },
      openAlerts: { critical: 1, high: 1, medium: 4, low: 6, total: 12 },
    },
    {
      tenantId: "demo-tenant-sample-02",
      displayName: "Fabrikam Demo Ltd (Sample)",
      defaultDomain: "fabrikam.demo.example.com",
      status: "active",
      hasCompletedRun: true,
      score: 76,
      complianceRate: 79,
      lastRunAt: "2026-09-26T11:00:00.000Z",
      lastRunId: "run-demo-sample-002",
      lastRunStatus: "succeeded",
      findingCounts: { pass: 35, fail: 8, warning: 4, total: 47 },
      openAlerts: { critical: 2, high: 3, medium: 5, low: 2, total: 12 },
    },
    {
      tenantId: "demo-tenant-sample-03",
      displayName: "Woodgrove Demo Bank (Sample)",
      defaultDomain: "woodgrove.demo.example.com",
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

export function getDemoDashboardPayload(): DemoDashboardPayload {
  return DEMO_DASHBOARD_PAYLOAD;
}

export function getDemoFleetPayload(): DemoFleetPayload {
  return DEMO_FLEET_PAYLOAD;
}

export interface DemoDashboardProps {
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * Demo dashboard component that renders all 8 v1 widgets from demo data without any API call,
 * with each widget container exposing the exact data-tutorial attribute defined in dashboard-overview.json.
 */
export function DemoDashboard(props?: DemoDashboardProps): ReactElement {
  return React.createElement(
    "div",
    {
      "data-testid": "demo-dashboard",
      className: props?.className,
      style: {
        display: "flex",
        flexDirection: "column",
        gap: "24px",
        width: "100%",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        color: "var(--text)",
        ...props?.style,
      },
    },
    React.createElement(DashboardGrid, {
      overviewRow: React.createElement(
        React.Fragment,
        null,
        React.createElement(
          "div",
          { "data-tutorial": "widget-tenant-info", style: { display: "contents" } },
          React.createElement(TenantInfoCard, { tenantInfo: DEMO_DASHBOARD_PAYLOAD.tenantInfo }),
        ),
        React.createElement(
          "div",
          { "data-tutorial": "widget-tenant-metrics", style: { display: "contents" } },
          React.createElement(TenantMetricsGrid, { metrics: DEMO_DASHBOARD_PAYLOAD.metrics }),
        ),
        React.createElement(
          "div",
          { "data-tutorial": "widget-assessment", style: { display: "contents" } },
          React.createElement(AssessmentCard, { assessment: DEMO_DASHBOARD_PAYLOAD.assessment }),
        ),
      ),
      alertsRow: React.createElement(
        "div",
        { "data-tutorial": "widget-alerts-overview", style: { display: "contents" } },
        React.createElement(AlertsOverviewCard, { alerts: DEMO_DASHBOARD_PAYLOAD.alerts }),
      ),
      identityBlock: React.createElement(
        React.Fragment,
        null,
        React.createElement(
          "div",
          { "data-tutorial": "widget-secure-score", style: { display: "contents" } },
          React.createElement(SecureScoreCard, { score: DEMO_DASHBOARD_PAYLOAD.score }),
        ),
        React.createElement(
          "div",
          { "data-tutorial": "widget-auth-methods", style: { display: "contents" } },
          React.createElement(AuthMethodCard, { authMethods: DEMO_DASHBOARD_PAYLOAD.authMethods }),
        ),
        React.createElement(
          "div",
          { "data-tutorial": "widget-mfa", style: { display: "contents" } },
          React.createElement(MFACard, { mfa: DEMO_DASHBOARD_PAYLOAD.mfa }),
        ),
        React.createElement(
          "div",
          { "data-tutorial": "widget-licenses", style: { display: "contents" } },
          React.createElement(LicenseCard, { licenses: DEMO_DASHBOARD_PAYLOAD.licenses }),
        ),
      ),
    }),
  );
}
