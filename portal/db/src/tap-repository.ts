// Temporary Access Pass records (EPIC-012 SPEC.md §5; T-0223). Persists only
// the non-secret TAPRecord (id, tenantId, userId, createdAt, createdBy,
// lifetime, oneTime); the pass value itself is returned once in the response
// transport and never stored, logged, or audited. Records are append-only
// metadata with no update or delete path, so there is no audit hook here.
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

// Migration 0079 creates this table for the shared database; the DDL stays
// here (idempotent) for databases opened through openSqliteTapRecordRepository.
const TAP_RECORDS_DDL = `
CREATE TABLE IF NOT EXISTS tap_records (
  id              TEXT PRIMARY KEY,
  tenantId        TEXT NOT NULL,
  userId          TEXT NOT NULL,
  createdAt       TEXT NOT NULL,
  createdBy       TEXT,
  lifetimeMinutes INTEGER NOT NULL,
  oneTime         INTEGER NOT NULL,
  startTime       TEXT
);
CREATE INDEX IF NOT EXISTS idx_tap_records_tenant ON tap_records (tenantId, userId);
`;

function nowIso(): string {
  return new Date().toISOString();
}

function asBool(value: unknown): boolean {
  return Number(value) === 1;
}

export interface TapRecord {
  id: string;
  tenantId: string;
  userId: string;
  createdAt: string;
  createdBy: string | null;
  lifetimeMinutes: number;
  oneTime: boolean;
  startTime: string | null;
}

export interface TapRecordCreateInput {
  id?: string;
  tenantId: string;
  userId: string;
  createdBy?: string | null;
  lifetimeMinutes: number;
  oneTime: boolean;
  startTime?: string | null;
  createdAt?: string;
}

export interface TapRecordRepository {
  createTapRecord(input: TapRecordCreateInput): TapRecord;
  getTapRecord(tenantId: string, id: string): TapRecord | undefined;
  listTapRecords(tenantId: string, userId?: string): TapRecord[];
}

type Row = Record<string, unknown>;

function toRecord(row: Row): TapRecord {
  return {
    id: String(row["id"]),
    tenantId: String(row["tenantId"]),
    userId: String(row["userId"]),
    createdAt: String(row["createdAt"]),
    createdBy: row["createdBy"] === null || row["createdBy"] === undefined ? null : String(row["createdBy"]),
    lifetimeMinutes: Number(row["lifetimeMinutes"]),
    oneTime: asBool(row["oneTime"]),
    startTime: row["startTime"] === null || row["startTime"] === undefined ? null : String(row["startTime"]),
  };
}

export class SqliteTapRecordRepository implements TapRecordRepository {
  constructor(private readonly db: Database.Database) {}

  createTapRecord(input: TapRecordCreateInput): TapRecord {
    if (input.tenantId.trim().length === 0) {
      throw new Error("tap record requires a tenantId");
    }
    if (input.userId.trim().length === 0) {
      throw new Error("tap record requires a userId");
    }
    if (!Number.isInteger(input.lifetimeMinutes) || input.lifetimeMinutes < 10 || input.lifetimeMinutes > 43200) {
      throw new Error("tap record lifetimeMinutes must be an integer between 10 and 43200");
    }
    const record: TapRecord = {
      id: input.id ?? randomUUID(),
      tenantId: input.tenantId,
      userId: input.userId,
      createdAt: input.createdAt ?? nowIso(),
      createdBy: input.createdBy ?? null,
      lifetimeMinutes: input.lifetimeMinutes,
      oneTime: input.oneTime,
      startTime: input.startTime ?? null,
    };
    this.db
      .prepare(
        `INSERT INTO tap_records
           (id, tenantId, userId, createdAt, createdBy, lifetimeMinutes, oneTime, startTime)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.tenantId,
        record.userId,
        record.createdAt,
        record.createdBy,
        record.lifetimeMinutes,
        record.oneTime ? 1 : 0,
        record.startTime,
      );
    return record;
  }

  getTapRecord(tenantId: string, id: string): TapRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM tap_records WHERE tenantId = ? AND id = ?")
      .get(tenantId, id) as Row | undefined;
    return row === undefined ? undefined : toRecord(row);
  }

  listTapRecords(tenantId: string, userId?: string): TapRecord[] {
    const rows =
      userId === undefined
        ? (this.db
            .prepare("SELECT * FROM tap_records WHERE tenantId = ? ORDER BY createdAt DESC")
            .all(tenantId) as Row[])
        : (this.db
            .prepare("SELECT * FROM tap_records WHERE tenantId = ? AND userId = ? ORDER BY createdAt DESC")
            .all(tenantId, userId) as Row[]);
    return rows.map(toRecord);
  }
}

export function openSqliteTapRecordRepository(filename: string): SqliteTapRecordRepository {
  const db = new Database(filename);
  try {
    db.pragma("journal_mode = WAL");
    db.exec(TAP_RECORDS_DDL);
    return new SqliteTapRecordRepository(db);
  } catch (error) {
    db.close();
    throw error;
  }
}
