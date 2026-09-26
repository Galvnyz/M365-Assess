// ReusableSettingTemplate persistence behind a repository interface (ADR-0015, EPIC-016 §5; T-0308).
// The BFF owns the storage contract; SQL lives only in the SQLite implementation and in the
// numbered migration under portal/db/migrations.
//
// v1 sync scope (SPEC §11.3): the reusable policy setting types Intune exposes for Windows
// configuration (settings catalog / endpoint security) policies — the supported registry type
// in T-0301. A template whose settingInstance is outside this scope is rejected. The
// Sync-ReusableSettings worker enumerates the same list.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

export interface ReusableSettingType {
  /** Stable key used in API responses. */
  readonly key: string;
  readonly displayName: string;
  /** settingInstance.settingDefinitionId prefix identifying the type. */
  readonly settingDefinitionPrefix: string;
  /** T-0301 registry entry the type belongs to. */
  readonly policyKind: "configuration";
  readonly platform: "windows";
}

export const REUSABLE_SETTING_TYPES: readonly ReusableSettingType[] = Object.freeze([
  Object.freeze({
    key: "firewallRemoteAddresses",
    displayName: "Firewall remote IP address ranges",
    settingDefinitionPrefix: "vendor_msft_firewall_mdmstore_dynamickeywords_addresses_",
    policyKind: "configuration",
    platform: "windows",
  } as const),
  Object.freeze({
    key: "deviceControlGroups",
    displayName: "Defender device control groups",
    settingDefinitionPrefix: "device_vendor_msft_defender_configuration_devicecontrol_policygroups_",
    policyKind: "configuration",
    platform: "windows",
  } as const),
]);

export const REUSABLE_SETTING_ODATA_TYPE = "#microsoft.graph.deviceManagementReusablePolicySetting";

/** The v1 scope type for a settingDefinitionId, or undefined when out of scope. */
export function reusableSettingTypeFor(settingDefinitionId: unknown): ReusableSettingType | undefined {
  if (typeof settingDefinitionId !== "string") return undefined;
  const id = settingDefinitionId.toLowerCase();
  return REUSABLE_SETTING_TYPES.find((t) => id.startsWith(t.settingDefinitionPrefix));
}

