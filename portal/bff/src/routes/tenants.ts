// Tenant CRUD routes (EPIC-002 SPEC.md §6) over the T-0021 repository surface.
// Reads filter by status/source/group; PATCH covers edit, exclude/include, and
// connect-failure accounting; DELETE is a soft delete. Every read and write is
// intersected against the caller's RBAC scope with the T-0013 helpers, so a
// tenant outside the scope yields a structured 403 and is never widened. Every
// mutation appends an AuditEvent (03-database.md §6). The OpenAPI fragment is
// published here so `portal.v1.yaml` stays untouched (EPIC-001 SPEC §1).
import { randomUUID } from "node:crypto";
import { AppError, ErrorCodes } from "../errors.js";
import { paginate, parsePagination } from "../pagination.js";
import {
  requireTenantInScope,
  type Caller,
} from "../rbac/authorize.js";
import { isTenantAllowed } from "../rbac/scope.js";
import type { RequestContext, Route } from "../server.js";

export const TENANTS_PATH = "/v1/tenants";
export const TENANT_PATH = "/v1/tenants/:id";

export const TENANT_PERMISSIONS = {
  read: "Tenant.Administration.Read",
  write: "Tenant.Administration.ReadWrite",
} as const;

export const TENANT_NOT_FOUND = "tenant.not_found";
export const TENANT_CONFLICT = "tenant.conflict";

export const TENANT_UNAUTHENTICATED = "request.unauthenticated";

// SPEC §4.4 leaves the failure count that flips `status` to `error` to the
// route layer; three consecutive failures is the fleet default.
export const DEFAULT_TENANT_ERROR_THRESHOLD = 3;

export type TenantSource = "direct" | "gdap";
export type TenantStatus = "active" | "excluded" | "error";

