// User template store (EPIC-011 SPEC.md §3.5, §5 US-7; T-0208).
//
// Persists UserTemplate (id, name, properties, licenses, groups,
// offboardingDefaults) with soft delete. Templates seed creation defaults and
// offboarding defaults for the create path (T-0202) and the plan builder
// (T-0205); a template never writes to a tenant on its own.
import Database from "better-sqlite3";
import {
  SchemaVersionError,
  type UserTemplate,
  type UserTemplateInput,
  type UserTemplateUpdate,
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

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  try {
    const parsed: unknown = JSON.parse(String(value));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseStringArray(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

export interface UserTemplateRepository {
  readonly schemaVersion: number;

  close(): void;

  createUserTemplate(input: UserTemplateInput): Promise<UserTemplate>;
  getUserTemplate(templateId: string, options?: { includeDeleted?: boolean }): Promise<UserTemplate | undefined>;
  listUserTemplates(options?: { includeDeleted?: boolean }): Promise<UserTemplate[]>;
  updateUserTemplate(templateId: string, update: UserTemplateUpdate): Promise<UserTemplate | undefined>;
  softDeleteUserTemplate(templateId: string, options?: { now?: string }): Promise<boolean>;
}

export class SqliteUserTemplateRepository implements UserTemplateRepository {
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

  private mapTemplate(row: Row): UserTemplate {
    return {
      id: asString(row["id"]),
      name: asString(row["name"]),
      properties: parseJsonObject(row["properties"]),
      licenses: parseStringArray(row["licenses"]),
      groups: parseStringArray(row["groups"]),
      offboardingDefaults: parseJsonObject(row["offboardingDefaults"]),
      createdAt: asString(row["createdAt"]),
      updatedAt: asString(row["updatedAt"]),
      deletedAt: asNullableString(row["deletedAt"]),
    };
  }

  async createUserTemplate(input: UserTemplateInput): Promise<UserTemplate> {
    const instant = nowIso();
    this.db
      .prepare(
        `INSERT INTO user_templates (id, name, properties, licenses, groups, offboardingDefaults, createdAt, updatedAt, deletedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.name,
        JSON.stringify(input.properties ?? {}),
        JSON.stringify(input.licenses ?? []),
        JSON.stringify(input.groups ?? []),
        JSON.stringify(input.offboardingDefaults ?? {}),
        input.createdAt ?? instant,
        input.updatedAt ?? instant,
        input.deletedAt ?? null,
      );
    const created = await this.getUserTemplate(input.id, { includeDeleted: true });
    if (!created) throw new Error(`user template ${input.id} was not persisted`);
    return created;
  }

  async getUserTemplate(
    templateId: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<UserTemplate | undefined> {
    const row = this.db
      .prepare(
        options.includeDeleted
          ? "SELECT * FROM user_templates WHERE id = ?"
          : "SELECT * FROM user_templates WHERE id = ? AND deletedAt IS NULL",
      )
      .get(templateId) as Row | undefined;
    return row ? this.mapTemplate(row) : undefined;
  }

  async listUserTemplates(
    options: { includeDeleted?: boolean } = {},
  ): Promise<UserTemplate[]> {
    return (
      this.db
        .prepare(
          options.includeDeleted
            ? "SELECT * FROM user_templates ORDER BY name, id"
            : "SELECT * FROM user_templates WHERE deletedAt IS NULL ORDER BY name, id",
        )
        .all() as Row[]
    ).map((row) => this.mapTemplate(row));
  }

  async updateUserTemplate(
    templateId: string,
    update: UserTemplateUpdate,
  ): Promise<UserTemplate | undefined> {
    const existing = await this.getUserTemplate(templateId);
    if (!existing) return undefined;
    this.db
      .prepare(
        `UPDATE user_templates
         SET name = ?, properties = ?, licenses = ?, groups = ?, offboardingDefaults = ?, updatedAt = ?
         WHERE id = ? AND deletedAt IS NULL`,
      )
      .run(
        update.name ?? existing.name,
        JSON.stringify(update.properties ?? existing.properties),
        JSON.stringify(update.licenses ?? existing.licenses),
        JSON.stringify(update.groups ?? existing.groups),
        JSON.stringify(update.offboardingDefaults ?? existing.offboardingDefaults),
        nowIso(),
        templateId,
      );
    return this.getUserTemplate(templateId);
  }

  async softDeleteUserTemplate(templateId: string, options: { now?: string } = {}): Promise<boolean> {
    const result = this.db
      .prepare("UPDATE user_templates SET deletedAt = ? WHERE id = ? AND deletedAt IS NULL")
      .run(options.now ?? nowIso(), templateId);
    return result.changes > 0;
  }
}

export async function openSqliteUserTemplateRepository(
  options: OpenSqliteRepositoryOptions,
): Promise<SqliteUserTemplateRepository> {
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
    return new SqliteUserTemplateRepository(db, applied);
  } catch (error) {
    db.close();
    throw error;
  }
}
