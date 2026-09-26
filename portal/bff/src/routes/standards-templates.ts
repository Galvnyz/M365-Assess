// Standards template CRUD, clone, and convert API (EPIC-008 SPEC.md §4.6, §6, §7;
// T-0143).
//
// Routes over the standards template store (T-0142). Reads require
// `standards.read`, mutations `standards.write`; a request that names a tenant is
// scope-checked through the shared RBAC seam. `Convert` (a `kind` change on
// PATCH) is validated: drift is observe-only, so a template that still remediates
// cannot become a drift template. Storage is injected as a structural seam so
// this module stays free of SQL and testable without a database.

import { randomUUID } from "node:crypto";
import { AppError, ErrorCodes } from "../errors.js";
import {
  requirePermission,
  requireTenantInScope,
  type Caller,
} from "../rbac/authorize.js";
import type { Permission } from "../rbac/roles.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

// ─── Paths, permissions, error codes ─────────────────────────────────────────

export const STANDARDS_TEMPLATES_PATH = "/v1/standards/templates";
export const STANDARDS_TEMPLATE_DETAIL_PATH = "/v1/standards/templates/:templateId";
export const STANDARDS_TEMPLATE_CLONE_PATH = "/v1/standards/templates/:templateId/clone";

export const STANDARDS_PERMISSIONS = {
  read: "standards.read",
  write: "standards.write",
} as const;

export const STANDARDS_UNAUTHENTICATED = "request.unauthenticated";
export const STANDARDS_TEMPLATE_NOT_FOUND = "standards.template_not_found";
export const STANDARDS_INVALID_KIND_CONVERSION = "standards.invalid_kind_conversion";

// ─── Records (structural mirrors of the T-0142 store) ────────────────────────

export const STANDARD_TEMPLATE_KINDS = ["standards", "drift"] as const;
export type StandardTemplateKind = (typeof STANDARD_TEMPLATE_KINDS)[number];
export type TemplateTargetType = "allTenants" | "group" | "tenant";

export interface StandardTemplateActions {
  readonly report: boolean;
  readonly alert: boolean;
  readonly remediate: boolean;
}

export interface StandardTemplateSetting {
  readonly key: string;
  readonly value: unknown;
}

export interface StandardTemplateRecord {
  readonly id: string;
  readonly name: string;
  readonly kind: StandardTemplateKind;
  readonly actions: StandardTemplateActions;
  readonly autoRemediate: boolean;
  readonly settings: readonly StandardTemplateSetting[];
  readonly scheduleId: string | null;
}

export interface TemplateAssignmentRecord {
  readonly templateId: string;
  readonly targetType: TemplateTargetType;
  readonly targetId: string | null;
  readonly precedence: number;
}

export interface CreateTemplateInput {
  readonly id: string;
  readonly name: string;
  readonly kind: StandardTemplateKind;
  readonly actions?: Partial<StandardTemplateActions>;
  readonly autoRemediate?: boolean;
  readonly settings?: readonly StandardTemplateSetting[];
  readonly scheduleId?: string | null;
}

// Mutable partial: the seam's update method patches individual fields, so this
// cannot be `Partial<CreateTemplateInput>` (whose fields are readonly).
export interface UpdateTemplatePatch {
  name?: string;
  kind?: StandardTemplateKind;
  actions?: Partial<StandardTemplateActions>;
  autoRemediate?: boolean;
  settings?: readonly StandardTemplateSetting[];
  scheduleId?: string | null;
}

export interface CloneTemplateInput {
  readonly id: string;
  readonly name: string;
  readonly kind: StandardTemplateKind;
  readonly actions: StandardTemplateActions;
  readonly autoRemediate: boolean;
  readonly settings: readonly StandardTemplateSetting[];
  readonly scheduleId: string | null;
}

export interface UpsertAssignmentInput {
  readonly templateId: string;
  readonly targetType: TemplateTargetType;
  readonly targetId?: string | null;
  readonly precedence?: number;
}

// ─── Dependency seam ──────────────────────────────────────────────────────────

