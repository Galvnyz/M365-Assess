// Endpoint permission registry (EPIC-038 SPEC §4.1, §7). Every API endpoint
// resolves to exactly one permission; the completeness test in
// permissions.test.ts fails the build when an endpoint lacks one.
//
// The registry is projected from endpoint metadata owned by the route modules
// (path and permission constants plus the OpenAPI fragments the wiring ticket
// merges into portal.v1.yaml), so permission values are referenced, never
// retyped. The served contract document keeps `paths: {}` by design; the
// per-module fragments are the machine-readable source this file derives from.
import { OPENAPI_ROUTE } from "../server.js";
import {
  API_CLIENT_PATH,
  API_CLIENT_ROTATE_PATH,
  API_CLIENTS_OPENAPI,
  API_CLIENTS_PATH,
} from "../routes/api-clients.js";
import {
  BASELINES_CATALOG_PATH,
  BASELINES_CATALOG_PERMISSION,
} from "../routes/baselines-catalog.js";
import { CA_TEMPLATE_PERMISSIONS } from "../routes/ca-templates.js";
import {
  DASHBOARD_LAYOUT_OPENAPI,
  DASHBOARD_LAYOUT_PATH,
} from "../routes/dashboard-layout.js";
import {
  CVE_EXCEPTION_PATH,
  CVE_EXCEPTIONS_PATH,
  DEFENDER_READ_PERMISSION as CVE_EXCEPTION_READ_PERMISSION,
  DEFENDER_WRITE_PERMISSION as CVE_EXCEPTION_WRITE_PERMISSION,
} from "../routes/defender-cve-exceptions.js";
import {
  DEFENDER_TEMPLATE_PATH,
  DEFENDER_TEMPLATE_READ_PERMISSION,
  DEFENDER_TEMPLATE_WRITE_PERMISSION,
  DEFENDER_TEMPLATES_PATH,
} from "../routes/defender-templates.js";
import {
  DEVICE_ACTIONS_HISTORY_OPENAPI,
  DEVICE_ACTIONS_HISTORY_PATH,
} from "../routes/device-actions-history.js";
import {
  GROUP_TEMPLATE_ITEM_PATH,
  GROUP_TEMPLATES_PATH,
  GROUP_TEMPLATES_PERMISSION,
} from "../routes/group-templates.js";
import { HEALTH_PATH } from "../routes/health.js";
import { INTUNE_TEMPLATE_PERMISSIONS } from "../routes/intune-templates.js";
import { CREDENTIALS_OPENAPI } from "../routes/credentials.js";
import { DEVICE_BITLOCKER_OPENAPI } from "../routes/device-bitlocker.js";
import { DEVICE_LAPS_OPENAPI } from "../routes/device-laps.js";
import {
  ASSIGNMENT_FILTER_PATH,
  ASSIGNMENT_FILTER_PERMISSIONS,
  ASSIGNMENT_FILTERS_PATH,
  FILTER_TEMPLATE_DEPLOY_PATH,
  FILTER_TEMPLATE_PATH,
  FILTER_TEMPLATES_PATH,
} from "../routes/intune-assignment-filters.js";
import { INTUNE_COMPARE_PATH, INTUNE_COMPARE_PERMISSION } from "../routes/intune-compare.js";
import { INTUNE_CRUD_BASE_PATH, INTUNE_CRUD_ITEM_PATH } from "../routes/intune-policies-crud.js";
import { INTUNE_POLICIES_PATH, INTUNE_READ_PERMISSION, INTUNE_WRITE_PERMISSION } from "../routes/intune-policies.js";
import {
  REUSABLE_SETTING_TEMPLATE_PATH,
  REUSABLE_SETTING_TEMPLATES_PATH,
  REUSABLE_SETTINGS_PATH,
  REUSABLE_SETTINGS_PERMISSIONS,
  REUSABLE_SETTINGS_SYNC_PATH,
} from "../routes/intune-reusable-settings.js";
import { INTUNE_TEMPLATE_DEPLOY_PATH } from "../routes/intune-templates-deploy.js";
import { GDAP_OPENAPI } from "../routes/gdap.js";
import { ONBOARD_OPENAPI } from "../routes/onboard.js";
import { TENANT_GROUPS_OPENAPI } from "../routes/tenant-groups.js";
import { TENANT_VARIABLES_OPENAPI } from "../routes/tenant-variables.js";
import { TENANTS_OPENAPI } from "../routes/tenants.js";
import { TEST_CONNECTION_OPENAPI } from "../routes/test-connection.js";
import { REPORT_TEMPLATE_PERMISSIONS } from "../routes/report-templates.js";

