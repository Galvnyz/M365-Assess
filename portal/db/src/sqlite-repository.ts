// The only file that names the storage engine (ADR-0015). All SQL lives here
// or in numbered migrations; no SQL string escapes this directory.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import {
  SchemaVersionError,
  type AlertStateChange,
  type AlertStateChangeInput,
  type AlertStateChangeListOptions,
  type AuditEvent,
  type AuditEventInput,
  type AuditResult,
  type AuditActorType,
  type AuditSource,
  type BrandingColors,
  type BrandingConfig,
  type BrandingConfigInput,
  type BrandingFooter,
  type BrandingPageNumbers,
  type BrandingPreset,
  type BrandingReportDefaults,
  type BrandingWatermark,
  type Finding,
  type FindingInput,
  type FindingStatus,
  type GdapRelationship,
  type GdapRelationshipInput,
  type IncidentNote,
  type IncidentNoteInput,
  type Job,
  type JobInput,
  type JobState,
  type JobStateUpdate,
  type LinkRemovalJob,
  type LinkRemovalJobInput,
  type LinkRemovalJobState,
  type LinkRemovalJobUpdate,
  type ListOptions,
  type RemediationMode,
  type Repository,
  assertValidRunStatus,
  type RunRetentionOptions,
  type RunRetentionResult,
  type Run,
  type RunInput,
  type RunSection,
  type RunSectionInput,
  type RunStatus,
  type RunTrigger,
  type Severity,
  type SharePointSiteType,
  type SharePointTemplate,
  type SharePointTemplateInput,
  type SharePointTemplateUpdate,
  type SiteOperation,
  type SiteOperationInput,
  type SiteOperationUpdate,
  type TeamOperation,
  type TeamOperationInput,
  type TeamOperationUpdate,
  type TeamTemplate,
  type TeamTemplateInput,
  type TeamTemplateUpdate,
  type TeamVisibility,
  type Tenant,
  type TenantCredential,
  type TenantCredentialInput,
  type TenantGroup,
  type TenantGroupInput,
  type TenantGroupKind,
  type TenantGroupMember,
  type TenantGroupMemberInput,
  type TenantInput,
  type TenantListOptions,
  type TenantSource,
  type TenantStatus,
  type TenantVariable,
  type TenantVariableInput,
  type TenantVariableListOptions,
} from "./repository.js";

type Row = Record<string, unknown>;

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export interface OpenSqliteRepositoryOptions {
  filename: string;
  migrations?: Migration[];
  migrationsDir?: string;
}

export const SCHEMA_VERSIONS_TABLE =
  "CREATE TABLE IF NOT EXISTS schema_versions (version INTEGER PRIMARY KEY, appliedAt TEXT NOT NULL)";

const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));

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

function asBool(value: unknown): boolean {
  return asNumber(value) === 1;
}

function parseJson(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(String(value));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
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

function parseBrandingPresets(value: unknown): BrandingPreset[] {
  if (value === null || value === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(String(value));
    return Array.isArray(parsed) ? (parsed as BrandingPreset[]) : [];
  } catch {
    return [];
  }
}

function mapBrandingRow(row: Row): BrandingConfig {
  return {
    colors: (parseJson(row["colors"]) ?? {}) as unknown as BrandingColors,
    logoRef: asNullableString(row["logoRef"]),
    coverRef: asNullableString(row["coverRef"]),
    watermark: (parseJson(row["watermark"]) ?? {}) as unknown as BrandingWatermark,
    footer: (parseJson(row["footer"]) ?? {}) as unknown as BrandingFooter,
    pageNumbers: (parseJson(row["pageNumbers"]) ?? {}) as unknown as BrandingPageNumbers,
    presets: parseBrandingPresets(row["presets"]),
    perReportDefaults: (parseJson(row["perReportDefaults"]) ??
      {}) as Record<string, BrandingReportDefaults>,
    updatedAt: asString(row["updatedAt"]),
    updatedBy: asNullableString(row["updatedBy"]),
  };
}

// Storage boundary for SPEC §11.2: only relative artifact-tier references are
// persisted. Inline content (data: URLs), absolute paths, and remote URLs are
// rejected so blobs can never land in the branding row.
function assertBrandingAssetRef(
  value: string | null | undefined,
  field: string,
): string | null {
  if (value === null || value === undefined) return null;
  if (
    value.length === 0 ||
    value.length > 512 ||
    value.indexOf(String.fromCharCode(0)) !== -1 ||
    value.includes("..") ||
    value.startsWith("/") ||
    value.includes("\\") ||
    /\s/.test(value) ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
  ) {
    throw new Error(`branding.${field} must be an asset reference, not inline content`);
  }
  return value;
}

function assertUniqueMigrationVersions(migrations: Migration[]): void {
  const seen = new Map<number, string>();
  for (const migration of migrations) {
    const first = seen.get(migration.version);
    if (first !== undefined) {
      throw new Error(
        `duplicate migration version ${migration.version}: ${first} and ${migration.name}`,
      );
    }
    seen.set(migration.version, migration.name);
  }
}

export function loadMigrations(dir: string = DEFAULT_MIGRATIONS_DIR): Migration[] {
  const migrations: Migration[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".sql")) continue;
    const version = Number.parseInt(/^(\d+)/.exec(name)?.[1] ?? "", 10);
    if (Number.isNaN(version)) {
      throw new Error(`migration filename must start with a number: ${name}`);
    }
    migrations.push({ version, name, sql: readFileSync(join(dir, name), "utf8") });
  }
  migrations.sort((a, b) => a.version - b.version);
  assertUniqueMigrationVersions(migrations);
  return migrations;
}

function readSchemaVersion(db: Database.Database): number {
  const row = db
    .prepare("SELECT MAX(version) AS version FROM schema_versions")
    .get() as { version: number | null } | undefined;
  return row?.version === null || row?.version === undefined ? 0 : asNumber(row.version);
}

/**
 * Applies pending migrations in one transaction each and returns the resulting
 * schema version. Already-applied versions are skipped, so it is re-runnable.
 */
export function runMigrations(db: Database.Database, migrations: Migration[]): number {
  assertUniqueMigrationVersions(migrations);
  db.exec(SCHEMA_VERSIONS_TABLE);
  const applied = new Set<number>(
    (db.prepare("SELECT version FROM schema_versions").all() as Array<{ version: number }>).map(
      (row) => asNumber(row.version),
    ),
  );
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    try {
      db.transaction(() => {
        db.exec(migration.sql);
        db.prepare(
          "INSERT OR REPLACE INTO schema_versions (version, appliedAt) VALUES (?, ?)",
        ).run(migration.version, nowIso());
      })();
    } catch (error) {
      // Databases migrated before the 0002/0003 duplicates were renumbered already
      // contain the tenant columns added below, so re-applying them under the new
      // version number must not fail startup. Every other error still throws.
      if (!(error instanceof Error) || !/duplicate column name/i.test(error.message)) {
        throw error;
      }
      db.prepare("INSERT OR REPLACE INTO schema_versions (version, appliedAt) VALUES (?, ?)").run(
        migration.version,
        nowIso(),
      );
    }
  }
  return readSchemaVersion(db);
}

export class SqliteRepository implements Repository {
  readonly schemaVersion: number;
  readonly journalMode: string;

  constructor(
    private readonly db: Database.Database,
    schemaVersion: number,
    journalMode: string,
  ) {
    this.schemaVersion = schemaVersion;
    this.journalMode = journalMode;
  }

  close(): void {
    this.db.close();
  }

  private mapTenant(row: Row): Tenant {
    return {
      id: asString(row["id"]),
      displayName: asNullableString(row["displayName"]),
      defaultDomain: asNullableString(row["defaultDomain"]),
      initialDomain: asNullableString(row["initialDomain"]),
      source: asString(row["source"]) as TenantSource,
      status: asString(row["status"]) as TenantStatus,
      excluded: asBool(row["excluded"]),
      excludeReason: asNullableString(row["excludeReason"]),
      excludeDate: asNullableString(row["excludeDate"]),
      environment: asString(row["environment"]),
      lastRunAt: asNullableString(row["lastRunAt"]),
      errorCount: asNumber(row["errorCount"]),
      lastError: asNullableString(row["lastError"]),
      createdAt: asString(row["createdAt"]),
      updatedAt: asString(row["updatedAt"]),
      deletedAt: asNullableString(row["deletedAt"]),
    };
  }

