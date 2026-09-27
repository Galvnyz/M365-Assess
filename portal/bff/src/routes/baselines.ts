// Baseline CRUD, assignment, and save gate (EPIC-010 SPEC.md §4.1, §6, §7; T-0182).
//
//   GET    /v1/baselines                       -> list
//   POST   /v1/baselines                       -> create (save gate enforced)
//   GET    /v1/baselines/:baselineId           -> detail (stages + assignments)
//   PATCH  /v1/baselines/:baselineId           -> update (gate on the merged result)
//   DELETE /v1/baselines/:baselineId           -> delete
//   POST   /v1/baselines/:baselineId/assign    -> replace assignments
//
// Reads require `Tenant.Baselines.Read`; mutations require `Tenant.Baselines.ReadWrite`.
// Assignment reuses the tenants/groups model owned by EPIC-002: a `tenant`
// target must be inside the caller's tenant scope, while `group` and
// `allTenants` targets pass through for EPIC-002's filter resolution.

import { randomUUID } from "node:crypto";
import { AppError, ErrorCodes } from "../errors.js";
import { requirePermission, requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { Permission } from "../rbac/roles.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";
import {
  BASELINE_INVALID_STAGES,
  BASELINE_SAVE_BLOCKED,
  BaselineValidationError,
  validateBaselineInput,
  type BaselineSaveAssignment,
} from "../domain/baseline-validate.js";

export const BASELINES_PATH = "/v1/baselines";
export const BASELINE_DETAIL_PATH = "/v1/baselines/:baselineId";
export const BASELINE_ASSIGN_PATH = "/v1/baselines/:baselineId/assign";

export const BASELINES_PERMISSIONS = {
  read: "Tenant.Baselines.Read",
  write: "Tenant.Baselines.ReadWrite",
} as const;

export const BASELINES_UNAUTHENTICATED = "request.unauthenticated";
export const BASELINE_NOT_FOUND = "baseline.not_found";

export const BASELINE_TARGET_TYPES = ["allTenants", "group", "tenant"] as const;
export type BaselineTargetType = (typeof BASELINE_TARGET_TYPES)[number];

export interface BaselineStageRecord {
  readonly order: number;
  readonly conditions: readonly { key: string; expected: unknown }[];
  readonly action: "report" | "remediate";
}

export interface BaselineRecord {
  readonly id: string;
  readonly name: string;
  readonly logic: "and";
  readonly alerting: { enabled: boolean };
  readonly enabled: boolean;
  readonly stages: readonly BaselineStageRecord[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BaselineAssignmentRecord {
  readonly baselineId: string;
  readonly targetType: BaselineTargetType;
  readonly targetId: string | null;
  readonly precedence: number;
}

export interface CreateBaselineInput {
  readonly id?: string;
  readonly name: string;
  readonly alerting?: { enabled: boolean };
  readonly enabled?: boolean;
  readonly stages?: readonly BaselineStageRecord[];
  readonly assignments?: readonly Omit<BaselineAssignmentRecord, "baselineId">[];
}

export interface UpdateBaselinePatch {
  readonly name?: string;
  readonly alerting?: { enabled: boolean };
  readonly enabled?: boolean;
  readonly stages?: readonly BaselineStageRecord[];
  readonly assignments?: readonly Omit<BaselineAssignmentRecord, "baselineId">[];
}

export interface BaselinesStore {
  listBaselines(): Promise<readonly BaselineRecord[]>;
  getBaseline(baselineId: string): Promise<BaselineRecord | undefined>;
  createBaseline(input: CreateBaselineInput): Promise<BaselineRecord>;
  updateBaseline(baselineId: string, patch: UpdateBaselinePatch): Promise<BaselineRecord | undefined>;
  deleteBaseline(baselineId: string): Promise<boolean>;
  listBaselineAssignments(baselineId: string): Promise<readonly BaselineAssignmentRecord[]>;
  setBaselineAssignments(
    baselineId: string,
    assignments: readonly Omit<BaselineAssignmentRecord, "baselineId">[],
  ): Promise<readonly BaselineAssignmentRecord[]>;
}

export interface BaselinesRouteOptions {
  readonly store: BaselinesStore;
  readonly resolveCaller: (ctx: RequestContext) => Caller | undefined;
  readonly authorize?: (caller: Caller, permission: string) => void | Promise<void>;
  readonly idGenerator?: () => string;
}

export interface BaselinesRequest extends RequestContext {
  readonly body?: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function ensureAuthorized(
  options: BaselinesRouteOptions,
  caller: Caller,
  permission: string,
): Promise<void> {
  if (options.authorize) {
    await options.authorize(caller, permission);
    return;
  }
  // baselines.* is not in the roles.ts union yet (EPIC-038); deny without a seam.
  requirePermission(caller, permission as Permission);
}

function requireCaller(options: BaselinesRouteOptions, ctx: BaselinesRequest): Caller {
  const caller = options.resolveCaller(ctx);
  if (!caller) {
    throw new AppError(BASELINES_UNAUTHENTICATED, "authentication required", 401);
  }
  return caller;
}

function requireParam(ctx: BaselinesRequest, name: string): string {
  const value = ctx.params[name];
  if (!value || value.length === 0) {
    throw new AppError(ErrorCodes.validationFailed, `Missing route parameter '${name}'`, 400, [
      { field: name, reason: "required" },
    ]);
  }
  return value;
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

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new AppError(ErrorCodes.validationFailed, "Request body is not valid JSON", 400, [
      { field: "body", reason: "invalid_json" },
    ]);
  }
}

function toValidationError(error: BaselineValidationError): AppError {
  const status = error.code === BASELINE_SAVE_BLOCKED || error.code === BASELINE_INVALID_STAGES ? 400 : 400;
  return new AppError(
    error.code,
    error.message,
    status,
    error.violations.map((violation) => ({ field: violation.field, reason: violation.reason })),
  );
}

function parseStages(value: unknown): BaselineStageRecord[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new AppError(ErrorCodes.validationFailed, "Field 'stages' must be an array", 400, [
      { field: "stages", reason: "invalid" },
    ]);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new AppError(ErrorCodes.validationFailed, `stages[${index}] must be an object`, 400, [
        { field: `stages[${index}]`, reason: "invalid" },
      ]);
    }
    const record = entry as Record<string, unknown>;
    const order = record["order"];
    if (typeof order !== "number" || !Number.isInteger(order) || order < 0) {
      throw new AppError(ErrorCodes.validationFailed, `stages[${index}].order must be a non-negative integer`, 400, [
        { field: `stages[${index}].order`, reason: "invalid" },
      ]);
    }
    const conditions = record["conditions"] ?? [];
    if (!Array.isArray(conditions)) {
      throw new AppError(ErrorCodes.validationFailed, `stages[${index}].conditions must be an array`, 400, [
        { field: `stages[${index}].conditions`, reason: "invalid" },
      ]);
    }
    const action = record["action"] ?? "report";
    if (action !== "report" && action !== "remediate") {
      throw new AppError(ErrorCodes.validationFailed, `stages[${index}].action must be 'report' or 'remediate'`, 400, [
        { field: `stages[${index}].action`, reason: "invalid" },
      ]);
    }
    return {
      order,
      conditions: conditions.map((condition) => {
        if (typeof condition !== "object" || condition === null) {
          throw new AppError(ErrorCodes.validationFailed, "condition must be an object", 400, [
            { field: `stages[${index}].conditions`, reason: "invalid" },
          ]);
        }
        const item = condition as Record<string, unknown>;
        if (typeof item["key"] !== "string" || (item["key"] as string).length === 0) {
          throw new AppError(ErrorCodes.validationFailed, "condition.key is required", 400, [
            { field: `stages[${index}].conditions`, reason: "required" },
          ]);
        }
        return { key: item["key"] as string, expected: item["expected"] };
      }),
      action,
    };
  });
}

