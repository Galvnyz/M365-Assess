import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { tenantScope } from "../rbac/scope.js";
import type { PimSettingsRepository } from "../../../db/src/pim-settings-repository.js";
import type {
  PimRoleSettings,
  PimRoleSettingsTemplate,
  PimRoleSettingsTemplateInput,
  PimRoleSettingsTemplateUpdate,
} from "../../../db/src/repository.js";
import {
  PIM_SCOPE_OUT_OF_SCOPE,
  PIM_TEMPLATES_PATH,
  PIM_TEMPLATES_READ_PERMISSION,
  PIM_TEMPLATES_WRITE_PERMISSION,
  createPimSettingsTemplatesRoutes,
  type LiveRoleSettingsProvider,
} from "./pim-settings-templates.js";

class InMemoryPimSettingsRepository implements PimSettingsRepository {
  readonly schemaVersion = 72;
  private readonly store = new Map<string, PimRoleSettingsTemplate>();

  close(): void {}

  async createTemplate(
    input: PimRoleSettingsTemplateInput,
  ): Promise<PimRoleSettingsTemplate> {
    const now = new Date().toISOString();
    const tpl: PimRoleSettingsTemplate = {
      id: input.id,
      name: input.name,
      roleId: input.roleId ?? null,
      settings: input.settings ?? {},
      scope: input.scope ?? "/",
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      deletedAt: null,
    };
    this.store.set(tpl.id, tpl);
    return tpl;
  }

  async getTemplate(
    id: string,
    options?: { includeDeleted?: boolean },
  ): Promise<PimRoleSettingsTemplate | undefined> {
    const item = this.store.get(id);
    if (!item) return undefined;
    if (item.deletedAt && !options?.includeDeleted) return undefined;
    return item;
  }

  async listTemplates(
    options?: { includeDeleted?: boolean },
  ): Promise<PimRoleSettingsTemplate[]> {
    return Array.from(this.store.values()).filter(
      (item) => options?.includeDeleted || !item.deletedAt,
    );
  }

