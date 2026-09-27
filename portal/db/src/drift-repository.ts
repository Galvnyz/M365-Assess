// Drift storage (EPIC-009 SPEC.md §5, §11.1). A drift template is a
// StandardTemplate with kind='drift'; this repository owns the per-tenant
// binding that enforces "at most one drift template per tenant" and makes drift
// opt-in (a tenant with no binding has no drift state).
//
// The template rows themselves are managed through the standards repository, so
// standards and drift share one template storage and one settings shape. The
// DriftTemplate shape mirrors portal/contracts/src/drift.ts; that module is not
// an exported subpath of @m365-assess/contracts, so the shape is restated here.
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { SchemaVersionError } from "./repository.js";
import {
  SCHEMA_VERSIONS_TABLE,
  loadMigrations,
  runMigrations,
  type OpenSqliteRepositoryOptions,
} from "./sqlite-repository.js";
import {
  DEFAULT_STANDARDS_REGISTRY_PATH,
  SqliteStandardsRepository,
  type StandardTemplate,
  type StandardTemplateSetting,
} from "./standards-repository.js";

export interface DriftTemplate {
  readonly tenantId: string;
  readonly template: StandardTemplate;
  readonly seededFrom: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ─── DriftDeviation (EPIC-009 SPEC.md §5, §11.4; T-0162) ─────────────────────

export const DRIFT_DEVIATION_STATES = [
  "open",
  "accepted",
  "customerSpecific",
  "denied",
  "deletePending",
  "resolved",
] as const;
export type DriftDeviationState = (typeof DRIFT_DEVIATION_STATES)[number];

export const DRIFT_DEVIATION_KINDS = ["mismatch", "extra"] as const;
export type DriftDeviationKind = (typeof DRIFT_DEVIATION_KINDS)[number];

/** States an operator has settled; an upsert must never clear these. */
export const SETTLED_DEVIATION_STATES: readonly DriftDeviationState[] = [
  "accepted",
  "customerSpecific",
  "denied",
  "deletePending",
];

export interface DriftDeviation {
  readonly id: string;
  readonly tenantId: string;
  readonly standardKey: string;
  readonly resourceId: string;
  readonly kind: DriftDeviationKind;
  readonly current: unknown;
  readonly expected: unknown;
  readonly state: DriftDeviationState;
  readonly reason: string | null;
  readonly expiresOn: string | null;
  readonly autoRemediateOnExpiry: boolean;
  readonly overrideValue: unknown;
  readonly lastSeenAt: string;
}

export interface DriftDeviationInput {
  readonly standardKey: string;
  readonly resourceId?: string;
  readonly kind: DriftDeviationKind;
  readonly current: unknown;
  readonly expected: unknown;
  readonly lastSeenAt?: string;
}

export interface UpsertDeviationsResult {
  readonly inserted: number;
  readonly updated: number;
  /** Settled rows whose triage state was preserved across the upsert. */
  readonly preserved: number;
}

export interface DeviationTriagePatch {
  readonly state: DriftDeviationState;
  readonly reason?: string | null;
  readonly expiresOn?: string | null;
  readonly autoRemediateOnExpiry?: boolean;
  readonly overrideValue?: unknown;
}

export interface ListDeviationsOptions {
  readonly state?: DriftDeviationState;
  readonly kind?: DriftDeviationKind;
}

export interface CloneToSeedOptions {
  /** New template name; defaults to "<source> (drift)". */
  readonly name?: string;
  /** Actor recorded as the template author. */
  readonly createdBy?: string;
}

/** Raised when a second, different drift template is bound to a tenant. */
export class DriftTemplateExistsError extends Error {
  readonly code = "drift.template_exists";

  constructor(tenantId: string, templateId: string) {
    super(`tenant ${tenantId} already has drift template ${templateId}`);
    this.name = "DriftTemplateExistsError";
  }
}

/** Raised when a tenant is bound to a template that is not a drift kind. */
export class DriftTemplateKindError extends Error {
  readonly code = "drift.template_not_drift";

