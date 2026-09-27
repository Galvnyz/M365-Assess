import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { tenantScope } from "../rbac/scope.js";
import {
  CA_NAMED_LOCATIONS_BASE_PATH,
  CA_NAMED_LOCATIONS_ITEM_PATH,
  CA_READ_PERMISSION,
  CA_WRITE_PERMISSION,
  createCaNamedLocationsRoutes,
  validateCidr,
  validateCountryCode,
  type CaNamedLocationCreateInput,
  type CaNamedLocationEditInput,
  type CaNamedLocationItem,
  type CaNamedLocationMutationResult,
  type CaNamedLocationPlan,
  type CaNamedLocationsListResponse,
  type CaNamedLocationsProvider,
  type CaNamedLocationsRoutesOptions,
} from "./ca-named-locations.js";

const TENANT = "tenant-test";

class FakeCaNamedLocationsProvider implements CaNamedLocationsProvider {
  readonly createCalls: Array<{ tenantId: string; input: CaNamedLocationCreateInput; preview: boolean }> = [];
  readonly editCalls: Array<{ tenantId: string; locationId: string; input: CaNamedLocationEditInput; preview: boolean }> = [];
  readonly deleteCalls: Array<{ tenantId: string; locationId: string; confirmName?: string; preview: boolean }> = [];

  locations: CaNamedLocationItem[] = [
    {
      id: "loc-1",
      displayName: "Corporate HQ",
      locationType: "ip",
      isTrusted: true,
      ipRanges: ["192.168.1.0/24"],
      referencingPolicies: [{ id: "pol-1", displayName: "MFA for HQ" }],
      inUse: true,
    },
    {
      id: "loc-2",
      displayName: "Approved Countries",
      locationType: "country",
      countriesAndRegions: ["US", "CA"],
      includeUnknownCountriesAndRegions: false,
      referencingPolicies: [],
      inUse: false,
    },
  ];

  async listLocations(tenantId: string): Promise<CaNamedLocationsListResponse> {
    return {
      tenantId,
      totalCount: this.locations.length,
      items: this.locations,
    };
  }

  async createLocation(
    tenantId: string,
    input: CaNamedLocationCreateInput,
    preview: boolean,
  ): Promise<CaNamedLocationMutationResult | CaNamedLocationPlan> {
    this.createCalls.push({ tenantId, input, preview });
    const plan: CaNamedLocationPlan = {
      action: "create",
      locationId: "new-loc-id",
      targetName: input.displayName,
      diff: [`+ Named Location: ${input.displayName}`],
      valid: true,
      dryRun: preview,
      inUse: false,
      requiresConfirmation: false,
    };
    if (preview) return plan;
    return {
      success: true,
      plan,
      result: { id: "new-loc-id", displayName: input.displayName },
      auditEvent: {
        id: "audit-1",
        tenantId,
        action: "ca.namedLocation.create",
        targetId: "new-loc-id",
        targetName: input.displayName,
        timestamp: new Date().toISOString(),
      },
    };
  }

  async editLocation(
    tenantId: string,
    locationId: string,
    input: CaNamedLocationEditInput,
    preview: boolean,
  ): Promise<CaNamedLocationMutationResult | CaNamedLocationPlan> {
    this.editCalls.push({ tenantId, locationId, input, preview });
    const plan: CaNamedLocationPlan = {
      action: "edit",
      locationId,
      targetName: input.displayName ?? "Existing",
      diff: ["~ Updated"],
      valid: true,
      dryRun: preview,
      inUse: false,
      requiresConfirmation: false,
    };
    if (preview) return plan;
    return {
      success: true,
      plan,
      result: { id: locationId, displayName: input.displayName },
      auditEvent: {
        id: "audit-2",
        tenantId,
        action: "ca.namedLocation.edit",
        targetId: locationId,
        targetName: input.displayName ?? "Existing",
        timestamp: new Date().toISOString(),
      },
    };
  }

  async deleteLocation(
    tenantId: string,
    locationId: string,
    confirmName?: string,
    preview?: boolean,
  ): Promise<CaNamedLocationMutationResult | CaNamedLocationPlan> {
    this.deleteCalls.push({ tenantId, locationId, confirmName, preview });
    const plan: CaNamedLocationPlan = {
      action: "delete",
      locationId,
      targetName: "Deleted Location",
      diff: ["- Named Location"],
      valid: true,
      dryRun: Boolean(preview),
      inUse: false,
      requiresConfirmation: false,
    };
    if (preview) return plan;
    return {
      success: true,
      plan,
      result: { deleted: true },
      auditEvent: {
        id: "audit-3",
        tenantId,
        action: "ca.namedLocation.delete",
        targetId: locationId,
        targetName: "Deleted Location",
        timestamp: new Date().toISOString(),
      },
    };
  }
}

