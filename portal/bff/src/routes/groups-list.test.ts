import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { tenantScope } from "../rbac/scope.js";
import {
  GROUPS_PATH,
  GROUPS_READ_PERMISSION,
  createGroupsListRoute,
  parseGroupsFilter,
  type GroupItem,
  type GroupsCaller,
  type GroupsFilter,
  type GroupsPage,
  type GroupsProvider,
} from "./groups-list.js";

const TENANT = "tenant-test";

const SAMPLE_GROUP: GroupItem = {
  id: "grp-1",
  name: "Engineering Team",
  displayName: "Engineering Team",
  description: "Engineering group",
  type: "m365",
  groupType: "m365",
  membershipCount: 25,
  ownerCount: 3,
  hiddenFromAddressListsEnabled: false,
  deliveryManagementEnabled: false,
  dynamicRule: "",
  isDynamic: false,
  mail: "eng@example.com",
};

const DYNAMIC_GROUP: GroupItem = {
  id: "grp-2",
  name: "Dynamic All Staff",
  displayName: "Dynamic All Staff",
  description: "Dynamic staff group",
  type: "dynamic",
  groupType: "dynamic",
  membershipCount: 150,
  ownerCount: 1,
  hiddenFromAddressListsEnabled: true,
  deliveryManagementEnabled: true,
  dynamicRule: "(user.accountEnabled -eq true)",
  isDynamic: true,
  mail: "allstaff@example.com",
};

class FakeGroupsProvider implements GroupsProvider {
  readonly calls: Array<{ tenantId: string; filter: GroupsFilter }> = [];

  async listGroups(tenantId: string, filter: GroupsFilter): Promise<GroupsPage> {
    this.calls.push({ tenantId, filter });
    return {
      tenantId,
      totalCount: 2,
      items: [SAMPLE_GROUP, DYNAMIC_GROUP],
      nextCursor: null,
    };
  }
}

describe("Groups list route (T-0261)", () => {
  it("exposes GET /v1/tenants/:tenantId/groups", () => {
    const provider = new FakeGroupsProvider();
    const route = createGroupsListRoute({
      provider,
      resolveCaller: () => ({
        tenantScope: tenantScope([TENANT]),
        permissions: [GROUPS_READ_PERMISSION],
      }),
    });
    expect(route.method).toBe("GET");
    expect(route.path).toBe(GROUPS_PATH);
  });

  it("rejects unauthenticated requests with 401", async () => {
    const provider = new FakeGroupsProvider();
    const route = createGroupsListRoute({
      provider,
      resolveCaller: () => undefined,
    });

    await expect(
      route.handler({
        method: "GET",
        path: `/v1/tenants/${TENANT}/groups`,
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
        headers: {},
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects tenant outside caller scope with 403", async () => {
    const provider = new FakeGroupsProvider();
    const route = createGroupsListRoute({
      provider,
      resolveCaller: () => ({
        tenantScope: tenantScope(["different-tenant"]),
        permissions: [GROUPS_READ_PERMISSION],
      }),
    });

    await expect(
      route.handler({
        method: "GET",
        path: `/v1/tenants/${TENANT}/groups`,
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
        headers: {},
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects callers missing groups.read with 403", async () => {
    const provider = new FakeGroupsProvider();
    const route = createGroupsListRoute({
      provider,
      resolveCaller: () => ({
        tenantScope: tenantScope([TENANT]),
        permissions: ["Identity.User.Read"],
      }),
    });

    await expect(
      route.handler({
        method: "GET",
        path: `/v1/tenants/${TENANT}/groups`,
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
        headers: {},
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("returns groups list with type discrimination and filters applied", async () => {
    const provider = new FakeGroupsProvider();
    const caller: GroupsCaller = {
      tenantScope: tenantScope([TENANT]),
      permissions: [GROUPS_READ_PERMISSION],
    };
    const route = createGroupsListRoute({
      provider,
      resolveCaller: () => caller,
    });

    const response = await route.handler({
      method: "GET",
      path: `/v1/tenants/${TENANT}/groups`,
      params: { tenantId: TENANT },
      query: new URLSearchParams("type=dynamic&hidden=true&search=staff"),
      headers: {},
    });

    expect(response.status).toBe(200);
    const body = response.body as GroupsPage;
    expect(body.tenantId).toBe(TENANT);
    expect(body.items).toHaveLength(2);
    expect(body.items[0]?.type).toBe("m365");
    expect(body.items[1]?.type).toBe("dynamic");
    expect(body.items[1]?.dynamicRule).toBe("(user.accountEnabled -eq true)");
    expect(body.items[1]?.deliveryManagementEnabled).toBe(true);

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.filter.type).toBe("dynamic");
    expect(provider.calls[0]?.filter.hidden).toBe(true);
    expect(provider.calls[0]?.filter.search).toBe("staff");
  });

  it("validates enum and boolean filter parameters", () => {
    expect(() =>
      parseGroupsFilter(new URLSearchParams("type=notAType")),
    ).toThrow(AppError);

    expect(() =>
      parseGroupsFilter(new URLSearchParams("hidden=notABool")),
    ).toThrow(AppError);

    expect(() =>
      parseGroupsFilter(new URLSearchParams("dynamic=maybe")),
    ).toThrow(AppError);
  });
});
