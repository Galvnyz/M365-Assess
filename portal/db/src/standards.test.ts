// T-0141 — StandardDefinition model derived from the control registry.
// Asserts: definitions derive 1:1 from the registry by checkId; a curated
// override row wins; the repository resolves by checkId and lists by category;
// and the 0064 migration applies after the head and is re-runnable.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_STANDARDS_REGISTRY_PATH,
  openSqliteStandardsRepository,
} from "./standards-repository.js";
import { loadMigrations } from "./sqlite-repository.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "m365-standards-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

/** A minimal two-check registry fixture. */
function registryFixture(dir: string, overrides: { e5?: boolean } = {}): string {
  const path = join(dir, "registry.json");
  writeFileSync(
    path,
    JSON.stringify({
      schemaVersion: 1,
      dataVersion: "test",
      generatedFrom: "test",
      checks: [
        {
          checkId: "ENTRA-SECDEFAULT-001",
          name: "Ensure Security Defaults are enabled",
          category: "SECDEFAULT",
          licensing: { minimum: "E3" },
        },
        {
          checkId: "DEFENDER-SECUREMON-001",
          name: "Ensure continuous security monitoring",
          category: "SECUREMON",
          licensing: { minimum: overrides.e5 ? "E5" : "E3" },
        },
      ],
    }),
    "utf8",
  );
  return path;
}

async function openRepository(dir: string, registryPath: string) {
  return openSqliteStandardsRepository({
    filename: join(dir, "portal.db"),
    registryPath,
  });
}

