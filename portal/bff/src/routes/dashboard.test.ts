import { describe, expect, it, vi } from "vitest";
import { AppError } from "../errors.js";
import type { Caller } from "../rbac/authorize.js";
import { ALL_TENANTS, tenantScope } from "../rbac/scope.js";
import type { RequestContext } from "../server.js";
import {
  createDashboardRoutes,
  createDashboardTenantRoute,
  createDashboardFleetRoute,
  createDashboardWidgetsRoute,
  DASHBOARD_OPENAPI,
  STOCK_V1_WIDGETS,
  type DashboardRoutesStore,
  type DashboardPayload,
  type FleetPayload,
} from "./dashboard.js";

const NOW = "2026-09-26T10:00:00.000Z";

const POPULATED_PAYLOAD: DashboardPayload = {
  schemaVersion: "v1",
  tenantId: "tenant-contoso",
  tenantInfo: {
    tenantId: "tenant-contoso",
    displayName: "Contoso Corp",
    defaultDomain: "contoso.com",
    initialDomain: null,
    status: "active",
    source: "direct",
    lastRunAt: NOW,
  },
  isEmpty: false,
  emptyState: null,
  score: { current: 85, max: 100, percentage: 85, evaluatedCount: 20 },
  assessment: {
    runId: "run-001",
    finishedAt: NOW,
    status: "succeeded",
    headlineScore: 85,
    summaryCounts: { pass: 17, fail: 3, warning: 0, review: 0, skipped: 0, notLicensed: 0, total: 20 },
  },
  metrics: { metrics: [] },
  alerts: { critical: 1, high: 2, medium: 0, low: 0, total: 3 },
  authMethods: null,
  mfa: null,
  licenses: null,
  identity: null,
  devices: null,
  generatedAt: NOW,
};

const EMPTY_PAYLOAD: DashboardPayload = {
  schemaVersion: "v1",
  tenantId: "tenant-empty",
  tenantInfo: {
    tenantId: "tenant-empty",
    displayName: "Empty Tenant",
    defaultDomain: null,
    initialDomain: null,
    status: "active",
    source: "direct",
    lastRunAt: null,
  },
  isEmpty: true,
  emptyState: {
    isEmpty: true,
    reason: "no_completed_run",
    message: "No completed assessment run found for this tenant. Run an assessment to generate dashboard metrics.",
  },
  score: null,
  assessment: null,
  metrics: null,
  alerts: null,
  authMethods: null,
  mfa: null,
  licenses: null,
  identity: null,
  devices: null,
  generatedAt: NOW,
};

const FLEET_PAYLOAD: FleetPayload = {
  schemaVersion: "v1",
  items: [
    {
      tenantId: "tenant-contoso",
      displayName: "Contoso Corp",
      defaultDomain: "contoso.com",
      status: "active",
      hasCompletedRun: true,
      score: 85,
      complianceRate: 85,
      lastRunAt: NOW,
      lastRunId: "run-001",
      lastRunStatus: "succeeded",
      findingCounts: { pass: 17, fail: 3, warning: 0, total: 20 },
      openAlerts: { critical: 1, high: 2, medium: 0, low: 0, total: 3 },
    },
  ],
  total: 1,
  generatedAt: NOW,
};

function makeContext(params: Record<string, string> = {}): RequestContext {
  return {
    correlationId: "corr-123",
    method: "GET",
    path: "/v1/dashboard",
    query: new URLSearchParams(),
    headers: {},
    params,
  };
}

