// Schedule routes (EPIC-007 SPEC.md §6) over the T-0122 repository surface.
// User-task CRUD delegates to the schedule store, `run-now` sets the task due
// immediately and enqueues through the T-0123 tick envelope path, history reads
// the job/run records, and `GET /v1/schedules/system` serves the T-0123
// system-timer registry read-only. Every read and write is gated on the SPEC §7
// `scheduler.read/write/run` permissions plus the caller's tenant scope, so a
// tenant-targeted task outside the scope yields a structured 403. The OpenAPI
// fragment is published here so `portal.v1.yaml` stays untouched (EPIC-001 §1).
import { randomUUID } from "node:crypto";
import { AppError, ErrorCodes } from "../errors.js";
import { paginate, parsePagination } from "../pagination.js";
import {
  requireTenantInScope,
  type Caller,
} from "../rbac/authorize.js";
import type { RequestContext, Route } from "../server.js";
import { CronError, nextFireTime, parseCron, parseTzOffset } from "../scheduler/cron.js";
import { SYSTEM_TIMERS, getSystemTimer } from "../scheduler/system-timers.js";
import { buildScheduledEnvelope } from "../scheduler/tick.js";

export const SCHEDULES_PATH = "/v1/schedules";
export const SCHEDULE_SYSTEM_PATH = "/v1/schedules/system";
export const SCHEDULE_PATH = "/v1/schedules/:id";
export const SCHEDULE_RUN_NOW_PATH = "/v1/schedules/:id/run-now";
export const SCHEDULE_HISTORY_PATH = "/v1/schedules/:id/history";

export const SCHEDULE_PERMISSIONS = {
  read: "CIPP.Scheduler.Read",
  write: "CIPP.Scheduler.ReadWrite",
  run: "CIPP.Scheduler.ReadWrite",
} as const;

export const SCHEDULE_NOT_FOUND = "schedule.not_found";
export const SCHEDULE_CONFLICT = "schedule.conflict";
export const SCHEDULE_UNKNOWN_COMMAND = "schedule.unknown_command";
export const SCHEDULE_SYSTEM_IMMUTABLE = "schedule.system_immutable";
export const SCHEDULE_ALREADY_RUNNING = "schedule.already_running";

export const SCHEDULE_UNAUTHENTICATED = "request.unauthenticated";

// The §4.4 allowed command set: a task's `Command` must resolve to a known
// command, so creation (and any later command change) rejects anything outside
// this list with a structured 422. The code-deployed system-timer commands are
// the always-known set; assessment tasks run the assessment worker command.
export const SCHEDULE_ALLOWED_COMMANDS: readonly string[] = Object.freeze([
  ...SYSTEM_TIMERS.map((timer) => timer.command),
  "Invoke-M365Assessment",
]);

export function isAllowedScheduleCommand(command: unknown): command is string {
  return (
    typeof command === "string" && (SCHEDULE_ALLOWED_COMMANDS as readonly string[]).includes(command)
  );
}

export const SCHEDULE_TYPES = [
  "assessment",
  "standards",
  "drift",
  "baseline",
  "backup",
  "custom-script",
  "report",
] as const;

export type ScheduleType = (typeof SCHEDULE_TYPES)[number];

export type ScheduleTargetType = "tenant" | "group" | "all";

export interface ScheduleTargetScope {
  type: ScheduleTargetType;
  id?: string;
}

