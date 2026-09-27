// T-0148 — standards alignment and per-tenant compare API.
import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { ALL_TENANTS, tenantScope } from "../rbac/scope.js";
import { RbacErrorCodes, type Caller } from "../rbac/authorize.js";
import type { RequestContext } from "../server.js";
import {
  ALIGNMENT_VIEWS,
  STANDARDS_ALIGNMENT_OPENAPI,
  STANDARDS_ALIGNMENT_PATH,
  STANDARDS_COMPARE_PATH,
  buildAggregateView,
  buildByStandardView,
  buildSummaryView,
  countCompliance,
  createStandardsAlignmentRoutes,
  type AlignmentStore,
  type StandardCompareRecord,
} from "./standards-alignment.js";

const TENANT_1 = "11111111-1111-1111-1111-111111111111";
const TENANT_2 = "22222222-2222-2222-2222-222222222222";

function row(
  tenantId: string,
  check: string,
  state: StandardCompareRecord["state"],
): StandardCompareRecord {
  return { tenantId, check, current: { v: 1 }, expected: { v: 2 }, state, lastRunAt: "2026-01-01T00:00:00.000Z" };
}

const ROWS: StandardCompareRecord[] = [
  row(TENANT_1, "ENTRA-SECDEFAULT-001", "compliant"),
  row(TENANT_1, "CA-REPORTONLY-001", "non-compliant"),
  row(TENANT_1, "ENTRA-PIM-001", "license missing"),
  row(TENANT_2, "ENTRA-SECDEFAULT-001", "reporting disabled"),
  row(TENANT_2, "CA-REPORTONLY-001", "accepted deviation"),
];

class MemoryAlignmentStore implements AlignmentStore {
  constructor(private readonly rows: StandardCompareRecord[]) {}
  async listCompare(tenantId?: string): Promise<readonly StandardCompareRecord[]> {
    return tenantId ? this.rows.filter((r) => r.tenantId === tenantId) : this.rows;
  }
}

function adminCaller(): Caller {
  return { roles: ["admin"], tenantScope: ALL_TENANTS };
}

function allowAll(): void {}
function denyAll(): void {
  throw new AppError(RbacErrorCodes.forbidden, "not permitted to perform this action", 403);
}