describe("Dashboard routes (T-0062)", () => {
  const adminCaller: Caller = {
    roles: ["admin"],
    tenantScope: ALL_TENANTS,
  };

  const restrictedCaller: Caller = {
    roles: ["operator"],
    tenantScope: tenantScope(["tenant-contoso"]),
  };

  describe("GET /v1/dashboard/:tenantId", () => {
    it("returns 200 with dashboard payload for an in-scope tenant", async () => {
      const store: DashboardRoutesStore = {
        getTenantDashboard: vi.fn().mockResolvedValue(POPULATED_PAYLOAD),
        getFleetDashboard: vi.fn(),
      };

      const route = createDashboardTenantRoute({
        store,
        resolveCaller: () => restrictedCaller,
      });

      const res = await route.handler(makeContext({ tenantId: "tenant-contoso" }));

      expect(res.status).toBe(200);
      expect(res.body).toEqual(POPULATED_PAYLOAD);
      expect(store.getTenantDashboard).toHaveBeenCalledWith("tenant-contoso", restrictedCaller.tenantScope);
    });

    it("returns 200 with explicit empty state when tenant has no completed run", async () => {
      const store: DashboardRoutesStore = {
        getTenantDashboard: vi.fn().mockResolvedValue(EMPTY_PAYLOAD),
        getFleetDashboard: vi.fn(),
      };

      const route = createDashboardTenantRoute({
        store,
        resolveCaller: () => adminCaller,
      });

      const res = await route.handler(makeContext({ tenantId: "tenant-empty" }));

      expect(res.status).toBe(200);
      const body = res.body as DashboardPayload;
      expect(body.isEmpty).toBe(true);
      expect(body.score).toBeNull();
      expect(body.emptyState?.reason).toBe("no_completed_run");
    });

    it("returns structured 403 when tenant is outside the caller scope", async () => {
      const store: DashboardRoutesStore = {
        getTenantDashboard: vi.fn(),
        getFleetDashboard: vi.fn(),
      };

      const route = createDashboardTenantRoute({
        store,
        resolveCaller: () => restrictedCaller, // Only scoped for tenant-contoso
      });

      await expect(
        route.handler(makeContext({ tenantId: "tenant-forbidden" }))
      ).rejects.toThrowError(AppError);

      try {
        await route.handler(makeContext({ tenantId: "tenant-forbidden" }));
      } catch (err: any) {
        expect(err.status).toBe(403);
        expect(err.code).toBe("auth.forbidden");
        expect(err.message).toContain("tenant is outside the caller scope");
        expect(err.details).toEqual([{ field: "tenantId", reason: "out_of_scope" }]);
      }

      expect(store.getTenantDashboard).not.toHaveBeenCalled();
    });

    it("returns 401 when request is unauthenticated", async () => {
      const store: DashboardRoutesStore = {
        getTenantDashboard: vi.fn(),
        getFleetDashboard: vi.fn(),
      };

      const route = createDashboardTenantRoute({
        store,
        resolveCaller: () => undefined,
      });

      await expect(
        route.handler(makeContext({ tenantId: "tenant-contoso" }))
      ).rejects.toMatchObject({ status: 401, code: "request.unauthenticated" });
    });
  });

  describe("GET /v1/dashboard", () => {
    it("returns 200 with fleet payload filtered by caller tenant scope", async () => {
      const store: DashboardRoutesStore = {
        getTenantDashboard: vi.fn(),
        getFleetDashboard: vi.fn().mockResolvedValue(FLEET_PAYLOAD),
      };

      const route = createDashboardFleetRoute({
        store,
        resolveCaller: () => restrictedCaller,
      });

      const res = await route.handler(makeContext());

      expect(res.status).toBe(200);
      expect(res.body).toEqual(FLEET_PAYLOAD);
      expect(store.getFleetDashboard).toHaveBeenCalledWith(restrictedCaller.tenantScope);
    });

    it("returns 401 when request is unauthenticated", async () => {
      const store: DashboardRoutesStore = {
        getTenantDashboard: vi.fn(),
        getFleetDashboard: vi.fn(),
      };

      const route = createDashboardFleetRoute({
        store,
        resolveCaller: () => undefined,
      });

      await expect(route.handler(makeContext())).rejects.toMatchObject({
        status: 401,
        code: "request.unauthenticated",
      });
    });
  });

  describe("GET /v1/dashboard/widgets", () => {
    it("returns all stock v1 widgets for admin caller", async () => {
      const store: DashboardRoutesStore = {
        getTenantDashboard: vi.fn(),
        getFleetDashboard: vi.fn(),
      };

      const route = createDashboardWidgetsRoute({
        store,
        resolveCaller: () => adminCaller,
      });

      const res = await route.handler(makeContext());

      expect(res.status).toBe(200);
      const body = res.body as { items: any[]; count: number };
      expect(body.count).toBe(STOCK_V1_WIDGETS.length);
      expect(body.items.length).toBe(STOCK_V1_WIDGETS.length);
    });

    it("omits widgets that the caller lacks permission to read", async () => {
      const store: DashboardRoutesStore = {
        getTenantDashboard: vi.fn(),
        getFleetDashboard: vi.fn(),
      };

      // Custom caller with explicit permissions lacking alerts.read and licensing.read
      const customCaller: Caller = {
        roles: ["operator"],
        tenantScope: ALL_TENANTS,
        ...({
          permissions: ["Portal.Dashboard.Read", "runs.read", "Identity.User.Read"],
        } as any),
      };

      const route = createDashboardWidgetsRoute({
        store,
        resolveCaller: () => customCaller,
        hasPermission: (c, perm) => {
          const perms = (c as any).permissions || [];
          return perms.includes(perm);
        },
      });

      const res = await route.handler(makeContext());

      expect(res.status).toBe(200);
      const body = res.body as { items: any[]; count: number };
      const returnedIds = body.items.map((w) => w.id);

      // Permitted widgets are present
      expect(returnedIds).toContain("TenantInfoCard");
      expect(returnedIds).toContain("TenantMetricsGrid");
      expect(returnedIds).toContain("AssessmentCard");
      expect(returnedIds).toContain("MFACard");

      // Acceptance criterion: Widgets the caller cannot read are absent from /v1/dashboard/widgets
      expect(returnedIds).not.toContain("AlertsOverviewCard"); // requires alerts.read
      expect(returnedIds).not.toContain("LicenseCard"); // requires licensing.read
    });
  });

  describe("createDashboardRoutes helper and OpenAPI schema", () => {
    it("registers all three dashboard routes in non-colliding order", () => {
      const store: DashboardRoutesStore = {
        getTenantDashboard: vi.fn(),
        getFleetDashboard: vi.fn(),
      };

      const routes = createDashboardRoutes({
        store,
        resolveCaller: () => adminCaller,
      });

      expect(routes.length).toBe(3);
      expect(routes.map((r) => r.path)).toEqual([
        "/v1/dashboard/widgets",
        "/v1/dashboard/:tenantId",
        "/v1/dashboard",
      ]);
    });

    it("matches OpenAPI specification", () => {
      expect(DASHBOARD_OPENAPI["/v1/dashboard/widgets"]).toBeDefined();
      expect(DASHBOARD_OPENAPI["/v1/dashboard/{tenantId}"]).toBeDefined();
      expect(DASHBOARD_OPENAPI["/v1/dashboard"]).toBeDefined();
    });
  });
});
