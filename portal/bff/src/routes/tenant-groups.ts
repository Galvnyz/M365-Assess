// Tenant-group CRUD + membership routes (EPIC-002 SPEC.md §3.4 and §6) over a
// repository surface mirroring the T-0021 TenantGroup store. Static groups keep
// explicit membership rows; dynamic groups resolve members from the v1 filter
// language in ../domain/tenant-group-filter (SKU or variable equality only,
// §11.4 resolved) and expose a Preview members result. Stored membership is
// always intersected with the caller's RBAC scope and membership writes require
// the tenant in scope (T-0013 helpers); every mutation appends an AuditEvent
// (03-database.md §6). The OpenAPI fragment is published here so
// `portal.v1.yaml` stays untouched (EPIC-001 SPEC §1).
import { randomUUID } from "node:crypto";
import { AppError, ErrorCodes } from "../errors.js";
import {
  TenantGroupFilterError,
  parseTenantGroupFilter,
  resolveTenantGroupMembers,
  summarizeTenantGroupFilter,
  type FilterTenantSnapshot,
  type TenantGroupFilter,
} from "../domain/tenant-group-filter.js";
import { paginate, parsePagination } from "../pagination.js";
import {
  requireTenantInScope,
  type Caller,
} from "../rbac/authorize.js";
import { isTenantAllowed } from "../rbac/scope.js";
import type { RequestContext, Route } from "../server.js";

export const TENANT_GROUPS_PATH = "/v1/tenant-groups";
export const TENANT_GROUP_PATH = "/v1/tenant-groups/:id";
export const TENANT_GROUP_MEMBERS_PATH = "/v1/tenant-groups/:id/members";
export const TENANT_GROUP_MEMBER_PATH = "/v1/tenant-groups/:id/members/:tenantId";
export const TENANT_GROUP_PREVIEW_PATH = "/v1/tenant-groups/:id/preview";

export const TENANT_GROUP_PERMISSIONS = {
  read: "Tenant.Administration.Read",
  write: "Tenant.Administration.ReadWrite",
} as const;

export const TENANT_GROUP_NOT_FOUND = "tenant-group.not_found";
export const TENANT_GROUP_CONFLICT = "tenant-group.conflict";
export const TENANT_GROUP_DYNAMIC = "tenant-group.dynamic_group";
export const TENANT_GROUP_MEMBER_NOT_FOUND = "tenant-group.member_not_found";
export const TENANT_NOT_FOUND = "tenant.not_found";

export const TENANT_GROUP_UNAUTHENTICATED = "request.unauthenticated";

export type TenantGroupKind = "static" | "dynamic";

