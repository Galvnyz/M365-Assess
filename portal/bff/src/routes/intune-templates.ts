// IntuneTemplate CRUD routes (EPIC-016 §6) over the repository in
// ../repository/intune-templates. Template management is gated behind RBAC
// `Endpoint.IntuneTemplate.ReadWrite`; reads need `Endpoint.Intune.Read` (SPEC §7). The gate is an injected
// `authorize` seam so EPIC-038's resolver can supply the real permission set
// without touching route code.
import { AppError, ErrorCodes, type ErrorDetail } from "../errors.js";
import { paginate, parsePagination } from "../pagination.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";
import {
  collectCreateIssues,
  collectUpdateIssues,
  type IntuneAssignment,
  type IntuneTemplateCreateInput,
  type IntuneTemplateRepository,
  type IntuneTemplateUpdateInput,
  type ValidationIssue,
} from "../repository/intune-templates.js";

export const INTUNE_TEMPLATE_PERMISSIONS = {
  read: "Endpoint.Intune.Read",
  templates: "Endpoint.IntuneTemplate.ReadWrite",
} as const;

export const INTUNE_TEMPLATE_ADMIN_SCOPE = "CIPP.Admin.*" as const;

export const ErrorCodesForbidden = "request.forbidden" as const;
export const ErrorCodesTemplateNotFound = "intune_template.not_found" as const;

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
export interface IntuneTemplateRequestContext extends RequestContext {
  readonly body?: unknown;
  readonly permissions?: readonly string[];
}

export type IntuneTemplateAuthorizer = (
  ctx: IntuneTemplateRequestContext,
  permission: string,
) => boolean;

export interface IntuneTemplateRouteOptions {
  readonly authorize?: IntuneTemplateAuthorizer;
  readonly readBody?: (ctx: IntuneTemplateRequestContext) => unknown;
}

function defaultAuthorize(ctx: IntuneTemplateRequestContext, permission: string): boolean {
  const granted = ctx.permissions;
  if (granted === undefined) {
    return true;
  }
  return (
    granted.includes(permission) ||
    granted.includes(INTUNE_TEMPLATE_ADMIN_SCOPE) ||
    granted.includes("*")
  );
}

function defaultReadBody(ctx: IntuneTemplateRequestContext): unknown {
  return ctx.body;
}

function issueDetails(issues: ValidationIssue[]): ErrorDetail[] {
  return issues.map((issue) => ({ field: issue.field, reason: issue.reason }));
}

