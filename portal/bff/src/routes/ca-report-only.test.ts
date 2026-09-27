import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { tenantScope } from "../rbac/scope.js";
import {
  CA_READ_PERMISSION,
  CA_REPORT_ONLY_PATH,
  createCaReportOnlyRoutes,
  type CaReportOnlyFilter,
  type CaReportOnlyProvider,
  type CaReportOnlyResponse,
  type CaReportOnlyRoutesOptions,
} from "./ca-report-only.js";

const TENANT = "tenant-test";

class FakeCaReportOnlyProvider implements CaReportOnlyProvider {
  readonly calls: Array<{ tenantId: string; filter?: CaReportOnlyFilter }> = [];

  sampleResponse: CaReportOnlyResponse = {
    tenantId: TENANT,
    reportOnlyPolicies: [
      {
        policyId: "pol-ro-1",
        policyName: "Require MFA (Report-Only)",
        state: "enabledForReportingButNotEnforced",
        controlsSummary: "Require MFA",
        totalEvaluated: 15,
        wouldBlockCount: 3,
        wouldGrantCount: 10,
        notAppliedCount: 2,
        affectedUsers: [{ userPrincipalName: "user1@contoso.com", failCount: 3 }],
        affectedApps: [{ appDisplayName: "Exchange Online", failCount: 3 }],
        sampleEvents: [
          {
            id: "si-1",
            createdDateTime: "2026-09-26T12:00:00Z",
            userPrincipalName: "user1@contoso.com",
            appDisplayName: "Exchange Online",
            ipAddress: "192.168.1.1",
            location: "New York, US",
            result: "reportOnlyFailure",
            wouldBlock: true,
          },
        ],
      },
    ],
    summary: {
      totalReportOnlyPolicies: 1,
      totalEvaluated: 15,
      totalWouldBlock: 3,
    },
  };

  async getReportOnlyEvaluation(
    tenantId: string,
    filter?: CaReportOnlyFilter,
  ): Promise<CaReportOnlyResponse> {
    this.calls.push({ tenantId, filter });
    return this.sampleResponse;
  }
}

function createHarness(overrides?: Partial<CaReportOnlyRoutesOptions>) {
  const provider = new FakeCaReportOnlyProvider();
  let defaultCaller: any = {
    userId: "user-1",
    roles: ["admin"],
    permissions: [CA_READ_PERMISSION],
    tenantScope: tenantScope([TENANT]),
  };

  const routes = createCaReportOnlyRoutes({
    provider,
    resolveCaller: () => defaultCaller,
    ...overrides,
  });

  const getRoute = () => {
    const route = routes.find((r) => r.method === "GET" && r.path === CA_REPORT_ONLY_PATH);
    if (!route) throw new Error("Route not found");
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

describe("GET /v1/tenants/:tenantId/ca/report-only (T-0289)", () => {
  it("rejects unauthenticated request", async () => {
    const harness = createHarness({ resolveCaller: () => undefined });
    const route = harness.getRoute();
    await expect(
      route.handler({
        path: `/v1/tenants/${TENANT}/ca/report-only`,
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
        headers: {},
      }),
    ).rejects.toThrow(AppError);
  });

  it("rejects caller outside tenant scope", async () => {
    const harness = createHarness();
    harness.setCaller({
      userId: "user-other",
      permissions: [CA_READ_PERMISSION],
      tenantScope: tenantScope(["other-tenant"]),
    });
    const route = harness.getRoute();
    await expect(
      route.handler({
        path: `/v1/tenants/${TENANT}/ca/report-only`,
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
        headers: {},
      }),
    ).rejects.toThrow(AppError);
  });

  it("rejects caller missing ca.read permission", async () => {
    const harness = createHarness();
    harness.setCaller({
      userId: "user-none",
      permissions: ["unrelated.perm"],
      tenantScope: tenantScope([TENANT]),
    });
    const route = harness.getRoute();
    await expect(
      route.handler({
        path: `/v1/tenants/${TENANT}/ca/report-only`,
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
        headers: {},
      }),
    ).rejects.toThrow(AppError);
  });

  it("returns report-only evaluation data", async () => {
    const harness = createHarness();
    const route = harness.getRoute();
    const res = await route.handler({
      path: `/v1/tenants/${TENANT}/ca/report-only`,
      params: { tenantId: TENANT },
      query: new URLSearchParams(),
      headers: {},
    });
    expect(res.status).toBe(200);
    const body = (res.body as any);
    expect(body.tenantId).toBe(TENANT);
    expect(body.summary.totalReportOnlyPolicies).toBe(1);
    expect(body.reportOnlyPolicies[0].policyName).toBe("Require MFA (Report-Only)");
    expect(body.reportOnlyPolicies[0].wouldBlockCount).toBe(3);
    expect(body.reportOnlyPolicies[0].affectedUsers[0].userPrincipalName).toBe("user1@contoso.com");
  });

  it("passes optional policyId filter", async () => {
    const harness = createHarness();
    const route = harness.getRoute();
    await route.handler({
      path: `/v1/tenants/${TENANT}/ca/report-only`,
      params: { tenantId: TENANT },
      query: new URLSearchParams({ policyId: "pol-ro-1" }),
      headers: {},
    });
    expect(harness.provider.calls[0]!.filter?.policyId).toBe("pol-ro-1");
  });
});
