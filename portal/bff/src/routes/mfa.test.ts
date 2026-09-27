import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { tenantScope } from "../rbac/scope.js";
import {
  MFA_OPENAPI,
  MFA_PERMISSIONS,
  MFA_REPORT_PATH,
  computeMfaKpis,
  createMfaRoutes,
  getMfaReport,
  parseMfaReportFilter,
  type MfaCaller,
  type MfaReportProvider,
  type MfaUserRow,
} from "./mfa.js";

const TENANT = "tenant-a";

const ROW_REGISTERED: MfaUserRow = {
  userId: "user-1",
  displayName: "Member One",
  userPrincipalName: "member.one@example.invalid",
  methods: ["microsoftAuthenticator", "phone"],
  defaultMethod: "microsoftAuthenticator",
  phishingResistant: "not-phishing-resistant",
  lastAuthDateTime: "2026-08-01T00:00:00.000Z",
  state: "registered",
  licenses: ["sku-1"],
  isAdmin: false,
};

const ROW_PHISHING_RESISTANT: MfaUserRow = {
  userId: "user-2",
  displayName: "Admin Two",
  userPrincipalName: "admin.two@example.invalid",
  methods: ["fido2"],
  defaultMethod: "fido2",
  phishingResistant: "phishing-resistant",
  lastAuthDateTime: null,
  state: "registered",
  licenses: ["sku-1"],
  isAdmin: true,
};

const ROW_UNREGISTERED: MfaUserRow = {
  userId: "user-3",
  displayName: "Guest Three",
  userPrincipalName: "guest.three@example.invalid",
  methods: [],
  defaultMethod: null,
  phishingResistant: "not-phishing-resistant",
  lastAuthDateTime: null,
  state: "notRegistered",
  licenses: [],
  isAdmin: false,
};

class FakeReportProvider implements MfaReportProvider {
  readonly calls: Array<{ tenantId: string; filter: unknown }> = [];

  constructor(
    private readonly rows: readonly MfaUserRow[] = [ROW_REGISTERED, ROW_PHISHING_RESISTANT, ROW_UNREGISTERED],
  ) {}

  async getMfaReport(tenantId: string, filter: unknown) {
    this.calls.push({ tenantId, filter });
    return { rows: [...this.rows], nextCursor: null, retrievedAt: "2026-09-26T00:00:00.000Z" };
  }
}

function callerFor(tenantIds: readonly string[] | "all"): MfaCaller {
  return {
    roles: [],
    tenantScope: tenantIds === "all" ? { all: true, tenantIds: [] } : tenantScope(tenantIds),
  };
}

describe("MFA report filter parsing (T-0221)", () => {
  it("defaults to an unfiltered cursor page", () => {
    expect(parseMfaReportFilter(new URLSearchParams())).toEqual({
      cursor: null,
      limit: 100,
    });
  });

  it("accepts every §3.1 filter", () => {
    const filter = parseMfaReportFilter(
      new URLSearchParams({
        registered: "registered",
        method: "fido2",
        phishingResistant: "true",
        license: "licensed",
        adminRole: "false",
      }),
    );
    expect(filter).toEqual({
      registered: "registered",
      method: "fido2",
      phishingResistant: true,
      license: "licensed",
      adminRole: false,
      cursor: null,
      limit: 100,
    });
  });

  it("rejects an unknown registration state", () => {
    expect(() => parseMfaReportFilter(new URLSearchParams({ registered: "maybe" }))).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });

  it("rejects a non-boolean phishingResistant flag", () => {
    expect(() => parseMfaReportFilter(new URLSearchParams({ phishingResistant: "yes" }))).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });

  it("rejects an unknown license filter", () => {
    expect(() => parseMfaReportFilter(new URLSearchParams({ license: "trial" }))).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });
});

