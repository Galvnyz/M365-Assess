import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { tenantScope } from "../rbac/scope.js";
import {
  InMemoryReusableSettingTemplateRepository,
  REUSABLE_SETTING_TYPES,
  ReusableSettingTemplateValidationError,
  SqliteReusableSettingTemplateRepository,
  collectSettingsJsonIssues,
  reusableSettingTypeFor,
  type ReusableSettingTemplate,
  type ReusableSettingTemplateRepository,
} from "../repository/reusable-setting-templates.js";
import type { Route } from "../server.js";
import {
  REUSABLE_SETTINGS_PATH,
  REUSABLE_SETTINGS_SYNC_PATH,
  REUSABLE_SETTING_TEMPLATES_PATH,
  REUSABLE_SETTING_TEMPLATE_PATH,
  createReusableSettingsRoutes,
  type ReusableSettingsCaller,
  type ReusableSettingsProvider,
  type ReusableSettingsRequestContext,
  type ReusableSettingsSyncResult,
} from "./intune-reusable-settings.js";

const T1 = "tenant-a";
const FIREWALL_ID = "vendor_msft_firewall_mdmstore_dynamickeywords_addresses_{0}";

function firewallSettings(name: string, ranges: string[] = ["10.0.0.0/8"]) {
  return {
    displayName: name,
    settingInstance: {
      "@odata.type": "#microsoft.graph.deviceManagementConfigurationSimpleSettingCollectionInstance",
      settingDefinitionId: FIREWALL_ID,
      simpleSettingCollectionValue: ranges.map((value) => ({ value })),
    },
  };
}

const OUT_OF_SCOPE = {
  displayName: "Homepages",
  settingInstance: { settingDefinitionId: "device_vendor_msft_policy_config_browser_homepages" },
};

const OPERATOR: ReusableSettingsCaller = {
  userId: "user-operator",
  roles: ["operator"],
  tenantScope: tenantScope([T1]),
};

const ALL_PERMISSIONS = ["intune.read", "intune.write", "intune.templates"];

class FakeProvider implements ReusableSettingsProvider {
  readonly syncCalls: { tenantId: string; templateIds: string[]; preview: boolean; actor: string }[] = [];
  failTemplateIds: string[] = [];

  async listSettings(tenantId: string) {
    return [
      { id: "s-1", displayName: "Branch offices", settingDefinitionId: FIREWALL_ID, type: "firewallRemoteAddresses", inScope: true, referencingPolicyCount: 2 },
      { id: "s-2", displayName: `Other in ${tenantId}`, settingDefinitionId: "x", type: null, inScope: false, referencingPolicyCount: 0 },
    ];
  }

  async sync(
    tenantId: string,
    templates: readonly ReusableSettingTemplate[],
    options: { preview: boolean; actor: string },
  ): Promise<ReusableSettingsSyncResult> {
    this.syncCalls.push({ tenantId, templateIds: templates.map((t) => t.id), ...options });
    const changes = templates.map((t) => ({
      templateId: t.id,
      displayName: String(t.settingsJson.displayName),
      type: "firewallRemoteAddresses",
      action: "update" as const,
      settingId: `s-${t.id}`,
      diff: [`~ simpleSettingCollectionValue[0].value: "1" -> "2"`],
      referencingPolicies: [{ id: "pol-1", name: "HQ firewall" }],
    }));
    if (options.preview) return { tenantId, preview: true, changes, results: [], auditEvents: [] };
    const results = templates.map((t) => {
      const failed = this.failTemplateIds.includes(t.id);
      return {
        templateId: t.id,
        displayName: String(t.settingsJson.displayName),
        status: failed ? ("failed" as const) : ("succeeded" as const),
        settingId: `s-${t.id}`,
        error: failed ? "Graph 400" : null,
      };
    });
    return {
      tenantId,
      preview: false,
      changes,
      results,
      auditEvents: results
        .filter((r) => r.status === "succeeded")
        .map((r) => ({ id: `audit-${r.templateId}`, action: "intune.reusable-setting.update", actor: options.actor })),
    };
  }
}

function ctx(
  path: string,
  params: Record<string, string>,
  body?: unknown,
  permissions: readonly string[] = ALL_PERMISSIONS,
): ReusableSettingsRequestContext {
  return {
    correlationId: "corr-1",
    method: "POST",
    path,
    params,
    query: new URLSearchParams(),
    headers: {},
    body,
    permissions,
  };
}

