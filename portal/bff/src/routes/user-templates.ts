// User template CRUD (EPIC-011 SPEC.md §3.5, §5 US-7; T-0208).
//
// User Templates define creation defaults (usage location, licenses, groups)
// and offboarding defaults applied at creation and offboarding (§11.5: the
// per-tenant offboarding defaults come from the template, and the wizard may
// override them per run). A template never writes to a tenant on its own; the
// create path (T-0202) seeds rows through applyTemplateCreationDefaults and
// the plan builder (T-0205) resolves the mailbox access mode through
// resolveTemplateMailboxAccess. Both helpers are pure and tested here so the
// contract holds without touching those modules.
import { randomUUID } from "node:crypto";
import { AppError, ErrorCodes } from "../errors.js";
import {
  MAILBOX_ACCESS_MODES,
  OFFBOARDING_STEP_CATALOGUE,
  type MailboxAccess,
} from "../domain/offboarding/plan.js";
import type { Caller } from "../rbac/authorize.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const USER_TEMPLATES_PATH = "/v1/user-templates";
export const USER_TEMPLATE_PATH = "/v1/user-templates/:id";

export const USER_TEMPLATE_PERMISSIONS = {
  read: "users.read",
  write: "users.write",
} as const;

export const USER_TEMPLATE_NOT_FOUND = "user-template.not_found";
export const USER_TEMPLATE_UNAUTHENTICATED = "request.unauthenticated";

export interface UserTemplateRecord {
  readonly id: string;
  readonly name: string;
  readonly properties: Record<string, unknown>;
  readonly licenses: readonly string[];
  readonly groups: readonly string[];
  readonly offboardingDefaults: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}

export interface UserTemplateStore {
  createUserTemplate(input: {
    id: string;
    name: string;
    properties: Record<string, unknown>;
    licenses: readonly string[];
    groups: readonly string[];
    offboardingDefaults: Record<string, unknown>;
  }): Promise<UserTemplateRecord>;
  getUserTemplate(templateId: string): Promise<UserTemplateRecord | undefined>;
  listUserTemplates(): Promise<readonly UserTemplateRecord[]>;
  updateUserTemplate(
    templateId: string,
    update: {
      name?: string;
      properties?: Record<string, unknown>;
      licenses?: readonly string[];
      groups?: readonly string[];
      offboardingDefaults?: Record<string, unknown>;
    },
  ): Promise<UserTemplateRecord | undefined>;
  softDeleteUserTemplate(templateId: string): Promise<boolean>;
}

export interface UserTemplateCaller extends Caller {
  readonly userId?: string;
}

export type UserTemplateAuthorizer = (
  caller: UserTemplateCaller,
  permission: string,
) => void | Promise<void>;

export interface UserTemplateRequestContext extends RequestContext {
  readonly body?: unknown;
}

export interface UserTemplateAuditEvent {
  readonly tenantId: null;
  readonly action: "user-templates.create" | "user-templates.update" | "user-templates.delete";
  readonly targetId: string;
  readonly result: "success";
  readonly actorUserId: string | null;
  readonly correlationId: string;
  readonly createdAt: string;
}

export interface UserTemplateRouteOptions {
  readonly store: UserTemplateStore;
  readonly resolveCaller: (ctx: RequestContext) => UserTemplateCaller | undefined;
  readonly authorize?: UserTemplateAuthorizer;
  readonly readBody?: (ctx: UserTemplateRequestContext) => unknown;
  readonly recordAudit?: (event: UserTemplateAuditEvent) => Promise<void>;
  readonly idGenerator?: () => string;
  readonly now?: () => string;
}

function validationError(message: string, field: string): AppError {
  return new AppError(ErrorCodes.validationFailed, message, 400, [{ field, reason: "invalid" }]);
}

function notFoundError(templateId: string): AppError {
  return new AppError(USER_TEMPLATE_NOT_FOUND, `user template ${templateId} was not found`, 404);
}

