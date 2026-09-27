import {
  DEFAULT_STANDARDS_REGISTRY_PATH,
  SqliteBaselinesRepository,
  SqliteDriftRepository,
  SqliteStandardsRepository,
  loadMigrations,
  runMigrations,
} from "@m365-assess/db";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  createBaselineAdvanceStore,
  createBaselineAlignmentStore,
  createBaselineHistory,
  createBaselinesFleetStore,
  createBaselinesMigrateStore,
  createBaselinesStore,
} from "./baselines.js";

function setup() {
  const db = new Database(":memory:");
  const version = runMigrations(db, loadMigrations());
  return {
    baselines: new SqliteBaselinesRepository(db, version),
    drift: new SqliteDriftRepository(db, version, DEFAULT_STANDARDS_REGISTRY_PATH),
    standards: new SqliteStandardsRepository(db, version, DEFAULT_STANDARDS_REGISTRY_PATH),
  };
}

const STAGE = { order: 0, conditions: [{ key: "CA-1", expected: true }], action: "report" as const };

describe("baselines adapters (T-0825)", () => {
  it("creates and updates baselines with their stages and assignments", async () => {
    const store = createBaselinesStore(setup().baselines);
    const created = await store.createBaseline({
      id: "b-1",
      name: "Rollout",
      stages: [STAGE],
      assignments: [{ targetType: "tenant", targetId: "t-a", precedence: 0 }],
    });
    // The route's stage shape has no back-reference to the baseline.
    expect(created.stages).toEqual([STAGE]);

    const next = { order: 1, conditions: [{ key: "CA-2", expected: 1 }], action: "remediate" as const };
    const updated = await store.updateBaseline("b-1", {
      name: "Rollout 2",
      stages: [STAGE, next],
      assignments: [{ targetType: "allTenants", targetId: null, precedence: 0 }],
    });
    expect(updated).toMatchObject({ name: "Rollout 2", stages: [STAGE, next] });
    expect(await store.listBaselineAssignments("b-1")).toEqual([
      { baselineId: "b-1", targetType: "allTenants", targetId: null, precedence: 0 },
    ]);
    expect(await store.updateBaseline("missing", { name: "x" })).toBeUndefined();
    expect((await store.listBaselines()).map((b) => b.id)).toEqual(["b-1"]);
    expect(await store.deleteBaseline("b-1")).toBe(true);
  });

  it("advances rollouts and records history for the alignment view", async () => {
    const { baselines } = setup();
    await baselines.createBaseline({ id: "b-1", name: "Rollout", stages: [STAGE] });
    const advance = createBaselineAdvanceStore(baselines);
    await advance.upsertRollout({ baselineId: "b-1", tenantId: "t-a", stage: 0, state: "eligible" });
    expect(await advance.getRollout("b-1", "t-a")).toMatchObject({ stage: 0, state: "eligible" });
    await createBaselineHistory(baselines).append({
      baselineId: "b-1",
      tenantId: "t-a",
      event: "stage.advanced",
      detail: { from: 0 },
      at: "2026-09-01T00:00:00.000Z",
    });
    await baselines.appendTrend({ baselineId: "b-1", tenantId: "t-a", at: "2026-09-01T00:00:00.000Z", compliance: 1 });

    const alignment = createBaselineAlignmentStore(baselines);
    expect((await alignment.getBaseline("b-1"))?.stages).toEqual([STAGE]);
    expect(await alignment.listRollouts("b-1")).toHaveLength(1);
    expect(await alignment.listHistory("b-1", 10)).toEqual([
      expect.objectContaining({ id: expect.any(String), event: "stage.advanced", detail: { from: 0 } }),
    ]);
    expect(await alignment.listTrend("b-1")).toEqual([{ baselineId: "b-1", tenantId: "t-a", at: "2026-09-01T00:00:00.000Z", compliance: 1 }]);
  });

  it("builds the fleet view from rollouts and drift deviation counts", async () => {
    const { baselines, drift } = setup();
    await baselines.createBaseline({ id: "b-1", name: "Rollout" });
    await baselines.upsertRollout({ baselineId: "b-1", tenantId: "t-a", stage: 0, state: "active" });
    await drift.upsertDeviations("t-a", [{ standardKey: "CA-1", kind: "mismatch", current: 1, expected: 2 }]);
    const fleet = createBaselinesFleetStore(baselines, drift);
    expect(await fleet.listRollouts()).toHaveLength(1);
    expect(await fleet.countDeviationsByState()).toMatchObject({ open: 1, total: 1 });
    expect(await fleet.openDeviationsByTenant()).toEqual({ "t-a": 1 });
  });

  it("reads a standards template and its assignments as the migration source", async () => {
    const { baselines, standards } = setup();
    await standards.createStandardTemplate({ id: "tpl-1", name: "Tier 1", kind: "standards", settings: [{ key: "CA-1", value: true }] });
    await standards.upsertTemplateAssignment({ templateId: "tpl-1", targetType: "group", targetId: "g-1", precedence: 2 });
    const store = createBaselinesMigrateStore(standards, baselines);
    expect(await store.getSourceTemplate("tpl-1")).toEqual({
      id: "tpl-1",
      name: "Tier 1",
      kind: "standards",
      settings: [{ key: "CA-1", value: true }],
      assignments: [{ targetType: "group", targetId: "g-1", precedence: 2 }],
    });
    expect(await store.getSourceTemplate("missing")).toBeUndefined();
    const created = await store.createBaseline({ name: "From Tier 1", stages: [STAGE], assignments: [] });
    expect(created.stages).toEqual([STAGE]);
  });
});