export interface ScheduleRecord {
  id: string;
  name: string;
  type: ScheduleType;
  cron: string;
  timezone: string;
  targetScope: ScheduleTargetScope;
  command: string;
  parameters: Record<string, unknown>;
  enabled: boolean;
  isSystem: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type ScheduleCreateRecord = Omit<ScheduleRecord, "createdAt" | "updatedAt" | "deletedAt"> &
  Partial<Pick<ScheduleRecord, "createdAt" | "updatedAt" | "deletedAt">>;

export type ScheduleUpdatePatch = Partial<
  Pick<
    ScheduleRecord,
    | "name"
    | "type"
    | "cron"
    | "timezone"
    | "targetScope"
    | "command"
    | "parameters"
    | "enabled"
    | "lastRunAt"
    | "nextRunAt"
  >
>;

// Structural seam over the T-0122 ScheduleRepository. The real repository
// satisfies this shape; depending on the seam instead of the db package keeps
// SQL out of the BFF, matching the tenants route pattern.
export interface ScheduleStore {
  listSchedules(options?: { includeDeleted?: boolean }): Promise<ScheduleRecord[]>;
  getSchedule(
    scheduleId: string,
    options?: { includeDeleted?: boolean },
  ): Promise<ScheduleRecord | undefined>;
  createSchedule(input: ScheduleCreateRecord): Promise<ScheduleRecord>;
  updateSchedule(
    scheduleId: string,
    patch: ScheduleUpdatePatch,
  ): Promise<ScheduleRecord | undefined>;
  softDeleteSchedule(scheduleId: string, options?: { now?: string }): Promise<boolean>;
}

export type ScheduleRunOutcome = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface ScheduleRunRecord {
  runId: string;
  jobId: string;
  scheduleId: string;
  startedAt: string;
  finishedAt: string | null;
  outcome: ScheduleRunOutcome;
  error: string | null;
}

// Structural seam over the job/run records: the wiring ticket maps the
// EPIC-003 queue persistence (jobs carry `scheduleId`, SPEC §5) into this.
export interface ScheduleHistoryStore {
  listScheduleRuns(scheduleId: string): Promise<ScheduleRunRecord[]>;
}

// Structural seam over the T-0010 JobQueue: run-now only needs enqueue, so
// fakes and the real queue are interchangeable without importing it here.
export interface ScheduleRunQueue {
  enqueue(envelope: unknown): Promise<string>;
}

export interface ScheduleCaller extends Caller {
  readonly userId?: string;
}

export type ScheduleAuthorizer = (
  caller: ScheduleCaller,
  permission: string,
) => void | Promise<void>;

export interface ScheduleRequestContext extends RequestContext {
  readonly body?: unknown;
}

export interface ScheduleRunIds {
  readonly jobId: string;
  readonly runId: string;
  readonly requestId: string;
  readonly correlationId: string;
}

export interface ScheduleRouteOptions {
  readonly store: ScheduleStore;
  readonly history: ScheduleHistoryStore;
  readonly queue: ScheduleRunQueue;
  readonly resolveCaller: (ctx: RequestContext) => ScheduleCaller | undefined;
  readonly authorize?: ScheduleAuthorizer;
  readonly isRunning?: (scheduleId: string) => boolean | Promise<boolean>;
  readonly readBody?: (ctx: ScheduleRequestContext) => unknown;
  readonly now?: () => string;
  readonly newIds?: () => ScheduleRunIds;
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

function unknownCommandError(command: string): AppError {
  return new AppError(
    SCHEDULE_UNKNOWN_COMMAND,
    `command '${command}' is not a known scheduled command`,
    422,
    [{ field: "command", reason: "unknown_command", allowed: [...SCHEDULE_ALLOWED_COMMANDS] }],
  );
}

function notFoundError(scheduleId: string): AppError {
  return new AppError(SCHEDULE_NOT_FOUND, `schedule ${scheduleId} was not found`, 404);
}

function systemImmutableError(scheduleId: string): AppError {
  return new AppError(
    SCHEDULE_SYSTEM_IMMUTABLE,
    `schedule ${scheduleId} is a system timer and is read-only`,
    403,
    [{ field: "id", reason: "system_immutable" }],
  );
}

function unauthenticatedError(): AppError {
  return new AppError(SCHEDULE_UNAUTHENTICATED, "authentication required", 401);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => ScheduleCaller | undefined,
  ctx: RequestContext,
): ScheduleCaller {
  const caller = resolveCaller(ctx);
  if (caller === undefined) {
    throw unauthenticatedError();
  }
  return caller;
}

function readJsonObject(
  ctx: ScheduleRequestContext,
  readBody: (ctx: ScheduleRequestContext) => unknown,
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

function requireScheduleId(ctx: RequestContext): string {
  const id = ctx.params["id"];
  if (id === undefined || id.trim().length === 0) {
    throw notFoundError("");
  }
  return id;
}

function defaultIds(): ScheduleRunIds {
  return {
    jobId: randomUUID(),
    runId: randomUUID(),
    requestId: randomUUID(),
    correlationId: randomUUID(),
  };
}

function isSystemScheduleId(scheduleId: string): boolean {
  return getSystemTimer(scheduleId) !== undefined
    || (scheduleId.startsWith("system-") && getSystemTimer(scheduleId.slice("system-".length)) !== undefined);
}

function toSystemRecord(timerName: string, nowIso: string): ScheduleRecord | undefined {
  const timer = timerName.startsWith("system-")
    ? getSystemTimer(timerName.slice("system-".length))
    : getSystemTimer(timerName);
  if (timer === undefined) {
    return undefined;
  }
  let nextRunAt: string | null = null;
  try {
    nextRunAt = nextFireTime(timer.cron, nowIso, timer.timezone).toISOString();
  } catch {
    nextRunAt = null;
  }
  return {
    id: `system-${timer.name}`,
    name: timer.name,
    type: timer.type,
    cron: timer.cron,
    timezone: timer.timezone,
    targetScope: { type: "all" },
    command: timer.command,
    parameters: {},
    enabled: true,
    isSystem: true,
    lastRunAt: null,
    nextRunAt,
    createdAt: nowIso,
    updatedAt: nowIso,
    deletedAt: null,
  };
}

function listSystemRecords(nowIso: string): ScheduleRecord[] {
  const records: ScheduleRecord[] = [];
  for (const timer of SYSTEM_TIMERS) {
    const record = toSystemRecord(timer.name, nowIso);
    if (record !== undefined) {
      records.push(record);
    }
  }
  return records;
}

function parseName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError("name must be a non-empty string", "name");
  }
  return value.trim();
}

function parseScheduleType(value: unknown): ScheduleType {
  if (typeof value !== "string" || !(SCHEDULE_TYPES as readonly string[]).includes(value)) {
    throw validationError(
      `type must be one of ${(SCHEDULE_TYPES as readonly string[]).join(", ")}`,
      "type",
    );
  }
  return value as ScheduleType;
}

function parseCronExpression(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError("cron must be a non-empty 6-field cron expression", "cron");
  }
  try {
    parseCron(value);
  } catch (error) {
    if (error instanceof CronError) {
      throw validationError(error.message, "cron");
    }
    throw error;
  }
  return value.trim();
}

