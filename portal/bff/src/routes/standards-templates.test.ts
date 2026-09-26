// T-0143 — standards template CRUD, clone, and convert APIs.
// Route-level tests over an in-memory store; RBAC/scope via stubbed seams.

import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { ALL_TENANTS, tenantScope } from "../rbac/scope.js";
import { RbacErrorCodes, type Caller } from "../rbac/authorize.js";
import type { RequestContext } from "../server.js";
import {
  STANDARDS_INVALID_KIND_CONVERSION,
  STANDARDS_PERMISSIONS,
  STANDARDS_TEMPLATE_CLONE_PATH,
  STANDARDS_TEMPLATE_DETAIL_PATH,
  STANDARDS_TEMPLATE_NOT_FOUND,
  STANDARDS_TEMPLATES_OPENAPI,
  STANDARDS_TEMPLATES_PATH,
  createStandardsTemplateRoutes,
  isKindConversionLegal,
  type CreateTemplateInput,
  type StandardTemplateRecord,
  type StandardsTemplateStore,
  type TemplateAssignmentRecord,
  type UpdateTemplatePatch,
  type UpsertAssignmentInput,
} from "./standards-templates.js";

const TENANT_1 = "11111111-1111-1111-1111-111111111111";
const TENANT_2 = "22222222-2222-2222-2222-222222222222";

class MemoryTemplateStore implements StandardsTemplateStore {
  readonly templates = new Map<string, StandardTemplateRecord>();
  readonly assignments: TemplateAssignmentRecord[] = [];

  async listStandardTemplates(): Promise<readonly StandardTemplateRecord[]> {
    return [...this.templates.values()];
  }

  async getStandardTemplate(id: string): Promise<StandardTemplateRecord | undefined> {
    return this.templates.get(id);
  }

  async createStandardTemplate(input: CreateTemplateInput): Promise<StandardTemplateRecord> {
    const template: StandardTemplateRecord = {
      id: input.id,
      name: input.name,
      kind: input.kind,
      actions: { report: true, alert: true, remediate: false, ...(input.actions ?? {}) },
      autoRemediate: input.autoRemediate ?? false,
      settings: input.settings ?? [],
      scheduleId: input.scheduleId ?? null,
    };
    this.templates.set(template.id, template);
    return template;
  }

  async updateStandardTemplate(
    id: string,
    patch: UpdateTemplatePatch,
  ): Promise<StandardTemplateRecord | undefined> {
    const existing = this.templates.get(id);
    if (!existing) return undefined;
    const updated: StandardTemplateRecord = {
      ...existing,
      name: patch.name ?? existing.name,
      kind: patch.kind ?? existing.kind,
      actions: { ...existing.actions, ...(patch.actions ?? {}) },
      autoRemediate: patch.autoRemediate ?? existing.autoRemediate,
      settings: patch.settings ?? existing.settings,
      scheduleId: patch.scheduleId === undefined ? existing.scheduleId : patch.scheduleId,
    };
    this.templates.set(id, updated);
    return updated;
  }

  async deleteStandardTemplate(id: string): Promise<boolean> {
    return this.templates.delete(id);
  }

  async listTemplateAssignments(): Promise<readonly TemplateAssignmentRecord[]> {
    return this.assignments;
  }

  async upsertTemplateAssignment(input: UpsertAssignmentInput): Promise<TemplateAssignmentRecord> {
    const assignment: TemplateAssignmentRecord = {
      templateId: input.templateId,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      precedence: input.precedence ?? 0,
    };
    this.assignments.push(assignment);
    return assignment;
  }
}

function adminCaller(): Caller {
  return { roles: ["admin"], tenantScope: ALL_TENANTS };
}

function allowAll(): void {}
function denyAll(): void {
  throw new AppError(RbacErrorCodes.forbidden, "not permitted to perform this action", 403);
}

let seq = 0;
function makeOptions(store: StandardsTemplateStore, overrides: Record<string, unknown> = {}) {
  seq = 0;
  return {
    store,
    resolveCaller: () => adminCaller(),
    authorize: allowAll,
    idGenerator: () => `id-${(seq += 1)}`,
    ...overrides,
  };
}

function routeFor(opts: Parameters<typeof createStandardsTemplateRoutes>[0], method: string, path: string) {
  const route = createStandardsTemplateRoutes(opts).find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`route not found: ${method} ${path}`);
  return route;
}

function ctx(
  method: string,
  path: string,
  options: { params?: Record<string, string>; body?: Record<string, unknown>; query?: Record<string, string> } = {},
): RequestContext & { body?: unknown } {
  return {
    correlationId: "corr-1",
    method,
    path,
    query: new URLSearchParams(options.query ?? {}),
    headers: {},
    params: options.params ?? {},
    body: options.body,
  };
}

function seed(store: MemoryTemplateStore): void {
  store.templates.set("tpl-1", {
    id: "tpl-1",
    name: "Baseline",
    kind: "standards",
    actions: { report: true, alert: true, remediate: false },
    autoRemediate: false,
    settings: [{ key: "mfa", value: "required" }],
    scheduleId: null,
  });
}

