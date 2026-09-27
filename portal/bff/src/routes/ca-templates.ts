// CaTemplate CRUD routes (EPIC-015 §6) over the repository in
// ../repository/ca-templates. Writes are gated behind RBAC `Tenant.ConditionalAccess.ReadWrite`; reads
// need `Tenant.ConditionalAccess.Read`. The gate is an injected `authorize` seam so EPIC-038's
// resolver can supply the real permission set without touching route code.
import { AppError, ErrorCodes, type ErrorDetail } from "../errors.js";
import { paginate, parsePagination } from "../pagination.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";
import {
  collectCreateIssues,
  collectUpdateIssues,
  type CaTemplateCreateInput,
  type CaTemplateRepository,
  type CaTemplateUpdateInput,
  type ValidationIssue,
} from "../repository/ca-templates.js";

export const CA_TEMPLATE_PERMISSIONS = {
  read: "Tenant.ConditionalAccess.Read",
  deploy: "Tenant.ConditionalAccess.ReadWrite",
} as const;

export const CA_TEMPLATE_ADMIN_SCOPE = "CIPP.Admin.*" as const;

export const ErrorCodesForbidden = "request.forbidden" as const;
export const ErrorCodesTemplateNotFound = "ca_template.not_found" as const;

/**
 * Request bodies are a server-level concern (owned by the foundation route
 * tickets). Until `RequestContext` carries a parsed `body`, handlers read it
 * through this seam; the default reads an optional `body` field so it picks the
 * value up automatically once the server populates it.
 *
 * `permissions` is the caller's resolved permission set (EPIC-038); it is absent
 * until the auth seam lands, so the default authorizer grants while the portal
 * is unauthenticated.
 */
export interface CaTemplateRequestContext extends RequestContext {
  readonly body?: unknown;
  readonly permissions?: readonly string[];
}

export type CaTemplateAuthorizer = (
  ctx: CaTemplateRequestContext,
  permission: string,
) => boolean;

export interface CaTemplateRouteOptions {
  readonly authorize?: CaTemplateAuthorizer;
  readonly readBody?: (ctx: CaTemplateRequestContext) => unknown;
}

function defaultAuthorize(ctx: CaTemplateRequestContext, permission: string): boolean {
  const granted = ctx.permissions;
  if (granted === undefined) {
    return true;
  }
  return (
    granted.includes(permission) ||
    granted.includes(CA_TEMPLATE_ADMIN_SCOPE) ||
    granted.includes("*")
  );
}

function defaultReadBody(ctx: CaTemplateRequestContext): unknown {
  return ctx.body;
}

function issueDetails(issues: ValidationIssue[]): ErrorDetail[] {
  return issues.map((issue) => ({ field: issue.field, reason: issue.reason }));
}

