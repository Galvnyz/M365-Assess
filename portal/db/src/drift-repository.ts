// Drift storage (EPIC-009 SPEC.md §5, §11.1). A drift template is a
// StandardTemplate with kind='drift'; this repository owns the per-tenant
// binding that enforces "at most one drift template per tenant" and makes drift
// opt-in (a tenant with no binding has no drift state).
//
// The template rows themselves are managed through the standards repository, so
// standards and drift share one template storage and one settings shape. The
// DriftTemplate shape mirrors portal/contracts/src/drift.ts; that module is not
// an exported subpath of @m365-assess/contracts, so the shape is restated here.
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { SchemaVersionError } from "./repository.js";
import {
  SCHEMA_VERSIONS_TABLE,
  loadMigrations,
  runMigrations,
  type OpenSqliteRepositoryOptions,
} from "./sqlite-repository.js";
import {
  DEFAULT_STANDARDS_REGISTRY_PATH,
  SqliteStandardsRepository,
  type StandardTemplate,
  type StandardTemplateSetting,
} from "./standards-repository.js";

export interface DriftTemplate {
  readonly tenantId: string;
  readonly template: StandardTemplate;
  readonly seededFrom: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CloneToSeedOptions {
  /** New template name; defaults to "<source> (drift)". */
  readonly name?: string;
  /** Actor recorded as the template author. */
  readonly createdBy?: string;
}

/** Raised when a second, different drift template is bound to a tenant. */
export class DriftTemplateExistsError extends Error {
  readonly code = "drift.template_exists";

  constructor(tenantId: string, templateId: string) {
    super(`tenant ${tenantId} already has drift template ${templateId}`);
    this.name = "DriftTemplateExistsError";
  }
}

/** Raised when a tenant is bound to a template that is not a drift kind. */
export class DriftTemplateKindError extends Error {
  readonly code = "drift.template_not_drift";

  constructor(templateId: string) {
    super(`template ${templateId} is not a drift template`);
    this.name = "DriftTemplateKindError";
  }
}

export interface DriftRepositoryOptions extends OpenSqliteRepositoryOptions {
  registryPath?: string;
}

export interface DriftRepository {
  readonly schemaVersion: number;

  close(): void;

  /** The tenant's drift template, or undefined when drift is not enabled. */
  getDriftTemplate(tenantId: string): Promise<DriftTemplate | undefined>;
  hasDriftTemplate(tenantId: string): Promise<boolean>;
  listDriftTemplates(): Promise<DriftTemplate[]>;

  /** Bind an existing drift template to a tenant (one per tenant). */
  bindDriftTemplate(
    tenantId: string,
    templateId: string,
    options?: { seededFrom?: string | null },
  ): Promise<DriftTemplate>;

  /** Seed a new tenant's drift template by cloning an existing template. */
  cloneToSeed(
    sourceTemplateId: string,
    tenantId: string,
    options?: CloneToSeedOptions,
  ): Promise<DriftTemplate>;