function parseTimezone(value: unknown): string {
  if (value === undefined) {
    return "UTC";
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError("timezone must be a non-empty string", "timezone");
  }
  try {
    parseTzOffset(value);
  } catch (error) {
    if (error instanceof CronError) {
      throw validationError(error.message, "timezone");
    }
    throw error;
  }
  return value.trim();
}

function parseTargetScope(value: unknown): ScheduleTargetScope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw validationError("targetScope must be an object", "targetScope");
  }
  const scope = value as JsonObject;
  const type = scope["type"];
  if (type !== "tenant" && type !== "group" && type !== "all") {
    throw validationError("targetScope.type must be 'tenant', 'group', or 'all'", "targetScope");
  }
  const id = scope["id"];
  if (type === "all") {
    if (id !== undefined && id !== null) {
      throw validationError("targetScope.id must be absent for an 'all' target", "targetScope");
    }
    return { type };
  }
  if (typeof id !== "string" || id.trim().length === 0) {
    throw validationError(`targetScope.id is required for a '${type}' target`, "targetScope");
  }
  return { type, id: id.trim() };
}

function parseCommand(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError("command must be a non-empty string", "command");
  }
  const command = value.trim();
  if (!isAllowedScheduleCommand(command)) {
    throw unknownCommandError(command);
  }
  return command;
}

function parseParameters(value: unknown): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw validationError("parameters must be an object", "parameters");
  }
  return value as Record<string, unknown>;
}

function parseEnabled(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== "boolean") {
    throw validationError("enabled must be a boolean", "enabled");
  }
  return value;
}

function parseOptionalId(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError("id must be a non-empty string", "id");
  }
  return value.trim();
}

function parseTypeFilter(value: string | null): ScheduleType | undefined {
  if (value === null || value.length === 0) {
    return undefined;
  }
  if (!(SCHEDULE_TYPES as readonly string[]).includes(value)) {
    throw validationError(
      `type must be one of ${(SCHEDULE_TYPES as readonly string[]).join(", ")}`,
      "type",
    );
  }
  return value as ScheduleType;
}

function parseEnabledFilter(value: string | null): boolean | undefined {
  if (value === null || value.length === 0) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  throw validationError("enabled must be 'true' or 'false'", "enabled");
}