export interface TenantRecord {
  id: string;
  displayName: string | null;
  defaultDomain: string | null;
  initialDomain: string | null;
  source: TenantSource;
  status: TenantStatus;
  excluded: boolean;
  excludeReason: string | null;
  excludeDate: string | null;
  environment: string;
  lastRunAt: string | null;
  errorCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface TenantAuditInput {
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

export interface TenantAuditRecord extends TenantAuditInput {
  createdAt: string;
}

export interface TenantListOptions {
  status?: TenantStatus;
  source?: TenantSource;
  groupId?: string;
  search?: string;
  includeDeleted?: boolean;
}

export interface TenantCreateInput {
  id: string;
  displayName?: string | null;
  defaultDomain?: string | null;
  initialDomain?: string | null;
  source?: TenantSource;
  environment?: string;
}

export interface TenantStore {
  listTenants(options?: TenantListOptions): Promise<TenantRecord[]>;
  getTenant(
    tenantId: string,
    options?: { includeDeleted?: boolean },
  ): Promise<TenantRecord | undefined>;
  upsertTenant(input: TenantRecord): Promise<TenantRecord>;
  softDeleteTenant(
    tenantId: string,
    options?: { now?: string },
  ): Promise<boolean>;
  appendAuditEvent(input: TenantAuditInput): Promise<TenantAuditRecord>;
}

export interface TenantCaller extends Caller {
  readonly userId?: string;
}

export type TenantAuthorizer = (
  caller: TenantCaller,
  permission: string,
) => void | Promise<void>;

export interface TenantRequestContext extends RequestContext {
  readonly body?: unknown;
}

export interface TenantRouteOptions {
  readonly store: TenantStore;
  readonly resolveCaller: (ctx: RequestContext) => TenantCaller | undefined;
  readonly authorize?: TenantAuthorizer;
  readonly readBody?: (ctx: TenantRequestContext) => unknown;
  readonly now?: () => string;
  readonly errorThreshold?: number;
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

function notFoundError(tenantId: string): AppError {
  return new AppError(TENANT_NOT_FOUND, `tenant ${tenantId} was not found`, 404);
}

function unauthenticatedError(): AppError {
  return new AppError(TENANT_UNAUTHENTICATED, "authentication required", 401);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => TenantCaller | undefined,
  ctx: RequestContext,
): TenantCaller {
  const caller = resolveCaller(ctx);
  if (caller === undefined) {
    throw unauthenticatedError();
  }
  return caller;
}

function readJsonObject(ctx: TenantRequestContext, readBody: (ctx: TenantRequestContext) => unknown): JsonObject {
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

function requireTenantId(ctx: RequestContext): string {
  const id = ctx.params["id"];
  if (id === undefined || id.trim().length === 0) {
    throw notFoundError("");
  }
  return id;
}

const TENANT_SOURCES: readonly string[] = ["direct", "gdap"];
const TENANT_STATUSES: readonly string[] = ["active", "excluded", "error"];

function parseOptionalText(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw validationError(`${field} must be a string`, field);
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parseRequiredId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError("id must be a non-empty string", "id");
  }
  return value.trim();
}

function parseSource(value: unknown): TenantSource | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !TENANT_SOURCES.includes(value)) {
    throw validationError("source must be 'direct' or 'gdap'", "source");
  }
  return value as TenantSource;
}

function parseStatusFilter(value: string | null): TenantStatus | undefined {
  if (value === null || value.length === 0) return undefined;
  if (!TENANT_STATUSES.includes(value)) {
    throw validationError("status must be 'active', 'excluded', or 'error'", "status");
  }
  return value as TenantStatus;
}

function parseSourceFilter(value: string | null): TenantSource | undefined {
  if (value === null || value.length === 0) return undefined;
  if (!TENANT_SOURCES.includes(value)) {
    throw validationError("source must be 'direct' or 'gdap'", "source");
  }
  return value as TenantSource;
}

function snapshot(tenant: TenantRecord): Record<string, unknown> {
  return { ...tenant };
}

async function writeAudit(
  store: TenantStore,
  ctx: RequestContext,
  caller: TenantCaller,
  tenantId: string,
  action: string,
  before: TenantRecord | null,
  after: TenantRecord | null,
  now: () => string,
): Promise<void> {
  const instant = now();
  await store.appendAuditEvent({
    id: randomUUID(),
    timestamp: instant,
    actorUserId: caller.userId ?? null,
    actorType: "user",
    tenantId,
    action,
    targetType: "tenant",
    targetId: tenantId,
    before: before === null ? null : snapshot(before),
    after: after === null ? null : snapshot(after),
    result: "success",
    error: null,
    source: "request",
    correlationId: ctx.correlationId,
  });
}

const PATCH_FIELDS: readonly string[] = [
  "displayName",
  "defaultDomain",
  "initialDomain",
  "environment",
  "source",
  "excluded",
  "excludeReason",
  "recordConnectFailure",
  "recordConnectSuccess",
  "lastError",
];

export function createTenantRoutes(options: TenantRouteOptions): Route[] {
  const readBody = options.readBody ?? ((ctx) => ctx.body);
  const now = options.now ?? (() => new Date().toISOString());
  const errorThreshold = options.errorThreshold ?? DEFAULT_TENANT_ERROR_THRESHOLD;

  const handler =
    (
      fn: (ctx: TenantRequestContext) => Promise<{ status: number; body?: unknown }>,
    ): Route["handler"] =>
    (ctx) =>
      fn(ctx as TenantRequestContext);

  const authorize = async (caller: TenantCaller, permission: string): Promise<void> => {
    if (options.authorize) {
      await options.authorize(caller, permission);
    }
  };

  async function requireExisting(tenantId: string): Promise<TenantRecord> {
    const existing = await options.store.getTenant(tenantId);
    if (existing === undefined || existing.deletedAt !== null) {
      throw notFoundError(tenantId);
    }
    return existing;
  }

  return [
    {
      method: "GET",
      path: TENANTS_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, TENANT_PERMISSIONS.read);
        const status = parseStatusFilter(ctx.query.get("status"));
        const source = parseSourceFilter(ctx.query.get("source"));
        const groupId = ctx.query.get("groupId") ?? ctx.query.get("group") ?? undefined;
        const search = ctx.query.get("search") ?? undefined;
        const listed = await options.store.listTenants({
          status,
          source,
          groupId: groupId !== undefined && groupId.length > 0 ? groupId : undefined,
          search: search !== undefined && search.length > 0 ? search : undefined,
        });
        const visible = listed.filter(
          (tenant) => tenant.deletedAt === null && isTenantAllowed(caller.tenantScope, tenant.id),
        );
        const page = paginate(visible, parsePagination(ctx.query));
        return { status: 200, body: { items: page.items, nextCursor: page.nextCursor } };
      }),
    },
    {
      method: "POST",
      path: TENANTS_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, TENANT_PERMISSIONS.write);
        const body = readJsonObject(ctx, readBody);
        const id = parseRequiredId(body["id"]);
        requireTenantInScope(caller, id);
        const prior = await options.store.getTenant(id, { includeDeleted: true });
        if (prior !== undefined && prior.deletedAt === null) {
          throw new AppError(TENANT_CONFLICT, `tenant ${id} already exists`, 409);
        }
        const instant = now();
        const created = await options.store.upsertTenant({
          id,
          displayName: parseOptionalText(body["displayName"], "displayName") ?? null,
          defaultDomain: parseOptionalText(body["defaultDomain"], "defaultDomain") ?? null,
          initialDomain: parseOptionalText(body["initialDomain"], "initialDomain") ?? null,
          source: parseSource(body["source"]) ?? "direct",
          status: "active",
          excluded: false,
          excludeReason: null,
          excludeDate: null,
          environment: parseOptionalText(body["environment"], "environment") ?? "global",
          lastRunAt: null,
          errorCount: 0,
          lastError: null,
          createdAt: prior?.createdAt ?? instant,
          updatedAt: instant,
          deletedAt: null,
        });
        await writeAudit(options.store, ctx, caller, id, "tenant.create", prior ?? null, created, now);
        return { status: 201, body: created };
      }),
    },
    {
      method: "GET",
      path: TENANT_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, TENANT_PERMISSIONS.read);
        const tenantId = requireTenantId(ctx);
        requireTenantInScope(caller, tenantId);
        return { status: 200, body: await requireExisting(tenantId) };
      }),
    },
    {
      method: "PATCH",
      path: TENANT_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, TENANT_PERMISSIONS.write);
        const tenantId = requireTenantId(ctx);
        requireTenantInScope(caller, tenantId);
        const body = readJsonObject(ctx, readBody);
        for (const key of Object.keys(body)) {
          if (!PATCH_FIELDS.includes(key)) {
            throw validationError(`unknown field '${key}'`, key);
          }
        }
        const existing = await requireExisting(tenantId);
        const failure = body["recordConnectFailure"] === true;
        const success = body["recordConnectSuccess"] === true;
        if (failure && success) {
          throw validationError(
            "recordConnectFailure and recordConnectSuccess are mutually exclusive",
            "recordConnectFailure",
          );
        }
        if (success && body["lastError"] !== undefined) {
          throw validationError("lastError is only valid with recordConnectFailure", "lastError");
        }

        const next: TenantRecord = { ...existing };
        if (body["displayName"] !== undefined) {
          next.displayName = parseOptionalText(body["displayName"], "displayName") ?? null;
        }
        if (body["defaultDomain"] !== undefined) {
          next.defaultDomain = parseOptionalText(body["defaultDomain"], "defaultDomain") ?? null;
        }
        if (body["initialDomain"] !== undefined) {
          next.initialDomain = parseOptionalText(body["initialDomain"], "initialDomain") ?? null;
        }
        if (body["environment"] !== undefined) {
          next.environment = parseOptionalText(body["environment"], "environment") ?? "global";
        }
        if (body["source"] !== undefined) {
          next.source = parseSource(body["source"]) ?? next.source;
        }

        let action = "tenant.update";
        if (failure) {
          next.errorCount = existing.errorCount + 1;
          const message =
            body["lastError"] === undefined
              ? (existing.lastError ?? "connect failed")
              : parseOptionalText(body["lastError"], "lastError") ?? "connect failed";
          next.lastError = message;
          if (next.errorCount >= errorThreshold && !next.excluded) {
            next.status = "error";
          }
          action = "tenant.connect-failure";
        } else if (success) {
          next.errorCount = 0;
          next.lastError = null;
          if (!next.excluded) {
            next.status = "active";
          }
          action = "tenant.connect-success";
        }

        if (body["excluded"] !== undefined) {
          if (typeof body["excluded"] !== "boolean") {
            throw validationError("excluded must be a boolean", "excluded");
          }
          const instant = now();
          if (body["excluded"] === true) {
            next.excluded = true;
            next.excludeReason =
              body["excludeReason"] === undefined
                ? (existing.excludeReason ?? null)
                : (parseOptionalText(body["excludeReason"], "excludeReason") ?? null);
            next.excludeDate = instant;
            next.status = "excluded";
            action = "tenant.exclude";
          } else {
            next.excluded = false;
            next.excludeReason = null;
            next.excludeDate = null;
            next.status = next.errorCount >= errorThreshold ? "error" : "active";
            action = "tenant.include";
          }
        } else if (body["excludeReason"] !== undefined) {
          if (!next.excluded) {
            throw validationError("excludeReason requires excluded: true", "excludeReason");
          }
          next.excludeReason = parseOptionalText(body["excludeReason"], "excludeReason") ?? null;
        }

        next.updatedAt = now();
        const updated = await options.store.upsertTenant(next);
        await writeAudit(options.store, ctx, caller, tenantId, action, existing, updated, now);
        return { status: 200, body: updated };
      }),
    },
    {
      method: "DELETE",
      path: TENANT_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, TENANT_PERMISSIONS.write);
        const tenantId = requireTenantId(ctx);
        requireTenantInScope(caller, tenantId);
        const existing = await requireExisting(tenantId);
        const removed = await options.store.softDeleteTenant(tenantId, { now: now() });
        if (!removed) {
          throw notFoundError(tenantId);
        }
        const after = await options.store.getTenant(tenantId, { includeDeleted: true });
        await writeAudit(
          options.store,
          ctx,
          caller,
          tenantId,
          "tenant.delete",
          existing,
          after ?? { ...existing, deletedAt: now() },
          now,
        );
        return { status: 204 };
      }),
    },
  ];
}

