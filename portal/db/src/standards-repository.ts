// Standards storage (EPIC-008 SPEC.md §5, §11.1, §11.4). Standard definitions are
// derived 1:1 from the control registry at load; a curated override row wins per
// field when present. Nothing here writes the derived definitions to the DB —
// only the optional overrides are persisted, keyed by checkId so a registry sync
// can be re-validated (§9 drift risk).
//
// The StandardDefinition shape mirrors the shared contract in
// portal/contracts/src/standards.ts; that module is not an exported subpath of
// @m365-assess/contracts, so the shape is restated here instead of importing
// across the workspace boundary (same pattern as schedule-repository.ts).
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SchemaVersionError } from "./repository.js";
import {
  SCHEMA_VERSIONS_TABLE,
  loadMigrations,
  runMigrations,
  type OpenSqliteRepositoryOptions,
} from "./sqlite-repository.js";

export const STANDARD_LICENSE_PRESETS = ["E3", "E5"] as const;
export type StandardLicensePreset = (typeof STANDARD_LICENSE_PRESETS)[number];

export interface StandardDefinition {
  id: string;
  checkId: string;
  name: string;
  category: string;
  licensePreset: StandardLicensePreset | null;
}

export interface StandardDefinitionOverride {
  checkId: string;
  name?: string;
  category?: string;
  licensePreset?: StandardLicensePreset | null;
  updatedAt?: string;
  updatedBy?: string;
}

export interface UpsertStandardOverrideInput {
  checkId: string;
  name?: string | null;
  category?: string | null;
  licensePreset?: StandardLicensePreset | null;
  updatedBy?: string | null;
}

// ─── Templates and assignments (mirror of portal/contracts/src/standards.ts) ──

export const STANDARD_TEMPLATE_KINDS = ["standards", "drift"] as const;
export type StandardTemplateKind = (typeof STANDARD_TEMPLATE_KINDS)[number];

export interface StandardTemplateActions {
  report: boolean;
  alert: boolean;
  remediate: boolean;
}

export interface StandardTemplateSetting {
  key: string;
  value: unknown;
}

export interface StandardTemplate {
  id: string;
  name: string;
  kind: StandardTemplateKind;
  actions: StandardTemplateActions;
  autoRemediate: boolean;
  settings: StandardTemplateSetting[];
  scheduleId: string | null;
}

export const TEMPLATE_TARGET_TYPES = ["allTenants", "group", "tenant"] as const;
export type TemplateTargetType = (typeof TEMPLATE_TARGET_TYPES)[number];

export interface TemplateAssignment {
  templateId: string;
  targetType: TemplateTargetType;
  targetId: string | null;
  precedence: number;
}

export interface CreateStandardTemplateInput {
  id: string;
  name: string;
  kind: StandardTemplateKind;
  actions?: Partial<StandardTemplateActions>;
  autoRemediate?: boolean;
  settings?: StandardTemplateSetting[];
  scheduleId?: string | null;
}

export interface UpsertTemplateAssignmentInput {
  templateId: string;
  targetType: TemplateTargetType;
  targetId?: string | null;
  precedence?: number;
}

/** Fields left undefined keep their stored value. */
export interface UpdateStandardTemplatePatch {
  name?: string;
  kind?: StandardTemplateKind;
  actions?: Partial<StandardTemplateActions>;
  autoRemediate?: boolean;
  settings?: readonly StandardTemplateSetting[];
  scheduleId?: string | null;
}

// ─── StandardCompare (SPEC §4.2, §5; T-0825) ─────────────────────────────────

export const STANDARD_COMPARE_STATES = [
  "compliant",
  "non-compliant",
  "accepted deviation",
  "customer specific",
  "license missing",
  "reporting disabled",
] as const;
export type StandardCompareState = (typeof STANDARD_COMPARE_STATES)[number];

/** One tenant's current vs expected value for one standard, from its latest run. */
export interface StandardCompare {
  tenantId: string;
  checkId: string;
  current: unknown;
  expected: unknown;
  state: StandardCompareState;
  lastRunAt: string | null;
}

/** A compare row for the BFF, whose guard forbids the check reference's db name. */
export interface StandardCompareView extends Omit<StandardCompare, "checkId"> {
  check: string;
}