function parseAssignments(value: unknown): Omit<BaselineAssignmentRecord, "baselineId">[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new AppError(ErrorCodes.validationFailed, "Field 'assignments' must be an array", 400, [
      { field: "assignments", reason: "invalid" },
    ]);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new AppError(ErrorCodes.validationFailed, `assignments[${index}] must be an object`, 400, [
        { field: `assignments[${index}]`, reason: "invalid" },
      ]);
    }
    const record = entry as Record<string, unknown>;
    const targetType = record["targetType"];
    if (!(BASELINE_TARGET_TYPES as readonly string[]).includes(targetType as string)) {
      throw new AppError(
        ErrorCodes.validationFailed,
        `assignments[${index}].targetType must be allTenants, group, or tenant`,
        400,
        [{ field: `assignments[${index}].targetType`, reason: "invalid" }],
      );
    }
    const rawTarget = record["targetId"];
    const targetId = rawTarget === undefined || rawTarget === null ? null : String(rawTarget);
    if (targetType !== "allTenants" && !targetId) {
      throw new AppError(
        ErrorCodes.validationFailed,
        `assignments[${index}].targetId is required for ${String(targetType)} targets`,
        400,
        [{ field: `assignments[${index}].targetId`, reason: "required" }],
      );
    }
    const rawPrecedence = record["precedence"] ?? 0;
    const precedence =
      typeof rawPrecedence === "number" && Number.isFinite(rawPrecedence) ? Math.floor(rawPrecedence) : 0;
    return { targetType: targetType as BaselineTargetType, targetId, precedence };
  });
}

