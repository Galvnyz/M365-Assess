// Baselines storage (EPIC-010 SPEC.md §5, §11.1; T-0181). Owns `Baseline` and
// `BaselineStage` persistence with ordered stages using `logic: 'and'`, plus
// the assignment rows the T-0182 save gate evaluates. Builds on the shared
// EPIC-008 standards/conditions model rather than a parallel one: a stage
// condition names a standard by key with the expected value.
//
// The shape mirrors portal/contracts/src/baselines.ts; that module is not an
// exported subpath of @m365-assess/contracts, so the shape is restated here
// (the same workspace-boundary pattern used for drift/standards).
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { SchemaVersionError } from "./repository.js";
import {
  SCHEMA_VERSIONS_TABLE,
  loadMigrations,
  runMigrations,
  type OpenSqliteRepositoryOptions,
} from "./sqlite-repository.js";

export const BASELINE_LOGIC_VALUES = ["and"] as const;
export type BaselineLogic = (typeof BASELINE_LOGIC_VALUES)[number];

export const BASELINE_STAGE_ACTIONS = ["report", "remediate"] as const;
export type BaselineStageAction = (typeof BASELINE_STAGE_ACTIONS)[number];

export interface BaselineCondition {
  readonly key: string;
  readonly expected: unknown;
}

export interface BaselineStageInput {
  readonly order: number;
  readonly conditions: readonly BaselineCondition[];
  readonly action: BaselineStageAction;
}

export interface BaselineStage extends BaselineStageInput {
  readonly baselineId: string;
}

export interface BaselineAlerting {
  readonly enabled: boolean;
}

export interface Baseline {
  readonly id: string;
  readonly name: string;
  readonly stages: readonly BaselineStage[];
  readonly logic: BaselineLogic;
  readonly alerting: BaselineAlerting;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const BASELINE_TARGET_TYPES = ["allTenants", "group", "tenant"] as const;
export type BaselineTargetType = (typeof BASELINE_TARGET_TYPES)[number];

export interface BaselineAssignment {
  readonly baselineId: string;
  readonly targetType: BaselineTargetType;
  readonly targetId: string | null;
  readonly precedence: number;
}

export const BASELINE_ROLLOUT_STATES = ["active", "eligible", "complete"] as const;
export type BaselineRolloutState = (typeof BASELINE_ROLLOUT_STATES)[number];

export interface BaselineRollout {
  readonly baselineId: string;
  readonly tenantId: string;
  readonly stage: number;
  readonly state: BaselineRolloutState;
  readonly lastRunAt: string;
}

export interface UpsertRolloutInput {
  readonly baselineId: string;
  readonly tenantId: string;
  readonly stage: number;
  readonly state: BaselineRolloutState;
  readonly lastRunAt?: string;
}

/** One append-only baseline_history row (SPEC §4.5). `detail` is a JSON object. */
export interface BaselineHistoryEvent {
  readonly id: string;
  readonly baselineId: string;
  readonly tenantId: string;
  readonly event: string;
  readonly detail: Record<string, unknown>;
  readonly at: string;
}

/** One compliance sample (0-1) per evaluation, for the fleet trend chart (SPEC §11.5). */
export interface BaselineTrendPoint {
  readonly baselineId: string;
  readonly tenantId: string;
  readonly at: string;
  readonly compliance: number;
}

export interface CreateBaselineInput {
  readonly id?: string;
  readonly name: string;
  readonly logic?: BaselineLogic;
  readonly alerting?: BaselineAlerting;
  readonly enabled?: boolean;
  readonly stages?: readonly BaselineStageInput[];
  readonly assignments?: readonly Omit<BaselineAssignment, "baselineId">[];
}

export interface UpdateBaselineInput {
  readonly name?: string;
  readonly logic?: BaselineLogic;
  readonly alerting?: BaselineAlerting;
  readonly enabled?: boolean;
}

/** Raised when stage orders are duplicated or not contiguous from zero. */
export class BaselineStageOrderError extends Error {
  readonly code = "baseline.invalid_stage_order";

  constructor(detail: string) {
    super(`Invalid baseline stage ordering: ${detail}`);
    this.name = "BaselineStageOrderError";
  }
}

/** Raised when a condition has no standard key. */
export class BaselineConditionError extends Error {
  readonly code = "baseline.invalid_condition";

