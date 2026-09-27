// Tenant-variable CRUD routes (EPIC-002 SPEC.md §3.5, §5, and §6) over a
// repository surface mirroring the T-0021 TenantVariable store: key/value rows
// per tenant (or global when `tenantId` is null) with `%name%` names validated
// against ../domain/variable-substitution. Secret plaintext lives only in the
// store row: every API response and every audit before/after carries the mask
// below, and audit events reference the row by id. Reads intersect with the
// caller's RBAC scope; writes require the tenant in scope (T-0013 helpers) and
// every mutation appends an AuditEvent (03-database.md §6). The OpenAPI
// fragment is published here so `portal.v1.yaml` stays untouched (EPIC-001
// SPEC §1).
import { randomUUID } from "node:crypto";
import { isVariableName } from "../domain/variable-substitution.js";
import { AppError, ErrorCodes } from "../errors.js";
import { paginate, parsePagination } from "../pagination.js";
import {
  requireTenantInScope,
  type Caller,
} from "../rbac/authorize.js";
import { isTenantAllowed } from "../rbac/scope.js";
import type { RequestContext, Route } from "../server.js";

export const TENANT_VARIABLES_PATH = "/v1/tenant-variables";
export const TENANT_VARIABLE_PATH = "/v1/tenant-variables/:id";

export const TENANT_VARIABLE_PERMISSIONS = {
  read: "Tenant.Administration.Read",
  write: "Tenant.Administration.ReadWrite",
} as const;

export const TENANT_VARIABLE_NOT_FOUND = "tenant-variable.not_found";
export const TENANT_VARIABLE_CONFLICT = "tenant-variable.conflict";

export const TENANT_VARIABLE_UNAUTHENTICATED = "request.unauthenticated";

// Placeholder emitted in place of a secret value in API responses and audit
// records. The real value never leaves the store row through this module.
export const TENANT_VARIABLE_SECRET_MASK = "********";

export interface TenantVariableRecord {
  id: string;
  tenantId: string | null;
  name: string;
  value: string;
  isSecret: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TenantVariableResponse {
  id: string;
  tenantId: string | null;
  name: string;
  value: string;
  isSecret: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TenantVariableAuditInput {
  id: string;
  timestamp: string;
  actorUserId: string | null;
  actorType: "user" | "apiClient" | "system";
  tenantId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  result: "success" | "failure";
  error: string | null;
  source: "request" | "schedule" | "remediation";
  correlationId: string | null;
}

export interface TenantVariableAuditRecord extends TenantVariableAuditInput {
  createdAt: string;
}

export interface TenantVariableStore {
  getVariable(variableId: string): Promise<TenantVariableRecord | undefined>;
  listVariables(): Promise<TenantVariableRecord[]>;
  upsertVariable(input: TenantVariableRecord): Promise<TenantVariableRecord>;
  deleteVariable(variableId: string): Promise<boolean>;
  appendAuditEvent(input: TenantVariableAuditInput): Promise<TenantVariableAuditRecord>;
}

export interface TenantVariableCaller extends Caller {
  readonly userId?: string;
}

export type TenantVariableAuthorizer = (
  caller: TenantVariableCaller,
  permission: string,
) => void | Promise<void>;

export interface TenantVariableRequestContext extends RequestContext {
  readonly body?: unknown;
}

export interface TenantVariableRouteOptions {
  readonly store: TenantVariableStore;
  readonly resolveCaller: (ctx: RequestContext) => TenantVariableCaller | undefined;
  readonly authorize?: TenantVariableAuthorizer;
  readonly readBody?: (ctx: TenantVariableRequestContext) => unknown;
  readonly now?: () => string;
}

type JsonObject = Record<string, unknown>;

function validationError(message: string, field?: string): AppError {
  return new AppError(
    ErrorCodes.validationFailed,
    message,
    400,
    field === undefined ? undefined : [{ field, reason: "invalid" }],
  );
}

function notFoundError(variableId: string): AppError {
  return new AppError(
    TENANT_VARIABLE_NOT_FOUND,
    `tenant variable ${variableId} was not found`,
    404,
  );
}

function unauthenticatedError(): AppError {
  return new AppError(TENANT_VARIABLE_UNAUTHENTICATED, "authentication required", 401);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => TenantVariableCaller | undefined,
  ctx: RequestContext,
): TenantVariableCaller {
  const caller = resolveCaller(ctx);
  if (caller === undefined) {
    throw unauthenticatedError();
  }
  return caller;
}

function readJsonObject(
  ctx: TenantVariableRequestContext,
  readBody: (ctx: TenantVariableRequestContext) => unknown,
): JsonObject {
  let body = readBody(ctx);
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      throw validationError("request body is not valid JSON", "body");
    }
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw validationError("request body must be a JSON object", "body");
  }
  return body as JsonObject;
}

