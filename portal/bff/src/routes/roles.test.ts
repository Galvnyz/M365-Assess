import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { tenantScope } from "../rbac/scope.js";
import {
  ROLE_ASSIGNMENTS_PATH,
  ROLES_READ_PERMISSION,
  createRoleAssignmentsRoute,
  parseRoleAssignmentsFilter,
  type RoleAssignment,
  type RoleAssignmentsFilter,
  type RoleAssignmentsPage,
  type RoleAssignmentsProvider,
  type RolesCaller,
} from "./roles.js";

const TENANT = "tenant-a";

const PERMANENT_ROW: RoleAssignment = {
  id: "ra-1",
  roleDefinitionId: "def-ga",
  roleName: "Global Administrator",
  principalId: "user-1",
  principalDisplayName: "Alice Admin",
  principalEmail: "alice@contoso.com",
  principalType: "user",
  assignmentType: "permanent",
  directoryScopeId: "/",
  scope: "/",
  startDateTime: null,
  endDateTime: null,
  status: "active",
};

const ELIGIBLE_ROW: RoleAssignment = {
  id: "ra-2",
  roleDefinitionId: "def-sa",
  roleName: "Security Administrator",
  principalId: "user-2",
  principalDisplayName: "Bob Security",
  principalEmail: "bob@contoso.com",
  principalType: "user",
  assignmentType: "eligible",
  directoryScopeId: "/",
  scope: "/",
  startDateTime: "2026-09-01T00:00:00Z",
  endDateTime: "2027-09-01T00:00:00Z",
  status: "eligible",
};

class FakeRoleAssignmentsProvider implements RoleAssignmentsProvider {
  readonly calls: Array<{ tenantId: string; filter: RoleAssignmentsFilter }> = [];

  async listRoleAssignments(
    tenantId: string,
    filter: RoleAssignmentsFilter,
  ): Promise<RoleAssignmentsPage> {
    this.calls.push({ tenantId, filter });
    return {
      tenantId,
      totalCount: 2,
      items: [PERMANENT_ROW, ELIGIBLE_ROW],
      nextCursor: null,
    };
  }
}

describe("Role assignments route (T-0241)", () => {
  it("exposes GET /v1/tenants/:tenantId/role-assignments", () => {
    const provider = new FakeRoleAssignmentsProvider();
    const route = createRoleAssignmentsRoute({
      provider,
      resolveCaller: () => ({
        tenantScope: tenantScope([TENANT]),
        permissions: [ROLES_READ_PERMISSION],
      }),
    });
    expect(route.method).toBe("GET");
    expect(route.path).toBe(ROLE_ASSIGNMENTS_PATH);
  });

  it("rejects unauthenticated requests with 401", async () => {
    const provider = new FakeRoleAssignmentsProvider();
    const route = createRoleAssignmentsRoute({
      provider,
      resolveCaller: () => undefined,
    });

    await expect(
      route.handler({
        method: "GET",
        path: `/v1/tenants/${TENANT}/role-assignments`,
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
        headers: {},
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects tenant outside caller scope with 403", async () => {
    const provider = new FakeRoleAssignmentsProvider();
    const route = createRoleAssignmentsRoute({
      provider,
      resolveCaller: () => ({
        tenantScope: tenantScope(["other-tenant"]),
        permissions: [ROLES_READ_PERMISSION],
      }),
    });

    await expect(
      route.handler({
        method: "GET",
        path: `/v1/tenants/${TENANT}/role-assignments`,
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
        headers: {},
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects callers missing roles.read with 403", async () => {
    const provider = new FakeRoleAssignmentsProvider();
    const route = createRoleAssignmentsRoute({
      provider,
      resolveCaller: () => ({
        tenantScope: tenantScope([TENANT]),
        permissions: ["Identity.User.Read"],
      }),
    });

    await expect(
      route.handler({
        method: "GET",
        path: `/v1/tenants/${TENANT}/role-assignments`,
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
        headers: {},
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("returns role assignments distinguishing permanent from eligible", async () => {
    const provider = new FakeRoleAssignmentsProvider();
    const caller: RolesCaller = {
      tenantScope: tenantScope([TENANT]),
      permissions: [ROLES_READ_PERMISSION],
    };
    const route = createRoleAssignmentsRoute({
      provider,
      resolveCaller: () => caller,
    });

    const response = await route.handler({
      method: "GET",
      path: `/v1/tenants/${TENANT}/role-assignments`,
      params: { tenantId: TENANT },
      query: new URLSearchParams("role=Administrator&assignmentType=permanent"),
      headers: {},
    });

    expect(response.status).toBe(200);
    const body = response.body as RoleAssignmentsPage;
    expect(body.tenantId).toBe(TENANT);
    expect(body.items).toHaveLength(2);
    expect(body.items[0]?.assignmentType).toBe("permanent");
    expect(body.items[1]?.assignmentType).toBe("eligible");

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.filter.role).toBe("Administrator");
    expect(provider.calls[0]?.filter.assignmentType).toBe("permanent");
  });

  it("validates enum parameters in query", () => {
    expect(() =>
      parseRoleAssignmentsFilter(new URLSearchParams("assignmentType=invalidType")),
    ).toThrow(AppError);

    expect(() =>
      parseRoleAssignmentsFilter(new URLSearchParams("principalType=invalidPrincipal")),
    ).toThrow(AppError);
  });
});