// `Public` bypasses permission evaluation (SPEC §4.1 item 4). It is the only
// single-segment value the registry may hold.
export const PUBLIC_PERMISSION = "Public" as const;

// Reserved caller defaults (SPEC §4.1 item 4). These describe how the caller
// authenticated, never what an endpoint requires, so no registry entry may
// use them.
export const RESERVED_PERMISSIONS = Object.freeze(["anonymous", "authenticated"] as const);

// Admin-surface endpoints whose route module declares paths and OpenAPI
// operations but no permission constant yet (SPEC §7: admin surface requires
// the CIPP.Admin family).
export const API_CLIENT_PERMISSIONS = {
  read: "CIPP.ApiClients.Read",
  readWrite: "CIPP.ApiClients.ReadWrite",
} as const;

/** An OpenAPI fragment whose operations carry `permission` (and usually `operationId`). */
export interface PermissionedOpenApiFragment {
  readonly paths: Readonly<
    Record<string, Readonly<Record<string, { readonly permission: string; readonly operationId?: string }>>>
  >;
}

/**
 * Registry entries projected from a route module's OpenAPI fragment, so mounted modules
 * register by reference: `/tenants/{id}` + get -> GET /v1/tenants/:id.
 */
export function registryEntriesFromOpenApi(fragment: PermissionedOpenApiFragment): PermissionRegistryEntry[] {
  const entries: PermissionRegistryEntry[] = [];
  for (const [openApiPath, operations] of Object.entries(fragment.paths)) {
    const routePath = openApiPath.replace(/\{([^/{}]+)\}/g, ":$1");
    // Most fragments key paths without the /v1 prefix; a few already include it.
    const path = routePath.startsWith("/v1/") ? routePath : `/v1${routePath}`;
    for (const [method, operation] of Object.entries(operations)) {
      entries.push({
        method: method.toUpperCase(),
        path,
        permission: operation.permission,
        ...(operation.operationId ? { operationId: operation.operationId } : {}),
      });
    }
  }
  return entries;
}

export interface PermissionRegistryEntry {
  readonly method: string;
  readonly path: string;
  readonly permission: string;
  readonly operationId?: string;
}

const API_CLIENTS_LIST_OPERATIONS = API_CLIENTS_OPENAPI.paths["/api-clients"];
const API_CLIENT_OPERATIONS = API_CLIENTS_OPENAPI.paths["/api-clients/{id}"];
const API_CLIENT_ROTATE_OPERATIONS = API_CLIENTS_OPENAPI.paths["/api-clients/{id}/rotate-secret"];
const DASHBOARD_LAYOUT_OPERATIONS = DASHBOARD_LAYOUT_OPENAPI.paths["/dashboard/layout"];
const DEVICE_ACTIONS_HISTORY_OPERATION =
  DEVICE_ACTIONS_HISTORY_OPENAPI.paths["/tenants/{tenantId}/devices/{deviceId}/actions"].get;