export interface ReusableSettingTemplate {
  id: string;
  name: string;
  settingsJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ReusableSettingTemplateCreateInput {
  id?: string;
  name: string;
  settingsJson: Record<string, unknown>;
}

export interface ReusableSettingTemplateUpdateInput {
  name?: string;
  settingsJson?: Record<string, unknown>;
}

export interface ReusableSettingTemplateRepository {
  list(options?: { includeDeleted?: boolean }): Promise<ReusableSettingTemplate[]>;
  get(id: string, options?: { includeDeleted?: boolean }): Promise<ReusableSettingTemplate | undefined>;
  create(input: ReusableSettingTemplateCreateInput): Promise<ReusableSettingTemplate>;
  update(id: string, input: ReusableSettingTemplateUpdateInput): Promise<ReusableSettingTemplate | undefined>;
  remove(id: string): Promise<boolean>;
}

export interface ValidationIssue {
  field: string;
  reason: string;
}

export class ReusableSettingTemplateValidationError extends Error {
  readonly code = "reusable_setting_template.invalid";
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super("Reusable setting template is not valid");
    this.name = "ReusableSettingTemplateValidationError";
    this.issues = issues;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * A settingsJson must be a Graph reusable policy setting body: a displayName (the key sync
 * matches live settings on) and a settingInstance whose settingDefinitionId is in the v1 scope.
 */
export function collectSettingsJsonIssues(settingsJson: unknown): ValidationIssue[] {
  if (!isPlainObject(settingsJson)) {
    return [{ field: "settingsJson", reason: "must be a JSON object" }];
  }
  const issues: ValidationIssue[] = [];
  if (!nonEmptyString(settingsJson["displayName"])) {
    issues.push({ field: "settingsJson.displayName", reason: "must be a non-empty string" });
  }
  const odataType = settingsJson["@odata.type"];
  if (odataType !== undefined && odataType !== REUSABLE_SETTING_ODATA_TYPE) {
    issues.push({ field: "settingsJson.@odata.type", reason: `must be ${REUSABLE_SETTING_ODATA_TYPE}` });
  }
  const instance = settingsJson["settingInstance"];
  if (!isPlainObject(instance)) {
    issues.push({ field: "settingsJson.settingInstance", reason: "must be a JSON object" });
  } else if (!nonEmptyString(instance["settingDefinitionId"])) {
    issues.push({
      field: "settingsJson.settingInstance.settingDefinitionId",
      reason: "must be a non-empty string",
    });
  } else if (!reusableSettingTypeFor(instance["settingDefinitionId"])) {
    issues.push({
      field: "settingsJson.settingInstance.settingDefinitionId",
      reason: `is outside the v1 sync scope; supported: ${REUSABLE_SETTING_TYPES.map((t) => t.displayName).join(", ")}`,
    });
  }
  return issues;
}

/** The v1 scope type of a (valid) template's settingsJson. */
export function reusableSettingTypeOf(settingsJson: Record<string, unknown>): ReusableSettingType | undefined {
  const instance = settingsJson["settingInstance"];
  return isPlainObject(instance) ? reusableSettingTypeFor(instance["settingDefinitionId"]) : undefined;
}

export function collectCreateIssues(input: ReusableSettingTemplateCreateInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!nonEmptyString(input.name)) issues.push({ field: "name", reason: "must be a non-empty string" });
  issues.push(...collectSettingsJsonIssues(input.settingsJson));
  return issues;
}

export function collectUpdateIssues(input: ReusableSettingTemplateUpdateInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (input.name !== undefined && !nonEmptyString(input.name)) {
    issues.push({ field: "name", reason: "must be a non-empty string" });
  }
  if (input.settingsJson !== undefined) issues.push(...collectSettingsJsonIssues(input.settingsJson));
  return issues;
}

function validate(issues: ValidationIssue[]): void {
  if (issues.length > 0) throw new ReusableSettingTemplateValidationError(issues);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nowIso(): string {
  return new Date().toISOString();
}

function cloneTemplate(row: ReusableSettingTemplate): ReusableSettingTemplate {
  return { ...row, settingsJson: cloneJson(row.settingsJson) };
}

export class InMemoryReusableSettingTemplateRepository implements ReusableSettingTemplateRepository {
  private readonly rows = new Map<string, ReusableSettingTemplate>();

  async list(options: { includeDeleted?: boolean } = {}): Promise<ReusableSettingTemplate[]> {
    return [...this.rows.values()]
      .filter((row) => options.includeDeleted === true || row.deletedAt === null)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(cloneTemplate);
  }

  async get(id: string, options: { includeDeleted?: boolean } = {}): Promise<ReusableSettingTemplate | undefined> {
    const row = this.rows.get(id);
    if (!row || (!options.includeDeleted && row.deletedAt !== null)) return undefined;
    return cloneTemplate(row);
  }

  async create(input: ReusableSettingTemplateCreateInput): Promise<ReusableSettingTemplate> {
    validate(collectCreateIssues(input));
    const id = input.id ?? globalThis.crypto.randomUUID();
    if (this.rows.has(id)) {
      throw new ReusableSettingTemplateValidationError([{ field: "id", reason: `${id} already exists` }]);
    }
    const at = nowIso();
    const row: ReusableSettingTemplate = {
      id,
      name: input.name.trim(),
      settingsJson: cloneJson(input.settingsJson),
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    };
    this.rows.set(id, row);
    return cloneTemplate(row);
  }

  async update(id: string, input: ReusableSettingTemplateUpdateInput): Promise<ReusableSettingTemplate | undefined> {
    const existing = this.rows.get(id);
    if (!existing || existing.deletedAt !== null) return undefined;
    validate(collectUpdateIssues(input));
    const next: ReusableSettingTemplate = {
      ...existing,
      name: input.name?.trim() ?? existing.name,
      settingsJson: input.settingsJson === undefined ? existing.settingsJson : cloneJson(input.settingsJson),
      updatedAt: nowIso(),
    };
    this.rows.set(id, next);
    return cloneTemplate(next);
  }

  async remove(id: string): Promise<boolean> {
    const existing = this.rows.get(id);
    if (!existing || existing.deletedAt !== null) return false;
    const at = nowIso();
    this.rows.set(id, { ...existing, deletedAt: at, updatedAt: at });
    return true;
  }
}

type Row = Record<string, unknown>;

const MIGRATION_URL = new URL("../../../db/migrations/0077_reusable_setting_templates.sql", import.meta.url);

export function reusableSettingTemplateMigrationSql(): string {
  return readFileSync(fileURLToPath(MIGRATION_URL), "utf8");
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(String(value));
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export class SqliteReusableSettingTemplateRepository implements ReusableSettingTemplateRepository {
  constructor(private readonly db: Database.Database) {
    this.db.exec(reusableSettingTemplateMigrationSql());
  }

  private mapRow(row: Row): ReusableSettingTemplate {
    return {
      id: String(row["id"]),
      name: String(row["name"]),
      settingsJson: parseJsonObject(row["settingsJson"]),
      createdAt: String(row["createdAt"]),
      updatedAt: String(row["updatedAt"]),
      deletedAt: row["deletedAt"] === null || row["deletedAt"] === undefined ? null : String(row["deletedAt"]),
    };
  }

  async list(options: { includeDeleted?: boolean } = {}): Promise<ReusableSettingTemplate[]> {
    const sql =
      options.includeDeleted === true
        ? "SELECT * FROM reusable_setting_templates ORDER BY name"
        : "SELECT * FROM reusable_setting_templates WHERE deletedAt IS NULL ORDER BY name";
    return (this.db.prepare(sql).all() as Row[]).map((row) => this.mapRow(row));
  }

  async get(id: string, options: { includeDeleted?: boolean } = {}): Promise<ReusableSettingTemplate | undefined> {
    const sql =
      options.includeDeleted === true
        ? "SELECT * FROM reusable_setting_templates WHERE id = ?"
        : "SELECT * FROM reusable_setting_templates WHERE id = ? AND deletedAt IS NULL";
    const row = this.db.prepare(sql).get(id) as Row | undefined;
    return row ? this.mapRow(row) : undefined;
  }

  async create(input: ReusableSettingTemplateCreateInput): Promise<ReusableSettingTemplate> {
    validate(collectCreateIssues(input));
    const id = input.id ?? globalThis.crypto.randomUUID();
    if (await this.get(id, { includeDeleted: true })) {
      throw new ReusableSettingTemplateValidationError([{ field: "id", reason: `${id} already exists` }]);
    }
    const at = nowIso();
    this.db
      .prepare(
        `INSERT INTO reusable_setting_templates (id, name, settingsJson, createdAt, updatedAt, deletedAt)
         VALUES (?, ?, ?, ?, ?, NULL)`,
      )
      .run(id, input.name.trim(), JSON.stringify(input.settingsJson), at, at);
    const created = await this.get(id);
    if (!created) throw new Error(`Reusable setting template ${id} was not persisted`);
    return created;
  }

  async update(id: string, input: ReusableSettingTemplateUpdateInput): Promise<ReusableSettingTemplate | undefined> {
    const existing = await this.get(id);
    if (!existing) return undefined;
    validate(collectUpdateIssues(input));
    this.db
      .prepare(
        `UPDATE reusable_setting_templates SET name = ?, settingsJson = ?, updatedAt = ?
         WHERE id = ? AND deletedAt IS NULL`,
      )
      .run(
        input.name?.trim() ?? existing.name,
        JSON.stringify(input.settingsJson ?? existing.settingsJson),
        nowIso(),
        id,
      );
    return this.get(id);
  }

  async remove(id: string): Promise<boolean> {
    const at = nowIso();
    const info = this.db
      .prepare(
        "UPDATE reusable_setting_templates SET deletedAt = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL",
      )
      .run(at, at, id);
    return info.changes > 0;
  }
}