  constructor(templateId: string) {
    super(`template ${templateId} is not a drift template`);
    this.name = "DriftTemplateKindError";
  }
}

export interface DriftRepositoryOptions extends OpenSqliteRepositoryOptions {
  registryPath?: string;
}

export interface DriftRepository {
  readonly schemaVersion: number;

  close(): void;

  /** The tenant's drift template, or undefined when drift is not enabled. */
  getDriftTemplate(tenantId: string): Promise<DriftTemplate | undefined>;
  hasDriftTemplate(tenantId: string): Promise<boolean>;
  listDriftTemplates(): Promise<DriftTemplate[]>;

  /** Bind an existing drift template to a tenant (one per tenant). */
  bindDriftTemplate(
    tenantId: string,
    templateId: string,
    options?: { seededFrom?: string | null },
  ): Promise<DriftTemplate>;

  /** Seed a new tenant's drift template by cloning an existing template. */
  cloneToSeed(
    sourceTemplateId: string,
    tenantId: string,
    options?: CloneToSeedOptions,
  ): Promise<DriftTemplate>;

  /** Remove a tenant's drift binding (opt out). The template row is kept. */
  unbindDriftTemplate(tenantId: string): Promise<boolean>;

  // Deviations (T-0162).
  upsertDeviations(
    tenantId: string,
    deviations: readonly DriftDeviationInput[],
  ): Promise<UpsertDeviationsResult>;
  listDeviations(tenantId: string, options?: ListDeviationsOptions): Promise<DriftDeviation[]>;
  getDeviation(
    tenantId: string,
    standardKey: string,
    resourceId: string,
  ): Promise<DriftDeviation | undefined>;
  /** The triage write primitive used by the accept/override/deny routes. */
  setDeviationTriage(
    tenantId: string,
    standardKey: string,
    resourceId: string,
    patch: DeviationTriagePatch,
  ): Promise<DriftDeviation | undefined>;

