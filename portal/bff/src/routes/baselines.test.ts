// T-0182 — baseline CRUD, assignment, and save gate.
import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { ALL_TENANTS, tenantScope } from "../rbac/scope.js";
import { RbacErrorCodes, type Caller } from "../rbac/authorize.js";
import type { RequestContext } from "../server.js";
import {
  BASELINES_OPENAPI,
  BASELINES_PATH,
  BASELINE_ASSIGN_PATH,
  BASELINE_DETAIL_PATH,
  createBaselinesRoutes,
  type BaselineAssignmentRecord,
  type BaselineRecord,
  type BaselinesStore,
  type CreateBaselineInput,
  type UpdateBaselinePatch,
} from "./baselines.js";

const TENANT = "contoso";

function savableBody() {
  return {
    name: "Server baseline",
    stages: [{ order: 0, conditions: [{ key: "CA-REPORTONLY-001", expected: 1 }], action: "report" }],
    assignments: [{ targetType: "tenant", targetId: TENANT, precedence: 0 }],
  };
}

class MemoryBaselinesStore implements BaselinesStore {
  private readonly rows = new Map<string, BaselineRecord>();
  private readonly assignments = new Map<string, BaselineAssignmentRecord[]>();
  private counter = 0;

  async listBaselines(): Promise<readonly BaselineRecord[]> {
    return [...this.rows.values()];
  }

  async getBaseline(baselineId: string): Promise<BaselineRecord | undefined> {
    return this.rows.get(baselineId);
  }