/** Tenant targets must be inside the caller's scope; groups resolve via EPIC-002. */
function checkAssignmentScope(
  caller: Caller,
  assignments: readonly Omit<BaselineAssignmentRecord, "baselineId">[],
): void {
  for (const assignment of assignments) {
    if (assignment.targetType === "tenant" && assignment.targetId) {
      requireTenantInScope(caller, assignment.targetId);
    }
  }
}

function toDetail(
  baseline: BaselineRecord,
  assignments: readonly BaselineAssignmentRecord[],
): Record<string, unknown> {
  return { ...baseline, assignments: [...assignments] };
}

// ─── Route factory ────────────────────────────────────────────────────────────

export function createBaselinesRoutes(options: BaselinesRouteOptions): Route[] {
  const generateId = options.idGenerator ?? randomUUID;

  async function handleList(ctx: BaselinesRequest): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, BASELINES_PERMISSIONS.read);
    const items = await options.store.listBaselines();
    return { status: 200, body: { items: [...items] } };
  }

  async function handleCreate(ctx: BaselinesRequest): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, BASELINES_PERMISSIONS.write);
    const body = requireBodyRecord(ctx.body);
    const name = typeof body["name"] === "string" ? (body["name"] as string) : "";
    const stages = parseStages(body["stages"]);
    const assignments = parseAssignments(body["assignments"]);
    checkAssignmentScope(caller, assignments);
    try {
      validateBaselineInput({
        name,
        assignments: assignments as readonly BaselineSaveAssignment[],
        stages,
      });
    } catch (error) {
      if (error instanceof BaselineValidationError) throw toValidationError(error);
      throw error;
    }
    const created = await options.store.createBaseline({
      id: typeof body["id"] === "string" && body["id"] ? (body["id"] as string) : generateId(),
      name: name.trim(),
      alerting:
        typeof body["alerting"] === "object" && body["alerting"] !== null
          ? { enabled: (body["alerting"] as { enabled?: unknown }).enabled === true }
          : undefined,
      enabled: body["enabled"] === undefined ? undefined : body["enabled"] === true,
      stages,
      assignments,
    });
    const rows = await options.store.listBaselineAssignments(created.id);
    return { status: 201, body: toDetail(created, rows) };
  }

  async function handleGet(ctx: BaselinesRequest): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, BASELINES_PERMISSIONS.read);
    const baselineId = requireParam(ctx, "baselineId");
    const baseline = await options.store.getBaseline(baselineId);
    if (!baseline) {
      throw new AppError(BASELINE_NOT_FOUND, `Baseline ${baselineId} not found`, 404);
    }
    const rows = await options.store.listBaselineAssignments(baselineId);
    return { status: 200, body: toDetail(baseline, rows) };
  }

  async function handleUpdate(ctx: BaselinesRequest): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, BASELINES_PERMISSIONS.write);
    const baselineId = requireParam(ctx, "baselineId");
    const existing = await options.store.getBaseline(baselineId);
    if (!existing) {
      throw new AppError(BASELINE_NOT_FOUND, `Baseline ${baselineId} not found`, 404);
    }
    const body = requireBodyRecord(ctx.body);
    const existingAssignments = await options.store.listBaselineAssignments(baselineId);
    const name = typeof body["name"] === "string" ? (body["name"] as string) : existing.name;
    const stages = body["stages"] === undefined ? [...existing.stages] : parseStages(body["stages"]);
    const assignments =
      body["assignments"] === undefined
        ? existingAssignments.map((row) => ({
            targetType: row.targetType,
            targetId: row.targetId,
            precedence: row.precedence,
          }))
        : parseAssignments(body["assignments"]);
    checkAssignmentScope(caller, assignments);
    try {
      validateBaselineInput({
        name,
        assignments: assignments as readonly BaselineSaveAssignment[],
        stages,
      });
    } catch (error) {
      if (error instanceof BaselineValidationError) throw toValidationError(error);
      throw error;
    }
    const updated = await options.store.updateBaseline(baselineId, {
      name: typeof body["name"] === "string" ? (body["name"] as string).trim() : undefined,
      alerting:
        typeof body["alerting"] === "object" && body["alerting"] !== null
          ? { enabled: (body["alerting"] as { enabled?: unknown }).enabled === true }
          : undefined,
      enabled: body["enabled"] === undefined ? undefined : body["enabled"] === true,
      stages: body["stages"] === undefined ? undefined : stages,
      assignments: body["assignments"] === undefined ? undefined : assignments,
    });
    if (!updated) {
      throw new AppError(BASELINE_NOT_FOUND, `Baseline ${baselineId} not found`, 404);
    }
    const rows = await options.store.listBaselineAssignments(baselineId);
    return { status: 200, body: toDetail(updated, rows) };
  }

  async function handleDelete(ctx: BaselinesRequest): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, BASELINES_PERMISSIONS.write);
    const baselineId = requireParam(ctx, "baselineId");
    const deleted = await options.store.deleteBaseline(baselineId);
    if (!deleted) {
      throw new AppError(BASELINE_NOT_FOUND, `Baseline ${baselineId} not found`, 404);
    }
    return { status: 200, body: { id: baselineId, deleted: true } };
  }

  async function handleAssign(ctx: BaselinesRequest): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, BASELINES_PERMISSIONS.write);
    const baselineId = requireParam(ctx, "baselineId");
    const existing = await options.store.getBaseline(baselineId);
    if (!existing) {
      throw new AppError(BASELINE_NOT_FOUND, `Baseline ${baselineId} not found`, 404);
    }
    const body = requireBodyRecord(ctx.body);
    const assignments = parseAssignments(body["assignments"] ?? []);
    checkAssignmentScope(caller, assignments);
    if (assignments.length === 0) {
      throw new AppError(BASELINE_SAVE_BLOCKED, "assign at least one tenant or group before saving", 400, [
        { field: "assignments", reason: "assign at least one tenant or group before saving" },
      ]);
    }
    const rows = await options.store.setBaselineAssignments(baselineId, assignments);
    return { status: 200, body: { baselineId, assignments: [...rows] } };
  }

  return [
    { method: "GET", path: BASELINES_PATH, handler: handleList },
    { method: "POST", path: BASELINES_PATH, handler: handleCreate },
    { method: "GET", path: BASELINE_DETAIL_PATH, handler: handleGet },
    { method: "PATCH", path: BASELINE_DETAIL_PATH, handler: handleUpdate },
    { method: "DELETE", path: BASELINE_DETAIL_PATH, handler: handleDelete },
    { method: "POST", path: BASELINE_ASSIGN_PATH, handler: handleAssign },
  ];
}

