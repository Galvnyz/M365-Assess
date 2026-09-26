// JIT admin grants repository (EPIC-013 SPEC §3.4, §4.4, §5, §11.2; T-0246).
//
// Tracks bounded, expiring JIT grants. Grants are advisory and never remove permanent roles.
import Database from "better-sqlite3";
import {
  SchemaVersionError,
  type JitAssignmentType,
  type JitGrant,
  type JitGrantInput,
  type JitGrantState,
  type JitGrantUpdate,
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

export interface JitRepository {
  readonly schemaVersion: number;

  close(): void;

  createGrant(input: JitGrantInput): Promise<JitGrant>;
  getGrant(tenantId: string, id: string): Promise<JitGrant | undefined>;
  getGrantById(id: string): Promise<JitGrant | undefined>;
  listGrants(
    tenantId: string,
    filter?: { userId?: string; state?: JitGrantState },
  ): Promise<JitGrant[]>;
  updateGrant(id: string, update: JitGrantUpdate): Promise<JitGrant | undefined>;
}

export class SqliteJitRepository implements JitRepository {
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

  private mapGrant(row: Row): JitGrant {
    return {
      id: asString(row["id"]),
      tenantId: asString(row["tenantId"]),
      userId: asString(row["userId"]),
      roleId: asString(row["roleId"]),
      templateId: asNullableString(row["templateId"]),
      assignmentType: asString(row["assignmentType"]) as JitAssignmentType,
      startsAt: asString(row["startsAt"]),
      endsAt: asString(row["endsAt"]),
      durationHours: asNumber(row["durationHours"]),
      maxDurationHours: asNumber(row["maxDurationHours"]),
      state: asString(row["state"]) as JitGrantState,
      justification: asNullableString(row["justification"]),
      createdBy: asString(row["createdBy"]),
      createdAt: asString(row["createdAt"]),
      updatedAt: asString(row["updatedAt"]),
      revokedAt: asNullableString(row["revokedAt"]),
      revokedBy: asNullableString(row["revokedBy"]),
    };
  }

  async createGrant(input: JitGrantInput): Promise<JitGrant> {
    const instant = nowIso();
    this.db
      .prepare(
        `INSERT INTO jit_grants (
           id, tenantId, userId, roleId, templateId, assignmentType,
           startsAt, endsAt, durationHours, maxDurationHours, state,
           justification, createdBy, createdAt, updatedAt, revokedAt, revokedBy
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.tenantId,
        input.userId,
        input.roleId,
        input.templateId ?? null,
        input.assignmentType ?? "eligible",
        input.startsAt,
        input.endsAt,
        input.durationHours ?? 8,
        input.maxDurationHours ?? 24,
        input.state ?? "active",
        input.justification ?? null,
        input.createdBy,
        input.createdAt ?? instant,
        input.updatedAt ?? instant,
        null,
        null,
      );

    const created = await this.getGrantById(input.id);
    if (!created) throw new Error(`JIT grant ${input.id} was not persisted`);
    return created;
  }

  async getGrant(tenantId: string, id: string): Promise<JitGrant | undefined> {
    const row = this.db
      .prepare("SELECT * FROM jit_grants WHERE tenantId = ? AND id = ?")
      .get(tenantId, id) as Row | undefined;
    return row ? this.mapGrant(row) : undefined;
  }

  async getGrantById(id: string): Promise<JitGrant | undefined> {
    const row = this.db
      .prepare("SELECT * FROM jit_grants WHERE id = ?")
      .get(id) as Row | undefined;
    return row ? this.mapGrant(row) : undefined;
  }

  async listGrants(
    tenantId: string,
    filter?: { userId?: string; state?: JitGrantState },
  ): Promise<JitGrant[]> {
    let query = "SELECT * FROM jit_grants WHERE tenantId = ?";
    const params: unknown[] = [tenantId];

    if (filter?.userId) {
      query += " AND userId = ?";
      params.push(filter.userId);
    }
    if (filter?.state) {
      query += " AND state = ?";
      params.push(filter.state);
    }

    query += " ORDER BY createdAt DESC";

    const rows = this.db.prepare(query).all(...params) as Row[];
    return rows.map((r) => this.mapGrant(r));
  }

  async updateGrant(id: string, update: JitGrantUpdate): Promise<JitGrant | undefined> {
    const existing = await this.getGrantById(id);
    if (!existing) return undefined;

    const newState = update.state ?? existing.state;
    const newEndsAt = update.endsAt !== undefined ? update.endsAt : existing.endsAt;
    const newDuration =
      update.durationHours !== undefined ? update.durationHours : existing.durationHours;
    const newRevokedAt =
      update.revokedAt !== undefined ? update.revokedAt : existing.revokedAt;
    const newRevokedBy =
      update.revokedBy !== undefined ? update.revokedBy : existing.revokedBy;

    this.db
      .prepare(
        `UPDATE jit_grants
         SET state = ?, endsAt = ?, durationHours = ?, revokedAt = ?, revokedBy = ?, updatedAt = ?
         WHERE id = ?`,
      )
      .run(newState, newEndsAt, newDuration, newRevokedAt, newRevokedBy, nowIso(), id);

    return this.getGrantById(id);
  }
}

export async function openSqliteJitRepository(
  options: OpenSqliteRepositoryOptions,
): Promise<SqliteJitRepository> {
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
    return new SqliteJitRepository(db, applied);
  } catch (error) {
    db.close();
    throw error;
  }
}