function unauthenticatedError(): AppError {
  return new AppError(USER_TEMPLATE_UNAUTHENTICATED, "authentication required", 401);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => UserTemplateCaller | undefined,
  ctx: RequestContext,
): UserTemplateCaller {
  const caller = resolveCaller(ctx);
  if (caller === undefined) {
    throw unauthenticatedError();
  }
  return caller;
}

function requireTemplateId(ctx: RequestContext): string {
  const value = ctx.params["id"];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw notFoundError("");
  }
  return value.trim();
}

function readJsonObject(
  ctx: RequestContext,
  readBody: ((ctx: UserTemplateRequestContext) => unknown) | undefined,
): Record<string, unknown> {
  let body = readBody ? readBody(ctx as UserTemplateRequestContext) : (ctx as UserTemplateRequestContext).body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      throw new AppError(ErrorCodes.validationFailed, "request body is not valid JSON", 400, [
        { field: "body", reason: "invalid_json" },
      ]);
    }
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError(ErrorCodes.validationFailed, "request body must be a JSON object", 400, [
      { field: "body", reason: "invalid" },
    ]);
  }
  return body as Record<string, unknown>;
}

function parseName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError("name must be a non-empty string", "name");
  }
  return value.trim();
}

function parseStringRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw validationError(`${field} must be an object`, field);
  }
  return { ...(value as Record<string, unknown>) };
}

function parseStringArray(value: unknown, field: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw validationError(`${field} must be an array of non-empty strings`, field);
  }
  return (value as string[]).map((item) => item.trim());
}

const STEP_OPTIONS = new Set<string>(OFFBOARDING_STEP_CATALOGUE.map((entry) => entry.option));

// Offboarding defaults accept the v1 plan catalogue toggles plus the mailbox
// access mode; anything else is rejected so a template cannot silently carry
// an option the plan builder would ignore.
function parseOffboardingDefaults(value: unknown): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw validationError("offboardingDefaults must be an object", "offboardingDefaults");
  }
  const record = value as Record<string, unknown>;
  const parsed: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (key === "mailboxAccess") {
      parsed["mailboxAccess"] = parseMailboxAccess(record[key]);
      continue;
    }
    if (!STEP_OPTIONS.has(key)) {
      throw validationError(
        `unknown offboarding default '${key}'; expected a v1 plan toggle or mailboxAccess`,
        "offboardingDefaults",
      );
    }
    if (typeof record[key] !== "boolean") {
      throw validationError(`offboarding default '${key}' must be a boolean`, "offboardingDefaults");
    }
    parsed[key] = record[key];
  }
  return parsed;
}

function parseMailboxAccess(value: unknown): MailboxAccess {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw validationError("mailboxAccess must be an object", "offboardingDefaults");
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "mode" && key !== "automap") {
      throw validationError(`unknown mailboxAccess key '${key}'`, "offboardingDefaults");
    }
  }
  const mode = record["mode"] ?? "full";
  if (typeof mode !== "string" || !(MAILBOX_ACCESS_MODES as readonly string[]).includes(mode)) {
    throw validationError(
      `mailbox access mode must be one of ${MAILBOX_ACCESS_MODES.join(", ")}`,
      "offboardingDefaults",
    );
  }
  const automap = record["automap"] ?? false;
  if (typeof automap !== "boolean") {
    throw validationError("mailboxAccess.automap must be a boolean", "offboardingDefaults");
  }
  return { mode: mode as MailboxAccess["mode"], automap };
}

export interface TemplateCreateRow {
  readonly usageLocation?: string;
  readonly licenses?: readonly string[];
  readonly groups?: readonly string[];
}