export const PermissionRegistry: readonly PermissionRegistryEntry[] = Object.freeze([
  { method: "GET", path: OPENAPI_ROUTE, permission: PUBLIC_PERMISSION },
  // Liveness probe: reports no tenant data (EPIC-001 SPEC §6).
  { method: "GET", path: HEALTH_PATH, permission: PUBLIC_PERMISSION },
  { method: "GET", path: BASELINES_CATALOG_PATH, permission: BASELINES_CATALOG_PERMISSION },
  { method: "GET", path: GROUP_TEMPLATES_PATH, permission: GROUP_TEMPLATES_PERMISSION },
  { method: "POST", path: GROUP_TEMPLATES_PATH, permission: GROUP_TEMPLATES_PERMISSION },
  { method: "GET", path: GROUP_TEMPLATE_ITEM_PATH, permission: GROUP_TEMPLATES_PERMISSION },
  { method: "PATCH", path: GROUP_TEMPLATE_ITEM_PATH, permission: GROUP_TEMPLATES_PERMISSION },
  { method: "DELETE", path: GROUP_TEMPLATE_ITEM_PATH, permission: GROUP_TEMPLATES_PERMISSION },
  {
    method: "GET",
    path: API_CLIENTS_PATH,
    permission: API_CLIENT_PERMISSIONS.read,
    operationId: API_CLIENTS_LIST_OPERATIONS.get.operationId,
  },
  {
    method: "POST",
    path: API_CLIENTS_PATH,
    permission: API_CLIENT_PERMISSIONS.readWrite,
    operationId: API_CLIENTS_LIST_OPERATIONS.post.operationId,
  },
  {
    method: "GET",
    path: API_CLIENT_PATH,
    permission: API_CLIENT_PERMISSIONS.read,
    operationId: API_CLIENT_OPERATIONS.get.operationId,
  },
  {
    method: "PATCH",
    path: API_CLIENT_PATH,
    permission: API_CLIENT_PERMISSIONS.readWrite,
    operationId: API_CLIENT_OPERATIONS.patch.operationId,
  },
  {
    method: "DELETE",
    path: API_CLIENT_PATH,
    permission: API_CLIENT_PERMISSIONS.readWrite,
    operationId: API_CLIENT_OPERATIONS.delete.operationId,
  },
  {
    method: "POST",
    path: API_CLIENT_ROTATE_PATH,
    permission: API_CLIENT_PERMISSIONS.readWrite,
    operationId: API_CLIENT_ROTATE_OPERATIONS.post.operationId,
  },
  { method: "GET", path: "/v1/ca-templates", permission: CA_TEMPLATE_PERMISSIONS.read },
  { method: "POST", path: "/v1/ca-templates", permission: CA_TEMPLATE_PERMISSIONS.deploy },
  { method: "GET", path: "/v1/ca-templates/:id", permission: CA_TEMPLATE_PERMISSIONS.read },
  { method: "PATCH", path: "/v1/ca-templates/:id", permission: CA_TEMPLATE_PERMISSIONS.deploy },
  { method: "DELETE", path: "/v1/ca-templates/:id", permission: CA_TEMPLATE_PERMISSIONS.deploy },
  {
    method: "GET",
    path: "/v1/ca-templates/:id/versions",
    permission: CA_TEMPLATE_PERMISSIONS.read,
  },
  {
    method: "GET",
    path: DASHBOARD_LAYOUT_PATH,
    permission: DASHBOARD_LAYOUT_OPERATIONS.get.permission,
    operationId: DASHBOARD_LAYOUT_OPERATIONS.get.operationId,
  },
  {
    method: "PUT",
    path: DASHBOARD_LAYOUT_PATH,
    permission: DASHBOARD_LAYOUT_OPERATIONS.put.permission,
    operationId: DASHBOARD_LAYOUT_OPERATIONS.put.operationId,
  },
  {
    method: "GET",
    path: DEFENDER_TEMPLATES_PATH,
    permission: DEFENDER_TEMPLATE_READ_PERMISSION,
  },
  {
    method: "GET",
    path: DEFENDER_TEMPLATE_PATH,
    permission: DEFENDER_TEMPLATE_READ_PERMISSION,
  },
  {
    method: "POST",
    path: DEFENDER_TEMPLATES_PATH,
    permission: DEFENDER_TEMPLATE_WRITE_PERMISSION,
  },
  {
    method: "PATCH",
    path: DEFENDER_TEMPLATE_PATH,
    permission: DEFENDER_TEMPLATE_WRITE_PERMISSION,
  },
  {
    method: "DELETE",
    path: DEFENDER_TEMPLATE_PATH,
    permission: DEFENDER_TEMPLATE_WRITE_PERMISSION,
  },
  {
    method: "GET",
    path: CVE_EXCEPTIONS_PATH,
    permission: CVE_EXCEPTION_READ_PERMISSION,
  },
  {
    method: "POST",
    path: CVE_EXCEPTIONS_PATH,
    permission: CVE_EXCEPTION_WRITE_PERMISSION,
  },
  {
    method: "PATCH",
    path: CVE_EXCEPTION_PATH,
    permission: CVE_EXCEPTION_WRITE_PERMISSION,
  },
  {
    method: "DELETE",
    path: CVE_EXCEPTION_PATH,
    permission: CVE_EXCEPTION_WRITE_PERMISSION,
  },
  {
    method: "GET",
    path: DEVICE_ACTIONS_HISTORY_PATH,
    permission: DEVICE_ACTIONS_HISTORY_OPERATION.permission,
    operationId: DEVICE_ACTIONS_HISTORY_OPERATION.operationId,
  },
  { method: "GET", path: "/v1/intune-templates", permission: INTUNE_TEMPLATE_PERMISSIONS.read },
  {
    method: "POST",
    path: "/v1/intune-templates",
    permission: INTUNE_TEMPLATE_PERMISSIONS.templates,
  },
  {
    method: "GET",
    path: "/v1/intune-templates/:id",
    permission: INTUNE_TEMPLATE_PERMISSIONS.read,
  },
  {
    method: "PATCH",
    path: "/v1/intune-templates/:id",
    permission: INTUNE_TEMPLATE_PERMISSIONS.templates,
  },
  {
    method: "DELETE",
    path: "/v1/intune-templates/:id",
    permission: INTUNE_TEMPLATE_PERMISSIONS.templates,
  },
  {
    method: "GET",
    path: "/v1/report-templates",
    permission: REPORT_TEMPLATE_PERMISSIONS.read,
  },
  {
    method: "POST",
    path: "/v1/report-templates",
    permission: REPORT_TEMPLATE_PERMISSIONS.write,
  },
  {
    method: "GET",
    path: "/v1/report-templates/:templateId",
    permission: REPORT_TEMPLATE_PERMISSIONS.read,
  },
  {
    method: "PATCH",
    path: "/v1/report-templates/:templateId",
    permission: REPORT_TEMPLATE_PERMISSIONS.write,
  },
  {
    method: "DELETE",
    path: "/v1/report-templates/:templateId",
    permission: REPORT_TEMPLATE_PERMISSIONS.write,
  },
  {
    method: "POST",
    path: "/v1/report-templates/:templateId/clone",
    permission: REPORT_TEMPLATE_PERMISSIONS.write,
  },
  {
    method: "POST",
    path: "/v1/report-templates/:templateId/generate",
    permission: REPORT_TEMPLATE_PERMISSIONS.generate,
  },
  // EPIC-002 tenant area (T-0822), projected from each module's OpenAPI fragment.
  ...registryEntriesFromOpenApi(TENANTS_OPENAPI),
  ...registryEntriesFromOpenApi(TENANT_GROUPS_OPENAPI),
  ...registryEntriesFromOpenApi(TENANT_VARIABLES_OPENAPI),
  ...registryEntriesFromOpenApi(CREDENTIALS_OPENAPI),
  ...registryEntriesFromOpenApi(GDAP_OPENAPI),
  ...registryEntriesFromOpenApi(ONBOARD_OPENAPI),
  ...registryEntriesFromOpenApi(TEST_CONNECTION_OPENAPI),
  // EPIC-016 Intune (T-0820). Specific /intune/* paths precede the generic /intune/:kind
  // entries, mirroring the mount order in app.ts. Deploy routes also require write
  // semantics; the registry records their template permission.
  { method: "GET", path: INTUNE_COMPARE_PATH, permission: INTUNE_COMPARE_PERMISSION },
  { method: "GET", path: REUSABLE_SETTINGS_PATH, permission: REUSABLE_SETTINGS_PERMISSIONS.read },
  { method: "POST", path: REUSABLE_SETTINGS_PATH, permission: REUSABLE_SETTINGS_PERMISSIONS.write },
  { method: "POST", path: REUSABLE_SETTINGS_SYNC_PATH, permission: REUSABLE_SETTINGS_PERMISSIONS.write },
  { method: "GET", path: REUSABLE_SETTING_TEMPLATES_PATH, permission: REUSABLE_SETTINGS_PERMISSIONS.read },
  { method: "POST", path: REUSABLE_SETTING_TEMPLATES_PATH, permission: REUSABLE_SETTINGS_PERMISSIONS.templates },
  { method: "GET", path: REUSABLE_SETTING_TEMPLATE_PATH, permission: REUSABLE_SETTINGS_PERMISSIONS.read },
  { method: "PATCH", path: REUSABLE_SETTING_TEMPLATE_PATH, permission: REUSABLE_SETTINGS_PERMISSIONS.templates },
  { method: "DELETE", path: REUSABLE_SETTING_TEMPLATE_PATH, permission: REUSABLE_SETTINGS_PERMISSIONS.templates },
  { method: "GET", path: ASSIGNMENT_FILTERS_PATH, permission: ASSIGNMENT_FILTER_PERMISSIONS.read },
  { method: "POST", path: ASSIGNMENT_FILTERS_PATH, permission: ASSIGNMENT_FILTER_PERMISSIONS.write },
  { method: "PATCH", path: ASSIGNMENT_FILTER_PATH, permission: ASSIGNMENT_FILTER_PERMISSIONS.write },
  { method: "DELETE", path: ASSIGNMENT_FILTER_PATH, permission: ASSIGNMENT_FILTER_PERMISSIONS.write },
  { method: "GET", path: FILTER_TEMPLATES_PATH, permission: ASSIGNMENT_FILTER_PERMISSIONS.read },
  { method: "POST", path: FILTER_TEMPLATES_PATH, permission: ASSIGNMENT_FILTER_PERMISSIONS.templates },
  { method: "GET", path: FILTER_TEMPLATE_PATH, permission: ASSIGNMENT_FILTER_PERMISSIONS.read },
  { method: "PATCH", path: FILTER_TEMPLATE_PATH, permission: ASSIGNMENT_FILTER_PERMISSIONS.templates },
  { method: "DELETE", path: FILTER_TEMPLATE_PATH, permission: ASSIGNMENT_FILTER_PERMISSIONS.templates },
  { method: "POST", path: FILTER_TEMPLATE_DEPLOY_PATH, permission: ASSIGNMENT_FILTER_PERMISSIONS.templates },
  { method: "POST", path: INTUNE_TEMPLATE_DEPLOY_PATH, permission: INTUNE_TEMPLATE_PERMISSIONS.templates },
  { method: "GET", path: INTUNE_POLICIES_PATH, permission: INTUNE_READ_PERMISSION },
  { method: "POST", path: INTUNE_CRUD_BASE_PATH, permission: INTUNE_WRITE_PERMISSION },
  { method: "PATCH", path: INTUNE_CRUD_ITEM_PATH, permission: INTUNE_WRITE_PERMISSION },
  { method: "DELETE", path: INTUNE_CRUD_ITEM_PATH, permission: INTUNE_WRITE_PERMISSION },
  // EPIC-018 device key reveal (T-0820).
  ...registryEntriesFromOpenApi(DEVICE_BITLOCKER_OPENAPI),
  ...registryEntriesFromOpenApi(DEVICE_LAPS_OPENAPI),
]);