function requirePermission(
  ctx: CaTemplateRequestContext,
  permission: string,
  authorize: CaTemplateAuthorizer,
): void {
  if (!authorize(ctx, permission)) {
    throw new AppError(
      ErrorCodesForbidden,
      `Missing required permission '${permission}'`,
      403,
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function toCreateInput(body: Record<string, unknown>): CaTemplateCreateInput {
  const input: CaTemplateCreateInput = {
    name: (body["name"] ?? "") as string,
    policyJson: (body["policyJson"] ?? null) as Record<string, unknown>,
  };
  if (typeof body["id"] === "string") input.id = body["id"] as string;
  if (body["source"] !== undefined) input.source = body["source"] as string;
  if (body["category"] !== undefined) input.category = body["category"] as string | null;
  return input;
}

function toUpdateInput(body: Record<string, unknown>): CaTemplateUpdateInput {
  const input: CaTemplateUpdateInput = {};
  if (body["name"] !== undefined) input.name = body["name"] as string;
  if (body["policyJson"] !== undefined) input.policyJson = body["policyJson"] as Record<string, unknown>;
  if (body["source"] !== undefined) input.source = body["source"] as string;
  if (body["category"] !== undefined) input.category = body["category"] as string | null;
  return input;
}

function parseBody(
  ctx: CaTemplateRequestContext,
  readBody: (ctx: CaTemplateRequestContext) => unknown,
): Record<string, unknown> {
  const raw = readBody(ctx);
  if (typeof raw === "string") {
    try {
      return asRecord(JSON.parse(raw)) ?? invalidBody();
    } catch {
      throw new AppError(ErrorCodes.validationFailed, "Request body is not valid JSON", 400, [
        { field: "body", reason: "must be valid JSON" },
      ]);
    }
  }
  return asRecord(raw) ?? invalidBody();
}

function invalidBody(): never {
  throw new AppError(ErrorCodes.validationFailed, "Request body must be a JSON object", 400, [
    { field: "body", reason: "must be a JSON object" },
  ]);
}

export function createCaTemplateRoutes(
  repository: CaTemplateRepository,
  options: CaTemplateRouteOptions = {},
): Route[] {
  const authorize = options.authorize ?? defaultAuthorize;
  const readBody = options.readBody ?? defaultReadBody;

  return [
    {
      method: "GET",
      path: "/v1/ca-templates",
      handler: async (ctx): Promise<RouteResponse> => {
        requirePermission(ctx as CaTemplateRequestContext, CA_TEMPLATE_PERMISSIONS.read, authorize);
        const category = ctx.query.get("category") ?? undefined;
        const templates = await repository.list(
          category === undefined ? {} : { category },
        );
        const page = paginate(templates, parsePagination(ctx.query));
        return { status: 200, body: { items: page.items, nextCursor: page.nextCursor } };
      },
    },
    {
      method: "GET",
      path: "/v1/ca-templates/:id",
      handler: async (ctx): Promise<RouteResponse> => {
        requirePermission(ctx as CaTemplateRequestContext, CA_TEMPLATE_PERMISSIONS.read, authorize);
        const template = await repository.get(ctx.params["id"] ?? "");
        if (!template) {
          throw new AppError(ErrorCodesTemplateNotFound, "CA template not found", 404);
        }
        return { status: 200, body: template };
      },
    },
    {
      method: "GET",
      path: "/v1/ca-templates/:id/versions",
      handler: async (ctx): Promise<RouteResponse> => {
        requirePermission(ctx as CaTemplateRequestContext, CA_TEMPLATE_PERMISSIONS.read, authorize);
        const id = ctx.params["id"] ?? "";
        if (!(await repository.get(id, { includeDeleted: true }))) {
          throw new AppError(ErrorCodesTemplateNotFound, "CA template not found", 404);
        }
        return { status: 200, body: { items: await repository.listVersions(id) } };
      },
    },
    {
      method: "POST",
      path: "/v1/ca-templates",
      handler: async (ctx): Promise<RouteResponse> => {
        const context = ctx as CaTemplateRequestContext;
        requirePermission(context, CA_TEMPLATE_PERMISSIONS.deploy, authorize);
        const input = toCreateInput(parseBody(context, readBody));
        const issues = collectCreateIssues(input);
        if (issues.length > 0) {
          throw new AppError(ErrorCodes.validationFailed, "Invalid CA template", 400, issueDetails(issues));
        }
        const created = await repository.create(input);
        return { status: 201, body: created };
      },
    },
    {
      method: "PATCH",
      path: "/v1/ca-templates/:id",
      handler: async (ctx): Promise<RouteResponse> => {
        const context = ctx as CaTemplateRequestContext;
        requirePermission(context, CA_TEMPLATE_PERMISSIONS.deploy, authorize);
        const input = toUpdateInput(parseBody(context, readBody));
        const issues = collectUpdateIssues(input);
        if (issues.length > 0) {
          throw new AppError(ErrorCodes.validationFailed, "Invalid CA template", 400, issueDetails(issues));
        }
        const updated = await repository.update(ctx.params["id"] ?? "", input);
        if (!updated) {
          throw new AppError(ErrorCodesTemplateNotFound, "CA template not found", 404);
        }
        return { status: 200, body: updated };
      },
    },
    {
      method: "DELETE",
      path: "/v1/ca-templates/:id",
      handler: async (ctx): Promise<RouteResponse> => {
        const context = ctx as CaTemplateRequestContext;
        requirePermission(context, CA_TEMPLATE_PERMISSIONS.deploy, authorize);
        const removed = await repository.remove(ctx.params["id"] ?? "");
        if (!removed) {
          throw new AppError(ErrorCodesTemplateNotFound, "CA template not found", 404);
        }
        return { status: 204 };
      },
    },
  ];
}
