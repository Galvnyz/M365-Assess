import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { tenantScope } from "../rbac/scope.js";
import type { RequestContext } from "../server.js";
import {
  USER_TEMPLATES_OPENAPI,
  USER_TEMPLATE_PATH,
  USER_TEMPLATES_PATH,
  applyTemplateCreationDefaults,
  createUserTemplateRoutes,
  resolveTemplateMailboxAccess,
  type UserTemplateAuditEvent,
  type UserTemplateCaller,
  type UserTemplateRecord,
  type UserTemplateRouteOptions,
  type UserTemplateStore,
} from "./user-templates.js";

class FakeTemplateStore implements UserTemplateStore {
  private readonly templates = new Map<string, UserTemplateRecord>();

  async createUserTemplate(input: {
    id: string;
    name: string;
    properties: Record<string, unknown>;
    licenses: readonly string[];
    groups: readonly string[];
    offboardingDefaults: Record<string, unknown>;
  }): Promise<UserTemplateRecord> {
    const record: UserTemplateRecord = {
      ...input,
      licenses: [...input.licenses],
      groups: [...input.groups],
      createdAt: "2026-09-26T00:00:00.000Z",
      updatedAt: "2026-09-26T00:00:00.000Z",
      deletedAt: null,
    };
    this.templates.set(record.id, record);
    return record;
  }

  async getUserTemplate(templateId: string): Promise<UserTemplateRecord | undefined> {
    const existing = this.templates.get(templateId);
    return existing && existing.deletedAt === null ? existing : undefined;
  }

  async listUserTemplates(): Promise<readonly UserTemplateRecord[]> {
    return [...this.templates.values()].filter((template) => template.deletedAt === null);
  }

  async updateUserTemplate(
    templateId: string,
    update: {
      name?: string;
      properties?: Record<string, unknown>;
      licenses?: readonly string[];
      groups?: readonly string[];
      offboardingDefaults?: Record<string, unknown>;
    },
  ): Promise<UserTemplateRecord | undefined> {
    const existing = await this.getUserTemplate(templateId);
    if (!existing) return undefined;
    const updated: UserTemplateRecord = {
      ...existing,
      name: update.name ?? existing.name,
      properties: update.properties ?? existing.properties,
      licenses: update.licenses ? [...update.licenses] : existing.licenses,
      groups: update.groups ? [...update.groups] : existing.groups,
      offboardingDefaults: update.offboardingDefaults ?? existing.offboardingDefaults,
      updatedAt: "2026-09-26T00:00:01.000Z",
    };
    this.templates.set(templateId, updated);
    return updated;
  }

  async softDeleteUserTemplate(templateId: string): Promise<boolean> {
    const existing = await this.getUserTemplate(templateId);
    if (!existing) return false;
    this.templates.set(templateId, { ...existing, deletedAt: "2026-09-26T00:00:02.000Z" });
    return true;
  }
}

function callerFor(): UserTemplateCaller {
  return { roles: [], tenantScope: tenantScope(["tenant-a"]) };
}

function optionsFor(
  caller: UserTemplateCaller | undefined,
  allowed: boolean,
  overrides: Partial<UserTemplateRouteOptions> = {},
): {
  store: FakeTemplateStore;
  audits: UserTemplateAuditEvent[];
  routes: ReturnType<typeof createUserTemplateRoutes>;
} {
  const store = new FakeTemplateStore();
  const audits: UserTemplateAuditEvent[] = [];
  let counter = 0;
  const routes = createUserTemplateRoutes({
    store,
    resolveCaller: () => caller,
    authorize: async (_caller, permission) => {
      if (!allowed || !permission.startsWith("users.")) {
        throw new AppError("auth.forbidden", "not permitted to perform this action", 403);
      }
    },
    readBody: (ctx) => (ctx as { body?: unknown }).body,
    recordAudit: async (event) => {
      audits.push(event);
    },
    idGenerator: () => `template-${(counter += 1)}`,
    now: () => "2026-09-26T00:00:00.000Z",
    ...overrides,
  });
  return { store, audits, routes };
}

function context(method: string, path: string, params: Record<string, string>, body?: unknown): RequestContext {
  return {
    correlationId: "correlation-1",
    method,
    path,
    query: new URLSearchParams(),
    headers: {},
    params,
    body,
  } as RequestContext;
}

const TEMPLATE_BODY = {
  name: "Standard starter",
  properties: { usageLocation: "US", department: "Engineering" },
  licenses: ["sku-1"],
  groups: ["group-1"],
  offboardingDefaults: {
    disableSignIn: true,
    mailboxAccess: { mode: "full", automap: false },
  },
};