export interface StandardsTemplateStore {
  listStandardTemplates(): Promise<readonly StandardTemplateRecord[]>;
  getStandardTemplate(templateId: string): Promise<StandardTemplateRecord | undefined>;
  createStandardTemplate(input: CreateTemplateInput): Promise<StandardTemplateRecord>;
  updateStandardTemplate(
    templateId: string,
    patch: UpdateTemplatePatch,
  ): Promise<StandardTemplateRecord | undefined>;
  deleteStandardTemplate(templateId: string): Promise<boolean>;
  listTemplateAssignments(): Promise<readonly TemplateAssignmentRecord[]>;
  upsertTemplateAssignment(input: UpsertAssignmentInput): Promise<TemplateAssignmentRecord>;
}

export interface StandardsRouteOptions {
  readonly store: StandardsTemplateStore;
  readonly resolveCaller: (ctx: RequestContext) => Caller | undefined;
  readonly authorize?: (caller: Caller, permission: string) => void | Promise<void>;
  readonly idGenerator?: () => string;
}

export interface StandardsRequest extends RequestContext {
  readonly body?: unknown;
}

// ─── Convert validation (SPEC §4.6) ──────────────────────────────────────────

function remediates(actions: StandardTemplateActions, autoRemediate: boolean): boolean {
  return autoRemediate || actions.remediate;
}

/**
 * A `kind` change is a Convert (SPEC §4.6). Drift templates are observe-only
 * (EPIC-009 compares desired vs current), so a template that still remediates
 * cannot become a drift template; drift -> standards is always legal.
 */
export function isKindConversionLegal(
  template: Pick<StandardTemplateRecord, "kind" | "actions" | "autoRemediate">,
  targetKind: StandardTemplateKind,
): boolean {
  if (template.kind === targetKind) return true;
  if (targetKind === "drift") {
    return !remediates(template.actions, template.autoRemediate);
  }
  return true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function ensureAuthorized(
  options: StandardsRouteOptions,
  caller: Caller,
  permission: string,
): Promise<void> {
  if (options.authorize) {
    await options.authorize(caller, permission);
    return;
  }
  // The standards.* tokens are not members of the roles.ts Permission union yet
  // (EPIC-038 wires the full taxonomy); without an authorize seam, deny.
  requirePermission(caller, permission as Permission);
}

function requireCaller(options: StandardsRouteOptions, ctx: StandardsRequest): Caller {
  const caller = options.resolveCaller(ctx);
  if (!caller) {
    throw new AppError(STANDARDS_UNAUTHENTICATED, "authentication required", 401);
  }
  return caller;
}

function requireParam(ctx: StandardsRequest, name: string): string {
  const value = ctx.params[name];
  if (!value || value.length === 0) {
    throw new AppError(ErrorCodes.validationFailed, `Missing route parameter '${name}'`, 400, [
      { field: name, reason: "required" },
    ]);
  }
  return value;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new AppError(ErrorCodes.validationFailed, "Request body is not valid JSON", 400, [
      { field: "body", reason: "invalid_json" },
    ]);
  }
}

function requireBodyRecord(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string" ? safeParse(value) : value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AppError(ErrorCodes.validationFailed, "Request body must be a JSON object", 400, [
      { field: "body", reason: "invalid" },
    ]);
  }
  return parsed as Record<string, unknown>;
}

function optionalBodyRecord(value: unknown): Record<string, unknown> {
  return value === undefined || value === null ? {} : requireBodyRecord(value);
}

function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new AppError(ErrorCodes.validationFailed, `Missing required string field '${field}'`, 400, [
      { field, reason: "required" },
    ]);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new AppError(ErrorCodes.validationFailed, `Field '${field}' must be a string`, 400, [
      { field, reason: "invalid" },
    ]);
  }
  return value;
}

function optionalBoolean(record: Record<string, unknown>, field: string): boolean | undefined {
  const value = record[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new AppError(ErrorCodes.validationFailed, `Field '${field}' must be a boolean`, 400, [
      { field, reason: "invalid" },
    ]);
  }
  return value;
}