  private mapCredential(row: Row): TenantCredential {
    return {
      id: asString(row["id"]),
      tenantId: asString(row["tenantId"]),
      authMethod: asString(row["authMethod"]),
      clientId: asString(row["clientId"]),
      secretRef: asString(row["secretRef"]),
      thumbprint: asNullableString(row["thumbprint"]),
      environment: asString(row["environment"]),
      expiresOn: asNullableString(row["expiresOn"]),
      lastValidated: asNullableString(row["lastValidated"]),
      createdAt: asString(row["createdAt"]),
      updatedAt: asString(row["updatedAt"]),
    };
  }

  private mapTenantGroup(row: Row): TenantGroup {
    return {
      id: asString(row["id"]),
      name: asString(row["name"]),
      kind: asString(row["kind"]) as TenantGroupKind,
      filter: parseJson(row["filter"]),
      createdAt: asString(row["createdAt"]),
      updatedAt: asString(row["updatedAt"]),
      deletedAt: asNullableString(row["deletedAt"]),
    };
  }

  private mapTenantGroupMember(row: Row): TenantGroupMember {
    return {
      groupId: asString(row["groupId"]),
      tenantId: asString(row["tenantId"]),
      createdAt: asString(row["createdAt"]),
      updatedAt: asString(row["updatedAt"]),
    };
  }

  private mapTenantVariable(row: Row): TenantVariable {
    return {
      id: asString(row["id"]),
      tenantId: asNullableString(row["tenantId"]),
      name: asString(row["name"]),
      value: asString(row["value"]),
      isSecret: asBool(row["isSecret"]),
      createdAt: asString(row["createdAt"]),
      updatedAt: asString(row["updatedAt"]),
    };
  }

  private mapGdapRelationship(row: Row): GdapRelationship {
    return {
      tenantId: asString(row["tenantId"]),
      relationshipEnd: asNullableString(row["relationshipEnd"]),
      delegatedPrivilegeStatus: asNullableString(row["delegatedPrivilegeStatus"]),
      cpvConsentState: asNullableString(row["cpvConsentState"]),
      lastSynced: asNullableString(row["lastSynced"]),
      createdAt: asString(row["createdAt"]),
      updatedAt: asString(row["updatedAt"]),
    };
  }

  private mapRun(row: Row): Run {
    return {
      id: asString(row["id"]),
      tenantId: asString(row["tenantId"]),
      parentRunId: asNullableString(row["parentRunId"]),
      trigger: asString(row["trigger"]) as RunTrigger,
      sections: parseJsonArray(row["sections"]),
      options: parseJson(row["options"]),
      startedAt: asNullableString(row["startedAt"]),
      finishedAt: asNullableString(row["finishedAt"]),
      status: asString(row["status"]) as RunStatus,
      artifactPath: asNullableString(row["artifactPath"]),
      summaryCounts: parseJson(row["summaryCounts"]),
      provenance: parseJson(row["provenance"]),
      createdAt: asString(row["createdAt"]),
      updatedAt: asString(row["updatedAt"]),
    };
  }

  private mapRunSection(row: Row): RunSection {
    return {
      id: asString(row["id"]),
      runId: asString(row["runId"]),
      tenantId: asString(row["tenantId"]),
      section: asString(row["section"]),
      collector: asNullableString(row["collector"]),
      status: asString(row["status"]),
      startedAt: asNullableString(row["startedAt"]),
      finishedAt: asNullableString(row["finishedAt"]),
      createdAt: asString(row["createdAt"]),
      updatedAt: asString(row["updatedAt"]),
    };
  }

  private mapFinding(row: Row): Finding {
    return {
      id: asString(row["id"]),
      runId: asString(row["runId"]),
      tenantId: asString(row["tenantId"]),
      checkId: asString(row["checkId"]),
      controlName: asNullableString(row["controlName"]),
      category: asNullableString(row["category"]),
      collector: asNullableString(row["collector"]),
      status: asString(row["status"]) as FindingStatus,
      severity: asNullableString(row["severity"]) as Severity | null,
      currentValue: asNullableString(row["currentValue"]),
      recommendedValue: asNullableString(row["recommendedValue"]),
      evidence: parseJson(row["evidence"]),
      frameworkRefs: parseJsonArray(row["frameworkRefs"]),
      remediationMode: asNullableString(row["remediationMode"]) as RemediationMode | null,
      createdAt: asString(row["createdAt"]),
      updatedAt: asString(row["updatedAt"]),
    };
  }

  private mapJob(row: Row): Job {
    return {
      id: asString(row["id"]),
      type: asString(row["type"]),
      tenantId: asNullableString(row["tenantId"]),
      payload: parseJson(row["payload"]),
      state: asString(row["state"]) as JobState,
      attempts: asNumber(row["attempts"]),
      progress: parseJson(row["progress"]),
      createdAt: asString(row["createdAt"]),
      updatedAt: asString(row["updatedAt"]),
    };
  }

  private mapLinkRemovalJob(row: Row): LinkRemovalJob {
    return {
      id: asString(row["id"]),
      tenantId: asString(row["tenantId"]),
      linkIds: parseJsonArray(row["linkIds"]),
      state: asString(row["state"]) as LinkRemovalJobState,
      results: parseJson(row["results"]),
      createdAt: asString(row["createdAt"]),
      createdBy: asString(row["createdBy"]),
    };
  }

  private mapAuditEvent(row: Row): AuditEvent {
    return {
      id: asString(row["id"]),
      timestamp: asString(row["timestamp"]),
      actorUserId: asNullableString(row["actorUserId"]),
      actorType: asString(row["actorType"]) as AuditActorType,
      tenantId: asNullableString(row["tenantId"]),
      action: asString(row["action"]),
      targetType: asNullableString(row["targetType"]),
      targetId: asNullableString(row["targetId"]),
      before: parseJson(row["before"]),
      after: parseJson(row["after"]),
      result: asString(row["result"]) as AuditResult,
      error: asNullableString(row["error"]),
      source: asString(row["source"]) as AuditSource,
      correlationId: asNullableString(row["correlationId"]),
      createdAt: asString(row["createdAt"]),
    };
  }

  private mapSharePointTemplate(row: Row): SharePointTemplate {
    return {
      id: asString(row["id"]),
      name: asString(row["name"]),
      siteType: asString(row["siteType"]) as SharePointSiteType,
      settings: parseJson(row["settings"]) ?? {},
      variables: parseJson(row["variables"]) ?? {},
      createdAt: asString(row["createdAt"]),
      updatedAt: asString(row["updatedAt"]),
      deletedAt: asNullableString(row["deletedAt"]),
    };
  }

  private mapSiteOperation(row: Row): SiteOperation {
    return {
      id: asString(row["id"]),
      tenantId: asString(row["tenantId"]),
      siteId: asString(row["siteId"]),
      operation: asString(row["operation"]),
      state: asString(row["state"]),
      by: asNullableString(row["by"]),
      at: asString(row["at"]),
      result: asNullableString(row["result"]),
      createdAt: asString(row["createdAt"]),
      updatedAt: asString(row["updatedAt"]),
    };
  }

  private mapTeamTemplate(row: Row): TeamTemplate {
    return {
      id: asString(row["id"]),
      name: asString(row["name"]),
      owners: parseJsonArray(row["owners"]),
      members: parseJsonArray(row["members"]),
      visibility: asString(row["visibility"]) as TeamVisibility,
      settings: parseJson(row["settings"]) ?? {},
      createdAt: asString(row["createdAt"]),
      updatedAt: asString(row["updatedAt"]),
      deletedAt: asNullableString(row["deletedAt"]),
    };
  }

  private mapTeamOperation(row: Row): TeamOperation {
    return {
      id: asString(row["id"]),
      tenantId: asString(row["tenantId"]),
      teamId: asString(row["teamId"]),
      operation: asString(row["operation"]),
      state: asString(row["state"]),
      by: asNullableString(row["by"]),
      at: asString(row["at"]),
      result: asNullableString(row["result"]),
      createdAt: asString(row["createdAt"]),
      updatedAt: asString(row["updatedAt"]),
    };
  }

  private mapIncidentNote(row: Row): IncidentNote {
    return {
      id: asString(row["id"]),
      tenantId: asString(row["tenantId"]),
      incidentId: asString(row["incidentId"]),
      body: asString(row["body"]),
      author: asNullableString(row["author"]),
      at: asString(row["at"]),
      createdAt: asString(row["createdAt"]),
      updatedAt: asString(row["updatedAt"]),
    };
  }