  constructor(detail: string) {
    super(`Invalid baseline condition: ${detail}`);
    this.name = "BaselineConditionError";
  }
}

type Row = Record<string, unknown>;

function asString(value: unknown): string {
  if (typeof value !== "string") throw new Error(`expected string, got ${typeof value}`);
  return value;
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return asString(value);
}

function asBoolean(value: unknown): boolean {
  if (value === 1 || value === true) return true;
  if (value === 0 || value === false) return false;
  throw new Error(`expected boolean, got ${typeof value}`);
}

function parseJson<T>(value: unknown, what: string): T {
  const text = asString(value);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`invalid ${what} JSON`);
  }
}

/**
 * Validates unique, contiguous zero-based stage ordering plus per-condition
 * keys. Returns the stages sorted by order.
 */
export function normalizeStageInputs(stages: readonly BaselineStageInput[]): BaselineStageInput[] {
  const sorted = [...stages].sort((left, right) => left.order - right.order);
  for (let index = 0; index < sorted.length; index += 1) {
    const stage = sorted[index]!;
    if (!Number.isInteger(stage.order) || stage.order !== index) {
      throw new BaselineStageOrderError(
        `orders must be unique and contiguous from 0; found order ${String(stage.order)} at position ${index}`,
      );
    }
    if (!(BASELINE_STAGE_ACTIONS as readonly string[]).includes(stage.action)) {
      throw new BaselineStageOrderError(`unknown stage action ${JSON.stringify(stage.action)}`);
    }
    for (const condition of stage.conditions) {
      if (typeof condition.key !== "string" || condition.key.length === 0) {
        throw new BaselineConditionError("every condition needs a non-empty standard key");
      }
    }
  }
  return sorted;
}

export interface BaselinesRepositoryOptions extends OpenSqliteRepositoryOptions {}

export class SqliteBaselinesRepository {
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

  private listStages(baselineId: string): BaselineStage[] {
    const rows = this.db
      .prepare("SELECT * FROM baseline_stages WHERE baselineId = ? ORDER BY stageOrder ASC")
      .all(baselineId) as Row[];
    return rows.map((row) => ({
      baselineId,
      order: row["stageOrder"] as number,
      conditions: parseJson<BaselineCondition[]>(row["conditions"], "stage conditions"),
      action: asString(row["action"]) as BaselineStageAction,
    }));
  }

  private listAssignments(baselineId: string): BaselineAssignment[] {
    const rows = this.db
      .prepare("SELECT * FROM baseline_assignments WHERE baselineId = ? ORDER BY precedence ASC")
      .all(baselineId) as Row[];
    return rows.map((row) => ({
      baselineId,
      targetType: asString(row["targetType"]) as BaselineTargetType,
      targetId: asNullableString(row["targetId"]),
      precedence: row["precedence"] as number,
    }));
  }

  private hydrate(row: Row): Baseline {
    const id = asString(row["id"]);
    return {
      id,
      name: asString(row["name"]),
      stages: this.listStages(id),
      logic: asString(row["logic"]) as BaselineLogic,
      alerting: parseJson<BaselineAlerting>(row["alerting"], "baseline alerting"),
      enabled: asBoolean(row["enabled"]),
      createdAt: asString(row["createdAt"]),
      updatedAt: asString(row["updatedAt"]),
    };
  }

