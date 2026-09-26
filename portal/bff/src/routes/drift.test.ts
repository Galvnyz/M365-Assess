// T-0164 — drift read API, breakdown, refresh, and alignment.
import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { ALL_TENANTS, tenantScope } from "../rbac/scope.js";
import { RbacErrorCodes, type Caller } from "../rbac/authorize.js";
import type { RequestContext } from "../server.js";
import {
  DRIFT_ALIGNMENT_PATH,
  DRIFT_OPENAPI,
  DRIFT_PERMISSIONS,
  DRIFT_REFRESH_PATH,
  DRIFT_TENANT_PATH,
  buildDriftAlignmentAggregate,
  buildDriftBreakdown,
  createDriftRoutes,
  type DriftDeviationRecord,
  type DriftStore,
} from "./drift.js";

const TENANT_1 = "11111111-1111-1111-1111-111111111111";
const TENANT_2 = "22222222-2222-2222-2222-222222222222";

function deviation(overrides: Partial<DriftDeviationRecord> = {}): DriftDeviationRecord {
  return {
    id: "d1",
    tenantId: TENANT_1,
    standardKey: "CA-REPORTONLY-001",
    resourceId: "p1",
    kind: "mismatch",
    current: { state: "disabled" },
    expected: { state: "enabled" },
    state: "open",
    reason: null,
    expiresOn: null,
    autoRemediateOnExpiry: false,
    overrideValue: null,
    lastSeenAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

class MemoryDriftStore implements DriftStore {
  constructor(private readonly rows: DriftDeviationRecord[]) {}
  async listDeviations(
    tenantId: string,
    options: { state?: DriftDeviationRecord["state"]; kind?: DriftDeviationRecord["kind"] } = {},
  ): Promise<readonly DriftDeviationRecord[]> {
    return this.rows.filter(
      (row) =>
        row.tenantId === tenantId &&
        (options.state === undefined || row.state === options.state) &&
        (options.kind === undefined || row.kind === options.kind),
    );
  }
  async listAllDeviations(): Promise<readonly DriftDeviationRecord[]> {
    return this.rows;
  }
}

function adminCaller(): Caller {
  return { roles: ["admin"], tenantScope: ALL_TENANTS };
}

function allowAll(): void {}
function denyAll(): void {
  throw new AppError(RbacErrorCodes.forbidden, "not permitted to perform this action", 403);
}

const REFRESH = {
  async refresh() {
    return { recomputed: true, inserted: 1, updated: 0, preserved: 2 };
  },
};

function makeOptions(store: DriftStore, overrides: Record<string, unknown> = {}) {
  return {
    store,
    refresh: REFRESH,
    resolveCaller: () => adminCaller(),
    authorize: allowAll,
    ...overrides,
  };
}

function routeFor(opts: Parameters<typeof createDriftRoutes>[0], method: string, path: string) {
  const route = createDriftRoutes(opts).find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`route not found: ${method} ${path}`);
  return route;
}

function ctx(
  method: string,
  path: string,
  options: { params?: Record<string, string>; query?: Record<string, string> } = {},
): RequestContext {
  return {
    correlationId: "corr-1",
    method,
    path,
    query: new URLSearchParams(options.query ?? {}),
    headers: {},
    params: options.params ?? {},
  };
}

const ROWS: DriftDeviationRecord[] = [
  deviation({ id: "d1", state: "open" }),
  deviation({ id: "d2", resourceId: "p2", state: "accepted", reason: "ok", expiresOn: "2026-06-01" }),
  deviation({ id: "d3", resourceId: "p3", state: "customerSpecific", overrideValue: { state: "reportOnly" } }),
  deviation({ id: "d4", resourceId: "p4", state: "denied" }),
  deviation({ id: "d5", resourceId: "extra-1", standardKey: "extra:conditionalAccess", kind: "extra", state: "open", expected: null }),
  deviation({ id: "d6", tenantId: TENANT_2, resourceId: "extra-2", standardKey: "extra:intune", kind: "extra", state: "open", expected: null }),
];

describe("buildDriftBreakdown (T-0164)", () => {
  it("counts by state including delete pending and resolved", () => {
    const rows = [
      deviation({ id: "1", state: "open" }),
      deviation({ id: "2", state: "deletePending" }),
      deviation({ id: "3", state: "resolved" }),
    ];
    expect(buildDriftBreakdown(rows)).toEqual({
      open: 1,
      accepted: 0,
      customerSpecific: 0,
      denied: 0,
      deletePending: 1,
      resolved: 1,
      total: 3,
    });
  });
});

describe("GET /v1/drift/{tenantId} (T-0164)", () => {
  it("returns deviations and the breakdown by state", async () => {
    const route = routeFor(makeOptions(new MemoryDriftStore(ROWS)), "GET", DRIFT_TENANT_PATH);
    const res = await route.handler(ctx("GET", DRIFT_TENANT_PATH, { params: { tenantId: TENANT_1 } }));

    expect(res.status).toBe(200);
    const body = res.body as { tenantId: string; breakdown: Record<string, number>; items: unknown[] };
    expect(body.tenantId).toBe(TENANT_1);
    expect(body.breakdown).toMatchObject({
      open: 2,
      accepted: 1,
      customerSpecific: 1,
      denied: 1,
      total: 5,
    });
    expect(body.items).toHaveLength(5);
  });

  it("filters by state and kind", async () => {
    const route = routeFor(makeOptions(new MemoryDriftStore(ROWS)), "GET", DRIFT_TENANT_PATH);
    const extra = await route.handler(
      ctx("GET", DRIFT_TENANT_PATH, { params: { tenantId: TENANT_1 }, query: { kind: "extra" } }),
    );
    expect((extra.body as { items: { resourceId: string }[] }).items.map((i) => i.resourceId)).toEqual(["extra-1"]);

    await expect(
      route.handler(ctx("GET", DRIFT_TENANT_PATH, { params: { tenantId: TENANT_1 }, query: { state: "bogus" } })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("enforces tenant scope and auth", async () => {
    const scoped = routeFor(
      makeOptions(new MemoryDriftStore(ROWS), {
        resolveCaller: () => ({ roles: ["operator"], tenantScope: tenantScope([TENANT_2]) }),
      }),
      "GET",
      DRIFT_TENANT_PATH,
    );
    await expect(
      scoped.handler(ctx("GET", DRIFT_TENANT_PATH, { params: { tenantId: TENANT_1 } })),
    ).rejects.toMatchObject({ status: 403 });

    const anon = routeFor(makeOptions(new MemoryDriftStore(ROWS), { resolveCaller: () => undefined }), "GET", DRIFT_TENANT_PATH);
    await expect(
      anon.handler(ctx("GET", DRIFT_TENANT_PATH, { params: { tenantId: TENANT_1 } })),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe("POST /v1/drift/{tenantId}/refresh (T-0164)", () => {
  it("recomputes through the refresh seam and reports the upsert counts", async () => {
    let refreshedTenant: string | null = null;
    const route = routeFor(
      makeOptions(new MemoryDriftStore(ROWS), {
        refresh: {
          async refresh(tenantId: string) {
            refreshedTenant = tenantId;
            return { recomputed: true, inserted: 1, updated: 3, preserved: 2 };
          },
        },
      }),
      "POST",
      DRIFT_REFRESH_PATH,
    );

    const res = await route.handler(ctx("POST", DRIFT_REFRESH_PATH, { params: { tenantId: TENANT_1 } }));
    expect(res.status).toBe(202);
    expect(refreshedTenant).toBe(TENANT_1);
    const body = res.body as { status: string; result: Record<string, unknown> };
    expect(body.status).toBe("refreshed");
    // Settled deviations were preserved, not cleared.
    expect(body.result["preserved"]).toBe(2);
  });

  it("requires drift.triage and tenant scope", async () => {
    const denied = routeFor(
      makeOptions(new MemoryDriftStore(ROWS), { authorize: denyAll }),
      "POST",
      DRIFT_REFRESH_PATH,
    );
    await expect(
      denied.handler(ctx("POST", DRIFT_REFRESH_PATH, { params: { tenantId: TENANT_1 } })),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("GET /v1/drift/alignment (T-0164)", () => {
  it("includes the extra-policy dimension in the summary and aggregate views", async () => {
    const route = routeFor(makeOptions(new MemoryDriftStore(ROWS)), "GET", DRIFT_ALIGNMENT_PATH);

    const summary = await route.handler(ctx("GET", DRIFT_ALIGNMENT_PATH));
    const summaryItems = (summary.body as { items: { tenantId: string; extraPolicies: number }[] }).items;
    expect(summaryItems.find((r) => r.tenantId === TENANT_1)?.extraPolicies).toBe(1);
    expect(summaryItems.find((r) => r.tenantId === TENANT_2)?.extraPolicies).toBe(1);

    const aggregate = await route.handler(ctx("GET", DRIFT_ALIGNMENT_PATH, { query: { view: "aggregate" } }));
    const aggregateItems = (aggregate.body as { items: { standardKey: string; extraPolicies: number }[] }).items;
    expect(aggregateItems.find((r) => r.standardKey === "extra:conditionalAccess")?.extraPolicies).toBe(1);

    const byStandard = await route.handler(ctx("GET", DRIFT_ALIGNMENT_PATH, { query: { view: "by-standard" } }));
    expect((byStandard.body as { items: unknown[] }).items.length).toBe(ROWS.length);
  });

  it("registers alignment before the :tenantId route so the static path wins", () => {
    const routes = createDriftRoutes(makeOptions(new MemoryDriftStore(ROWS)));
    expect(routes[0]!.path).toBe(DRIFT_ALIGNMENT_PATH);
    // The matcher is first-match-wins, so order here is the guard.
    const alignmentIndex = routes.findIndex((r) => r.path === DRIFT_ALIGNMENT_PATH);
    const tenantIndex = routes.findIndex((r) => r.path === DRIFT_TENANT_PATH);
    expect(alignmentIndex).toBeLessThan(tenantIndex);
  });

  it("publishes read/triage permissions matching the implementation", () => {
    expect(DRIFT_OPENAPI["/v1/drift/{tenantId}"].get.permission).toBe(DRIFT_PERMISSIONS.read);
    expect(DRIFT_OPENAPI["/v1/drift/{tenantId}/refresh"].post.permission).toBe(DRIFT_PERMISSIONS.triage);
    expect(DRIFT_OPENAPI["/v1/drift/alignment"].get.permission).toBe(DRIFT_PERMISSIONS.read);
  });
});

describe("buildDriftAlignmentAggregate (T-0164)", () => {
  it("groups by standardKey across tenants with extra counts", () => {
    const aggregate = buildDriftAlignmentAggregate([
      deviation({ id: "1", standardKey: "A", kind: "mismatch", state: "open" }),
      deviation({ id: "2", standardKey: "A", kind: "mismatch", state: "accepted" }),
      deviation({ id: "3", standardKey: "extra:ca", kind: "extra", state: "open" }),
    ]);
    const a = aggregate.find((row) => row.standardKey === "A")!;
    expect(a.total).toBe(2);
    expect(a.extraPolicies).toBe(0);
    expect(aggregate.find((row) => row.standardKey === "extra:ca")?.extraPolicies).toBe(1);
  });
});
