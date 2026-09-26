// Standards run-now and schedule set/clear API (EPIC-008 SPEC.md §4.3, §4.5,
// §6; T-0150).
//
//   POST /v1/standards/templates/{templateId}/run       -> enqueue immediately
//   POST /v1/standards/templates/{templateId}/schedule  -> set or clear
//
// Run-now enqueues without waiting for the timer (US-4). Before enqueuing it
// resolves the template's `%variable%` settings against the tenant's variables;
// an unresolved variable fails the affected standard loudly and is recorded, so
// the run is rejected rather than silently substituting an empty string (§4.5).
//
// Schedule set/clear updates the `Schedule` row and records the link on the
// template. A drift template is not schedulable.

import { randomUUID } from "node:crypto";
import { AppError, ErrorCodes } from "../errors.js";
import { requirePermission, requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { Permission } from "../rbac/roles.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";
import type { VariableScopes } from "../domain/variable-substitution.js";
import {
  resolveStandardSettings,
  type StandardSetting,
  type VariableResolutionFailure,
} from "../domain/standards-variables.js";

export const STANDARDS_RUN_PATH = "/v1/standards/templates/:templateId/run";
export const STANDARDS_SCHEDULE_PATH = "/v1/standards/templates/:templateId/schedule";

export const STANDARDS_RUN_PERMISSION = "standards.run";
export const STANDARDS_SCHEDULE_PERMISSION = "standards.write";
export const STANDARDS_RUN_UNAUTHENTICATED = "request.unauthenticated";
export const STANDARDS_TEMPLATE_NOT_FOUND = "standards.template_not_found";
export const STANDARDS_UNRESOLVED_VARIABLE = "standards.unresolved_variable";
export const STANDARDS_DRIFT_NOT_SCHEDULABLE = "standards.drift_not_schedulable";

export type StandardTemplateKind = "standards" | "drift";

// ─── Records and seams ────────────────────────────────────────────────────────

export interface RunTemplateRecord {
  readonly id: string;
  readonly name: string;
  readonly kind: StandardTemplateKind;
  readonly settings: readonly StandardSetting[];
  readonly scheduleId: string | null;
}

export interface CreateScheduleInput {
  readonly id: string;
  readonly name: string;
  readonly type: "standards";
  readonly cron: string;
  readonly timezone: string;
  readonly targetScope: { readonly type: "all" };
  readonly command: string;
  readonly parameters: Record<string, unknown>;
  readonly enabled: boolean;
  readonly isSystem: false;
  readonly lastRunAt: null;
  readonly nextRunAt: null;
}

export interface StandardsRunStore {
  getStandardTemplate(templateId: string): Promise<RunTemplateRecord | undefined>;
  updateStandardTemplate(
    templateId: string,
    patch: { scheduleId?: string | null },
  ): Promise<RunTemplateRecord | undefined>;
  createSchedule(input: CreateScheduleInput): Promise<{ id: string }>;
  softDeleteSchedule(scheduleId: string): Promise<boolean>;
}

export interface StandardsRunQueue {
  enqueue(envelope: unknown): Promise<string>;
}

export interface StandardsAuditPort {
  record(event: Record<string, unknown>): Promise<void> | void;
}

export interface StandardsRunOptions {
  readonly store: StandardsRunStore;
  readonly queue: StandardsRunQueue;
  readonly resolveCaller: (ctx: RequestContext) => Caller | undefined;
  readonly authorize?: (caller: Caller, permission: string) => void | Promise<void>;
  /** Resolves a tenant's variables (global + tenant) for substitution. */
  readonly resolveVariables?: (tenantId: string) => Promise<VariableScopes>;
  readonly audit?: StandardsAuditPort;
  readonly idGenerator?: () => string;
  readonly now?: () => string;
}

export interface StandardsRunRequest extends RequestContext {
  readonly body?: unknown;
}

// ─── Envelope ────────────────────────────────────────────────────────────────

export interface ManualStandardsEnvelope {
  readonly schemaVersion: "v1";
  readonly jobId: string;
  readonly jobType: "standards";
  readonly tenantId: string;
  readonly runId: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly payload: {
    readonly contextRef: string;
    readonly outputRef: string;
    readonly credentialRef: string;
    readonly sectionRefs: readonly string[];
    readonly artifactRefs: readonly string[];
    readonly templateId: string;
    readonly settings: readonly StandardSetting[];
  };
  readonly trigger: "manual";
  readonly scheduleId: string | null;
}

export function buildManualStandardsEnvelope(
  input: {
    readonly tenantId: string;
    readonly templateId: string;
    readonly settings: readonly StandardSetting[];
    readonly scheduleId: string | null;
    readonly jobId: string;
    readonly runId: string;
    readonly requestId: string;
    readonly correlationId: string;
  },
  createdAt: string,
): ManualStandardsEnvelope {
  return {
    schemaVersion: "v1",
    jobId: input.jobId,
    jobType: "standards",
    tenantId: input.tenantId,
    runId: input.runId,
    requestId: input.requestId,
    correlationId: input.correlationId,
    createdAt,
    payload: {
      contextRef: `standards/templates/${input.templateId}/context.json`,
      outputRef: `standards/templates/${input.templateId}/${input.tenantId}/${input.runId}`,
      credentialRef: `tenants/${input.tenantId}/credential`,
      sectionRefs: [],
      artifactRefs: [],
      templateId: input.templateId,
      settings: input.settings,
    },
    trigger: "manual",
    scheduleId: input.scheduleId,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function ensureAuthorized(
  options: StandardsRunOptions,
  caller: Caller,
  permission: string,
): Promise<void> {
  if (options.authorize) {
    await options.authorize(caller, permission);
    return;
  }
  // standards.* is not in the roles.ts union yet (EPIC-038); deny without a seam.
  requirePermission(caller, permission as Permission);
}

function requireCaller(options: StandardsRunOptions, ctx: StandardsRunRequest): Caller {
  const caller = options.resolveCaller(ctx);
  if (!caller) {
    throw new AppError(STANDARDS_RUN_UNAUTHENTICATED, "authentication required", 401);
  }
  return caller;
}

function requireParam(ctx: StandardsRunRequest, name: string): string {
  const value = ctx.params[name];
  if (!value || value.length === 0) {
    throw new AppError(ErrorCodes.validationFailed, `Missing route parameter '${name}'`, 400, [
      { field: name, reason: "required" },
    ]);
  }
  return value;
}

function requireBodyRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AppError(ErrorCodes.validationFailed, "Request body must be a JSON object", 400, [
      { field: "body", reason: "invalid" },
    ]);
  }
  return value as Record<string, unknown>;
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

// ─── Route factory ────────────────────────────────────────────────────────────

export function createStandardsRunRoutes(options: StandardsRunOptions): Route[] {
  const idGenerator = options.idGenerator ?? (() => randomUUID());
  const now = options.now ?? (() => new Date().toISOString());

  // POST /v1/standards/templates/:templateId/run
  async function handleRun(ctx: StandardsRunRequest): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, STANDARDS_RUN_PERMISSION);

    const templateId = requireParam(ctx, "templateId");
    const body = requireBodyRecord(ctx.body);
    const tenantId = requireString(body, "tenantId");
    requireTenantInScope(caller, tenantId);

    const template = await options.store.getStandardTemplate(templateId);
    if (!template) {
      throw new AppError(STANDARDS_TEMPLATE_NOT_FOUND, `Standard template ${templateId} not found`, 404);
    }

    // §4.5: resolve %variables%; an unresolved token fails loudly and is recorded.
    const scopes = options.resolveVariables ? await options.resolveVariables(tenantId) : {};
    const resolution = resolveStandardSettings(template.settings, scopes);
    if (resolution.failed.length > 0) {
      await recordUnresolved(options, templateId, tenantId, ctx.correlationId, resolution.failed);
      throw new AppError(
        STANDARDS_UNRESOLVED_VARIABLE,
        `unresolved variable(s) in template ${templateId}: ${resolution.failed
          .map((f) => `%${f.token}%`)
          .join(", ")}`,
        422,
      );
    }

    const jobId = idGenerator();
    const runId = idGenerator();
    const requestId = idGenerator();
    await options.queue.enqueue(
      buildManualStandardsEnvelope(
        {
          tenantId,
          templateId,
          settings: resolution.resolved,
          scheduleId: template.scheduleId,
          jobId,
          runId,
          requestId,
          correlationId: ctx.correlationId,
        },
        now(),
      ),
    );

    if (options.audit) {
      await options.audit.record({
        action: "standards.run_now",
        tenantId,
        resourceId: templateId,
        correlationId: ctx.correlationId,
      });
    }

    return { status: 202, body: { templateId, tenantId, jobId, runId, trigger: "manual" } };
  }

  // POST /v1/standards/templates/:templateId/schedule
  async function handleSchedule(ctx: StandardsRunRequest): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, STANDARDS_SCHEDULE_PERMISSION);

    const templateId = requireParam(ctx, "templateId");
    const body = requireBodyRecord(ctx.body);

    const template = await options.store.getStandardTemplate(templateId);
    if (!template) {
      throw new AppError(STANDARDS_TEMPLATE_NOT_FOUND, `Standard template ${templateId} not found`, 404);
    }
    if (template.kind === "drift") {
      throw new AppError(
        STANDARDS_DRIFT_NOT_SCHEDULABLE,
        "drift templates are not schedulable",
        422,
      );
    }

    const scheduleIdBody = body["scheduleId"];
    const cron = body["cron"];

    // Clear: explicit null scheduleId or null cron.
    if (scheduleIdBody === null || cron === null) {
      if (template.scheduleId) {
        await options.store.softDeleteSchedule(template.scheduleId);
      }
      const updated = await options.store.updateStandardTemplate(templateId, { scheduleId: null });
      return { status: 200, body: { templateId, scheduleId: null, template: updated ?? null } };
    }

    // Link an existing schedule by id.
    if (typeof scheduleIdBody === "string" && scheduleIdBody.length > 0) {
      const updated = await options.store.updateStandardTemplate(templateId, { scheduleId: scheduleIdBody });
      return { status: 200, body: { templateId, scheduleId: scheduleIdBody, template: updated ?? null } };
    }

    // Create a new schedule from a cron expression.
    if (typeof cron === "string" && cron.length > 0) {
      const timezone = typeof body["timezone"] === "string" ? (body["timezone"] as string) : "UTC";
      const created = await options.store.createSchedule({
        id: idGenerator(),
        name: `${template.name} (schedule)`,
        type: "standards",
        cron,
        timezone,
        targetScope: { type: "all" },
        command: "Invoke-Standard",
        parameters: { templateId },
        enabled: true,
        isSystem: false,
        lastRunAt: null,
        nextRunAt: null,
      });
      const updated = await options.store.updateStandardTemplate(templateId, { scheduleId: created.id });
      return { status: 200, body: { templateId, scheduleId: created.id, template: updated ?? null } };
    }

    throw new AppError(
      ErrorCodes.validationFailed,
      "Provide 'cron' to set a schedule, an existing 'scheduleId', or null to clear",
      400,
      [{ field: "cron", reason: "required" }],
    );
  }

  return [
    { method: "POST", path: STANDARDS_RUN_PATH, handler: handleRun },
    { method: "POST", path: STANDARDS_SCHEDULE_PATH, handler: handleSchedule },
  ];
}

