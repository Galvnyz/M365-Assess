import { describe, expect, it } from "vitest";
import { tenantScope } from "../rbac/scope.js";
import {
  GROUP_USAGE_PATH,
  GROUPS_READ_PERMISSION,
  createGroupUsageRoutes,
  type GroupUsageCaller,
  type GroupUsageProvider,
  type GroupUsageReport,
} from "./groups-usage.js";

const TENANT = "tenant-usage-test";

class FakeGroupUsageProvider implements GroupUsageProvider {
  readonly calls: Array<{ tenantId: string; inactiveDaysThreshold: number }> = [];

  async getUsage(tenantId: string, inactiveDaysThreshold: number): Promise<GroupUsageReport> {
    this.calls.push({ tenantId, inactiveDaysThreshold });
    return {
      tenantId,
      generatedAt: "2026-09-26T12:00:00Z",
      inactiveDaysThreshold,
      summary: {
        totalGroups: 5,
        ownerlessGroupsCount: 1,
        inactiveGroupsCount: 2,
        totalGuestsCount: 8,
        totalMembersCount: 42,
      },
      membershipGrowth: [
        { period: "2026-06", memberCount: 30 },
        { period: "2026-09", memberCount: 42 },
      ],
      ownerlessGroups: [
        {
          id: "grp-orphan",
          displayName: "Orphan Team",
          mail: "orphan@contoso.com",
          groupType: "m365",
          membersCount: 4,
          lastActivityDate: "2026-08-01T00:00:00Z",
        },
      ],
      inactiveGroups: [
        {
          id: "grp-stale",
          displayName: "Stale Team",
          mail: "stale@contoso.com",
          groupType: "security",
          membersCount: 10,
          ownersCount: 1,
          lastActivityDate: "2026-01-01T00:00:00Z",
          daysInactive: 268,
        },
      ],
      guestMetrics: {
        totalGuests: 8,
        groupsWithGuestsCount: 2,
        topGuestGroups: [
          { id: "grp-stale", displayName: "Stale Team", guestCount: 5 },
          { id: "grp-orphan", displayName: "Orphan Team", guestCount: 3 },
        ],
      },
    };
  }
}

describe("Group usage routes (T-0270)", () => {
  const getRoutes = (provider: FakeGroupUsageProvider, caller?: GroupUsageCaller) => {
    return createGroupUsageRoutes({
      provider,
      resolveCaller: () => caller,
    });
  };

  it("rejects unauthenticated requests with 401", async () => {
    const provider = new FakeGroupUsageProvider();
    const routes = getRoutes(provider, undefined);
    const usageRoute = routes.find((r) => r.path === GROUP_USAGE_PATH)!;

    await expect(
      usageRoute.handler({
        method: "GET",
        path: `/v1/tenants/${TENANT}/groups/usage`,
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
        headers: {},
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects tenant outside caller scope with 403", async () => {
    const provider = new FakeGroupUsageProvider();
    const caller: GroupUsageCaller = {
      tenantScope: tenantScope(["other-tenant"]),
      permissions: [GROUPS_READ_PERMISSION],
    };
    const routes = getRoutes(provider, caller);
    const usageRoute = routes.find((r) => r.path === GROUP_USAGE_PATH)!;

    await expect(
      usageRoute.handler({
        method: "GET",
        path: `/v1/tenants/${TENANT}/groups/usage`,
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
        headers: {},
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects missing permissions with 403", async () => {
    const provider = new FakeGroupUsageProvider();
    const caller: GroupUsageCaller = {
      tenantScope: tenantScope([TENANT]),
      permissions: ["remediation.read"],
    };
    const routes = getRoutes(provider, caller);
    const usageRoute = routes.find((r) => r.path === GROUP_USAGE_PATH)!;

    await expect(
      usageRoute.handler({
        method: "GET",
        path: `/v1/tenants/${TENANT}/groups/usage`,
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
        headers: {},
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("validates inactiveDaysThreshold query parameter", async () => {
    const provider = new FakeGroupUsageProvider();
    const caller: GroupUsageCaller = {
      tenantScope: tenantScope([TENANT]),
      permissions: [GROUPS_READ_PERMISSION],
    };
    const routes = getRoutes(provider, caller);
    const usageRoute = routes.find((r) => r.path === GROUP_USAGE_PATH)!;

    await expect(
      usageRoute.handler({
        method: "GET",
        path: `/v1/tenants/${TENANT}/groups/usage`,
        params: { tenantId: TENANT },
        query: new URLSearchParams("inactiveDaysThreshold=-5"),
        headers: {},
      }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      usageRoute.handler({
        method: "GET",
        path: `/v1/tenants/${TENANT}/groups/usage`,
        params: { tenantId: TENANT },
        query: new URLSearchParams("inactiveDaysThreshold=abc"),
        headers: {},
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("returns group usage metrics with default 90 days threshold", async () => {
    const provider = new FakeGroupUsageProvider();
    const caller: GroupUsageCaller = {
      tenantScope: tenantScope([TENANT]),
      permissions: [GROUPS_READ_PERMISSION],
    };
    const routes = getRoutes(provider, caller);
    const usageRoute = routes.find((r) => r.path === GROUP_USAGE_PATH)!;

    const res = await usageRoute.handler({
      method: "GET",
      path: `/v1/tenants/${TENANT}/groups/usage`,
      params: { tenantId: TENANT },
      query: new URLSearchParams(),
      headers: {},
    });

    expect(res.status).toBe(200);
    const body = res.body as GroupUsageReport;
    expect(body.tenantId).toBe(TENANT);
    expect(body.inactiveDaysThreshold).toBe(90);
    expect(body.summary.totalGroups).toBe(5);
    expect(body.summary.ownerlessGroupsCount).toBe(1);
    expect(body.ownerlessGroups).toHaveLength(1);
    expect(body.inactiveGroups).toHaveLength(1);
    expect(body.guestMetrics.totalGuests).toBe(8);
    expect(provider.calls[0]?.inactiveDaysThreshold).toBe(90);
  });

  it("accepts custom inactiveDaysThreshold query parameter", async () => {
    const provider = new FakeGroupUsageProvider();
    const caller: GroupUsageCaller = {
      tenantScope: tenantScope([TENANT]),
      permissions: [GROUPS_READ_PERMISSION],
    };
    const routes = getRoutes(provider, caller);
    const usageRoute = routes.find((r) => r.path === GROUP_USAGE_PATH)!;

    const res = await usageRoute.handler({
      method: "GET",
      path: `/v1/tenants/${TENANT}/groups/usage`,
      params: { tenantId: TENANT },
      query: new URLSearchParams("inactiveDaysThreshold=180"),
      headers: {},
    });

    expect(res.status).toBe(200);
    expect(provider.calls[0]?.inactiveDaysThreshold).toBe(180);
  });
});
