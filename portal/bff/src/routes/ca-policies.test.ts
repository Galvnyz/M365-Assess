import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { tenantScope } from "../rbac/scope.js";
import {
  CA_POLICIES_PATH,
  CA_READ_PERMISSION,
  createCaPoliciesRoute,
  parseCaPoliciesFilter,
  type CaCaller,
  type CaPoliciesFilter,
  type CaPoliciesPage,
  type CaPoliciesProvider,
  type CaPolicyItem,
} from "./ca-policies.js";

const TENANT = "tenant-test";

const SAMPLE_POLICY: CaPolicyItem = {
  id: "ca-1",
  name: "Require MFA for Admins",
  displayName: "Require MFA for Admins",
  state: "enabled",
  usersTargeted: {
    includeUsers: [],
    excludeUsers: ["breakglass@example.com"],
    includeGroups: [],
    excludeGroups: [],
    includeRoles: ["62e90394-69f5-4237-9190-012177145e10"],
    excludeRoles: [],
    summary: "1 roles (excludes 1)",
  },
  apps: {
    includeApplications: ["All"],
    excludeApplications: [],
    summary: "All cloud apps",
  },
  grantControls: {
    operator: "OR",
    builtInControls: ["mfa"],
    summary: "Grant: mfa",
  },
  conditions: {
    clientAppTypes: ["all"],
    signInRiskLevels: [],
    userRiskLevels: [],
    summary: "Any",
  },
  createdDateTime: "2026-01-01T00:00:00Z",
  modifiedDateTime: "2026-09-20T12:00:00Z",
  modifiedBy: "admin@example.com",
};

class FakeCaPoliciesProvider implements CaPoliciesProvider {
  readonly calls: Array<{ tenantId: string; filter: CaPoliciesFilter }> = [];

  async listPolicies(tenantId: string, filter: CaPoliciesFilter): Promise<CaPoliciesPage> {
    this.calls.push({ tenantId, filter });
    return {
      tenantId,
      totalCount: 1,
      items: [SAMPLE_POLICY],
      nextCursor: null,
    };
  }
}

describe("CA policies list route (T-0281)", () => {
  it("exposes GET /v1/tenants/:tenantId/ca/policies", () => {
    const provider = new FakeCaPoliciesProvider();
    const route = createCaPoliciesRoute({
      provider,
      resolveCaller: () => ({
        tenantScope: tenantScope([TENANT]),
        permissions: [CA_READ_PERMISSION],
      }),
    });
    expect(route.method).toBe("GET");
    expect(route.path).toBe(CA_POLICIES_PATH);
  });

  it("rejects unauthenticated requests with 401", async () => {
    const provider = new FakeCaPoliciesProvider();
    const route = createCaPoliciesRoute({
      provider,
      resolveCaller: () => undefined,
    });

    await expect(
      route.handler({
        path: `/v1/tenants/${TENANT}/ca/policies`,
        method: "GET",
        headers: {},
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
      }),
    ).rejects.toThrow(AppError);
  });

  it("rejects missing ca.read permission with 403", async () => {
    const provider = new FakeCaPoliciesProvider();
    const route = createCaPoliciesRoute({
      provider,
      resolveCaller: () => ({
        tenantScope: tenantScope([TENANT]),
        permissions: ["other.read"],
      }),
    });

    await expect(
      route.handler({
        path: `/v1/tenants/${TENANT}/ca/policies`,
        method: "GET",
        headers: {},
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
      }),
    ).rejects.toThrow(AppError);
  });

  it("rejects tenant outside caller scope with 403", async () => {
    const provider = new FakeCaPoliciesProvider();
    const route = createCaPoliciesRoute({
      provider,
      resolveCaller: () => ({
        tenantScope: tenantScope(["tenant-other"]),
        permissions: [CA_READ_PERMISSION],
      }),
    });

    await expect(
      route.handler({
        path: `/v1/tenants/${TENANT}/ca/policies`,
        method: "GET",
        headers: {},
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
      }),
    ).rejects.toThrow(AppError);
  });

  it("returns 200 with policy list for authorized caller", async () => {
    const provider = new FakeCaPoliciesProvider();
    const route = createCaPoliciesRoute({
      provider,
      resolveCaller: () => ({
        tenantScope: tenantScope([TENANT]),
        permissions: [CA_READ_PERMISSION],
      }),
    });

    const response = await route.handler({
      path: `/v1/tenants/${TENANT}/ca/policies`,
      method: "GET",
      headers: {},
      params: { tenantId: TENANT },
      query: new URLSearchParams(),
    });

    expect(response.status).toBe(200);
    const body = response.body as CaPoliciesPage;
    expect(body.tenantId).toBe(TENANT);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.id).toBe("ca-1");
  });

  it("parses filter parameters and forwards to provider", async () => {
    const provider = new FakeCaPoliciesProvider();
    const route = createCaPoliciesRoute({
      provider,
      resolveCaller: () => ({
        tenantScope: tenantScope([TENANT]),
        permissions: [CA_READ_PERMISSION],
      }),
    });

    const query = new URLSearchParams({
      state: "enabled",
      target: "admins",
      control: "mfa",
      condition: "locations",
      modifiedDate: "2026-09",
      search: "Require MFA",
      limit: "25",
    });

    await route.handler({
      path: `/v1/tenants/${TENANT}/ca/policies`,
      method: "GET",
      headers: {},
      params: { tenantId: TENANT },
      query,
    });

    expect(provider.calls).toHaveLength(1);
    const filter = provider.calls[0]!.filter;
    expect(filter.state).toBe("enabled");
    expect(filter.target).toBe("admins");
    expect(filter.control).toBe("mfa");
    expect(filter.condition).toBe("locations");
    expect(filter.modifiedDate).toBe("2026-09");
    expect(filter.search).toBe("Require MFA");
    expect(filter.limit).toBe(25);
  });

  it("parses parseCaPoliciesFilter directly", () => {
    const query = new URLSearchParams({
      state: "disabled",
      cursor: "b2Zmc2V0OjEw",
      limit: "50",
    });
    const filter = parseCaPoliciesFilter(query);
    expect(filter.state).toBe("disabled");
    expect(filter.cursor).toBe("b2Zmc2V0OjEw");
    expect(filter.limit).toBe(50);
  });
});