async function recordUnresolved(
  options: StandardsRunOptions,
  templateId: string,
  tenantId: string,
  correlationId: string,
  failures: readonly VariableResolutionFailure[],
): Promise<void> {
  if (!options.audit) return;
  for (const failure of failures) {
    await options.audit.record({
      action: "standards.variable_unresolved",
      result: "failure",
      tenantId,
      resourceId: templateId,
      // Only the token name is recorded; never a value.
      settingKey: failure.key,
      token: failure.token,
      correlationId,
    });
  }
}

// ─── OpenAPI fragment (§6) ───────────────────────────────────────────────────

export const STANDARDS_RUN_OPENAPI = {
  "/v1/standards/templates/{templateId}/run": {
    post: {
      tags: ["Standards"],
      operationId: "runStandardTemplateNow",
      summary: "Enqueue a standards run immediately (no schedule wait).",
      permission: STANDARDS_RUN_PERMISSION,
      security: [{ bearerAuth: [] }],
      parameters: [{ name: "templateId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "202": { description: "Enqueued.", content: { "application/json": { schema: { $ref: "#/components/schemas/StandardsRunResponse" } } } },
        "404": { description: "Not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "422": { description: "Unresolved variable.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
  "/v1/standards/templates/{templateId}/schedule": {
    post: {
      tags: ["Standards"],
      operationId: "setStandardTemplateSchedule",
      summary: "Set or clear a template's schedule.",
      permission: STANDARDS_SCHEDULE_PERMISSION,
      security: [{ bearerAuth: [] }],
      parameters: [{ name: "templateId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "Schedule set or cleared.", content: { "application/json": { schema: { $ref: "#/components/schemas/StandardTemplateResponse" } } } },
        "404": { description: "Not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "422": { description: "Drift templates are not schedulable.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
} as const;