// Seeds a creation row from a template: the row wins where present, the
// template fills usage location, licenses, and groups otherwise. Runs without
// a template fall back to documented empty defaults.
export function applyTemplateCreationDefaults(
  template: Pick<UserTemplateRecord, "properties" | "licenses" | "groups"> | null,
  row: TemplateCreateRow,
): { usageLocation: string; licenses: string[]; groups: string[] } {
  const templateUsage =
    template !== null && typeof template.properties["usageLocation"] === "string"
      ? (template.properties["usageLocation"] as string).trim()
      : "";
  const usageLocation = row.usageLocation?.trim() || templateUsage;
  const licenses = [...(row.licenses ?? []), ...((template?.licenses ?? []).filter((sku) => !(row.licenses ?? []).includes(sku)))];
  const groups = [...(row.groups ?? []), ...((template?.groups ?? []).filter((group) => !(row.groups ?? []).includes(group)))];
  return { usageLocation, licenses, groups };
}

// Resolves the effective mailbox access mode: the wizard override wins, else
// the template default, else the plan fallback (full without automap).
export function resolveTemplateMailboxAccess(
  template: Pick<UserTemplateRecord, "offboardingDefaults"> | null,
  override?: Partial<MailboxAccess> | null,
): MailboxAccess {
  const fallback: MailboxAccess = { mode: "full", automap: false };
  const fromTemplate = template?.offboardingDefaults["mailboxAccess"];
  const base =
    typeof fromTemplate === "object" && fromTemplate !== null && !Array.isArray(fromTemplate)
      ? (fromTemplate as Partial<MailboxAccess>)
      : {};
  const mode = override?.mode ?? (typeof base.mode === "string" ? base.mode : fallback.mode);
  if (!(MAILBOX_ACCESS_MODES as readonly string[]).includes(mode)) {
    throw new AppError(ErrorCodes.validationFailed, "mailbox access mode is not supported", 400, [
      { field: "mailboxAccess.mode", reason: "invalid" },
    ]);
  }
  return {
    mode: mode as MailboxAccess["mode"],
    automap: override?.automap ?? (typeof base.automap === "boolean" ? base.automap : fallback.automap),
  };
}

export function createUserTemplateRoutes(options: UserTemplateRouteOptions): Route[] {
  const readBody = options.readBody ?? ((ctx) => (ctx as UserTemplateRequestContext).body);
  const generateId = options.idGenerator ?? randomUUID;
  const now = options.now ?? (() => new Date().toISOString());

  async function audit(
    ctx: RequestContext,
    caller: UserTemplateCaller,
    action: UserTemplateAuditEvent["action"],
    targetId: string,
  ): Promise<void> {
    if (!options.recordAudit) {
      return;
    }
    await options.recordAudit({
      tenantId: null,
      action,
      targetId,
      result: "success",
      actorUserId: caller.userId ?? null,
      correlationId: ctx.correlationId,
      createdAt: now(),
    });
  }

  const handler =
    (
      fn: (ctx: UserTemplateRequestContext) => Promise<{ status: number; body?: unknown }>,
    ): Route["handler"] =>
    (ctx) =>
      fn(ctx as UserTemplateRequestContext);

  return [
    {
      method: "GET",
      path: USER_TEMPLATES_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        if (options.authorize) {
          await options.authorize(caller, USER_TEMPLATE_PERMISSIONS.read);
        }
        const templates = await options.store.listUserTemplates();
        return { status: 200, body: { templates: [...templates] } };
      }),
    },
    {
      method: "POST",
      path: USER_TEMPLATES_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        if (options.authorize) {
          await options.authorize(caller, USER_TEMPLATE_PERMISSIONS.write);
        }
        const body = readJsonObject(ctx, options.readBody);
        const created = await options.store.createUserTemplate({
          id: generateId(),
          name: parseName(body["name"]),
          properties: parseStringRecord(body["properties"], "properties"),
          licenses: parseStringArray(body["licenses"], "licenses"),
          groups: parseStringArray(body["groups"], "groups"),
          offboardingDefaults: parseOffboardingDefaults(body["offboardingDefaults"]),
        });
        await audit(ctx, caller, "user-templates.create", created.id);
        return { status: 201, body: created };
      }),
    },
    {
      method: "GET",
      path: USER_TEMPLATE_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        if (options.authorize) {
          await options.authorize(caller, USER_TEMPLATE_PERMISSIONS.read);
        }
        const existing = await options.store.getUserTemplate(requireTemplateId(ctx));
        if (!existing) {
          throw notFoundError(requireTemplateId(ctx));
        }
        return { status: 200, body: existing };
      }),
    },
    {
      method: "PATCH",
      path: USER_TEMPLATE_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        if (options.authorize) {
          await options.authorize(caller, USER_TEMPLATE_PERMISSIONS.write);
        }
        const templateId = requireTemplateId(ctx);
        const body = readJsonObject(ctx, options.readBody);
        const update: {
          name?: string;
          properties?: Record<string, unknown>;
          licenses?: string[];
          groups?: string[];
          offboardingDefaults?: Record<string, unknown>;
        } = {};
        if (body["name"] !== undefined) {
          update.name = parseName(body["name"]);
        }
        if (body["properties"] !== undefined) {
          update.properties = parseStringRecord(body["properties"], "properties");
        }
        if (body["licenses"] !== undefined) {
          update.licenses = parseStringArray(body["licenses"], "licenses");
        }
        if (body["groups"] !== undefined) {
          update.groups = parseStringArray(body["groups"], "groups");
        }
        if (body["offboardingDefaults"] !== undefined) {
          update.offboardingDefaults = parseOffboardingDefaults(body["offboardingDefaults"]);
        }
        const updated = await options.store.updateUserTemplate(templateId, update);
        if (!updated) {
          throw notFoundError(templateId);
        }
        await audit(ctx, caller, "user-templates.update", updated.id);
        return { status: 200, body: updated };
      }),
    },
    {
      method: "DELETE",
      path: USER_TEMPLATE_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        if (options.authorize) {
          await options.authorize(caller, USER_TEMPLATE_PERMISSIONS.write);
        }
        const templateId = requireTemplateId(ctx);
        const deleted = await options.store.softDeleteUserTemplate(templateId);
        if (!deleted) {
          throw notFoundError(templateId);
        }
        await audit(ctx, caller, "user-templates.delete", templateId);
        return { status: 200, body: { id: templateId, deleted: true } };
      }),
    },
  ];
}