export interface TenantGroupRecord {
  id: string;
  name: string;
  kind: TenantGroupKind;
  filter: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface TenantGroupMembership {
  groupId: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantGroupAuditInput {
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

export interface TenantGroupAuditRecord extends TenantGroupAuditInput {
  createdAt: string;
}

export interface TenantGroupStore {
  listGroups(options?: { includeDeleted?: boolean }): Promise<TenantGroupRecord[]>;
  getGroup(
    groupId: string,
    options?: { includeDeleted?: boolean },
  ): Promise<TenantGroupRecord | undefined>;
  upsertGroup(input: TenantGroupRecord): Promise<TenantGroupRecord>;
  softDeleteGroup(
    groupId: string,
    options?: { now?: string },
  ): Promise<boolean>;
  listMembers(groupId: string): Promise<TenantGroupMembership[]>;
  addMember(input: TenantGroupMembership): Promise<TenantGroupMembership>;
  removeMember(groupId: string, tenantId: string): Promise<boolean>;
  listCandidates(): Promise<FilterTenantSnapshot[]>;
  appendAuditEvent(input: TenantGroupAuditInput): Promise<TenantGroupAuditRecord>;
}

export interface TenantGroupCaller extends Caller {
  readonly userId?: string;
}

export type TenantGroupAuthorizer = (
  caller: TenantGroupCaller,
  permission: string,
) => void | Promise<void>;

export interface TenantGroupRequestContext extends RequestContext {
  readonly body?: unknown;
}

export interface TenantGroupRouteOptions {
  readonly store: TenantGroupStore;
  readonly resolveCaller: (ctx: RequestContext) => TenantGroupCaller | undefined;
  readonly authorize?: TenantGroupAuthorizer;
  readonly readBody?: (ctx: TenantGroupRequestContext) => unknown;
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

function notFoundError(groupId: string): AppError {
  return new AppError(TENANT_GROUP_NOT_FOUND, `tenant group ${groupId} was not found`, 404);
}

function unauthenticatedError(): AppError {
  return new AppError(TENANT_GROUP_UNAUTHENTICATED, "authentication required", 401);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => TenantGroupCaller | undefined,
  ctx: RequestContext,
): TenantGroupCaller {
  const caller = resolveCaller(ctx);
  if (caller === undefined) {
    throw unauthenticatedError();
  }
  return caller;
}

function readJsonObject(ctx: TenantGroupRequestContext, readBody: (ctx: TenantGroupRequestContext) => unknown): JsonObject {
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

function requireGroupId(ctx: RequestContext): string {
  const id = ctx.params["id"];
  if (id === undefined || id.trim().length === 0) {
    throw notFoundError("");
  }
  return id;
}

function parseName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError("name must be a non-empty string", "name");
  }
  return value.trim();
}

function parseKind(value: unknown): TenantGroupKind {
  if (value !== "static" && value !== "dynamic") {
    throw validationError("kind must be 'static' or 'dynamic'", "kind");
  }
  return value;
}

function parseFilterOrThrow(value: unknown): TenantGroupFilter {
  try {
    return parseTenantGroupFilter(value);
  } catch (error) {
    if (error instanceof TenantGroupFilterError) {
      throw new AppError(error.code, error.message, error.status, [
        { field: error.field ?? "filter", reason: "unsupported" },
      ]);
    }
    throw error;
  }
}

function filterSummary(group: TenantGroupRecord): string | null {
  if (group.kind !== "dynamic" || group.filter === null) {
    return null;
  }
  try {
    return summarizeTenantGroupFilter(parseTenantGroupFilter(group.filter));
  } catch {
    return null;
  }
}

function withSummary(group: TenantGroupRecord): TenantGroupRecord & { filterSummary: string | null } {
  return { ...group, filterSummary: filterSummary(group) };
}

function snapshot(value: object): Record<string, unknown> {
  return { ...(value as Record<string, unknown>) };
}

async function writeAudit(
  store: TenantGroupStore,
  ctx: RequestContext,
  caller: TenantGroupCaller,
  tenantId: string | null,
  action: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  now: () => string,
): Promise<void> {
  const instant = now();
  const target = (before ?? after) as Record<string, unknown> | null;
  const targetId =
    target === null
      ? null
      : typeof target["groupId"] === "string"
        ? (target["groupId"] as string)
        : typeof target["id"] === "string"
          ? (target["id"] as string)
          : null;
  await store.appendAuditEvent({
    id: randomUUID(),
    timestamp: instant,
    actorUserId: caller.userId ?? null,
    actorType: "user",
    tenantId,
    action,
    targetType: "tenant-group",
    targetId,
    before,
    after,
    result: "success",
    error: null,
    source: "request",
    correlationId: ctx.correlationId,
  });
}

async function resolveMembers(
  store: TenantGroupStore,
  group: TenantGroupRecord,
): Promise<string[]> {
  if (group.kind === "static") {
    return (await store.listMembers(group.id)).map((member) => member.tenantId);
  }
  if (group.filter === null) {
    throw validationError("dynamic group has no filter", "filter");
  }
  const filter = parseFilterOrThrow(group.filter);
  return resolveTenantGroupMembers(filter, await store.listCandidates());
}

function requireStatic(group: TenantGroupRecord): void {
  if (group.kind !== "static") {
    throw new AppError(
      TENANT_GROUP_DYNAMIC,
      `tenant group ${group.id} is dynamic; membership is resolved from its filter`,
      400,
    );
  }
}

export function createTenantGroupRoutes(options: TenantGroupRouteOptions): Route[] {
  const readBody = options.readBody ?? ((ctx) => ctx.body);
  const now = options.now ?? (() => new Date().toISOString());

  const handler =
    (
      fn: (ctx: TenantGroupRequestContext) => Promise<{ status: number; body?: unknown }>,
    ): Route["handler"] =>
    (ctx) =>
      fn(ctx as TenantGroupRequestContext);

  const authorize = async (caller: TenantGroupCaller, permission: string): Promise<void> => {
    if (options.authorize) {
      await options.authorize(caller, permission);
    }
  };

  async function requireExisting(groupId: string): Promise<TenantGroupRecord> {
    const existing = await options.store.getGroup(groupId);
    if (existing === undefined || existing.deletedAt !== null) {
      throw notFoundError(groupId);
    }
    return existing;
  }

  return [
    {
      method: "GET",
      path: TENANT_GROUPS_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, TENANT_GROUP_PERMISSIONS.read);
        const groups = (await options.store.listGroups()).filter(
          (group) => group.deletedAt === null,
        );
        const page = paginate(
          groups.map((group) => withSummary(group)),
          parsePagination(ctx.query),
        );
        return { status: 200, body: { items: page.items, nextCursor: page.nextCursor } };
      }),
    },
    {
      method: "POST",
      path: TENANT_GROUPS_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, TENANT_GROUP_PERMISSIONS.write);
        const body = readJsonObject(ctx, readBody);
        const name = parseName(body["name"]);
        const kind = parseKind(body["kind"]);
        let filter: Record<string, unknown> | null = null;
        if (kind === "dynamic") {
          if (body["filter"] === undefined || body["filter"] === null) {
            throw validationError("dynamic group requires a filter", "filter");
          }
          parseFilterOrThrow(body["filter"]);
          filter = { ...(body["filter"] as Record<string, unknown>) };
        } else if (body["filter"] !== undefined && body["filter"] !== null) {
          throw validationError("static group must not carry a filter", "filter");
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
        const prior = await options.store.getGroup(id, { includeDeleted: true });
        if (prior !== undefined && prior.deletedAt === null) {
          throw new AppError(TENANT_GROUP_CONFLICT, `tenant group ${id} already exists`, 409);
        }
        const instant = now();
        const created = await options.store.upsertGroup({
          id,
          name,
          kind,
          filter,
          createdAt: prior?.createdAt ?? instant,
          updatedAt: instant,
          deletedAt: null,
        });
        await writeAudit(options.store, ctx, caller, null, "tenant-group.create", prior ? snapshot(prior) : null, snapshot(created), now);
        return { status: 201, body: withSummary(created) };
      }),
    },
    {
      method: "GET",
      path: TENANT_GROUP_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, TENANT_GROUP_PERMISSIONS.read);
        return { status: 200, body: withSummary(await requireExisting(requireGroupId(ctx))) };
      }),
    },
    {
      method: "PATCH",
      path: TENANT_GROUP_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, TENANT_GROUP_PERMISSIONS.write);
        const groupId = requireGroupId(ctx);
        const body = readJsonObject(ctx, readBody);
        for (const key of Object.keys(body)) {
          if (key !== "name" && key !== "filter") {
            throw validationError(`unknown field '${key}'`, key);
          }
        }
        const existing = await requireExisting(groupId);
        const next: TenantGroupRecord = { ...existing };
        if (body["name"] !== undefined) {
          next.name = parseName(body["name"]);
        }
        if (body["filter"] !== undefined) {
          if (existing.kind !== "dynamic") {
            throw validationError("static group must not carry a filter", "filter");
          }
          if (body["filter"] === null) {
            throw validationError("dynamic group requires a filter", "filter");
          }
          parseFilterOrThrow(body["filter"]);
          next.filter = { ...(body["filter"] as Record<string, unknown>) };
        }
        next.updatedAt = now();
        const updated = await options.store.upsertGroup(next);
        await writeAudit(options.store, ctx, caller, null, "tenant-group.update", snapshot(existing), snapshot(updated), now);
        return { status: 200, body: withSummary(updated) };
      }),
    },
    {
      method: "DELETE",
      path: TENANT_GROUP_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, TENANT_GROUP_PERMISSIONS.write);
        const groupId = requireGroupId(ctx);
        const existing = await requireExisting(groupId);
        const removed = await options.store.softDeleteGroup(groupId, { now: now() });
        if (!removed) {
          throw notFoundError(groupId);
        }
        const after = await options.store.getGroup(groupId, { includeDeleted: true });
        await writeAudit(
          options.store,
          ctx,
          caller,
          null,
          "tenant-group.delete",
          snapshot(existing),
          snapshot(after ?? { ...existing, deletedAt: now() }),
          now,
        );
        return { status: 204 };
      }),
    },
    {
      method: "GET",
      path: TENANT_GROUP_MEMBERS_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, TENANT_GROUP_PERMISSIONS.read);
        const group = await requireExisting(requireGroupId(ctx));
        const members = (await resolveMembers(options.store, group)).filter((tenantId) =>
          isTenantAllowed(caller.tenantScope, tenantId),
        );
        const page = paginate(members, parsePagination(ctx.query));
        return { status: 200, body: { items: page.items, nextCursor: page.nextCursor } };
      }),
    },
    {
      method: "POST",
      path: TENANT_GROUP_MEMBERS_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, TENANT_GROUP_PERMISSIONS.write);
        const group = await requireExisting(requireGroupId(ctx));
        requireStatic(group);
        const body = readJsonObject(ctx, readBody);
        const tenantId = body["tenantId"];
        if (typeof tenantId !== "string" || tenantId.trim().length === 0) {
          throw validationError("tenantId must be a non-empty string", "tenantId");
        }
        const trimmed = tenantId.trim();
        requireTenantInScope(caller, trimmed);
        const known = await options.store.listCandidates();
        if (!known.some((candidate) => candidate.id === trimmed)) {
          throw new AppError(TENANT_NOT_FOUND, `tenant ${trimmed} was not found`, 404);
        }
        const already = (await options.store.listMembers(group.id)).some(
          (member) => member.tenantId === trimmed,
        );
        if (already) {
          return { status: 200, body: { groupId: group.id, tenantId: trimmed } };
        }
        const instant = now();
        const added = await options.store.addMember({
          groupId: group.id,
          tenantId: trimmed,
          createdAt: instant,
          updatedAt: instant,
        });
        await writeAudit(options.store, ctx, caller, trimmed, "tenant-group.member.add", null, snapshot({ ...added }), now);
        return { status: 201, body: added };
      }),
    },
    {
      method: "DELETE",
      path: TENANT_GROUP_MEMBER_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, TENANT_GROUP_PERMISSIONS.write);
        const group = await requireExisting(requireGroupId(ctx));
        requireStatic(group);
        const tenantId = ctx.params["tenantId"];
        if (tenantId === undefined || tenantId.trim().length === 0) {
          throw new AppError(TENANT_GROUP_MEMBER_NOT_FOUND, "group membership was not found", 404);
        }
        const trimmed = tenantId.trim();
        requireTenantInScope(caller, trimmed);
        const members = await options.store.listMembers(group.id);
        const existing = members.find((member) => member.tenantId === trimmed);
        if (existing === undefined) {
          throw new AppError(TENANT_GROUP_MEMBER_NOT_FOUND, "group membership was not found", 404);
        }
        const removed = await options.store.removeMember(group.id, trimmed);
        if (!removed) {
          throw new AppError(TENANT_GROUP_MEMBER_NOT_FOUND, "group membership was not found", 404);
        }
        await writeAudit(options.store, ctx, caller, trimmed, "tenant-group.member.remove", snapshot({ ...existing }), null, now);
        return { status: 204 };
      }),
    },
    {
      method: "GET",
      path: TENANT_GROUP_PREVIEW_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, TENANT_GROUP_PERMISSIONS.read);
        const group = await requireExisting(requireGroupId(ctx));
        const members = (await resolveMembers(options.store, group)).filter((tenantId) =>
          isTenantAllowed(caller.tenantScope, tenantId),
        );
        return { status: 200, body: { items: members, total: members.length } };
      }),
    },
  ];
}

