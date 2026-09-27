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
  PIM_APPLY_CONFIRM_REQUIRED,
  PIM_NO_TARGET_ROLE,
  PIM_TEMPLATE_APPLY_PATH,
  REMEDIATION_APPLY_PERMISSION,
  createPimSettingsTemplatesRoutes,
  type LiveRoleSettingsProvider,
  type PimApplyResult,
  type PimSettingsApplyOutcome,
  type PimSettingsApplyProvider,
  type PimSettingsAuditEvent,
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

  async listTemplates(): Promise<PimRoleSettingsTemplate[]> {
    return Array.from(this.store.values()).filter((item) => !item.deletedAt);
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

class FakeApplyProvider implements PimSettingsApplyProvider {
  readonly calls: Array<{ tenantId: string; roleId: string; settings: PimRoleSettings }> = [];

  async applySettings(
    tenantId: string,
    roleId: string,
    settings: PimRoleSettings,
  ): Promise<PimSettingsApplyOutcome> {
    this.calls.push({ tenantId, roleId, settings });
    return { applied: settings };
  }
}

class FakeLiveSettingsProvider implements LiveRoleSettingsProvider {
  async getLiveRoleSettings(): Promise<PimRoleSettings | undefined> {
    return {
      maximumDurationInHours: 8,
      requireMfa: false,
      requireJustification: false,
      requireApproval: false,
    };
  }
}

describe("PIM role settings apply with plan preview (T-0244)", () => {
  it("Preview returns current-vs-template diff and writes nothing", async () => {
    const repo = new InMemoryPimSettingsRepository();
    await repo.createTemplate({
      id: "tpl-1",
      name: "Standard Admin",
      roleId: "role-ga",
      settings: {
        maximumDurationInHours: 4,
        requireMfa: true,
        requireJustification: true,
        requireApproval: true,
      },
    });

    const applyProvider = new FakeApplyProvider();
    const audits: PimSettingsAuditEvent[] = [];

    const routes = createPimSettingsTemplatesRoutes({
      repository: repo,
      liveSettingsProvider: new FakeLiveSettingsProvider(),
      applyProvider,
      recordAudit: async (ev) => {
        audits.push(ev);
      },
      resolveCaller: () => ({
        tenantScope: tenantScope(["tenant-a"]),
        permissions: ["Identity.Role.Read", REMEDIATION_APPLY_PERMISSION],
      }),
    });

    const applyRoute = routes.find(
      (r) => r.method === "POST" && r.path === PIM_TEMPLATE_APPLY_PATH,
    )!;

    const resp = await applyRoute.handler({
      method: "POST",
      path: "/v1/pim-settings-templates/tpl-1/apply",
      params: { id: "tpl-1" },
      query: new URLSearchParams(),
      headers: {},
      body: {
        tenantId: "tenant-a",
        preview: true,
      },
    });

    expect(resp.status).toBe(200);
    const body = resp.body as PimApplyResult;
    expect(body.dryRun).toBe(true);
    expect(body.applied).toBeNull();
    expect(body.current.maximumDurationInHours).toBe(8);
    expect(body.proposed.maximumDurationInHours).toBe(4);
    expect(body.diffs.some((d) => d.setting === "maximumDurationInHours" && !d.matches)).toBe(true);

    expect(applyProvider.calls).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("Apply confirms, routes through executor, captures before/after, and audits", async () => {
    const repo = new InMemoryPimSettingsRepository();
    await repo.createTemplate({
      id: "tpl-2",
      name: "Enforce MFA Admin",
      roleId: "role-ga",
      settings: {
        maximumDurationInHours: 4,
        requireMfa: true,
        requireJustification: true,
        requireApproval: false,
      },
    });

    const applyProvider = new FakeApplyProvider();
    const audits: PimSettingsAuditEvent[] = [];

    const routes = createPimSettingsTemplatesRoutes({
      repository: repo,
      liveSettingsProvider: new FakeLiveSettingsProvider(),
      applyProvider,
      recordAudit: async (ev) => {
        audits.push(ev);
      },
      resolveCaller: () => ({
        userId: "user-operator",
        tenantScope: tenantScope(["tenant-a"]),
        permissions: [REMEDIATION_APPLY_PERMISSION],
      }),
    });

    const applyRoute = routes.find(
      (r) => r.method === "POST" && r.path === PIM_TEMPLATE_APPLY_PATH,
    )!;

    const resp = await applyRoute.handler({
      method: "POST",
      path: "/v1/pim-settings-templates/tpl-2/apply",
      params: { id: "tpl-2" },
      query: new URLSearchParams(),
      headers: {},
      body: {
        tenantId: "tenant-a",
        confirm: true,
        reason: "Alignment with CIS benchmark recommendation",
      },
    });

    expect(resp.status).toBe(200);
    const body = resp.body as PimApplyResult;
    expect(body.dryRun).toBe(false);
    expect(body.applied).toEqual({
      maximumDurationInHours: 4,
      requireMfa: true,
      requireJustification: true,
      requireApproval: false,
    });

    expect(applyProvider.calls).toHaveLength(1);
    expect(applyProvider.calls[0]?.roleId).toBe("role-ga");

    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe("pim.settingsApply");
    expect(audits[0]?.result).toBe("success");
    expect(audits[0]?.callerId).toBe("user-operator");
    expect(audits[0]?.reason).toBe("Alignment with CIS benchmark recommendation");
    expect(audits[0]?.before).toHaveProperty("maximumDurationInHours", 8);
    expect(audits[0]?.after).toHaveProperty("maximumDurationInHours", 4);
  });

  it("Apply without confirm is rejected", async () => {
    const repo = new InMemoryPimSettingsRepository();
    await repo.createTemplate({
      id: "tpl-3",
      name: "Test",
      roleId: "role-ga",
      settings: {},
    });

    const routes = createPimSettingsTemplatesRoutes({
      repository: repo,
      applyProvider: new FakeApplyProvider(),
      resolveCaller: () => ({
        tenantScope: tenantScope(["tenant-a"]),
        permissions: [REMEDIATION_APPLY_PERMISSION],
      }),
    });

    const applyRoute = routes.find(
      (r) => r.method === "POST" && r.path === PIM_TEMPLATE_APPLY_PATH,
    )!;

    await expect(
      applyRoute.handler({
        method: "POST",
        path: "/v1/pim-settings-templates/tpl-3/apply",
        params: { id: "tpl-3" },
        query: new URLSearchParams(),
        headers: {},
        body: {
          tenantId: "tenant-a",
          reason: "Testing",
          // confirm omitted
        },
      }),
    ).rejects.toMatchObject({
      code: PIM_APPLY_CONFIRM_REQUIRED,
      status: 400,
    });
  });

  it("A template with no target role cannot be applied", async () => {
    const repo = new InMemoryPimSettingsRepository();
    await repo.createTemplate({
      id: "tpl-no-role",
      name: "Generic Template",
      roleId: null, // No target role
      settings: { maximumDurationInHours: 4 },
    });

    const routes = createPimSettingsTemplatesRoutes({
      repository: repo,
      applyProvider: new FakeApplyProvider(),
      resolveCaller: () => ({
        tenantScope: tenantScope(["tenant-a"]),
        permissions: [REMEDIATION_APPLY_PERMISSION],
      }),
    });

    const applyRoute = routes.find(
      (r) => r.method === "POST" && r.path === PIM_TEMPLATE_APPLY_PATH,
    )!;

    await expect(
      applyRoute.handler({
        method: "POST",
        path: "/v1/pim-settings-templates/tpl-no-role/apply",
        params: { id: "tpl-no-role" },
        query: new URLSearchParams(),
        headers: {},
        body: {
          tenantId: "tenant-a",
          confirm: true,
          reason: "Applying generic template",
          // roleId omitted
        },
      }),
    ).rejects.toMatchObject({
      code: PIM_NO_TARGET_ROLE,
      status: 400,
    });
  });
});