function requirePermission(
  ctx: IntuneTemplateRequestContext,
  permission: string,
  authorize: IntuneTemplateAuthorizer,
): void {
  if (!authorize(ctx, permission)) {
    throw new AppError(ErrorCodesForbidden, `Missing required permission '${permission}'`, 403);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function toAssignments(value: unknown): IntuneAssignment[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? (value as IntuneAssignment[]) : undefined;
}

function toCreateInput(body: Record<string, unknown>): IntuneTemplateCreateInput {
  const input: IntuneTemplateCreateInput = {
    name: (body["name"] ?? "") as string,
    platform: (body["platform"] ?? "") as string,
    policyType: (body["policyType"] ?? "") as string,
    policyJson: (body["policyJson"] ?? null) as Record<string, unknown>,
  };
  if (typeof body["id"] === "string") input.id = body["id"] as string;
  const assignments = toAssignments(body["assignments"]);
  if (assignments !== undefined) input.assignments = assignments;
  if (body["source"] !== undefined) input.source = body["source"] as string;
  return input;
}

function toUpdateInput(body: Record<string, unknown>): IntuneTemplateUpdateInput {
  const input: IntuneTemplateUpdateInput = {};
  if (body["name"] !== undefined) input.name = body["name"] as string;
  if (body["platform"] !== undefined) input.platform = body["platform"] as string;
  if (body["policyType"] !== undefined) input.policyType = body["policyType"] as string;
  if (body["policyJson"] !== undefined) input.policyJson = body["policyJson"] as Record<string, unknown>;
  const assignments = toAssignments(body["assignments"]);
  if (assignments !== undefined) input.assignments = assignments;
  if (body["source"] !== undefined) input.source = body["source"] as string;
  return input;
}

function parseBody(
  ctx: IntuneTemplateRequestContext,
  readBody: (ctx: IntuneTemplateRequestContext) => unknown,
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

export function createIntuneTemplateRoutes(
  repository: IntuneTemplateRepository,
  options: IntuneTemplateRouteOptions = {},
): Route[] {
  const authorize = options.authorize ?? defaultAuthorize;
  const readBody = options.readBody ?? defaultReadBody;

  return [
    {
      method: "GET",
      path: "/v1/intune-templates",
      handler: async (ctx): Promise<RouteResponse> => {
        requirePermission(
          ctx as IntuneTemplateRequestContext,
          INTUNE_TEMPLATE_PERMISSIONS.read,
          authorize,
        );
        const platform = ctx.query.get("platform") ?? undefined;
        const policyType = ctx.query.get("policyType") ?? undefined;
        const templates = await repository.list({ platform, policyType });
        const page = paginate(templates, parsePagination(ctx.query));
        return { status: 200, body: { items: page.items, nextCursor: page.nextCursor } };
      },
    },
    {
      method: "GET",
      path: "/v1/intune-templates/:id",
      handler: async (ctx): Promise<RouteResponse> => {
        requirePermission(
          ctx as IntuneTemplateRequestContext,
          INTUNE_TEMPLATE_PERMISSIONS.read,
          authorize,
        );
        const template = await repository.get(ctx.params["id"] ?? "");
        if (!template) {
          throw new AppError(ErrorCodesTemplateNotFound, "Intune template not found", 404);
        }
        return { status: 200, body: template };
      },
    },
    {
      method: "POST",
      path: "/v1/intune-templates",
      handler: async (ctx): Promise<RouteResponse> => {
        const context = ctx as IntuneTemplateRequestContext;
        requirePermission(context, INTUNE_TEMPLATE_PERMISSIONS.templates, authorize);
        const input = toCreateInput(parseBody(context, readBody));
        const issues = collectCreateIssues(input);
        if (issues.length > 0) {
          throw new AppError(
            ErrorCodes.validationFailed,
            "Invalid Intune template",
            400,
            issueDetails(issues),
          );
        }
        const created = await repository.create(input);
        return { status: 201, body: created };
      },
    },
    {
      method: "PATCH",
      path: "/v1/intune-templates/:id",
      handler: async (ctx): Promise<RouteResponse> => {
        const context = ctx as IntuneTemplateRequestContext;
        requirePermission(context, INTUNE_TEMPLATE_PERMISSIONS.templates, authorize);
        const input = toUpdateInput(parseBody(context, readBody));
        const issues = collectUpdateIssues(input);
        if (issues.length > 0) {
          throw new AppError(
            ErrorCodes.validationFailed,
            "Invalid Intune template",
            400,
            issueDetails(issues),
          );
        }
        const updated = await repository.update(ctx.params["id"] ?? "", input);
        if (!updated) {
          throw new AppError(ErrorCodesTemplateNotFound, "Intune template not found", 404);
        }
        return { status: 200, body: updated };
      },
    },
    {
      method: "DELETE",
      path: "/v1/intune-templates/:id",
      handler: async (ctx): Promise<RouteResponse> => {
        const context = ctx as IntuneTemplateRequestContext;
        requirePermission(context, INTUNE_TEMPLATE_PERMISSIONS.templates, authorize);
        const removed = await repository.remove(ctx.params["id"] ?? "");
        if (!removed) {
          throw new AppError(ErrorCodesTemplateNotFound, "Intune template not found", 404);
        }
        return { status: 204 };
      },
    },
  ];
}