describe("standards template CRUD (T-0143)", () => {
  it("creates a report-only template by default", async () => {
    const store = new MemoryTemplateStore();
    const route = routeFor(makeOptions(store), "POST", STANDARDS_TEMPLATES_PATH);
    const res = await route.handler(ctx("POST", STANDARDS_TEMPLATES_PATH, { body: { name: "New" } }));

    expect(res.status).toBe(201);
    const template = (res.body as { template: StandardTemplateRecord }).template;
    expect(template.kind).toBe("standards");
    expect(template.actions).toEqual({ report: true, alert: true, remediate: false });
    expect(template.autoRemediate).toBe(false);
  });

  it("lists templates and filters by kind", async () => {
    const store = new MemoryTemplateStore();
    seed(store);
    await store.createStandardTemplate({ id: "tpl-2", name: "Drift", kind: "drift" });

    const route = routeFor(makeOptions(store), "GET", STANDARDS_TEMPLATES_PATH);
    const all = await route.handler(ctx("GET", STANDARDS_TEMPLATES_PATH));
    expect((all.body as { items: unknown[] }).items).toHaveLength(2);

    const drift = await route.handler(ctx("GET", STANDARDS_TEMPLATES_PATH, { query: { kind: "drift" } }));
    const items = (drift.body as { items: { id: string }[] }).items;
    expect(items.map((t) => t.id)).toEqual(["tpl-2"]);
  });

  it("reads, patches, and deletes a template", async () => {
    const store = new MemoryTemplateStore();
    seed(store);

    const get = routeFor(makeOptions(store), "GET", STANDARDS_TEMPLATE_DETAIL_PATH);
    expect(((await get.handler(ctx("GET", STANDARDS_TEMPLATE_DETAIL_PATH, { params: { templateId: "tpl-1" } }))).body as { template: { name: string } }).template.name).toBe("Baseline");

    const patch = routeFor(makeOptions(store), "PATCH", STANDARDS_TEMPLATE_DETAIL_PATH);
    const patched = await patch.handler(
      ctx("PATCH", STANDARDS_TEMPLATE_DETAIL_PATH, {
        params: { templateId: "tpl-1" },
        body: { name: "Renamed", autoRemediate: true, actions: { remediate: true } },
      }),
    );
    const template = (patched.body as { template: StandardTemplateRecord }).template;
    expect(template.name).toBe("Renamed");
    expect(template.actions.remediate).toBe(true);

    const del = routeFor(makeOptions(store), "DELETE", STANDARDS_TEMPLATE_DETAIL_PATH);
    expect((await del.handler(ctx("DELETE", STANDARDS_TEMPLATE_DETAIL_PATH, { params: { templateId: "tpl-1" } }))).status).toBe(204);
    expect(store.templates.has("tpl-1")).toBe(false);
  });

  it("returns 404 for an unknown template", async () => {
    const store = new MemoryTemplateStore();
    const get = routeFor(makeOptions(store), "GET", STANDARDS_TEMPLATE_DETAIL_PATH);
    await expect(get.handler(ctx("GET", STANDARDS_TEMPLATE_DETAIL_PATH, { params: { templateId: "nope" } }))).rejects.toMatchObject({
      status: 404,
      code: STANDARDS_TEMPLATE_NOT_FOUND,
    });
  });

  it("requires a name and a valid kind", async () => {
    const store = new MemoryTemplateStore();
    const create = routeFor(makeOptions(store), "POST", STANDARDS_TEMPLATES_PATH);
    await expect(create.handler(ctx("POST", STANDARDS_TEMPLATES_PATH, { body: {} }))).rejects.toMatchObject({ status: 400 });
    await expect(
      create.handler(ctx("POST", STANDARDS_TEMPLATES_PATH, { body: { name: "X", kind: "bogus" } })),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("clone and convert (T-0143)", () => {
  it("clones a template into an independent copy", async () => {
    const store = new MemoryTemplateStore();
    seed(store);
    store.assignments.push({ templateId: "tpl-1", targetType: "tenant", targetId: "contoso", precedence: 1 });

    const route = routeFor(makeOptions(store), "POST", STANDARDS_TEMPLATE_CLONE_PATH);
    const res = await route.handler(
      ctx("POST", STANDARDS_TEMPLATE_CLONE_PATH, { params: { templateId: "tpl-1" }, body: { includeAssignments: true } }),
    );

    expect(res.status).toBe(201);
    const clone = (res.body as { template: StandardTemplateRecord }).template;
    expect(clone.id).toBe("id-1");
    expect(clone.name).toBe("Baseline (copy)");
    expect(clone.settings).toEqual([{ key: "mfa", value: "required" }]);

    // Independent: editing the clone leaves the source unchanged.
    await store.updateStandardTemplate(clone.id, { name: "Changed" });
    expect(store.templates.get("tpl-1")?.name).toBe("Baseline");

    // Assignment optionally duplicated onto the clone.
    expect(store.assignments.some((a) => a.templateId === clone.id && a.targetId === "contoso")).toBe(true);
  });

  it("allows a report-only template to convert to drift, and rejects a remediating one", async () => {
    const store = new MemoryTemplateStore();
    seed(store);
    const patch = routeFor(makeOptions(store), "PATCH", STANDARDS_TEMPLATE_DETAIL_PATH);

    // report-only -> drift is legal.
    const converted = await patch.handler(
      ctx("PATCH", STANDARDS_TEMPLATE_DETAIL_PATH, { params: { templateId: "tpl-1" }, body: { kind: "drift" } }),
    );
    expect((converted.body as { template: StandardTemplateRecord }).template.kind).toBe("drift");

    // A remediating standards template cannot become a drift template.
    await store.createStandardTemplate({
      id: "tpl-remediate",
      name: "Remediating",
      kind: "standards",
      actions: { report: true, alert: true, remediate: true },
    });
    await expect(
      patch.handler(
        ctx("PATCH", STANDARDS_TEMPLATE_DETAIL_PATH, {
          params: { templateId: "tpl-remediate" },
          body: { kind: "drift" },
        }),
      ),
    ).rejects.toMatchObject({ status: 422, code: STANDARDS_INVALID_KIND_CONVERSION });
  });

  it("validates convert legality rules directly", () => {
    const reportOnly = { kind: "standards" as const, actions: { report: true, alert: true, remediate: false }, autoRemediate: false };
    expect(isKindConversionLegal(reportOnly, "drift")).toBe(true);
    expect(isKindConversionLegal({ ...reportOnly, autoRemediate: true }, "drift")).toBe(false);
    expect(isKindConversionLegal({ ...reportOnly, kind: "drift" }, "standards")).toBe(true);
    expect(isKindConversionLegal(reportOnly, "standards")).toBe(true);
  });
});

describe("RBAC and tenant scope (T-0143)", () => {
  it("rejects a read without standards.read", async () => {
    const route = routeFor(makeOptions(new MemoryTemplateStore(), { authorize: denyAll }), "GET", STANDARDS_TEMPLATES_PATH);
    await expect(route.handler(ctx("GET", STANDARDS_TEMPLATES_PATH))).rejects.toMatchObject({ status: 403 });
  });

  it("rejects a mutation without standards.write", async () => {
    const route = routeFor(makeOptions(new MemoryTemplateStore(), { authorize: denyAll }), "POST", STANDARDS_TEMPLATES_PATH);
    await expect(
      route.handler(ctx("POST", STANDARDS_TEMPLATES_PATH, { body: { name: "X" } })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("returns a structured 403 for an out-of-scope tenant", async () => {
    const store = new MemoryTemplateStore();
    const route = routeFor(
      makeOptions(store, { resolveCaller: () => ({ roles: ["operator"], tenantScope: tenantScope([TENANT_2]) }) }),
      "POST",
      STANDARDS_TEMPLATES_PATH,
    );
    await expect(
      route.handler(ctx("POST", STANDARDS_TEMPLATES_PATH, { body: { name: "X", tenantId: TENANT_1 } })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("returns 401 without an authenticated caller", async () => {
    const route = routeFor(makeOptions(new MemoryTemplateStore(), { resolveCaller: () => undefined }), "GET", STANDARDS_TEMPLATES_PATH);
    await expect(route.handler(ctx("GET", STANDARDS_TEMPLATES_PATH))).rejects.toMatchObject({ status: 401 });
  });
});

describe("route set and OpenAPI (T-0143)", () => {
  it("exposes the CRUD (incl. read-one) and clone endpoints", () => {
    const keys = createStandardsTemplateRoutes(makeOptions(new MemoryTemplateStore()))
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(keys).toEqual(
      [
        `GET ${STANDARDS_TEMPLATES_PATH}`,
        `POST ${STANDARDS_TEMPLATES_PATH}`,
        `GET ${STANDARDS_TEMPLATE_DETAIL_PATH}`,
        `PATCH ${STANDARDS_TEMPLATE_DETAIL_PATH}`,
        `DELETE ${STANDARDS_TEMPLATE_DETAIL_PATH}`,
        `POST ${STANDARDS_TEMPLATE_CLONE_PATH}`,
      ].sort(),
    );
  });

  it("publishes read/write permissions matching the implementation", () => {
    expect(STANDARDS_TEMPLATES_OPENAPI["/v1/standards/templates"].get.permission).toBe(
      STANDARDS_PERMISSIONS.read,
    );
    expect(STANDARDS_TEMPLATES_OPENAPI["/v1/standards/templates"].post.permission).toBe(
      STANDARDS_PERMISSIONS.write,
    );
    expect(STANDARDS_TEMPLATES_OPENAPI["/v1/standards/templates/{templateId}"].patch.permission).toBe(
      STANDARDS_PERMISSIONS.write,
    );
    expect(
      STANDARDS_TEMPLATES_OPENAPI["/v1/standards/templates/{templateId}/clone"].post.permission,
    ).toBe(STANDARDS_PERMISSIONS.write);
  });
});
