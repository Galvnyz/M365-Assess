// T-0181 — Baseline and BaselineStage entities and repository.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  BaselineConditionError,
  BaselineStageOrderError,
  normalizeStageInputs,
  openSqliteBaselinesRepository,
} from "./baselines-repository.js";
import { loadMigrations } from "./sqlite-repository.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "m365-baselines-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

async function openRepo(dir: string) {
  return openSqliteBaselinesRepository({ filename: join(dir, "portal.db") });
}

describe("normalizeStageInputs (T-0181)", () => {
  it("sorts stages by order and accepts contiguous zero-based ordering", () => {
    const stages = normalizeStageInputs([
      { order: 1, conditions: [{ key: "B", expected: 2 }], action: "report" },
      { order: 0, conditions: [{ key: "A", expected: 1 }], action: "remediate" },
    ]);
    expect(stages.map((stage) => stage.order)).toEqual([0, 1]);
  });

  it("rejects duplicate orders", () => {
    expect(() =>
      normalizeStageInputs([
        { order: 0, conditions: [], action: "report" },
        { order: 0, conditions: [], action: "report" },
      ]),
    ).toThrow(BaselineStageOrderError);
  });

  it("rejects gaps in the ordering", () => {
    expect(() =>
      normalizeStageInputs([
        { order: 0, conditions: [], action: "report" },
        { order: 2, conditions: [], action: "report" },
      ]),
    ).toThrow(BaselineStageOrderError);
  });

  it("rejects conditions without a standard key", () => {
    expect(() =>
      normalizeStageInputs([{ order: 0, conditions: [{ key: "", expected: 1 }], action: "report" }]),
    ).toThrow(BaselineConditionError);
  });
});

describe("SqliteBaselinesRepository (T-0181)", () => {
  it("persists a baseline with ordered stages and logic 'and'", async () => {
    const repo = await openRepo(tempDir());
    try {
      const created = await repo.createBaseline({
        id: "bl-1",
        name: "Server baseline",
        stages: [
          { order: 0, conditions: [{ key: "CA-REPORTONLY-001", expected: { state: "enabled" } }], action: "report" },
          { order: 1, conditions: [{ key: "EXO-SHARING-001", expected: { state: "disabled" } }], action: "remediate" },
        ],
        assignments: [{ targetType: "tenant", targetId: "contoso", precedence: 0 }],
      });
      expect(created.logic).toBe("and");
      expect(created.stages.map((stage) => stage.order)).toEqual([0, 1]);

      const loaded = await repo.getBaseline("bl-1");
      expect(loaded?.name).toBe("Server baseline");
      expect(loaded?.stages).toHaveLength(2);
      expect(loaded?.stages[0]?.conditions).toEqual([
        { key: "CA-REPORTONLY-001", expected: { state: "enabled" } },
      ]);

      const assignments = await repo.getAssignments("bl-1");
      expect(assignments).toEqual([
        { baselineId: "bl-1", targetType: "tenant", targetId: "contoso", precedence: 0 },
      ]);
    } finally {
      repo.close();
    }
  });

  it("replaces stages and enforces ordering on write", async () => {
    const repo = await openRepo(tempDir());
    try {
      await repo.createBaseline({ id: "bl-1", name: "B" });
      const stages = await repo.setStages("bl-1", [
        { order: 0, conditions: [{ key: "A", expected: 1 }], action: "report" },
      ]);
      expect(stages).toHaveLength(1);
      await expect(
        repo.setStages("bl-1", [
          { order: 0, conditions: [], action: "report" },
          { order: 0, conditions: [], action: "report" },
        ]),
      ).rejects.toBeInstanceOf(BaselineStageOrderError);
    } finally {
      repo.close();
    }
  });

  it("updates, lists, and deletes baselines", async () => {
    const repo = await openRepo(tempDir());
    try {
      await repo.createBaseline({ id: "bl-1", name: "B" });
      const updated = await repo.updateBaseline("bl-1", { name: "Renamed", enabled: false });
      expect(updated?.name).toBe("Renamed");
      expect(updated?.enabled).toBe(false);
      expect(await repo.listBaselines()).toHaveLength(1);
      expect(await repo.deleteBaseline("bl-1")).toBe(true);
      expect(await repo.getBaseline("bl-1")).toBeUndefined();
    } finally {
      repo.close();
    }
  });
});

describe("0068 migration (T-0181)", () => {
  it("applies after the head, advances SchemaVersion, and creates the baseline tables", async () => {
    const dir = tempDir();
    const migrations = loadMigrations();
    const head = migrations.reduce((max, m) => Math.max(max, m.version), 0);
    expect(migrations.some((m) => m.name === "0068_baselines.sql")).toBe(true);

    const filename = join(dir, "portal.db");
    const repo = await openSqliteBaselinesRepository({ filename });
    expect(repo.schemaVersion).toBe(head);
    repo.close();

    // Re-runnable: opening the same file twice migrates cleanly.
    const reopened = await openSqliteBaselinesRepository({ filename });
    expect(reopened.schemaVersion).toBe(head);
    reopened.close();

    const raw = new Database(filename);
    try {
      const tables = (
        raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
      ).map((row) => row.name);
      expect(tables).toContain("baselines");
      expect(tables).toContain("baseline_stages");
      expect(tables).toContain("baseline_assignments");
      const versions = (
        raw.prepare("SELECT version FROM schema_versions").all() as { version: number }[]
      ).map((row) => row.version);
      expect(versions).toContain(68);
    } finally {
      raw.close();
    }
  });
});

describe("rollouts across baselines, history, and trend (T-0825)", () => {
  it("lists every rollout, the newest history first, and the trend oldest first", async () => {
    const repo = await openRepo(tempDir());
    try {
      const a = await repo.createBaseline({ name: "A", stages: [{ order: 0, conditions: [{ key: "K", expected: 1 }], action: "report" }] });
      const b = await repo.createBaseline({ name: "B" });
      await repo.upsertRollout({ baselineId: b.id, tenantId: "t-1", stage: 0, state: "active" });
      await repo.upsertRollout({ baselineId: a.id, tenantId: "t-2", stage: 0, state: "eligible" });
      expect((await repo.listAllRollouts()).map((r) => [r.baselineId, r.tenantId])).toEqual(
        [[a.id, "t-2"], [b.id, "t-1"]].sort((x, y) => x[0]!.localeCompare(y[0]!)),
      );

      for (const [id, at] of [["h-1", "2026-09-01T00:00:00.000Z"], ["h-2", "2026-09-03T00:00:00.000Z"], ["h-3", "2026-09-02T00:00:00.000Z"]] as const) {
        await repo.appendHistory({ id, baselineId: a.id, tenantId: "t-2", event: "stage.evaluated", detail: { stage: 0 }, at });
      }
      const history = await repo.listHistory(a.id, 2);
      expect(history.map((event) => event.id)).toEqual(["h-2", "h-3"]);
      expect(history[0]).toMatchObject({ baselineId: a.id, tenantId: "t-2", detail: { stage: 0 } });

      await repo.appendTrend({ baselineId: a.id, tenantId: "t-2", at: "2026-09-02T00:00:00.000Z", compliance: 0.5 });
      await repo.appendTrend({ baselineId: a.id, tenantId: "t-2", at: "2026-09-01T00:00:00.000Z", compliance: 0.25 });
      expect((await repo.listTrend(a.id)).map((point) => point.compliance)).toEqual([0.25, 0.5]);
      expect(await repo.listTrend(b.id)).toEqual([]);
    } finally {
      repo.close();
    }
  });
});
