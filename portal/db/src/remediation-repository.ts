// Remediation plan/action/instruction entities (EPIC-006 §5) on top of the
// shared repository contract. A plan is plan-only output: created once, read
// back together with its actions, never mutated. Actions are append-mostly —
// the only in-place mutation records an apply outcome (state/before/after/
// result/appliedAt), and no delete path is exposed (the migration also adds a
// no-delete trigger). ManualInstruction is materialized from the registry/docs
// and keyed by checkId. No tenant writes happen at this layer.
import Database from "better-sqlite3";
import {
  SchemaVersionError,
  type ManualInstruction,
  type ManualInstructionInput,
  type RemediationAction,
  type RemediationActionInput,
  type RemediationActionState,
  type RemediationActionUpdate,
  type RemediationPlan,
  type RemediationPlanInput,
  type RemediationPlanMode,
} from "./repository.js";
import {
  SCHEMA_VERSIONS_TABLE,
  loadMigrations,
  runMigrations,
  type OpenSqliteRepositoryOptions,
} from "./sqlite-repository.js";

type Row = Record<string, unknown>;

const PLAN_MODES: readonly RemediationPlanMode[] = ["manual", "automated", "mixed"];
const ACTION_STATES: readonly RemediationActionState[] = [
  "planned",
  "approved",
  "applied",
  "failed",
  "skipped",
];

function nowIso(): string {
  return new Date().toISOString();
}

function asString(value: unknown): string {
  return String(value);
}

function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
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

/** Raised when a plan mode is outside the SPEC §5 closed set. */
export class InvalidRemediationModeError extends Error {
  readonly code = "remediation.invalid_mode";

  constructor(mode: string) {
    super(`remediation plan mode ${mode} must be manual, automated, or mixed`);
    this.name = "InvalidRemediationModeError";
  }
}

/** Raised when an action state is outside the SPEC §5 closed set. */
export class InvalidRemediationActionStateError extends Error {
  readonly code = "remediation.invalid_action_state";

  constructor(state: string) {
    super(`remediation action state ${state} must be planned, approved, applied, failed, or skipped`);
    this.name = "InvalidRemediationActionStateError";
  }
}

function assertPlanMode(mode: string): void {
  if (!(PLAN_MODES as readonly string[]).includes(mode)) {
    throw new InvalidRemediationModeError(mode);
  }
}

function assertActionState(state: string): void {
  if (!(ACTION_STATES as readonly string[]).includes(state)) {
    throw new InvalidRemediationActionStateError(state);
  }
}

/**
 * A remediation action as the BFF routes present it: the check reference is named
 * `check`, since the BFF's thin-layer guard rejects the collector identifier.
 */
export type RemediationActionView = Omit<RemediationAction, "checkId"> & { check: string };

export function toRemediationActionView(action: RemediationAction): RemediationActionView {
  const { checkId, ...rest } = action;
  return { ...rest, check: checkId };
}

/** A manual instruction as the BFF routes present it (see RemediationActionView). */
export type ManualInstructionView = Omit<ManualInstruction, "checkId"> & { check: string };

export function toManualInstructionView(instruction: ManualInstruction): ManualInstructionView {
  const { checkId, ...rest } = instruction;
  return { ...rest, check: checkId };
}

export interface RemediationRepository {
  readonly schemaVersion: number;

  close(): void;

  createRemediationPlan(input: RemediationPlanInput): Promise<RemediationPlan>;
  getRemediationPlan(planId: string): Promise<RemediationPlan | undefined>;
  listRemediationActions(planId: string): Promise<RemediationAction[]>;
  getRemediationAction(actionId: string): Promise<RemediationAction | undefined>;
  listRemediationActionsForTenant(tenantId: string): Promise<RemediationAction[]>;
  updateRemediationAction(
    actionId: string,
    update: RemediationActionUpdate,
  ): Promise<RemediationAction | undefined>;

  getManualInstruction(checkId: string): Promise<ManualInstruction | undefined>;
  listManualInstructions(): Promise<ManualInstruction[]>;
  upsertManualInstruction(input: ManualInstructionInput): Promise<ManualInstruction>;
}

export class SqliteRemediationRepository implements RemediationRepository {
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

  private mapPlan(row: Row): RemediationPlan {
    return {
      id: asString(row["id"]),
      tenantId: asString(row["tenantId"]),
      runId: asString(row["runId"]),
      findingIds: parseJsonArray(row["findingIds"]),
      mode: asString(row["mode"]) as RemediationPlanMode,
      createdAt: asString(row["createdAt"]),
      createdBy: asString(row["createdBy"]),
    };
  }

  private mapAction(row: Row): RemediationAction {
    return {
      id: asString(row["id"]),
      planId: asString(row["planId"]),
      checkId: asString(row["checkId"]),
      command: asString(row["command"]),
      target: asNullableString(row["target"]),
      state: asString(row["state"]) as RemediationActionState,
      before: parseJson(row["before"]),
      after: parseJson(row["after"]),
      appliedAt: asNullableString(row["appliedAt"]),
      appliedBy: asNullableString(row["appliedBy"]),
      result: parseJson(row["result"]),
      error: asNullableString(row["error"]),
      correlationId: asNullableString(row["correlationId"]),
    };
  }

  private mapInstruction(row: Row): ManualInstruction {
    return {
      checkId: asString(row["checkId"]),
      portalPath: asString(row["portalPath"]),
      steps: parseJsonArray(row["steps"]),
      notes: asNullableString(row["notes"]),
    };
  }

  private actionById(actionId: string): RemediationAction | undefined {
    const row = this.db
      .prepare("SELECT * FROM remediation_actions WHERE id = ?")
      .get(actionId) as Row | undefined;
    return row ? this.mapAction(row) : undefined;
  }