  private mapAlertStateChange(row: Row): AlertStateChange {
    return {
      id: asString(row["id"]),
      tenantId: asString(row["tenantId"]),
      alertId: asNullableString(row["alertId"]),
      incidentId: asNullableString(row["incidentId"]),
      from: asString(row["from"]),
      to: asString(row["to"]),
      by: asNullableString(row["by"]),
      at: asString(row["at"]),
      reason: asNullableString(row["reason"]),
      createdAt: asString(row["createdAt"]),
      updatedAt: asString(row["updatedAt"]),
    };
  }

  async getTenant(tenantId: string, options: ListOptions = {}): Promise<Tenant | undefined> {
    const sql = options.includeDeleted
      ? "SELECT * FROM tenants WHERE id = ?"
      : "SELECT * FROM tenants WHERE id = ? AND deletedAt IS NULL";
    const row = this.db.prepare(sql).get(tenantId) as Row | undefined;
    return row ? this.mapTenant(row) : undefined;
  }

  async listTenants(options: TenantListOptions = {}): Promise<Tenant[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (!options.includeDeleted) where.push("t.deletedAt IS NULL");
    if (options.groupId !== undefined) {
      where.push("t.id IN (SELECT tenantId FROM tenant_group_members WHERE groupId = ?)");
      params.push(options.groupId);
    }
    if (options.status !== undefined) {
      where.push("t.status = ?");
      params.push(options.status);
    }
    if (options.source !== undefined) {
      where.push("t.source = ?");
      params.push(options.source);
    }
    if (options.search !== undefined && options.search.length > 0) {
      const like = `%${options.search}%`;
      where.push("(t.displayName LIKE ? OR t.defaultDomain LIKE ? OR t.id LIKE ?)");
      params.push(like, like, like);
    }
    const sql =
      "SELECT t.* FROM tenants t" +
      (where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "") +
      " ORDER BY t.createdAt";
    return (this.db.prepare(sql).all(...params) as Row[]).map((row) => this.mapTenant(row));
  }

  async upsertTenant(input: TenantInput): Promise<Tenant> {
    const createdAt = input.createdAt ?? nowIso();
    const updatedAt = input.updatedAt ?? nowIso();
    this.db
      .prepare(
        `INSERT INTO tenants
           (id, displayName, defaultDomain, initialDomain, source, status, excluded, excludeReason, excludeDate, environment, lastRunAt, errorCount, lastError, createdAt, updatedAt, deletedAt)
         VALUES
           (@id, @displayName, @defaultDomain, @initialDomain, @source, @status, @excludedFlag, @excludeReason, @excludeDate, @environment, @lastRunAt, @errorCount, @lastError, @createdAt, @updatedAt, @deletedAt)
         ON CONFLICT(id) DO UPDATE SET
           displayName = excluded.displayName,
           defaultDomain = excluded.defaultDomain,
           initialDomain = excluded.initialDomain,
           source = excluded.source,
           status = excluded.status,
           excluded = excluded.excluded,
           excludeReason = excluded.excludeReason,
           excludeDate = excluded.excludeDate,
           environment = excluded.environment,
           lastRunAt = excluded.lastRunAt,
           errorCount = excluded.errorCount,
           lastError = excluded.lastError,
           updatedAt = excluded.updatedAt,
           deletedAt = excluded.deletedAt`,
      )
      .run({
        id: input.id,
        displayName: input.displayName ?? null,
        defaultDomain: input.defaultDomain ?? null,
        initialDomain: input.initialDomain ?? null,
        source: input.source,
        status: input.status,
        excludedFlag: input.excluded ? 1 : 0,
        excludeReason: input.excludeReason ?? null,
        excludeDate: input.excludeDate ?? null,
        environment: input.environment ?? "global",
        lastRunAt: input.lastRunAt ?? null,
        errorCount: input.errorCount,
        lastError: input.lastError ?? null,
        createdAt,
        updatedAt,
        deletedAt: input.deletedAt ?? null,
      });
    const tenant = await this.getTenant(input.id, { includeDeleted: true });
    if (!tenant) throw new Error(`tenant ${input.id} was not persisted`);
    return tenant;
  }

  async softDeleteTenant(tenantId: string, options: { now?: string } = {}): Promise<boolean> {
    const at = options.now ?? nowIso();
    const result = this.db
      .prepare("UPDATE tenants SET deletedAt = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL")
      .run(at, at, tenantId);
    return result.changes > 0;
  }

  private credentialById(id: string): TenantCredential | undefined {
    const row = this.db
      .prepare("SELECT * FROM tenant_credentials WHERE id = ?")
      .get(id) as Row | undefined;
    return row ? this.mapCredential(row) : undefined;
  }

  async getTenantCredential(tenantId: string): Promise<TenantCredential | undefined> {
    const row = this.db
      .prepare("SELECT * FROM tenant_credentials WHERE tenantId = ? ORDER BY createdAt LIMIT 1")
      .get(tenantId) as Row | undefined;
    return row ? this.mapCredential(row) : undefined;
  }

  async listTenantCredentials(tenantId: string): Promise<TenantCredential[]> {
    return (
      this.db
        .prepare("SELECT * FROM tenant_credentials WHERE tenantId = ? ORDER BY createdAt")
        .all(tenantId) as Row[]
    ).map((row) => this.mapCredential(row));
  }

  async upsertTenantCredential(input: TenantCredentialInput): Promise<TenantCredential> {
    const createdAt = input.createdAt ?? nowIso();
    const updatedAt = input.updatedAt ?? nowIso();
    this.db
      .prepare(
        `INSERT INTO tenant_credentials
           (id, tenantId, authMethod, clientId, secretRef, thumbprint, environment, expiresOn, lastValidated, createdAt, updatedAt)
         VALUES
           (@id, @tenantId, @authMethod, @clientId, @secretRef, @thumbprint, @environment, @expiresOn, @lastValidated, @createdAt, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           tenantId = excluded.tenantId,
           authMethod = excluded.authMethod,
           clientId = excluded.clientId,
           secretRef = excluded.secretRef,
           thumbprint = excluded.thumbprint,
           environment = excluded.environment,
           expiresOn = excluded.expiresOn,
           lastValidated = excluded.lastValidated,
           updatedAt = excluded.updatedAt`,
      )
      .run({
        id: input.id,
        tenantId: input.tenantId,
        authMethod: input.authMethod,
        clientId: input.clientId,
        secretRef: input.secretRef,
        thumbprint: input.thumbprint ?? null,
        environment: input.environment,
        expiresOn: input.expiresOn ?? null,
        lastValidated: input.lastValidated ?? null,
        createdAt,
        updatedAt,
      });
    const credential = this.credentialById(input.id);
    if (!credential) throw new Error(`credential ${input.id} was not persisted`);
    return credential;
  }

  private tenantGroupById(id: string): TenantGroup | undefined {
    const row = this.db
      .prepare("SELECT * FROM tenant_groups WHERE id = ?")
      .get(id) as Row | undefined;
    return row ? this.mapTenantGroup(row) : undefined;
  }

  async getTenantGroup(groupId: string, options: ListOptions = {}): Promise<TenantGroup | undefined> {
    const sql = options.includeDeleted
      ? "SELECT * FROM tenant_groups WHERE id = ?"
      : "SELECT * FROM tenant_groups WHERE id = ? AND deletedAt IS NULL";
    const row = this.db.prepare(sql).get(groupId) as Row | undefined;
    return row ? this.mapTenantGroup(row) : undefined;
  }

  async listTenantGroups(options: ListOptions = {}): Promise<TenantGroup[]> {
    const sql = options.includeDeleted
      ? "SELECT * FROM tenant_groups ORDER BY name"
      : "SELECT * FROM tenant_groups WHERE deletedAt IS NULL ORDER BY name";
    return (this.db.prepare(sql).all() as Row[]).map((row) => this.mapTenantGroup(row));
  }

  async upsertTenantGroup(input: TenantGroupInput): Promise<TenantGroup> {
    const createdAt = input.createdAt ?? nowIso();
    const updatedAt = input.updatedAt ?? nowIso();
    this.db
      .prepare(
        `INSERT INTO tenant_groups (id, name, kind, filter, createdAt, updatedAt, deletedAt)
         VALUES (@id, @name, @kind, @filter, @createdAt, @updatedAt, @deletedAt)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           kind = excluded.kind,
           filter = excluded.filter,
           updatedAt = excluded.updatedAt,
           deletedAt = excluded.deletedAt`,
      )
      .run({
        id: input.id,
        name: input.name,
        kind: input.kind,
        filter: stringifyJson(input.filter),
        createdAt,
        updatedAt,
        deletedAt: input.deletedAt ?? null,
      });
    const group = this.tenantGroupById(input.id);
    if (!group) throw new Error(`tenant group ${input.id} was not persisted`);
    return group;
  }

