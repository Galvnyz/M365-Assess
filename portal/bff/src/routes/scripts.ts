// Custom script CRUD, versions, and dry-run/run API (EPIC-007 SPEC.md §4.3, §6,
// §7, §11.3; T-0127).
//
// Routes over T-0125's repository and T-0126's sandbox, both injected as
// structural seams so this module stays free of the SQL implementation and the
// PowerShell runtime. `CIPP.Scripts.Execute` is higher privilege because a custom script
// is arbitrary code (SPEC §7).
//
// Dry-run contract (SPEC §11.3): a script opts in via
// `parameters.dryRunContract === true`. A dry run requested against a script
// without the contract is rejected rather than silently executed for real.

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

export const SCRIPTS_PATH = "/v1/scripts";
export const SCRIPT_DETAIL_PATH = "/v1/scripts/:scriptId";
export const SCRIPT_VERSIONS_PATH = "/v1/scripts/:scriptId/versions";
export const SCRIPT_RUN_PATH = "/v1/scripts/:scriptId/run";

export const SCRIPTS_PERMISSIONS = {
  read: "CIPP.Scripts.Read",
  write: "CIPP.Scripts.ReadWrite",
  run: "CIPP.Scripts.Execute",
} as const;

export const SCRIPTS_UNAUTHENTICATED = "request.unauthenticated";
export const SCRIPTS_NOT_FOUND = "scripts.not_found";
export const SCRIPTS_NO_VERSION = "scripts.no_version";
export const SCRIPTS_DRY_RUN_NOT_SUPPORTED = "scripts.dry_run_not_supported";
export const SCRIPTS_DELETE_UNSUPPORTED = "scripts.delete_unsupported";

// ─── Records (structural mirrors of the db package types) ────────────────────