  /** Remove a tenant's drift binding (opt out). The template row is kept. */
  unbindDriftTemplate(tenantId: string): Promise<boolean>;
}

type Row = Record<string, unknown>;

function asString(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function asNullableString(value: unknown): string | null {
  return value === null || value === undefined || value === "" ? null : String(value);
}

function deepCopySettings(
  settings: readonly StandardTemplateSetting[],
): StandardTemplateSetting[] {
  return settings.map((setting) => ({
    key: setting.key,
    value: structuredClone(setting.value),
  }));
}

export class SqliteDriftRepository implements DriftRepository {
  readonly schemaVersion: number;
  private readonly standards: SqliteStandardsRepository;

  constructor(
    private readonly db: Database.Database,
    schemaVersion: number,
    registryPath: string,
  ) {
    this.schemaVersion = schemaVersion;
    this.standards = new SqliteStandardsRepository(db, schemaVersion, registryPath);
  }

  close(): void {
    this.db.close();
  }

  private async hydrate(row: Row): Promise<DriftTemplate | undefined> {
    const templateId = asString(row["templateId"]);
    const template = await this.standards.getStandardTemplate(templateId);
    if (!template) return undefined;
    return {
      tenantId: asString(row["tenantId"]),
      template,
      seededFrom: asNullableString(row["seededFrom"]),
      createdAt: asString(row["createdAt"]),
      updatedAt: asString(row["updatedAt"]),
    };
  }

  async getDriftTemplate(tenantId: string): Promise<DriftTemplate | undefined> {
    const row = this.db
      .prepare("SELECT * FROM drift_templates WHERE tenantId = ?")
      .get(tenantId) as Row | undefined;
    return row ? this.hydrate(row) : undefined;
  }

  async hasDriftTemplate(tenantId: string): Promise<boolean> {
    const row = this.db
      .prepare("SELECT 1 AS present FROM drift_templates WHERE tenantId = ?")
      .get(tenantId) as Row | undefined;
    return row !== undefined;
  }

  async listDriftTemplates(): Promise<DriftTemplate[]> {
    const rows = this.db
      .prepare("SELECT * FROM drift_templates ORDER BY tenantId")
      .all() as Row[];
    const result: DriftTemplate[] = [];
    for (const row of rows) {
      const hydrated = await this.hydrate(row);
      if (hydrated) result.push(hydrated);
    }
    return result;
  }

  async bindDriftTemplate(
    tenantId: string,
    templateId: string,
    options: { seededFrom?: string | null } = {},
  ): Promise<DriftTemplate> {
    const template = await this.standards.getStandardTemplate(templateId);
    if (!template) {
      throw new Error(`drift template ${templateId} was not found`);
    }
    if (template.kind !== "drift") {
      throw new DriftTemplateKindError(templateId);
    }

    const existing = await this.getDriftTemplate(tenantId);
    if (existing) {
      // Idempotent for the same template; a different one is rejected so the
      // one-per-tenant invariant can never be silently replaced.
      if (existing.template.id === templateId) return existing;
      throw new DriftTemplateExistsError(tenantId, existing.template.id);
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO drift_templates (tenantId, templateId, seededFrom, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(tenantId, templateId, options.seededFrom ?? null, now, now);

    const bound = await this.getDriftTemplate(tenantId);
    if (!bound) {
      throw new Error(`drift template binding for ${tenantId} was not persisted`);
    }
    return bound;
  }

  async cloneToSeed(
    sourceTemplateId: string,
    tenantId: string,
    options: CloneToSeedOptions = {},
  ): Promise<DriftTemplate> {
    const source = await this.standards.getStandardTemplate(sourceTemplateId);
    if (!source) {
      throw new Error(`source template ${sourceTemplateId} was not found`);
    }
    // Drift is opt-in: seeding a tenant that already has a drift template is a
    // conflict, not an overwrite.
    if (await this.hasDriftTemplate(tenantId)) {
      const existing = await this.getDriftTemplate(tenantId);
      throw new DriftTemplateExistsError(tenantId, existing?.template.id ?? sourceTemplateId);
    }

    const seeded = await this.standards.createStandardTemplate({
      id: randomUUID(),
      name: options.name ?? `${source.name} (drift)`,
      kind: "drift",
      // Drift is report-only by default (SPEC §11.5): the clone keeps the source's
      // per-setting auto-remediation flags (carried in settings) but never
      // inherits a blanket autoRemediate.
      actions: { report: true, alert: source.actions.alert, remediate: false },
      autoRemediate: false,
      settings: deepCopySettings(source.settings),
      scheduleId: null,
    });

    return this.bindDriftTemplate(tenantId, seeded.id, { seededFrom: sourceTemplateId });
  }

  async unbindDriftTemplate(tenantId: string): Promise<boolean> {
    const result = this.db
      .prepare("DELETE FROM drift_templates WHERE tenantId = ?")
      .run(tenantId);
    return result.changes > 0;
  }
}

export async function openSqliteDriftRepository(
  options: DriftRepositoryOptions,
): Promise<SqliteDriftRepository> {
  const migrations = options.migrations ?? loadMigrations(options.migrationsDir);
  const target = migrations.reduce((max, migration) => Math.max(max, migration.version), 0);
  const db = new Database(options.filename);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA_VERSIONS_TABLE);
    const row = db
      .prepare("SELECT MAX(version) AS version FROM schema_versions")
      .get() as { version: number | null } | undefined;
    const existing = row?.version === null || row?.version === undefined ? 0 : Number(row.version);
    if (existing > target) {
      throw new SchemaVersionError(existing, target);
    }
    const applied = runMigrations(db, migrations);
    if (applied !== target) {
      throw new SchemaVersionError(applied, target);
    }
    return new SqliteDriftRepository(
      db,
      applied,
      options.registryPath ?? DEFAULT_STANDARDS_REGISTRY_PATH,
    );
  } catch (error) {
    db.close();
    throw error;
  }
}