function createHarness(overrides?: Partial<CaNamedLocationsRoutesOptions>) {
  const provider = new FakeCaNamedLocationsProvider();
  let defaultCaller: any = {
    userId: "user-1",
    roles: ["admin"],
    permissions: [CA_READ_PERMISSION, CA_WRITE_PERMISSION],
    tenantScope: tenantScope([TENANT]),
  };

  const routes = createCaNamedLocationsRoutes({
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

describe("CIDR and Country Code validation helpers", () => {
  it("validates IPv4 CIDR notation correctly", () => {
    expect(validateCidr("192.168.1.0/24")).toBe(true);
    expect(validateCidr("10.0.0.0/8")).toBe(true);
    expect(validateCidr("0.0.0.0/0")).toBe(true);
    expect(validateCidr("172.16.0.1/32")).toBe(true);

    expect(validateCidr("invalid")).toBe(false);
    expect(validateCidr("192.168.1.1")).toBe(false);
    expect(validateCidr("999.999.999.999/24")).toBe(false);
    expect(validateCidr("10.0.0.0/33")).toBe(false);
  });

  it("validates IPv6 CIDR notation correctly", () => {
    expect(validateCidr("2001:db8::/32")).toBe(true);
    expect(validateCidr("::1/128")).toBe(true);
    expect(validateCidr("fe80::/10")).toBe(true);

    expect(validateCidr("2001:db8::/129")).toBe(false);
  });

  it("validates ISO 3166-1 alpha-2 country codes correctly", () => {
    expect(validateCountryCode("US")).toBe(true);
    expect(validateCountryCode("GB")).toBe(true);
    expect(validateCountryCode("ca")).toBe(true);

    expect(validateCountryCode("USA")).toBe(false);
    expect(validateCountryCode("12")).toBe(false);
    expect(validateCountryCode("")).toBe(false);
  });
});

describe("GET /v1/tenants/:tenantId/ca/named-locations (T-0288)", () => {
  it("rejects unauthenticated caller", async () => {
    const harness = createHarness({ resolveCaller: () => undefined });
    const route = harness.getRoute("GET", CA_NAMED_LOCATIONS_BASE_PATH);
    await expect(
      route.handler({
        path: `/v1/tenants/${TENANT}/ca/named-locations`,
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
        headers: {},
      }),
    ).rejects.toThrow(AppError);
  });

  it("returns list of named locations with referencing policies", async () => {
    const harness = createHarness();
    const route = harness.getRoute("GET", CA_NAMED_LOCATIONS_BASE_PATH);
    const res = await route.handler({
      path: `/v1/tenants/${TENANT}/ca/named-locations`,
      params: { tenantId: TENANT },
      query: new URLSearchParams(),
      headers: {},
    });
    expect(res.status).toBe(200);
    const body = (res.body as any);
    expect(body.totalCount).toBe(2);
    expect(body.items[0].displayName).toBe("Corporate HQ");
    expect(body.items[0].inUse).toBe(true);
    expect(body.items[0].referencingPolicies).toHaveLength(1);
    expect(body.items[1].inUse).toBe(false);
  });
});

describe("POST /v1/tenants/:tenantId/ca/named-locations (T-0288)", () => {
  it("rejects without ca.write permission", async () => {
    const harness = createHarness();
    harness.setCaller({
      userId: "user-ro",
      roles: ["viewer"],
      permissions: [CA_READ_PERMISSION],
      tenantScope: tenantScope([TENANT]),
    });
    const route = harness.getRoute("POST", CA_NAMED_LOCATIONS_BASE_PATH);
    await expect(
      route.handler({
        path: `/v1/tenants/${TENANT}/ca/named-locations`,
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
        headers: {},
        body: { displayName: "HQ", locationType: "ip", ipRanges: ["10.0.0.0/8"] },
      }),
    ).rejects.toThrow(AppError);
  });

  it("validates missing displayName", async () => {
    const harness = createHarness();
    const route = harness.getRoute("POST", CA_NAMED_LOCATIONS_BASE_PATH);
    await expect(
      route.handler({
        path: `/v1/tenants/${TENANT}/ca/named-locations`,
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
        headers: {},
        body: { displayName: "", locationType: "ip", ipRanges: ["10.0.0.0/8"] },
      }),
    ).rejects.toThrow(/displayName is required/);
  });

  it("validates invalid CIDR for IP location", async () => {
    const harness = createHarness();
    const route = harness.getRoute("POST", CA_NAMED_LOCATIONS_BASE_PATH);
    await expect(
      route.handler({
        path: `/v1/tenants/${TENANT}/ca/named-locations`,
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
        headers: {},
        body: { displayName: "Bad IP", locationType: "ip", ipRanges: ["not-a-cidr"] },
      }),
    ).rejects.toThrow(/Invalid CIDR range/);
  });

  it("validates invalid country code for country location", async () => {
    const harness = createHarness();
    const route = harness.getRoute("POST", CA_NAMED_LOCATIONS_BASE_PATH);
    await expect(
      route.handler({
        path: `/v1/tenants/${TENANT}/ca/named-locations`,
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
        headers: {},
        body: { displayName: "Bad Country", locationType: "country", countriesAndRegions: ["USA"] },
      }),
    ).rejects.toThrow(/Invalid country code/);
  });

  it("supports preview mode returning plan preview", async () => {
    const harness = createHarness();
    const route = harness.getRoute("POST", CA_NAMED_LOCATIONS_BASE_PATH);
    const res = await route.handler({
      path: `/v1/tenants/${TENANT}/ca/named-locations`,
      params: { tenantId: TENANT },
      query: new URLSearchParams({ preview: "true" }),
      headers: {},
      body: { displayName: "New Location", locationType: "ip", ipRanges: ["10.0.0.0/8"] },
    });
    expect(res.status).toBe(200);
    const body = (res.body as any);
    expect(body.action).toBe("create");
    expect(body.dryRun).toBe(true);
    expect(harness.provider.createCalls[0]!.preview).toBe(true);
  });

  it("creates location and returns audit event when preview is false", async () => {
    const harness = createHarness();
    const route = harness.getRoute("POST", CA_NAMED_LOCATIONS_BASE_PATH);
    const res = await route.handler({
      path: `/v1/tenants/${TENANT}/ca/named-locations`,
      params: { tenantId: TENANT },
      query: new URLSearchParams(),
      headers: {},
      body: { displayName: "New Location", locationType: "ip", ipRanges: ["10.0.0.0/8"] },
    });
    expect(res.status).toBe(201);
    const body = (res.body as any);
    expect(body.success).toBe(true);
    expect(body.auditEvent.action).toBe("ca.namedLocation.create");
    expect(harness.provider.createCalls[0]!.preview).toBe(false);
  });
});

describe("PATCH & DELETE /v1/tenants/:tenantId/ca/named-locations/:locationId (T-0288)", () => {
  it("edits an existing location", async () => {
    const harness = createHarness();
    const route = harness.getRoute("PATCH", CA_NAMED_LOCATIONS_ITEM_PATH);
    const res = await route.handler({
      path: `/v1/tenants/${TENANT}/ca/named-locations/loc-1`,
      params: { tenantId: TENANT, locationId: "loc-1" },
      query: new URLSearchParams(),
      headers: {},
      body: { displayName: "Corporate HQ Updated", isTrusted: false },
    });
    expect(res.status).toBe(200);
    const body = (res.body as any);
    expect(body.success).toBe(true);
    expect(harness.provider.editCalls[0]!.locationId).toBe("loc-1");
  });

  it("deletes a location with confirmName", async () => {
    const harness = createHarness();
    const route = harness.getRoute("DELETE", CA_NAMED_LOCATIONS_ITEM_PATH);
    const res = await route.handler({
      path: `/v1/tenants/${TENANT}/ca/named-locations/loc-1`,
      params: { tenantId: TENANT, locationId: "loc-1" },
      query: new URLSearchParams(),
      headers: {},
      body: { confirmName: "Corporate HQ" },
    });
    expect(res.status).toBe(200);
    const body = (res.body as any);
    expect(body.success).toBe(true);
    expect(harness.provider.deleteCalls[0]!.confirmName).toBe("Corporate HQ");
  });
});