function computeNextRunAt(cron: string, timezone: string, nowIso: string): string {
  try {
    return nextFireTime(cron, nowIso, timezone).toISOString();
  } catch (error) {
    if (error instanceof CronError) {
      throw validationError(error.message, "cron");
    }
    throw error;
  }
}

// Tenant scope only constrains tenant-targeted tasks: group/all targets carry
// no single tenant to intersect, so the SPEC §7 permission gate is the check
// and the task stays visible to any caller holding `CIPP.Scheduler.Read`.
function requireScheduleInScope(caller: ScheduleCaller, schedule: ScheduleRecord): void {
  if (schedule.targetScope.type === "tenant" && schedule.targetScope.id !== undefined) {
    requireTenantInScope(caller, schedule.targetScope.id);
  }
}

function isScheduleVisible(caller: ScheduleCaller, schedule: ScheduleRecord): boolean {
  if (schedule.targetScope.type !== "tenant" || schedule.targetScope.id === undefined) {
    return true;
  }
  if (caller.tenantScope.all) {
    return true;
  }
  return caller.tenantScope.tenantIds.includes(schedule.targetScope.id);
}

function isSystemError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === SCHEDULE_SYSTEM_IMMUTABLE
  );
}

const PATCH_FIELDS: readonly string[] = [
  "name",
  "type",
  "cron",
  "timezone",
  "targetScope",
  "command",
  "parameters",
  "enabled",
];

