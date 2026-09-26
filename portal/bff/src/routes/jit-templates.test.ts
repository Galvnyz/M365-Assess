import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import type { JitTemplatesRepository } from "../../../db/src/jit-templates-repository.js";
import type {
  JitAdminTemplate,
  JitAdminTemplateInput,
  JitAdminTemplateUpdate,
  JitGrant,
} from "../../../db/src/repository.js";
import {
  JIT_ROLE_NOT_ALLOWED,
  JIT_TEMPLATES_PATH,
  JIT_TEMPLATE_IN_USE,
  ROLES_READ_PERMISSION,
  ROLES_WRITE_PERMISSION,
  createJitTemplatesRoutes,
  validateGrantAgainstTemplate,
} from "./jit-templates.js";

class InMemoryJitTemplatesRepository implements JitTemplatesRepository {
  readonly schemaVersion = 75;
  private readonly store = new Map<string, JitAdminTemplate>();

  close(): void {}

  async createTemplate(input: JitAdminTemplateInput): Promise<JitAdminTemplate> {
    const now = new Date().toISOString();
    const item: JitAdminTemplate = {
      id: input.id,
      name: input.name,
      description: input.description ?? null,
      allowedRoles: input.allowedRoles,
      duration: input.duration ?? 8,
      maxDuration: input.maxDuration ?? 24,
      justificationRequired: input.justificationRequired !== false,
      approvalRequired: input.approvalRequired === true,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      deletedAt: null,
    };
    this.store.set(item.id, item);
    return item;
  }

  async getTemplate(
    id: string,
    options?: { includeDeleted?: boolean },
  ): Promise<JitAdminTemplate | undefined> {
    const item = this.store.get(id);
    if (!item) return undefined;
    if (item.deletedAt && !options?.includeDeleted) return undefined;
    return item;
  }

  async listTemplates(): Promise<JitAdminTemplate[]> {
    return Array.from(this.store.values()).filter((item) => !item.deletedAt);
  }

  async updateTemplate(
    id: string,
    update: JitAdminTemplateUpdate,
  ): Promise<JitAdminTemplate | undefined> {
    const existing = await this.getTemplate(id);
    if (!existing) return undefined;
    const updated: JitAdminTemplate = {
      ...existing,
      name: update.name ?? existing.name,
      description: update.description !== undefined ? update.description : existing.description,
      allowedRoles: update.allowedRoles ?? existing.allowedRoles,
      duration: update.duration ?? existing.duration,
      maxDuration: update.maxDuration ?? existing.maxDuration,
      justificationRequired:
        update.justificationRequired !== undefined
          ? update.justificationRequired
          : existing.justificationRequired,
      approvalRequired:
        update.approvalRequired !== undefined
          ? update.approvalRequired
          : existing.approvalRequired,
      updatedAt: new Date().toISOString(),
    };
    this.store.set(id, updated);
    return updated;
  }

  async softDeleteTemplate(id: string): Promise<boolean> {
    const existing = await this.getTemplate(id);
    if (!existing) return false;
    this.store.set(id, { ...existing, deletedAt: new Date().toISOString() });
    return true;
  }
}