export interface CustomScriptRecord {
  readonly id: string;
  readonly name: string;
  readonly author: string;
  readonly enabled: boolean;
  readonly alertsEnabled: boolean;
  readonly currentVersionId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CustomScriptVersionRecord {
  readonly id: string;
  readonly scriptId: string;
  readonly content: string;
  readonly markdownTemplate: string | null;
  readonly parameters: Record<string, unknown> | null;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface RegisterScriptInput {
  readonly id: string;
  readonly name: string;
  readonly author: string;
  readonly enabled?: boolean;
  readonly alertsEnabled?: boolean;
}

export interface AppendVersionInput {
  readonly id: string;
  readonly scriptId: string;
  readonly content: string;
  readonly markdownTemplate?: string | null;
  readonly parameters?: Record<string, unknown> | null;
  readonly createdBy: string;
}

export interface SetScriptFlagsInput {
  readonly scriptId: string;
  readonly enabled?: boolean;
  readonly alertsEnabled?: boolean;
}

// ─── Dependency seams ─────────────────────────────────────────────────────────

export interface CustomScriptStore {
  listScripts(): Promise<readonly CustomScriptRecord[]>;
  getScript(scriptId: string): Promise<CustomScriptRecord | undefined>;
  registerScript(input: RegisterScriptInput): Promise<CustomScriptRecord>;
  setScriptFlags(input: SetScriptFlagsInput): Promise<CustomScriptRecord | undefined>;
  appendVersion(input: AppendVersionInput): Promise<CustomScriptVersionRecord>;
  listVersions(scriptId: string): Promise<readonly CustomScriptVersionRecord[]>;
  getVersion?(versionId: string): Promise<CustomScriptVersionRecord | undefined>;
  deleteScript?(scriptId: string): Promise<boolean>;
}

export interface ScriptSandboxRunInput {
  readonly content: string;
  readonly tenantId: string;
  readonly dryRun: boolean;
  readonly parameters: Record<string, unknown> | null;
}

export interface ScriptSandboxResult {
  readonly output: string;
  readonly exitCode: number;
  readonly error?: string | null;
  readonly durationMs?: number | null;
}

export interface ScriptSandbox {
  run(input: ScriptSandboxRunInput): Promise<ScriptSandboxResult>;
}

export interface ScriptAuditPort {
  record(event: {
    readonly action: string;
    readonly actorUserId: string | null;
    readonly tenantId?: string | null;
    readonly resourceId: string;
    readonly correlationId: string;
  }): Promise<void> | void;
}

export interface ScriptRouteOptions {
  readonly store: CustomScriptStore;
  readonly sandbox: ScriptSandbox;
  readonly resolveCaller: (ctx: RequestContext) => Caller | undefined;
  readonly authorize?: (caller: Caller, permission: string) => void | Promise<void>;
  readonly audit?: ScriptAuditPort;
  readonly idGenerator?: () => string;
  readonly now?: () => string;
}

export interface ScriptRequest extends RequestContext {
  readonly body?: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function ensureAuthorized(
  options: ScriptRouteOptions,
  caller: Caller,
  permission: string,
): Promise<void> {
  if (options.authorize) {
    await options.authorize(caller, permission);
    return;
  }
  // The scripts.* tokens are not members of the roles.ts Permission union yet
  // (EPIC-038 wires the full taxonomy); without an authorize seam, deny.
  requirePermission(caller, permission as Permission);
}

function requireCaller(
  options: ScriptRouteOptions,
  ctx: ScriptRequest,
): Caller {
  const caller = options.resolveCaller(ctx);
  if (!caller) {
    throw new AppError(SCRIPTS_UNAUTHENTICATED, "authentication required", 401);
  }
  return caller;
}

function requireParam(ctx: ScriptRequest, name: string): string {
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

function optionalRecord(
  record: Record<string, unknown>,
  field: string,
): Record<string, unknown> | null {
  const value = record[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(ErrorCodes.validationFailed, `Field '${field}' must be an object`, 400, [
      { field, reason: "invalid" },
    ]);
  }
  return value as Record<string, unknown>;
}

/** True when the version's parameters declare the dry-run contract. */
export function declaresDryRunContract(
  parameters: Record<string, unknown> | null | undefined,
): boolean {
  return parameters !== null && parameters !== undefined && parameters["dryRunContract"] === true;
}

function mapScript(script: CustomScriptRecord): Record<string, unknown> {
  return {
    id: script.id,
    name: script.name,
    author: script.author,
    enabled: script.enabled,
    alertsEnabled: script.alertsEnabled,
    currentVersionId: script.currentVersionId,
    createdAt: script.createdAt,
    updatedAt: script.updatedAt,
  };
}

function mapVersion(version: CustomScriptVersionRecord): Record<string, unknown> {
  return {
    id: version.id,
    scriptId: version.scriptId,
    content: version.content,
    markdownTemplate: version.markdownTemplate,
    parameters: version.parameters,
    createdAt: version.createdAt,
    createdBy: version.createdBy,
  };
}

// ─── Route factory ────────────────────────────────────────────────────────────

export function createScriptRoutes(options: ScriptRouteOptions): Route[] {
  const idGenerator = options.idGenerator ?? (() => randomUUID());

  async function currentVersion(
    script: CustomScriptRecord,
  ): Promise<CustomScriptVersionRecord | undefined> {
    if (!script.currentVersionId || !options.store.getVersion) return undefined;
    return options.store.getVersion(script.currentVersionId);
  }

  // GET /v1/scripts
  async function handleList(ctx: ScriptRequest): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, SCRIPTS_PERMISSIONS.read);
    const items = await options.store.listScripts();
    return { status: 200, body: { items: items.map(mapScript) } };
  }

  // POST /v1/scripts — create a script and its first version.
  async function handleCreate(ctx: ScriptRequest): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, SCRIPTS_PERMISSIONS.write);
    const body = requireBodyRecord(ctx.body);
    const name = requireString(body, "name");
    const content = requireString(body, "content");
    const markdownTemplate = optionalString(body, "markdownTemplate");
    const parameters = optionalRecord(body, "parameters");
    const author = optionalString(body, "author") ?? "unknown";

    const script = await options.store.registerScript({
      id: idGenerator(),
      name,
      author,
      enabled: optionalBoolean(body, "enabled") ?? false,
      alertsEnabled: optionalBoolean(body, "alertsEnabled") ?? false,
    });
    // Saving always appends a version (T-0127).
    const version = await options.store.appendVersion({
      id: idGenerator(),
      scriptId: script.id,
      content,
      markdownTemplate,
      parameters,
      createdBy: author,
    });

    return { status: 201, body: { script: mapScript(script), version: mapVersion(version) } };
  }

