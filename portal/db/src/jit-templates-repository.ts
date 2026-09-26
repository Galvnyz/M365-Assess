// JIT admin templates repository (EPIC-013 SPEC §3.4, §5; T-0247).
//
// Persists reusable JIT admin templates defining allowed roles, duration, and justification/approval flags.
import Database from "better-sqlite3";
import {
  SchemaVersionError,
  type JitAdminTemplate,
  type JitAdminTemplateInput,
  type JitAdminTemplateUpdate,
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

function parseStringArray(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

export interface JitTemplatesRepository {
  readonly schemaVersion: number;

  close(): void;

  createTemplate(input: JitAdminTemplateInput): Promise<JitAdminTemplate>;
  getTemplate(
    id: string,
    options?: { includeDeleted?: boolean },
  ): Promise<JitAdminTemplate | undefined>;
  listTemplates(options?: { includeDeleted?: boolean }): Promise<JitAdminTemplate[]>;
  updateTemplate(
    id: string,
    update: JitAdminTemplateUpdate,
  ): Promise<JitAdminTemplate | undefined>;
  softDeleteTemplate(id: string, options?: { now?: string }): Promise<boolean>;
}

export class SqliteJitTemplatesRepository implements JitTemplatesRepository {
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

  private mapTemplate(row: Row): JitAdminTemplate {
    return {
      id: asString(row["id"]),
      name: asString(row["name"]),
      description: asNullableString(row["description"]),
      allowedRoles: parseStringArray(row["allowedRoles"]),
      duration: asNumber(row["duration"]),
      maxDuration: asNumber(row["maxDuration"]),
      justificationRequired: Boolean(row["justificationRequired"]),
      approvalRequired: Boolean(row["approvalRequired"]),
      createdAt: asString(row["createdAt"]),
      updatedAt: asString(row["updatedAt"]),
      deletedAt: asNullableString(row["deletedAt"]),
    };
  }

  async createTemplate(input: JitAdminTemplateInput): Promise<JitAdminTemplate> {
    const instant = nowIso();
    this.db
      .prepare(
        `INSERT INTO jit_templates (
           id, name, description, allowedRoles, duration, maxDuration,
           justificationRequired, approvalRequired, createdAt, updatedAt, deletedAt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.name,
        input.description ?? null,
        JSON.stringify(input.allowedRoles ?? []),
        input.duration ?? 8,
        input.maxDuration ?? 24,
        input.justificationRequired !== false ? 1 : 0,
        input.approvalRequired === true ? 1 : 0,
        input.createdAt ?? instant,
        input.updatedAt ?? instant,
        null,
      );

    const created = await this.getTemplate(input.id);
    if (!created) throw new Error(`JIT template ${input.id} was not persisted`);
    return created;
  }

  async getTemplate(
    id: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<JitAdminTemplate | undefined> {
    const row = this.db
      .prepare(
        options.includeDeleted
          ? "SELECT * FROM jit_templates WHERE id = ?"
          : "SELECT * FROM jit_templates WHERE id = ? AND deletedAt IS NULL",
      )
      .get(id) as Row | undefined;
    return row ? this.mapTemplate(row) : undefined;
  }

  async listTemplates(
    options: { includeDeleted?: boolean } = {},
  ): Promise<JitAdminTemplate[]> {
    return (
      this.db
        .prepare(
          options.includeDeleted
            ? "SELECT * FROM jit_templates ORDER BY name, id"
            : "SELECT * FROM jit_templates WHERE deletedAt IS NULL ORDER BY name, id",
        )
        .all() as Row[]
    ).map((row) => this.mapTemplate(row));
  }

  async updateTemplate(
    id: string,
    update: JitAdminTemplateUpdate,
  ): Promise<JitAdminTemplate | undefined> {
    const existing = await this.getTemplate(id);
    if (!existing) return undefined;

    const newName = update.name ?? existing.name;
    const newDesc = update.description !== undefined ? update.description : existing.description;
    const newRoles = update.allowedRoles ?? existing.allowedRoles;
    const newDuration = update.duration ?? existing.duration;
    const newMaxDuration = update.maxDuration ?? existing.maxDuration;
    const newJust =
      update.justificationRequired !== undefined
        ? update.justificationRequired
        : existing.justificationRequired;
    const newAppr =
      update.approvalRequired !== undefined
        ? update.approvalRequired
        : existing.approvalRequired;

    this.db
      .prepare(
        `UPDATE jit_templates
         SET name = ?, description = ?, allowedRoles = ?, duration = ?, maxDuration = ?,
             justificationRequired = ?, approvalRequired = ?, updatedAt = ?
         WHERE id = ? AND deletedAt IS NULL`,
      )
      .run(
        newName,
        newDesc,
        JSON.stringify(newRoles),
        newDuration,
        newMaxDuration,
        newJust ? 1 : 0,
        newAppr ? 1 : 0,
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
      .prepare("UPDATE jit_templates SET deletedAt = ? WHERE id = ? AND deletedAt IS NULL")
      .run(options.now ?? nowIso(), id);
    return result.changes > 0;
  }
}

export async function openSqliteJitTemplatesRepository(
  options: OpenSqliteRepositoryOptions,
): Promise<SqliteJitTemplatesRepository> {
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
    return new SqliteJitTemplatesRepository(db, applied);
  } catch (error) {
    db.close();
    throw error;
  }
}