describe("JIT admin templates CRUD (T-0247)", () => {
  it("CRUD persists allowed roles, duration, and justification/approval flags", async () => {
    const repo = new InMemoryJitTemplatesRepository();
    const routes = createJitTemplatesRoutes({
      repository: repo,
      resolveCaller: () => ({
        permissions: [ROLES_READ_PERMISSION, ROLES_WRITE_PERMISSION],
      }),
    });

    const createRoute = routes.find((r) => r.method === "POST" && r.path === JIT_TEMPLATES_PATH)!;
    const listRoute = routes.find((r) => r.method === "GET" && r.path === JIT_TEMPLATES_PATH)!;
    const getRoute = routes.find((r) => r.method === "GET" && r.path === "/v1/jit-templates/:id")!;
    const patchRoute = routes.find((r) => r.method === "PATCH" && r.path === "/v1/jit-templates/:id")!;
    const deleteRoute = routes.find((r) => r.method === "DELETE" && r.path === "/v1/jit-templates/:id")!;

    // Create
    const createResp = await createRoute.handler({
      method: "POST",
      path: JIT_TEMPLATES_PATH,
      params: {},
      query: new URLSearchParams(),
      headers: {},
      body: {
        id: "tpl-sec",
        name: "Security Admin JIT",
        description: "Standard security investigation window",
        allowedRoles: ["role-sa", "role-ra"],
        duration: 4,
        maxDuration: 8,
        justificationRequired: true,
        approvalRequired: false,
      },
    });

    expect(createResp.status).toBe(201);
    const created = createResp.body as JitAdminTemplate;
    expect(created.name).toBe("Security Admin JIT");
    expect(created.allowedRoles).toEqual(["role-sa", "role-ra"]);
    expect(created.duration).toBe(4);
    expect(created.justificationRequired).toBe(true);
    expect(created.approvalRequired).toBe(false);

    // List
    const listResp = await listRoute.handler({
      method: "GET",
      path: JIT_TEMPLATES_PATH,
      params: {},
      query: new URLSearchParams(),
      headers: {},
    });
    expect(listResp.status).toBe(200);
    expect((listResp.body as { items: JitAdminTemplate[] }).items).toHaveLength(1);

    // Get
    const getResp = await getRoute.handler({
      method: "GET",
      path: "/v1/jit-templates/tpl-sec",
      params: { id: "tpl-sec" },
      query: new URLSearchParams(),
      headers: {},
    });
    expect(getResp.status).toBe(200);
    expect((getResp.body as JitAdminTemplate).id).toBe("tpl-sec");

    // Patch
    const patchResp = await patchRoute.handler({
      method: "PATCH",
      path: "/v1/jit-templates/tpl-sec",
      params: { id: "tpl-sec" },
      query: new URLSearchParams(),
      headers: {},
      body: {
        duration: 6,
        approvalRequired: true,
      },
    });
    expect(patchResp.status).toBe(200);
    expect((patchResp.body as JitAdminTemplate).duration).toBe(6);
    expect((patchResp.body as JitAdminTemplate).approvalRequired).toBe(true);

    // Delete
    const deleteResp = await deleteRoute.handler({
      method: "DELETE",
      path: "/v1/jit-templates/tpl-sec",
      params: { id: "tpl-sec" },
      query: new URLSearchParams(),
      headers: {},
    });
    expect(deleteResp.status).toBe(204);
  });

  it("validates that a grant referencing a template outside its allowed roles is rejected", () => {
    const template: JitAdminTemplate = {
      id: "tpl-sa",
      name: "Security Roles Only",
      allowedRoles: ["role-sa", "role-compliance"],
      duration: 4,
      maxDuration: 8,
      justificationRequired: true,
      approvalRequired: false,
      createdAt: "",
      updatedAt: "",
      deletedAt: null,
    };

    // Allowed role passes
    expect(() => validateGrantAgainstTemplate(template, "role-sa")).not.toThrow();

    // Disallowed role is rejected
    expect(() => validateGrantAgainstTemplate(template, "role-ga")).toThrow(AppError);
    try {
      validateGrantAgainstTemplate(template, "role-ga");
    } catch (e) {
      expect((e as AppError).code).toBe(JIT_ROLE_NOT_ALLOWED);
    }
  });

  it("refuses to delete a template with active grants", async () => {
    const repo = new InMemoryJitTemplatesRepository();
    await repo.createTemplate({
      id: "tpl-active",
      name: "In Use Template",
      allowedRoles: ["role-ga"],
    });

    const activeGrantMock: JitGrant = {
      id: "grant-live-1",
      tenantId: "tenant-a",
      userId: "u-1",
      roleId: "role-ga",
      templateId: "tpl-active",
      assignmentType: "eligible",
      startsAt: "2026-09-26T00:00:00Z",
      endsAt: "2026-09-26T08:00:00Z",
      durationHours: 8,
      maxDurationHours: 24,
      state: "active",
      createdBy: "admin",
      createdAt: "",
      updatedAt: "",
    };

    const routes = createJitTemplatesRoutes({
      repository: repo,
      activeGrantsResolver: {
        getActiveGrantsForTemplate: async () => [activeGrantMock],
      },
      resolveCaller: () => ({
        permissions: [ROLES_WRITE_PERMISSION],
      }),
    });

    const deleteRoute = routes.find((r) => r.method === "DELETE" && r.path === "/v1/jit-templates/:id")!;

    await expect(
      deleteRoute.handler({
        method: "DELETE",
        path: "/v1/jit-templates/tpl-active",
        params: { id: "tpl-active" },
        query: new URLSearchParams(),
        headers: {},
      }),
    ).rejects.toMatchObject({
      code: JIT_TEMPLATE_IN_USE,
      status: 409,
    });
  });
});
