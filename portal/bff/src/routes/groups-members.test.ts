import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { tenantScope } from "../rbac/scope.js";
import {
  GROUP_MEMBERS_BULK_PATH,
  GROUP_OWNERS_BULK_PATH,
  GROUPS_WRITE_PERMISSION,
  createGroupMembersRoutes,
  type BulkMembershipInput,
  type BulkMembershipPlan,
  type BulkMembershipResult,
  type BulkMembershipRole,
  type GroupMembersCaller,
  type GroupMembersProvider,
} from "./groups-members.js";

const TENANT = "tenant-test";
const GROUP = "grp-123";

class FakeGroupMembersProvider implements GroupMembersProvider {
  readonly calls: Array<{
    tenantId: string;
    groupId: string;
    role: BulkMembershipRole;
    input: BulkMembershipInput;
    preview: boolean;
  }> = [];

  async invokeBulkMembership(
    tenantId: string,
    groupId: string,
    role: BulkMembershipRole,
    input: BulkMembershipInput,
    preview: boolean,
  ): Promise<BulkMembershipPlan | BulkMembershipResult> {
    this.calls.push({ tenantId, groupId, role, input, preview });

    const plan: BulkMembershipPlan = {
      tenantId,
      groupId,
      role,
      operation: input.operation,
      total: input.users.length,
      toAdd: input.operation === "add" ? 1 : 0,
      toRemove: input.operation === "remove" ? 1 : 0,
      toSkip: 1,
      diff: [`${input.operation} user from ${role}`],
      planRows: [
        { user: "u1", action: input.operation, reason: "ok" },
        { user: "u2", action: "skip", reason: "already present" },
      ],
      dryRun: preview,
    };

    if (preview) return plan;

    return {
      success: true,
      plan,
      results: [
        { user: "u1", status: input.operation === "add" ? "added" : "removed" },
        { user: "u2", status: "skipped", reason: "already present" },
      ],
      auditEvents: [{ action: `group.${role}.${input.operation}`, principalId: "u1" }],
    };
  }
}

describe("Group bulk membership routes (T-0268)", () => {
  const getRoutes = (provider: FakeGroupMembersProvider, caller?: GroupMembersCaller) => {
    return createGroupMembersRoutes({
      provider,
      resolveCaller: () => caller,
    });
  };

  it("rejects unauthenticated requests with 401", async () => {
    const provider = new FakeGroupMembersProvider();
    const routes = getRoutes(provider, undefined);
    const memberRoute = routes.find((r) => r.path === GROUP_MEMBERS_BULK_PATH)!;

    await expect(
      memberRoute.handler({
        method: "POST",
        path: `/v1/tenants/${TENANT}/groups/${GROUP}/members/bulk`,
        params: { tenantId: TENANT, groupId: GROUP },
        query: new URLSearchParams(),
        headers: {},
        body: { operation: "add", users: ["u1"] },
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects tenant outside caller scope with 403", async () => {
    const provider = new FakeGroupMembersProvider();
    const caller: GroupMembersCaller = {
      tenantScope: tenantScope(["different-tenant"]),
      permissions: [GROUPS_WRITE_PERMISSION],
    };
    const routes = getRoutes(provider, caller);
    const memberRoute = routes.find((r) => r.path === GROUP_MEMBERS_BULK_PATH)!;

    await expect(
      memberRoute.handler({
        method: "POST",
        path: `/v1/tenants/${TENANT}/groups/${GROUP}/members/bulk`,
        params: { tenantId: TENANT, groupId: GROUP },
        query: new URLSearchParams(),
        headers: {},
        body: { operation: "add", users: ["u1"] },
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects missing groups.write permission with 403", async () => {
    const provider = new FakeGroupMembersProvider();
    const caller: GroupMembersCaller = {
      tenantScope: tenantScope([TENANT]),
      permissions: ["groups.read"],
    };
    const routes = getRoutes(provider, caller);
    const memberRoute = routes.find((r) => r.path === GROUP_MEMBERS_BULK_PATH)!;

    await expect(
      memberRoute.handler({
        method: "POST",
        path: `/v1/tenants/${TENANT}/groups/${GROUP}/members/bulk`,
        params: { tenantId: TENANT, groupId: GROUP },
        query: new URLSearchParams(),
        headers: {},
        body: { operation: "add", users: ["u1"] },
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("validates operation and users parameters", async () => {
    const provider = new FakeGroupMembersProvider();
    const caller: GroupMembersCaller = {
      tenantScope: tenantScope([TENANT]),
      permissions: [GROUPS_WRITE_PERMISSION],
    };
    const routes = getRoutes(provider, caller);
    const memberRoute = routes.find((r) => r.path === GROUP_MEMBERS_BULK_PATH)!;

    await expect(
      memberRoute.handler({
        method: "POST",
        path: `/v1/tenants/${TENANT}/groups/${GROUP}/members/bulk`,
        params: { tenantId: TENANT, groupId: GROUP },
        query: new URLSearchParams(),
        headers: {},
        body: { operation: "invalidOp", users: ["u1"] },
      }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      memberRoute.handler({
        method: "POST",
        path: `/v1/tenants/${TENANT}/groups/${GROUP}/members/bulk`,
        params: { tenantId: TENANT, groupId: GROUP },
        query: new URLSearchParams(),
        headers: {},
        body: { operation: "add", users: [] },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("returns preview diff without writing on preview=true", async () => {
    const provider = new FakeGroupMembersProvider();
    const caller: GroupMembersCaller = {
      tenantScope: tenantScope([TENANT]),
      permissions: [GROUPS_WRITE_PERMISSION],
    };
    const routes = getRoutes(provider, caller);
    const memberRoute = routes.find((r) => r.path === GROUP_MEMBERS_BULK_PATH)!;

    const response = await memberRoute.handler({
      method: "POST",
      path: `/v1/tenants/${TENANT}/groups/${GROUP}/members/bulk`,
      params: { tenantId: TENANT, groupId: GROUP },
      query: new URLSearchParams("preview=true"),
      headers: {},
      body: { operation: "add", users: ["u1", "u2"] },
    });

    expect(response.status).toBe(200);
    const body = response.body as BulkMembershipPlan;
    expect(body.dryRun).toBe(true);
    expect(body.toAdd).toBe(1);
    expect(body.toSkip).toBe(1);
    expect(provider.calls[0]?.preview).toBe(true);
    expect(provider.calls[0]?.role).toBe("members");
  });

  it("applies batched changes with per-row results for owners", async () => {
    const provider = new FakeGroupMembersProvider();
    const caller: GroupMembersCaller = {
      tenantScope: tenantScope([TENANT]),
      permissions: [GROUPS_WRITE_PERMISSION],
    };
    const routes = getRoutes(provider, caller);
    const ownerRoute = routes.find((r) => r.path === GROUP_OWNERS_BULK_PATH)!;

    const response = await ownerRoute.handler({
      method: "POST",
      path: `/v1/tenants/${TENANT}/groups/${GROUP}/owners/bulk`,
      params: { tenantId: TENANT, groupId: GROUP },
      query: new URLSearchParams(),
      headers: {},
      body: { operation: "remove", users: ["u1", "u2"] },
    });

    expect(response.status).toBe(200);
    const body = response.body as BulkMembershipResult;
    expect(body.success).toBe(true);
    expect(body.results).toHaveLength(2);
    expect(body.results[0]?.status).toBe("removed");
    expect(body.results[1]?.status).toBe("skipped");
    expect(body.auditEvents).toHaveLength(1);
    expect(provider.calls[0]?.role).toBe("owners");
  });
});