// ─── OpenAPI fragment (§6) ───────────────────────────────────────────────────

export const BASELINES_OPENAPI = {
  "/v1/baselines": {
    get: {
      tags: ["Baselines"],
      operationId: "listBaselines",
      summary: "List baselines.",
      permission: BASELINES_PERMISSIONS.read,
      security: [{ bearerAuth: [] }],
      responses: {
        "200": { description: "Baselines.", content: { "application/json": { schema: { $ref: "#/components/schemas/BaselineList" } } } },
        "401": { description: "Unauthenticated.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
    post: {
      tags: ["Baselines"],
      operationId: "createBaseline",
      summary: "Create a baseline (save gate enforced).",
      permission: BASELINES_PERMISSIONS.write,
      security: [{ bearerAuth: [] }],
      responses: {
        "201": { description: "Created.", content: { "application/json": { schema: { $ref: "#/components/schemas/Baseline" } } } },
        "400": { description: "Save gate blocked.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
  "/v1/baselines/{baselineId}": {
    get: {
      tags: ["Baselines"],
      operationId: "getBaseline",
      summary: "Baseline detail with stages and assignments.",
      permission: BASELINES_PERMISSIONS.read,
      security: [{ bearerAuth: [] }],
      parameters: [{ name: "baselineId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "Baseline.", content: { "application/json": { schema: { $ref: "#/components/schemas/Baseline" } } } },
        "404": { description: "Not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
    patch: {
      tags: ["Baselines"],
      operationId: "updateBaseline",
      summary: "Update a baseline (gate on the merged result).",
      permission: BASELINES_PERMISSIONS.write,
      security: [{ bearerAuth: [] }],
      parameters: [{ name: "baselineId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "Updated.", content: { "application/json": { schema: { $ref: "#/components/schemas/Baseline" } } } },
        "400": { description: "Save gate blocked.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "404": { description: "Not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
    delete: {
      tags: ["Baselines"],
      operationId: "deleteBaseline",
      summary: "Delete a baseline.",
      permission: BASELINES_PERMISSIONS.write,
      security: [{ bearerAuth: [] }],
      parameters: [{ name: "baselineId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "Deleted.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "404": { description: "Not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
  "/v1/baselines/{baselineId}/assign": {
    post: {
      tags: ["Baselines"],
      operationId: "assignBaseline",
      summary: "Replace a baseline's tenant/group assignments.",
      permission: BASELINES_PERMISSIONS.write,
      security: [{ bearerAuth: [] }],
      parameters: [{ name: "baselineId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "Assigned.", content: { "application/json": { schema: { $ref: "#/components/schemas/BaselineAssignments" } } } },
        "400": { description: "Invalid assignment.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "403": { description: "Forbidden or tenant out of scope.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "404": { description: "Not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
} as const;
