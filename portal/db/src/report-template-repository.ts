// Report builder documents (EPIC-005 SPEC.md §5). Unlike immutable custom-script
// versions, templates are mutable documents, so deletion is a soft delete
// (03-database.md §5) and every mutation appends an immutable audit event
// (03-database.md §6). The stored `document` is the T-0081 report contract; this
// repository persists it verbatim and leaves validation to the contract at the
// API boundary.
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import {
  SchemaVersionError,
  type AuditActorType,
  type AuditSource,
} from "./repository.js";
import {
  SCHEMA_VERSIONS_TABLE,
  loadMigrations,
  runMigrations,
  type OpenSqliteRepositoryOptions,
} from "./sqlite-repository.js";

type Row = Record<string, unknown>;

// Migration 0080 creates this table for the shared database; the DDL stays here
// (idempotent) for databases opened through openSqliteReportTemplateRepository.
const REPORT_TEMPLATES_DDL = `
CREATE TABLE IF NOT EXISTS report_templates (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  tenantId  TEXT,
  document  TEXT NOT NULL,
  createdBy TEXT,
  updatedBy TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_report_templates_tenantId ON report_templates (tenantId);
CREATE INDEX IF NOT EXISTS idx_report_templates_deletedAt ON report_templates (deletedAt);
`;

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

function parseJsonValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function cloneDocument(document: unknown, id: string, name: string): unknown {
  if (typeof document === "object" && document !== null && !Array.isArray(document)) {
    return { ...(document as Record<string, unknown>), id, name };
  }
  return document;
}

export interface ReportTemplateRecord {
  id: string;
  name: string;
  tenantId: string | null;
  document: unknown;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ReportTemplateMutation {
  actorUserId?: string | null;
  actorType?: AuditActorType;
  source?: AuditSource;
  correlationId?: string | null;
  now?: string;
}

export interface ReportTemplateCreateInput extends ReportTemplateMutation {
  id?: string;
  name: string;
  tenantId?: string | null;
  document: unknown;
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ReportTemplateUpdateInput extends ReportTemplateMutation {
  name?: string;
  document?: unknown;
  updatedBy?: string | null;
  updatedAt?: string;
}

export interface ReportTemplateCloneInput extends ReportTemplateMutation {
  id?: string;
  name: string;
  tenantId?: string | null;
  createdBy?: string | null;
  createdAt?: string;
}

export interface ReportTemplateListOptions {
  tenantId?: string;
  includeDeleted?: boolean;
}

export interface ReportTemplateReadOptions {
  tenantId?: string;
  includeDeleted?: boolean;
}

export interface ReportTemplateRepository {
  readonly schemaVersion: number;

  close(): void;

  createTemplate(input: ReportTemplateCreateInput): Promise<ReportTemplateRecord>;
  getTemplate(
    id: string,
    options?: ReportTemplateReadOptions,
  ): Promise<ReportTemplateRecord | undefined>;
  listTemplates(options?: ReportTemplateListOptions): Promise<ReportTemplateRecord[]>;
  updateTemplate(
    id: string,
    input: ReportTemplateUpdateInput,
  ): Promise<ReportTemplateRecord | undefined>;
  softDeleteTemplate(id: string, options?: ReportTemplateMutation): Promise<boolean>;
  cloneTemplate(
    sourceId: string,
    input: ReportTemplateCloneInput,
  ): Promise<ReportTemplateRecord | undefined>;
}

export class SqliteReportTemplateRepository implements ReportTemplateRepository {
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

  private mapTemplate(row: Row): ReportTemplateRecord {
    return {
      id: asString(row["id"]),
      name: asString(row["name"]),
      tenantId: asNullableString(row["tenantId"]),
      document: parseJsonValue(row["document"]),
      createdBy: asNullableString(row["createdBy"]),
      updatedBy: asNullableString(row["updatedBy"]),
      createdAt: asString(row["createdAt"]),
      updatedAt: asString(row["updatedAt"]),
      deletedAt: asNullableString(row["deletedAt"]),
    };
  }

  private templateById(id: string): ReportTemplateRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM report_templates WHERE id = ?")
      .get(id) as Row | undefined;
    return row ? this.mapTemplate(row) : undefined;
  }

