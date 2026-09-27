// Defender deployment-template CRUD routes (EPIC-019 §5, §11.4; SPEC §7).
// Reads require `Security.Defender.Read` and writes require `Security.Defender.ReadWrite`; the
// permission travels with each route so the EPIC-038 registry can publish it.
// Every handler is tenant-scoped by the `:tenantId` path parameter and never
// touches a tenant — templates are portal-local records.
import { randomUUID } from "node:crypto";
import { AppError, ErrorCodes, type ErrorDetail } from "../errors.js";
import { paginate, parsePagination } from "../pagination.js";
import {
  type DefenderDeploymentTemplateInput,
  type DefenderDeploymentTemplatePatch,
  type DefenderDeploymentTemplateRepository,
  validatePolicyAreas,
  validatePolicyJson,
  validateTemplateName,
} from "../repository/defender-deployment-templates.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const DEFENDER_TEMPLATE_READ_PERMISSION = "Security.Defender.Read";
export const DEFENDER_TEMPLATE_WRITE_PERMISSION = "Security.Defender.ReadWrite";

export const DEFENDER_TEMPLATES_PATH = "/v1/tenants/:tenantId/defender/templates";
export const DEFENDER_TEMPLATE_PATH = "/v1/tenants/:tenantId/defender/templates/:templateId";

export interface DefenderTemplateRoute extends Route {
  readonly permission: string;
}

function validationError(message: string, details?: ErrorDetail[]): AppError {
  return new AppError(ErrorCodes.validationFailed, message, 400, details);
}

function notFound(templateId: string): AppError {
  return new AppError(
    ErrorCodes.routeNotFound,
    `defender deployment template ${templateId} not found`,
    404,
  );
}

function tenantIdFrom(ctx: RequestContext): string {
  const tenantId = ctx.params["tenantId"];
  if (tenantId === undefined || tenantId.length === 0) {
    throw validationError("tenantId is required", [{ field: "tenantId", reason: "missing" }]);
  }
  return tenantId;
}

function templateIdFrom(ctx: RequestContext): string {
  const templateId = ctx.params["templateId"];
  if (templateId === undefined || templateId.length === 0) {
    throw validationError("templateId is required", [{ field: "templateId", reason: "missing" }]);
  }
  return templateId;
}

function readJsonBody(ctx: RequestContext): Record<string, unknown> {
  const raw = (ctx as RequestContext & { readonly body?: unknown }).body;
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      throw validationError("request body must be well-formed JSON");
    }
    throw validationError("request body must be a JSON object");
  }
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  throw validationError("request body must be a JSON object");
}

function toCreateInput(ctx: RequestContext, tenantId: string): DefenderDeploymentTemplateInput {
  const body = readJsonBody(ctx);
  return {
    id: randomUUID(),
    tenantId,
    name: validateTemplateName(body["name"]),
    policyAreas: validatePolicyAreas(body["policyAreas"]),
    policyJson: validatePolicyJson(body["policyJson"]),
  };
}

function toPatch(ctx: RequestContext): DefenderDeploymentTemplatePatch {
  const body = readJsonBody(ctx);
  const patch: DefenderDeploymentTemplatePatch = {};
  if ("name" in body) {
    patch.name = validateTemplateName(body["name"]);
  }
  if ("policyAreas" in body) {
    patch.policyAreas = validatePolicyAreas(body["policyAreas"]);
  }
  if ("policyJson" in body) {
    patch.policyJson = validatePolicyJson(body["policyJson"]);
  }
  return patch;
}

export function createDefenderTemplateRoutes(
  repository: DefenderDeploymentTemplateRepository,
): DefenderTemplateRoute[] {
  return [
    {
      method: "GET",
      path: DEFENDER_TEMPLATES_PATH,
      permission: DEFENDER_TEMPLATE_READ_PERMISSION,
      handler: async (ctx): Promise<RouteResponse> => {
        const tenantId = tenantIdFrom(ctx);
        const policyArea = ctx.query.get("policyArea") ?? undefined;
        const templates = await repository.list(tenantId, { policyArea });
        return { status: 200, body: paginate(templates, parsePagination(ctx.query)) };
      },
    },
    {
      method: "GET",
      path: DEFENDER_TEMPLATE_PATH,
      permission: DEFENDER_TEMPLATE_READ_PERMISSION,
      handler: async (ctx): Promise<RouteResponse> => {
        const tenantId = tenantIdFrom(ctx);
        const templateId = templateIdFrom(ctx);
        const template = await repository.get(tenantId, templateId);
        if (!template) throw notFound(templateId);
        return { status: 200, body: template };
      },
    },
    {
      method: "POST",
      path: DEFENDER_TEMPLATES_PATH,
      permission: DEFENDER_TEMPLATE_WRITE_PERMISSION,
      handler: async (ctx): Promise<RouteResponse> => {
        const tenantId = tenantIdFrom(ctx);
        const template = await repository.create(toCreateInput(ctx, tenantId));
        return { status: 201, body: template };
      },
    },
    {
      method: "PATCH",
      path: DEFENDER_TEMPLATE_PATH,
      permission: DEFENDER_TEMPLATE_WRITE_PERMISSION,
      handler: async (ctx): Promise<RouteResponse> => {
        const tenantId = tenantIdFrom(ctx);
        const templateId = templateIdFrom(ctx);
        const updated = await repository.update(tenantId, templateId, toPatch(ctx));
        if (!updated) throw notFound(templateId);
        return { status: 200, body: updated };
      },
    },
    {
      method: "DELETE",
      path: DEFENDER_TEMPLATE_PATH,
      permission: DEFENDER_TEMPLATE_WRITE_PERMISSION,
      handler: async (ctx): Promise<RouteResponse> => {
        const tenantId = tenantIdFrom(ctx);
        const templateId = templateIdFrom(ctx);
        const deleted = await repository.softDelete(tenantId, templateId);
        if (!deleted) throw notFound(templateId);
        return { status: 200, body: { deleted: true, id: templateId } };
      },
    },
  ];
}