/** A definition for the BFF, whose guard forbids the check reference's db name. */
export interface StandardDefinitionView extends Omit<StandardDefinition, "checkId"> {
  check: string;
}

export function toStandardDefinitionView({ checkId, ...rest }: StandardDefinition): StandardDefinitionView {
  return { ...rest, check: checkId };
}

export function toStandardCompareView({ checkId, ...rest }: StandardCompare): StandardCompareView {
  return { ...rest, check: checkId };
}

/** The default registry source: src/M365-Assess/controls/registry.json. */
export const DEFAULT_STANDARDS_REGISTRY_PATH = fileURLToPath(
  new URL("../../../src/M365-Assess/controls/registry.json", import.meta.url),
);

export interface StandardsRepositoryOptions extends OpenSqliteRepositoryOptions {
  /** Registry to derive definitions from; defaults to the shipped registry. */
  registryPath?: string;
}

export interface StandardsRepository {
  readonly schemaVersion: number;

  close(): void;

  /** Definitions derived from the registry, with curated overrides applied. */
  listDefinitions(): Promise<StandardDefinition[]>;
  listDefinitionsByCategory(category: string): Promise<StandardDefinition[]>;
  getDefinition(checkId: string): Promise<StandardDefinition | undefined>;

  /** Curated overrides, keyed by checkId. */
  listOverrides(): Promise<StandardDefinitionOverride[]>;
  upsertOverride(input: UpsertStandardOverrideInput): Promise<StandardDefinitionOverride>;
  deleteOverride(checkId: string): Promise<boolean>;

  // Templates and assignments (SPEC §5, §4.1).
  createStandardTemplate(input: CreateStandardTemplateInput): Promise<StandardTemplate>;
  getStandardTemplate(templateId: string): Promise<StandardTemplate | undefined>;
  listStandardTemplates(): Promise<StandardTemplate[]>;
  updateStandardTemplate(
    templateId: string,
    patch: UpdateStandardTemplatePatch,
  ): Promise<StandardTemplate | undefined>;
  deleteStandardTemplate(templateId: string): Promise<boolean>;

  upsertTemplateAssignment(input: UpsertTemplateAssignmentInput): Promise<TemplateAssignment>;
  listTemplateAssignments(): Promise<TemplateAssignment[]>;
  deleteTemplateAssignment(
    templateId: string,
    targetType: TemplateTargetType,
    targetId: string | null,
  ): Promise<boolean>;

  // Compare rows (SPEC §4.2, §5).
  upsertCompare(rows: readonly StandardCompare[]): Promise<void>;
  /** Every tenant's rows, or one tenant's, ordered by tenant then standard. */
  listCompare(tenantId?: string): Promise<StandardCompare[]>;
}

const DEFAULT_TEMPLATE_ACTIONS: StandardTemplateActions = {
  report: true,
  alert: true,
  remediate: false,
};

type Row = Record<string, unknown>;

// ─── Registry loading ─────────────────────────────────────────────────────────

interface RegistryCheck {
  checkId?: unknown;
  name?: unknown;
  category?: unknown;
  licensing?: { minimum?: unknown } | null;
}

interface RegistryFile {
  checks?: unknown;
}