describe("MFA KPI aggregation (T-0221)", () => {
  it("reconciles with the served rows", () => {
    const rows = [ROW_REGISTERED, ROW_PHISHING_RESISTANT, ROW_UNREGISTERED];
    const kpis = computeMfaKpis(rows);
    expect(kpis.total).toBe(rows.length);
    expect(kpis.registered + kpis.notRegistered).toBe(rows.length);
    expect(kpis.registered).toBe(2);
    expect(kpis.notRegistered).toBe(1);
    expect(kpis.phishingResistant).toBe(1);
    expect(kpis.perMethod).toEqual({
      microsoftAuthenticator: 1,
      phone: 1,
      fido2: 1,
    });
  });

  it("counts a method once per user even when listed twice", () => {
    const kpis = computeMfaKpis([{ ...ROW_REGISTERED, methods: ["phone", "phone"] }]);
    expect(kpis.perMethod).toEqual({ phone: 1 });
  });

  it("aggregates an empty page to zero", () => {
    expect(computeMfaKpis([])).toEqual({
      total: 0,
      registered: 0,
      notRegistered: 0,
      phishingResistant: 0,
      perMethod: {},
    });
  });
});

describe("MFA report handler (T-0221)", () => {
  it("returns rows with reconciling KPIs and the provider page cursor", async () => {
    const provider = new FakeReportProvider();
    const response = await getMfaReport(provider, TENANT, { cursor: null, limit: 100 });
    expect(response.status).toBe(200);
    expect(response.body.tenantId).toBe(TENANT);
    expect(response.body.rows).toHaveLength(3);
    expect(response.body.kpis.total).toBe(3);
    expect(response.body.kpis.registered + response.body.kpis.notRegistered).toBe(3);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toMatchObject({ tenantId: TENANT });
  });

  it("rejects a blank tenant id", async () => {
    await expect(getMfaReport(new FakeReportProvider([]), "  ", { cursor: null, limit: 100 })).rejects.toMatchObject(
      { status: 400 },
    );
  });

  it("requires authentication", async () => {
    const routes = createMfaRoutes({
      report: new FakeReportProvider(),
      resolveCaller: () => undefined,
    });
    const handler = routes.find((route) => route.path === MFA_REPORT_PATH)?.handler;
    expect(handler).toBeDefined();
    await expect(
      handler!({
        correlationId: "corr-1",
        method: "GET",
        path: MFA_REPORT_PATH,
        query: new URLSearchParams(),
        headers: {},
        params: { tenantId: TENANT },
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("enforces the mfa.read permission through the authorize seam", async () => {
    const routes = createMfaRoutes({
      report: new FakeReportProvider(),
      resolveCaller: () => callerFor("all"),
      authorize: async (_caller, permission) => {
        if (permission !== MFA_PERMISSIONS.read) {
          throw new AppError("auth.forbidden", "not permitted to perform this action", 403);
        }
      },
    });
    const handler = routes.find((route) => route.path === MFA_REPORT_PATH)?.handler;
    const response = await handler!({
      correlationId: "corr-1",
      method: "GET",
      path: MFA_REPORT_PATH,
      query: new URLSearchParams(),
      headers: {},
      params: { tenantId: TENANT },
    });
    expect(response.status).toBe(200);
  });

  it("refuses a tenant outside the caller scope", async () => {
    const routes = createMfaRoutes({
      report: new FakeReportProvider(),
      resolveCaller: () => callerFor([TENANT]),
      authorize: async () => undefined,
    });
    const handler = routes.find((route) => route.path === MFA_REPORT_PATH)?.handler;
    await expect(
      handler!({
        correlationId: "corr-1",
        method: "GET",
        path: MFA_REPORT_PATH,
        query: new URLSearchParams(),
        headers: {},
        params: { tenantId: "tenant-b" },
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("publishes the report operation with the mfa.read permission", () => {
    const operation = MFA_OPENAPI.paths["/tenants/{tenantId}/mfa-report"].get;
    expect(operation.operationId).toBe("getMfaReport");
    expect(operation.permission).toBe("Identity.Mfa.Read");
  });
});