// Route modules own their OpenAPI path items (portal.v1.yaml `paths` is empty
// by design); a wiring ticket merges this fragment into the served document.
export const USER_TEMPLATES_OPENAPI = {
  paths: {
    "/user-templates": {
      get: {
        operationId: "listUserTemplates",
        summary: "List user templates with creation and offboarding defaults",
        permission: USER_TEMPLATE_PERMISSIONS.read,
        security: [{ bearerAuth: [] }],
        parameters: [],
        responses: {
          "200": { description: "User templates with properties, licenses, groups, and offboarding defaults." },
          "401": { description: "Authentication required." },
          "403": { description: "The caller lacks users.read." },
        },
      },
      post: {
        operationId: "createUserTemplate",
        summary: "Create a user template",
        permission: USER_TEMPLATE_PERMISSIONS.write,
        security: [{ bearerAuth: [] }],
        parameters: [],
        responses: {
          "201": { description: "The created template." },
          "400": { description: "The template body is invalid." },
          "401": { description: "Authentication required." },
          "403": { description: "The caller lacks users.write." },
        },
      },
    },
    "/user-templates/{id}": {
      get: {
        operationId: "getUserTemplate",
        summary: "Get one user template",
        permission: USER_TEMPLATE_PERMISSIONS.read,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "The template." },
          "404": { description: "No template with that id." },
        },
      },
      patch: {
        operationId: "updateUserTemplate",
        summary: "Update a user template",
        permission: USER_TEMPLATE_PERMISSIONS.write,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "The updated template." },
          "404": { description: "No template with that id." },
        },
      },
      delete: {
        operationId: "deleteUserTemplate",
        summary: "Soft-delete a user template",
        permission: USER_TEMPLATE_PERMISSIONS.write,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Deletion confirmation." },
          "404": { description: "No template with that id." },
        },
      },
    },
  },
} as const;