function parseKind(value: unknown): StandardTemplateKind {
  if (typeof value !== "string" || !(STANDARD_TEMPLATE_KINDS as readonly string[]).includes(value)) {
    throw new AppError(
      ErrorCodes.validationFailed,
      `Field 'kind' must be one of ${STANDARD_TEMPLATE_KINDS.join(", ")}`,
      400,
      [{ field: "kind", reason: "invalid" }],
    );
  }
  return value as StandardTemplateKind;
}

type MutableActions = { report?: boolean; alert?: boolean; remediate?: boolean };

function parseActions(value: unknown): MutableActions | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(ErrorCodes.validationFailed, "Field 'actions' must be an object", 400, [
      { field: "actions", reason: "invalid" },
    ]);
  }
  const record = value as Record<string, unknown>;
  const actions: MutableActions = {};
  for (const key of ["report", "alert", "remediate"] as const) {
    if (record[key] === undefined) continue;
    if (typeof record[key] !== "boolean") {
      throw new AppError(ErrorCodes.validationFailed, `actions.${key} must be a boolean`, 400, [
        { field: `actions.${key}`, reason: "invalid" },
      ]);
    }
    actions[key] = record[key] as boolean;
  }
  return actions;
}

function parseSettings(value: unknown): StandardTemplateSetting[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new AppError(ErrorCodes.validationFailed, "Field 'settings' must be an array", 400, [
      { field: "settings", reason: "invalid" },
    ]);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new AppError(ErrorCodes.validationFailed, `settings[${index}] must be an object`, 400, [
        { field: `settings[${index}]`, reason: "invalid" },
      ]);
    }
    const record = entry as Record<string, unknown>;
    if (typeof record["key"] !== "string" || record["key"].length === 0) {
      throw new AppError(ErrorCodes.validationFailed, `settings[${index}].key is required`, 400, [
        { field: `settings[${index}].key`, reason: "required" },
      ]);
    }
    return { key: record["key"], value: record["value"] };
  });
}

/** Enforces tenant scope only when the request names a tenant. */
function enforceTenantScope(caller: Caller, tenantId: string | null): void {
  if (tenantId) requireTenantInScope(caller, tenantId);
}

function mapTemplate(template: StandardTemplateRecord): Record<string, unknown> {
  return {
    id: template.id,
    name: template.name,
    kind: template.kind,
    actions: template.actions,
    autoRemediate: template.autoRemediate,
    settings: template.settings,
    scheduleId: template.scheduleId,
  };
}

// ─── Route factory ────────────────────────────────────────────────────────────