  async createBaseline(input: CreateBaselineInput): Promise<Baseline> {
    if (input.name.trim().length === 0) {
      throw new Error("baseline name is required");
    }
    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    const logic = input.logic ?? "and";
    if (logic !== "and") {
      throw new Error(`unsupported baseline logic ${JSON.stringify(logic)}`);
    }
    const stages = normalizeStageInputs(input.stages ?? []);

    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO baselines (id, name, logic, alerting, enabled, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          input.name.trim(),
          logic,
          JSON.stringify(input.alerting ?? { enabled: false }),
          input.enabled === false ? 0 : 1,
          now,
          now,
        );
      this.writeStages(id, stages);
      this.writeAssignments(id, input.assignments ?? []);
    });
    insert();

    const row = this.db.prepare("SELECT * FROM baselines WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new Error(`baseline ${id} not found after create`);
    return this.hydrate(row);
  }

  private writeStages(baselineId: string, stages: readonly BaselineStageInput[]): void {
    const stmt = this.db.prepare(
      "INSERT INTO baseline_stages (baselineId, stageOrder, conditions, action) VALUES (?, ?, ?, ?)",
    );
    for (const stage of stages) {
      stmt.run(baselineId, stage.order, JSON.stringify([...stage.conditions]), stage.action);
    }
  }

  private writeAssignments(
    baselineId: string,
    assignments: readonly Omit<BaselineAssignment, "baselineId">[],
  ): void {
    const stmt = this.db.prepare(
      "INSERT INTO baseline_assignments (baselineId, targetType, targetId, precedence) VALUES (?, ?, ?, ?)",
    );
    for (const assignment of assignments) {
      if (!(BASELINE_TARGET_TYPES as readonly string[]).includes(assignment.targetType)) {
        throw new Error(`unknown assignment target ${JSON.stringify(assignment.targetType)}`);
      }
      if (assignment.targetType !== "allTenants" && !assignment.targetId) {
        throw new Error(`assignment target ${assignment.targetType} needs a targetId`);
      }
      stmt.run(baselineId, assignment.targetType, assignment.targetId, assignment.precedence);
    }
  }

  async getBaseline(id: string): Promise<Baseline | undefined> {
    const row = this.db.prepare("SELECT * FROM baselines WHERE id = ?").get(id) as Row | undefined;
    return row ? this.hydrate(row) : undefined;
  }

  async listBaselines(): Promise<Baseline[]> {
    const rows = this.db.prepare("SELECT * FROM baselines ORDER BY name ASC").all() as Row[];
    return rows.map((row) => this.hydrate(row));
  }

  async updateBaseline(id: string, patch: UpdateBaselineInput): Promise<Baseline | undefined> {
    const existing = await this.getBaseline(id);
    if (!existing) return undefined;
    if (patch.name !== undefined && patch.name.trim().length === 0) {
      throw new Error("baseline name is required");
    }
    if (patch.logic !== undefined && patch.logic !== "and") {
      throw new Error(`unsupported baseline logic ${JSON.stringify(patch.logic)}`);
    }
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE baselines SET name = ?, logic = ?, alerting = ?, enabled = ?, updatedAt = ? WHERE id = ?")
      .run(
        patch.name?.trim() ?? existing.name,
        patch.logic ?? existing.logic,
        JSON.stringify(patch.alerting ?? existing.alerting),
        patch.enabled === undefined ? (existing.enabled ? 1 : 0) : patch.enabled ? 1 : 0,
        now,
        id,
      );
    return this.getBaseline(id);
  }

  /** Replaces every stage; orders must be unique and contiguous from zero. */
  async setStages(baselineId: string, stages: readonly BaselineStageInput[]): Promise<BaselineStage[]> {
    const existing = await this.getBaseline(baselineId);
    if (!existing) throw new Error(`baseline ${baselineId} not found`);
    const normalized = normalizeStageInputs(stages);
    const replace = this.db.transaction(() => {
      this.db.prepare("DELETE FROM baseline_stages WHERE baselineId = ?").run(baselineId);
      this.writeStages(baselineId, normalized);
      this.db.prepare("UPDATE baselines SET updatedAt = ? WHERE id = ?").run(new Date().toISOString(), baselineId);
    });
    replace();
    return this.listStages(baselineId);
  }

  /** Replaces every assignment for the baseline. */
  async setAssignments(
    baselineId: string,
    assignments: readonly Omit<BaselineAssignment, "baselineId">[],
  ): Promise<BaselineAssignment[]> {
    const existing = await this.getBaseline(baselineId);
    if (!existing) throw new Error(`baseline ${baselineId} not found`);
    const replace = this.db.transaction(() => {
      this.db.prepare("DELETE FROM baseline_assignments WHERE baselineId = ?").run(baselineId);
      this.writeAssignments(baselineId, assignments);
      this.db.prepare("UPDATE baselines SET updatedAt = ? WHERE id = ?").run(new Date().toISOString(), baselineId);
    });
    replace();
    return this.listAssignments(baselineId);
  }

  async getAssignments(baselineId: string): Promise<BaselineAssignment[]> {
    return this.listAssignments(baselineId);
  }

  async deleteBaseline(id: string): Promise<boolean> {
    const result = this.db.prepare("DELETE FROM baselines WHERE id = ?").run(id);
    return result.changes > 0;
  }

  // ─── BaselineRollout (SPEC §4.2, §5; T-0185) ──────────────────────────────
  // The baseline_rollouts table is created by the T-0188 history migration
  // alongside history/trend storage; these methods upsert per-tenant stage
  // state after every evaluation.

  private hydrateRollout(row: Row): BaselineRollout {
    return {
      baselineId: asString(row["baselineId"]),
      tenantId: asString(row["tenantId"]),
      stage: row["stage"] as number,
      state: asString(row["state"]) as BaselineRolloutState,
      lastRunAt: asString(row["lastRunAt"]),
    };
  }

  /** Inserts or replaces the tenant's rollout row, preserving no prior state. */
  async upsertRollout(input: UpsertRolloutInput): Promise<BaselineRollout> {
    if (!(BASELINE_ROLLOUT_STATES as readonly string[]).includes(input.state)) {
      throw new Error(`unknown rollout state ${JSON.stringify(input.state)}`);
    }
    if (!Number.isInteger(input.stage) || input.stage < 0) {
      throw new Error(`rollout stage must be a non-negative integer`);
    }
    const lastRunAt = input.lastRunAt ?? new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO baseline_rollouts (baselineId, tenantId, stage, state, lastRunAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (baselineId, tenantId)
         DO UPDATE SET stage = excluded.stage, state = excluded.state, lastRunAt = excluded.lastRunAt`,
      )
      .run(input.baselineId, input.tenantId, input.stage, input.state, lastRunAt);
    const row = this.db
      .prepare("SELECT * FROM baseline_rollouts WHERE baselineId = ? AND tenantId = ?")
      .get(input.baselineId, input.tenantId) as Row | undefined;
    if (!row) throw new Error(`rollout for ${input.baselineId}/${input.tenantId} not found after upsert`);
    return this.hydrateRollout(row);
  }

  async getRollout(baselineId: string, tenantId: string): Promise<BaselineRollout | undefined> {
    const row = this.db
      .prepare("SELECT * FROM baseline_rollouts WHERE baselineId = ? AND tenantId = ?")
      .get(baselineId, tenantId) as Row | undefined;
    return row ? this.hydrateRollout(row) : undefined;
  }

  async listRollouts(baselineId: string): Promise<BaselineRollout[]> {
    const rows = this.db
      .prepare("SELECT * FROM baseline_rollouts WHERE baselineId = ? ORDER BY tenantId ASC")
      .all(baselineId) as Row[];
    return rows.map((row) => this.hydrateRollout(row));
  }

  /** Every rollout row across baselines and tenants (the fleet view). */
  async listAllRollouts(): Promise<BaselineRollout[]> {
    const rows = this.db
      .prepare("SELECT * FROM baseline_rollouts ORDER BY baselineId ASC, tenantId ASC")
      .all() as Row[];
    return rows.map((row) => this.hydrateRollout(row));
  }

  // ─── History and trend (SPEC §4.5, §11.5; T-0825) ─────────────────────────

  async appendHistory(event: BaselineHistoryEvent): Promise<void> {
    this.db
      .prepare("INSERT INTO baseline_history (id, baselineId, tenantId, event, detail, at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(event.id, event.baselineId, event.tenantId, event.event, JSON.stringify(event.detail), event.at);
  }

  /** The baseline's most recent events, newest first. */
  async listHistory(baselineId: string, limit: number): Promise<BaselineHistoryEvent[]> {
    const rows = this.db
      .prepare("SELECT * FROM baseline_history WHERE baselineId = ? ORDER BY at DESC, id DESC LIMIT ?")
      .all(baselineId, limit) as Row[];
    return rows.map((row) => ({
      id: asString(row["id"]),
      baselineId: asString(row["baselineId"]),
      tenantId: asString(row["tenantId"]),
      event: asString(row["event"]),
      detail: parseJson<Record<string, unknown>>(row["detail"], "history detail"),
      at: asString(row["at"]),
    }));
  }

  async appendTrend(point: BaselineTrendPoint): Promise<void> {
    this.db
      .prepare("INSERT OR REPLACE INTO baseline_trend (baselineId, tenantId, at, compliance) VALUES (?, ?, ?, ?)")
      .run(point.baselineId, point.tenantId, point.at, point.compliance);
  }

  /** The baseline's trend points, oldest first. */
  async listTrend(baselineId: string): Promise<BaselineTrendPoint[]> {
    const rows = this.db
      .prepare("SELECT * FROM baseline_trend WHERE baselineId = ? ORDER BY at ASC, tenantId ASC")
      .all(baselineId) as Row[];
    return rows.map((row) => ({
      baselineId: asString(row["baselineId"]),
      tenantId: asString(row["tenantId"]),
      at: asString(row["at"]),
      compliance: row["compliance"] as number,
    }));
  }
}

export async function openSqliteBaselinesRepository(
  options: BaselinesRepositoryOptions,
): Promise<SqliteBaselinesRepository> {
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
    return new SqliteBaselinesRepository(db, applied);
  } catch (error) {
    db.close();
    throw error;
  }
}
