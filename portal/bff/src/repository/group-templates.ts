// GroupTemplate persistence behind a repository interface (EPIC-014 SPEC.md §5; T-0265).
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { AppError, ErrorCodes } from "../errors.js";

export const ALLOWED_GROUP_TYPES = ["m365", "security", "distribution", "dynamic"] as const;
export type AllowedGroupType = (typeof ALLOWED_GROUP_TYPES)[number];

export interface GroupTemplateNaming {
  readonly prefix?: string;
  readonly suffix?: string;
  readonly pattern?: string;
  readonly conflictBehavior?: "block" | "appendSuffix";
}

export interface GroupTemplate {
  readonly id: string;
  readonly name: string;
  readonly groupType: string;
  readonly naming: GroupTemplateNaming;
  readonly owners: readonly string[];
  readonly members: readonly string[];
  readonly settings: Record<string, unknown>;
  readonly licensing: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}

export interface GroupTemplateCreateInput {
  readonly id?: string;
  readonly name: string;
  readonly groupType: string;
  readonly naming?: GroupTemplateNaming;
  readonly owners?: readonly string[];
  readonly members?: readonly string[];
  readonly settings?: Record<string, unknown>;
  readonly licensing?: readonly string[];
}

export interface GroupTemplateUpdateInput {
  readonly name?: string;
  readonly groupType?: string;
  readonly naming?: GroupTemplateNaming;
  readonly owners?: readonly string[];
  readonly members?: readonly string[];
  readonly settings?: Record<string, unknown>;
  readonly licensing?: readonly string[];
}

export interface GroupTemplateRepository {
  create(input: GroupTemplateCreateInput): Promise<GroupTemplate>;
  get(id: string, options?: { includeDeleted?: boolean }): Promise<GroupTemplate | undefined>;
  list(options?: { includeDeleted?: boolean }): Promise<GroupTemplate[]>;
  update(id: string, input: GroupTemplateUpdateInput): Promise<GroupTemplate | undefined>;
  delete(id: string): Promise<boolean>;
  close(): void;
}

export function validateGroupTemplateInput(
  input: GroupTemplateCreateInput | GroupTemplateUpdateInput,
  isCreate = true,
): void {
  if (isCreate || input.name !== undefined) {
    if (typeof input.name !== "string" || input.name.trim().length === 0) {
      throw new AppError(ErrorCodes.validationFailed, "name is required and must be non-empty", 400, [
        { field: "name", reason: "required" },
      ]);
    }
  }

  if (isCreate || input.groupType !== undefined) {
    if (
      typeof input.groupType !== "string" ||
      !(ALLOWED_GROUP_TYPES as readonly string[]).includes(input.groupType.toLowerCase())
    ) {
      throw new AppError(
        ErrorCodes.validationFailed,
        `groupType must be one of: ${ALLOWED_GROUP_TYPES.join(", ")}`,
        400,
        [{ field: "groupType", reason: "invalid" }],
      );
    }
  }

  if (input.owners !== undefined && !Array.isArray(input.owners)) {
    throw new AppError(ErrorCodes.validationFailed, "owners must be an array", 400, [
      { field: "owners", reason: "invalid" },
    ]);
  }

  if (input.members !== undefined && !Array.isArray(input.members)) {
    throw new AppError(ErrorCodes.validationFailed, "members must be an array", 400, [
      { field: "members", reason: "invalid" },
    ]);
  }

  if (input.licensing !== undefined && !Array.isArray(input.licensing)) {
    throw new AppError(ErrorCodes.validationFailed, "licensing must be an array", 400, [
      { field: "licensing", reason: "invalid" },
    ]);
  }
}

export class InMemoryGroupTemplateRepository implements GroupTemplateRepository {
  private readonly store = new Map<string, GroupTemplate>();

  close(): void {
    this.store.clear();
  }

  async create(input: GroupTemplateCreateInput): Promise<GroupTemplate> {
    validateGroupTemplateInput(input, true);
    const now = new Date().toISOString();
    const id = input.id ?? randomUUID();
    const record: GroupTemplate = {
      id,
      name: input.name.trim(),
      groupType: input.groupType.toLowerCase(),
      naming: input.naming ?? {},
      owners: input.owners ? [...input.owners] : [],
      members: input.members ? [...input.members] : [],
      settings: input.settings ? { ...input.settings } : {},
      licensing: input.licensing ? [...input.licensing] : [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.store.set(id, record);
    return record;
  }

  async get(id: string, options?: { includeDeleted?: boolean }): Promise<GroupTemplate | undefined> {
    const item = this.store.get(id);
    if (!item) return undefined;
    if (item.deletedAt && !options?.includeDeleted) return undefined;
    return item;
  }

  async list(options?: { includeDeleted?: boolean }): Promise<GroupTemplate[]> {
    return Array.from(this.store.values()).filter(
      (item) => options?.includeDeleted || !item.deletedAt,
    );
  }

  async update(id: string, input: GroupTemplateUpdateInput): Promise<GroupTemplate | undefined> {
    const existing = await this.get(id);
    if (!existing) return undefined;

    validateGroupTemplateInput(input, false);
    const now = new Date().toISOString();
    const updated: GroupTemplate = {
      ...existing,
      name: input.name !== undefined ? input.name.trim() : existing.name,
      groupType: input.groupType !== undefined ? input.groupType.toLowerCase() : existing.groupType,
      naming: input.naming !== undefined ? input.naming : existing.naming,
      owners: input.owners !== undefined ? [...input.owners] : existing.owners,
      members: input.members !== undefined ? [...input.members] : existing.members,
      settings: input.settings !== undefined ? { ...input.settings } : existing.settings,
      licensing: input.licensing !== undefined ? [...input.licensing] : existing.licensing,
      updatedAt: now,
    };
    this.store.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) return false;
    const now = new Date().toISOString();
    this.store.set(id, {
      ...existing,
      deletedAt: now,
      updatedAt: now,
    });
    return true;
  }
}

export class SqliteGroupTemplateRepository implements GroupTemplateRepository {
  private readonly db: Database.Database;

