// Report template CRUD, clone, and generate-from-template (EPIC-005 SPEC.md §6,
// §3.3). The BFF stays thin: validation is the injected T-0081 contract, storage
// is the injected repository, and generation is the injected T-0084 render path.
// Writes are gated on `Tenant.ReportTemplate.ReadWrite` (SPEC §7); the concrete RBAC
// resolver is injected so this module does not depend on the auth implementation.
import { randomUUID } from "node:crypto";
import { AppError, ErrorCodes } from "../errors.js";
import { RbacErrorCodes } from "../rbac/authorize.js";
import { paginate, parsePagination } from "../pagination.js";
import type { RequestContext, RouteResponse } from "../server.js";

export const REPORT_TEMPLATE_PERMISSIONS = {
  read: "Tenant.Reports.Read",
  write: "Tenant.ReportTemplate.ReadWrite",
  generate: "Tenant.Reports.ReadWrite",
} as const;

export const REPORT_TEMPLATE_INVALID = "report_template.invalid";
export const REPORT_TEMPLATE_NOT_FOUND = "report_template.not_found";
export const REPORT_TEMPLATE_TENANT_REQUIRED = "report_template.tenant_required";

export interface StoredReportTemplate {
  id: string;
  name: string;
  tenantId: string | null;
  document: unknown;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateTemplateInput {
  id?: string;
  name: string;
  tenantId?: string | null;
  document: unknown;
  createdBy?: string | null;
  actorUserId?: string | null;
  correlationId?: string | null;
}

export interface UpdateTemplateInput {
  name?: string;
  document?: unknown;
  updatedBy?: string | null;
  actorUserId?: string | null;
  correlationId?: string | null;
}

export interface CloneTemplateInput {
  id?: string;
  name: string;
  tenantId?: string | null;
  createdBy?: string | null;
  actorUserId?: string | null;
  correlationId?: string | null;
}

export interface TemplateListOptions {
  tenantId?: string;
  includeDeleted?: boolean;
}

export interface TemplateReadOptions {
  tenantId?: string;
  includeDeleted?: boolean;
}

export interface ReportTemplateStore {
  createTemplate(input: CreateTemplateInput): Promise<StoredReportTemplate>;
  getTemplate(
    id: string,
    options?: TemplateReadOptions,
  ): Promise<StoredReportTemplate | undefined>;
  listTemplates(options?: TemplateListOptions): Promise<StoredReportTemplate[]>;
  updateTemplate(
    id: string,
    input: UpdateTemplateInput,
  ): Promise<StoredReportTemplate | undefined>;
  softDeleteTemplate(
    id: string,
    options?: { actorUserId?: string | null; correlationId?: string | null },
  ): Promise<boolean>;
  cloneTemplate(
    sourceId: string,
    input: CloneTemplateInput,
  ): Promise<StoredReportTemplate | undefined>;
}

// The T-0081 contract surface this route needs: parse/validate a block document
// and throw on an unknown type or a missing required setting.
export interface TemplateContract {
  parse(input: unknown): unknown;
}

export interface TemplateRenderRequest {
  readonly template: unknown;
  readonly templateId: string;
  readonly tenantId: string;
  readonly requestedBy: string | null;
  readonly correlationId: string;
}

export interface GeneratedReportHandle {
  readonly id: string;
  readonly templateId: string;
  readonly tenantId: string;
  readonly status: string;
  readonly artifactRef: string | null;
  readonly createdAt: string;
}

// T-0084's render path: enqueue a report job and return the GeneratedReport
// handle. Generation is asynchronous, so the route answers 202.
export interface TemplateRenderPort {
  enqueue(request: TemplateRenderRequest): Promise<GeneratedReportHandle>;
}

export interface TemplateAuthorizer {
  requirePermission(ctx: RequestContext, permission: string): void | Promise<void>;
}

export interface ReportTemplateDependencies {
  readonly store: ReportTemplateStore;
  readonly contract: TemplateContract;
  readonly render: TemplateRenderPort;
  readonly authorize?: TemplateAuthorizer;
  readonly resolveActor?: (ctx: RequestContext) => string | null;
  /**
   * Whether the caller may use a tenant's templates. Tenant templates outside the
   * caller's scope are hidden from lists and refused elsewhere; global templates
   * (no tenant) are open to every caller holding the permission. Omitted, every
   * tenant is allowed.
   */
  readonly tenantAccess?: (ctx: RequestContext, tenantId: string) => boolean;
}

// The HTTP server does not yet thread a parsed request body through
// RequestContext, so a body-aware context is declared here; the production
// wiring supplies `body` once server body handling lands.
export interface ReportTemplateRequest extends RequestContext {
  readonly body?: unknown;
}

export interface ReportTemplateRoute {
  readonly method: string;
  readonly path: string;
  readonly permission: string;
  readonly handler: (ctx: ReportTemplateRequest) => RouteResponse | Promise<RouteResponse>;
}

type Handler = ReportTemplateRoute["handler"];

export function createReportTemplateRoutes(deps: ReportTemplateDependencies): ReportTemplateRoute[] {
  const actor = (ctx: ReportTemplateRequest): string | null => deps.resolveActor?.(ctx) ?? null;

  const visible = (ctx: RequestContext, tenantId: string | null): boolean =>
    tenantId === null || deps.tenantAccess === undefined || deps.tenantAccess(ctx, tenantId);

  const requireAccess = (ctx: RequestContext, tenantId: string | null): void => {
    if (!visible(ctx, tenantId)) {
      throw new AppError(RbacErrorCodes.forbidden, "tenant is outside the caller scope", 403, [
        { field: "tenantId", reason: "out_of_scope" },
      ]);
    }
  };

  const guard = (permission: string, handler: Handler): Handler => async (ctx) => {
    if (deps.authorize) {
      await deps.authorize.requirePermission(ctx, permission);
    }
    return handler(ctx);
  };

  const list: Handler = async (ctx) => {
    const tenantId = optionalQuery(ctx, "tenantId");
    if (tenantId !== undefined) requireAccess(ctx, tenantId);
    const includeDeleted = ctx.query.get("includeDeleted") === "true";
    const templates = (await deps.store.listTemplates({ tenantId, includeDeleted })).filter((t) =>
      visible(ctx, t.tenantId),
    );
    const page = paginate(templates, parsePagination(ctx.query));
    return {
      status: 200,
      body: { items: page.items.map(toResponse), nextCursor: page.nextCursor },
    };
  };

  const create: Handler = async (ctx) => {
    const body = requireBodyRecord(ctx.body);
    const name = requireString(body, "name");
    const id = randomUUID();
    const tenantId = body["tenantId"] === undefined ? null : optionalString(body, "tenantId");
    requireAccess(ctx, tenantId);
    const document = parseTemplateDocument(deps.contract, body["document"], id, name);
    const created = await deps.store.createTemplate({
      id,
      name,
      tenantId,
      document,
      createdBy: actor(ctx),
      actorUserId: actor(ctx),
      correlationId: ctx.correlationId,
    });
    return { status: 201, body: toResponse(created) };
  };

  const get: Handler = async (ctx) => {
    const template = requireTemplate(
      await deps.store.getTemplate(requireParam(ctx, "templateId"), {
        tenantId: optionalQuery(ctx, "tenantId"),
      }),
    );
    requireAccess(ctx, template.tenantId);
    return { status: 200, body: toResponse(template) };
  };

  const update: Handler = async (ctx) => {
    const id = requireParam(ctx, "templateId");
    const existing = requireTemplate(
      await deps.store.getTemplate(id, { tenantId: optionalQuery(ctx, "tenantId") }),
    );
    requireAccess(ctx, existing.tenantId);
    const body = requireBodyRecord(ctx.body);
    const name = body["name"] === undefined ? undefined : requireString(body, "name");
    const document =
      body["document"] === undefined
        ? existing.document
        : parseTemplateDocument(deps.contract, body["document"], id, name ?? existing.name);
    const updated = await deps.store.updateTemplate(id, {
      name,
      document,
      updatedBy: actor(ctx),
      actorUserId: actor(ctx),
      correlationId: ctx.correlationId,
    });
    return { status: 200, body: toResponse(requireTemplate(updated)) };
  };

  const remove: Handler = async (ctx) => {
    const id = requireParam(ctx, "templateId");
    requireAccess(ctx, requireTemplate(await deps.store.getTemplate(id)).tenantId);
    const deleted = await deps.store.softDeleteTemplate(id, {
      actorUserId: actor(ctx),
      correlationId: ctx.correlationId,
    });
    if (!deleted) throw notFound(id);
    return { status: 204 };
  };

  const clone: Handler = async (ctx) => {
    const sourceId = requireParam(ctx, "templateId");
    const source = requireTemplate(
      await deps.store.getTemplate(sourceId, { includeDeleted: false }),
    );
    requireAccess(ctx, source.tenantId);
    const body = optionalBodyRecord(ctx.body);
    const name =
      body === undefined || body["name"] === undefined
        ? `${source.name} (copy)`
        : requireString(body, "name");
    const tenantId =
      body === undefined || body["tenantId"] === undefined
        ? source.tenantId
        : optionalString(body, "tenantId");
    requireAccess(ctx, tenantId);
    const cloned = await deps.store.cloneTemplate(sourceId, {
      id: randomUUID(),
      name,
      tenantId,
      createdBy: actor(ctx),
      actorUserId: actor(ctx),
      correlationId: ctx.correlationId,
    });
    return { status: 201, body: toResponse(requireTemplate(cloned)) };
  };

  const generate: Handler = async (ctx) => {
    const templateId = requireParam(ctx, "templateId");
    const template = requireTemplate(
      await deps.store.getTemplate(templateId, { includeDeleted: false }),
    );
    requireAccess(ctx, template.tenantId);
    const body = optionalBodyRecord(ctx.body);
    const tenantId =
      body === undefined || body["tenantId"] === undefined
        ? template.tenantId
        : optionalString(body, "tenantId");
    if (tenantId === null) throw tenantRequired();
    requireAccess(ctx, tenantId);
    const handle = await deps.render.enqueue({
      template: template.document,
      templateId: template.id,
      tenantId,
      requestedBy: actor(ctx),
      correlationId: ctx.correlationId,
    });
    return { status: 202, body: handle };
  };

  return [
    {
      method: "GET",
      path: "/v1/report-templates",
      permission: REPORT_TEMPLATE_PERMISSIONS.read,
      handler: guard(REPORT_TEMPLATE_PERMISSIONS.read, list),
    },
    {
      method: "POST",
      path: "/v1/report-templates",
      permission: REPORT_TEMPLATE_PERMISSIONS.write,
      handler: guard(REPORT_TEMPLATE_PERMISSIONS.write, create),
    },
    {
      method: "GET",
      path: "/v1/report-templates/:templateId",
      permission: REPORT_TEMPLATE_PERMISSIONS.read,
      handler: guard(REPORT_TEMPLATE_PERMISSIONS.read, get),
    },
    {
      method: "PATCH",
      path: "/v1/report-templates/:templateId",
      permission: REPORT_TEMPLATE_PERMISSIONS.write,
      handler: guard(REPORT_TEMPLATE_PERMISSIONS.write, update),
    },
    {
      method: "DELETE",
      path: "/v1/report-templates/:templateId",
      permission: REPORT_TEMPLATE_PERMISSIONS.write,
      handler: guard(REPORT_TEMPLATE_PERMISSIONS.write, remove),
    },
    {
      method: "POST",
      path: "/v1/report-templates/:templateId/clone",
      permission: REPORT_TEMPLATE_PERMISSIONS.write,
      handler: guard(REPORT_TEMPLATE_PERMISSIONS.write, clone),
    },
    {
      method: "POST",
      path: "/v1/report-templates/:templateId/generate",
      permission: REPORT_TEMPLATE_PERMISSIONS.generate,
      handler: guard(REPORT_TEMPLATE_PERMISSIONS.generate, generate),
    },
  ];
}

function toResponse(template: StoredReportTemplate): Record<string, unknown> {
  return {
    id: template.id,
    name: template.name,
    tenantId: template.tenantId,
    document: template.document,
    createdBy: template.createdBy,
    updatedBy: template.updatedBy,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

function requireTemplate(
  template: StoredReportTemplate | undefined,
): StoredReportTemplate {
  if (!template || template.deletedAt !== null) {
    throw notFound(template?.id);
  }
  return template;
}

function requireParam(ctx: RequestContext, name: string): string {
  const value = ctx.params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new AppError(ErrorCodes.validationFailed, `Missing path parameter '${name}'`, 400, [
      { field: name, reason: "required" },
    ]);
  }
  return value;
}

function optionalQuery(ctx: RequestContext, name: string): string | undefined {
  const value = ctx.query.get(name);
  return value !== null && value.length > 0 ? value : undefined;
}

function parseBody(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      throw new AppError(ErrorCodes.validationFailed, "Request body is not valid JSON", 400, [
        { field: "body", reason: "invalid_json" },
      ]);
    }
  }
  return value ?? {};
}

