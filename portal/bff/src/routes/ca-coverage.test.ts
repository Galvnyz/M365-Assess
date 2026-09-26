import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { tenantScope } from "../rbac/scope.js";
import {
  CA_COVERAGE_PATH,
  CA_HISTORY_PATH,
  CA_READ_PERMISSION,
  createCaCoverageRoutes,
  type CaCoverageProvider,
  type CaCoverageResponse,
  type CaHistoryFilter,
  type CaHistoryResponse,
  type CaCoverageRoutesOptions,
} from "./ca-coverage.js";

const TENANT = "tenant-test";

class FakeCaCoverageProvider implements CaCoverageProvider {
  readonly historyCalls: Array<{ tenantId: string; filter?: CaHistoryFilter }> = [];

  sampleCoverage: CaCoverageResponse = {
    tenantId: TENANT,
    summary: {
      totalUsers: 50,
      coveredUsersCount: 45,
      uncoveredUsersCount: 5,
      userCoveragePct: 90,
      totalApps: 20,
      coveredAppsCount: 18,
      uncoveredAppsCount: 2,
      appCoveragePct: 90,
      activePoliciesCount: 4,
      totalGapsCount: 2,
    },
    gaps: [
      {
        category: "Guest Accounts",
        severity: "high",
        title: "3 guest accounts not covered by any active policy",
        description: "External accounts without MFA represent an elevated threat vector.",
        count: 3,
      },
      {
        category: "Cloud Apps",
        severity: "medium",
        title: "2 cloud applications unprotected",
        description: "Applications omitted from policy scope allow unauthenticated access.",
        count: 2,
      },
    ],
    coveredUsers: [
      {
        id: "u-1",
        displayName: "Alice Admin",
        userPrincipalName: "alice@contoso.com",
        userType: "Member",
        policies: [{ id: "pol-1", displayName: "Require MFA" }],
      },
    ],
    uncoveredUsers: [
      {
        id: "u-2",
        displayName: "Guest Contractor",
        userPrincipalName: "contractor#EXT#@contoso.com",
        userType: "Guest",
        reason: "No active Conditional Access policy targets this user",
      },
    ],
    coveredApps: [
      {
        appId: "app-1",
        displayName: "Exchange Online",
        policies: [{ id: "pol-1", displayName: "Require MFA" }],
      },
    ],
    uncoveredApps: [
      {
        appId: "app-2",
        displayName: "Legacy Portal",
        reason: "No active Conditional Access policy targets this cloud application",
      },
    ],
  };

  sampleHistory: CaHistoryResponse = {
    tenantId: TENANT,
    totalCount: 2,
    items: [
      {
        id: "hist-1",
        tenantId: TENANT,
        policyId: "pol-1",
        policyName: "Require MFA",
        timestamp: "2026-09-26T14:30:00Z",
        initiatedBy: "admin@contoso.com",
        action: "ca.policy.edit",
        source: "portal",
        diff: ["~ State: report-only -> enabled"],
        before: { state: "enabledForReportingButNotEnforced" },
        after: { state: "enabled" },
      },
      {
        id: "audit-dir-1",
        tenantId: TENANT,
        policyId: "pol-1",
        policyName: "Require MFA",
        timestamp: "2026-09-26T14:30:05Z",
        initiatedBy: "admin@contoso.com",
        action: "Update conditional access policy",
        source: "directoryAudit",
      },
    ],
  };

  async getCoverage(tenantId: string): Promise<CaCoverageResponse> {
    return this.sampleCoverage;
  }

  async getHistory(tenantId: string, filter?: CaHistoryFilter): Promise<CaHistoryResponse> {
    this.historyCalls.push({ tenantId, filter });
    return this.sampleHistory;
  }
}

function createHarness(overrides?: Partial<CaCoverageRoutesOptions>) {
  const provider = new FakeCaCoverageProvider();
  let defaultCaller: any = {
    userId: "user-1",
    roles: ["admin"],
    permissions: [CA_READ_PERMISSION],
    tenantScope: tenantScope([TENANT]),
  };

  const routes = createCaCoverageRoutes({
    provider,
    resolveCaller: () => defaultCaller,
    ...overrides,
  });

  const getRoute = (method: string, path: string) => {
    const route = routes.find((r) => r.method === method && r.path === path);
    if (!route) throw new Error(`Route not found: ${method} ${path}`);
    return route;
  };

  return {
    provider,
    routes,
    getRoute,
    setCaller: (c: any) => {
      defaultCaller = c;
    },
  };
}

describe("GET /v1/tenants/:tenantId/ca/coverage (T-0290)", () => {
  it("rejects unauthenticated caller", async () => {
    const harness = createHarness({ resolveCaller: () => undefined });
    const route = harness.getRoute("GET", CA_COVERAGE_PATH);
    await expect(
      route.handler({
        path: `/v1/tenants/${TENANT}/ca/coverage`,
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
        headers: {},
      }),
    ).rejects.toThrow(AppError);
  });

  it("returns coverage data with identified gaps", async () => {
    const harness = createHarness();
    const route = harness.getRoute("GET", CA_COVERAGE_PATH);
    const res = await route.handler({
      path: `/v1/tenants/${TENANT}/ca/coverage`,
      params: { tenantId: TENANT },
      query: new URLSearchParams(),
      headers: {},
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.tenantId).toBe(TENANT);
    expect(body.summary.userCoveragePct).toBe(90);
    expect(body.gaps).toHaveLength(2);
    expect(body.uncoveredUsers[0].displayName).toBe("Guest Contractor");
    expect(body.uncoveredApps[0].displayName).toBe("Legacy Portal");
  });
});

describe("GET /v1/tenants/:tenantId/ca/history (T-0290)", () => {
  it("returns per-policy change history merging directory audits with portal records", async () => {
    const harness = createHarness();
    const route = harness.getRoute("GET", CA_HISTORY_PATH);
    const res = await route.handler({
      path: `/v1/tenants/${TENANT}/ca/history`,
      params: { tenantId: TENANT },
      query: new URLSearchParams({ policyId: "pol-1" }),
      headers: {},
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.totalCount).toBe(2);
    expect(body.items[0].source).toBe("portal");
    expect(body.items[1].source).toBe("directoryAudit");
    expect(harness.provider.historyCalls[0]!.filter?.policyId).toBe("pol-1");
  });
});
