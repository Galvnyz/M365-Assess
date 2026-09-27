import {
  DEFAULT_STANDARDS_REGISTRY_PATH,
  SqliteScheduleRepository,
  SqliteStandardsRepository,
  loadMigrations,
  runMigrations,
} from "@m365-assess/db";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  TENANT_LICENSES_UNAVAILABLE,
  createStandardsAlignmentStore,
  createStandardsCatalogStore,
  createStandardsRunStore,
  createStandardsTemplateStore,
  createUnavailableStandardsRunQueue,
  unavailableTenantLicenses,
} from "./standards.js";
import { JOB_DISPATCH_UNAVAILABLE } from "./automation.js";

function setup() {
  const db = new Database(":memory:");
  const version = runMigrations(db, loadMigrations());
  return {
    standards: new SqliteStandardsRepository(db, version, DEFAULT_STANDARDS_REGISTRY_PATH),
    schedules: new SqliteScheduleRepository(db, version),
  };
}

describe("standards adapters (T-0825)", () => {
  it("creates, patches, and assigns templates", async () => {
    const store = createStandardsTemplateStore(setup().standards);
    await store.createStandardTemplate({ id: "tpl-1", name: "Tier 1", kind: "standards", settings: [{ key: "A", value: 1 }] });
    const updated = await store.updateStandardTemplate("tpl-1", { name: "Tier 1b", autoRemediate: true });
    expect(updated).toMatchObject({ name: "Tier 1b", autoRemediate: true, settings: [{ key: "A", value: 1 }] });
    await store.upsertTemplateAssignment({ templateId: "tpl-1", targetType: "tenant", targetId: "t-a" });
    expect(await store.listTemplateAssignments()).toEqual([{ templateId: "tpl-1", targetType: "tenant", targetId: "t-a", precedence: 0 }]);
    expect(await store.listStandardTemplates()).toHaveLength(1);
    expect(await store.deleteStandardTemplate("tpl-1")).toBe(true);
  });

  it("serves the registry catalog and compare rows with the check reference renamed", async () => {
    const { standards } = setup();
    const [first] = await createStandardsCatalogStore(standards).listDefinitions();
    expect(first).toMatchObject({ id: expect.any(String), check: first!.id, name: expect.any(String) });
    expect(first).not.toHaveProperty("checkId");

    await standards.upsertCompare([
      { tenantId: "t-a", checkId: "CA-1", current: false, expected: true, state: "non-compliant", lastRunAt: null },
    ]);
    expect(await createStandardsAlignmentStore(standards).listCompare("t-a")).toEqual([
      { tenantId: "t-a", check: "CA-1", current: false, expected: true, state: "non-compliant", lastRunAt: null },
    ]);
  });

  it("links a template to a new schedule and soft-deletes it", async () => {
    const { standards, schedules } = setup();
    const store = createStandardsRunStore(standards, schedules);
    await standards.createStandardTemplate({ id: "tpl-1", name: "Tier 1", kind: "standards" });
    const created = await store.createSchedule({
      id: "sch-1",
      name: "Tier 1",
      type: "standards",
      cron: "0 0 */12 * * *",
      timezone: "UTC",
      targetScope: { type: "all" },
      command: "Invoke-Standard",
      parameters: { templateId: "tpl-1" },
      enabled: true,
      isSystem: false,
      lastRunAt: null,
      nextRunAt: null,
    });
    expect(created.id).toBe("sch-1");
    expect((await store.updateStandardTemplate("tpl-1", { scheduleId: "sch-1" }))?.scheduleId).toBe("sch-1");
    expect(await store.softDeleteSchedule("sch-1")).toBe(true);
    expect(await schedules.getSchedule("sch-1")).toBeUndefined();
  });

  it("refuses runs and tenant licence classification with 501", async () => {
    await expect(createUnavailableStandardsRunQueue().enqueue({})).rejects.toMatchObject({ code: JOB_DISPATCH_UNAVAILABLE, status: 501 });
    await expect(unavailableTenantLicenses()).rejects.toMatchObject({ code: TENANT_LICENSES_UNAVAILABLE, status: 501 });
  });
});