function requireBodyRecord(value: unknown): Record<string, unknown> {
  const parsed = parseBody(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AppError(ErrorCodes.validationFailed, "Request body must be a JSON object", 400, [
      { field: "body", reason: "invalid" },
    ]);
  }
  return parsed as Record<string, unknown>;
}

function optionalBodyRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requireBodyRecord(value);
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

function parseTemplateDocument(
  contract: TemplateContract,
  document: unknown,
  id: string,
  name: string,
): unknown {
  const parsed = parseBody(document);
  const base =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  try {
    return contract.parse({ ...base, id, name });
  } catch (error) {
    throw toValidationError(error);
  }
}

function toValidationError(error: unknown): AppError {
  const record =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const reason = typeof record["code"] === "string" ? record["code"] : "report.invalid";
  const path = typeof record["path"] === "string" ? record["path"] : "document";
  const message = error instanceof Error ? error.message : "Invalid report template document";
  return new AppError(REPORT_TEMPLATE_INVALID, message, 400, [{ field: path, reason }]);
}

function notFound(id: string | undefined): AppError {
  return new AppError(
    REPORT_TEMPLATE_NOT_FOUND,
    id === undefined ? "Report template not found" : `Report template ${id} not found`,
    404,
  );
}

function tenantRequired(): AppError {
  return new AppError(
    REPORT_TEMPLATE_TENANT_REQUIRED,
    "Generating a report requires a tenantId",
    400,
    [{ field: "tenantId", reason: "required" }],
  );
}