  async createTemplate(input: ReportTemplateCreateInput): Promise<ReportTemplateRecord> {
    const id = input.id ?? randomUUID();
    const createdAt = input.createdAt ?? input.now ?? nowIso();
    const updatedAt = input.updatedAt ?? createdAt;
    const createdBy = input.createdBy ?? null;
    const before = null;
    const after: ReportTemplateRecord = {
      id,
      name: input.name,
      tenantId: input.tenantId ?? null,
      document: input.document ?? null,
      createdBy,
      updatedBy: createdBy,
      createdAt,
      updatedAt,
      deletedAt: null,
    };
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO report_templates
             (id, name, tenantId, document, createdBy, updatedBy, createdAt, updatedAt, deletedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          after.id,
          after.name,
          after.tenantId,
          stringifyJson(after.document),
          after.createdBy,
          after.updatedBy,
          after.createdAt,
          after.updatedAt,
        );
      this.insertAudit("report_template.create", after, before, after, input);
    })();
    return after;
  }

  async getTemplate(
    id: string,
    options: ReportTemplateReadOptions = {},
  ): Promise<ReportTemplateRecord | undefined> {
    const clauses = ["id = ?"];
    const params: unknown[] = [id];
    if (options.includeDeleted !== true) {
      clauses.push("deletedAt IS NULL");
    }
    if (options.tenantId !== undefined) {
      clauses.push("(tenantId = ? OR tenantId IS NULL)");
      params.push(options.tenantId);
    }
    const row = this.db
      .prepare(`SELECT * FROM report_templates WHERE ${clauses.join(" AND ")}`)
      .get(...params) as Row | undefined;
    return row ? this.mapTemplate(row) : undefined;
  }

  async listTemplates(options: ReportTemplateListOptions = {}): Promise<ReportTemplateRecord[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options.includeDeleted !== true) {
      clauses.push("deletedAt IS NULL");
    }
    if (options.tenantId !== undefined) {
      clauses.push("(tenantId = ? OR tenantId IS NULL)");
      params.push(options.tenantId);
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
    return (
      this.db
        .prepare(`SELECT * FROM report_templates${where} ORDER BY createdAt, id`)
        .all(...params) as Row[]
    ).map((row) => this.mapTemplate(row));
  }

  async updateTemplate(
    id: string,
    input: ReportTemplateUpdateInput,
  ): Promise<ReportTemplateRecord | undefined> {
    const existing = this.templateById(id);
    if (!existing || existing.deletedAt !== null) return undefined;
    const updatedAt = input.updatedAt ?? input.now ?? nowIso();
    const after: ReportTemplateRecord = {
      ...existing,
      name: input.name ?? existing.name,
      document: input.document === undefined ? existing.document : input.document,
      updatedBy: input.updatedBy ?? input.actorUserId ?? existing.updatedBy,
      updatedAt,
    };
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE report_templates SET name = ?, document = ?, updatedBy = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL",
        )
        .run(
          after.name,
          stringifyJson(after.document),
          after.updatedBy,
          after.updatedAt,
          id,
        );
      this.insertAudit("report_template.update", after, existing, after, input);
    })();
    return after;
  }

  async softDeleteTemplate(id: string, options: ReportTemplateMutation = {}): Promise<boolean> {
    const existing = this.templateById(id);
    if (!existing || existing.deletedAt !== null) return false;
    const at = options.now ?? nowIso();
    const after: ReportTemplateRecord = { ...existing, deletedAt: at, updatedAt: at };
    return this.db.transaction(() => {
      const result = this.db
        .prepare(
          "UPDATE report_templates SET deletedAt = ?, updatedAt = ?, updatedBy = ? WHERE id = ? AND deletedAt IS NULL",
        )
        .run(at, at, options.actorUserId ?? existing.updatedBy, id);
      if (result.changes === 0) return false;
      this.insertAudit("report_template.delete", after, existing, after, options);
      return true;
    })();
  }

  async cloneTemplate(
    sourceId: string,
    input: ReportTemplateCloneInput,
  ): Promise<ReportTemplateRecord | undefined> {
    const source = this.templateById(sourceId);
    if (!source || source.deletedAt !== null) return undefined;
    const id = input.id ?? randomUUID();
    const createdAt = input.createdAt ?? input.now ?? nowIso();
    const createdBy = input.createdBy ?? null;
    const after: ReportTemplateRecord = {
      id,
      name: input.name,
      tenantId: input.tenantId === undefined ? source.tenantId : (input.tenantId ?? null),
      document: cloneDocument(source.document, id, input.name),
      createdBy,
      updatedBy: createdBy,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    };
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO report_templates
             (id, name, tenantId, document, createdBy, updatedBy, createdAt, updatedAt, deletedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          after.id,
          after.name,
          after.tenantId,
          stringifyJson(after.document),
          after.createdBy,
          after.updatedBy,
          after.createdAt,
          after.updatedAt,
        );
      this.insertAudit("report_template.clone", after, source, after, input);
    })();
    return after;
  }

  private insertAudit(
    action: string,
    template: ReportTemplateRecord,
    before: unknown,
    after: unknown,
    context: ReportTemplateMutation,
  ): void {
    const timestamp = context.now ?? nowIso();
    this.db
      .prepare(
        `INSERT INTO audit_events
           (id, timestamp, actorUserId, actorType, tenantId, action, targetType, targetId, before, after, result, error, source, correlationId, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        timestamp,
        context.actorUserId ?? null,
        context.actorType ?? (context.actorUserId ? "user" : "system"),
        template.tenantId,
        action,
        "report-template",
        template.id,
        stringifyJson(before),
        stringifyJson(after),
        "success",
        null,
        context.source ?? "request",
        context.correlationId ?? null,
        timestamp,
      );
  }
}

export async function openSqliteReportTemplateRepository(
  options: OpenSqliteRepositoryOptions,
): Promise<SqliteReportTemplateRepository> {
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
    db.exec(REPORT_TEMPLATES_DDL);
    return new SqliteReportTemplateRepository(db, applied);
  } catch (error) {
    db.close();
    throw error;
  }
}
