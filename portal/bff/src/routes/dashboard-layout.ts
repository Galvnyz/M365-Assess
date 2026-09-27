// Dashboard layout API (EPIC-004 SPEC §4.3, §6). GET returns the caller's
// layout for the requested tenant (falling back to their default and finally the
// stock layout); PUT saves it, or restores the stock layout when the body asks
// to reset. Layouts are keyed by the authenticated caller's userId — the body
// can never name another owner — and the OpenAPI path item is published here so
// `portal.v1.yaml` stays untouched (EPIC-001 SPEC §1).
import { AppError, ErrorCodes } from "../errors.js";
import type { RequestContext, Route, RouteHandler } from "../server.js";

export const DASHBOARD_LAYOUT_PATH = "/v1/dashboard/layout";

export type DashboardLayoutScope = "global" | "tenant";

export interface DashboardWidgetSize {
  readonly width: number;
  readonly height: number;
}

export interface DashboardWidgetPlacement {
  readonly id: string;
  readonly position: number;
  readonly size: DashboardWidgetSize;
  readonly settings: Record<string, unknown>;
}

export interface DashboardLayout {
  readonly id: string;
  readonly userId: string;
  readonly scope: DashboardLayoutScope;
  readonly tenantId: string | null;
  readonly widgets: DashboardWidgetPlacement[];
  readonly isDefault: boolean;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface DashboardLayoutStore {
  getLayout(
    userId: string,
    lookup?: { tenantId?: string | null },
  ): Promise<DashboardLayout>;
  saveLayout(
    userId: string,
    input: { tenantId?: string | null; widgets: readonly DashboardWidgetPlacement[] },
  ): Promise<DashboardLayout>;
  resetLayout(
    userId: string,
    lookup?: { tenantId?: string | null },
  ): Promise<DashboardLayout>;
}

export interface CallerIdentity {
  readonly userId: string;
}

export interface DashboardLayoutRequest {
  readonly caller: CallerIdentity;
  readonly tenantId: string | null;
  readonly body?: unknown;
}

export interface DashboardLayoutResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export const DashboardLayoutErrorCodes = {
  unauthenticated: "request.unauthenticated",
} as const;

function validationError(message: string): AppError {
  return new AppError(ErrorCodes.validationFailed, message, 400);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => CallerIdentity | undefined,
  ctx: RequestContext,
): CallerIdentity {
  const caller = resolveCaller(ctx);
  if (!caller || caller.userId.trim().length === 0) {
    throw new AppError(
      DashboardLayoutErrorCodes.unauthenticated,
      "authentication required",
      401,
    );
  }
  return caller;
}

function readTenantId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeWidget(value: unknown, index: number): DashboardWidgetPlacement {
  if (!isRecord(value)) throw validationError(`widgets[${index}] must be an object`);
  const id = value["id"];
  if (typeof id !== "string" || id.trim().length === 0) {
    throw validationError(`widgets[${index}].id must be a non-empty string`);
  }
  const position = value["position"];
  if (typeof position !== "number" || !Number.isFinite(position)) {
    throw validationError(`widgets[${index}].position must be a number`);
  }
  const size = isRecord(value["size"]) ? value["size"] : {};
  const width = size["width"];
  const height = size["height"];
  if (typeof width !== "number" || typeof height !== "number") {
    throw validationError(`widgets[${index}].size must have numeric width and height`);
  }
  const settings = value["settings"];
  if (settings !== undefined && !isRecord(settings)) {
    throw validationError(`widgets[${index}].settings must be an object`);
  }
  return {
    id: id.trim(),
    position,
    size: { width, height },
    settings: isRecord(settings) ? { ...settings } : {},
  };
}

function normalizeWidgets(value: unknown): DashboardWidgetPlacement[] {
  if (!Array.isArray(value)) throw validationError("widgets must be an array");
  return value.map((widget, index) => normalizeWidget(widget, index));
}

export async function getDashboardLayout(
  store: DashboardLayoutStore,
  request: DashboardLayoutRequest,
): Promise<DashboardLayoutResponse> {
  const layout = await store.getLayout(request.caller.userId, { tenantId: request.tenantId });
  return { status: 200, body: { layout } };
}

export async function putDashboardLayout(
  store: DashboardLayoutStore,
  request: DashboardLayoutRequest,
): Promise<DashboardLayoutResponse> {
  const body = request.body;
  if (!isRecord(body)) throw validationError("request body must be a JSON object");

  if (body["reset"] === true) {
    const layout = await store.resetLayout(request.caller.userId, { tenantId: request.tenantId });
    return { status: 200, body: { layout } };
  }

  const widgets = normalizeWidgets(body["widgets"]);
  const layout = await store.saveLayout(request.caller.userId, {
    tenantId: request.tenantId,
    widgets,
  });
  return { status: 200, body: { layout } };
}

export interface DashboardLayoutRouteOptions {
  readonly store: DashboardLayoutStore;
  readonly resolveCaller: (ctx: RequestContext) => CallerIdentity | undefined;
  readonly readBody?: (ctx: RequestContext) => unknown;
}

function defaultReadBody(ctx: RequestContext): unknown {
  return (ctx as RequestContext & { body?: unknown }).body;
}

export function createDashboardLayoutRoutes(options: DashboardLayoutRouteOptions): Route[] {
  const readBody = options.readBody ?? defaultReadBody;

  const get: RouteHandler = async (ctx) => {
    const caller = requireCaller(options.resolveCaller, ctx);
    const result = await getDashboardLayout(options.store, {
      caller,
      tenantId: readTenantId(ctx.query.get("tenantId")),
    });
    return { status: result.status, body: result.body };
  };

  const put: RouteHandler = async (ctx) => {
    const caller = requireCaller(options.resolveCaller, ctx);
    const body = readBody(ctx);
    const tenantId =
      readTenantId(ctx.query.get("tenantId")) ??
      readTenantId(isRecord(body) ? body["tenantId"] : undefined);
    const result = await putDashboardLayout(options.store, { caller, tenantId, body });
    return { status: result.status, body: result.body };
  };

  return [
    { method: "GET", path: DASHBOARD_LAYOUT_PATH, handler: get },
    { method: "PUT", path: DASHBOARD_LAYOUT_PATH, handler: put },
  ];
}

export const DASHBOARD_LAYOUT_OPENAPI = {
  paths: {
    "/dashboard/layout": {
      get: {
        operationId: "getDashboardLayout",
        summary: "Load the caller's dashboard layout for a tenant",
        permission: "Portal.Dashboard.Read",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "tenantId",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Tenant override to load; omit for the caller's global default.",
          },
        ],
        responses: {
          "200": { description: "The resolved dashboard layout." },
          "401": { description: "Authentication required." },
        },
      },
      put: {
        operationId: "putDashboardLayout",
        summary: "Save or reset the caller's dashboard layout for a tenant",
        permission: "Portal.Dashboard.ReadWrite",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "tenantId",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Tenant override to save; omit for the caller's global default.",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  reset: { type: "boolean" },
                  tenantId: { type: "string" },
                  widgets: {
                    type: "array",
                    items: { $ref: "#/components/schemas/DashboardWidgetPlacement" },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "The saved or reset dashboard layout." },
          "400": { description: "Invalid layout body." },
          "401": { description: "Authentication required." },
        },
      },
    },
  },
  schemas: {
    DashboardWidgetPlacement: {
      type: "object",
      additionalProperties: false,
      required: ["id", "position", "size"],
      properties: {
        id: { type: "string" },
        position: { type: "integer" },
        size: {
          type: "object",
          required: ["width", "height"],
          properties: {
            width: { type: "integer" },
            height: { type: "integer" },
          },
        },
        settings: { type: "object", additionalProperties: true },
      },
    },
  },
} as const;
