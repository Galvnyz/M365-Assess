// Role change requests repository (EPIC-013 SPEC §3.3, §4.3, §5, §11.1; T-0245).
//
// Tracks role activation, schedule, and assignment requests with native pending-approval state.
import Database from "better-sqlite3";
import {
  SchemaVersionError,
  type RoleChangeRequest,
  type RoleChangeRequestInput,
  type RoleChangeRequestState,
  type RoleChangeRequestUpdate,
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

export interface RoleRequestsRepository {
  readonly schemaVersion: number;

  close(): void;

  createRequest(input: RoleChangeRequestInput): Promise<RoleChangeRequest>;
  getRequest(tenantId: string, id: string): Promise<RoleChangeRequest | undefined>;
  listRequests(
    tenantId: string,
    filter?: { principalId?: string; state?: RoleChangeRequestState },
  ): Promise<RoleChangeRequest[]>;
  updateRequest(
    tenantId: string,
    id: string,
    update: RoleChangeRequestUpdate,
  ): Promise<RoleChangeRequest | undefined>;
}

export class SqliteRoleRequestsRepository implements RoleRequestsRepository {
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

  private mapRequest(row: Row): RoleChangeRequest {
    return {
      id: asString(row["id"]),
      tenantId: asString(row["tenantId"]),
      principalId: asString(row["principalId"]),
      roleId: asString(row["roleId"]),
      action: asString(row["action"]) as RoleChangeRequest["action"],
      state: asString(row["state"]) as RoleChangeRequestState,
      justification: asString(row["justification"]),
      durationHours: asNumber(row["durationHours"]),
      ticketNumber: asNullableString(row["ticketNumber"]),
      approverId: asNullableString(row["approverId"]),
      rejectionReason: asNullableString(row["rejectionReason"]),
      createdAt: asString(row["createdAt"]),
      updatedAt: asString(row["updatedAt"]),
      startsAt: asNullableString(row["startsAt"]),
      endsAt: asNullableString(row["endsAt"]),
    };
  }

  async createRequest(input: RoleChangeRequestInput): Promise<RoleChangeRequest> {
    const instant = nowIso();
    this.db
      .prepare(
        `INSERT INTO role_change_requests (
           id, tenantId, principalId, roleId, action, state, justification,
           durationHours, ticketNumber, approverId, rejectionReason,
           createdAt, updatedAt, startsAt, endsAt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.tenantId,
        input.principalId,
        input.roleId,
        input.action,
        input.state,
        input.justification,
        input.durationHours ?? 8,
        input.ticketNumber ?? null,
        input.approverId ?? null,
        input.rejectionReason ?? null,
        input.createdAt ?? instant,
        input.updatedAt ?? instant,
        input.startsAt ?? null,
        input.endsAt ?? null,
      );

    const created = await this.getRequest(input.tenantId, input.id);
    if (!created) throw new Error(`role change request ${input.id} was not persisted`);
    return created;
  }

  async getRequest(tenantId: string, id: string): Promise<RoleChangeRequest | undefined> {
    const row = this.db
      .prepare("SELECT * FROM role_change_requests WHERE tenantId = ? AND id = ?")
      .get(tenantId, id) as Row | undefined;
    return row ? this.mapRequest(row) : undefined;
  }

  async listRequests(
    tenantId: string,
    filter?: { principalId?: string; state?: RoleChangeRequestState },
  ): Promise<RoleChangeRequest[]> {
    let query = "SELECT * FROM role_change_requests WHERE tenantId = ?";
    const params: unknown[] = [tenantId];

    if (filter?.principalId) {
      query += " AND principalId = ?";
      params.push(filter.principalId);
    }
    if (filter?.state) {
      query += " AND state = ?";
      params.push(filter.state);
    }

    query += " ORDER BY createdAt DESC";

    const rows = this.db.prepare(query).all(...params) as Row[];
    return rows.map((r) => this.mapRequest(r));
  }

  async updateRequest(
    tenantId: string,
    id: string,
    update: RoleChangeRequestUpdate,
  ): Promise<RoleChangeRequest | undefined> {
    const existing = await this.getRequest(tenantId, id);
    if (!existing) return undefined;

    const newState = update.state ?? existing.state;
    const newApprover = update.approverId !== undefined ? update.approverId : existing.approverId;
    const newRejection =
      update.rejectionReason !== undefined ? update.rejectionReason : existing.rejectionReason;
    const newStartsAt = update.startsAt !== undefined ? update.startsAt : existing.startsAt;
    const newEndsAt = update.endsAt !== undefined ? update.endsAt : existing.endsAt;

    this.db
      .prepare(
        `UPDATE role_change_requests
         SET state = ?, approverId = ?, rejectionReason = ?, startsAt = ?, endsAt = ?, updatedAt = ?
         WHERE tenantId = ? AND id = ?`,
      )
      .run(newState, newApprover, newRejection, newStartsAt, newEndsAt, nowIso(), tenantId, id);

    return this.getRequest(tenantId, id);
  }
}

export async function openSqliteRoleRequestsRepository(
  options: OpenSqliteRepositoryOptions,
): Promise<SqliteRoleRequestsRepository> {
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
    return new SqliteRoleRequestsRepository(db, applied);
  } catch (error) {
    db.close();
    throw error;
  }
}
