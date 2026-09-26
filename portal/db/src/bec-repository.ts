// BEC compromise findings store (EPIC-011 SPEC.md §5, §4.5 US-6; T-0207).
//
// Persists BecFinding (id, tenantId, userId, check, detail, state) for the
// 11-check compromise review. Findings are written by the bec-check route and
// transitioned to remediated/dismissed by the per-finding remediate path; the
// portal never auto-remediates (§11.3 resolved). Self-contained: types live
// here so no shared repository file is touched.
import Database from "better-sqlite3";
import { SchemaVersionError } from "./repository.js";
import {
  SCHEMA_VERSIONS_TABLE,
  loadMigrations,
  runMigrations,
  type OpenSqliteRepositoryOptions,
} from "./sqlite-repository.js";

type Row = Record<string, unknown>;

export type BecFindingState = "open" | "remediated" | "dismissed";

export interface BecFinding {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly check: string;
  readonly detail: Record<string, unknown>;
  readonly state: BecFindingState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BecFindingInput {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly check: string;
  readonly detail?: Record<string, unknown>;
  readonly state?: BecFindingState;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly createdBy?: string;
}

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

function parseDetail(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  try {
    const parsed: unknown = JSON.parse(String(value));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export interface BecFindingRepository {
  readonly schemaVersion: number;

  close(): void;

  saveBecFindings(findings: readonly BecFindingInput[]): Promise<BecFinding[]>;
  listBecFindings(tenantId: string, userId: string): Promise<BecFinding[]>;
  getBecFinding(findingId: string): Promise<BecFinding | undefined>;
  updateBecFindingState(
    findingId: string,
    state: BecFindingState,
  ): Promise<BecFinding | undefined>;
}

export class SqliteBecFindingRepository implements BecFindingRepository {
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

  private mapFinding(row: Row): BecFinding {
    return {
      id: asString(row["id"]),
      tenantId: asString(row["tenantId"]),
      userId: asString(row["userId"]),
      check: asString(row["check"]),
      detail: parseDetail(row["detail"]),
      state: asString(row["state"]) as BecFindingState,
      createdAt: asString(row["createdAt"]),
      updatedAt: asString(row["updatedAt"]),
    };
  }

  async saveBecFindings(findings: readonly BecFindingInput[]): Promise<BecFinding[]> {
    const instant = nowIso();
    const upsert = this.db.prepare(
      `INSERT INTO bec_findings (id, tenantId, userId, "check", detail, state, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET detail = excluded.detail, state = excluded.state, updatedAt = excluded.updatedAt`,
    );
    this.db.transaction(() => {
      for (const finding of findings) {
        upsert.run(
          finding.id,
          finding.tenantId,
          finding.userId,
          finding.check,
          JSON.stringify(finding.detail ?? {}),
          finding.state ?? "open",
          finding.createdAt ?? instant,
          finding.updatedAt ?? instant,
        );
      }
    })();
    return Promise.all(
      findings.map(async (finding) => {
        const stored = await this.getBecFinding(finding.id);
        if (!stored) throw new Error(`bec finding ${finding.id} was not persisted`);
        return stored;
      }),
    );
  }

  async listBecFindings(tenantId: string, userId: string): Promise<BecFinding[]> {
    return (
      this.db
        .prepare("SELECT * FROM bec_findings WHERE tenantId = ? AND userId = ? ORDER BY createdAt, id")
        .all(tenantId, userId) as Row[]
    ).map((row) => this.mapFinding(row));
  }

  async getBecFinding(findingId: string): Promise<BecFinding | undefined> {
    const row = this.db
      .prepare("SELECT * FROM bec_findings WHERE id = ?")
      .get(findingId) as Row | undefined;
    return row ? this.mapFinding(row) : undefined;
  }

  async updateBecFindingState(
    findingId: string,
    state: BecFindingState,
  ): Promise<BecFinding | undefined> {
    const result = this.db
      .prepare("UPDATE bec_findings SET state = ?, updatedAt = ? WHERE id = ?")
      .run(state, nowIso(), findingId);
    if (result.changes === 0) return undefined;
    return this.getBecFinding(findingId);
  }
}

export async function openSqliteBecFindingRepository(
  options: OpenSqliteRepositoryOptions,
): Promise<SqliteBecFindingRepository> {
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
    return new SqliteBecFindingRepository(db, applied);
  } catch (error) {
    db.close();
    throw error;
  }
}