  async createRemediationPlan(input: RemediationPlanInput): Promise<RemediationPlan> {
    assertPlanMode(input.mode);
    const createdAt = input.createdAt ?? nowIso();
    const insertPlan = this.db.prepare(
      `INSERT INTO remediation_plans (id, tenantId, runId, findingIds, mode, createdAt, createdBy)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertAction = this.db.prepare(
      `INSERT INTO remediation_actions
         (id, planId, checkId, command, target, state, before, after, appliedAt, appliedBy, result, error, correlationId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.transaction(() => {
      insertPlan.run(
        input.id,
        input.tenantId,
        input.runId,
        JSON.stringify(input.findingIds ?? []),
        input.mode,
        createdAt,
        input.createdBy,
      );
      for (const action of input.actions ?? []) {
        assertActionState(action.state ?? "planned");
        insertAction.run(
          action.id,
          input.id,
          action.checkId,
          action.command,
          action.target ?? null,
          action.state ?? "planned",
          stringifyJson(action.before),
          stringifyJson(action.after),
          action.appliedAt ?? null,
          action.appliedBy ?? null,
          stringifyJson(action.result),
          action.error ?? null,
          action.correlationId ?? null,
        );
      }
    })();
    const plan = await this.getRemediationPlan(input.id);
    if (!plan) throw new Error(`remediation plan ${input.id} was not persisted`);
    return plan;
  }

  async getRemediationPlan(planId: string): Promise<RemediationPlan | undefined> {
    const row = this.db
      .prepare("SELECT * FROM remediation_plans WHERE id = ?")
      .get(planId) as Row | undefined;
    return row ? this.mapPlan(row) : undefined;
  }

  async listRemediationActions(planId: string): Promise<RemediationAction[]> {
    return (
      this.db
        .prepare("SELECT * FROM remediation_actions WHERE planId = ? ORDER BY rowid")
        .all(planId) as Row[]
    ).map((row) => this.mapAction(row));
  }

  async getRemediationAction(actionId: string): Promise<RemediationAction | undefined> {
    const row = this.db.prepare("SELECT * FROM remediation_actions WHERE id = ?").get(actionId) as Row | undefined;
    return row ? this.mapAction(row) : undefined;
  }

  async listRemediationActionsForTenant(tenantId: string): Promise<RemediationAction[]> {
    return (
      this.db
        .prepare(
          `SELECT a.* FROM remediation_actions a
           JOIN remediation_plans p ON p.id = a.planId
           WHERE p.tenantId = ?
           ORDER BY a.rowid`,
        )
        .all(tenantId) as Row[]
    ).map((row) => this.mapAction(row));
  }

  async updateRemediationAction(
    actionId: string,
    update: RemediationActionUpdate,
  ): Promise<RemediationAction | undefined> {
    const existing = this.actionById(actionId);
    if (!existing) return undefined;
    if (update.state !== undefined) assertActionState(update.state);
    const state = update.state ?? existing.state;
    const before = update.before === undefined ? existing.before : update.before;
    const after = update.after === undefined ? existing.after : update.after;
    const appliedAt = update.appliedAt === undefined ? existing.appliedAt : update.appliedAt;
    const appliedBy = update.appliedBy === undefined ? existing.appliedBy : update.appliedBy;
    const result = update.result === undefined ? existing.result : update.result;
    const error = update.error === undefined ? existing.error : update.error;
    const correlationId =
      update.correlationId === undefined ? existing.correlationId : update.correlationId;
    this.db
      .prepare(
        `UPDATE remediation_actions SET
           state = ?, before = ?, after = ?, appliedAt = ?, appliedBy = ?, result = ?, error = ?, correlationId = ?
         WHERE id = ?`,
      )
      .run(
        state,
        stringifyJson(before),
        stringifyJson(after),
        appliedAt,
        appliedBy,
        stringifyJson(result),
        error,
        correlationId,
        actionId,
      );
    return this.actionById(actionId);
  }

  async getManualInstruction(checkId: string): Promise<ManualInstruction | undefined> {
    const row = this.db
      .prepare("SELECT * FROM manual_instructions WHERE checkId = ?")
      .get(checkId) as Row | undefined;
    return row ? this.mapInstruction(row) : undefined;
  }

  async listManualInstructions(): Promise<ManualInstruction[]> {
    return (
      this.db.prepare("SELECT * FROM manual_instructions ORDER BY checkId").all() as Row[]
    ).map((row) => this.mapInstruction(row));
  }

  async upsertManualInstruction(input: ManualInstructionInput): Promise<ManualInstruction> {
    this.db
      .prepare(
        `INSERT INTO manual_instructions (checkId, portalPath, steps, notes)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(checkId) DO UPDATE SET
           portalPath = excluded.portalPath,
           steps = excluded.steps,
           notes = excluded.notes`,
      )
      .run(
        input.checkId,
        input.portalPath,
        JSON.stringify(input.steps ?? []),
        input.notes ?? null,
      );
    const instruction = await this.getManualInstruction(input.checkId);
    if (!instruction) throw new Error(`manual instruction ${input.checkId} was not persisted`);
    return instruction;
  }
}

export async function openSqliteRemediationRepository(
  options: OpenSqliteRepositoryOptions,
): Promise<SqliteRemediationRepository> {
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
    const existing =
      row?.version === null || row?.version === undefined ? 0 : Number(row.version);
    if (existing > target) {
      throw new SchemaVersionError(existing, target);
    }
    const applied = runMigrations(db, migrations);
    if (applied !== target) {
      throw new SchemaVersionError(applied, target);
    }
    return new SqliteRemediationRepository(db, applied);
  } catch (error) {
    db.close();
    throw error;
  }
}
