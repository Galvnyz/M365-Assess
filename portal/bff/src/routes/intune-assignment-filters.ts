// Intune assignment filters API (EPIC-016 SPEC.md §3.3, §5, §6, §7, §9; T-0309).
//
// Tenant routes (live filters via the Set-AssignmentFilter worker; each write audited
// with before/after):
//   GET    /v1/tenants/:tenantId/intune/assignment-filters
//   POST   /v1/tenants/:tenantId/intune/assignment-filters
//   PATCH  /v1/tenants/:tenantId/intune/assignment-filters/:filterId
//   DELETE /v1/tenants/:tenantId/intune/assignment-filters/:filterId   ({ confirmName })
// Template routes (AssignmentFilterTemplate persistence) and the deploy wizard:
//   GET/POST /v1/intune-assignment-filter-templates, GET/PATCH/DELETE .../:id
//   POST     /v1/intune-assignment-filter-templates/:id/deploy  ({ targets, preview, confirmTargetCount })
//
// Rules are validated against the Intune filter rule grammar and platforms against the
// T-0301 registry; invalid input is a 400 with structured field detail.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { INTUNE_POLICY_TYPES, type IntunePlatform } from "../domain/intune-policy-types.js";
import { AppError, ErrorCodes, type ErrorDetail } from "../errors.js";
import { RbacErrorCodes, requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const ASSIGNMENT_FILTERS_PATH = "/v1/tenants/:tenantId/intune/assignment-filters";
export const ASSIGNMENT_FILTER_PATH = "/v1/tenants/:tenantId/intune/assignment-filters/:filterId";
export const FILTER_TEMPLATES_PATH = "/v1/intune-assignment-filter-templates";
export const FILTER_TEMPLATE_PATH = "/v1/intune-assignment-filter-templates/:id";
export const FILTER_TEMPLATE_DEPLOY_PATH = "/v1/intune-assignment-filter-templates/:id/deploy";

export const ASSIGNMENT_FILTER_PERMISSIONS = {
  read: "intune.read",
  write: "intune.write",
  remediationApply: "remediation.apply",
  templates: "intune.templates",
} as const;

export const ErrorCodesFilterTemplateNotFound = "assignment_filter_template.not_found" as const;
export const ErrorCodesFilterInvalid = "assignment_filter.invalid" as const;

// ---------------------------------------------------------------------------
// Validation: platform (T-0301 registry) and rule grammar
// ---------------------------------------------------------------------------

/** Platforms known to the T-0301 registry. */
export const ASSIGNMENT_FILTER_PLATFORMS: readonly IntunePlatform[] = [
  ...new Set(INTUNE_POLICY_TYPES.map((t) => t.platform)),
];

/** Graph deviceAndAppManagementAssignmentFilter.platform for each registry platform. */
export const GRAPH_FILTER_PLATFORMS: Readonly<Record<IntunePlatform, string>> = {
  windows: "windows10AndLater",
  android: "androidForWork",
  ios: "iOS",
  macos: "macOS",
};

/** Device properties usable in managed-device filter rules. */
export const FILTER_RULE_PROPERTIES: readonly string[] = [
  "device.deviceName",
  "device.manufacturer",
  "device.model",
  "device.deviceCategory",
  "device.osVersion",
  "device.isRooted",
  "device.deviceOwnership",
  "device.enrollmentProfileName",
  "device.deviceTrustType",
  "device.operatingSystemSKU",
  "device.operatingSystemVersion",
  "device.cpuArchitecture",
];

export const FILTER_RULE_OPERATORS: readonly string[] = [
  "-eq",
  "-ne",
  "-startsWith",
  "-notStartsWith",
  "-endsWith",
  "-notEndsWith",
  "-contains",
  "-notContains",
  "-in",
  "-notIn",
  "-match",
  "-notMatch",
];

const LIST_OPERATORS = new Set(["-in", "-notin"]);
/** Intune's rule length limit. */
export const FILTER_RULE_MAX_LENGTH = 3072;

export interface RuleIssue {
  readonly position: number;
  readonly message: string;
}

type Token =
  | { kind: "lparen" | "rparen" | "lbracket" | "rbracket" | "comma"; pos: number }
  | { kind: "string"; value: string; pos: number }
  | { kind: "word"; value: string; pos: number };

function tokenize(rule: string): { tokens: Token[]; issue?: RuleIssue } {
  const tokens: Token[] = [];
  let i = 0;
  while (i < rule.length) {
    const c = rule[i]!;
    if (/\s/.test(c)) {
      i++;
    } else if (c === "(" || c === ")" || c === "[" || c === "]" || c === ",") {
      const kind = ({ "(": "lparen", ")": "rparen", "[": "lbracket", "]": "rbracket", ",": "comma" } as const)[c];
      tokens.push({ kind, pos: i });
      i++;
    } else if (c === '"') {
      const end = rule.indexOf('"', i + 1);
      if (end === -1) return { tokens, issue: { position: i, message: "unterminated string value" } };
      tokens.push({ kind: "string", value: rule.slice(i + 1, end), pos: i });
      i = end + 1;
    } else {
      const start = i;
      while (i < rule.length && !/[\s()[\],"]/.test(rule[i]!)) i++;
      tokens.push({ kind: "word", value: rule.slice(start, i), pos: start });
    }
  }
  return { tokens };
}

/**
 * Validate a filter rule against the Intune grammar:
 *   expr       := term ("or" term)*
 *   term       := factor ("and" factor)*
 *   factor     := "(" expr ")" | comparison
 *   comparison := property operator value
 *   value      := "string" | "[" "string" ("," "string")* "]"   (lists only with -in/-notIn)
 * Returns the first issue found, or [] when the rule is valid.
 */
export function validateFilterRule(rule: unknown): RuleIssue[] {
  if (typeof rule !== "string" || rule.trim().length === 0) {
    return [{ position: 0, message: "rule must be a non-empty string" }];
  }
  if (rule.length > FILTER_RULE_MAX_LENGTH) {
    return [{ position: FILTER_RULE_MAX_LENGTH, message: `rule exceeds ${FILTER_RULE_MAX_LENGTH} characters` }];
  }
  const text: string = rule;
  const { tokens, issue } = tokenize(text);
  if (issue) return [issue];

  let i = 0;
  const properties = new Map(FILTER_RULE_PROPERTIES.map((p) => [p.toLowerCase(), p]));
  const operators = new Set(FILTER_RULE_OPERATORS.map((o) => o.toLowerCase()));
  const fail = (pos: number, message: string): never => {
    throw { position: pos, message } satisfies RuleIssue;
  };
  const peek = () => tokens[i];
  const isWord = (t: Token | undefined, value: string) =>
    t?.kind === "word" && t.value.toLowerCase() === value;

  function value(listAllowed: boolean): void {
    const t = peek();
    if (t?.kind === "string") {
      if (listAllowed) fail(t.pos, "-in and -notIn take a [\"...\"] list");
      i++;
      return;
    }
    if (t?.kind === "lbracket") {
      if (!listAllowed) fail(t.pos, "a [...] list is only valid with -in or -notIn");
      i++;
      for (;;) {
        const item = peek();
        if (item?.kind !== "string") fail(item?.pos ?? text.length, "expected a quoted list value");
        i++;
        const sep = peek();
        if (sep?.kind === "comma") {
          i++;
          continue;
        }
        if (sep?.kind === "rbracket") {
          i++;
          return;
        }
        fail(sep?.pos ?? text.length, "expected ',' or ']'");
      }
    }
    fail(t?.pos ?? text.length, 'expected a quoted value such as "value"');
  }

  function comparison(): void {
    const prop = peek();
    if (prop?.kind !== "word" || !prop.value.includes(".")) {
      fail(prop?.pos ?? text.length, "expected a property such as device.deviceName");
    }
    const propToken = prop as Extract<Token, { kind: "word" }>;
    if (!properties.has(propToken.value.toLowerCase())) {
      fail(propToken.pos, `unknown property '${propToken.value}'`);
    }
    i++;
    const op = peek();
    if (op?.kind !== "word" || !operators.has(op.value.toLowerCase())) {
      fail(op?.pos ?? text.length, `expected an operator (${FILTER_RULE_OPERATORS.join(", ")})`);
    }
    i++;
    value(LIST_OPERATORS.has((op as Extract<Token, { kind: "word" }>).value.toLowerCase()));
  }

  function factor(): void {
    const t = peek();
    if (t?.kind === "lparen") {
      i++;
      expr();
      const close = peek();
      if (close?.kind !== "rparen") fail(close?.pos ?? text.length, "expected ')'");
      i++;
      return;
    }
    comparison();
  }

  function term(): void {
    factor();
    while (isWord(peek(), "and")) {
      i++;
      factor();
    }
  }

  function expr(): void {
    term();
    while (isWord(peek(), "or")) {
      i++;
      term();
    }
  }

  try {
    expr();
    const rest = peek();
    if (rest) fail(rest.pos, "expected 'and', 'or', or the end of the rule");
    return [];
  } catch (err) {
    if (typeof err === "object" && err !== null && "position" in err) return [err as RuleIssue];
    throw err;
  }
}

export interface FilterInput {
  readonly displayName: string;
  readonly description?: string;
  readonly platform: string;
  readonly rule: string;
}

/** Structured issues for a filter or template body; `partial` validates only supplied fields. */
export function collectFilterIssues(
  input: Partial<FilterInput>,
  { partial = false, nameField = "displayName" }: { partial?: boolean; nameField?: string } = {},
): ErrorDetail[] {
  const issues: ErrorDetail[] = [];
  if (!partial || input.displayName !== undefined) {
    if (typeof input.displayName !== "string" || !input.displayName.trim()) {
      issues.push({ field: nameField, reason: "must be a non-empty string" });
    }
  }
  if (!partial || input.platform !== undefined) {
    if (!(ASSIGNMENT_FILTER_PLATFORMS as readonly unknown[]).includes(input.platform)) {
      issues.push({
        field: "platform",
        reason: `must be one of the T-0301 registry platforms: ${ASSIGNMENT_FILTER_PLATFORMS.join(", ")}`,
      });
    }
  }
  if (!partial || input.rule !== undefined) {
    for (const issue of validateFilterRule(input.rule)) {
      issues.push({ field: "rule", reason: issue.message, position: issue.position });
    }
  }
  if (input.description !== undefined && typeof input.description !== "string") {
    issues.push({ field: "description", reason: "must be a string" });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// AssignmentFilterTemplate persistence (ADR-0015)
// ---------------------------------------------------------------------------

export interface AssignmentFilterTemplate {
  id: string;
  name: string;
  platform: IntunePlatform;
  rule: string;
  source: "local";
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface AssignmentFilterTemplateInput {
  id?: string;
  name: string;
  platform: string;
  rule: string;
}

export interface AssignmentFilterTemplateRepository {
  list(): Promise<AssignmentFilterTemplate[]>;
  get(id: string, options?: { includeDeleted?: boolean }): Promise<AssignmentFilterTemplate | undefined>;
  create(input: AssignmentFilterTemplateInput): Promise<AssignmentFilterTemplate>;
  update(id: string, input: Partial<Omit<AssignmentFilterTemplateInput, "id">>): Promise<AssignmentFilterTemplate | undefined>;
  remove(id: string): Promise<boolean>;
}

function templateIssues(input: Partial<AssignmentFilterTemplateInput>, partial: boolean): ErrorDetail[] {
  return collectFilterIssues(
    { displayName: input.name, platform: input.platform, rule: input.rule },
    { partial, nameField: "name" },
  );
}

function assertTemplate(input: Partial<AssignmentFilterTemplateInput>, partial: boolean): void {
  const issues = templateIssues(input, partial);
  if (issues.length > 0) {
    throw new AppError(ErrorCodesFilterInvalid, "Invalid assignment filter template", 400, issues);
  }
}

export class InMemoryAssignmentFilterTemplateRepository implements AssignmentFilterTemplateRepository {
  private readonly rows = new Map<string, AssignmentFilterTemplate>();

  async list(): Promise<AssignmentFilterTemplate[]> {
    return [...this.rows.values()]
      .filter((r) => r.deletedAt === null)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => ({ ...r }));
  }

  async get(id: string, options: { includeDeleted?: boolean } = {}): Promise<AssignmentFilterTemplate | undefined> {
    const row = this.rows.get(id);
    if (!row || (!options.includeDeleted && row.deletedAt !== null)) return undefined;
    return { ...row };
  }

  async create(input: AssignmentFilterTemplateInput): Promise<AssignmentFilterTemplate> {
    assertTemplate(input, false);
    const id = input.id ?? globalThis.crypto.randomUUID();
    if (this.rows.has(id)) {
      throw new AppError(ErrorCodesFilterInvalid, `template ${id} already exists`, 400, [
        { field: "id", reason: "already exists" },
      ]);
    }
    const at = new Date().toISOString();
    const row: AssignmentFilterTemplate = {
      id,
      name: input.name.trim(),
      platform: input.platform as IntunePlatform,
      rule: input.rule.trim(),
      source: "local",
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    };
    this.rows.set(id, row);
    return { ...row };
  }

  async update(
    id: string,
    input: Partial<Omit<AssignmentFilterTemplateInput, "id">>,
  ): Promise<AssignmentFilterTemplate | undefined> {
    const existing = this.rows.get(id);
    if (!existing || existing.deletedAt !== null) return undefined;
    assertTemplate(input, true);
    const next: AssignmentFilterTemplate = {
      ...existing,
      name: input.name?.trim() ?? existing.name,
      platform: (input.platform as IntunePlatform | undefined) ?? existing.platform,
      rule: input.rule?.trim() ?? existing.rule,
      updatedAt: new Date().toISOString(),
    };
    this.rows.set(id, next);
    return { ...next };
  }

  async remove(id: string): Promise<boolean> {
    const existing = this.rows.get(id);
    if (!existing || existing.deletedAt !== null) return false;
    const at = new Date().toISOString();
    this.rows.set(id, { ...existing, deletedAt: at, updatedAt: at });
    return true;
  }
}

const MIGRATION_URL = new URL("../../../db/migrations/0078_assignment_filter_templates.sql", import.meta.url);

export function assignmentFilterTemplateMigrationSql(): string {
  return readFileSync(fileURLToPath(MIGRATION_URL), "utf8");
}

type Row = Record<string, unknown>;

export class SqliteAssignmentFilterTemplateRepository implements AssignmentFilterTemplateRepository {
  constructor(private readonly db: Database.Database) {
    this.db.exec(assignmentFilterTemplateMigrationSql());
  }

  private mapRow(row: Row): AssignmentFilterTemplate {
    return {
      id: String(row["id"]),
      name: String(row["name"]),
      platform: String(row["platform"]) as IntunePlatform,
      rule: String(row["rule"]),
      source: "local",
      createdAt: String(row["createdAt"]),
      updatedAt: String(row["updatedAt"]),
      deletedAt: row["deletedAt"] === null || row["deletedAt"] === undefined ? null : String(row["deletedAt"]),
    };
  }

  async list(): Promise<AssignmentFilterTemplate[]> {
    const rows = this.db
      .prepare("SELECT * FROM assignment_filter_templates WHERE deletedAt IS NULL ORDER BY name")
      .all() as Row[];
    return rows.map((r) => this.mapRow(r));
  }

  async get(id: string, options: { includeDeleted?: boolean } = {}): Promise<AssignmentFilterTemplate | undefined> {
    const sql = options.includeDeleted
      ? "SELECT * FROM assignment_filter_templates WHERE id = ?"
      : "SELECT * FROM assignment_filter_templates WHERE id = ? AND deletedAt IS NULL";
    const row = this.db.prepare(sql).get(id) as Row | undefined;
    return row ? this.mapRow(row) : undefined;
  }

  async create(input: AssignmentFilterTemplateInput): Promise<AssignmentFilterTemplate> {
    assertTemplate(input, false);
    const id = input.id ?? globalThis.crypto.randomUUID();
    if (await this.get(id, { includeDeleted: true })) {
      throw new AppError(ErrorCodesFilterInvalid, `template ${id} already exists`, 400, [
        { field: "id", reason: "already exists" },
      ]);
    }
    const at = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO assignment_filter_templates (id, name, platform, rule, source, createdAt, updatedAt, deletedAt)
         VALUES (?, ?, ?, ?, 'local', ?, ?, NULL)`,
      )
      .run(id, input.name.trim(), input.platform, input.rule.trim(), at, at);
    const created = await this.get(id);
    if (!created) throw new Error(`Assignment filter template ${id} was not persisted`);
    return created;
  }

  async update(
    id: string,
    input: Partial<Omit<AssignmentFilterTemplateInput, "id">>,
  ): Promise<AssignmentFilterTemplate | undefined> {
    const existing = await this.get(id);
    if (!existing) return undefined;
    assertTemplate(input, true);
    this.db
      .prepare(
        `UPDATE assignment_filter_templates SET name = ?, platform = ?, rule = ?, updatedAt = ?
         WHERE id = ? AND deletedAt IS NULL`,
      )
      .run(
        input.name?.trim() ?? existing.name,
        input.platform ?? existing.platform,
        input.rule?.trim() ?? existing.rule,
        new Date().toISOString(),
        id,
      );
    return this.get(id);
  }

  async remove(id: string): Promise<boolean> {
    const at = new Date().toISOString();
    const info = this.db
      .prepare("UPDATE assignment_filter_templates SET deletedAt = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL")
      .run(at, at, id);
    return info.changes > 0;
  }
}

// ---------------------------------------------------------------------------
// Worker seam and routes
// ---------------------------------------------------------------------------

export interface LiveAssignmentFilter {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  /** Registry platform, or null when Graph reports a platform outside the registry. */
  readonly platform: IntunePlatform | null;
  readonly graphPlatform: string;
  readonly rule: string;
}

export interface FilterWriteResult {
  readonly filter: LiveAssignmentFilter | null;
  readonly auditEvent: Record<string, unknown>;
}

export interface FilterDeployPlan {
  readonly tenantId: string;
  readonly action: "create" | "update" | "none";
  readonly filterId: string | null;
  readonly diff: readonly string[];
  readonly valid: boolean;
  readonly issue?: string | null;
}

export interface FilterDeployResult {
  readonly tenantId: string;
  readonly state: "succeeded" | "skipped" | "failed";
  readonly filterId: string | null;
  readonly error?: string | null;
  readonly auditEvent?: Record<string, unknown> | null;
}

/** Graph platform strings sent to the worker are resolved by the route. */
export interface GraphFilterInput {
  readonly displayName: string;
  readonly description?: string;
  readonly platform: string;
  readonly rule: string;
}

/** Runs the Set-AssignmentFilter worker for one tenant. */
export interface AssignmentFilterProvider {
  list(tenantId: string): Promise<readonly LiveAssignmentFilter[]>;
  create(tenantId: string, input: GraphFilterInput, actor: string): Promise<FilterWriteResult>;
  update(tenantId: string, filterId: string, input: Partial<GraphFilterInput>, actor: string): Promise<FilterWriteResult>;
  remove(tenantId: string, filterId: string, confirmName: string, actor: string): Promise<FilterWriteResult>;
  planDeploy(tenantId: string, input: GraphFilterInput): Promise<FilterDeployPlan>;
  deploy(tenantId: string, input: GraphFilterInput, actor: string): Promise<FilterDeployResult>;
}

export interface AssignmentFilterCaller extends Caller {
  readonly userId?: string;
}

export interface AssignmentFilterRequestContext extends RequestContext {
  readonly body?: unknown;
  readonly permissions?: readonly string[];
}

export type AssignmentFilterAuthorizer = (ctx: AssignmentFilterRequestContext, permission: string) => boolean;

export interface AssignmentFilterRoutesOptions {
  readonly repository: AssignmentFilterTemplateRepository;
  readonly provider: AssignmentFilterProvider;
  readonly resolveCaller: (ctx: RequestContext) => AssignmentFilterCaller | undefined;
  readonly authorize?: AssignmentFilterAuthorizer;
  readonly recordAudit?: (event: Record<string, unknown>) => Promise<void>;
}

function defaultAuthorize(ctx: AssignmentFilterRequestContext, permission: string): boolean {
  const granted = ctx.permissions;
  if (granted === undefined) return true;
  return granted.includes(permission) || granted.includes("CIPP.Admin.*") || granted.includes("*");
}

function badRequest(message: string, details: ErrorDetail[]): AppError {
  return new AppError(ErrorCodes.validationFailed, message, 400, details);
}

function asBody(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw badRequest("Request body must be a JSON object", [{ field: "body", reason: "must be a JSON object" }]);
  }
  return value as Record<string, unknown>;
}

function requireParam(ctx: RequestContext, name: string): string {
  const value = ctx.params[name];
  if (typeof value !== "string" || !value.trim()) throw badRequest(`${name} is required`, [{ field: name, reason: "required" }]);
  return value.trim();
}

function toGraphInput(input: FilterInput): GraphFilterInput {
  return {
    displayName: input.displayName.trim(),
    ...(input.description !== undefined ? { description: input.description } : {}),
    platform: GRAPH_FILTER_PLATFORMS[input.platform as IntunePlatform],
    rule: input.rule.trim(),
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createAssignmentFilterRoutes(options: AssignmentFilterRoutesOptions): Route[] {
  const authorize = options.authorize ?? defaultAuthorize;

  function requirePermission(ctx: AssignmentFilterRequestContext, permission: string): void {
    if (!authorize(ctx, permission)) {
      throw new AppError(RbacErrorCodes.forbidden, `forbidden: requires ${permission}`, 403);
    }
  }

  function requireWrite(ctx: AssignmentFilterRequestContext): void {
    if (!authorize(ctx, ASSIGNMENT_FILTER_PERMISSIONS.write) && !authorize(ctx, ASSIGNMENT_FILTER_PERMISSIONS.remediationApply)) {
      throw new AppError(
        RbacErrorCodes.forbidden,
        `forbidden: requires ${ASSIGNMENT_FILTER_PERMISSIONS.write} or ${ASSIGNMENT_FILTER_PERMISSIONS.remediationApply}`,
        403,
      );
    }
  }

  function authenticated(ctx: RequestContext): AssignmentFilterCaller {
    const caller = options.resolveCaller(ctx);
    if (caller === undefined) throw new AppError("request.unauthenticated", "authentication required", 401);
    return caller;
  }

  function tenantCaller(ctx: RequestContext): { caller: AssignmentFilterCaller; tenantId: string } {
    const caller = authenticated(ctx);
    const tenantId = requireParam(ctx, "tenantId");
    requireTenantInScope(caller, tenantId);
    return { caller, tenantId };
  }

  async function audit(event: Record<string, unknown> | null | undefined): Promise<void> {
    if (event && options.recordAudit) await options.recordAudit(event);
  }

  async function requireTemplate(ctx: RequestContext): Promise<AssignmentFilterTemplate> {
    const id = requireParam(ctx, "id");
    const template = await options.repository.get(id);
    if (!template) {
      throw new AppError(ErrorCodesFilterTemplateNotFound, `Assignment filter template '${id}' not found`, 404);
    }
    return template;
  }

  function invalid(issues: ErrorDetail[]): AppError {
    return new AppError(ErrorCodesFilterInvalid, "Invalid assignment filter", 400, issues);
  }

  return [
    {
      method: "GET",
      path: ASSIGNMENT_FILTERS_PATH,
      handler: async (ctx): Promise<RouteResponse> => {
        const { tenantId } = tenantCaller(ctx);
        requirePermission(ctx as AssignmentFilterRequestContext, ASSIGNMENT_FILTER_PERMISSIONS.read);
        return { status: 200, body: { tenantId, items: await options.provider.list(tenantId) } };
      },
    },
    {
      method: "POST",
      path: ASSIGNMENT_FILTERS_PATH,
      handler: async (ctx): Promise<RouteResponse> => {
        const context = ctx as AssignmentFilterRequestContext;
        const { caller, tenantId } = tenantCaller(ctx);
        requireWrite(context);
        const body = asBody(context.body) as Partial<FilterInput>;
        const issues = collectFilterIssues(body);
        if (issues.length > 0) throw invalid(issues);
        const result = await options.provider.create(tenantId, toGraphInput(body as FilterInput), caller.userId ?? "system");
        await audit(result.auditEvent);
        return { status: 201, body: result };
      },
    },
    {
      method: "PATCH",
      path: ASSIGNMENT_FILTER_PATH,
      handler: async (ctx): Promise<RouteResponse> => {
        const context = ctx as AssignmentFilterRequestContext;
        const { caller, tenantId } = tenantCaller(ctx);
        requireWrite(context);
        const filterId = requireParam(ctx, "filterId");
        const body = asBody(context.body) as Partial<FilterInput>;
        if (body.platform !== undefined) {
          // Intune does not allow a filter's platform to change after creation.
          throw invalid([{ field: "platform", reason: "cannot be changed on an existing filter" }]);
        }
        const issues = collectFilterIssues(body, { partial: true });
        if (issues.length > 0) throw invalid(issues);
        const patch: Partial<GraphFilterInput> = {
          ...(body.displayName !== undefined ? { displayName: body.displayName.trim() } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.rule !== undefined ? { rule: body.rule.trim() } : {}),
        };
        if (Object.keys(patch).length === 0) throw invalid([{ field: "body", reason: "no changes supplied" }]);
        const result = await options.provider.update(tenantId, filterId, patch, caller.userId ?? "system");
        await audit(result.auditEvent);
        return { status: 200, body: result };
      },
    },
    {
      method: "DELETE",
      path: ASSIGNMENT_FILTER_PATH,
      handler: async (ctx): Promise<RouteResponse> => {
        const context = ctx as AssignmentFilterRequestContext;
        const { caller, tenantId } = tenantCaller(ctx);
        requireWrite(context);
        const filterId = requireParam(ctx, "filterId");
        const body = asBody(context.body);
        if (typeof body.confirmName !== "string" || !body.confirmName.trim()) {
          throw badRequest("confirmName is required to delete a filter", [{ field: "confirmName", reason: "required" }]);
        }
        const result = await options.provider.remove(tenantId, filterId, body.confirmName.trim(), caller.userId ?? "system");
        await audit(result.auditEvent);
        return { status: 200, body: result };
      },
    },
    {
      method: "GET",
      path: FILTER_TEMPLATES_PATH,
      handler: async (ctx): Promise<RouteResponse> => {
        requirePermission(ctx as AssignmentFilterRequestContext, ASSIGNMENT_FILTER_PERMISSIONS.read);
        return { status: 200, body: { items: await options.repository.list() } };
      },
    },
    {
      method: "GET",
      path: FILTER_TEMPLATE_PATH,
      handler: async (ctx): Promise<RouteResponse> => {
        requirePermission(ctx as AssignmentFilterRequestContext, ASSIGNMENT_FILTER_PERMISSIONS.read);
        return { status: 200, body: await requireTemplate(ctx) };
      },
    },
    {
      method: "POST",
      path: FILTER_TEMPLATES_PATH,
      handler: async (ctx): Promise<RouteResponse> => {
        const context = ctx as AssignmentFilterRequestContext;
        requirePermission(context, ASSIGNMENT_FILTER_PERMISSIONS.templates);
        const body = asBody(context.body);
        const created = await options.repository.create({
          ...(typeof body.id === "string" ? { id: body.id } : {}),
          name: body.name as string,
          platform: body.platform as string,
          rule: body.rule as string,
        });
        return { status: 201, body: created };
      },
    },
    {
      method: "PATCH",
      path: FILTER_TEMPLATE_PATH,
      handler: async (ctx): Promise<RouteResponse> => {
        const context = ctx as AssignmentFilterRequestContext;
        requirePermission(context, ASSIGNMENT_FILTER_PERMISSIONS.templates);
        const id = requireParam(ctx, "id");
        const body = asBody(context.body);
        const updated = await options.repository.update(id, {
          ...(body.name !== undefined ? { name: body.name as string } : {}),
          ...(body.platform !== undefined ? { platform: body.platform as string } : {}),
          ...(body.rule !== undefined ? { rule: body.rule as string } : {}),
        });
        if (!updated) {
          throw new AppError(ErrorCodesFilterTemplateNotFound, `Assignment filter template '${id}' not found`, 404);
        }
        return { status: 200, body: updated };
      },
    },
    {
      method: "DELETE",
      path: FILTER_TEMPLATE_PATH,
      handler: async (ctx): Promise<RouteResponse> => {
        requirePermission(ctx as AssignmentFilterRequestContext, ASSIGNMENT_FILTER_PERMISSIONS.templates);
        const id = requireParam(ctx, "id");
        if (!(await options.repository.remove(id))) {
          throw new AppError(ErrorCodesFilterTemplateNotFound, `Assignment filter template '${id}' not found`, 404);
        }
        return { status: 204 };
      },
    },
    {
      method: "POST",
      path: FILTER_TEMPLATE_DEPLOY_PATH,
      handler: async (ctx): Promise<RouteResponse> => {
        const context = ctx as AssignmentFilterRequestContext;
        const caller = authenticated(ctx);
        requirePermission(context, ASSIGNMENT_FILTER_PERMISSIONS.templates);
        requireWrite(context);
        const template = await requireTemplate(ctx);
        const body = asBody(context.body);
        const rawTargets = Array.isArray(body.targets) ? body.targets : [];
        const targets = [...new Set(rawTargets.map((t) => String(t).trim()).filter(Boolean))];
        if (targets.length === 0) {
          throw badRequest("at least one target tenant is required in 'targets'", [{ field: "targets", reason: "required" }]);
        }
        for (const tenantId of targets) requireTenantInScope(caller, tenantId);
        const input = toGraphInput({ displayName: template.name, platform: template.platform, rule: template.rule });

        if (body.preview !== false) {
          const plans = await Promise.all(
            targets.map(async (tenantId): Promise<FilterDeployPlan> => {
              try {
                return await options.provider.planDeploy(tenantId, input);
              } catch (err: unknown) {
                return { tenantId, action: "none", filterId: null, diff: [], valid: false, issue: errorMessage(err) };
              }
            }),
          );
          return {
            status: 200,
            body: { templateId: template.id, preview: true, targetCount: targets.length, plans, allValid: plans.every((p) => p.valid) },
          };
        }

        if (targets.length > 1 && body.confirmTargetCount !== targets.length) {
          throw badRequest(`deploying to ${targets.length} tenants requires confirmTargetCount: ${targets.length}`, [
            { field: "confirmTargetCount", reason: "required" },
          ]);
        }
        const results: FilterDeployResult[] = [];
        for (const tenantId of targets) {
          let result: FilterDeployResult;
          try {
            result = await options.provider.deploy(tenantId, input, caller.userId ?? "system");
          } catch (err: unknown) {
            result = { tenantId, state: "failed", filterId: null, error: errorMessage(err), auditEvent: null };
          }
          await audit(result.auditEvent);
          results.push(result);
        }
        const failed = results.filter((r) => r.state === "failed").length;
        return {
          status: failed === 0 ? 200 : failed === results.length ? 422 : 207,
          body: { templateId: template.id, targetCount: targets.length, success: failed < results.length, results },
        };
      },
    },
  ];
}