function requireVariableId(ctx: RequestContext): string {
  const id = ctx.params["id"];
  if (id === undefined || id.trim().length === 0) {
    throw notFoundError("");
  }
  return id;
}

function parseName(value: unknown): string {
  if (typeof value !== "string" || !isVariableName(value)) {
    throw validationError(
      "name must be a %name% token name (letters, digits, '_', '.', '-')",
      "name",
    );
  }
  return value;
}

function parseValue(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw validationError("value must be a non-empty string", "value");
  }
  return value;
}

function parseTenantId(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError("tenantId must be a non-empty string or null for global scope", "tenantId");
  }
  return value.trim();
}

function parseIsSecret(value: unknown): boolean {
  if (value === undefined) {
    return false;
  }
  if (typeof value !== "boolean") {
    throw validationError("isSecret must be a boolean", "isSecret");
  }
  return value;
}

function toResponse(variable: TenantVariableRecord): TenantVariableResponse {
  return {
    ...variable,
    value: variable.isSecret ? TENANT_VARIABLE_SECRET_MASK : variable.value,
  };
}

function auditSnapshot(variable: TenantVariableRecord): Record<string, unknown> {
  return { ...toResponse(variable) };
}

function variableKey(tenantId: string | null, name: string): string {
  return `${tenantId ?? "global"}:${name}`;
}

async function writeAudit(
  store: TenantVariableStore,
  ctx: RequestContext,
  caller: TenantVariableCaller,
  action: string,
  before: TenantVariableRecord | null,
  after: TenantVariableRecord | null,
  now: () => string,
): Promise<void> {
  const target = after ?? before;
  await store.appendAuditEvent({
    id: randomUUID(),
    timestamp: now(),
    actorUserId: caller.userId ?? null,
    actorType: "user",
    tenantId: target?.tenantId ?? null,
    action,
    targetType: "tenant-variable",
    targetId: target?.id ?? null,
    before: before === null ? null : auditSnapshot(before),
    after: after === null ? null : auditSnapshot(after),
    result: "success",
    error: null,
    source: "request",
    correlationId: ctx.correlationId,
  });
}