function routeFor(opts: Parameters<typeof createStandardsAlignmentRoutes>[0], method: string, path: string) {
  const route = createStandardsAlignmentRoutes(opts).find((r) => r.method === method && r.path === path);
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

describe("alignment view builders (T-0148)", () => {
  it("counts every shared status including license missing and reporting disabled", () => {
    const counts = countCompliance(ROWS.filter((r) => r.tenantId === TENANT_1));
    expect(counts.total).toBe(3);
    expect(counts.compliant).toBe(1);
    expect(counts.nonCompliant).toBe(1);
    expect(counts.licenseMissing).toBe(1);
    expect(counts.compliantPct).toBe(33.3);
  });

  it("builds the tenant summary view", () => {
    const summary = buildSummaryView(ROWS);
    expect(summary.map((r) => r.tenantId)).toEqual([TENANT_1, TENANT_2]);
    expect(summary[1]).toMatchObject({ reportingDisabled: 1, acceptedDeviation: 1, total: 2 });
  });

  it("builds the aggregate-by-standard view", () => {
    const aggregate = buildAggregateView(ROWS);
    expect(aggregate.map((r) => r.check)).toEqual(["CA-REPORTONLY-001", "ENTRA-PIM-001", "ENTRA-SECDEFAULT-001"]);
    const ca = aggregate.find((r) => r.check === "CA-REPORTONLY-001")!;
    expect(ca.total).toBe(2);
    expect(ca.nonCompliant).toBe(1);
    expect(ca.acceptedDeviation).toBe(1);
  });

  it("builds the by-standard view with current vs expected", () => {
    const view = buildByStandardView(ROWS);
    expect(view[0]).toMatchObject({
      tenantId: TENANT_1,
      check: "CA-REPORTONLY-001",
      state: "non-compliant",
      current: { v: 1 },
      expected: { v: 2 },
    });
  });
});

describe("GET /v1/standards/alignment (T-0148)", () => {
  it("defaults to the summary view", async () => {
    const route = routeFor(
      { store: new MemoryAlignmentStore(ROWS), resolveCaller: () => adminCaller(), authorize: allowAll },
      "GET",
      STANDARDS_ALIGNMENT_PATH,
    );
    const res = await route.handler(ctx("GET", STANDARDS_ALIGNMENT_PATH));
    expect(res.status).toBe(200);
    const body = res.body as { view: string; items: unknown[] };
    expect(body.view).toBe("summary");
    expect(body.items).toHaveLength(2);
  });

  it("serves each view", async () => {
    const route = routeFor(
      { store: new MemoryAlignmentStore(ROWS), resolveCaller: () => adminCaller(), authorize: allowAll },
      "GET",
      STANDARDS_ALIGNMENT_PATH,
    );
    for (const view of ALIGNMENT_VIEWS) {
      const res = await route.handler(ctx("GET", STANDARDS_ALIGNMENT_PATH, { query: { view } }));
      expect((res.body as { view: string }).view).toBe(view);
    }
  });

  it("filters by tenant and rejects an unknown view", async () => {
    const route = routeFor(
      { store: new MemoryAlignmentStore(ROWS), resolveCaller: () => adminCaller(), authorize: allowAll },
      "GET",
      STANDARDS_ALIGNMENT_PATH,
    );
    const filtered = await route.handler(
      ctx("GET", STANDARDS_ALIGNMENT_PATH, { query: { view: "by-standard", tenantId: TENANT_1 } }),
    );
    expect((filtered.body as { items: unknown[] }).items).toHaveLength(3);

    await expect(
      route.handler(ctx("GET", STANDARDS_ALIGNMENT_PATH, { query: { view: "nope" } })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("returns 403 for an out-of-scope tenant and 401 unauthenticated", async () => {
    const scoped = routeFor(
      {
        store: new MemoryAlignmentStore(ROWS),
        resolveCaller: () => ({ roles: ["operator"], tenantScope: tenantScope([TENANT_2]) }),
        authorize: allowAll,
      },
      "GET",
      STANDARDS_ALIGNMENT_PATH,
    );
    await expect(
      scoped.handler(ctx("GET", STANDARDS_ALIGNMENT_PATH, { query: { tenantId: TENANT_1 } })),
    ).rejects.toMatchObject({ status: 403 });

    const anon = routeFor(
      { store: new MemoryAlignmentStore(ROWS), resolveCaller: () => undefined },
      "GET",
      STANDARDS_ALIGNMENT_PATH,
    );
    await expect(anon.handler(ctx("GET", STANDARDS_ALIGNMENT_PATH))).rejects.toMatchObject({ status: 401 });
  });
});

describe("GET /v1/standards/compare/{tenantId} (T-0148)", () => {
  it("returns current vs expected per check with a summary", async () => {
    const route = routeFor(
      { store: new MemoryAlignmentStore(ROWS), resolveCaller: () => adminCaller(), authorize: allowAll },
      "GET",
      STANDARDS_COMPARE_PATH,
    );
    const res = await route.handler(
      ctx("GET", STANDARDS_COMPARE_PATH, { params: { tenantId: TENANT_1 } }),
    );
    expect(res.status).toBe(200);
    const body = res.body as {
      tenantId: string;
      summary: { total: number; licenseMissing: number };
      items: { check: string; current: unknown; expected: unknown }[];
    };
    expect(body.tenantId).toBe(TENANT_1);
    expect(body.summary.total).toBe(3);
    expect(body.summary.licenseMissing).toBe(1);
    expect(body.items.every((i) => "current" in i && "expected" in i)).toBe(true);
  });

  it("requires a tenant scope and denies a denied permission", async () => {
    const route = routeFor(
      {
        store: new MemoryAlignmentStore(ROWS),
        resolveCaller: () => ({ roles: ["operator"], tenantScope: tenantScope([TENANT_2]) }),
        authorize: allowAll,
      },
      "GET",
      STANDARDS_COMPARE_PATH,
    );
    await expect(
      route.handler(ctx("GET", STANDARDS_COMPARE_PATH, { params: { tenantId: TENANT_1 } })),
    ).rejects.toMatchObject({ status: 403 });

    const denied = routeFor(
      { store: new MemoryAlignmentStore(ROWS), resolveCaller: () => adminCaller(), authorize: denyAll },
      "GET",
      STANDARDS_COMPARE_PATH,
    );
    await expect(
      denied.handler(ctx("GET", STANDARDS_COMPARE_PATH, { params: { tenantId: TENANT_1 } })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("publishes both operations with the read permission", () => {
    expect(STANDARDS_ALIGNMENT_OPENAPI["/v1/standards/alignment"].get.permission).toBe("Tenant.Standards.Read");
    expect(STANDARDS_ALIGNMENT_OPENAPI["/v1/standards/compare/{tenantId}"].get.permission).toBe(
      "Tenant.Standards.Read",
    );
  });
});