describe("user templates routes (T-0208)", () => {
  it("publishes the template CRUD operations", () => {
    expect(USER_TEMPLATES_PATH).toBe("/v1/user-templates");
    expect(USER_TEMPLATE_PATH).toBe("/v1/user-templates/:id");
    expect(USER_TEMPLATES_OPENAPI.paths["/user-templates"].post.operationId).toBe("createUserTemplate");
    expect(USER_TEMPLATES_OPENAPI.paths["/user-templates/{id}"].delete.operationId).toBe("deleteUserTemplate");
  });

  it("creates a template with defaults and audits the write", async () => {
    const { audits, routes } = optionsFor(callerFor(), true);
    const handler = routes.find((route) => route.method === "POST")?.handler;
    if (!handler) throw new Error("template POST handler is missing");

    const response = await handler(context("POST", "/v1/user-templates", {}, TEMPLATE_BODY));

    expect(response.status).toBe(201);
    const body = response.body as UserTemplateRecord;
    expect(body.id).toBe("template-1");
    expect(body.licenses).toEqual(["sku-1"]);
    expect(body.offboardingDefaults).toMatchObject({ disableSignIn: true });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "user-templates.create", targetId: "template-1" });
  });

  it("round-trips properties, licenses, groups, and offboarding defaults", async () => {
    const { routes } = optionsFor(callerFor(), true);
    const post = routes.find((route) => route.method === "POST")?.handler;
    const get = routes.find((route) => route.method === "GET" && route.path === USER_TEMPLATE_PATH)?.handler;
    if (!post || !get) throw new Error("template handlers are missing");

    const created = (await post(context("POST", "/v1/user-templates", {}, TEMPLATE_BODY))).body as UserTemplateRecord;
    const fetched = (await get(context("GET", `/v1/user-templates/${created.id}`, { id: created.id }))).body as UserTemplateRecord;

    expect(fetched).toEqual(created);
    expect(fetched.groups).toEqual(["group-1"]);
  });

  it("lists templates and hides soft-deleted ones", async () => {
    const { routes } = optionsFor(callerFor(), true);
    const post = routes.find((route) => route.method === "POST")?.handler;
    const list = routes.find((route) => route.method === "GET" && route.path === USER_TEMPLATES_PATH)?.handler;
    const remove = routes.find((route) => route.method === "DELETE")?.handler;
    if (!post || !list || !remove) throw new Error("template handlers are missing");

    await post(context("POST", "/v1/user-templates", {}, TEMPLATE_BODY));
    await post(context("POST", "/v1/user-templates", {}, { ...TEMPLATE_BODY, name: "Second" }));
    const before = (await list(context("GET", "/v1/user-templates", {}))).body as { templates: unknown[] };
    expect(before.templates).toHaveLength(2);
    await remove(context("DELETE", "/v1/user-templates/template-1", { id: "template-1" }));
    const after = (await list(context("GET", "/v1/user-templates", {}))).body as { templates: unknown[] };
    expect(after.templates).toHaveLength(1);
  });

  it("patches a template and returns 404 for a missing id", async () => {
    const { routes } = optionsFor(callerFor(), true);
    const post = routes.find((route) => route.method === "POST")?.handler;
    const patch = routes.find((route) => route.method === "PATCH")?.handler;
    if (!post || !patch) throw new Error("template handlers are missing");

    await post(context("POST", "/v1/user-templates", {}, TEMPLATE_BODY));
    const updated = (await patch(
      context("PATCH", "/v1/user-templates/template-1", { id: "template-1" }, { licenses: ["sku-2"] }),
    )).body as UserTemplateRecord;
    expect(updated.licenses).toEqual(["sku-2"]);
    expect(updated.name).toBe("Standard starter");

    await expect(
      patch(context("PATCH", "/v1/user-templates/missing", { id: "missing" }, { name: "X" })),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects an unknown offboarding default and a bad mailbox access mode", async () => {
    const { routes } = optionsFor(callerFor(), true);
    const handler = routes.find((route) => route.method === "POST")?.handler;
    if (!handler) throw new Error("template POST handler is missing");

    await expect(
      handler(context("POST", "/v1/user-templates", {}, { ...TEMPLATE_BODY, offboardingDefaults: { wipeEverything: true } })),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      handler(
        context("POST", "/v1/user-templates", {}, { ...TEMPLATE_BODY, offboardingDefaults: { mailboxAccess: { mode: "owner" } } }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("requires authentication and the users permission", async () => {
    const denied = optionsFor(callerFor(), false);
    const post = denied.routes.find((route) => route.method === "POST")?.handler;
    if (!post) throw new Error("template POST handler is missing");
    await expect(post(context("POST", "/v1/user-templates", {}, TEMPLATE_BODY))).rejects.toMatchObject({
      status: 403,
    });

    const anonymous = optionsFor(undefined, true);
    const anonymousPost = anonymous.routes.find((route) => route.method === "POST")?.handler;
    if (!anonymousPost) throw new Error("template POST handler is missing");
    await expect(anonymousPost(context("POST", "/v1/user-templates", {}, TEMPLATE_BODY))).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe("template default resolution (T-0208)", () => {
  const template: UserTemplateRecord = {
    id: "template-1",
    name: "Standard starter",
    properties: { usageLocation: "US", department: "Engineering" },
    licenses: ["sku-1", "sku-2"],
    groups: ["group-1"],
    offboardingDefaults: { mailboxAccess: { mode: "send-as", automap: true } },
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
    deletedAt: null,
  };

  it("seeds usage location, licenses, and groups from the template", () => {
    expect(applyTemplateCreationDefaults(template, {})).toEqual({
      usageLocation: "US",
      licenses: ["sku-1", "sku-2"],
      groups: ["group-1"],
    });
  });

  it("lets the row win and unions multi-value defaults", () => {
    expect(
      applyTemplateCreationDefaults(template, { usageLocation: "GB", licenses: ["sku-3"], groups: [] }),
    ).toEqual({ usageLocation: "GB", licenses: ["sku-3", "sku-1", "sku-2"], groups: ["group-1"] });
  });

  it("falls back to empty defaults without a template", () => {
    expect(applyTemplateCreationDefaults(null, {})).toEqual({ usageLocation: "", licenses: [], groups: [] });
  });

  it("resolves the template mailbox access mode unless the wizard overrides it", () => {
    expect(resolveTemplateMailboxAccess(template)).toEqual({ mode: "send-as", automap: true });
    expect(resolveTemplateMailboxAccess(template, { mode: "full" })).toEqual({ mode: "full", automap: true });
    expect(resolveTemplateMailboxAccess(null)).toEqual({ mode: "full", automap: false });
  });
});