export function createTenantVariableRoutes(options: TenantVariableRouteOptions): Route[] {
  const readBody = options.readBody ?? ((ctx) => ctx.body);
  const now = options.now ?? (() => new Date().toISOString());

  const handler =
    (
      fn: (ctx: TenantVariableRequestContext) => Promise<{ status: number; body?: unknown }>,
    ): Route["handler"] =>
    (ctx) =>
      fn(ctx as TenantVariableRequestContext);

  const authorize = async (caller: TenantVariableCaller, permission: string): Promise<void> => {
    if (options.authorize) {
      await options.authorize(caller, permission);
    }
  };

  async function requireExisting(variableId: string): Promise<TenantVariableRecord> {
    const existing = await options.store.getVariable(variableId);
    if (existing === undefined) {
      throw notFoundError(variableId);
    }
    return existing;
  }

  function requireVisible(caller: TenantVariableCaller, variable: TenantVariableRecord): void {
    if (variable.tenantId !== null && !isTenantAllowed(caller.tenantScope, variable.tenantId)) {
      throw notFoundError(variable.id);
    }
  }

  async function assertNameUnique(
    tenantId: string | null,
    name: string,
    ignoreId?: string,
  ): Promise<void> {
    const rows = await options.store.listVariables();
    const clash = rows.find(
      (row) => row.id !== ignoreId && variableKey(row.tenantId, row.name) === variableKey(tenantId, name),
    );
    if (clash !== undefined) {
      throw new AppError(
        TENANT_VARIABLE_CONFLICT,
        `tenant variable '${name}' already exists in this scope`,
        409,
      );
    }
  }

  return [
    {
      method: "GET",
      path: TENANT_VARIABLES_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, TENANT_VARIABLE_PERMISSIONS.read);
        const requestedTenantId = ctx.query.get("tenantId");
        const includeGlobal = ctx.query.get("includeGlobal") !== "false";
        if (requestedTenantId !== null && requestedTenantId.length > 0) {
          requireTenantInScope(caller, requestedTenantId);
        }
        const rows = (await options.store.listVariables())
          .filter((row) => {
            if (row.tenantId === null) {
              return includeGlobal;
            }
            if (!isTenantAllowed(caller.tenantScope, row.tenantId)) return false;
            if (requestedTenantId !== null && requestedTenantId.length > 0) {
              return row.tenantId === requestedTenantId;
            }
            return true;
          })
          .sort((left, right) =>
            variableKey(left.tenantId, left.name).localeCompare(variableKey(right.tenantId, right.name)),
          );
        const page = paginate(
          rows.map((row) => toResponse(row)),
          parsePagination(ctx.query),
        );
        return { status: 200, body: { items: page.items, nextCursor: page.nextCursor } };
      }),
    },
    {
      method: "POST",
      path: TENANT_VARIABLES_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, TENANT_VARIABLE_PERMISSIONS.write);
        const body = readJsonObject(ctx, readBody);
        const name = parseName(body["name"]);
        const value = parseValue(body["value"]);
        const tenantId = parseTenantId(body["tenantId"]);
        const isSecret = parseIsSecret(body["isSecret"]);
        if (tenantId !== null) {
          requireTenantInScope(caller, tenantId);
        }
        const rawId = body["id"];
        let id: string;
        if (rawId === undefined || rawId === null) {
          id = randomUUID();
        } else if (typeof rawId === "string" && rawId.trim().length > 0) {
          id = rawId.trim();
        } else {
          throw validationError("id must be a non-empty string", "id");
        }
        const prior = await options.store.getVariable(id);
        if (prior !== undefined) {
          throw new AppError(TENANT_VARIABLE_CONFLICT, `tenant variable ${id} already exists`, 409);
        }
        await assertNameUnique(tenantId, name);
        const instant = now();
        const created = await options.store.upsertVariable({
          id,
          tenantId,
          name,
          value,
          isSecret,
          createdAt: instant,
          updatedAt: instant,
        });
        await writeAudit(options.store, ctx, caller, "tenant-variable.create", null, created, now);
        return { status: 201, body: toResponse(created) };
      }),
    },
    {
      method: "GET",
      path: TENANT_VARIABLE_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, TENANT_VARIABLE_PERMISSIONS.read);
        const existing = await requireExisting(requireVariableId(ctx));
        requireVisible(caller, existing);
        return { status: 200, body: toResponse(existing) };
      }),
    },
    {
      method: "PATCH",
      path: TENANT_VARIABLE_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, TENANT_VARIABLE_PERMISSIONS.write);
        const variableId = requireVariableId(ctx);
        const body = readJsonObject(ctx, readBody);
        for (const key of Object.keys(body)) {
          if (key !== "name" && key !== "value" && key !== "isSecret") {
            throw validationError(`unknown field '${key}'`, key);
          }
        }
        const existing = await requireExisting(variableId);
        if (existing.tenantId !== null) {
          requireTenantInScope(caller, existing.tenantId);
        }
        const next: TenantVariableRecord = { ...existing };
        if (body["name"] !== undefined) {
          next.name = parseName(body["name"]);
        }
        if (body["value"] !== undefined) {
          next.value = parseValue(body["value"]);
        }
        if (body["isSecret"] !== undefined) {
          if (typeof body["isSecret"] !== "boolean") {
            throw validationError("isSecret must be a boolean", "isSecret");
          }
          next.isSecret = body["isSecret"];
        }
        if (next.name !== existing.name) {
          await assertNameUnique(existing.tenantId, next.name, existing.id);
        }
        next.updatedAt = now();
        const updated = await options.store.upsertVariable(next);
        await writeAudit(options.store, ctx, caller, "tenant-variable.update", existing, updated, now);
        return { status: 200, body: toResponse(updated) };
      }),
    },
    {
      method: "DELETE",
      path: TENANT_VARIABLE_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, TENANT_VARIABLE_PERMISSIONS.write);
        const variableId = requireVariableId(ctx);
        const existing = await requireExisting(variableId);
        if (existing.tenantId !== null) {
          requireTenantInScope(caller, existing.tenantId);
        }
        const removed = await options.store.deleteVariable(variableId);
        if (!removed) {
          throw notFoundError(variableId);
        }
        await writeAudit(options.store, ctx, caller, "tenant-variable.delete", existing, null, now);
        return { status: 204 };
      }),
    },
  ];
}

