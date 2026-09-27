// Tests for Intune policies BFF route (T-0301).
import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { tenantScope } from "../rbac/scope.js";
import {
  INTUNE_POLICIES_PATH,
  INTUNE_READ_PERMISSION,
  createIntunePoliciesRoutes,
  type IntunePoliciesFilter,
  type IntunePoliciesPage,
  type IntunePoliciesProvider,
  type IntunePoliciesRoutesOptions,
} from "./intune-policies.js";

const TENANT = "tenant-intune-test";

class FakeIntunePoliciesProvider implements IntunePoliciesProvider {
  readonly calls: Array<{ tenantId: string; kind: string; filter: IntunePoliciesFilter }> = [];

  samplePage: IntunePoliciesPage = {
    tenantId: TENANT,
    kind: "configuration",
    totalCount: 2,
    items: [
      {
        id: "pol-cfg-1",
        name: "Windows Security Baseline",
        displayName: "Windows Security Baseline",
        platform: "windows",
        policyType: "Configuration Policy",
        assignedToCount: 3,
        assignments: [
          { id: "asgn-1", target: "All Devices", targetType: "allDevicesAssignmentTarget" },
        ],
        lastModifiedDateTime: "2026-09-20T10:00:00Z",
        modifiedBy: "admin@contoso.com",
      },
      {
        id: "pol-cfg-2",
        name: "BitLocker Enforcement",
        displayName: "BitLocker Enforcement",
        platform: "windows",
        policyType: "Configuration Policy",
        assignedToCount: 1,
        assignments: [
          { id: "asgn-2", target: "IT Group", targetType: "groupAssignmentTarget" },
        ],
        lastModifiedDateTime: "2026-09-21T08:30:00Z",
        modifiedBy: "operator@contoso.com",
      },
    ],
    nextCursor: null,
  };

  async listPolicies(
    tenantId: string,
    kind: string,
    filter: IntunePoliciesFilter,
  ): Promise<IntunePoliciesPage> {
    this.calls.push({ tenantId, kind, filter });
    return { ...this.samplePage, tenantId, kind };
  }
}

function createHarness(overrides?: Partial<IntunePoliciesRoutesOptions>) {
  const provider = new FakeIntunePoliciesProvider();
  let defaultCaller: any = {
    userId: "user-1",
    roles: ["admin"],
    permissions: [INTUNE_READ_PERMISSION],
    tenantScope: tenantScope([TENANT]),
  };

  const routes = createIntunePoliciesRoutes({
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

function makeCtx(kind: string, params: Record<string, string> = {}) {
  return {
    path: `/v1/tenants/${TENANT}/intune/${kind}`,
    params: { tenantId: TENANT, kind, ...params },
    query: new URLSearchParams(),
    headers: {},
  };
}

describe("GET /v1/tenants/:tenantId/intune/:kind (T-0301)", () => {
  it("rejects unauthenticated caller with 401", async () => {
    const harness = createHarness({ resolveCaller: () => undefined });
    const route = harness.getRoute("GET", INTUNE_POLICIES_PATH);
    await expect(route.handler(makeCtx("configuration"))).rejects.toMatchObject({
      status: 401,
    });
  });

  it("rejects caller without intune.read permission with 403", async () => {
    const harness = createHarness();
    harness.setCaller({
      userId: "user-2",
      permissions: ["Tenant.ConditionalAccess.Read"],
      tenantScope: tenantScope([TENANT]),
    });
    const route = harness.getRoute("GET", INTUNE_POLICIES_PATH);
    await expect(route.handler(makeCtx("configuration"))).rejects.toMatchObject({
      status: 403,
    });
  });

  it("rejects caller whose tenant scope does not include the requested tenant", async () => {
    const harness = createHarness();
    harness.setCaller({
      userId: "user-3",
      permissions: [INTUNE_READ_PERMISSION],
      tenantScope: tenantScope(["other-tenant"]),
    });
    const route = harness.getRoute("GET", INTUNE_POLICIES_PATH);
    await expect(route.handler(makeCtx("configuration"))).rejects.toThrow(AppError);
  });

  it("returns 400 for an unknown kind", async () => {
    const harness = createHarness();
    const route = harness.getRoute("GET", INTUNE_POLICIES_PATH);
    await expect(
      route.handler({
        path: `/v1/tenants/${TENANT}/intune/scripts`,
        params: { tenantId: TENANT, kind: "scripts" },
        query: new URLSearchParams(),
        headers: {},
      }),
    ).rejects.toMatchObject({ status: 400, code: "request.validation_failed" });
  });

  it("returns 501 for app-protection (known but unsupported in v1)", async () => {
    const harness = createHarness();
    const route = harness.getRoute("GET", INTUNE_POLICIES_PATH);
    await expect(
      route.handler({
        path: `/v1/tenants/${TENANT}/intune/app-protection`,
        params: { tenantId: TENANT, kind: "app-protection" },
        query: new URLSearchParams(),
        headers: {},
      }),
    ).rejects.toMatchObject({ status: 501, code: "intune.kind.unsupported" });
  });

  it("returns 200 with policy list for configuration (supported)", async () => {
    const harness = createHarness();
    const route = harness.getRoute("GET", INTUNE_POLICIES_PATH);
    const res = await route.handler(makeCtx("configuration"));
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string) as IntunePoliciesPage;
    expect(body.tenantId).toBe(TENANT);
    expect(body.kind).toBe("configuration");
    expect(body.totalCount).toBe(2);
    expect(body.items).toHaveLength(2);
    expect(body.items[0]!.platform).toBe("windows");
    expect(body.items[0]!.assignedToCount).toBe(3);
    expect(body.items[0]!.modifiedBy).toBe("admin@contoso.com");
  });

  it("returns 200 with policy list for compliance (supported)", async () => {
    const harness = createHarness();
    const route = harness.getRoute("GET", INTUNE_POLICIES_PATH);
    const res = await route.handler({
      path: `/v1/tenants/${TENANT}/intune/compliance`,
      params: { tenantId: TENANT, kind: "compliance" },
      query: new URLSearchParams(),
      headers: {},
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string) as IntunePoliciesPage;
    expect(body.kind).toBe("compliance");
    expect(body.totalCount).toBe(2);
  });

  it("forwards filter parameters to the provider", async () => {
    const harness = createHarness();
    const route = harness.getRoute("GET", INTUNE_POLICIES_PATH);
    const query = new URLSearchParams({ platform: "windows", assigned: "true", search: "security" });
    await route.handler({
      path: `/v1/tenants/${TENANT}/intune/configuration`,
      params: { tenantId: TENANT, kind: "configuration" },
      query,
      headers: {},
    });
    const call = harness.provider.calls[0]!;
    expect(call.tenantId).toBe(TENANT);
    expect(call.kind).toBe("configuration");
    expect(call.filter.platform).toBe("windows");
    expect(call.filter.assigned).toBe(true);
    expect(call.filter.search).toBe("security");
  });
});