// SPEC §11 item 2 taxonomy: `{Area}.{Resource}.{Action}` — two or three
// dot-separated segments. `Public` is the documented bypass marker and the
// only value allowed outside the taxonomy.
const PERMISSION_PATTERN = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*){1,2}$/;

export function isPermissionString(value: string): boolean {
  if (value === PUBLIC_PERMISSION) {
    return true;
  }
  return PERMISSION_PATTERN.test(value);
}

export function isPublicPermission(value: string): boolean {
  return value === PUBLIC_PERMISSION;
}

export function isReservedPermission(value: string): boolean {
  return (RESERVED_PERMISSIONS as readonly string[]).includes(value);
}

function splitPath(path: string): string[] {
  const withoutQuery = path.split("?")[0] ?? "";
  const trimmed = withoutQuery.trim();
  const rooted = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return rooted.split("/").filter((segment) => segment.length > 0);
}

function isPathParam(segment: string): boolean {
  return segment.startsWith(":") || /^\{[^/{}]+\}$/.test(segment);
}

// A registry pattern matches a concrete path when every segment is equal or
// the pattern side carries a parameter (`:id` server-side, `{id}` OpenAPI
// style). Lengths must agree so a prefix never matches a longer route.
function pathMatches(pattern: string, actual: string): boolean {
  const patternSegments = splitPath(pattern);
  const actualSegments = splitPath(actual);
  if (patternSegments.length !== actualSegments.length) {
    return false;
  }
  return patternSegments.every(
    (segment, index) =>
      segment === actualSegments[index] ||
      isPathParam(segment) ||
      isPathParam(actualSegments[index] as string),
  );
}