export function createScheduleRoutes(options: ScheduleRouteOptions): Route[] {
  const readBody = options.readBody ?? ((ctx) => ctx.body);
  const now = options.now ?? (() => new Date().toISOString());
  const newIds = options.newIds ?? defaultIds;
  const isRunning = options.isRunning ?? (() => false);

  const handler = (
    fn: (ctx: ScheduleRequestContext) => Promise<{ status: number; body?: unknown }>,
  ): Route["handler"] =>
    (ctx) =>
      fn(ctx as ScheduleRequestContext);

  const authorize = async (caller: ScheduleCaller, permission: string): Promise<void> => {
    if (options.authorize) {
      await options.authorize(caller, permission);
    }
  };

  async function requireUserSchedule(scheduleId: string): Promise<ScheduleRecord> {
    const existing = await options.store.getSchedule(scheduleId);
    if (existing === undefined || existing.deletedAt !== null) {
      if (isSystemScheduleId(scheduleId)) {
        throw systemImmutableError(scheduleId);
      }
      throw notFoundError(scheduleId);
    }
    if (existing.isSystem) {
      throw systemImmutableError(scheduleId);
    }
    return existing;
  }

  async function resolveForRead(
    caller: ScheduleCaller,
    scheduleId: string,
  ): Promise<ScheduleRecord> {
    const existing = await options.store.getSchedule(scheduleId);
    if (existing !== undefined && existing.deletedAt === null) {
      requireScheduleInScope(caller, existing);
      return existing;
    }
    const system = toSystemRecord(scheduleId, now());
    if (system !== undefined) {
      return system;
    }
    throw notFoundError(scheduleId);
  }

  return [
    {
      method: "GET",
      path: SCHEDULE_SYSTEM_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, SCHEDULE_PERMISSIONS.read);
        return { status: 200, body: { items: listSystemRecords(now()) } };
      }),
    },
    {
      method: "GET",
      path: SCHEDULES_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, SCHEDULE_PERMISSIONS.read);
        const type = parseTypeFilter(ctx.query.get("type"));
        const enabled = parseEnabledFilter(ctx.query.get("enabled"));
        const listed = await options.store.listSchedules();
        const visible = listed.filter(
          (schedule) =>
            schedule.deletedAt === null &&
            (type === undefined || schedule.type === type) &&
            (enabled === undefined || schedule.enabled === enabled) &&
            isScheduleVisible(caller, schedule),
        );
        const page = paginate(visible, parsePagination(ctx.query));
        return { status: 200, body: { items: page.items, nextCursor: page.nextCursor } };
      }),
    },
    {
      method: "POST",
      path: SCHEDULES_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, SCHEDULE_PERMISSIONS.write);
        const body = readJsonObject(ctx, readBody);
        if (body["isSystem"] === true) {
          throw validationError("system timers are code-deployed and cannot be created", "isSystem");
        }
        const id = parseOptionalId(body["id"]) ?? randomUUID();
        const targetScope = parseTargetScope(body["targetScope"]);
        if (targetScope.type === "tenant" && targetScope.id !== undefined) {
          requireTenantInScope(caller, targetScope.id);
        }
        const type = parseScheduleType(body["type"]);
        const cron = parseCronExpression(body["cron"]);
        const timezone = parseTimezone(body["timezone"]);
        const command = parseCommand(body["command"]);
        const prior = await options.store.getSchedule(id, { includeDeleted: true });
        if (prior !== undefined) {
          throw new AppError(SCHEDULE_CONFLICT, `schedule ${id} already exists`, 409);
        }
        if (isSystemScheduleId(id)) {
          throw systemImmutableError(id);
        }
        const instant = now();
        const created = await options.store.createSchedule({
          id,
          name: body["name"] === undefined ? command : parseName(body["name"]),
          type,
          cron,
          timezone,
          targetScope,
          command,
          parameters: parseParameters(body["parameters"]),
          enabled: parseEnabled(body["enabled"]),
          isSystem: false,
          lastRunAt: null,
          nextRunAt: computeNextRunAt(cron, timezone, instant),
          createdAt: instant,
          updatedAt: instant,
        });
        return { status: 201, body: created };
      }),
    },
    {
      method: "GET",
      path: SCHEDULE_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, SCHEDULE_PERMISSIONS.read);
        const scheduleId = requireScheduleId(ctx);
        return { status: 200, body: await resolveForRead(caller, scheduleId) };
      }),
    },
    {
      method: "PATCH",
      path: SCHEDULE_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, SCHEDULE_PERMISSIONS.write);
        const scheduleId = requireScheduleId(ctx);
        const body = readJsonObject(ctx, readBody);
        for (const key of Object.keys(body)) {
          if (!PATCH_FIELDS.includes(key)) {
            throw validationError(`unknown field '${key}'`, key);
          }
        }
        const existing = await requireUserSchedule(scheduleId);
        requireScheduleInScope(caller, existing);
        const patch: ScheduleUpdatePatch = {};
        if (body["name"] !== undefined) {
          patch.name = parseName(body["name"]);
        }
        if (body["type"] !== undefined) {
          patch.type = parseScheduleType(body["type"]);
        }
        if (body["cron"] !== undefined) {
          patch.cron = parseCronExpression(body["cron"]);
        }
        if (body["timezone"] !== undefined) {
          patch.timezone = parseTimezone(body["timezone"]);
        }
        if (body["targetScope"] !== undefined) {
          patch.targetScope = parseTargetScope(body["targetScope"]);
          if (patch.targetScope.type === "tenant" && patch.targetScope.id !== undefined) {
            requireTenantInScope(caller, patch.targetScope.id);
          }
        }
        if (body["command"] !== undefined) {
          patch.command = parseCommand(body["command"]);
        }
        if (body["parameters"] !== undefined) {
          patch.parameters = parseParameters(body["parameters"]);
        }
        if (body["enabled"] !== undefined) {
          patch.enabled = parseEnabled(body["enabled"]);
        }
        if (patch.cron !== undefined || patch.timezone !== undefined) {
          patch.nextRunAt = computeNextRunAt(
            patch.cron ?? existing.cron,
            patch.timezone ?? existing.timezone,
            now(),
          );
        }
        try {
          const updated = await options.store.updateSchedule(scheduleId, patch);
          if (updated === undefined) {
            throw notFoundError(scheduleId);
          }
          return { status: 200, body: updated };
        } catch (error) {
          if (isSystemError(error)) {
            throw systemImmutableError(scheduleId);
          }
          throw error;
        }
      }),
    },
    {
      method: "DELETE",
      path: SCHEDULE_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, SCHEDULE_PERMISSIONS.write);
        const scheduleId = requireScheduleId(ctx);
        const existing = await requireUserSchedule(scheduleId);
        requireScheduleInScope(caller, existing);
        try {
          const removed = await options.store.softDeleteSchedule(scheduleId, { now: now() });
          if (!removed) {
            throw notFoundError(scheduleId);
          }
        } catch (error) {
          if (isSystemError(error)) {
            throw systemImmutableError(scheduleId);
          }
          throw error;
        }
        return { status: 204 };
      }),
    },
    {
      method: "POST",
      path: SCHEDULE_RUN_NOW_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, SCHEDULE_PERMISSIONS.run);
        const scheduleId = requireScheduleId(ctx);
        const existing = await options.store.getSchedule(scheduleId);
        if (existing === undefined || existing.deletedAt !== null || existing.isSystem) {
          throw notFoundError(scheduleId);
        }
        requireScheduleInScope(caller, existing);
        if (await isRunning(scheduleId)) {
          throw new AppError(
            SCHEDULE_ALREADY_RUNNING,
            `schedule ${scheduleId} already has a run in flight`,
            409,
          );
        }
        const instant = now();
        const ids = newIds();
        const envelope = buildScheduledEnvelope(existing, new Date(instant), {
          jobId: ids.jobId,
          runId: ids.runId,
          requestId: ids.requestId,
          correlationId: ctx.correlationId,
        });
        const jobId = await options.queue.enqueue(envelope);
        await options.store.updateSchedule(scheduleId, { nextRunAt: instant });
        const next = await options.store.getSchedule(scheduleId);
        return {
          status: 202,
          body: { scheduleId, jobId, runId: ids.runId, nextRunAt: next?.nextRunAt ?? instant },
        };
      }),
    },
    {
      method: "GET",
      path: SCHEDULE_HISTORY_PATH,
      handler: handler(async (ctx) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, SCHEDULE_PERMISSIONS.read);
        const scheduleId = requireScheduleId(ctx);
        const schedule = await resolveForRead(caller, scheduleId);
        const runs = await options.history.listScheduleRuns(schedule.id);
        const newestFirst = [...runs].sort((left, right) =>
          right.startedAt.localeCompare(left.startedAt),
        );
        return { status: 200, body: { scheduleId: schedule.id, runs: newestFirst } };
      }),
    },
    ...(["POST", "PATCH", "DELETE"] as const).map((method): Route => ({
      method,
      path: SCHEDULE_SYSTEM_PATH,
      handler: handler(async (ctx) => {
        requireCaller(options.resolveCaller, ctx);
        throw systemImmutableError("system");
      }),
    })),
  ];
}