  async updateTemplate(
    id: string,
    update: PimRoleSettingsTemplateUpdate,
  ): Promise<PimRoleSettingsTemplate | undefined> {
    const existing = await this.getTemplate(id);
    if (!existing) return undefined;
    const updated: PimRoleSettingsTemplate = {
      ...existing,
      name: update.name ?? existing.name,
      roleId: update.roleId !== undefined ? update.roleId : existing.roleId,
      settings: update.settings ?? existing.settings,
      scope: update.scope ?? existing.scope,
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

class FakeLiveSettingsProvider implements LiveRoleSettingsProvider {
  liveSettings: PimRoleSettings = {
    maximumDurationInHours: 4,
    requireMfa: true,
    requireJustification: false,
    requireApproval: false,
  };

  async getLiveRoleSettings(): Promise<PimRoleSettings | undefined> {
    return this.liveSettings;
  }
}

describe("PIM settings templates CRUD & compare (T-0243)", () => {
  it("CRUD persists name, optional role, settings, and scope and round-trips them", async () => {
    const repo = new InMemoryPimSettingsRepository();
    const routes = createPimSettingsTemplatesRoutes({
      repository: repo,
      resolveCaller: () => ({
        tenantScope: tenantScope(["tenant-a"]),
        permissions: [PIM_TEMPLATES_READ_PERMISSION, PIM_TEMPLATES_WRITE_PERMISSION],
      }),
    });

    const createRoute = routes.find((r) => r.method === "POST" && r.path === PIM_TEMPLATES_PATH)!;
    const listRoute = routes.find((r) => r.method === "GET" && r.path === PIM_TEMPLATES_PATH)!;
    const getRoute = routes.find((r) => r.method === "GET" && r.path === "/v1/pim-settings-templates/:id")!;
    const patchRoute = routes.find((r) => r.method === "PATCH" && r.path === "/v1/pim-settings-templates/:id")!;
    const deleteRoute = routes.find((r) => r.method === "DELETE" && r.path === "/v1/pim-settings-templates/:id")!;

    // Create
    const createResp = await createRoute.handler({
      method: "POST",
      path: PIM_TEMPLATES_PATH,
      params: {},
      query: new URLSearchParams(),
      headers: {},
      body: {
        id: "tpl-1",
        name: "Standard Admin PIM",
        roleId: "role-ga",
        settings: {
          maximumDurationInHours: 8,
          requireMfa: true,
          requireJustification: true,
          requireApproval: true,
        },
        scope: "/",
      },
    });

    expect(createResp.status).toBe(201);
    const created = createResp.body as PimRoleSettingsTemplate;
    expect(created.id).toBe("tpl-1");
    expect(created.name).toBe("Standard Admin PIM");
    expect(created.roleId).toBe("role-ga");
    expect(created.settings.maximumDurationInHours).toBe(8);

    // List
    const listResp = await listRoute.handler({
      method: "GET",
      path: PIM_TEMPLATES_PATH,
      params: {},
      query: new URLSearchParams(),
      headers: {},
    });
    expect(listResp.status).toBe(200);
    expect((listResp.body as { items: PimRoleSettingsTemplate[] }).items).toHaveLength(1);

    // Get
    const getResp = await getRoute.handler({
      method: "GET",
      path: "/v1/pim-settings-templates/tpl-1",
      params: { id: "tpl-1" },
      query: new URLSearchParams(),
      headers: {},
    });
    expect(getResp.status).toBe(200);
    expect((getResp.body as PimRoleSettingsTemplate).name).toBe("Standard Admin PIM");

    // Patch
    const patchResp = await patchRoute.handler({
      method: "PATCH",
      path: "/v1/pim-settings-templates/tpl-1",
      params: { id: "tpl-1" },
      query: new URLSearchParams(),
      headers: {},
      body: {
        name: "Updated Admin PIM",
        settings: {
          maximumDurationInHours: 4,
          requireMfa: true,
          requireJustification: true,
          requireApproval: false,
        },
      },
    });
    expect(patchResp.status).toBe(200);
    expect((patchResp.body as PimRoleSettingsTemplate).name).toBe("Updated Admin PIM");
    expect((patchResp.body as PimRoleSettingsTemplate).settings.maximumDurationInHours).toBe(4);

    // Delete
    const deleteResp = await deleteRoute.handler({
      method: "DELETE",
      path: "/v1/pim-settings-templates/tpl-1",
      params: { id: "tpl-1" },
      query: new URLSearchParams(),
      headers: {},
    });
    expect(deleteResp.status).toBe(204);

    const afterDelete = await repo.getTemplate("tpl-1");
    expect(afterDelete).toBeUndefined();
  });

  it("rejects role+scope templates as out of scope for v1", async () => {
    const repo = new InMemoryPimSettingsRepository();
    const routes = createPimSettingsTemplatesRoutes({
      repository: repo,
      resolveCaller: () => ({
        tenantScope: tenantScope(["tenant-a"]),
        permissions: [PIM_TEMPLATES_WRITE_PERMISSION],
      }),
    });

    const createRoute = routes.find((r) => r.method === "POST" && r.path === PIM_TEMPLATES_PATH)!;

    await expect(
      createRoute.handler({
        method: "POST",
        path: PIM_TEMPLATES_PATH,
        params: {},
        query: new URLSearchParams(),
        headers: {},
        body: {
          name: "Invalid Scope Template",
          roleId: "role-ga",
          scope: "/subscriptions/sub-123/resourceGroups/rg-1",
        },
      }),
    ).rejects.toMatchObject({
      code: PIM_SCOPE_OUT_OF_SCOPE,
      status: 400,
    });
  });

  it("Compare returns current-vs-template differences without writing to tenant", async () => {
    const repo = new InMemoryPimSettingsRepository();
    await repo.createTemplate({
      id: "tpl-diff",
      name: "Strict Security",
      roleId: "role-ga",
      settings: {
        maximumDurationInHours: 8,
        requireMfa: true,
        requireJustification: true,
        requireApproval: true,
      },
      scope: "/",
    });

    const liveProvider = new FakeLiveSettingsProvider();
    const routes = createPimSettingsTemplatesRoutes({
      repository: repo,
      liveSettingsProvider: liveProvider,
      resolveCaller: () => ({
        tenantScope: tenantScope(["tenant-a"]),
        permissions: [PIM_TEMPLATES_READ_PERMISSION],
      }),
    });

    const compareRoute = routes.find(
      (r) => r.method === "POST" && r.path === "/v1/pim-settings-templates/:id/compare",
    )!;

    const resp = await compareRoute.handler({
      method: "POST",
      path: "/v1/pim-settings-templates/tpl-diff/compare",
      params: { id: "tpl-diff" },
      query: new URLSearchParams(),
      headers: {},
      body: {
        tenantId: "tenant-a",
      },
    });

    expect(resp.status).toBe(200);
    const body = resp.body as {
      templateId: string;
      diffs: Array<{ setting: string; current: unknown; template: unknown; matches: boolean }>;
      hasDifferences: boolean;
    };

    expect(body.templateId).toBe("tpl-diff");
    expect(body.hasDifferences).toBe(true);

    const durationDiff = body.diffs.find((d) => d.setting === "maximumDurationInHours");
    expect(durationDiff?.current).toBe(4);
    expect(durationDiff?.template).toBe(8);
    expect(durationDiff?.matches).toBe(false);

    const mfaDiff = body.diffs.find((d) => d.setting === "requireMfa");
    expect(mfaDiff?.current).toBe(true);
    expect(mfaDiff?.template).toBe(true);
    expect(mfaDiff?.matches).toBe(true);
  });
});