// Route modules mount every path beneath /v1 while their OpenAPI fragments
// publish the same path without the prefix; accept both spellings.
function withVersionPrefix(path: string): string | undefined {
  const segments = splitPath(path);
  if (segments.length === 0 || segments[0] === "v1") {
    return undefined;
  }
  return `/v1/${segments.join("/")}`;
}

function lookupPermission(method: string, path: string): string | undefined {
  const want = method.toUpperCase();
  const prefixed = withVersionPrefix(path);
  const candidates = prefixed === undefined ? [path] : [path, prefixed];
  for (const candidate of candidates) {
    for (const entry of PermissionRegistry) {
      if (entry.method.toUpperCase() === want && pathMatches(entry.path, candidate)) {
        return entry.permission;
      }
    }
  }
  return undefined;
}

export interface EndpointRef {
  readonly method: string;
  readonly path: string;
  readonly permission?: unknown;
}

// Maps an endpoint to its declared permission. A route object that already
// carries its own `permission` (the direction the template routes took: the
// permission travels with the route) resolves from that metadata; otherwise
// the lookup falls back to the registry table. Returns `undefined` when no
// permission is declared — the completeness test treats that as a failure.
export function permissionForEndpoint(route: EndpointRef): string | undefined;
export function permissionForEndpoint(method: string, path: string): string | undefined;
export function permissionForEndpoint(
  routeOrMethod: EndpointRef | string,
  path?: string,
): string | undefined {
  if (typeof routeOrMethod === "string") {
    return lookupPermission(routeOrMethod, path ?? "");
  }
  const carried = routeOrMethod.permission;
  if (typeof carried === "string" && carried.length > 0) {
    return carried;
  }
  return lookupPermission(routeOrMethod.method, routeOrMethod.path);
}
