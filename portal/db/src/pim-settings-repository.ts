// PIM role settings template repository (EPIC-013 SPEC §3.2, §5; T-0243).
//
// Persists PimRoleSettingsTemplate (id, name, roleId, settings, scope)
// with soft delete. Templates are reusable role settings (maximum duration,
// MFA, justification, approval). In v1, templates are per-role (scope = '/').
import Database from "better-sqlite3";
import {
  SchemaVersionError,
  type PimRoleSettings,
  type PimRoleSettingsTemplate,
  type PimRoleSettingsTemplateInput,
  type PimRoleSettingsTemplateUpdate,
} from "./repository.js";
import {
  SCHEMA_VERSIONS_TABLE,
  loadMigrations,
  runMigrations,
  type OpenSqliteRepositoryOptions,
} from "./sqlite-repository.js";

type Row = Record<string, unknown>;

function nowIso(): string {
  return new Date().toISOString();
}

function asString(value: unknown): string {
  return String(value);
}

function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function parseJsonObject<T extends Record<string, unknown>>(value: unknown): T {
  if (value === null || value === undefined) return {} as T;
  try {
    const parsed: unknown = JSON.parse(String(value));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as T)
      : ({} as T);
  } catch {
    return {} as T;
  }
}

export interface PimSettingsRepository {
  readonly schemaVersion: number;

  close(): void;

  createTemplate(input: PimRoleSettingsTemplateInput): Promise<PimRoleSettingsTemplate>;
  getTemplate(
    id: string,
    options?: { includeDeleted?: boolean },
  ): Promise<PimRoleSettingsTemplate | undefined>;
  listTemplates(options?: { includeDeleted?: boolean }): Promise<PimRoleSettingsTemplate[]>;
  updateTemplate(
    id: string,
    update: PimRoleSettingsTemplateUpdate,
  ): Promise<PimRoleSettingsTemplate | undefined>;
  softDeleteTemplate(id: string, options?: { now?: string }): Promise<boolean>;
}

export class SqlitePimSettingsRepository implements PimSettingsRepository {
  readonly schemaVersion: number;

  constructor(
    private readonly db: Database.Database,
    schemaVersion: number,
  ) {
    this.schemaVersion = schemaVersion;
  }

  close(): void {
    this.db.close();
  }

  private mapTemplate(row: Row): PimRoleSettingsTemplate {
    return {
      id: asString(row["id"]),
      name: asString(row["name"]),
      roleId: asNullableString(row["roleId"]),
      settings: parseJsonObject<PimRoleSettings>(row["settings"]),
      scope: asString(row["scope"] ?? "/"),
      createdAt: asString(row["createdAt"]),
      updatedAt: asString(row["updatedAt"]),
      deletedAt: asNullableString(row["deletedAt"]),
    };
  }

  async createTemplate(
    input: PimRoleSettingsTemplateInput,
  ): Promise<PimRoleSettingsTemplate> {
    const instant = nowIso();
    const scope = input.scope ?? "/";
    this.db
      .prepare(
        `INSERT INTO pim_settings_templates (id, name, roleId, settings, scope, createdAt, updatedAt, deletedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.name,
        input.roleId ?? null,
        JSON.stringify(input.settings ?? {}),
        scope,
        input.createdAt ?? instant,
        input.updatedAt ?? instant,
        input.deletedAt ?? null,
      );
    const created = await this.getTemplate(input.id, { includeDeleted: true });
    if (!created) throw new Error(`PIM settings template ${input.id} was not persisted`);
    return created;
  }

  async getTemplate(
    id: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<PimRoleSettingsTemplate | undefined> {
    const row = this.db
      .prepare(
        options.includeDeleted
          ? "SELECT * FROM pim_settings_templates WHERE id = ?"
          : "SELECT * FROM pim_settings_templates WHERE id = ? AND deletedAt IS NULL",
      )
      .get(id) as Row | undefined;
    return row ? this.mapTemplate(row) : undefined;
  }

  async listTemplates(
    options: { includeDeleted?: boolean } = {},
  ): Promise<PimRoleSettingsTemplate[]> {
    return (
      this.db
        .prepare(
          options.includeDeleted
            ? "SELECT * FROM pim_settings_templates ORDER BY name, id"
            : "SELECT * FROM pim_settings_templates WHERE deletedAt IS NULL ORDER BY name, id",
        )
        .all() as Row[]
    ).map((row) => this.mapTemplate(row));
  }

  async updateTemplate(
    id: string,
    update: PimRoleSettingsTemplateUpdate,
  ): Promise<PimRoleSettingsTemplate | undefined> {
    const existing = await this.getTemplate(id);
    if (!existing) return undefined;

    const newScope = update.scope !== undefined ? update.scope : existing.scope;
    const newRoleId = update.roleId !== undefined ? update.roleId : existing.roleId;

    this.db
      .prepare(
        `UPDATE pim_settings_templates
         SET name = ?, roleId = ?, settings = ?, scope = ?, updatedAt = ?
         WHERE id = ? AND deletedAt IS NULL`,
      )
      .run(
        update.name ?? existing.name,
        newRoleId,
        JSON.stringify(update.settings ?? existing.settings),
        newScope,
        nowIso(),
        id,
      );
    return this.getTemplate(id);
  }

  async softDeleteTemplate(
    id: string,
    options: { now?: string } = {},
  ): Promise<boolean> {
    const result = this.db
      .prepare(
        "UPDATE pim_settings_templates SET deletedAt = ? WHERE id = ? AND deletedAt IS NULL",
      )
      .run(options.now ?? nowIso(), id);
    return result.changes > 0;
  }
}

export async function openSqlitePimSettingsRepository(
  options: OpenSqliteRepositoryOptions,
): Promise<SqlitePimSettingsRepository> {
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
    const existing = row?.version === null || row?.version === undefined ? 0 : asNumber(row.version);
    if (existing > target) {
      throw new SchemaVersionError(existing, target);
    }
    const applied = runMigrations(db, migrations);
    if (applied !== target) {
      throw new SchemaVersionError(applied, target);
    }
    return new SqlitePimSettingsRepository(db, applied);
  } catch (error) {
    db.close();
    throw error;
  }
}