describe("StandardDefinition derivation (T-0141)", () => {
  it("derives definitions 1:1 from the registry by checkId", async () => {
    const dir = tempDir();
    const repo = await openRepository(dir, registryFixture(dir));
    try {
      const definitions = await repo.listDefinitions();
      expect(definitions).toHaveLength(2);

      const secdefault = await repo.getDefinition("ENTRA-SECDEFAULT-001");
      expect(secdefault).toEqual({
        id: "ENTRA-SECDEFAULT-001",
        checkId: "ENTRA-SECDEFAULT-001",
        name: "Ensure Security Defaults are enabled",
        category: "SECDEFAULT",
        licensePreset: "E3",
      });
    } finally {
      repo.close();
    }
  });

  it("maps an unknown license minimum to a null preset", async () => {
    const dir = tempDir();
    const path = join(dir, "registry.json");
    writeFileSync(
      path,
      JSON.stringify({
        checks: [{ checkId: "X-001", name: "X", category: "C", licensing: { minimum: "E1" } }],
      }),
      "utf8",
    );
    const repo = await openRepository(dir, path);
    try {
      expect((await repo.getDefinition("X-001"))?.licensePreset).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("lists definitions by category", async () => {
    const dir = tempDir();
    const repo = await openRepository(dir, registryFixture(dir));
    try {
      expect(await repo.listDefinitionsByCategory("SECDEFAULT")).toHaveLength(1);
      expect(await repo.listDefinitionsByCategory("NOPE")).toHaveLength(0);
    } finally {
      repo.close();
    }
  });

  it("derives the full 1:1 set from the shipped registry", async () => {
    const dir = tempDir();
    const repo = await openRepository(dir, DEFAULT_STANDARDS_REGISTRY_PATH);
    try {
      const registry = JSON.parse(
        (await import("node:fs")).readFileSync(DEFAULT_STANDARDS_REGISTRY_PATH, "utf8"),
      ) as { checks: unknown[] };
      const definitions = await repo.listDefinitions();
      expect(definitions).toHaveLength(registry.checks.length);
      // 1:1: every id is a registry checkId, with no duplicates.
      const ids = new Set(definitions.map((d) => d.id));
      expect(ids.size).toBe(definitions.length);
    } finally {
      repo.close();
    }
  });
});

describe("curated overrides (T-0141)", () => {
  it("lets an override row win over the derived definition", async () => {
    const dir = tempDir();
    const repo = await openRepository(dir, registryFixture(dir));
    try {
      await repo.upsertOverride({
        checkId: "ENTRA-SECDEFAULT-001",
        name: "Curated name",
        licensePreset: "E5",
      });

      const definition = await repo.getDefinition("ENTRA-SECDEFAULT-001");
      expect(definition?.name).toBe("Curated name");
      expect(definition?.licensePreset).toBe("E5");
      // Fields the override omits still come from the registry.
      expect(definition?.category).toBe("SECDEFAULT");
    } finally {
      repo.close();
    }
  });

  it("persists overrides across reopen and can clear them", async () => {
    const dir = tempDir();
    const registryPath = registryFixture(dir);
    const filename = join(dir, "portal.db");

    const repo = await openSqliteStandardsRepository({ filename, registryPath });
    await repo.upsertOverride({ checkId: "DEFENDER-SECUREMON-001", category: "CUSTOM" });
    repo.close();

    const reopened = await openSqliteStandardsRepository({ filename, registryPath });
    try {
      const definition = await reopened.getDefinition("DEFENDER-SECUREMON-001");
      expect(definition?.category).toBe("CUSTOM");

      expect(await reopened.listOverrides()).toHaveLength(1);
      expect(await reopened.deleteOverride("DEFENDER-SECUREMON-001")).toBe(true);
      // After deletion the registry value is back.
      expect((await reopened.getDefinition("DEFENDER-SECUREMON-001"))?.category).toBe("SECUREMON");
    } finally {
      reopened.close();
    }
  });
});

describe("StandardTemplate and TemplateAssignment persistence (T-0142)", () => {
  it("persists a template with the §5 fields and the standards|drift kind", async () => {
    const dir = tempDir();
    const repo = await openRepository(dir, registryFixture(dir));
    try {
      const created = await repo.createStandardTemplate({
        id: "tpl-1",
        name: "Baseline",
        kind: "standards",
        actions: { report: true, alert: false, remediate: true },
        autoRemediate: true,
        settings: [{ key: "mfa", value: "required" }],
        scheduleId: "sch-1",
      });
      expect(created.kind).toBe("standards");
      expect(created.actions).toEqual({ report: true, alert: false, remediate: true });
      expect(created.autoRemediate).toBe(true);

      const loaded = await repo.getStandardTemplate("tpl-1");
      expect(loaded).toMatchObject({
        id: "tpl-1",
        name: "Baseline",
        kind: "standards",
        scheduleId: "sch-1",
      });
      expect(loaded?.settings).toEqual([{ key: "mfa", value: "required" }]);

      await repo.createStandardTemplate({ id: "tpl-2", name: "Drift", kind: "drift" });
      expect((await repo.listStandardTemplates()).map((t) => t.id)).toEqual(["tpl-1", "tpl-2"]);
    } finally {
      repo.close();
    }
  });

  it("persists assignments and replaces precedence on re-upsert", async () => {
    const dir = tempDir();
    const repo = await openRepository(dir, registryFixture(dir));
    try {
      await repo.createStandardTemplate({ id: "tpl-1", name: "Baseline", kind: "standards" });

      const created = await repo.upsertTemplateAssignment({
        templateId: "tpl-1",
        targetType: "tenant",
        targetId: "contoso",
        precedence: 1,
      });
      expect(created).toEqual({
        templateId: "tpl-1",
        targetType: "tenant",
        targetId: "contoso",
        precedence: 1,
      });

      const updated = await repo.upsertTemplateAssignment({
        templateId: "tpl-1",
        targetType: "tenant",
        targetId: "contoso",
        precedence: 9,
      });
      expect(updated.precedence).toBe(9);
      expect(await repo.listTemplateAssignments()).toHaveLength(1);

      // An allTenants assignment stores a null targetId.
      const all = await repo.upsertTemplateAssignment({ templateId: "tpl-1", targetType: "allTenants" });
      expect(all.targetId).toBeNull();

      expect(await repo.deleteTemplateAssignment("tpl-1", "tenant", "contoso")).toBe(true);
      expect(await repo.listTemplateAssignments()).toHaveLength(1);
    } finally {
      repo.close();
    }
  });

  it("rejects an assignment for an unknown template and cascades on template delete", async () => {
    const dir = tempDir();
    const repo = await openRepository(dir, registryFixture(dir));
    try {
      await expect(
        repo.upsertTemplateAssignment({ templateId: "missing", targetType: "allTenants" }),
      ).rejects.toThrow(/not found/);

      await repo.createStandardTemplate({ id: "tpl-1", name: "Baseline", kind: "standards" });
      await repo.upsertTemplateAssignment({
        templateId: "tpl-1",
        targetType: "tenant",
        targetId: "contoso",
      });
      expect(await repo.deleteStandardTemplate("tpl-1")).toBe(true);
      // Assignments are removed with the template.
      expect(await repo.listTemplateAssignments()).toHaveLength(0);
    } finally {
      repo.close();
    }
  });
});

describe("0064 migration (T-0141)", () => {
  it("applies after the current head, advances SchemaVersion, and is re-runnable", async () => {
    const dir = tempDir();
    const migrations = loadMigrations();
    const head = migrations.reduce((max, m) => Math.max(max, m.version), 0);
    // The standards migration is the head of the set.
    expect(migrations.some((m) => m.name === "0064_standard_definitions.sql")).toBe(true);
    expect(head).toBeGreaterThanOrEqual(64);

    const filename = join(dir, "portal.db");
    const repo = await openSqliteStandardsRepository({ filename, registryPath: registryFixture(dir) });
    expect(repo.schemaVersion).toBe(head);
    repo.close();

    // Re-opening re-runs the (already applied) migrations without error.
    const reopened = await openSqliteStandardsRepository({ filename, registryPath: registryFixture(dir) });
    expect(reopened.schemaVersion).toBe(head);
    reopened.close();

    // The override table exists and is idempotent to re-apply.
    const raw = new Database(filename);
    try {
      const columns = (raw.prepare("PRAGMA table_info(standard_definition_overrides)").all() as Array<{ name: string }>).map((row) => row.name);
      expect(columns).toEqual(
        expect.arrayContaining(["checkId", "name", "category", "licensePreset", "updatedAt", "updatedBy"]),
      );
    } finally {
      raw.close();
    }
  });
});