  async createBaseline(input: CreateBaselineInput): Promise<BaselineRecord> {
    const id = input.id ?? `bl-${(this.counter += 1)}`;
    const now = new Date().toISOString();
    const record: BaselineRecord = {
      id,
      name: input.name,
      logic: "and",
      alerting: input.alerting ?? { enabled: false },
      enabled: input.enabled ?? true,
      stages: [...(input.stages ?? [])],
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(id, record);
    this.assignments.set(
      id,
      (input.assignments ?? []).map((assignment) => ({ baselineId: id, ...assignment })),
    );
    return record;
  }

  async updateBaseline(
    baselineId: string,
    patch: UpdateBaselinePatch,
  ): Promise<BaselineRecord | undefined> {
    const existing = this.rows.get(baselineId);
    if (!existing) return undefined;
    const updated: BaselineRecord = {
      ...existing,
      name: patch.name ?? existing.name,
      alerting: patch.alerting ?? existing.alerting,
      enabled: patch.enabled ?? existing.enabled,
      stages: patch.stages ? [...patch.stages] : existing.stages,
      updatedAt: new Date().toISOString(),
    };
    this.rows.set(baselineId, updated);
    if (patch.assignments) {
      this.assignments.set(
        baselineId,
        patch.assignments.map((assignment) => ({ baselineId, ...assignment })),
      );
    }
    return updated;
  }

  async deleteBaseline(baselineId: string): Promise<boolean> {
    return this.rows.delete(baselineId);
  }

  async listBaselineAssignments(baselineId: string): Promise<readonly BaselineAssignmentRecord[]> {
    return this.assignments.get(baselineId) ?? [];
  }

  async setBaselineAssignments(
    baselineId: string,
    assignments: readonly Omit<BaselineAssignmentRecord, "baselineId">[],
  ): Promise<readonly BaselineAssignmentRecord[]> {
    const rows = assignments.map((assignment) => ({ baselineId, ...assignment }));
    this.assignments.set(baselineId, rows);
    return rows;
  }
}

function adminCaller(): Caller {
  return { roles: ["admin"], tenantScope: ALL_TENANTS };
}

function scopedCaller(): Caller {
  return { roles: ["admin"], tenantScope: tenantScope([TENANT]) };
}

function allowAll(): void {}
function denyAll(): void {
  throw new AppError(RbacErrorCodes.forbidden, "not permitted to perform this action", 403);
}

interface CtxOptions {
  params?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
}

function ctx(options: CtxOptions = {}): RequestContext & { body?: unknown } {
  const query = new Map<string, string>(Object.entries(options.query ?? {}));
  return {
    method: "POST",
    path: BASELINES_PATH,
    params: options.params ?? {},
    query,
    headers: {},
    correlationId: "test-correlation",
    body: options.body,
  };
}

function routesFor(store: BaselinesStore, caller: Caller, authorize: (caller: Caller, permission: string) => void = allowAll) {
  return createBaselinesRoutes({ store, resolveCaller: () => caller, authorize });
}

function routeFor(routes: ReturnType<typeof createBaselinesRoutes>, method: string, path: string) {
  const route = routes.find((entry) => entry.method === method && entry.path === path);
  if (!route) throw new Error(`route ${method} ${path} not registered`);
  return route;
}

describe("baselines CRUD (T-0182)", () => {
  it("creates, reads, updates, and deletes a baseline", async () => {
    const store = new MemoryBaselinesStore();
    const routes = routesFor(store, adminCaller());

    const created = await routeFor(routes, "POST", BASELINES_PATH).handler(ctx({ body: savableBody() }));
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;

    const listed = await routeFor(routes, "GET", BASELINES_PATH).handler(ctx());
    expect((listed.body as { items: unknown[] }).items).toHaveLength(1);

    const detail = await routeFor(routes, "GET", BASELINE_DETAIL_PATH).handler(
      ctx({ params: { baselineId: id } }),
    );
    expect((detail.body as { name: string }).name).toBe("Server baseline");

    const updated = await routeFor(routes, "PATCH", BASELINE_DETAIL_PATH).handler(
      ctx({ params: { baselineId: id }, body: { name: "Renamed" } }),
    );
    expect((updated.body as { name: string }).name).toBe("Renamed");

    const deleted = await routeFor(routes, "DELETE", BASELINE_DETAIL_PATH).handler(
      ctx({ params: { baselineId: id } }),
    );
    expect(deleted.status).toBe(200);
  });

  it("rejects a save without a name, an assignment, or a staged standard", async () => {
    const store = new MemoryBaselinesStore();
    const routes = routesFor(store, adminCaller());

    for (const body of [
      { ...savableBody(), name: "  " },
      { ...savableBody(), assignments: [] },
      { ...savableBody(), stages: [] },
    ]) {
      let code = "";
      try {
        await routeFor(routes, "POST", BASELINES_PATH).handler(ctx({ body }));
      } catch (error) {
        code = (error as AppError).code;
      }
      expect(code).toBe("baseline.save_blocked");
    }
  });

  it("replaces assignments and validates tenant scope", async () => {
    const store = new MemoryBaselinesStore();
    const routes = routesFor(store, scopedCaller());

    const created = await routeFor(routes, "POST", BASELINES_PATH).handler(ctx({ body: savableBody() }));
    const id = (created.body as { id: string }).id;

    // Out-of-scope tenant assignment is rejected.
    let code = "";
    try {
      await routeFor(routes, "POST", BASELINE_ASSIGN_PATH).handler(
        ctx({
          params: { baselineId: id },
          body: { assignments: [{ targetType: "tenant", targetId: "fabrikam" }] },
        }),
      );
    } catch (error) {
      code = (error as AppError).code;
    }
    expect(code).toBe(RbacErrorCodes.forbidden);

    const assigned = await routeFor(routes, "POST", BASELINE_ASSIGN_PATH).handler(
      ctx({
        params: { baselineId: id },
        body: { assignments: [{ targetType: "group", targetId: "g-1" }] },
      }),
    );
    expect(assigned.status).toBe(200);
    expect((assigned.body as { assignments: unknown[] }).assignments).toHaveLength(1);
  });

  it("denies mutations without baselines.write", async () => {
    const store = new MemoryBaselinesStore();
    const routes = routesFor(store, adminCaller(), denyAll);
    let code = "";
    try {
      await routeFor(routes, "POST", BASELINES_PATH).handler(ctx({ body: savableBody() }));
    } catch (error) {
      code = (error as AppError).code;
    }
    expect(code).toBe(RbacErrorCodes.forbidden);
  });

  it("returns 404 for unknown baselines", async () => {
    const store = new MemoryBaselinesStore();
    const routes = routesFor(store, adminCaller());
    let code = "";
    try {
      await routeFor(routes, "GET", BASELINE_DETAIL_PATH).handler(ctx({ params: { baselineId: "nope" } }));
    } catch (error) {
      code = (error as AppError).code;
    }
    expect(code).toBe("baseline.not_found");
  });
});

describe("baselines OpenAPI (T-0182)", () => {
  it("documents CRUD and assign", () => {
    expect(Object.keys(BASELINES_OPENAPI)).toEqual(
      expect.arrayContaining(["/v1/baselines", "/v1/baselines/{baselineId}", "/v1/baselines/{baselineId}/assign"]),
    );
  });
});
