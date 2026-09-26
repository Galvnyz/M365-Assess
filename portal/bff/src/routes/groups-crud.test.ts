import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { tenantScope } from "../rbac/scope.js";
import {
  GROUPS_BASE_PATH,
  GROUPS_ITEM_PATH,
  GROUPS_WRITE_PERMISSION,
  createGroupCrudRoutes,
  validateDynamicRule,
  type CreateGroupInput,
  type DeleteGroupInput,
  type EditGroupInput,
  type GroupCrudCaller,
  type GroupCrudProvider,
  type GroupCrudResult,
  type GroupPlan,
} from "./groups-crud.js";

const TENANT = "tenant-test";

class FakeGroupCrudProvider implements GroupCrudProvider {
  readonly createCalls: Array<{ tenantId: string; input: CreateGroupInput; preview: boolean }> = [];
  readonly editCalls: Array<{ tenantId: string; groupId: string; input: EditGroupInput; preview: boolean }> = [];
  readonly deleteCalls: Array<{ tenantId: string; groupId: string; confirmName: string; preview: boolean }> = [];

  async createGroup(tenantId: string, input: CreateGroupInput, preview: boolean): Promise<GroupCrudResult | GroupPlan> {
    this.createCalls.push({ tenantId, input, preview });
    const plan: GroupPlan = {
      action: "create",
      targetName: input.displayName,
      diff: [`Create group ${input.displayName}`],
      valid: true,
      dryRun: preview,
      requiresConfirmation: false,
    };
    if (preview) return plan;
    return {
      success: true,
      plan,
      result: { id: "new-grp-id", displayName: input.displayName },
      auditEvent: {
        id: "audit-1",
        tenantId,
        action: "group.create",
        targetId: "new-grp-id",
        targetName: input.displayName,
        timestamp: "2026-09-26T18:00:00Z",
      },
    };
  }

  async editGroup(tenantId: string, groupId: string, input: EditGroupInput, preview: boolean): Promise<GroupCrudResult | GroupPlan> {
    this.editCalls.push({ tenantId, groupId, input, preview });
    const plan: GroupPlan = {
      action: "edit",
      groupId,
      targetName: input.displayName ?? "Existing Group",
      diff: ["Update description"],
      valid: true,
      dryRun: preview,
      requiresConfirmation: false,
    };
    if (preview) return plan;
    return {
      success: true,
      plan,
      result: { id: groupId },
      auditEvent: {
        id: "audit-2",
        tenantId,
        action: "group.edit",
        targetId: groupId,
        targetName: "Existing Group",
        timestamp: "2026-09-26T18:00:00Z",
      },
    };
  }

  async deleteGroup(tenantId: string, groupId: string, confirmName: string, preview: boolean): Promise<GroupCrudResult | GroupPlan> {
    this.deleteCalls.push({ tenantId, groupId, confirmName, preview });
    const plan: GroupPlan = {
      action: "delete",
      groupId,
      targetName: confirmName,
      diff: [`Delete group ${confirmName}`],
      valid: true,
      dryRun: preview,
      requiresConfirmation: true,
    };
    if (preview) return plan;
    return {
      success: true,
      plan,
      result: { deleted: true, id: groupId },
      auditEvent: {
        id: "audit-3",
        tenantId,
        action: "group.delete",
        targetId: groupId,
        targetName: confirmName,
        timestamp: "2026-09-26T18:00:00Z",
      },
    };
  }
}

