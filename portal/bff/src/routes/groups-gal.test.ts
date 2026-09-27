import { describe, expect, it } from "vitest";
import { tenantScope } from "../rbac/scope.js";
import {
  GROUP_DELIVERY_PATH,
  GROUP_GAL_PATH,
  GROUPS_WRITE_PERMISSION,
  REMEDIATION_APPLY_PERMISSION,
  createGroupGalDeliveryRoutes,
  type GroupDeliveryInput,
  type GroupGalCaller,
  type GroupGalDeliveryPlan,
  type GroupGalDeliveryProvider,
  type GroupGalDeliveryResult,
  type GroupGalInput,
} from "./groups-gal.js";

const TENANT = "tenant-gal-test";
const GROUP = "grp-gal-123";

class FakeGroupGalDeliveryProvider implements GroupGalDeliveryProvider {
  readonly galCalls: Array<{
    tenantId: string;
    groupId: string;
    input: GroupGalInput;
    preview: boolean;
  }> = [];

  readonly deliveryCalls: Array<{
    tenantId: string;
    groupId: string;
    input: GroupDeliveryInput;
    preview: boolean;
  }> = [];

  async setGal(
    tenantId: string,
    groupId: string,
    input: GroupGalInput,
    preview: boolean,
  ): Promise<GroupGalDeliveryPlan | GroupGalDeliveryResult> {
    this.galCalls.push({ tenantId, groupId, input, preview });

    const plan: GroupGalDeliveryPlan = {
      tenantId,
      groupId,
      target: "gal",
      before: { hiddenFromAddressListsEnabled: !input.hiddenFromAddressListsEnabled },
      after: { hiddenFromAddressListsEnabled: input.hiddenFromAddressListsEnabled },
      diff: [`hiddenFromAddressListsEnabled: ${!input.hiddenFromAddressListsEnabled} -> ${input.hiddenFromAddressListsEnabled}`],
      dryRun: preview,
    };

    if (preview) return plan;

    return {
      success: true,
      plan,
      before: plan.before,
      after: plan.after,
      auditEvent: {
        action: "group.gal.update",
        target: groupId,
        hiddenFromAddressListsEnabled: input.hiddenFromAddressListsEnabled,
      },
    };
  }

  async setDelivery(
    tenantId: string,
    groupId: string,
    input: GroupDeliveryInput,
    preview: boolean,
  ): Promise<GroupGalDeliveryPlan | GroupGalDeliveryResult> {
    this.deliveryCalls.push({ tenantId, groupId, input, preview });

    const plan: GroupGalDeliveryPlan = {
      tenantId,
      groupId,
      target: "delivery",
      before: {
        requireSenderAuthenticationEnabled: !input.requireSenderAuthenticationEnabled,
        grantSendOnBehalfTo: [],
      },
      after: {
        requireSenderAuthenticationEnabled: input.requireSenderAuthenticationEnabled,
        grantSendOnBehalfTo: input.grantSendOnBehalfTo ?? [],
      },
      diff: [
        `requireSenderAuthenticationEnabled: ${!input.requireSenderAuthenticationEnabled} -> ${input.requireSenderAuthenticationEnabled}`,
      ],
      dryRun: preview,
    };

    if (preview) return plan;

    return {
      success: true,
      plan,
      before: plan.before,
      after: plan.after,
      auditEvent: {
        action: "group.delivery.update",
        target: groupId,
        requireSenderAuthenticationEnabled: input.requireSenderAuthenticationEnabled,
        grantSendOnBehalfTo: input.grantSendOnBehalfTo ?? [],
      },
    };
  }
}

