// Offboarding job/step entities (EPIC-011 §5) on top of the shared repository
// contract. Steps are individually addressable by (jobId, order) and re-runnable:
// resetOffboardingStep clears a step's outcome so the worker can apply it again
// without touching already-applied steps of the job.
import Database from "better-sqlite3";
import {
  SchemaVersionError,
  type OffboardingJob,
  type OffboardingJobInput,
  type OffboardingJobState,
  type OffboardingStep,
  type OffboardingStepState,
  type OffboardingStepUpdate,
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

function parseJson(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(String(value));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseJsonArray(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function stringifyJson(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

export interface OffboardingRepository {
  readonly schemaVersion: number;

  close(): void;

  createOffboardingJob(input: OffboardingJobInput): Promise<OffboardingJob>;
  getOffboardingJob(jobId: string): Promise<OffboardingJob | undefined>;
  listOffboardingJobs(tenantId: string): Promise<OffboardingJob[]>;

  listOffboardingSteps(jobId: string): Promise<OffboardingStep[]>;
  createOffboardingSteps(jobId: string, actions: readonly string[]): Promise<OffboardingStep[]>;
  getOffboardingStep(jobId: string, order: number): Promise<OffboardingStep | undefined>;
  updateOffboardingStep(
    jobId: string,
    order: number,
    update: OffboardingStepUpdate,
  ): Promise<OffboardingStep | undefined>;
  resetOffboardingStep(jobId: string, order: number): Promise<boolean>;

  updateOffboardingJobState(
    jobId: string,
    state: OffboardingJobState,
  ): Promise<OffboardingJob | undefined>;
}

export class SqliteOffboardingRepository implements OffboardingRepository {
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

  private mapJob(row: Row): OffboardingJob {
    return {
      id: asString(row["id"]),
      tenantId: asString(row["tenantId"]),
      userIds: parseJsonArray(row["userIds"]),
      options: parseJson(row["options"]) ?? {},
      state: asString(row["state"]) as OffboardingJobState,
      createdAt: asString(row["createdAt"]),
      createdBy: asString(row["createdBy"]),
    };
  }

  private mapStep(row: Row): OffboardingStep {
    return {
      jobId: asString(row["jobId"]),
      order: asNumber(row["order"]),
      action: asString(row["action"]),
      state: asString(row["state"]) as OffboardingStepState,
      result: parseJson(row["result"]),
      error: asNullableString(row["error"]),
      appliedAt: asNullableString(row["appliedAt"]),
    };
  }

  async createOffboardingJob(input: OffboardingJobInput): Promise<OffboardingJob> {
    const createdAt = input.createdAt ?? nowIso();
    const state = input.state ?? "planned";
    const insertJob = this.db.prepare(
      `INSERT INTO offboarding_jobs (id, tenantId, userIds, options, state, createdAt, createdBy)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertStep = this.db.prepare(
      `INSERT INTO offboarding_steps (jobId, "order", action, state, result, error, appliedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.transaction(() => {
      insertJob.run(
        input.id,
        input.tenantId,
        JSON.stringify(input.userIds ?? []),
        JSON.stringify(input.options ?? {}),
        state,
        createdAt,
        input.createdBy,
      );
      for (const step of input.steps ?? []) {
        insertStep.run(
          input.id,
          step.order,
          step.action,
          step.state ?? "pending",
          stringifyJson(step.result),
          step.error ?? null,
          step.appliedAt ?? null,
        );
      }
    })();
    const job = await this.getOffboardingJob(input.id);
    if (!job) throw new Error(`offboarding job ${input.id} was not persisted`);
    return job;
  }

  async getOffboardingJob(jobId: string): Promise<OffboardingJob | undefined> {
    const row = this.db
      .prepare("SELECT * FROM offboarding_jobs WHERE id = ?")
      .get(jobId) as Row | undefined;
    return row ? this.mapJob(row) : undefined;
  }

  async listOffboardingJobs(tenantId: string): Promise<OffboardingJob[]> {
    return (
      this.db
        .prepare("SELECT * FROM offboarding_jobs WHERE tenantId = ? ORDER BY createdAt, id")
        .all(tenantId) as Row[]
    ).map((row) => this.mapJob(row));
  }

  async listOffboardingSteps(jobId: string): Promise<OffboardingStep[]> {
    return (
      this.db
        .prepare('SELECT * FROM offboarding_steps WHERE jobId = ? ORDER BY "order"')
        .all(jobId) as Row[]
    ).map((row) => this.mapStep(row));
  }

  /** Append pending steps to an existing job, numbered after its last step. */
  async createOffboardingSteps(jobId: string, actions: readonly string[]): Promise<OffboardingStep[]> {
    const insertStep = this.db.prepare(
      `INSERT INTO offboarding_steps (jobId, "order", action, state, result, error, appliedAt)
       VALUES (?, ?, ?, 'pending', NULL, NULL, NULL)`,
    );
    this.db.transaction(() => {
      const last = this.db
        .prepare(`SELECT MAX("order") AS last FROM offboarding_steps WHERE jobId = ?`)
        .get(jobId) as { last: number | null };
      let order = last.last ?? 0;
      for (const action of actions) {
        order += 1;
        insertStep.run(jobId, order, action);
      }
    })();
    return this.listOffboardingSteps(jobId);
  }

  async getOffboardingStep(jobId: string, order: number): Promise<OffboardingStep | undefined> {
    const row = this.db
      .prepare('SELECT * FROM offboarding_steps WHERE jobId = ? AND "order" = ?')
      .get(jobId, order) as Row | undefined;
    return row ? this.mapStep(row) : undefined;
  }

  async updateOffboardingStep(
    jobId: string,
    order: number,
    update: OffboardingStepUpdate,
  ): Promise<OffboardingStep | undefined> {
    const existing = await this.getOffboardingStep(jobId, order);
    if (!existing) return undefined;
    const state = update.state ?? existing.state;
    const result = update.result === undefined ? existing.result : update.result;
    const error = update.error === undefined ? existing.error : update.error;
    const appliedAt = update.appliedAt === undefined ? existing.appliedAt : update.appliedAt;
    this.db
      .prepare(
        'UPDATE offboarding_steps SET state = ?, result = ?, error = ?, appliedAt = ? WHERE jobId = ? AND "order" = ?',
      )
      .run(state, stringifyJson(result), error, appliedAt, jobId, order);
    return this.getOffboardingStep(jobId, order);
  }

  async resetOffboardingStep(jobId: string, order: number): Promise<boolean> {
    const result = this.db
      .prepare(
        'UPDATE offboarding_steps SET state = \'pending\', result = NULL, error = NULL, appliedAt = NULL WHERE jobId = ? AND "order" = ?',
      )
      .run(jobId, order);
    return result.changes > 0;
  }

  async updateOffboardingJobState(
    jobId: string,
    state: OffboardingJobState,
  ): Promise<OffboardingJob | undefined> {
    const result = this.db
      .prepare("UPDATE offboarding_jobs SET state = ? WHERE id = ?")
      .run(state, jobId);
    if (result.changes === 0) return undefined;
    return this.getOffboardingJob(jobId);
  }
}

export async function openSqliteOffboardingRepository(
  options: OpenSqliteRepositoryOptions,
): Promise<SqliteOffboardingRepository> {
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
    return new SqliteOffboardingRepository(db, applied);
  } catch (error) {
    db.close();
    throw error;
  }
}