// Route modules own their OpenAPI path items (portal.v1.yaml `paths` is empty
// by design); a wiring ticket merges this fragment into the served document.
export const TENANT_VARIABLES_OPENAPI = {
  paths: {
    "/tenant-variables": {
      get: {
        operationId: "listTenantVariables",
        summary: "List tenant variables visible to the caller (globals plus in-scope tenants)",
        permission: TENANT_VARIABLE_PERMISSIONS.read,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "tenantId", in: "query", required: false, schema: { type: "string" } },
          { name: "includeGlobal", in: "query", required: false, schema: { type: "boolean" } },
          { name: "cursor", in: "query", required: false, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer" } },
        ],
        responses: {
          "200": { description: "Cursor-paginated variables; secret values are masked." },
          "401": { description: "Authentication required." },
          "403": { description: "Tenant is outside the caller scope." },
        },
      },
      post: {
        operationId: "createTenantVariable",
        summary: "Create a global or tenant-scoped variable",
        permission: TENANT_VARIABLE_PERMISSIONS.write,
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TenantVariableCreate" },
            },
          },
        },
        responses: {
          "201": { description: "The created variable; secret values are masked." },
          "400": { description: "Validation failed." },
          "401": { description: "Authentication required." },
          "403": { description: "Tenant is outside the caller scope." },
          "409": { description: "A variable with this id or name already exists in this scope." },
        },
      },
    },
    "/tenant-variables/{id}": {
      get: {
        operationId: "getTenantVariable",
        summary: "Tenant variable detail",
        permission: TENANT_VARIABLE_PERMISSIONS.read,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "The variable; secret values are masked." },
          "401": { description: "Authentication required." },
          "404": { description: "Variable not found." },
        },
      },
      patch: {
        operationId: "updateTenantVariable",
        summary: "Rename a variable or replace its value/secrecy",
        permission: TENANT_VARIABLE_PERMISSIONS.write,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TenantVariableUpdate" },
            },
          },
        },
        responses: {
          "200": { description: "The updated variable; secret values are masked." },
          "400": { description: "Validation failed." },
          "401": { description: "Authentication required." },
          "403": { description: "Tenant is outside the caller scope." },
          "404": { description: "Variable not found." },
          "409": { description: "A variable with this name already exists in this scope." },
        },
      },
      delete: {
        operationId: "deleteTenantVariable",
        summary: "Remove a variable",
        permission: TENANT_VARIABLE_PERMISSIONS.write,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "204": { description: "Removed; no body." },
          "401": { description: "Authentication required." },
          "403": { description: "Tenant is outside the caller scope." },
          "404": { description: "Variable not found." },
        },
      },
    },
  },
  schemas: {
    TenantVariable: {
      type: "object",
      required: ["id", "name", "value", "isSecret"],
      properties: {
        id: { type: "string" },
        tenantId: { type: ["string", "null"], description: "Null for global scope." },
        name: { type: "string", description: "Token name without the % delimiters." },
        value: { type: "string", description: "Masked when isSecret is true." },
        isSecret: { type: "boolean" },
        createdAt: { type: "string" },
        updatedAt: { type: "string" },
      },
    },
    TenantVariableCreate: {
      type: "object",
      required: ["name", "value"],
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        value: { type: "string" },
        tenantId: { type: ["string", "null"] },
        isSecret: { type: "boolean" },
      },
    },
    TenantVariableUpdate: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        value: { type: "string" },
        isSecret: { type: "boolean" },
      },
    },
  },
} as const;