// Route modules own their OpenAPI path items (portal.v1.yaml `paths` is empty
// by design); a wiring ticket merges this fragment into the served document.
export const TENANT_GROUPS_OPENAPI = {
  paths: {
    "/tenant-groups": {
      get: {
        operationId: "listTenantGroups",
        summary: "List tenant groups",
        permission: TENANT_GROUP_PERMISSIONS.read,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "cursor", in: "query", required: false, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer" } },
        ],
        responses: {
          "200": { description: "Cursor-paginated tenant groups with filter summaries." },
          "401": { description: "Authentication required." },
        },
      },
      post: {
        operationId: "createTenantGroup",
        summary: "Create a static or dynamic tenant group",
        permission: TENANT_GROUP_PERMISSIONS.write,
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TenantGroupCreate" },
            },
          },
        },
        responses: {
          "201": { description: "The created group." },
          "400": { description: "Validation failed, or the dynamic filter is unsupported." },
          "401": { description: "Authentication required." },
          "409": { description: "A group with this id already exists." },
        },
      },
    },
    "/tenant-groups/{id}": {
      get: {
        operationId: "getTenantGroup",
        summary: "Tenant group detail",
        permission: TENANT_GROUP_PERMISSIONS.read,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "The group." },
          "401": { description: "Authentication required." },
          "404": { description: "Group not found." },
        },
      },
      patch: {
        operationId: "updateTenantGroup",
        summary: "Rename a group or replace a dynamic filter",
        permission: TENANT_GROUP_PERMISSIONS.write,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TenantGroupUpdate" },
            },
          },
        },
        responses: {
          "200": { description: "The updated group." },
          "400": { description: "Validation failed, or the dynamic filter is unsupported." },
          "401": { description: "Authentication required." },
          "404": { description: "Group not found." },
        },
      },
      delete: {
        operationId: "deleteTenantGroup",
        summary: "Remove a group (soft delete)",
        permission: TENANT_GROUP_PERMISSIONS.write,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "204": { description: "Soft-deleted; no body." },
          "401": { description: "Authentication required." },
          "404": { description: "Group not found." },
        },
      },
    },
    "/tenant-groups/{id}/members": {
      get: {
        operationId: "listTenantGroupMembers",
        summary: "Group members (static rows, or resolved filter for dynamic groups)",
        permission: TENANT_GROUP_PERMISSIONS.read,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "cursor", in: "query", required: false, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer" } },
        ],
        responses: {
          "200": { description: "Member tenant ids intersected with the caller scope." },
          "401": { description: "Authentication required." },
          "404": { description: "Group not found." },
        },
      },
      post: {
        operationId: "addTenantGroupMember",
        summary: "Add a tenant to a static group",
        permission: TENANT_GROUP_PERMISSIONS.write,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TenantGroupMemberCreate" },
            },
          },
        },
        responses: {
          "201": { description: "The created membership." },
          "400": { description: "Validation failed, or the group is dynamic." },
          "401": { description: "Authentication required." },
          "403": { description: "Tenant is outside the caller scope." },
          "404": { description: "Group or tenant not found." },
        },
      },
    },
    "/tenant-groups/{id}/members/{tenantId}": {
      delete: {
        operationId: "removeTenantGroupMember",
        summary: "Remove a tenant from a static group",
        permission: TENANT_GROUP_PERMISSIONS.write,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "tenantId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "204": { description: "Removed; no body." },
          "400": { description: "The group is dynamic." },
          "401": { description: "Authentication required." },
          "403": { description: "Tenant is outside the caller scope." },
          "404": { description: "Group or membership not found." },
        },
      },
    },
    "/tenant-groups/{id}/preview": {
      get: {
        operationId: "previewTenantGroupMembers",
        summary: "Preview members (resolves the dynamic filter)",
        permission: TENANT_GROUP_PERMISSIONS.read,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Resolved member tenant ids intersected with the caller scope." },
          "401": { description: "Authentication required." },
          "404": { description: "Group not found." },
        },
      },
    },
  },
  schemas: {
    TenantGroup: {
      type: "object",
      required: ["id", "name", "kind"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        kind: { type: "string", enum: ["static", "dynamic"] },
        filter: { type: ["object", "null"] },
        filterSummary: { type: ["string", "null"] },
        createdAt: { type: "string" },
        updatedAt: { type: "string" },
        deletedAt: { type: ["string", "null"] },
      },
    },
    TenantGroupCreate: {
      type: "object",
      required: ["name", "kind"],
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        kind: { type: "string", enum: ["static", "dynamic"] },
        filter: { type: "object" },
      },
    },
    TenantGroupUpdate: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        filter: { type: "object" },
      },
    },
    TenantGroupMemberCreate: {
      type: "object",
      required: ["tenantId"],
      additionalProperties: false,
      properties: {
        tenantId: { type: "string" },
      },
    },
  },
} as const;