async function setup(caller: ReusableSettingsCaller | null = OPERATOR) {
  const repository = new InMemoryReusableSettingTemplateRepository();
  await repository.create({ id: "tpl-branch", name: "Branch offices", settingsJson: firewallSettings("Branch offices") });
  await repository.create({ id: "tpl-dc", name: "Datacenter", settingsJson: firewallSettings("Datacenter", ["172.16.0.0/12"]) });
  const provider = new FakeProvider();
  const recordAudit = vi.fn(async () => {});
  const routes = createReusableSettingsRoutes({
    repository,
    provider,
    resolveCaller: () => caller ?? undefined,
    recordAudit,
  });
  const route = (method: string, path: string): Route => {
    const found = routes.find((r) => r.method === method && r.path === path);
    if (!found) throw new Error(`no route ${method} ${path}`);
    return found;
  };
  return { repository, provider, recordAudit, route };
}

describe("v1 reusable-settings sync scope (T-0308)", () => {
  it("enumerates the participating Windows configuration setting types", () => {
    expect(REUSABLE_SETTING_TYPES.map((t) => t.key)).toEqual(["firewallRemoteAddresses", "deviceControlGroups"]);
    expect(REUSABLE_SETTING_TYPES.every((t) => t.policyKind === "configuration" && t.platform === "windows")).toBe(true);
    expect(reusableSettingTypeFor(FIREWALL_ID)?.key).toBe("firewallRemoteAddresses");
    expect(
      reusableSettingTypeFor("device_vendor_msft_defender_configuration_devicecontrol_policygroups_{0}_groupdata")?.key,
    ).toBe("deviceControlGroups");
    expect(reusableSettingTypeFor("device_vendor_msft_policy_config_browser_homepages")).toBeUndefined();
  });

  it("rejects malformed and out-of-scope settingsJson", () => {
    expect(collectSettingsJsonIssues(firewallSettings("ok"))).toEqual([]);
    expect(collectSettingsJsonIssues([])).toEqual([{ field: "settingsJson", reason: "must be a JSON object" }]);
    expect(collectSettingsJsonIssues({ settingInstance: {} }).map((i) => i.field)).toEqual([
      "settingsJson.displayName",
      "settingsJson.settingInstance.settingDefinitionId",
    ]);
    expect(collectSettingsJsonIssues(OUT_OF_SCOPE)[0]!.reason).toMatch(/outside the v1 sync scope/);
    expect(
      collectSettingsJsonIssues({ ...firewallSettings("x"), "@odata.type": "#microsoft.graph.somethingElse" })[0]!.field,
    ).toBe("settingsJson.@odata.type");
  });
});

describe.each([
  ["in-memory", () => new InMemoryReusableSettingTemplateRepository()],
  ["sqlite", () => new SqliteReusableSettingTemplateRepository(new Database(":memory:"))],
] as const)("ReusableSettingTemplate repository (%s) (T-0308)", (_name, make) => {
  it("persists, updates, lists by name, and soft-deletes", async () => {
    const repo: ReusableSettingTemplateRepository = make();
    const b = await repo.create({ id: "b", name: "Branch", settingsJson: firewallSettings("Branch") });
    await repo.create({ id: "a", name: "Alpha", settingsJson: firewallSettings("Alpha") });
    expect(b.settingsJson).toEqual(firewallSettings("Branch"));
    expect((await repo.list()).map((t) => t.id)).toEqual(["a", "b"]);

    const updated = await repo.update("b", { settingsJson: firewallSettings("Branch", ["1.1.1.1/32"]) });
    expect(updated?.name).toBe("Branch");
    expect((updated?.settingsJson.settingInstance as any).simpleSettingCollectionValue).toEqual([{ value: "1.1.1.1/32" }]);

    expect(await repo.remove("b")).toBe(true);
    expect(await repo.remove("b")).toBe(false);
    expect(await repo.get("b")).toBeUndefined();
    expect((await repo.get("b", { includeDeleted: true }))?.deletedAt).not.toBeNull();
    expect(await repo.update("b", { name: "x" })).toBeUndefined();
  });

  it("rejects out-of-scope templates and duplicate ids", async () => {
    const repo: ReusableSettingTemplateRepository = make();
    await expect(repo.create({ name: "x", settingsJson: OUT_OF_SCOPE })).rejects.toBeInstanceOf(
      ReusableSettingTemplateValidationError,
    );
    await repo.create({ id: "a", name: "A", settingsJson: firewallSettings("A") });
    await expect(repo.create({ id: "a", name: "A2", settingsJson: firewallSettings("A2") })).rejects.toBeInstanceOf(
      ReusableSettingTemplateValidationError,
    );
    await expect(repo.update("a", { settingsJson: OUT_OF_SCOPE })).rejects.toBeInstanceOf(
      ReusableSettingTemplateValidationError,
    );
  });
});

