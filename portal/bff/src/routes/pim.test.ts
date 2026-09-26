import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { tenantScope } from "../rbac/scope.js";
import { evaluatePimLicenseGate } from "../domain/pim/license-gate.js";
import {
  PIM_ASSIGNMENTS_PATH,
  PIM_READ_PERMISSION,
  createPimAssignmentsRoute,
  parsePimAssignmentsFilter,
  type PimAssignment,
  type PimAssignmentsFilter,
  type PimAssignmentsPage,
  type PimAssignmentsProvider,
  type PimCaller,
} from "./pim.js";

const TENANT = "tenant-a";

const ELIGIBLE_ROW: PimAssignment = {
  id: "elig-1",
  roleDefinitionId: "def-ga",
  roleName: "Global Administrator",
  principalId: "user-1",
  principalDisplayName: "Alice Eligible",
  principalEmail: "alice@contoso.com",
  principalType: "user",
  assignmentType: "eligible",
  directoryScopeId: "/",
  scope: "/",
  startDateTime: "2026-09-01T00:00:00Z",
  endDateTime: "2027-09-01T00:00:00Z",
  status: "eligible",
};

const ACTIVE_ROW: PimAssignment = {
  id: "act-1",
  roleDefinitionId: "def-ga",
  roleName: "Global Administrator",
  principalId: "user-2",
  principalDisplayName: "Bob Active",
  principalEmail: "bob@contoso.com",
  principalType: "user",
  assignmentType: "active",
  directoryScopeId: "/",
  scope: "/",
  startDateTime: "2026-09-26T12:00:00Z",
  endDateTime: "2026-09-26T20:00:00Z",
  status: "active",
};

class FakePimAssignmentsProvider implements PimAssignmentsProvider {
  readonly calls: Array<{ tenantId: string; filter: PimAssignmentsFilter }> = [];
  isP2Missing = false;

  async listPimAssignments(
    tenantId: string,
    filter: PimAssignmentsFilter,
  ): Promise<PimAssignmentsPage> {
    this.calls.push({ tenantId, filter });
    if (this.isP2Missing) {
      return {
        tenantId,
        gate: evaluatePimLicenseGate([]),
        totalCount: 0,
        items: [],
        nextCursor: null,
      };
    }
    return {
      tenantId,
      gate: evaluatePimLicenseGate(["AAD_PREMIUM_P2"]),
      totalCount: 2,
      items: [ELIGIBLE_ROW, ACTIVE_ROW],
      nextCursor: null,
    };
  }
}

describe("PIM assignments route & P2 gate (T-0242)", () => {
  it("exposes GET /v1/tenants/:tenantId/pim", () => {
    const provider = new FakePimAssignmentsProvider();
    const route = createPimAssignmentsRoute({
      provider,
      resolveCaller: () => ({
        tenantScope: tenantScope([TENANT]),
        permissions: [PIM_READ_PERMISSION],
      }),
    });
    expect(route.method).toBe("GET");
    expect(route.path).toBe(PIM_ASSIGNMENTS_PATH);
  });

  it("rejects unauthenticated requests with 401", async () => {
    const provider = new FakePimAssignmentsProvider();
    const route = createPimAssignmentsRoute({
      provider,
      resolveCaller: () => undefined,
    });

    await expect(
      route.handler({
        method: "GET",
        path: `/v1/tenants/${TENANT}/pim`,
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
        headers: {},
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects caller outside tenant scope with 403", async () => {
    const provider = new FakePimAssignmentsProvider();
    const route = createPimAssignmentsRoute({
      provider,
      resolveCaller: () => ({
        tenantScope: tenantScope(["other-tenant"]),
        permissions: [PIM_READ_PERMISSION],
      }),
    });

    await expect(
      route.handler({
        method: "GET",
        path: `/v1/tenants/${TENANT}/pim`,
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
        headers: {},
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("returns eligible and active assignments when P2 is present", async () => {
    const provider = new FakePimAssignmentsProvider();
    const caller: PimCaller = {
      tenantScope: tenantScope([TENANT]),
      permissions: [PIM_READ_PERMISSION],
    };
    const route = createPimAssignmentsRoute({
      provider,
      resolveCaller: () => caller,
      resolveTenantLicenses: async () => ["SPE_E5"],
    });

    const response = await route.handler({
      method: "GET",
      path: `/v1/tenants/${TENANT}/pim`,
      params: { tenantId: TENANT },
      query: new URLSearchParams(),
      headers: {},
    });

    expect(response.status).toBe(200);
    const body = response.body as PimAssignmentsPage;
    expect(body.gate.supported).toBe(true);
    expect(body.gate.status).toBe("licensed");
    expect(body.items).toHaveLength(2);
    expect(body.items[0]?.assignmentType).toBe("eligible");
    expect(body.items[1]?.assignmentType).toBe("active");
  });

  it("returns structured license-missing gate payload when P2 is missing from tenant licenses", async () => {
    const provider = new FakePimAssignmentsProvider();
    const caller: PimCaller = {
      tenantScope: tenantScope([TENANT]),
      permissions: [PIM_READ_PERMISSION],
    };
    const route = createPimAssignmentsRoute({
      provider,
      resolveCaller: () => caller,
      resolveTenantLicenses: async () => ["STANDARD_PACK"],
    });

    const response = await route.handler({
      method: "GET",
      path: `/v1/tenants/${TENANT}/pim`,
      params: { tenantId: TENANT },
      query: new URLSearchParams(),
      headers: {},
    });

    expect(response.status).toBe(200);
    const body = response.body as PimAssignmentsPage;
    expect(body.gate.supported).toBe(false);
    expect(body.gate.status).toBe("license-missing");
    expect(body.gate.requiredLicense).toBe("Entra ID P2");
    expect(body.gate.message).toContain("requires Microsoft Entra ID P2");
    expect(body.items).toHaveLength(0);
    // Provider shouldn't even be called when tenant licenses lack P2
    expect(provider.calls).toHaveLength(0);
  });

  it("returns structured gate payload when worker reports P2 missing", async () => {
    const provider = new FakePimAssignmentsProvider();
    provider.isP2Missing = true;
    const caller: PimCaller = {
      tenantScope: tenantScope([TENANT]),
      permissions: [PIM_READ_PERMISSION],
    };
    const route = createPimAssignmentsRoute({
      provider,
      resolveCaller: () => caller,
    });

    const response = await route.handler({
      method: "GET",
      path: `/v1/tenants/${TENANT}/pim`,
      params: { tenantId: TENANT },
      query: new URLSearchParams(),
      headers: {},
    });

    expect(response.status).toBe(200);
    const body = response.body as PimAssignmentsPage;
    expect(body.gate.supported).toBe(false);
    expect(body.gate.status).toBe("license-missing");
    expect(body.items).toHaveLength(0);
  });

  it("validates enum parameters in query", () => {
    expect(() =>
      parsePimAssignmentsFilter(new URLSearchParams("assignmentType=permanent")),
    ).toThrow(AppError);
  });
});