  // GET /v1/scripts/:scriptId
  async function handleGet(ctx: ScriptRequest): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, SCRIPTS_PERMISSIONS.read);
    const scriptId = requireParam(ctx, "scriptId");
    const script = await options.store.getScript(scriptId);
    if (!script) {
      throw new AppError(SCRIPTS_NOT_FOUND, `Custom script ${scriptId} not found`, 404);
    }
    const version = await currentVersion(script);
    return {
      status: 200,
      body: { script: mapScript(script), currentVersion: version ? mapVersion(version) : null },
    };
  }

  // PATCH /v1/scripts/:scriptId — update flags and/or append a new version.
  async function handlePatch(ctx: ScriptRequest): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, SCRIPTS_PERMISSIONS.write);
    const scriptId = requireParam(ctx, "scriptId");
    const body = requireBodyRecord(ctx.body);

    const existing = await options.store.getScript(scriptId);
    if (!existing) {
      throw new AppError(SCRIPTS_NOT_FOUND, `Custom script ${scriptId} not found`, 404);
    }

    const enabled = optionalBoolean(body, "enabled");
    const alertsEnabled = optionalBoolean(body, "alertsEnabled");
    let script = existing;
    if (enabled !== undefined || alertsEnabled !== undefined) {
      const updated = await options.store.setScriptFlags({ scriptId, enabled, alertsEnabled });
      if (!updated) {
        throw new AppError(SCRIPTS_NOT_FOUND, `Custom script ${scriptId} not found`, 404);
      }
      script = updated;
    }

    // Content edit appends a version.
    const content = optionalString(body, "content");
    let version: CustomScriptVersionRecord | null = null;
    if (content !== null) {
      version = await options.store.appendVersion({
        id: idGenerator(),
        scriptId,
        content,
        markdownTemplate: optionalString(body, "markdownTemplate"),
        parameters: optionalRecord(body, "parameters"),
        createdBy: optionalString(body, "author") ?? script.author,
      });
    }

    return {
      status: 200,
      body: { script: mapScript(script), version: version ? mapVersion(version) : null },
    };
  }

  // DELETE /v1/scripts/:scriptId
  async function handleDelete(ctx: ScriptRequest): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, SCRIPTS_PERMISSIONS.write);
    const scriptId = requireParam(ctx, "scriptId");
    if (!options.store.deleteScript) {
      throw new AppError(
        SCRIPTS_DELETE_UNSUPPORTED,
        "custom script deletion is not supported by the configured store",
        501,
      );
    }
    const deleted = await options.store.deleteScript(scriptId);
    if (!deleted) {
      throw new AppError(SCRIPTS_NOT_FOUND, `Custom script ${scriptId} not found`, 404);
    }
    return { status: 204 };
  }

  // GET /v1/scripts/:scriptId/versions
  async function handleListVersions(ctx: ScriptRequest): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, SCRIPTS_PERMISSIONS.read);
    const scriptId = requireParam(ctx, "scriptId");
    const script = await options.store.getScript(scriptId);
    if (!script) {
      throw new AppError(SCRIPTS_NOT_FOUND, `Custom script ${scriptId} not found`, 404);
    }
    const versions = await options.store.listVersions(scriptId);
    return { status: 200, body: { items: versions.map(mapVersion) } };
  }

  // POST /v1/scripts/:scriptId/versions — append an immutable version.
  async function handleCreateVersion(ctx: ScriptRequest): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, SCRIPTS_PERMISSIONS.write);
    const scriptId = requireParam(ctx, "scriptId");
    const body = requireBodyRecord(ctx.body);
    const content = requireString(body, "content");

    const script = await options.store.getScript(scriptId);
    if (!script) {
      throw new AppError(SCRIPTS_NOT_FOUND, `Custom script ${scriptId} not found`, 404);
    }

    const version = await options.store.appendVersion({
      id: idGenerator(),
      scriptId,
      content,
      markdownTemplate: optionalString(body, "markdownTemplate"),
      parameters: optionalRecord(body, "parameters"),
      createdBy: optionalString(body, "author") ?? script.author,
    });
    return { status: 201, body: { version: mapVersion(version) } };
  }

  // POST /v1/scripts/:scriptId/run — dry-run / run (gated, SPEC §4.3, §11.3).
  async function handleRun(ctx: ScriptRequest): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, SCRIPTS_PERMISSIONS.run);

    const scriptId = requireParam(ctx, "scriptId");
    const body = requireBodyRecord(ctx.body);
    const tenantId = requireString(body, "tenantId");
    const dryRun = optionalBoolean(body, "dryRun") ?? true;
    requireTenantInScope(caller, tenantId);

    const script = await options.store.getScript(scriptId);
    if (!script) {
      throw new AppError(SCRIPTS_NOT_FOUND, `Custom script ${scriptId} not found`, 404);
    }
    const version = await currentVersion(script);
    if (!version) {
      throw new AppError(
        SCRIPTS_NO_VERSION,
        `Custom script ${scriptId} has no current version to run`,
        400,
      );
    }

    // A dry run requires the explicit opt-in contract (SPEC §11.3); without it
    // the request is rejected rather than silently executed for real.
    if (dryRun && !declaresDryRunContract(version.parameters)) {
      throw new AppError(
        SCRIPTS_DRY_RUN_NOT_SUPPORTED,
        `Custom script ${scriptId} does not declare the dry-run contract; refusing to dry-run`,
        422,
      );
    }

    const result = await options.sandbox.run({
      content: version.content,
      tenantId,
      dryRun,
      parameters: version.parameters,
    });

    if (options.audit) {
      await options.audit.record({
        action: dryRun ? "scripts.dry_run" : "scripts.run",
        actorUserId: null,
        tenantId,
        resourceId: scriptId,
        correlationId: ctx.correlationId,
      });
    }

    return {
      status: 200,
      body: {
        scriptId,
        versionId: version.id,
        tenantId,
        dryRun,
        output: result.output,
        exitCode: result.exitCode,
        error: result.error ?? null,
        durationMs: result.durationMs ?? null,
      },
    };
  }

  return [
    { method: "GET", path: SCRIPTS_PATH, handler: handleList },
    { method: "POST", path: SCRIPTS_PATH, handler: handleCreate },
    { method: "GET", path: SCRIPT_DETAIL_PATH, handler: handleGet },
    { method: "PATCH", path: SCRIPT_DETAIL_PATH, handler: handlePatch },
    { method: "DELETE", path: SCRIPT_DETAIL_PATH, handler: handleDelete },
    { method: "GET", path: SCRIPT_VERSIONS_PATH, handler: handleListVersions },
    { method: "POST", path: SCRIPT_VERSIONS_PATH, handler: handleCreateVersion },
    { method: "POST", path: SCRIPT_RUN_PATH, handler: handleRun },
  ];
}