  async softDeleteTenantGroup(groupId: string, options: { now?: string } = {}): Promise<boolean> {
    const at = options.now ?? nowIso();
    const result = this.db
      .prepare(
        "UPDATE tenant_groups SET deletedAt = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL",
      )
      .run(at, at, groupId);
    return result.changes > 0;
  }

  async addTenantGroupMember(input: TenantGroupMemberInput): Promise<TenantGroupMember> {
    const createdAt = input.createdAt ?? nowIso();
    const updatedAt = input.updatedAt ?? createdAt;
    this.db
      .prepare(
        `INSERT INTO tenant_group_members (groupId, tenantId, createdAt, updatedAt)
         VALUES (@groupId, @tenantId, @createdAt, @updatedAt)
         ON CONFLICT(groupId, tenantId) DO UPDATE SET updatedAt = excluded.updatedAt`,
      )
      .run({
        groupId: input.groupId,
        tenantId: input.tenantId,
        createdAt,
        updatedAt,
      });
    const row = this.db
      .prepare("SELECT * FROM tenant_group_members WHERE groupId = ? AND tenantId = ?")
      .get(input.groupId, input.tenantId) as Row | undefined;
    if (!row) throw new Error(`tenant group member ${input.groupId}/${input.tenantId} was not persisted`);
    return this.mapTenantGroupMember(row);
  }

  async removeTenantGroupMember(groupId: string, tenantId: string): Promise<boolean> {
    const result = this.db
      .prepare("DELETE FROM tenant_group_members WHERE groupId = ? AND tenantId = ?")
      .run(groupId, tenantId);
    return result.changes > 0;
  }

  async listTenantGroupMembers(groupId: string): Promise<TenantGroupMember[]> {
    return (
      this.db
        .prepare("SELECT * FROM tenant_group_members WHERE groupId = ? ORDER BY tenantId")
        .all(groupId) as Row[]
    ).map((row) => this.mapTenantGroupMember(row));
  }

  async listTenantGroupsForTenant(tenantId: string): Promise<TenantGroup[]> {
    return (
      this.db
        .prepare(
          `SELECT g.* FROM tenant_groups g
           JOIN tenant_group_members m ON m.groupId = g.id
           WHERE m.tenantId = ? AND g.deletedAt IS NULL
           ORDER BY g.name`,
        )
        .all(tenantId) as Row[]
    ).map((row) => this.mapTenantGroup(row));
  }

  private tenantVariableById(id: string): TenantVariable | undefined {
    const row = this.db
      .prepare("SELECT * FROM tenant_variables WHERE id = ?")
      .get(id) as Row | undefined;
    return row ? this.mapTenantVariable(row) : undefined;
  }

  async getTenantVariable(variableId: string): Promise<TenantVariable | undefined> {
    return this.tenantVariableById(variableId);
  }

  async listTenantVariables(options: TenantVariableListOptions = {}): Promise<TenantVariable[]> {
    if (options.tenantId === undefined) {
      return (
        this.db
          .prepare("SELECT * FROM tenant_variables ORDER BY tenantId, name")
          .all() as Row[]
      ).map((row) => this.mapTenantVariable(row));
    }
    const sql = options.includeGlobal
      ? "SELECT * FROM tenant_variables WHERE tenantId = ? OR tenantId IS NULL ORDER BY tenantId, name"
      : "SELECT * FROM tenant_variables WHERE tenantId = ? ORDER BY name";
    return (this.db.prepare(sql).all(options.tenantId) as Row[]).map((row) =>
      this.mapTenantVariable(row),
    );
  }

  async upsertTenantVariable(input: TenantVariableInput): Promise<TenantVariable> {
    const createdAt = input.createdAt ?? nowIso();
    const updatedAt = input.updatedAt ?? nowIso();
    this.db
      .prepare(
        `INSERT INTO tenant_variables (id, tenantId, name, value, isSecret, createdAt, updatedAt)
         VALUES (@id, @tenantId, @name, @value, @isSecretFlag, @createdAt, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           tenantId = excluded.tenantId,
           name = excluded.name,
           value = excluded.value,
           isSecret = excluded.isSecret,
           updatedAt = excluded.updatedAt`,
      )
      .run({
        id: input.id,
        tenantId: input.tenantId ?? null,
        name: input.name,
        value: input.value,
        isSecretFlag: input.isSecret ? 1 : 0,
        createdAt,
        updatedAt,
      });
    const variable = this.tenantVariableById(input.id);
    if (!variable) throw new Error(`tenant variable ${input.id} was not persisted`);
    return variable;
  }

  async deleteTenantVariable(variableId: string): Promise<boolean> {
    const result = this.db.prepare("DELETE FROM tenant_variables WHERE id = ?").run(variableId);
    return result.changes > 0;
  }

  private gdapRelationshipByTenant(tenantId: string): GdapRelationship | undefined {
    const row = this.db
      .prepare("SELECT * FROM gdap_relationships WHERE tenantId = ?")
      .get(tenantId) as Row | undefined;
    return row ? this.mapGdapRelationship(row) : undefined;
  }

  async getGdapRelationship(tenantId: string): Promise<GdapRelationship | undefined> {
    return this.gdapRelationshipByTenant(tenantId);
  }

  async listGdapRelationships(): Promise<GdapRelationship[]> {
    return (
      this.db
        .prepare("SELECT * FROM gdap_relationships ORDER BY tenantId")
        .all() as Row[]
    ).map((row) => this.mapGdapRelationship(row));
  }

  async upsertGdapRelationship(input: GdapRelationshipInput): Promise<GdapRelationship> {
    const createdAt = input.createdAt ?? nowIso();
    const updatedAt = input.updatedAt ?? nowIso();
    this.db
      .prepare(
        `INSERT INTO gdap_relationships
           (tenantId, relationshipEnd, delegatedPrivilegeStatus, cpvConsentState, lastSynced, createdAt, updatedAt)
         VALUES
           (@tenantId, @relationshipEnd, @delegatedPrivilegeStatus, @cpvConsentState, @lastSynced, @createdAt, @updatedAt)
         ON CONFLICT(tenantId) DO UPDATE SET
           relationshipEnd = excluded.relationshipEnd,
           delegatedPrivilegeStatus = excluded.delegatedPrivilegeStatus,
           cpvConsentState = excluded.cpvConsentState,
           lastSynced = excluded.lastSynced,
           updatedAt = excluded.updatedAt`,
      )
      .run({
        tenantId: input.tenantId,
        relationshipEnd: input.relationshipEnd ?? null,
        delegatedPrivilegeStatus: input.delegatedPrivilegeStatus ?? null,
        cpvConsentState: input.cpvConsentState ?? null,
        lastSynced: input.lastSynced ?? null,
        createdAt,
        updatedAt,
      });
    const relationship = this.gdapRelationshipByTenant(input.tenantId);
    if (!relationship) {
      throw new Error(`gdap relationship ${input.tenantId} was not persisted`);
    }
    return relationship;
  }