function asString(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function toLicensePreset(value: unknown): StandardLicensePreset | null {
  const text = asString(value);
  return (STANDARD_LICENSE_PRESETS as readonly string[]).includes(text)
    ? (text as StandardLicensePreset)
    : null;
}

function parseRegistry(registryPath: string): StandardDefinition[] {
  const raw = readFileSync(registryPath, "utf8");
  const parsed = JSON.parse(raw) as RegistryFile;
  const checks = Array.isArray(parsed.checks) ? (parsed.checks as RegistryCheck[]) : [];
  const definitions: StandardDefinition[] = [];
  for (const check of checks) {
    const checkId = asString(check.checkId);
    if (!checkId) continue;
    definitions.push({
      // 1:1 with registry checks for v1 (SPEC §11.1): the id is the checkId.
      id: checkId,
      checkId,
      name: asString(check.name),
      category: asString(check.category),
      licensePreset: toLicensePreset(check.licensing?.minimum),
    });
  }
  return definitions;
}

// ─── Override merge ───────────────────────────────────────────────────────────

function applyOverride(
  definition: StandardDefinition,
  override: StandardDefinitionOverride,
): StandardDefinition {
  return {
    ...definition,
    name: override.name ?? definition.name,
    category: override.category ?? definition.category,
    // An explicit `licensePreset` (including null) wins; `undefined` falls back.
    licensePreset:
      override.licensePreset === undefined ? definition.licensePreset : override.licensePreset,
  };
}

function mapOverride(row: Row): StandardDefinitionOverride {
  const override: StandardDefinitionOverride = { checkId: asString(row["checkId"]) };
  if (row["name"] !== null && row["name"] !== undefined) override.name = asString(row["name"]);
  if (row["category"] !== null && row["category"] !== undefined) {
    override.category = asString(row["category"]);
  }
  if (row["licensePreset"] !== null && row["licensePreset"] !== undefined) {
    override.licensePreset = asString(row["licensePreset"]) as StandardLicensePreset;
  }
  if (row["updatedAt"] !== null && row["updatedAt"] !== undefined) {
    override.updatedAt = asString(row["updatedAt"]);
  }
  if (row["updatedBy"] !== null && row["updatedBy"] !== undefined) {
    override.updatedBy = asString(row["updatedBy"]);
  }
  return override;
}

export class SqliteStandardsRepository implements StandardsRepository {
  readonly schemaVersion: number;

  constructor(
    private readonly db: Database.Database,
    schemaVersion: number,
    private readonly registryPath: string,
  ) {
    this.schemaVersion = schemaVersion;
  }

  close(): void {
    this.db.close();
  }

  private derived(): StandardDefinition[] {
    return parseRegistry(this.registryPath);
  }

  private overridesByCheckId(): Map<string, StandardDefinitionOverride> {
    const rows = this.db
      .prepare("SELECT * FROM standard_definition_overrides ORDER BY checkId")
      .all() as Row[];
    const map = new Map<string, StandardDefinitionOverride>();
    for (const row of rows) {
      const override = mapOverride(row);
      map.set(override.checkId, override);
    }
    return map;
  }

  private resolveAll(): StandardDefinition[] {
    const overrides = this.overridesByCheckId();
    return this.derived().map((definition) => {
      const override = overrides.get(definition.checkId);
      return override ? applyOverride(definition, override) : definition;
    });
  }

  async listDefinitions(): Promise<StandardDefinition[]> {
    return this.resolveAll();
  }

  async listDefinitionsByCategory(category: string): Promise<StandardDefinition[]> {
    return this.resolveAll().filter((definition) => definition.category === category);
  }

  async getDefinition(checkId: string): Promise<StandardDefinition | undefined> {
    return this.resolveAll().find((definition) => definition.checkId === checkId);
  }

  async listOverrides(): Promise<StandardDefinitionOverride[]> {
    return [...this.overridesByCheckId().values()];
  }

  async upsertOverride(input: UpsertStandardOverrideInput): Promise<StandardDefinitionOverride> {
    const checkId = asString(input.checkId);
    if (!checkId) {
      throw new Error("standard override requires a checkId");
    }
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO standard_definition_overrides (checkId, name, category, licensePreset, updatedAt, updatedBy)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (checkId) DO UPDATE SET
           name = excluded.name,
           category = excluded.category,
           licensePreset = excluded.licensePreset,
           updatedAt = excluded.updatedAt,
           updatedBy = excluded.updatedBy`,
      )
      .run(
        checkId,
        input.name ?? null,
        input.category ?? null,
        input.licensePreset ?? null,
        updatedAt,
        input.updatedBy ?? null,
      );
    const row = this.db
      .prepare("SELECT * FROM standard_definition_overrides WHERE checkId = ?")
      .get(checkId) as Row;
    return mapOverride(row);
  }

  async deleteOverride(checkId: string): Promise<boolean> {
    const result = this.db
      .prepare("DELETE FROM standard_definition_overrides WHERE checkId = ?")
      .run(checkId);
    return result.changes > 0;
  }

  // ─── Templates and assignments ──────────────────────────────────────────────

  private mapTemplate(row: Row): StandardTemplate {
    return {
      id: asString(row["id"]),
      name: asString(row["name"]),
      kind: asString(row["kind"]) as StandardTemplateKind,
      actions: parseActions(row["actions"]),
      autoRemediate: Number(row["autoRemediate"]) === 1,
      settings: parseSettings(row["settings"]),
      scheduleId: row["scheduleId"] === null || row["scheduleId"] === undefined
        ? null
        : asString(row["scheduleId"]),
    };
  }

  async createStandardTemplate(input: CreateStandardTemplateInput): Promise<StandardTemplate> {
    const template: StandardTemplate = {
      id: input.id,
      name: input.name,
      kind: input.kind,
      actions: { ...DEFAULT_TEMPLATE_ACTIONS, ...(input.actions ?? {}) },
      autoRemediate: input.autoRemediate ?? false,
      settings: input.settings ?? [],
      scheduleId: input.scheduleId ?? null,
    };
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO standard_templates (id, name, kind, actions, autoRemediate, settings, scheduleId, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        template.id,
        template.name,
        template.kind,
        JSON.stringify(template.actions),
        template.autoRemediate ? 1 : 0,
        JSON.stringify(template.settings),
        template.scheduleId,
        now,
        now,
      );
    return template;
  }

  async getStandardTemplate(templateId: string): Promise<StandardTemplate | undefined> {
    const row = this.db
      .prepare("SELECT * FROM standard_templates WHERE id = ?")
      .get(templateId) as Row | undefined;
    return row ? this.mapTemplate(row) : undefined;
  }

  async listStandardTemplates(): Promise<StandardTemplate[]> {
    const rows = this.db
      .prepare("SELECT * FROM standard_templates ORDER BY id")
      .all() as Row[];
    return rows.map((row) => this.mapTemplate(row));
  }

  async updateStandardTemplate(
    templateId: string,
    patch: UpdateStandardTemplatePatch,
  ): Promise<StandardTemplate | undefined> {
    const existing = await this.getStandardTemplate(templateId);
    if (!existing) return undefined;
    const next: StandardTemplate = {
      ...existing,
      name: patch.name ?? existing.name,
      kind: patch.kind ?? existing.kind,
      actions: { ...existing.actions, ...(patch.actions ?? {}) },
      autoRemediate: patch.autoRemediate ?? existing.autoRemediate,
      settings: patch.settings ? [...patch.settings] : existing.settings,
      scheduleId: patch.scheduleId === undefined ? existing.scheduleId : patch.scheduleId,
    };
    this.db
      .prepare(
        `UPDATE standard_templates
            SET name = ?, kind = ?, actions = ?, autoRemediate = ?, settings = ?, scheduleId = ?, updatedAt = ?
          WHERE id = ?`,
      )
      .run(
        next.name,
        next.kind,
        JSON.stringify(next.actions),
        next.autoRemediate ? 1 : 0,
        JSON.stringify(next.settings),
        next.scheduleId,
        new Date().toISOString(),
        templateId,
      );
    return next;
  }

  async deleteStandardTemplate(templateId: string): Promise<boolean> {
    // Assignments reference the template; remove them first so the delete is
    // not blocked by the foreign key.
    this.db.prepare("DELETE FROM template_assignments WHERE templateId = ?").run(templateId);
    const result = this.db.prepare("DELETE FROM standard_templates WHERE id = ?").run(templateId);
    return result.changes > 0;
  }

  private mapAssignment(row: Row): TemplateAssignment {
    const targetId = row["targetId"];
    return {
      templateId: asString(row["templateId"]),
      targetType: asString(row["targetType"]) as TemplateTargetType,
      targetId: targetId === null || targetId === undefined || targetId === ""
        ? null
        : asString(targetId),
      precedence: Number(row["precedence"]),
    };
  }

  async upsertTemplateAssignment(
    input: UpsertTemplateAssignmentInput,
  ): Promise<TemplateAssignment> {
    const template = await this.getStandardTemplate(input.templateId);
    if (!template) {
      throw new Error(`standard template ${input.templateId} was not found`);
    }
    const targetId = input.targetId ?? "";
    this.db
      .prepare(
        `INSERT INTO template_assignments (templateId, targetType, targetId, precedence)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (templateId, targetType, targetId) DO UPDATE SET
           precedence = excluded.precedence`,
      )
      .run(input.templateId, input.targetType, targetId, input.precedence ?? 0);
    const row = this.db
      .prepare(
        "SELECT * FROM template_assignments WHERE templateId = ? AND targetType = ? AND targetId = ?",
      )
      .get(input.templateId, input.targetType, targetId) as Row;
    return this.mapAssignment(row);
  }

  async listTemplateAssignments(): Promise<TemplateAssignment[]> {
    const rows = this.db
      .prepare("SELECT * FROM template_assignments ORDER BY targetType, targetId, precedence, templateId")
      .all() as Row[];
    return rows.map((row) => this.mapAssignment(row));
  }

  async deleteTemplateAssignment(
    templateId: string,
    targetType: TemplateTargetType,
    targetId: string | null,
  ): Promise<boolean> {
    const result = this.db
      .prepare(
        "DELETE FROM template_assignments WHERE templateId = ? AND targetType = ? AND targetId = ?",
      )
      .run(templateId, targetType, targetId ?? "");
    return result.changes > 0;
  }

  // ─── Compare rows ───────────────────────────────────────────────────────────

  async upsertCompare(rows: readonly StandardCompare[]): Promise<void> {
    const upsert = this.db.prepare(
      `INSERT INTO standard_compare (tenantId, checkId, currentValue, expectedValue, state, lastRunAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenantId, checkId) DO UPDATE SET
         currentValue = excluded.currentValue, expectedValue = excluded.expectedValue,
         state = excluded.state, lastRunAt = excluded.lastRunAt`,
    );
    this.db.transaction(() => {
      for (const row of rows) {
        upsert.run(
          row.tenantId,
          row.checkId,
          JSON.stringify(row.current ?? null),
          JSON.stringify(row.expected ?? null),
          row.state,
          row.lastRunAt,
        );
      }
    })();
  }

  async listCompare(tenantId?: string): Promise<StandardCompare[]> {
    const rows = (
      tenantId === undefined
        ? this.db.prepare("SELECT * FROM standard_compare ORDER BY tenantId, checkId").all()
        : this.db.prepare("SELECT * FROM standard_compare WHERE tenantId = ? ORDER BY checkId").all(tenantId)
    ) as Row[];
    return rows.map((row) => ({
      tenantId: asString(row["tenantId"]),
      checkId: asString(row["checkId"]),
      current: parseJsonValue(row["currentValue"]),
      expected: parseJsonValue(row["expectedValue"]),
      state: asString(row["state"]) as StandardCompareState,
      lastRunAt: row["lastRunAt"] === null || row["lastRunAt"] === undefined ? null : asString(row["lastRunAt"]),
    }));
  }
}

function parseJsonValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(asString(value));
  } catch {
    return null;
  }
}

function parseActions(value: unknown): StandardTemplateActions {
  try {
    const parsed: unknown = JSON.parse(asString(value));
    if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_TEMPLATE_ACTIONS };
    const record = parsed as Record<string, unknown>;
    return {
      report: record["report"] === undefined ? DEFAULT_TEMPLATE_ACTIONS.report : Boolean(record["report"]),
      alert: record["alert"] === undefined ? DEFAULT_TEMPLATE_ACTIONS.alert : Boolean(record["alert"]),
      remediate:
        record["remediate"] === undefined
          ? DEFAULT_TEMPLATE_ACTIONS.remediate
          : Boolean(record["remediate"]),
    };
  } catch {
    return { ...DEFAULT_TEMPLATE_ACTIONS };
  }
}

function parseSettings(value: unknown): StandardTemplateSetting[] {
  try {
    const parsed: unknown = JSON.parse(asString(value));
    if (!Array.isArray(parsed)) return [];
    const settings: StandardTemplateSetting[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry as Record<string, unknown>;
      if (typeof record["key"] !== "string") continue;
      settings.push({ key: record["key"], value: record["value"] });
    }
    return settings;
  } catch {
    return [];
  }
}

export async function openSqliteStandardsRepository(
  options: StandardsRepositoryOptions,
): Promise<SqliteStandardsRepository> {
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
    return new SqliteStandardsRepository(
      db,
      applied,
      options.registryPath ?? DEFAULT_STANDARDS_REGISTRY_PATH,
    );
  } catch (error) {
    db.close();
    throw error;
  }
}
