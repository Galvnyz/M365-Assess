// T-0161 — drift template (one per tenant) with clone-to-seed.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  DriftTemplateExistsError,
  DriftTemplateKindError,
  openSqliteDriftRepository,
} from "./drift-repository.js";
import {
  DEFAULT_STANDARDS_REGISTRY_PATH,
  openSqliteStandardsRepository,
} from "./standards-repository.js";
import { loadMigrations } from "./sqlite-repository.js";

const TENANT_1 = "11111111-1111-1111-1111-111111111111";
const TENANT_2 = "22222222-2222-2222-2222-222222222222";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "m365-drift-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

async function openRepo(dir: string) {
  return openSqliteDriftRepository({
    filename: join(dir, "portal.db"),
    registryPath: DEFAULT_STANDARDS_REGISTRY_PATH,
  });
}

/** Creates a source drift template with settings via the standards repo. */
async function seedSourceTemplate(filename: string, id = "drift-src"): Promise<string> {
  const standards = await openSqliteStandardsRepository({
    filename,
    registryPath: DEFAULT_STANDARDS_REGISTRY_PATH,
  });
  try {
    await standards.createStandardTemplate({
      id,
      name: "Source desired state",
      kind: "drift",
      actions: { report: true, alert: true, remediate: false },
      autoRemediate: false,
      settings: [
        { key: "CA-REPORTONLY-001", value: { state: "enabled", autoRemediate: true } },
        { key: "ENTRA-SECDEFAULT-001", value: { state: "enabled" } },
      ],
    });
  } finally {
    standards.close();
  }
  return id;
}

describe("drift template binding (T-0161)", () => {
  it("is opt-in: a tenant with no binding has no drift template", async () => {
    const dir = tempDir();
    const repo = await openRepo(dir);
    try {
      expect(await repo.getDriftTemplate(TENANT_1)).toBeUndefined();
      expect(await repo.hasDriftTemplate(TENANT_1)).toBe(false);
      expect(await repo.listDriftTemplates()).toEqual([]);
    } finally {
      repo.close();
    }
  });

  it("enforces at most one drift template per tenant", async () => {
    const dir = tempDir();
    const filename = join(dir, "portal.db");
    await seedSourceTemplate(filename, "drift-src");
    await seedSourceTemplate(filename, "drift-other");

    const repo = await openRepo(dir);
    try {
      await repo.bindDriftTemplate(TENANT_1, "drift-src", { seededFrom: null });
      expect((await repo.getDriftTemplate(TENANT_1))?.template.id).toBe("drift-src");

      // Re-binding the SAME template is idempotent.
      const again = await repo.bindDriftTemplate(TENANT_1, "drift-src");
      expect(again.template.id).toBe("drift-src");

      // A different template is rejected.
      await expect(repo.bindDriftTemplate(TENANT_1, "drift-other")).rejects.toBeInstanceOf(
        DriftTemplateExistsError,
      );
      expect((await repo.getDriftTemplate(TENANT_1))?.template.id).toBe("drift-src");
    } finally {
      repo.close();
    }
  });

  it("rejects binding a non-drift template", async () => {
    const dir = tempDir();
    const filename = join(dir, "portal.db");
    const standards = await openSqliteStandardsRepository({
      filename,
      registryPath: DEFAULT_STANDARDS_REGISTRY_PATH,
    });
    try {
      await standards.createStandardTemplate({ id: "std-1", name: "Standards", kind: "standards" });
    } finally {
      standards.close();
    }
    const repo = await openRepo(dir);
    try {
      await expect(repo.bindDriftTemplate(TENANT_1, "std-1")).rejects.toBeInstanceOf(
        DriftTemplateKindError,
      );
    } finally {
      repo.close();
    }
  });

  it("unbinds a tenant and lists bindings", async () => {
    const dir = tempDir();
    const filename = join(dir, "portal.db");
    await seedSourceTemplate(filename, "drift-src");
    const repo = await openRepo(dir);
    try {
      // A drift template is owned by exactly one tenant, so seeding two tenants
      // from the same source produces two independent templates.
      await repo.cloneToSeed("drift-src", TENANT_1);
      await repo.cloneToSeed("drift-src", TENANT_2);
      expect((await repo.listDriftTemplates()).map((t) => t.tenantId)).toEqual([TENANT_1, TENANT_2]);

      expect(await repo.unbindDriftTemplate(TENANT_1)).toBe(true);
      expect(await repo.hasDriftTemplate(TENANT_1)).toBe(false);
      expect(await repo.unbindDriftTemplate(TENANT_1)).toBe(false);
    } finally {
      repo.close();
    }
  });
});