describe("Group GAL and delivery management routes (T-0269)", () => {
  const getRoutes = (provider: FakeGroupGalDeliveryProvider, caller?: GroupGalCaller) => {
    return createGroupGalDeliveryRoutes({
      provider,
      resolveCaller: () => caller,
    });
  };

  it("rejects unauthenticated requests with 401", async () => {
    const provider = new FakeGroupGalDeliveryProvider();
    const routes = getRoutes(provider, undefined);
    const galRoute = routes.find((r) => r.path === GROUP_GAL_PATH)!;
    const deliveryRoute = routes.find((r) => r.path === GROUP_DELIVERY_PATH)!;

    await expect(
      galRoute.handler({
        method: "POST",
        path: `/v1/tenants/${TENANT}/groups/${GROUP}/gal`,
        params: { tenantId: TENANT, groupId: GROUP },
        query: new URLSearchParams(),
        headers: {},
        body: { hiddenFromAddressListsEnabled: true },
      }),
    ).rejects.toMatchObject({ status: 401 });

    await expect(
      deliveryRoute.handler({
        method: "POST",
        path: `/v1/tenants/${TENANT}/groups/${GROUP}/delivery`,
        params: { tenantId: TENANT, groupId: GROUP },
        query: new URLSearchParams(),
        headers: {},
        body: { requireSenderAuthenticationEnabled: true },
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects tenant outside caller scope with 403", async () => {
    const provider = new FakeGroupGalDeliveryProvider();
    const caller: GroupGalCaller = {
      tenantScope: tenantScope(["different-tenant"]),
      permissions: [GROUPS_WRITE_PERMISSION],
    };
    const routes = getRoutes(provider, caller);
    const galRoute = routes.find((r) => r.path === GROUP_GAL_PATH)!;

    await expect(
      galRoute.handler({
        method: "POST",
        path: `/v1/tenants/${TENANT}/groups/${GROUP}/gal`,
        params: { tenantId: TENANT, groupId: GROUP },
        query: new URLSearchParams(),
        headers: {},
        body: { hiddenFromAddressListsEnabled: true },
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects missing permissions with 403", async () => {
    const provider = new FakeGroupGalDeliveryProvider();
    const caller: GroupGalCaller = {
      tenantScope: tenantScope([TENANT]),
      permissions: ["Identity.Group.Read"],
    };
    const routes = getRoutes(provider, caller);
    const galRoute = routes.find((r) => r.path === GROUP_GAL_PATH)!;

    await expect(
      galRoute.handler({
        method: "POST",
        path: `/v1/tenants/${TENANT}/groups/${GROUP}/gal`,
        params: { tenantId: TENANT, groupId: GROUP },
        query: new URLSearchParams(),
        headers: {},
        body: { hiddenFromAddressListsEnabled: true },
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("permits remediation.apply permission", async () => {
    const provider = new FakeGroupGalDeliveryProvider();
    const caller: GroupGalCaller = {
      tenantScope: tenantScope([TENANT]),
      permissions: [REMEDIATION_APPLY_PERMISSION],
    };
    const routes = getRoutes(provider, caller);
    const galRoute = routes.find((r) => r.path === GROUP_GAL_PATH)!;

    const res = await galRoute.handler({
      method: "POST",
      path: `/v1/tenants/${TENANT}/groups/${GROUP}/gal`,
      params: { tenantId: TENANT, groupId: GROUP },
      query: new URLSearchParams(),
      headers: {},
      body: { hiddenFromAddressListsEnabled: true },
    });

    expect(res.status).toBe(200);
  });

  it("validates required parameters for GAL", async () => {
    const provider = new FakeGroupGalDeliveryProvider();
    const caller: GroupGalCaller = {
      tenantScope: tenantScope([TENANT]),
      permissions: [GROUPS_WRITE_PERMISSION],
    };
    const routes = getRoutes(provider, caller);
    const galRoute = routes.find((r) => r.path === GROUP_GAL_PATH)!;

    await expect(
      galRoute.handler({
        method: "POST",
        path: `/v1/tenants/${TENANT}/groups/${GROUP}/gal`,
        params: { tenantId: TENANT, groupId: GROUP },
        query: new URLSearchParams(),
        headers: {},
        body: {},
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("validates required parameters for delivery", async () => {
    const provider = new FakeGroupGalDeliveryProvider();
    const caller: GroupGalCaller = {
      tenantScope: tenantScope([TENANT]),
      permissions: [GROUPS_WRITE_PERMISSION],
    };
    const routes = getRoutes(provider, caller);
    const deliveryRoute = routes.find((r) => r.path === GROUP_DELIVERY_PATH)!;

    await expect(
      deliveryRoute.handler({
        method: "POST",
        path: `/v1/tenants/${TENANT}/groups/${GROUP}/delivery`,
        params: { tenantId: TENANT, groupId: GROUP },
        query: new URLSearchParams(),
        headers: {},
        body: {},
      }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      deliveryRoute.handler({
        method: "POST",
        path: `/v1/tenants/${TENANT}/groups/${GROUP}/delivery`,
        params: { tenantId: TENANT, groupId: GROUP },
        query: new URLSearchParams(),
        headers: {},
        body: {
          requireSenderAuthenticationEnabled: true,
          grantSendOnBehalfTo: "not-an-array",
        },
      }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      deliveryRoute.handler({
        method: "POST",
        path: `/v1/tenants/${TENANT}/groups/${GROUP}/delivery`,
        params: { tenantId: TENANT, groupId: GROUP },
        query: new URLSearchParams(),
        headers: {},
        body: {
          requireSenderAuthenticationEnabled: true,
          grantSendOnBehalfTo: ["valid@example.com", "   "],
        },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("previews GAL change on preview=true", async () => {
    const provider = new FakeGroupGalDeliveryProvider();
    const caller: GroupGalCaller = {
      tenantScope: tenantScope([TENANT]),
      permissions: [GROUPS_WRITE_PERMISSION],
    };
    const routes = getRoutes(provider, caller);
    const galRoute = routes.find((r) => r.path === GROUP_GAL_PATH)!;

    const res = await galRoute.handler({
      method: "POST",
      path: `/v1/tenants/${TENANT}/groups/${GROUP}/gal`,
      params: { tenantId: TENANT, groupId: GROUP },
      query: new URLSearchParams("preview=true"),
      headers: {},
      body: { hiddenFromAddressListsEnabled: true },
    });

    expect(res.status).toBe(200);
    const plan = res.body as GroupGalDeliveryPlan;
    expect(plan.dryRun).toBe(true);
    expect(plan.target).toBe("gal");
    expect(plan.after.hiddenFromAddressListsEnabled).toBe(true);
    expect(provider.galCalls[0]?.preview).toBe(true);
  });

  it("applies delivery change and captures audit event", async () => {
    const provider = new FakeGroupGalDeliveryProvider();
    const caller: GroupGalCaller = {
      tenantScope: tenantScope([TENANT]),
      permissions: [GROUPS_WRITE_PERMISSION],
    };
    const routes = getRoutes(provider, caller);
    const deliveryRoute = routes.find((r) => r.path === GROUP_DELIVERY_PATH)!;

    const res = await deliveryRoute.handler({
      method: "POST",
      path: `/v1/tenants/${TENANT}/groups/${GROUP}/delivery`,
      params: { tenantId: TENANT, groupId: GROUP },
      query: new URLSearchParams(),
      headers: {},
      body: {
        requireSenderAuthenticationEnabled: true,
        grantSendOnBehalfTo: ["user1@example.com"],
      },
    });

    expect(res.status).toBe(200);
    const result = res.body as GroupGalDeliveryResult;
    expect(result.success).toBe(true);
    expect(result.auditEvent?.action).toBe("group.delivery.update");
    expect(provider.deliveryCalls[0]?.input.grantSendOnBehalfTo).toEqual(["user1@example.com"]);
  });
});