describe("Group CRUD routes (T-0262)", () => {
  const getRoutes = (provider: FakeGroupCrudProvider, caller?: GroupCrudCaller) => {
    return createGroupCrudRoutes({
      provider,
      resolveCaller: () => caller,
    });
  };

  it("validates dynamic rules accurately", () => {
    expect(validateDynamicRule('(user.department -eq "Sales")').valid).toBe(true);
    expect(validateDynamicRule('(user.city -startsWith "New")').valid).toBe(true);
    expect(validateDynamicRule("").valid).toBe(false);
    expect(validateDynamicRule("not-parenthesized").valid).toBe(false);
    expect(validateDynamicRule('(user.department is "Sales")').valid).toBe(false);
    expect(validateDynamicRule('(user.department -eq "Sales"').valid).toBe(false);
  });

  it("rejects unauthenticated requests with 401", async () => {
    const provider = new FakeGroupCrudProvider();
    const routes = getRoutes(provider, undefined);
    const postRoute = routes.find((r) => r.method === "POST" && r.path === GROUPS_BASE_PATH)!;

    await expect(
      postRoute.handler({
        method: "POST",
        path: `/v1/tenants/${TENANT}/groups`,
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
        headers: {},
        body: { displayName: "Test", groupType: "security" },
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects callers missing groups.write with 403", async () => {
    const provider = new FakeGroupCrudProvider();
    const caller: GroupCrudCaller = {
      tenantScope: tenantScope([TENANT]),
      permissions: ["groups.read"],
    };
    const routes = getRoutes(provider, caller);
    const postRoute = routes.find((r) => r.method === "POST")!;

    await expect(
      postRoute.handler({
        method: "POST",
        path: `/v1/tenants/${TENANT}/groups`,
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
        headers: {},
        body: { displayName: "Test", groupType: "security" },
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("returns plan preview on create when preview requested", async () => {
    const provider = new FakeGroupCrudProvider();
    const caller: GroupCrudCaller = {
      tenantScope: tenantScope([TENANT]),
      permissions: [GROUPS_WRITE_PERMISSION],
    };
    const routes = getRoutes(provider, caller);
    const postRoute = routes.find((r) => r.method === "POST")!;

    const response = await postRoute.handler({
      method: "POST",
      path: `/v1/tenants/${TENANT}/groups`,
      params: { tenantId: TENANT },
      query: new URLSearchParams("preview=true"),
      headers: {},
      body: { displayName: "Preview Sec Group", groupType: "security" },
    });

    expect(response.status).toBe(200);
    const body = response.body as GroupPlan;
    expect(body.valid).toBe(true);
    expect(body.dryRun).toBe(true);
    expect(provider.createCalls).toHaveLength(1);
    expect(provider.createCalls[0]?.preview).toBe(true);
  });

  it("creates group and returns audit record on apply", async () => {
    const provider = new FakeGroupCrudProvider();
    const caller: GroupCrudCaller = {
      tenantScope: tenantScope([TENANT]),
      permissions: [GROUPS_WRITE_PERMISSION],
    };
    const routes = getRoutes(provider, caller);
    const postRoute = routes.find((r) => r.method === "POST")!;

    const response = await postRoute.handler({
      method: "POST",
      path: `/v1/tenants/${TENANT}/groups`,
      params: { tenantId: TENANT },
      query: new URLSearchParams(),
      headers: {},
      body: { displayName: "Live Sec Group", groupType: "security" },
    });

    expect(response.status).toBe(201);
    const body = response.body as GroupCrudResult;
    expect(body.success).toBe(true);
    expect(body.auditEvent?.action).toBe("group.create");
    expect(body.auditEvent?.targetId).toBe("new-grp-id");
  });

  it("rejects dynamic group creation with invalid rule before dispatch", async () => {
    const provider = new FakeGroupCrudProvider();
    const caller: GroupCrudCaller = {
      tenantScope: tenantScope([TENANT]),
      permissions: [GROUPS_WRITE_PERMISSION],
    };
    const routes = getRoutes(provider, caller);
    const postRoute = routes.find((r) => r.method === "POST")!;

    await expect(
      postRoute.handler({
        method: "POST",
        path: `/v1/tenants/${TENANT}/groups`,
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
        headers: {},
        body: {
          displayName: "Bad Dynamic Group",
          groupType: "dynamic",
          dynamicRule: "user.department eq Sales",
        },
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(provider.createCalls).toHaveLength(0);
  });

  it("requires confirmName for group deletion", async () => {
    const provider = new FakeGroupCrudProvider();
    const caller: GroupCrudCaller = {
      tenantScope: tenantScope([TENANT]),
      permissions: [GROUPS_WRITE_PERMISSION],
    };
    const routes = getRoutes(provider, caller);
    const deleteRoute = routes.find((r) => r.method === "DELETE")!;

    await expect(
      deleteRoute.handler({
        method: "DELETE",
        path: `/v1/tenants/${TENANT}/groups/grp-to-delete`,
        params: { tenantId: TENANT, groupId: "grp-to-delete" },
        query: new URLSearchParams(),
        headers: {},
        body: {},
      }),
    ).rejects.toMatchObject({ status: 400 });

    // Succeeds when confirmName is provided
    const response = await deleteRoute.handler({
      method: "DELETE",
      path: `/v1/tenants/${TENANT}/groups/grp-to-delete`,
      params: { tenantId: TENANT, groupId: "grp-to-delete" },
      query: new URLSearchParams(),
      headers: {},
      body: { confirmName: "Confirmed Group" },
    });

    expect(response.status).toBe(200);
    const body = response.body as GroupCrudResult;
    expect(body.success).toBe(true);
    expect(body.auditEvent?.action).toBe("group.delete");
    expect(provider.deleteCalls).toHaveLength(1);
  });
});