  // By deviation id, and across tenants (T-0825).
  getDeviationById(deviationId: string): Promise<DriftDeviation | undefined>;
  setDeviationTriageById(
    deviationId: string,
    patch: DeviationTriagePatch,
  ): Promise<DriftDeviation | undefined>;
  listAllDeviations(): Promise<DriftDeviation[]>;
  /** Deviation counts per state across every tenant, zero-filled, plus a total. */
  countDeviationsByState(): Promise<DeviationStateCounts>;
  /** Open deviation counts keyed by tenant; tenants with none are absent. */
  countOpenDeviationsByTenant(): Promise<Record<string, number>>;
}

export type DeviationStateCounts = Record<DriftDeviationState, number> & { total: number };

type Row = Record<string, unknown>;

function asString(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function asNullableString(value: unknown): string | null {
  return value === null || value === undefined || value === "" ? null : String(value);
}

function parseJson(value: unknown): unknown {
  if (value === null || value === undefined || value === "") return null;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function deepCopySettings(
  settings: readonly StandardTemplateSetting[],
): StandardTemplateSetting[] {
  return settings.map((setting) => ({
    key: setting.key,
    value: structuredClone(setting.value),
  }));
}

export class SqliteDriftRepository implements DriftRepository {
  readonly schemaVersion: number;
  private readonly standards: SqliteStandardsRepository;

  constructor(
    private readonly db: Database.Database,
    schemaVersion: number,
    registryPath: string,
  ) {
    this.schemaVersion = schemaVersion;
    this.standards = new SqliteStandardsRepository(db, schemaVersion, registryPath);
  }

  close(): void {
    this.db.close();
  }

  private async hydrate(row: Row): Promise<DriftTemplate | undefined> {
    const templateId = asString(row["templateId"]);
    const template = await this.standards.getStandardTemplate(templateId);
    if (!template) return undefined;
    return {
      tenantId: asString(row["tenantId"]),
      template,
      seededFrom: asNullableString(row["seededFrom"]),
      createdAt: asString(row["createdAt"]),
      updatedAt: asString(row["updatedAt"]),
    };
  }

  async getDriftTemplate(tenantId: string): Promise<DriftTemplate | undefined> {
    const row = this.db
      .prepare("SELECT * FROM drift_templates WHERE tenantId = ?")
      .get(tenantId) as Row | undefined;
    return row ? this.hydrate(row) : undefined;
  }

  async hasDriftTemplate(tenantId: string): Promise<boolean> {
    const row = this.db
      .prepare("SELECT 1 AS present FROM drift_templates WHERE tenantId = ?")
      .get(tenantId) as Row | undefined;
    return row !== undefined;
  }

  async listDriftTemplates(): Promise<DriftTemplate[]> {
    const rows = this.db
      .prepare("SELECT * FROM drift_templates ORDER BY tenantId")
      .all() as Row[];
    const result: DriftTemplate[] = [];
    for (const row of rows) {
      const hydrated = await this.hydrate(row);
      if (hydrated) result.push(hydrated);
    }
    return result;
  }

  async bindDriftTemplate(
    tenantId: string,
    templateId: string,
    options: { seededFrom?: string | null } = {},
  ): Promise<DriftTemplate> {
    const template = await this.standards.getStandardTemplate(templateId);
    if (!template) {
      throw new Error(`drift template ${templateId} was not found`);
    }
    if (template.kind !== "drift") {
      throw new DriftTemplateKindError(templateId);
    }

    const existing = await this.getDriftTemplate(tenantId);
    if (existing) {
      // Idempotent for the same template; a different one is rejected so the
      // one-per-tenant invariant can never be silently replaced.
      if (existing.template.id === templateId) return existing;
      throw new DriftTemplateExistsError(tenantId, existing.template.id);
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO drift_templates (tenantId, templateId, seededFrom, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(tenantId, templateId, options.seededFrom ?? null, now, now);

    const bound = await this.getDriftTemplate(tenantId);
    if (!bound) {
      throw new Error(`drift template binding for ${tenantId} was not persisted`);
    }
    return bound;
  }

  async cloneToSeed(
    sourceTemplateId: string,
    tenantId: string,
    options: CloneToSeedOptions = {},
  ): Promise<DriftTemplate> {
    const source = await this.standards.getStandardTemplate(sourceTemplateId);
    if (!source) {
      throw new Error(`source template ${sourceTemplateId} was not found`);
    }
    // Drift is opt-in: seeding a tenant that already has a drift template is a
    // conflict, not an overwrite.
    if (await this.hasDriftTemplate(tenantId)) {
      const existing = await this.getDriftTemplate(tenantId);
      throw new DriftTemplateExistsError(tenantId, existing?.template.id ?? sourceTemplateId);
    }

    const seeded = await this.standards.createStandardTemplate({
      id: randomUUID(),
      name: options.name ?? `${source.name} (drift)`,
      kind: "drift",
      // Drift is report-only by default (SPEC §11.5): the clone keeps the source's
      // per-setting auto-remediation flags (carried in settings) but never
      // inherits a blanket autoRemediate.
      actions: { report: true, alert: source.actions.alert, remediate: false },
      autoRemediate: false,
      settings: deepCopySettings(source.settings),
      scheduleId: null,
    });

    return this.bindDriftTemplate(tenantId, seeded.id, { seededFrom: sourceTemplateId });
  }

  async unbindDriftTemplate(tenantId: string): Promise<boolean> {
    const result = this.db
      .prepare("DELETE FROM drift_templates WHERE tenantId = ?")
      .run(tenantId);
    return result.changes > 0;
  }

  // ─── Deviations (T-0162) ────────────────────────────────────────────────────

  private mapDeviation(row: Row): DriftDeviation {
    return {
      id: asString(row["id"]),
      tenantId: asString(row["tenantId"]),
      standardKey: asString(row["standardKey"]),
      resourceId: asString(row["resourceId"]),
      kind: asString(row["kind"]) as DriftDeviationKind,
      current: parseJson(row["currentValue"]),
      expected: parseJson(row["expectedValue"]),
      state: asString(row["state"]) as DriftDeviationState,
      reason: asNullableString(row["reason"]),
      expiresOn: asNullableString(row["expiresOn"]),
      autoRemediateOnExpiry: Number(row["autoRemediateOnExpiry"]) === 1,
      overrideValue: parseJson(row["overrideValue"]),
      lastSeenAt: asString(row["lastSeenAt"]),
    };
  }

  private deviationRow(
    tenantId: string,
    standardKey: string,
    resourceId: string,
  ): Row | undefined {
    return this.db
      .prepare(
        "SELECT * FROM drift_deviations WHERE tenantId = ? AND standardKey = ? AND resourceId = ?",
      )
      .get(tenantId, standardKey, resourceId) as Row | undefined;
  }

  async upsertDeviations(
    tenantId: string,
    deviations: readonly DriftDeviationInput[],
  ): Promise<UpsertDeviationsResult> {
    let inserted = 0;
    let updated = 0;
    let preserved = 0;

    const insert = this.db.prepare(
      `INSERT INTO drift_deviations
         (id, tenantId, standardKey, resourceId, kind, currentValue, expectedValue, state, reason, expiresOn, autoRemediateOnExpiry, overrideValue, lastSeenAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', NULL, NULL, 0, NULL, ?)`,
    );
    // Refresh a still-open row (or reopen a resolved one) without touching triage.
    const refreshOpen = this.db.prepare(
      `UPDATE drift_deviations
         SET kind = ?, currentValue = ?, expectedValue = ?, state = 'open', reason = NULL,
             expiresOn = NULL, autoRemediateOnExpiry = 0, overrideValue = NULL, lastSeenAt = ?
       WHERE tenantId = ? AND standardKey = ? AND resourceId = ?`,
    );
    // A settled row keeps its triage state/reason/expiry/override; only the
    // observed current/expected and lastSeenAt move (SPEC §4.1 step 4, §9).
    const refreshSettled = this.db.prepare(
      `UPDATE drift_deviations
         SET kind = ?, currentValue = ?, expectedValue = ?, lastSeenAt = ?
       WHERE tenantId = ? AND standardKey = ? AND resourceId = ?`,
    );

    const run = this.db.transaction((items: readonly DriftDeviationInput[]) => {
      for (const item of items) {
        const standardKey = item.standardKey;
        const resourceId = item.resourceId ?? "";
        const lastSeenAt = item.lastSeenAt ?? new Date().toISOString();
        const currentValue = item.current === undefined ? null : JSON.stringify(item.current);
        const expectedValue = item.expected === undefined ? null : JSON.stringify(item.expected);
        const existing = this.deviationRow(tenantId, standardKey, resourceId);
        if (!existing) {
          insert.run(
            randomUUID(),
            tenantId,
            standardKey,
            resourceId,
            item.kind,
            currentValue,
            expectedValue,
            lastSeenAt,
          );
          inserted += 1;
          continue;
        }
        const settled = (SETTLED_DEVIATION_STATES as readonly string[]).includes(
          asString(existing["state"]),
        );
        if (settled) {
          refreshSettled.run(item.kind, currentValue, expectedValue, lastSeenAt, tenantId, standardKey, resourceId);
          preserved += 1;
        } else {
          refreshOpen.run(item.kind, currentValue, expectedValue, lastSeenAt, tenantId, standardKey, resourceId);
          updated += 1;
        }
      }
    });
    run(deviations);

    return { inserted, updated, preserved };
  }

  async listDeviations(
    tenantId: string,
    options: ListDeviationsOptions = {},
  ): Promise<DriftDeviation[]> {
    const filters = ["tenantId = ?"];
    const params: unknown[] = [tenantId];
    if (options.state) {
      filters.push("state = ?");
      params.push(options.state);
    }
    if (options.kind) {
      filters.push("kind = ?");
      params.push(options.kind);
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM drift_deviations WHERE ${filters.join(" AND ")}
         ORDER BY standardKey, resourceId`,
      )
      .all(...params) as Row[];
    return rows.map((row) => this.mapDeviation(row));
  }

  async getDeviation(
    tenantId: string,
    standardKey: string,
    resourceId: string,
  ): Promise<DriftDeviation | undefined> {
    const row = this.deviationRow(tenantId, standardKey, resourceId);
    return row ? this.mapDeviation(row) : undefined;
  }

  async setDeviationTriage(
    tenantId: string,
    standardKey: string,
    resourceId: string,
    patch: DeviationTriagePatch,
  ): Promise<DriftDeviation | undefined> {
    const existing = this.deviationRow(tenantId, standardKey, resourceId);
    if (!existing) return undefined;
    const overrideValue =
      patch.overrideValue === undefined ? null : JSON.stringify(patch.overrideValue);
    this.db
      .prepare(
        `UPDATE drift_deviations
           SET state = ?, reason = ?, expiresOn = ?, autoRemediateOnExpiry = ?, overrideValue = ?
         WHERE tenantId = ? AND standardKey = ? AND resourceId = ?`,
      )
      .run(
        patch.state,
        patch.reason ?? null,
        patch.expiresOn ?? null,
        patch.autoRemediateOnExpiry ? 1 : 0,
        overrideValue,
        tenantId,
        standardKey,
        resourceId,
      );
    const row = this.deviationRow(tenantId, standardKey, resourceId);
    return row ? this.mapDeviation(row) : undefined;
  }

  async getDeviationById(deviationId: string): Promise<DriftDeviation | undefined> {
    const row = this.db.prepare("SELECT * FROM drift_deviations WHERE id = ?").get(deviationId) as
      | Row
      | undefined;
    return row ? this.mapDeviation(row) : undefined;
  }

  async setDeviationTriageById(
    deviationId: string,
    patch: DeviationTriagePatch,
  ): Promise<DriftDeviation | undefined> {
    const existing = await this.getDeviationById(deviationId);
    if (!existing) return undefined;
    return this.setDeviationTriage(existing.tenantId, existing.standardKey, existing.resourceId, patch);
  }

  async listAllDeviations(): Promise<DriftDeviation[]> {
    const rows = this.db
      .prepare("SELECT * FROM drift_deviations ORDER BY tenantId, standardKey, resourceId")
      .all() as Row[];
    return rows.map((row) => this.mapDeviation(row));
  }

  async countDeviationsByState(): Promise<DeviationStateCounts> {
    const rows = this.db
      .prepare("SELECT state, COUNT(*) AS n FROM drift_deviations GROUP BY state")
      .all() as { state: DriftDeviationState; n: number }[];
    const counts = Object.fromEntries(DRIFT_DEVIATION_STATES.map((state) => [state, 0])) as DeviationStateCounts;
    counts.total = 0;
    for (const { state, n } of rows) {
      counts[state] = n;
      counts.total += n;
    }
    return counts;
  }

  async countOpenDeviationsByTenant(): Promise<Record<string, number>> {
    const rows = this.db
      .prepare("SELECT tenantId, COUNT(*) AS n FROM drift_deviations WHERE state = 'open' GROUP BY tenantId")
      .all() as { tenantId: string; n: number }[];
    return Object.fromEntries(rows.map(({ tenantId, n }) => [tenantId, n]));
  }
}

export async function openSqliteDriftRepository(
  options: DriftRepositoryOptions,
): Promise<SqliteDriftRepository> {
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
    return new SqliteDriftRepository(
      db,
      applied,
      options.registryPath ?? DEFAULT_STANDARDS_REGISTRY_PATH,
    );
  } catch (error) {
    db.close();
    throw error;
  }
}