describe("reusable settings tenant routes (T-0308)", () => {
  it("lists live settings with their scope type and the v1 scope", async () => {
    const { route } = await setup();
    const res = await route("GET", REUSABLE_SETTINGS_PATH).handler(ctx(REUSABLE_SETTINGS_PATH, { tenantId: T1 }));
    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.items).toHaveLength(2);
    expect(body.items[1].inScope).toBe(false);
    expect(body.syncScope.map((s: any) => s.key)).toEqual(["firewallRemoteAddresses", "deviceControlGroups"]);
  });

  it("requires authentication, tenant scope, and permissions", async () => {
    const anon = await setup(null);
    await expect(
      anon.route("GET", REUSABLE_SETTINGS_PATH).handler(ctx(REUSABLE_SETTINGS_PATH, { tenantId: T1 })),
    ).rejects.toMatchObject({ status: 401 });
    const { route } = await setup();
    await expect(
      route("GET", REUSABLE_SETTINGS_PATH).handler(ctx(REUSABLE_SETTINGS_PATH, { tenantId: "tenant-z" })),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      route("POST", REUSABLE_SETTINGS_SYNC_PATH).handler(
        ctx(REUSABLE_SETTINGS_SYNC_PATH, { tenantId: T1 }, {}, ["intune.read"]),
      ),
    ).rejects.toMatchObject({ status: 403 });
    const res = await route("POST", REUSABLE_SETTINGS_SYNC_PATH).handler(
      ctx(REUSABLE_SETTINGS_SYNC_PATH, { tenantId: T1 }, {}, ["remediation.apply"]),
    );
    expect(res.status).toBe(200);
  });

  it("sync previews by default: per-setting diff and referencing policies, no audit", async () => {
    const { route, provider, recordAudit } = await setup();
    const res = await route("POST", REUSABLE_SETTINGS_SYNC_PATH).handler(
      ctx(REUSABLE_SETTINGS_SYNC_PATH, { tenantId: T1 }, {}),
    );
    expect(res.status).toBe(200);
    const body = res.body as ReusableSettingsSyncResult;
    expect(body.preview).toBe(true);
    expect(body.changes.map((c) => c.templateId)).toEqual(["tpl-branch", "tpl-dc"]);
    expect(body.changes[0]!.diff[0]).toMatch(/^~ /);
    expect(body.changes[0]!.referencingPolicies[0]!.name).toBe("HQ firewall");
    expect(provider.syncCalls[0]).toMatchObject({ tenantId: T1, preview: true, actor: "user-operator" });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("sync applies only with preview: false, audits each write, and reports partial failure", async () => {
    const { route, provider, recordAudit } = await setup();
    provider.failTemplateIds = ["tpl-dc"];
    const res = await route("POST", REUSABLE_SETTINGS_SYNC_PATH).handler(
      ctx(REUSABLE_SETTINGS_SYNC_PATH, { tenantId: T1 }, { templateIds: ["tpl-branch", "tpl-dc"], preview: false }),
    );
    expect(res.status).toBe(207);
    const body = res.body as ReusableSettingsSyncResult;
    expect(body.results.map((r) => r.status)).toEqual(["succeeded", "failed"]);
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ id: "audit-tpl-branch" }));
  });

  it("sync rejects unknown templates and non-array templateIds", async () => {
    const { route } = await setup();
    await expect(
      route("POST", REUSABLE_SETTINGS_SYNC_PATH).handler(
        ctx(REUSABLE_SETTINGS_SYNC_PATH, { tenantId: T1 }, { templateIds: ["nope"] }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      route("POST", REUSABLE_SETTINGS_SYNC_PATH).handler(
        ctx(REUSABLE_SETTINGS_SYNC_PATH, { tenantId: T1 }, { templateIds: "tpl-dc" }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a stored template that has fallen outside the sync scope", async () => {
    const { provider } = await setup();
    // Simulate a row written before the scope narrowed.
    const repository: ReusableSettingTemplateRepository = {
      list: async () => [],
      get: async () => ({
        id: "tpl-old",
        name: "Old",
        settingsJson: OUT_OF_SCOPE,
        createdAt: "",
        updatedAt: "",
        deletedAt: null,
      }),
      create: async () => {
        throw new Error("unused");
      },
      update: async () => undefined,
      remove: async () => false,
    };
    const routes = createReusableSettingsRoutes({ repository, provider, resolveCaller: () => OPERATOR });
    const apply = routes.find((r) => r.method === "POST" && r.path === REUSABLE_SETTINGS_PATH)!;
    await expect(
      apply.handler(ctx(REUSABLE_SETTINGS_PATH, { tenantId: T1 }, { templateId: "tpl-old" })),
    ).rejects.toMatchObject({ status: 400, code: "reusable_setting.out_of_scope" });
    expect(provider.syncCalls).toHaveLength(0);
  });

  it("applies one template to the tenant, previewing first", async () => {
    const { route, provider } = await setup();
    const preview = await route("POST", REUSABLE_SETTINGS_PATH).handler(
      ctx(REUSABLE_SETTINGS_PATH, { tenantId: T1 }, { templateId: "tpl-dc" }),
    );
    expect((preview.body as ReusableSettingsSyncResult).preview).toBe(true);
    const applied = await route("POST", REUSABLE_SETTINGS_PATH).handler(
      ctx(REUSABLE_SETTINGS_PATH, { tenantId: T1 }, { templateId: "tpl-dc", preview: false }),
    );
    expect(applied.status).toBe(200);
    expect(provider.syncCalls.map((c) => [c.templateIds, c.preview])).toEqual([
      [["tpl-dc"], true],
      [["tpl-dc"], false],
    ]);
    await expect(
      route("POST", REUSABLE_SETTINGS_PATH).handler(ctx(REUSABLE_SETTINGS_PATH, { tenantId: T1 }, {})),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("reusable setting template routes (T-0308)", () => {
  it("creates, reads, updates, lists with type, and deletes templates", async () => {
    const { route } = await setup();
    const created = await route("POST", REUSABLE_SETTING_TEMPLATES_PATH).handler(
      ctx(REUSABLE_SETTING_TEMPLATES_PATH, {}, { name: "Printers", settingsJson: firewallSettings("Printers") }),
    );
    expect(created.status).toBe(201);
    const id = (created.body as ReusableSettingTemplate).id;

    const patched = await route("PATCH", REUSABLE_SETTING_TEMPLATE_PATH).handler(
      ctx(REUSABLE_SETTING_TEMPLATE_PATH, { id }, { name: "Printers v2" }),
    );
    expect((patched.body as ReusableSettingTemplate).name).toBe("Printers v2");

    const got = await route("GET", REUSABLE_SETTING_TEMPLATE_PATH).handler(ctx(REUSABLE_SETTING_TEMPLATE_PATH, { id }));
    expect((got.body as ReusableSettingTemplate).name).toBe("Printers v2");

    const list = await route("GET", REUSABLE_SETTING_TEMPLATES_PATH).handler(ctx(REUSABLE_SETTING_TEMPLATES_PATH, {}));
    expect((list.body as any).items.map((t: any) => [t.name, t.type])).toContainEqual([
      "Printers v2",
      "firewallRemoteAddresses",
    ]);

    const del = await route("DELETE", REUSABLE_SETTING_TEMPLATE_PATH).handler(ctx(REUSABLE_SETTING_TEMPLATE_PATH, { id }));
    expect(del.status).toBe(204);
    await expect(
      route("GET", REUSABLE_SETTING_TEMPLATE_PATH).handler(ctx(REUSABLE_SETTING_TEMPLATE_PATH, { id })),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects out-of-scope templates with field detail and requires intune.templates", async () => {
    const { route } = await setup();
    await expect(
      route("POST", REUSABLE_SETTING_TEMPLATES_PATH).handler(
        ctx(REUSABLE_SETTING_TEMPLATES_PATH, {}, { name: "Homepages", settingsJson: OUT_OF_SCOPE }),
      ),
    ).rejects.toMatchObject({
      status: 400,
      details: [expect.objectContaining({ field: "settingsJson.settingInstance.settingDefinitionId" })],
    });
    await expect(
      route("POST", REUSABLE_SETTING_TEMPLATES_PATH).handler(
        ctx(REUSABLE_SETTING_TEMPLATES_PATH, {}, { name: "x", settingsJson: firewallSettings("x") }, ["intune.read"]),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