// Route modules own their OpenAPI path items (portal.v1.yaml `paths` is empty
// by design); a wiring ticket merges this fragment into the served document.
export const SCHEDULES_OPENAPI = {
  paths: {
    "/schedules": {
      get: {
        operationId: "listSchedules",
        summary: "List user schedules visible to the caller (filter: type/enabled)",
        permission: SCHEDULE_PERMISSIONS.read,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "type", in: "query", required: false, schema: { type: "string", enum: ["assessment", "standards", "drift", "baseline", "backup", "custom-script", "report"] } },
          { name: "enabled", in: "query", required: false, schema: { type: "boolean" } },
          { name: "cursor", in: "query", required: false, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer" } },
        ],
        responses: {
          "200": { description: "Cursor-paginated user schedules intersected with the caller scope." },
          "400": { description: "An unsupported filter value was supplied." },
          "401": { description: "Authentication required." },
        },
      },
      post: {
        operationId: "createSchedule",
        summary: "Create a user schedule (command must be a known scheduled command)",
        permission: SCHEDULE_PERMISSIONS.write,
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ScheduleCreate" },
            },
          },
        },
        responses: {
          "201": { description: "The created schedule." },
          "400": { description: "Validation failed." },
          "401": { description: "Authentication required." },
          "403": { description: "Target tenant is outside the caller scope." },
          "409": { description: "A schedule with this id already exists." },
          "422": { description: "The command is not a known scheduled command." },
        },
      },
    },
    "/schedules/system": {
      get: {
        operationId: "listSystemTimers",
        summary: "List code-deployed system timers (read-only)",
        permission: SCHEDULE_PERMISSIONS.read,
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "The system-timer registry with each timer's next run." },
          "401": { description: "Authentication required." },
        },
      },
    },
    "/schedules/{id}": {
      get: {
        operationId: "getSchedule",
        summary: "Schedule detail (user task or system timer)",
        permission: SCHEDULE_PERMISSIONS.read,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "The schedule." },
          "401": { description: "Authentication required." },
          "403": { description: "Target tenant is outside the caller scope." },
          "404": { description: "Schedule not found." },
        },
      },
      patch: {
        operationId: "updateSchedule",
        summary: "Edit a user schedule (system timers are read-only)",
        permission: SCHEDULE_PERMISSIONS.write,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ScheduleUpdate" },
            },
          },
        },
        responses: {
          "200": { description: "The updated schedule." },
          "400": { description: "Validation failed." },
          "401": { description: "Authentication required." },
          "403": { description: "System timers are read-only, or the tenant is out of scope." },
          "404": { description: "Schedule not found." },
          "422": { description: "The command is not a known scheduled command." },
        },
      },
      delete: {
        operationId: "deleteSchedule",
        summary: "Remove a user schedule, soft delete (system timers are read-only)",
        permission: SCHEDULE_PERMISSIONS.write,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "204": { description: "Soft-deleted; no body." },
          "401": { description: "Authentication required." },
          "403": { description: "System timers are read-only, or the tenant is out of scope." },
          "404": { description: "Schedule not found." },
        },
      },
    },
    "/schedules/{id}/run-now": {
      post: {
        operationId: "runScheduleNow",
        summary: "Set a user schedule due immediately and enqueue a run",
        permission: SCHEDULE_PERMISSIONS.run,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "202": { description: "The run was enqueued; carries the job and run ids." },
          "401": { description: "Authentication required." },
          "403": { description: "Target tenant is outside the caller scope." },
          "404": { description: "Schedule not found." },
          "409": { description: "The schedule already has a run in flight." },
        },
      },
    },
    "/schedules/{id}/history": {
      get: {
        operationId: "listScheduleRuns",
        summary: "Run history for a schedule, newest first",
        permission: SCHEDULE_PERMISSIONS.read,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "The schedule's runs, newest first." },
          "401": { description: "Authentication required." },
          "403": { description: "Target tenant is outside the caller scope." },
          "404": { description: "Schedule not found." },
        },
      },
    },
  },
  schemas: {
    Schedule: {
      type: "object",
      required: ["id", "name", "type", "cron", "timezone", "targetScope", "command", "enabled", "isSystem"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        type: { type: "string", enum: ["assessment", "standards", "drift", "baseline", "backup", "custom-script", "report"] },
        cron: { type: "string" },
        timezone: { type: "string" },
        targetScope: { $ref: "#/components/schemas/ScheduleTargetScope" },
        command: { type: "string" },
        parameters: { type: "object", additionalProperties: true },
        enabled: { type: "boolean" },
        isSystem: { type: "boolean" },
        lastRunAt: { type: ["string", "null"] },
        nextRunAt: { type: ["string", "null"] },
        createdAt: { type: "string" },
        updatedAt: { type: "string" },
        deletedAt: { type: ["string", "null"] },
      },
    },
    ScheduleTargetScope: {
      type: "object",
      required: ["type"],
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["tenant", "group", "all"] },
        id: { type: "string" },
      },
    },
    ScheduleCreate: {
      type: "object",
      required: ["type", "cron", "targetScope", "command"],
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        type: { type: "string", enum: ["assessment", "standards", "drift", "baseline", "backup", "custom-script", "report"] },
        cron: { type: "string" },
        timezone: { type: "string" },
        targetScope: { $ref: "#/components/schemas/ScheduleTargetScope" },
        command: { type: "string" },
        parameters: { type: "object", additionalProperties: true },
        enabled: { type: "boolean" },
      },
    },
    ScheduleUpdate: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        type: { type: "string", enum: ["assessment", "standards", "drift", "baseline", "backup", "custom-script", "report"] },
        cron: { type: "string" },
        timezone: { type: "string" },
        targetScope: { $ref: "#/components/schemas/ScheduleTargetScope" },
        command: { type: "string" },
        parameters: { type: "object", additionalProperties: true },
        enabled: { type: "boolean" },
      },
    },
    ScheduleRun: {
      type: "object",
      required: ["runId", "jobId", "scheduleId", "startedAt", "outcome"],
      properties: {
        runId: { type: "string" },
        jobId: { type: "string" },
        scheduleId: { type: "string" },
        startedAt: { type: "string" },
        finishedAt: { type: ["string", "null"] },
        outcome: { type: "string", enum: ["queued", "running", "succeeded", "failed", "cancelled"] },
        error: { type: ["string", "null"] },
      },
    },
  },
} as const;