  constructor(dbOrPath: Database.Database | string = ":memory:") {
    if (typeof dbOrPath === "string") {
      this.db = new Database(dbOrPath);
    } else {
      this.db = dbOrPath;
    }
    this.db.pragma("foreign_keys = ON");
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS group_templates (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        groupType    TEXT NOT NULL,
        naming       TEXT NOT NULL DEFAULT '{}',
        owners       TEXT NOT NULL DEFAULT '[]',
        members      TEXT NOT NULL DEFAULT '[]',
        settings     TEXT NOT NULL DEFAULT '{}',
        licensing    TEXT NOT NULL DEFAULT '[]',
        createdAt    TEXT NOT NULL,
        updatedAt    TEXT NOT NULL,
        deletedAt    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_group_templates_deletedAt ON group_templates (deletedAt);
    `);
  }

  close(): void {
    this.db.close();
  }

  private rowToTemplate(row: any): GroupTemplate {
    return {
      id: row.id,
      name: row.name,
      groupType: row.groupType,
      naming: JSON.parse(row.naming || "{}"),
      owners: JSON.parse(row.owners || "[]"),
      members: JSON.parse(row.members || "[]"),
      settings: JSON.parse(row.settings || "{}"),
      licensing: JSON.parse(row.licensing || "[]"),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    };
  }

  async create(input: GroupTemplateCreateInput): Promise<GroupTemplate> {
    validateGroupTemplateInput(input, true);
    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    const groupType = input.groupType.toLowerCase();

    const stmt = this.db.prepare(`
      INSERT INTO group_templates (id, name, groupType, naming, owners, members, settings, licensing, createdAt, updatedAt, deletedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `);

    stmt.run(
      id,
      input.name.trim(),
      groupType,
      JSON.stringify(input.naming ?? {}),
      JSON.stringify(input.owners ? [...input.owners] : []),
      JSON.stringify(input.members ? [...input.members] : []),
      JSON.stringify(input.settings ?? {}),
      JSON.stringify(input.licensing ? [...input.licensing] : []),
      now,
      now,
    );

    return (await this.get(id))!;
  }

  async get(id: string, options?: { includeDeleted?: boolean }): Promise<GroupTemplate | undefined> {
    const query = options?.includeDeleted
      ? "SELECT * FROM group_templates WHERE id = ?"
      : "SELECT * FROM group_templates WHERE id = ? AND deletedAt IS NULL";
    const row = this.db.prepare(query).get(id);
    if (!row) return undefined;
    return this.rowToTemplate(row);
  }

  async list(options?: { includeDeleted?: boolean }): Promise<GroupTemplate[]> {
    const query = options?.includeDeleted
      ? "SELECT * FROM group_templates ORDER BY createdAt DESC"
      : "SELECT * FROM group_templates WHERE deletedAt IS NULL ORDER BY createdAt DESC";
    const rows = this.db.prepare(query).all();
    return rows.map((r) => this.rowToTemplate(r));
  }

  async update(id: string, input: GroupTemplateUpdateInput): Promise<GroupTemplate | undefined> {
    const existing = await this.get(id);
    if (!existing) return undefined;

    validateGroupTemplateInput(input, false);
    const now = new Date().toISOString();

    const name = input.name !== undefined ? input.name.trim() : existing.name;
    const groupType = input.groupType !== undefined ? input.groupType.toLowerCase() : existing.groupType;
    const naming = input.naming !== undefined ? JSON.stringify(input.naming) : JSON.stringify(existing.naming);
    const owners = input.owners !== undefined ? JSON.stringify(input.owners) : JSON.stringify(existing.owners);
    const members = input.members !== undefined ? JSON.stringify(input.members) : JSON.stringify(existing.members);
    const settings = input.settings !== undefined ? JSON.stringify(input.settings) : JSON.stringify(existing.settings);
    const licensing = input.licensing !== undefined ? JSON.stringify(input.licensing) : JSON.stringify(existing.licensing);

    this.db.prepare(`
      UPDATE group_templates
      SET name = ?, groupType = ?, naming = ?, owners = ?, members = ?, settings = ?, licensing = ?, updatedAt = ?
      WHERE id = ?
    `).run(name, groupType, naming, owners, members, settings, licensing, now, id);

    return (await this.get(id))!;
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) return false;
    const now = new Date().toISOString();
    const res = this.db.prepare("UPDATE group_templates SET deletedAt = ?, updatedAt = ? WHERE id = ?").run(now, now, id);
    return res.changes > 0;
  }
}
