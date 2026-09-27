// Dashboard payload routes and RBAC-filtered widget registry (EPIC-004 SPEC.md §6, §7, §11.1, T-0062).
// Serves per-tenant dashboard payload, all-tenants fleet payload, and available widgets.
// Enforces dashboard.read RBAC permission and caller tenant scope. Omits unpermitted widgets.

import { AppError, ErrorCodes } from "../errors.js";
import {
  requirePermission,
  requireTenantInScope,
  isAdmin,
  hasPermission,
  type Caller,
} from "../rbac/authorize.js";
import { RunPermissions, type Permission } from "../rbac/roles.js";
import { isTenantAllowed } from "../rbac/scope.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";
export interface DashboardEmptyState {
  readonly isEmpty: true;
  readonly reason: "no_completed_run";
  readonly message: string;
}

export interface DashboardPayload {
  readonly schemaVersion: string;
  readonly tenantId: string;
  readonly tenantInfo: Record<string, unknown>;
  readonly isEmpty: boolean;
  readonly emptyState: DashboardEmptyState | null;
  readonly score: Record<string, unknown> | null;
  readonly assessment: Record<string, unknown> | null;
  readonly metrics: Record<string, unknown> | null;
  readonly alerts: Record<string, unknown> | null;
  readonly authMethods: Record<string, unknown> | null;
  readonly mfa: Record<string, unknown> | null;
  readonly licenses: Record<string, unknown> | null;
  readonly identity: Record<string, unknown> | null;
  readonly devices: Record<string, unknown> | null;
  readonly generatedAt: string;
}

export interface FleetTenantItem {
  readonly tenantId: string;
  readonly displayName: string | null;
  readonly defaultDomain: string | null;
  readonly status: string;
  readonly hasCompletedRun: boolean;
  readonly score: number | null;
  readonly complianceRate: number | null;
  readonly lastRunAt: string | null;
  readonly lastRunId: string | null;
  readonly lastRunStatus: string | null;
  readonly findingCounts: Record<string, unknown> | null;
  readonly openAlerts: Record<string, unknown>;
}

export interface FleetPayload {
  readonly schemaVersion: string;
  readonly items: readonly FleetTenantItem[];
  readonly total: number;
  readonly generatedAt: string;
}

export const DASHBOARD_TENANT_PATH = "/v1/dashboard/:tenantId";
export const DASHBOARD_FLEET_PATH = "/v1/dashboard";
export const DASHBOARD_WIDGETS_PATH = "/v1/dashboard/widgets";

export const DASHBOARD_READ_PERMISSION = "Portal.Dashboard.Read";
export const DASHBOARD_UNAUTHENTICATED = "request.unauthenticated";
export const DASHBOARD_FORBIDDEN = "auth.forbidden";
export const DASHBOARD_TENANT_NOT_FOUND = "tenant.not_found";

export interface StockWidgetDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: "overview" | "identity" | "devices" | "alerts" | "licensing" | string;
  readonly description: string;
  readonly requiredPermission: string;
  readonly defaultSize: { readonly width: number; readonly height: number };
}

export const STOCK_V1_WIDGETS: readonly StockWidgetDefinition[] = [
  {
    id: "TenantInfoCard",
    name: "Tenant Overview",
    category: "overview",
    description: "Tenant details, domains, and assessment status.",
    requiredPermission: "Portal.Dashboard.Read",
    defaultSize: { width: 4, height: 2 },
  },
  {
    id: "TenantMetricsGrid",
    name: "Key Metrics",
    category: "overview",
    description: "Headline score and security metric breakdown.",
    requiredPermission: "Portal.Dashboard.Read",
    defaultSize: { width: 4, height: 2 },
  },
  {
    id: "AssessmentCard",
    name: "Latest Assessment",
    category: "overview",
    description: "Assessment run results and pass/fail summary counts.",
    requiredPermission: "runs.read",
    defaultSize: { width: 4, height: 2 },
  },
  {
    id: "AlertsOverviewCard",
    name: "Alerts Overview",
    category: "alerts",
    description: "Open security alerts by severity (Critical, High, Medium, Low).",
    requiredPermission: "Tenant.Alert.Read",
    defaultSize: { width: 12, height: 2 },
  },
  {
    id: "SecureScoreCard",
    name: "Secure Score",
    category: "identity",
    description: "Compliance posture and benchmark score.",
    requiredPermission: "Portal.Dashboard.Read",
    defaultSize: { width: 3, height: 2 },
  },
  {
    id: "AuthMethodCard",
    name: "Authentication Methods",
    category: "identity",
    description: "Phishing-resistant, Authenticator, SMS, and password-only mix.",
    requiredPermission: "Identity.User.Read",
    defaultSize: { width: 3, height: 2 },
  },
  {
    id: "MFACard",
    name: "MFA Adoption",
    category: "identity",
    description: "Multi-Factor Authentication enforcement and registration coverage.",
    requiredPermission: "Identity.User.Read",
    defaultSize: { width: 3, height: 2 },
  },
  {
    id: "LicenseCard",
    name: "Licensing",
    category: "licensing",
    description: "License assignment and available seat counts.",
    requiredPermission: "Tenant.Licensing.Read",
    defaultSize: { width: 3, height: 2 },
  },
];