// Route modules own their OpenAPI path items (portal.v1.yaml `paths` is empty
// by design); a wiring ticket merges this fragment into the served document.
export const TENANTS_OPENAPI = {
  paths: {
    "/tenants": {
      get: {
        operationId: "listTenants",
        summary: "List tenants visible to the caller (filter: status/source/group)",
        permission: TENANT_PERMISSIONS.read,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "status", in: "query", required: false, schema: { type: "string", enum: ["active", "excluded", "error"] } },
          { name: "source", in: "query", required: false, schema: { type: "string", enum: ["direct", "gdap"] } },
          { name: "groupId", in: "query", required: false, schema: { type: "string" } },
          { name: "search", in: "query", required: false, schema: { type: "string" } },
          { name: "cursor", in: "query", required: false, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer" } },
        ],
        responses: {
          "200": { description: "Cursor-paginated tenants intersected with the caller scope." },
          "400": { description: "An unsupported filter value was supplied." },
          "401": { description: "Authentication required." },
        },
      },
      post: {
        operationId: "createTenant",
        summary: "Add a tenant directly",
        permission: TENANT_PERMISSIONS.write,
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TenantCreate" },
            },
          },
        },
        responses: {
          "201": { description: "The created tenant." },
          "400": { description: "Validation failed." },
          "401": { description: "Authentication required." },
          "403": { description: "Tenant is outside the caller scope." },
          "409": { description: "A tenant with this id already exists." },
        },
      },
    },
    "/tenants/{id}": {
      get: {
        operationId: "getTenant",
        summary: "Tenant detail",
        permission: TENANT_PERMISSIONS.read,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "The tenant." },
          "401": { description: "Authentication required." },
          "403": { description: "Tenant is outside the caller scope." },
          "404": { description: "Tenant not found." },
        },
      },
      patch: {
        operationId: "updateTenant",
        summary: "Edit, exclude/include, or record a connect result",
        permission: TENANT_PERMISSIONS.write,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TenantUpdate" },
            },
          },
        },
        responses: {
          "200": { description: "The updated tenant." },
          "400": { description: "Validation failed." },
          "401": { description: "Authentication required." },
          "403": { description: "Tenant is outside the caller scope." },
          "404": { description: "Tenant not found." },
        },
      },
      delete: {
        operationId: "deleteTenant",
        summary: "Remove a tenant (soft delete)",
        permission: TENANT_PERMISSIONS.write,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "204": { description: "Soft-deleted; no body." },
          "401": { description: "Authentication required." },
          "403": { description: "Tenant is outside the caller scope." },
          "404": { description: "Tenant not found." },
        },
      },
    },
  },
  schemas: {
    Tenant: {
      type: "object",
      required: ["id", "source", "status", "excluded", "errorCount"],
      properties: {
        id: { type: "string" },
        displayName: { type: ["string", "null"] },
        defaultDomain: { type: ["string", "null"] },
        initialDomain: { type: ["string", "null"] },
        source: { type: "string", enum: ["direct", "gdap"] },
        status: { type: "string", enum: ["active", "excluded", "error"] },
        excluded: { type: "boolean" },
        excludeReason: { type: ["string", "null"] },
        excludeDate: { type: ["string", "null"], format: "date-time" },
        environment: { type: "string" },
        lastRunAt: { type: ["string", "null"] },
        errorCount: { type: "integer", minimum: 0 },
        lastError: { type: ["string", "null"] },
        createdAt: { type: "string" },
        updatedAt: { type: "string" },
        deletedAt: { type: ["string", "null"] },
      },
    },
    TenantCreate: {
      type: "object",
      required: ["id"],
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        displayName: { type: ["string", "null"] },
        defaultDomain: { type: ["string", "null"] },
        initialDomain: { type: ["string", "null"] },
        source: { type: "string", enum: ["direct", "gdap"] },
        environment: { type: "string" },
      },
    },
    TenantUpdate: {
      type: "object",
      additionalProperties: false,
      properties: {
        displayName: { type: ["string", "null"] },
        defaultDomain: { type: ["string", "null"] },
        initialDomain: { type: ["string", "null"] },
        environment: { type: "string" },
        source: { type: "string", enum: ["direct", "gdap"] },
        excluded: { type: "boolean" },
        excludeReason: { type: ["string", "null"] },
        recordConnectFailure: { type: "boolean" },
        recordConnectSuccess: { type: "boolean" },
        lastError: { type: ["string", "null"] },
      },
    },
  },
} as const;