export function createStandardsTemplateRoutes(options: StandardsRouteOptions): Route[] {
  const idGenerator = options.idGenerator ?? (() => randomUUID());

  // GET /v1/standards/templates
  async function handleList(ctx: StandardsRequest): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, STANDARDS_PERMISSIONS.read);
    const tenantId = ctx.query.get("tenantId");
    enforceTenantScope(caller, tenantId);
    const kind = ctx.query.get("kind");

    let items = await options.store.listStandardTemplates();
    if (kind) {
      const parsed = parseKind(kind);
      items = items.filter((template) => template.kind === parsed);
    }
    return { status: 200, body: { items: items.map(mapTemplate) } };
  }

  // POST /v1/standards/templates — new templates default to report-only (§11.2).
  async function handleCreate(ctx: StandardsRequest): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, STANDARDS_PERMISSIONS.write);
    const body = requireBodyRecord(ctx.body);
    enforceTenantScope(caller, optionalString(body, "tenantId"));

    const template = await options.store.createStandardTemplate({
      id: idGenerator(),
      name: requireString(body, "name"),
      kind: parseKind(body["kind"] ?? "standards"),
      actions: parseActions(body["actions"]),
      autoRemediate: optionalBoolean(body, "autoRemediate") ?? false,
      settings: parseSettings(body["settings"]) ?? [],
      scheduleId: optionalString(body, "scheduleId"),
    });
    return { status: 201, body: { template: mapTemplate(template) } };
  }

  // GET /v1/standards/templates/:templateId
  async function handleGet(ctx: StandardsRequest): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, STANDARDS_PERMISSIONS.read);
    const templateId = requireParam(ctx, "templateId");
    const template = await options.store.getStandardTemplate(templateId);
    if (!template) {
      throw new AppError(STANDARDS_TEMPLATE_NOT_FOUND, `Standard template ${templateId} not found`, 404);
    }
    return { status: 200, body: { template: mapTemplate(template) } };
  }

  // PATCH /v1/standards/templates/:templateId — includes Convert (kind change).
  async function handlePatch(ctx: StandardsRequest): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, STANDARDS_PERMISSIONS.write);
    const templateId = requireParam(ctx, "templateId");
    const body = requireBodyRecord(ctx.body);
    enforceTenantScope(caller, optionalString(body, "tenantId"));

    const existing = await options.store.getStandardTemplate(templateId);
    if (!existing) {
      throw new AppError(STANDARDS_TEMPLATE_NOT_FOUND, `Standard template ${templateId} not found`, 404);
    }

    const patch: UpdateTemplatePatch = {};
    if (body["name"] !== undefined) patch.name = requireString(body, "name");
    if (body["scheduleId"] !== undefined) patch.scheduleId = optionalString(body, "scheduleId");

    const actions = parseActions(body["actions"]);
    const autoRemediate = optionalBoolean(body, "autoRemediate");
    if (body["kind"] !== undefined) {
      const targetKind = parseKind(body["kind"]);
      const effectiveActions = { ...existing.actions, ...(actions ?? {}) };
      const effectiveAuto = autoRemediate ?? existing.autoRemediate;
      if (!isKindConversionLegal(
        { kind: existing.kind, actions: effectiveActions, autoRemediate: effectiveAuto },
        targetKind,
      )) {
        throw new AppError(
          STANDARDS_INVALID_KIND_CONVERSION,
          `cannot convert a remediating template to '${targetKind}'`,
          422,
        );
      }
      patch.kind = targetKind;
    }
    if (actions !== undefined) patch.actions = actions;
    const settings = parseSettings(body["settings"]);
    if (settings !== undefined) patch.settings = settings;
    if (autoRemediate !== undefined) patch.autoRemediate = autoRemediate;

    const updated = await options.store.updateStandardTemplate(templateId, patch);
    if (!updated) {
      throw new AppError(STANDARDS_TEMPLATE_NOT_FOUND, `Standard template ${templateId} not found`, 404);
    }
    return { status: 200, body: { template: mapTemplate(updated) } };
  }

  // DELETE /v1/standards/templates/:templateId
  async function handleDelete(ctx: StandardsRequest): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, STANDARDS_PERMISSIONS.write);
    const templateId = requireParam(ctx, "templateId");
    const deleted = await options.store.deleteStandardTemplate(templateId);
    if (!deleted) {
      throw new AppError(STANDARDS_TEMPLATE_NOT_FOUND, `Standard template ${templateId} not found`, 404);
    }
    return { status: 204 };
  }

  // POST /v1/standards/templates/:templateId/clone
  async function handleClone(ctx: StandardsRequest): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, STANDARDS_PERMISSIONS.write);
    const templateId = requireParam(ctx, "templateId");
    const body = optionalBodyRecord(ctx.body);
    enforceTenantScope(caller, optionalString(body, "tenantId"));

    const source = await options.store.getStandardTemplate(templateId);
    if (!source) {
      throw new AppError(STANDARDS_TEMPLATE_NOT_FOUND, `Standard template ${templateId} not found`, 404);
    }

    const newId = idGenerator();
    const clone = await options.store.createStandardTemplate({
      id: newId,
      name: optionalString(body, "name") ?? `${source.name} (copy)`,
      kind: source.kind,
      actions: source.actions,
      autoRemediate: source.autoRemediate,
      settings: source.settings,
      scheduleId: null,
    });

    if (optionalBoolean(body, "includeAssignments") === true) {
      const assignments = await options.store.listTemplateAssignments();
      for (const assignment of assignments) {
        if (assignment.templateId !== templateId) continue;
        await options.store.upsertTemplateAssignment({
          templateId: newId,
          targetType: assignment.targetType,
          targetId: assignment.targetId,
          precedence: assignment.precedence,
        });
      }
    }

    return { status: 201, body: { template: mapTemplate(clone) } };
  }

  return [
    { method: "GET", path: STANDARDS_TEMPLATES_PATH, handler: handleList },
    { method: "POST", path: STANDARDS_TEMPLATES_PATH, handler: handleCreate },
    { method: "GET", path: STANDARDS_TEMPLATE_DETAIL_PATH, handler: handleGet },
    { method: "PATCH", path: STANDARDS_TEMPLATE_DETAIL_PATH, handler: handlePatch },
    { method: "DELETE", path: STANDARDS_TEMPLATE_DETAIL_PATH, handler: handleDelete },
    { method: "POST", path: STANDARDS_TEMPLATE_CLONE_PATH, handler: handleClone },
  ];
}