export interface DashboardRoutesStore {
  getTenantDashboard(
    tenantId: string,
    scope?: { all?: boolean; tenantIds?: readonly string[] } | readonly string[]
  ): Promise<DashboardPayload>;
  getFleetDashboard(
    scope?: { all?: boolean; tenantIds?: readonly string[] } | readonly string[]
  ): Promise<FleetPayload>;
}

export interface DashboardRoutesOptions {
  readonly store: DashboardRoutesStore;
  readonly resolveCaller: (ctx: RequestContext) => Caller | undefined;
  readonly authorize?: (caller: Caller, permission: string) => void | Promise<void>;
  readonly hasPermission?: (caller: Caller, permission: string) => boolean;
}

function checkCallerPermission(
  caller: Caller,
  permission: string,
  options: DashboardRoutesOptions
): boolean {
  if (options.hasPermission) {
    return options.hasPermission(caller, permission);
  }
  if (isAdmin(caller)) return true;

  const callerRec = caller as unknown as Record<string, unknown>;
  if (Array.isArray(callerRec["permissions"])) {
    return callerRec["permissions"].includes(permission);
  }
  if (callerRec["permissions"] instanceof Set) {
    return callerRec["permissions"].has(permission);
  }

  // Built-in roles check
  if (caller.roles.includes("admin")) return true;
  if (caller.roles.includes("operator")) {
    if (permission === "Portal.Dashboard.Read" || permission === RunPermissions.read) {
      return true;
    }
  }

  return false;
}

async function requireDashboardRead(
  caller: Caller,
  options: DashboardRoutesOptions
): Promise<void> {
  if (options.authorize) {
    await options.authorize(caller, DASHBOARD_READ_PERMISSION);
    return;
  }
  if (!checkCallerPermission(caller, DASHBOARD_READ_PERMISSION, options)) {
    throw new AppError(DASHBOARD_FORBIDDEN, "not permitted to read dashboard", 403, [
      { field: "permission", reason: DASHBOARD_READ_PERMISSION },
    ]);
  }
}

export function createDashboardWidgetsRoute(options: DashboardRoutesOptions): Route {
  return {
    method: "GET",
    path: DASHBOARD_WIDGETS_PATH,
    handler: async (ctx: RequestContext): Promise<RouteResponse> => {
      const caller = options.resolveCaller(ctx);
      if (!caller) {
        throw new AppError(DASHBOARD_UNAUTHENTICATED, "authentication required", 401);
      }

      await requireDashboardRead(caller, options);

      // Filter stock widgets by caller permissions: widgets caller cannot read are absent
      const allowedWidgets = STOCK_V1_WIDGETS.filter((w) =>
        checkCallerPermission(caller, w.requiredPermission, options)
      );

      return {
        status: 200,
        body: {
          items: allowedWidgets,
          count: allowedWidgets.length,
        },
      };
    },
  };
}