describe("clone-to-seed (T-0161)", () => {
  it("copies the source template's standards and settings into a new tenant", async () => {
    const dir = tempDir();
    const filename = join(dir, "portal.db");
    await seedSourceTemplate(filename);

    const repo = await openRepo(dir);
    try {
      const seeded = await repo.cloneToSeed("drift-src", TENANT_1, { createdBy: "user-1" });

      expect(seeded.tenantId).toBe(TENANT_1);
      expect(seeded.seededFrom).toBe("drift-src");
      expect(seeded.template.kind).toBe("drift");
      expect(seeded.template.id).not.toBe("drift-src");
      expect(seeded.template.name).toBe("Source desired state (drift)");

      // Standards and settings carried over, including per-setting flags.
      expect(seeded.template.settings.map((s) => s.key)).toEqual([
        "CA-REPORTONLY-001",
        "ENTRA-SECDEFAULT-001",
      ]);
      expect(seeded.template.settings[0]!.value).toEqual({ state: "enabled", autoRemediate: true });

      // Drift is report-only by default, even when cloned.
      expect(seeded.template.autoRemediate).toBe(false);
      expect(seeded.template.actions.remediate).toBe(false);
      expect(seeded.template.actions.report).toBe(true);
    } finally {
      repo.close();
    }
  });

  it("gives the clone an independent settings copy", async () => {
    const dir = tempDir();
    const filename = join(dir, "portal.db");
    await seedSourceTemplate(filename);

    const repo = await openRepo(dir);
    try {
      const seeded = await repo.cloneToSeed("drift-src", TENANT_1);
      // The clone's settings are an independent deep copy, so mutating the clone
      // leaves the source template untouched.
      (seeded.template.settings[0]!.value as { state: string }).state = "mutated";
      const standards = await openSqliteStandardsRepository({
        filename,
        registryPath: DEFAULT_STANDARDS_REGISTRY_PATH,
      });
      try {
        const source = await standards.getStandardTemplate("drift-src");
        expect(source?.settings[0]!.value).toEqual({ state: "enabled", autoRemediate: true });
      } finally {
        standards.close();
      }
      expect(seeded.template.settings[0]!.key).toBe("CA-REPORTONLY-001");
    } finally {
      repo.close();
    }
  });

  it("refuses to seed a tenant that already has a drift template", async () => {
    const dir = tempDir();
    const filename = join(dir, "portal.db");
    await seedSourceTemplate(filename);
    const repo = await openRepo(dir);
    try {
      await repo.cloneToSeed("drift-src", TENANT_1);
      await expect(repo.cloneToSeed("drift-src", TENANT_1)).rejects.toBeInstanceOf(
        DriftTemplateExistsError,
      );
    } finally {
      repo.close();
    }
  });
});

describe("0067 migration (T-0161)", () => {
  it("applies after the head, advances SchemaVersion, and creates the drift tables", async () => {
    const dir = tempDir();
    const migrations = loadMigrations();
    const head = migrations.reduce((max, m) => Math.max(max, m.version), 0);
    expect(migrations.some((m) => m.name === "0067_drift_templates.sql")).toBe(true);

    const filename = join(dir, "portal.db");
    const repo = await openRepo(dir);
    expect(repo.schemaVersion).toBe(head);
    repo.close();

    const raw = new Database(filename);
    try {
      const tables = (
        raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
      ).map((row) => row.name);
      expect(tables).toContain("drift_templates");
      expect(tables).toContain("drift_deviations");
      const columns = (
        raw.prepare("PRAGMA table_info(drift_templates)").all() as { name: string }[]
      ).map((row) => row.name);
      expect(columns).toEqual(
        expect.arrayContaining(["tenantId", "templateId", "seededFrom", "createdAt", "updatedAt"]),
      );
    } finally {
      raw.close();
    }
  });
});