// ─── OpenAPI fragment (route modules publish their paths, §6) ────────────────

export const SCRIPTS_OPENAPI = {
  "/v1/scripts": {
    get: {
      tags: ["Scripts"],
      operationId: "listCustomScripts",
      summary: "List custom scripts.",
      permission: SCRIPTS_PERMISSIONS.read,
      security: [{ bearerAuth: [] }],
      responses: {
        "200": { description: "Scripts.", content: { "application/json": { schema: { $ref: "#/components/schemas/CustomScriptListResponse" } } } },
        "401": { description: "Unauthenticated.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "403": { description: "Forbidden.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
    post: {
      tags: ["Scripts"],
      operationId: "createCustomScript",
      summary: "Create a custom script and its first version.",
      permission: SCRIPTS_PERMISSIONS.write,
      security: [{ bearerAuth: [] }],
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CustomScriptCreateRequest" } } } },
      responses: {
        "201": { description: "Created.", content: { "application/json": { schema: { $ref: "#/components/schemas/CustomScriptResponse" } } } },
        "400": { description: "Invalid body.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "401": { description: "Unauthenticated.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "403": { description: "Forbidden.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
  "/v1/scripts/{scriptId}": {
    get: {
      tags: ["Scripts"],
      operationId: "getCustomScript",
      summary: "Read a custom script and its current version.",
      permission: SCRIPTS_PERMISSIONS.read,
      security: [{ bearerAuth: [] }],
      parameters: [{ name: "scriptId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "Script.", content: { "application/json": { schema: { $ref: "#/components/schemas/CustomScriptResponse" } } } },
        "404": { description: "Not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
    patch: {
      tags: ["Scripts"],
      operationId: "updateCustomScript",
      summary: "Update script flags and/or append a version.",
      permission: SCRIPTS_PERMISSIONS.write,
      security: [{ bearerAuth: [] }],
      parameters: [{ name: "scriptId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "Updated.", content: { "application/json": { schema: { $ref: "#/components/schemas/CustomScriptResponse" } } } },
        "404": { description: "Not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
    delete: {
      tags: ["Scripts"],
      operationId: "deleteCustomScript",
      summary: "Delete a custom script.",
      permission: SCRIPTS_PERMISSIONS.write,
      security: [{ bearerAuth: [] }],
      parameters: [{ name: "scriptId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "204": { description: "Deleted." },
        "404": { description: "Not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "501": { description: "Deletion unsupported.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
  "/v1/scripts/{scriptId}/versions": {
    get: {
      tags: ["Scripts"],
      operationId: "listCustomScriptVersions",
      summary: "List a script's versions (append-only).",
      permission: SCRIPTS_PERMISSIONS.read,
      security: [{ bearerAuth: [] }],
      parameters: [{ name: "scriptId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "200": { description: "Versions.", content: { "application/json": { schema: { $ref: "#/components/schemas/CustomScriptVersionListResponse" } } } },
        "404": { description: "Not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
    post: {
      tags: ["Scripts"],
      operationId: "createCustomScriptVersion",
      summary: "Append an immutable script version.",
      permission: SCRIPTS_PERMISSIONS.write,
      security: [{ bearerAuth: [] }],
      parameters: [{ name: "scriptId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "201": { description: "Version appended.", content: { "application/json": { schema: { $ref: "#/components/schemas/CustomScriptVersionResponse" } } } },
        "404": { description: "Not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
  "/v1/scripts/{scriptId}/run": {
    post: {
      tags: ["Scripts"],
      operationId: "runCustomScript",
      summary: "Dry-run or run a custom script (gated; scripts.run is higher privilege).",
      permission: SCRIPTS_PERMISSIONS.run,
      security: [{ bearerAuth: [] }],
      parameters: [{ name: "scriptId", in: "path", required: true, schema: { type: "string" } }],
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CustomScriptRunRequest" } } } },
      responses: {
        "200": { description: "Run result.", content: { "application/json": { schema: { $ref: "#/components/schemas/CustomScriptRunResponse" } } } },
        "403": { description: "Missing scripts.run or tenant out of scope.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "404": { description: "Not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "422": { description: "Dry-run contract not declared.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
} as const;