export function createDashboardTenantRoute(options: DashboardRoutesOptions): Route {
  return {
    method: "GET",
    path: DASHBOARD_TENANT_PATH,
    handler: async (ctx: RequestContext): Promise<RouteResponse> => {
      const caller = options.resolveCaller(ctx);
      if (!caller) {
        throw new AppError(DASHBOARD_UNAUTHENTICATED, "authentication required", 401);
      }

      const tenantId = ctx.params["tenantId"];
      if (!tenantId || tenantId.trim().length === 0) {
        throw new AppError(ErrorCodes.validationFailed, "tenantId is required", 400);
      }

      // Check dashboard.read
      await requireDashboardRead(caller, options);

      // Enforce caller tenant scope: structured 403 for out-of-scope tenant
      requireTenantInScope(caller, tenantId);

      try {
        const payload = await options.store.getTenantDashboard(tenantId, caller.tenantScope);
        return {
          status: 200,
          body: payload,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("outside caller scope")) {
          throw new AppError(DASHBOARD_FORBIDDEN, "tenant is outside the caller scope", 403, [
            { field: "tenantId", reason: "out_of_scope" },
          ]);
        }
        if (msg.includes("not found")) {
          throw new AppError(DASHBOARD_TENANT_NOT_FOUND, `Tenant '${tenantId}' not found`, 404);
        }
        throw err;
      }
    },
  };
}

export function createDashboardFleetRoute(options: DashboardRoutesOptions): Route {
  return {
    method: "GET",
    path: DASHBOARD_FLEET_PATH,
    handler: async (ctx: RequestContext): Promise<RouteResponse> => {
      const caller = options.resolveCaller(ctx);
      if (!caller) {
        throw new AppError(DASHBOARD_UNAUTHENTICATED, "authentication required", 401);
      }

      await requireDashboardRead(caller, options);

      const payload = await options.store.getFleetDashboard(caller.tenantScope);
      return {
        status: 200,
        body: payload,
      };
    },
  };
}

export function createDashboardRoutes(options: DashboardRoutesOptions): Route[] {
  return [
    // Register /widgets first so it does not collide with /:tenantId
    createDashboardWidgetsRoute(options),
    createDashboardTenantRoute(options),
    createDashboardFleetRoute(options),
  ];
}

export const DASHBOARD_OPENAPI = {
  "/v1/dashboard/widgets": {
    get: {
      tags: ["Dashboard"],
      summary: "List available dashboard widgets filtered by caller permissions",
      description:
        "Returns the catalog of stock v1 widgets that the caller has permission to view. Widgets requiring permissions the caller lacks are omitted.",
      operationId: "getDashboardWidgets",
      responses: {
        "200": {
          description: "List of permitted dashboard widgets.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  items: { type: "array", items: { type: "object" } },
                  count: { type: "integer" },
                },
                required: ["items", "count"],
              },
            },
          },
        },
        "401": { description: "Authentication required." },
        "403": { description: "Forbidden - caller lacks dashboard.read permission." },
      },
    },
  },
  "/v1/dashboard/{tenantId}": {
    get: {
      tags: ["Dashboard"],
      summary: "Get aggregated dashboard payload for a tenant",
      description:
        "Returns read-model metrics and widget data for the tenant from persisted runs and findings. Returns an explicit empty state if no completed assessment run exists.",
      operationId: "getTenantDashboard",
      parameters: [
        {
          name: "tenantId",
          in: "path",
          required: true,
          schema: { type: "string" },
          description: "Target tenant ID.",
        },
      ],
      responses: {
        "200": {
          description: "Tenant dashboard payload.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  schemaVersion: { type: "string", example: "v1" },
                  tenantId: { type: "string" },
                  isEmpty: { type: "boolean" },
                  emptyState: { type: "object", nullable: true },
                  score: { type: "object", nullable: true },
                  assessment: { type: "object", nullable: true },
                  metrics: { type: "object", nullable: true },
                  alerts: { type: "object", nullable: true },
                },
                required: ["schemaVersion", "tenantId", "isEmpty"],
              },
            },
          },
        },
        "401": { description: "Authentication required." },
        "403": { description: "Tenant is outside the caller scope or caller lacks dashboard.read." },
        "404": { description: "Tenant not found." },
      },
    },
  },
  "/v1/dashboard": {
    get: {
      tags: ["Dashboard"],
      summary: "Get all-tenants fleet dashboard payload",
      description:
        "Returns the fleet overview for all tenants within the caller's RBAC scope, with compliance rates, scores, and alert counts.",
      operationId: "getFleetDashboard",
      responses: {
        "200": {
          description: "Fleet dashboard payload.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  schemaVersion: { type: "string", example: "v1" },
                  items: { type: "array", items: { type: "object" } },
                  total: { type: "integer" },
                  generatedAt: { type: "string" },
                },
                required: ["schemaVersion", "items", "total", "generatedAt"],
              },
            },
          },
        },
        "401": { description: "Authentication required." },
        "403": { description: "Forbidden - caller lacks dashboard.read permission." },
      },
    },
  },
} as const;