  async createRun(input: RunInput): Promise<Run> {
    assertValidRunStatus(input.status);
    const createdAt = input.createdAt ?? nowIso();
    const updatedAt = input.updatedAt ?? nowIso();
    this.db
      .prepare(
        `INSERT INTO runs
           (id, tenantId, parentRunId, trigger, sections, options, startedAt, finishedAt, status, artifactPath, summaryCounts, provenance, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.tenantId,
        input.parentRunId ?? null,
        input.trigger,
        JSON.stringify(input.sections ?? []),
        stringifyJson(input.options),
        input.startedAt ?? null,
        input.finishedAt ?? null,
        input.status,
        input.artifactPath ?? null,
        stringifyJson(input.summaryCounts),
        stringifyJson(input.provenance),
        createdAt,
        updatedAt,
      );
    const run = await this.getRun(input.tenantId, input.id);
    if (!run) throw new Error(`run ${input.id} was not persisted`);
    return run;
  }

  async createRunWithChildren(
    parent: RunInput,
    children: RunInput[],
  ): Promise<{ parent: Run; children: Run[] }> {
    assertValidRunStatus(parent.status);
    for (const child of children) {
      assertValidRunStatus(child.status);
    }

    return this.db.transaction(() => {
      const parentCreatedAt = parent.createdAt ?? nowIso();
      const parentUpdatedAt = parent.updatedAt ?? nowIso();
      this.db
        .prepare(
          `INSERT INTO runs
             (id, tenantId, parentRunId, trigger, sections, options, startedAt, finishedAt, status, artifactPath, summaryCounts, provenance, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          parent.id,
          parent.tenantId,
          parent.parentRunId ?? null,
          parent.trigger,
          JSON.stringify(parent.sections ?? []),
          stringifyJson(parent.options),
          parent.startedAt ?? null,
          parent.finishedAt ?? null,
          parent.status,
          parent.artifactPath ?? null,
          stringifyJson(parent.summaryCounts),
          stringifyJson(parent.provenance),
          parentCreatedAt,
          parentUpdatedAt,
        );

      const persistedChildren: Run[] = [];
      for (const child of children) {
        const childCreatedAt = child.createdAt ?? nowIso();
        const childUpdatedAt = child.updatedAt ?? nowIso();
        const childParentRunId = child.parentRunId ?? parent.id;
        this.db
          .prepare(
            `INSERT INTO runs
               (id, tenantId, parentRunId, trigger, sections, options, startedAt, finishedAt, status, artifactPath, summaryCounts, provenance, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            child.id,
            child.tenantId,
            childParentRunId,
            child.trigger,
            JSON.stringify(child.sections ?? []),
            stringifyJson(child.options),
            child.startedAt ?? null,
            child.finishedAt ?? null,
            child.status,
            child.artifactPath ?? null,
            stringifyJson(child.summaryCounts),
            stringifyJson(child.provenance),
            childCreatedAt,
            childUpdatedAt,
          );
        const childRow = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(child.id) as Row;
        persistedChildren.push(this.mapRun(childRow));
      }

      const parentRow = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(parent.id) as Row;
      return {
        parent: this.mapRun(parentRow),
        children: persistedChildren,
      };
    })();
  }

  async createParentRunWithChildren(
    parent: RunInput,
    children: RunInput[],
  ): Promise<{ parent: Run; children: Run[] }> {
    return this.createRunWithChildren(parent, children);
  }

  async getRun(tenantId: string, runId: string): Promise<Run | undefined> {
    const row = this.db
      .prepare("SELECT * FROM runs WHERE id = ? AND tenantId = ?")
      .get(runId, tenantId) as Row | undefined;
    return row ? this.mapRun(row) : undefined;
  }

  async getRunById(runId: string): Promise<Run | undefined> {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as Row | undefined;
    return row ? this.mapRun(row) : undefined;
  }

  async listRuns(tenantId: string): Promise<Run[]> {
    return (
      this.db
        .prepare("SELECT * FROM runs WHERE tenantId = ? ORDER BY createdAt")
        .all(tenantId) as Row[]
    ).map((row) => this.mapRun(row));
  }

  async listChildRuns(parentRunId: string): Promise<Run[]> {
    return (
      this.db
        .prepare("SELECT * FROM runs WHERE parentRunId = ? ORDER BY createdAt ASC")
        .all(parentRunId) as Row[]
    ).map((row) => this.mapRun(row));
  }

  async listRunsByParentId(parentRunId: string): Promise<Run[]> {
    return this.listChildRuns(parentRunId);
  }

  async updateRun(
    tenantId: string,
    runId: string,
    update: Partial<RunInput>,
  ): Promise<Run | undefined> {
    if (update.status !== undefined) {
      assertValidRunStatus(update.status);
    }
    const current = await this.getRun(tenantId, runId);
    if (!current) return undefined;
    const updatedAt = update.updatedAt ?? nowIso();
    const fields: string[] = ["updatedAt = ?"];
    const values: unknown[] = [updatedAt];

    if (update.status !== undefined) {
      fields.push("status = ?");
      values.push(update.status);
    }
    if (update.startedAt !== undefined) {
      fields.push("startedAt = ?");
      values.push(update.startedAt);
    }
    if (update.finishedAt !== undefined) {
      fields.push("finishedAt = ?");
      values.push(update.finishedAt);
    }
    if (update.artifactPath !== undefined) {
      fields.push("artifactPath = ?");
      values.push(update.artifactPath);
    }
    if (update.options !== undefined) {
      fields.push("options = ?");
      values.push(stringifyJson(update.options));
    }
    if (update.summaryCounts !== undefined) {
      fields.push("summaryCounts = ?");
      values.push(stringifyJson(update.summaryCounts));
    }
    if (update.provenance !== undefined) {
      fields.push("provenance = ?");
      values.push(stringifyJson(update.provenance));
    }
    if (update.parentRunId !== undefined) {
      fields.push("parentRunId = ?");
      values.push(update.parentRunId);
    }

    values.push(runId, tenantId);
    this.db
      .prepare(`UPDATE runs SET ${fields.join(", ")} WHERE id = ? AND tenantId = ?`)
      .run(...values);
    return this.getRun(tenantId, runId);
  }

  async enforceRetention(options: RunRetentionOptions): Promise<RunRetentionResult> {
    let cutoffIso: string;
    if (options.olderThan) {
      cutoffIso =
        options.olderThan instanceof Date
          ? options.olderThan.toISOString()
          : String(options.olderThan);
    } else if (typeof options.retentionDays === "number") {
      const ms = options.retentionDays * 86400 * 1000;
      cutoffIso = new Date(Date.now() - ms).toISOString();
    } else {
      throw new Error("enforceRetention requires olderThan or retentionDays option");
    }

    const runsToPrune = this.db
      .prepare(
        "SELECT id, parentRunId FROM runs WHERE createdAt < ? OR (finishedAt IS NOT NULL AND finishedAt < ?)",
      )
      .all(cutoffIso, cutoffIso) as Array<{ id: string; parentRunId: string | null }>;

    if (runsToPrune.length === 0) {
      return { prunedRunsCount: 0 };
    }

    const runIds = runsToPrune.map((r) => r.id);

    this.db.transaction(() => {
      for (const id of runIds) {
        this.db.prepare("DELETE FROM findings WHERE runId = ?").run(id);
      }
      for (const id of runIds) {
        this.db.prepare("DELETE FROM run_sections WHERE runId = ?").run(id);
      }
      for (const id of runIds) {
        this.db.prepare("DELETE FROM runs WHERE parentRunId = ?").run(id);
      }
      for (const id of runIds) {
        this.db.prepare("DELETE FROM runs WHERE id = ?").run(id);
      }
    })();

    return { prunedRunsCount: runIds.length };
  }

  async pruneRuns(options: RunRetentionOptions): Promise<RunRetentionResult> {
    return this.enforceRetention(options);
  }

  async createRunSection(input: RunSectionInput): Promise<RunSection> {
    const createdAt = input.createdAt ?? nowIso();
    const updatedAt = input.updatedAt ?? nowIso();
    this.db
      .prepare(
        `INSERT INTO run_sections
           (id, runId, tenantId, section, collector, status, startedAt, finishedAt, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.runId,
        input.tenantId,
        input.section,
        input.collector ?? null,
        input.status,
        input.startedAt ?? null,
        input.finishedAt ?? null,
        createdAt,
        updatedAt,
      );
    const sections = await this.listRunSections(input.tenantId, input.runId);
    const section = sections.find((candidate) => candidate.id === input.id);
    if (!section) throw new Error(`run section ${input.id} was not persisted`);
    return section;
  }

  async listRunSections(tenantId: string, runId: string): Promise<RunSection[]> {
    return (
      this.db
        .prepare("SELECT * FROM run_sections WHERE tenantId = ? AND runId = ? ORDER BY createdAt")
        .all(tenantId, runId) as Row[]
    ).map((row) => this.mapRunSection(row));
  }

  async createFinding(input: FindingInput): Promise<Finding> {
    this.insertFinding(input);
    const findings = await this.listFindings(input.tenantId, input.runId);
    const finding = findings.find((candidate) => candidate.id === input.id);
    if (!finding) throw new Error(`finding ${input.id} was not persisted`);
    return finding;
  }

  private insertFinding(input: FindingInput): void {
    const createdAt = input.createdAt ?? nowIso();
    const updatedAt = input.updatedAt ?? nowIso();
    this.db
      .prepare(
        `INSERT INTO findings
           (id, runId, tenantId, checkId, controlName, category, collector, status, severity, currentValue, recommendedValue, evidence, frameworkRefs, remediationMode, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.runId,
        input.tenantId,
        input.checkId,
        input.controlName ?? null,
        input.category ?? null,
        input.collector ?? null,
        input.status,
        input.severity ?? null,
        input.currentValue ?? null,
        input.recommendedValue ?? null,
        stringifyJson(input.evidence),
        JSON.stringify(input.frameworkRefs ?? []),
        input.remediationMode ?? null,
        createdAt,
        updatedAt,
      );
  }

  async replaceRunFindings(tenantId: string, runId: string, inputs: readonly FindingInput[]): Promise<Finding[]> {
    for (const input of inputs) {
      if (input.tenantId !== tenantId || input.runId !== runId) {
        throw new Error(`finding ${input.id} does not belong to run ${runId} of tenant ${tenantId}`);
      }
    }
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM findings WHERE tenantId = ? AND runId = ?").run(tenantId, runId);
      for (const input of inputs) this.insertFinding(input);
    })();
    return this.listFindings(tenantId, runId);
  }

  async listFindings(tenantId: string, runId: string): Promise<Finding[]> {
    return (
      this.db
        .prepare("SELECT * FROM findings WHERE tenantId = ? AND runId = ? ORDER BY createdAt, rowid")
        .all(tenantId, runId) as Row[]
    ).map((row) => this.mapFinding(row));
  }

  async createJob(input: JobInput): Promise<Job> {
    const createdAt = input.createdAt ?? nowIso();
    const updatedAt = input.updatedAt ?? nowIso();
    this.db
      .prepare(
        `INSERT INTO jobs
           (id, type, tenantId, payload, state, attempts, progress, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.type,
        input.tenantId ?? null,
        stringifyJson(input.payload),
        input.state,
        input.attempts,
        stringifyJson(input.progress),
        createdAt,
        updatedAt,
      );
    const job = await this.getJob(input.id);
    if (!job) throw new Error(`job ${input.id} was not persisted`);
    return job;
  }

  async getJob(jobId: string): Promise<Job | undefined> {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as Row | undefined;
    return row ? this.mapJob(row) : undefined;
  }

  async listJobs(tenantId: string): Promise<Job[]> {
    return (
      this.db
        .prepare("SELECT * FROM jobs WHERE tenantId = ? ORDER BY createdAt")
        .all(tenantId) as Row[]
    ).map((row) => this.mapJob(row));
  }

  async updateJobState(
    jobId: string,
    state: JobState,
    update: JobStateUpdate = {},
  ): Promise<Job | undefined> {
    const existing = await this.getJob(jobId);
    if (!existing) return undefined;
    const progress = update.progress === undefined ? existing.progress : update.progress;
    const attempts = update.attempts ?? existing.attempts;
    this.db
      .prepare("UPDATE jobs SET state = ?, progress = ?, attempts = ?, updatedAt = ? WHERE id = ?")
      .run(state, stringifyJson(progress), attempts, nowIso(), jobId);
    return this.getJob(jobId);
  }

  async createLinkRemovalJob(input: LinkRemovalJobInput): Promise<LinkRemovalJob> {
    const createdAt = input.createdAt ?? nowIso();
    this.db
      .prepare(
        `INSERT INTO link_removal_jobs
           (id, tenantId, linkIds, state, results, createdAt, createdBy)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.tenantId,
        JSON.stringify(input.linkIds ?? []),
        input.state ?? "planned",
        stringifyJson(input.results),
        createdAt,
        input.createdBy,
      );
    const job = await this.getLinkRemovalJob(input.tenantId, input.id);
    if (!job) throw new Error(`link removal job ${input.id} was not persisted`);
    return job;
  }

  async getLinkRemovalJob(tenantId: string, jobId: string): Promise<LinkRemovalJob | undefined> {
    const row = this.db
      .prepare("SELECT * FROM link_removal_jobs WHERE id = ? AND tenantId = ?")
      .get(jobId, tenantId) as Row | undefined;
    return row ? this.mapLinkRemovalJob(row) : undefined;
  }

  async listLinkRemovalJobs(tenantId: string): Promise<LinkRemovalJob[]> {
    return (
      this.db
        .prepare("SELECT * FROM link_removal_jobs WHERE tenantId = ? ORDER BY createdAt, id")
        .all(tenantId) as Row[]
    ).map((row) => this.mapLinkRemovalJob(row));
  }

  async updateLinkRemovalJob(
    tenantId: string,
    jobId: string,
    update: LinkRemovalJobUpdate,
  ): Promise<LinkRemovalJob | undefined> {
    const existing = await this.getLinkRemovalJob(tenantId, jobId);
    if (!existing) return undefined;
    const state = update.state ?? existing.state;
    const results = update.results === undefined ? existing.results : update.results;
    this.db
      .prepare(
        "UPDATE link_removal_jobs SET state = ?, results = ? WHERE id = ? AND tenantId = ?",
      )
      .run(state, stringifyJson(results), jobId, tenantId);
    return this.getLinkRemovalJob(tenantId, jobId);
  }

  async appendAuditEvent(input: AuditEventInput): Promise<AuditEvent> {
    const createdAt = input.createdAt ?? nowIso();
    this.db
      .prepare(
        `INSERT INTO audit_events
           (id, timestamp, actorUserId, actorType, tenantId, action, targetType, targetId, before, after, result, error, source, correlationId, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.timestamp,
        input.actorUserId ?? null,
        input.actorType,
        input.tenantId ?? null,
        input.action,
        input.targetType ?? null,
        input.targetId ?? null,
        stringifyJson(input.before),
        stringifyJson(input.after),
        input.result,
        input.error ?? null,
        input.source,
        input.correlationId ?? null,
        createdAt,
      );
    const events = await this.listAuditEvents(input.tenantId ?? undefined);
    const event = events.find((candidate) => candidate.id === input.id);
    if (!event) throw new Error(`audit event ${input.id} was not persisted`);
    return event;
  }

  async listAuditEvents(tenantId?: string): Promise<AuditEvent[]> {
    const sql =
      tenantId === undefined
        ? "SELECT * FROM audit_events ORDER BY timestamp, id"
        : "SELECT * FROM audit_events WHERE tenantId = ? ORDER BY timestamp, id";
    const rows = (tenantId === undefined
      ? this.db.prepare(sql).all()
      : this.db.prepare(sql).all(tenantId)) as Row[];
    return rows.map((row) => this.mapAuditEvent(row));
  }

  private sharePointTemplateById(templateId: string): SharePointTemplate | undefined {
    const row = this.db
      .prepare("SELECT * FROM sharepoint_templates WHERE id = ?")
      .get(templateId) as Row | undefined;
    return row ? this.mapSharePointTemplate(row) : undefined;
  }

  async createSharePointTemplate(input: SharePointTemplateInput): Promise<SharePointTemplate> {
    const createdAt = input.createdAt ?? nowIso();
    const updatedAt = input.updatedAt ?? createdAt;
    this.db
      .prepare(
        `INSERT INTO sharepoint_templates
           (id, name, siteType, settings, variables, createdAt, updatedAt, deletedAt)
         VALUES (@id, @name, @siteType, @settings, @variables, @createdAt, @updatedAt, @deletedAt)`,
      )
      .run({
        id: input.id,
        name: input.name,
        siteType: input.siteType,
        settings: JSON.stringify(input.settings ?? {}),
        variables: JSON.stringify(input.variables ?? {}),
        createdAt,
        updatedAt,
        deletedAt: input.deletedAt ?? null,
      });
    const template = this.sharePointTemplateById(input.id);
    if (!template) throw new Error(`sharepoint template ${input.id} was not persisted`);
    return template;
  }

  async getSharePointTemplate(
    templateId: string,
    options: ListOptions = {},
  ): Promise<SharePointTemplate | undefined> {
    const sql = options.includeDeleted
      ? "SELECT * FROM sharepoint_templates WHERE id = ?"
      : "SELECT * FROM sharepoint_templates WHERE id = ? AND deletedAt IS NULL";
    const row = this.db.prepare(sql).get(templateId) as Row | undefined;
    return row ? this.mapSharePointTemplate(row) : undefined;
  }

  async listSharePointTemplates(options: ListOptions = {}): Promise<SharePointTemplate[]> {
    const sql = options.includeDeleted
      ? "SELECT * FROM sharepoint_templates ORDER BY name"
      : "SELECT * FROM sharepoint_templates WHERE deletedAt IS NULL ORDER BY name";
    return (this.db.prepare(sql).all() as Row[]).map((row) => this.mapSharePointTemplate(row));
  }

  async updateSharePointTemplate(
    templateId: string,
    update: SharePointTemplateUpdate,
  ): Promise<SharePointTemplate | undefined> {
    const existing = this.sharePointTemplateById(templateId);
    if (!existing) return undefined;
    const settings = update.settings === undefined ? existing.settings : update.settings;
    const variables = update.variables === undefined ? existing.variables : update.variables;
    this.db
      .prepare(
        `UPDATE sharepoint_templates
           SET name = ?, siteType = ?, settings = ?, variables = ?, updatedAt = ?
         WHERE id = ?`,
      )
      .run(
        update.name ?? existing.name,
        update.siteType ?? existing.siteType,
        JSON.stringify(settings),
        JSON.stringify(variables),
        nowIso(),
        templateId,
      );
    return this.sharePointTemplateById(templateId);
  }

  async softDeleteSharePointTemplate(
    templateId: string,
    options: { now?: string } = {},
  ): Promise<boolean> {
    const at = options.now ?? nowIso();
    const result = this.db
      .prepare(
        "UPDATE sharepoint_templates SET deletedAt = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL",
      )
      .run(at, at, templateId);
    return result.changes > 0;
  }

  async createSiteOperation(input: SiteOperationInput): Promise<SiteOperation> {
    const createdAt = input.createdAt ?? nowIso();
    const updatedAt = input.updatedAt ?? createdAt;
    this.db
      .prepare(
        `INSERT INTO site_operations
           (id, tenantId, siteId, operation, state, "by", "at", result, createdAt, updatedAt)
         VALUES
           (@id, @tenantId, @siteId, @operation, @state, @by, @at, @result, @createdAt, @updatedAt)`,
      )
      .run({
        id: input.id,
        tenantId: input.tenantId,
        siteId: input.siteId,
        operation: input.operation,
        state: input.state,
        by: input.by ?? null,
        at: input.at ?? createdAt,
        result: input.result ?? null,
        createdAt,
        updatedAt,
      });
    const operation = await this.getSiteOperation(input.tenantId, input.id);
    if (!operation) throw new Error(`site operation ${input.id} was not persisted`);
    return operation;
  }

  async getSiteOperation(
    tenantId: string,
    operationId: string,
  ): Promise<SiteOperation | undefined> {
    const row = this.db
      .prepare("SELECT * FROM site_operations WHERE id = ? AND tenantId = ?")
      .get(operationId, tenantId) as Row | undefined;
    return row ? this.mapSiteOperation(row) : undefined;
  }

  async listSiteOperations(tenantId: string): Promise<SiteOperation[]> {
    return (
      this.db
        .prepare('SELECT * FROM site_operations WHERE tenantId = ? ORDER BY "at", id')
        .all(tenantId) as Row[]
    ).map((row) => this.mapSiteOperation(row));
  }

  async updateSiteOperation(
    tenantId: string,
    operationId: string,
    update: SiteOperationUpdate,
  ): Promise<SiteOperation | undefined> {
    const existing = await this.getSiteOperation(tenantId, operationId);
    if (!existing) return undefined;
    const result = update.result === undefined ? existing.result : update.result;
    this.db
      .prepare(
        "UPDATE site_operations SET state = ?, result = ?, updatedAt = ? WHERE id = ? AND tenantId = ?",
      )
      .run(update.state ?? existing.state, result, nowIso(), operationId, tenantId);
    return this.getSiteOperation(tenantId, operationId);
  }

  private teamTemplateById(templateId: string): TeamTemplate | undefined {
    const row = this.db
      .prepare("SELECT * FROM team_templates WHERE id = ?")
      .get(templateId) as Row | undefined;
    return row ? this.mapTeamTemplate(row) : undefined;
  }

  async createTeamTemplate(input: TeamTemplateInput): Promise<TeamTemplate> {
    const createdAt = input.createdAt ?? nowIso();
    const updatedAt = input.updatedAt ?? createdAt;
    this.db
      .prepare(
        `INSERT INTO team_templates
           (id, name, owners, members, visibility, settings, createdAt, updatedAt, deletedAt)
         VALUES (@id, @name, @owners, @members, @visibility, @settings, @createdAt, @updatedAt, @deletedAt)`,
      )
      .run({
        id: input.id,
        name: input.name,
        owners: JSON.stringify(input.owners ?? []),
        members: JSON.stringify(input.members ?? []),
        visibility: input.visibility,
        settings: JSON.stringify(input.settings ?? {}),
        createdAt,
        updatedAt,
        deletedAt: input.deletedAt ?? null,
      });
    const template = this.teamTemplateById(input.id);
    if (!template) throw new Error(`team template ${input.id} was not persisted`);
    return template;
  }

  async getTeamTemplate(
    templateId: string,
    options: ListOptions = {},
  ): Promise<TeamTemplate | undefined> {
    const sql = options.includeDeleted
      ? "SELECT * FROM team_templates WHERE id = ?"
      : "SELECT * FROM team_templates WHERE id = ? AND deletedAt IS NULL";
    const row = this.db.prepare(sql).get(templateId) as Row | undefined;
    return row ? this.mapTeamTemplate(row) : undefined;
  }

  async listTeamTemplates(options: ListOptions = {}): Promise<TeamTemplate[]> {
    const sql = options.includeDeleted
      ? "SELECT * FROM team_templates ORDER BY name"
      : "SELECT * FROM team_templates WHERE deletedAt IS NULL ORDER BY name";
    return (this.db.prepare(sql).all() as Row[]).map((row) => this.mapTeamTemplate(row));
  }

  async updateTeamTemplate(
    templateId: string,
    update: TeamTemplateUpdate,
  ): Promise<TeamTemplate | undefined> {
    const existing = this.teamTemplateById(templateId);
    if (!existing) return undefined;
    const owners = update.owners === undefined ? existing.owners : update.owners;
    const members = update.members === undefined ? existing.members : update.members;
    const settings = update.settings === undefined ? existing.settings : update.settings;
    this.db
      .prepare(
        `UPDATE team_templates
           SET name = ?, owners = ?, members = ?, visibility = ?, settings = ?, updatedAt = ?
         WHERE id = ?`,
      )
      .run(
        update.name ?? existing.name,
        JSON.stringify(owners),
        JSON.stringify(members),
        update.visibility ?? existing.visibility,
        JSON.stringify(settings),
        nowIso(),
        templateId,
      );
    return this.teamTemplateById(templateId);
  }

  async softDeleteTeamTemplate(
    templateId: string,
    options: { now?: string } = {},
  ): Promise<boolean> {
    const at = options.now ?? nowIso();
    const result = this.db
      .prepare(
        "UPDATE team_templates SET deletedAt = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL",
      )
      .run(at, at, templateId);
    return result.changes > 0;
  }

  async createTeamOperation(input: TeamOperationInput): Promise<TeamOperation> {
    const createdAt = input.createdAt ?? nowIso();
    const updatedAt = input.updatedAt ?? createdAt;
    this.db
      .prepare(
        `INSERT INTO team_operations
           (id, tenantId, teamId, operation, state, "by", "at", result, createdAt, updatedAt)
         VALUES
           (@id, @tenantId, @teamId, @operation, @state, @by, @at, @result, @createdAt, @updatedAt)`,
      )
      .run({
        id: input.id,
        tenantId: input.tenantId,
        teamId: input.teamId,
        operation: input.operation,
        state: input.state,
        by: input.by ?? null,
        at: input.at ?? createdAt,
        result: input.result ?? null,
        createdAt,
        updatedAt,
      });
    const operation = await this.getTeamOperation(input.tenantId, input.id);
    if (!operation) throw new Error(`team operation ${input.id} was not persisted`);
    return operation;
  }

  async getTeamOperation(
    tenantId: string,
    operationId: string,
  ): Promise<TeamOperation | undefined> {
    const row = this.db
      .prepare("SELECT * FROM team_operations WHERE id = ? AND tenantId = ?")
      .get(operationId, tenantId) as Row | undefined;
    return row ? this.mapTeamOperation(row) : undefined;
  }

  async listTeamOperations(tenantId: string): Promise<TeamOperation[]> {
    return (
      this.db
        .prepare('SELECT * FROM team_operations WHERE tenantId = ? ORDER BY "at", id')
        .all(tenantId) as Row[]
    ).map((row) => this.mapTeamOperation(row));
  }

  async updateTeamOperation(
    tenantId: string,
    operationId: string,
    update: TeamOperationUpdate,
  ): Promise<TeamOperation | undefined> {
    const existing = await this.getTeamOperation(tenantId, operationId);
    if (!existing) return undefined;
    const result = update.result === undefined ? existing.result : update.result;
    this.db
      .prepare(
        "UPDATE team_operations SET state = ?, result = ?, updatedAt = ? WHERE id = ? AND tenantId = ?",
      )
      .run(update.state ?? existing.state, result, nowIso(), operationId, tenantId);
    return this.getTeamOperation(tenantId, operationId);
  }

  async createIncidentNote(input: IncidentNoteInput): Promise<IncidentNote> {
    const createdAt = input.createdAt ?? nowIso();
    const updatedAt = input.updatedAt ?? createdAt;
    this.db
      .prepare(
        `INSERT INTO incident_notes
           (id, tenantId, incidentId, body, author, "at", createdAt, updatedAt)
         VALUES
           (@id, @tenantId, @incidentId, @body, @author, @at, @createdAt, @updatedAt)`,
      )
      .run({
        id: input.id,
        tenantId: input.tenantId,
        incidentId: input.incidentId,
        body: input.body,
        author: input.author ?? null,
        at: input.at ?? createdAt,
        createdAt,
        updatedAt,
      });
    const note = await this.getIncidentNote(input.tenantId, input.id);
    if (!note) throw new Error(`incident note ${input.id} was not persisted`);
    return note;
  }

  async getIncidentNote(tenantId: string, noteId: string): Promise<IncidentNote | undefined> {
    const row = this.db
      .prepare("SELECT * FROM incident_notes WHERE id = ? AND tenantId = ?")
      .get(noteId, tenantId) as Row | undefined;
    return row ? this.mapIncidentNote(row) : undefined;
  }

  async listIncidentNotes(tenantId: string, incidentId: string): Promise<IncidentNote[]> {
    return (
      this.db
        .prepare(
          'SELECT * FROM incident_notes WHERE tenantId = ? AND incidentId = ? ORDER BY "at", id',
        )
        .all(tenantId, incidentId) as Row[]
    ).map((row) => this.mapIncidentNote(row));
  }

  async createAlertStateChange(input: AlertStateChangeInput): Promise<AlertStateChange> {
    const createdAt = input.createdAt ?? nowIso();
    const updatedAt = input.updatedAt ?? createdAt;
    this.db
      .prepare(
        `INSERT INTO alert_state_changes
           (id, tenantId, alertId, incidentId, "from", "to", "by", "at", reason, createdAt, updatedAt)
         VALUES
           (@id, @tenantId, @alertId, @incidentId, @from, @to, @by, @at, @reason, @createdAt, @updatedAt)`,
      )
      .run({
        id: input.id,
        tenantId: input.tenantId,
        alertId: input.alertId ?? null,
        incidentId: input.incidentId ?? null,
        from: input.from,
        to: input.to,
        by: input.by ?? null,
        at: input.at ?? createdAt,
        reason: input.reason ?? null,
        createdAt,
        updatedAt,
      });
    const change = await this.getAlertStateChange(input.tenantId, input.id);
    if (!change) throw new Error(`alert state change ${input.id} was not persisted`);
    return change;
  }

  async getAlertStateChange(
    tenantId: string,
    changeId: string,
  ): Promise<AlertStateChange | undefined> {
    const row = this.db
      .prepare("SELECT * FROM alert_state_changes WHERE id = ? AND tenantId = ?")
      .get(changeId, tenantId) as Row | undefined;
    return row ? this.mapAlertStateChange(row) : undefined;
  }

  async listAlertStateChanges(
    tenantId: string,
    options: AlertStateChangeListOptions = {},
  ): Promise<AlertStateChange[]> {
    const where: string[] = ["tenantId = ?"];
    const params: unknown[] = [tenantId];
    if (options.alertId !== undefined) {
      where.push("alertId = ?");
      params.push(options.alertId);
    }
    if (options.incidentId !== undefined) {
      where.push("incidentId = ?");
      params.push(options.incidentId);
    }
    return (
      this.db
        .prepare(`SELECT * FROM alert_state_changes WHERE ${where.join(" AND ")} ORDER BY "at", id`)
        .all(...params) as Row[]
    ).map((row) => this.mapAlertStateChange(row));
  }

  private mapBranding(row: Row): BrandingConfig {
    return mapBrandingRow(row);
  }

  async getBranding(): Promise<BrandingConfig | undefined> {
    let row: Row | undefined;
    try {
      row = this.db
        .prepare("SELECT * FROM branding_config WHERE id = 'default'")
        .get() as Row | undefined;
    } catch {
      return undefined;
    }
    return row ? this.mapBranding(row) : undefined;
  }

  async upsertBranding(input: BrandingConfigInput): Promise<BrandingConfig> {
    const updatedAt = input.updatedAt ?? nowIso();
    const config: BrandingConfig = {
      colors: input.colors,
      logoRef: assertBrandingAssetRef(input.logoRef, "logoRef"),
      coverRef: assertBrandingAssetRef(input.coverRef, "coverRef"),
      watermark: input.watermark,
      footer: input.footer,
      pageNumbers: input.pageNumbers,
      presets: input.presets,
      perReportDefaults: input.perReportDefaults,
      updatedAt,
      updatedBy: input.updatedBy ?? null,
    };
    this.db.transaction(() => {
      const before = this.db
        .prepare("SELECT * FROM branding_config WHERE id = 'default'")
        .get() as Row | undefined;
      this.db
        .prepare(
          `INSERT INTO branding_config
             (id, colors, logoRef, coverRef, watermark, footer, pageNumbers, presets, perReportDefaults, updatedAt, updatedBy)
           VALUES
             ('default', @colors, @logoRef, @coverRef, @watermark, @footer, @pageNumbers, @presets, @perReportDefaults, @updatedAt, @updatedBy)
           ON CONFLICT(id) DO UPDATE SET
             colors = excluded.colors,
             logoRef = excluded.logoRef,
             coverRef = excluded.coverRef,
             watermark = excluded.watermark,
             footer = excluded.footer,
             pageNumbers = excluded.pageNumbers,
             presets = excluded.presets,
             perReportDefaults = excluded.perReportDefaults,
             updatedAt = excluded.updatedAt,
             updatedBy = excluded.updatedBy`,
        )
        .run({
          colors: JSON.stringify(config.colors),
          logoRef: config.logoRef,
          coverRef: config.coverRef,
          watermark: JSON.stringify(config.watermark),
          footer: JSON.stringify(config.footer),
          pageNumbers: JSON.stringify(config.pageNumbers),
          presets: JSON.stringify(config.presets),
          perReportDefaults: JSON.stringify(config.perReportDefaults),
          updatedAt: config.updatedAt,
          updatedBy: config.updatedBy,
        });
      this.db
        .prepare(
          `INSERT INTO audit_events
             (id, timestamp, actorUserId, actorType, tenantId, action, targetType, targetId, before, after, result, error, source, correlationId, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          updatedAt,
          null,
          "system",
          null,
          "branding.upsert",
          "branding_config",
          "default",
          before ? JSON.stringify(mapBrandingRow(before)) : null,
          JSON.stringify({ ...config, updatedBy: config.updatedBy }),
          "success",
          null,
          "request",
          null,
          updatedAt,
        );
    })();
    const persisted = await this.getBranding();
    if (!persisted) throw new Error("branding config was not persisted");
    return persisted;
  }
}

export async function openSqliteRepository(
  options: OpenSqliteRepositoryOptions,
): Promise<SqliteRepository> {
  const migrations = options.migrations ?? loadMigrations(options.migrationsDir);
  const target = migrations.reduce((max, migration) => Math.max(max, migration.version), 0);
  const db = new Database(options.filename);
  try {
    const journalMode = String(db.pragma("journal_mode = WAL", { simple: true }) ?? "memory");
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA_VERSIONS_TABLE);
    const existing = readSchemaVersion(db);
    if (existing > target) {
      throw new SchemaVersionError(existing, target);
    }
    const applied = runMigrations(db, migrations);
    if (applied !== target) {
      throw new SchemaVersionError(applied, target);
    }
    return new SqliteRepository(db, applied, journalMode);
  } catch (error) {
    db.close();
    throw error;
  }
}