// ─── OpenAPI fragment (§6) ───────────────────────────────────────────────────

export const STANDARDS_TEMPLATES_OPENAPI = {
  "/v1/standards/templates": {
    get: {
      tags: ["Standards"],
      operationId: "listStandardTemplates",
      summary: "List standards/drift templates.",
      permission: STANDARDS_PERMISSIONS.read,
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: "kind", in: "query", required: false, schema: { type: "string", enum: [...STANDARD_TEMPLATE_KINDS] } },
        { name: "tenantId", in: "query", required: false, schema: { type: "string" } },
      ],
      responses: {
        "200": { description: "Templates.", content: { "application/json": { schema: { $ref: "#/components/schemas/StandardTemplateListResponse" } } } },
        "401": { description: "Unauthenticated.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "403": { description: "Forbidden or tenant out of scope.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
    post: {
      tags: ["Standards"],
      operationId: "createStandardTemplate",
      summary: "Create a template (report-only by default).",
      permission: STANDARDS_PERMISSIONS.write,
      security: [{ bearerAuth: [] }],
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/StandardTemplateCreateRequest" } } } },
      responses: {
        "201": { description: "Created.", content: { "application/json": { schema: { $ref: "#/components/schemas/StandardTemplateResponse" } } } },
        "400": { description: "Invalid body.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "401": { description: "Unauthenticated.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "403": { description: "Forbidden.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
  "/v1/standards/templates/{templateId}": {
    get: {
      tags: ["Standards"],
      operationId: "getStandardTemplate",
      summary: "Read a template.",
      permission: STANDARDS_PERMISSIONS.read,
      security: [{ bearerAuth: [] }],
      parameters: [{ name: "templateId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "Template.", content: { "application/json": { schema: { $ref: "#/components/schemas/StandardTemplateResponse" } } } },
        "404": { description: "Not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
    patch: {
      tags: ["Standards"],
      operationId: "updateStandardTemplate",
      summary: "Update a template, including Convert (kind change).",
      permission: STANDARDS_PERMISSIONS.write,
      security: [{ bearerAuth: [] }],
      parameters: [{ name: "templateId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "Updated.", content: { "application/json": { schema: { $ref: "#/components/schemas/StandardTemplateResponse" } } } },
        "404": { description: "Not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "422": { description: "Invalid kind conversion.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
    delete: {
      tags: ["Standards"],
      operationId: "deleteStandardTemplate",
      summary: "Delete a template.",
      permission: STANDARDS_PERMISSIONS.write,
      security: [{ bearerAuth: [] }],
      parameters: [{ name: "templateId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "204": { description: "Deleted." },
        "404": { description: "Not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
  "/v1/standards/templates/{templateId}/clone": {
    post: {
      tags: ["Standards"],
      operationId: "cloneStandardTemplate",
      summary: "Clone a template into an independent copy.",
      permission: STANDARDS_PERMISSIONS.write,
      security: [{ bearerAuth: [] }],
      parameters: [{ name: "templateId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "201": { description: "Cloned.", content: { "application/json": { schema: { $ref: "#/components/schemas/StandardTemplateResponse" } } } },
        "404": { description: "Not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
} as const;
