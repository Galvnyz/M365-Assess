// T-0189 — migrate from standards.
import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { ALL_TENANTS } from "../rbac/scope.js";
import { type Caller } from "../rbac/authorize.js";
import type { RequestContext } from "../server.js";
import {
  BASELINE_MIGRATE_OPENAPI,
  BASELINE_MIGRATE_PATH,
  createBaselinesMigrateRoutes,
  type MigrateSourceTemplate,
  type MigrateStore,
} from "./baselines-migrate.js";
import type { BaselineRecord } from "./baselines.js";

function template(overrides: Partial<MigrateSourceTemplate> = {}): MigrateSourceTemplate {
  return {
    id: "tpl-1",
    name: "Server standard",
    kind: "standards",
    settings: [
      { key: "CA-REPORTONLY-001", value: 1 },
      { key: "EXO-SHARING-001", value: 2 },
    ],
    assignments: [{ targetType: "tenant", targetId: "contoso", precedence: 0 }],
    ...overrides,
  };
}

class MemoryMigrateStore implements MigrateStore {
  readonly templates = new Map<string, MigrateSourceTemplate>([["tpl-1", template()]]);
  created: BaselineRecord[] = [];
  private counter = 0;

  async getSourceTemplate(templateId: string): Promise<MigrateSourceTemplate | undefined> {
    return this.templates.get(templateId);
  }

  async createBaseline(input: {
    name: string;
    stages: BaselineRecord["stages"];
    assignments: readonly { targetType: "allTenants" | "group" | "tenant"; targetId: string | null; precedence: number }[];
  }): Promise<BaselineRecord> {
    const now = new Date().toISOString();
    const record: BaselineRecord = {
      id: `bl-${(this.counter += 1)}`,
      logic: "and",
      alerting: { enabled: false },
      enabled: true,
      stages: [...input.stages],
      createdAt: now,
      updatedAt: now,
      ...input,
    };
    this.created.push(record);
    return record;
  }
}

function ctx(templateId: string, body?: unknown): RequestContext & { body?: unknown } {
  return {
    method: "POST",
    path: BASELINE_MIGRATE_PATH,
    params: { baselineId: templateId },
    query: new Map(),
    headers: {},
    correlationId: "test-correlation",
    body,
  };
}

function setup(store: MemoryMigrateStore) {
  const routes = createBaselinesMigrateRoutes({
    store,
    resolveCaller: () => ({ roles: ["admin"], tenantScope: ALL_TENANTS }) as Caller,
    authorize: () => {},
  });
  return routes[0]!.handler;
}

describe("migrate from standards (T-0189)", () => {
  it("produces a staged baseline from the template settings", async () => {
    const store = new MemoryMigrateStore();
    const response = await setup(store)(ctx("tpl-1"));
    expect(response.status).toBe(201);
    const baseline = (response.body as { baseline: BaselineRecord }).baseline;
    expect(baseline.stages).toHaveLength(1);
    expect(baseline.stages[0]?.conditions.map((condition) => condition.key)).toEqual([
      "CA-REPORTONLY-001",
      "EXO-SHARING-001",
    ]);
    expect(baseline.name).toContain("Server standard");
  });

  it("leaves the source template unchanged and passes the save gate", async () => {
    const store = new MemoryMigrateStore();
    await setup(store)(ctx("tpl-1", { name: "Custom name" }));
    // Source untouched: same settings, same assignments.
    expect(store.templates.get("tpl-1")?.settings).toHaveLength(2);
    const created = store.created[0]!;
    expect(created.name).toBe("Custom name");
    expect(created.stages[0]?.conditions.length).toBeGreaterThan(0);
  });

  it("rejects drift-kind templates with a structured error", async () => {
    const store = new MemoryMigrateStore();
    store.templates.set("tpl-drift", template({ id: "tpl-drift", kind: "drift" }));
    let code = "";
    try {
      await setup(store)(ctx("tpl-drift"));
    } catch (error) {
      code = (error as AppError).code;
    }
    expect(code).toBe("baseline.migrate_drift_not_allowed");
    expect(store.created).toHaveLength(0);
  });

  it("returns 404 for an unknown template", async () => {
    const store = new MemoryMigrateStore();
    let code = "";
    try {
      await setup(store)(ctx("missing"));
    } catch (error) {
      code = (error as AppError).code;
    }
    expect(code).toBe("baseline.migrate_template_not_found");
  });

  it("documents the migrate endpoint", () => {
    expect(Object.keys(BASELINE_MIGRATE_OPENAPI)).toEqual(["/v1/baselines/{id}/migrate-from-standards"]);
  });
});
