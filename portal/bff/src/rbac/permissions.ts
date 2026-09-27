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
import {
  INTUNE_POLICIES_PATH,
  INTUNE_POLICY_PATH,
  INTUNE_READ_PERMISSION,
  INTUNE_WRITE_PERMISSION,
} from "../routes/intune-policies.js";
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
import { REPORTS_PERMISSIONS } from "../routes/reports.js";
import { REMEDIATION_OPENAPI } from "../routes/remediation.js";
import { SCHEDULE_PERMISSIONS, SCHEDULE_SYSTEM_PATH, SCHEDULES_OPENAPI } from "../routes/schedules.js";
import { SCRIPTS_OPENAPI } from "../routes/scripts.js";
import { BASELINE_ADVANCE_PATH, BASELINE_ADVANCE_PERMISSION } from "../routes/baselines-advance.js";
import { BASELINE_ALIGNMENT_PATH, BASELINE_ALIGNMENT_PERMISSION } from "../routes/baselines-alignment.js";
import { BASELINES_FLEET_OPENAPI } from "../routes/baselines-fleet.js";
import { BASELINE_MIGRATE_PATH } from "../routes/baselines-migrate.js";
import { BASELINES_OPENAPI, BASELINES_PERMISSIONS } from "../routes/baselines.js";
import { DRIFT_BULK_OPENAPI } from "../routes/drift-bulk.js";
import { DRIFT_DENY_OPENAPI } from "../routes/drift-deny.js";
import { DRIFT_REPORT_OPENAPI } from "../routes/drift-report.js";
import { DRIFT_TRIAGE_OPENAPI } from "../routes/drift-triage.js";
import { DRIFT_OPENAPI } from "../routes/drift.js";
import { STANDARDS_ALIGNMENT_OPENAPI } from "../routes/standards-alignment.js";
import { STANDARDS_CATALOG_OPENAPI } from "../routes/standards-catalog.js";
import { STANDARDS_RUN_OPENAPI } from "../routes/standards-run.js";
import { STANDARDS_TEMPLATES_OPENAPI } from "../routes/standards-templates.js";
import {
  DASHBOARD_FLEET_PATH,
  DASHBOARD_READ_PERMISSION,
  DASHBOARD_TENANT_PATH,
  DASHBOARD_WIDGETS_PATH,
} from "../routes/dashboard.js";
import { CA_COVERAGE_PATH, CA_HISTORY_PATH, CA_READ_PERMISSION } from "../routes/ca-coverage.js";
import {
  CA_NAMED_LOCATIONS_BASE_PATH,
  CA_NAMED_LOCATIONS_ITEM_PATH,
  CA_WRITE_PERMISSION,
} from "../routes/ca-named-locations.js";
import { CA_POLICIES_BASE_PATH, CA_POLICIES_ITEM_PATH } from "../routes/ca-policies-crud.js";
import { CA_REPORT_ONLY_PATH } from "../routes/ca-report-only.js";
import { CA_DEPLOY_PERMISSION, CA_TEMPLATE_DEPLOY_PATH } from "../routes/ca-templates-deploy.js";
import { GROUP_TEMPLATE_DEPLOY_PATH } from "../routes/group-templates-deploy.js";
import { GROUPS_BASE_PATH, GROUPS_ITEM_PATH, GROUPS_WRITE_PERMISSION } from "../routes/groups-crud.js";
import { GROUP_DELIVERY_PATH, GROUP_GAL_PATH } from "../routes/groups-gal.js";
import { GROUPS_READ_PERMISSION } from "../routes/groups-list.js";
import { GROUP_MEMBERS_BULK_PATH, GROUP_OWNERS_BULK_PATH } from "../routes/groups-members.js";
import { GROUP_USAGE_PATH } from "../routes/groups-usage.js";
import { BEC_OPENAPI } from "../routes/bec.js";
import { OFFBOARDING_OPENAPI } from "../routes/offboarding.js";
import { USER_TEMPLATES_OPENAPI } from "../routes/user-templates.js";
import { USERS_OPENAPI } from "../routes/users.js";
import { AUTH_METHODS_POLICY_OPENAPI } from "../routes/auth-methods-policy.js";
import { MFA_OPENAPI } from "../routes/mfa.js";
import {
  JIT_GRANT_EXTEND_PATH,
  JIT_GRANT_REVOKE_PATH,
  JIT_GRANTS_PATH,
  ROLES_READ_PERMISSION,
  ROLES_WRITE_PERMISSION,
} from "../routes/jit-grants.js";
import { JIT_TEMPLATE_ITEM_PATH, JIT_TEMPLATES_PATH } from "../routes/jit-templates.js";
import { PIM_ASSIGNMENTS_PATH } from "../routes/pim.js";
import { PIM_REQUEST_ITEM_PATH, PIM_REQUEST_TRANSITION_PATH, PIM_REQUESTS_PATH } from "../routes/pim-requests.js";
import {
  PIM_TEMPLATE_APPLY_PATH,
  PIM_TEMPLATE_COMPARE_PATH,
  PIM_TEMPLATE_ITEM_PATH,
  PIM_TEMPLATES_PATH,
  REMEDIATION_APPLY_PERMISSION as PIM_APPLY_PERMISSION,
} from "../routes/pim-settings-templates.js";
import { ROLE_ASSIGNMENTS_PATH } from "../routes/roles.js";
import { RUNS_CANCEL_PATH, RUNS_RETRY_PATH } from "../routes/runs-actions.js";
import { RUNS_ARTIFACTS_DOWNLOAD_PATH, RUNS_ARTIFACTS_LIST_PATH } from "../routes/runs-artifacts.js";
import { RUNS_CREATE_PATH } from "../routes/runs-create.js";
import { RUNS_DETAIL_PATH, RUNS_RESULTS_PATH } from "../routes/runs-detail.js";
import { RUNS_EVENTS_PATH } from "../routes/runs-events.js";
import { RUNS_LIST_PATH } from "../routes/runs-list.js";
import {
  REGISTRATION_CAMPAIGN_PATH,
  REGISTRATION_CAMPAIGN_READ_PERMISSION,
  REGISTRATION_CAMPAIGN_WRITE_PERMISSION,
} from "../routes/registration-campaign.js";

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
  { method: "GET", path: INTUNE_POLICY_PATH, permission: INTUNE_READ_PERMISSION },
  { method: "POST", path: INTUNE_CRUD_BASE_PATH, permission: INTUNE_WRITE_PERMISSION },
  { method: "PATCH", path: INTUNE_CRUD_ITEM_PATH, permission: INTUNE_WRITE_PERMISSION },
  { method: "DELETE", path: INTUNE_CRUD_ITEM_PATH, permission: INTUNE_WRITE_PERMISSION },
  // EPIC-004 dashboards and EPIC-005 reports (T-0823). /widgets precedes /:tenantId.
  { method: "GET", path: DASHBOARD_WIDGETS_PATH, permission: DASHBOARD_READ_PERMISSION },
  { method: "GET", path: DASHBOARD_TENANT_PATH, permission: DASHBOARD_READ_PERMISSION },
  { method: "GET", path: DASHBOARD_FLEET_PATH, permission: DASHBOARD_READ_PERMISSION },
  { method: "POST", path: "/v1/reports/executive", permission: REPORTS_PERMISSIONS.generate },
  { method: "POST", path: "/v1/reports/render", permission: REPORTS_PERMISSIONS.generate },
  { method: "GET", path: "/v1/reports", permission: REPORTS_PERMISSIONS.read },
  { method: "GET", path: "/v1/reports/:id/download", permission: REPORTS_PERMISSIONS.read },
  { method: "POST", path: "/v1/reports/:id/bundle", permission: REPORTS_PERMISSIONS.generate },
  // EPIC-006 remediation and EPIC-007 schedules and scripts (T-0824).
  ...registryEntriesFromOpenApi({ paths: REMEDIATION_OPENAPI }),
  ...registryEntriesFromOpenApi(SCHEDULES_OPENAPI),
  // System schedules are read-only; these writes exist only to refuse with 409.
  { method: "POST", path: SCHEDULE_SYSTEM_PATH, permission: SCHEDULE_PERMISSIONS.write },
  { method: "PATCH", path: SCHEDULE_SYSTEM_PATH, permission: SCHEDULE_PERMISSIONS.write },
  { method: "DELETE", path: SCHEDULE_SYSTEM_PATH, permission: SCHEDULE_PERMISSIONS.write },
  ...registryEntriesFromOpenApi({ paths: SCRIPTS_OPENAPI }),
  // EPIC-008 standards, EPIC-009 drift, and EPIC-010 baselines (T-0825).
  ...registryEntriesFromOpenApi({ paths: STANDARDS_CATALOG_OPENAPI }),
  ...registryEntriesFromOpenApi({ paths: STANDARDS_TEMPLATES_OPENAPI }),
  ...registryEntriesFromOpenApi({ paths: STANDARDS_RUN_OPENAPI }),
  ...registryEntriesFromOpenApi({ paths: STANDARDS_ALIGNMENT_OPENAPI }),
  ...registryEntriesFromOpenApi({ paths: DRIFT_OPENAPI }),
  ...registryEntriesFromOpenApi({ paths: DRIFT_REPORT_OPENAPI }),
  ...registryEntriesFromOpenApi({ paths: DRIFT_TRIAGE_OPENAPI }),
  ...registryEntriesFromOpenApi({ paths: DRIFT_DENY_OPENAPI }),
  ...registryEntriesFromOpenApi({ paths: DRIFT_BULK_OPENAPI }),
  ...registryEntriesFromOpenApi({ paths: BASELINES_FLEET_OPENAPI }),
  ...registryEntriesFromOpenApi({ paths: BASELINES_OPENAPI }),
  // These fragments name the baseline parameter {id}; the routes mount :baselineId.
  { method: "POST", path: BASELINE_ADVANCE_PATH, permission: BASELINE_ADVANCE_PERMISSION },
  { method: "GET", path: BASELINE_ALIGNMENT_PATH, permission: BASELINE_ALIGNMENT_PERMISSION },
  { method: "POST", path: BASELINE_MIGRATE_PATH, permission: BASELINES_PERMISSIONS.write },
  // EPIC-001/003 runs (T-0821). The route modules check the EPIC-001 names (runs.read,
  // runs.create, runs.cancel, runs.retry), which app.ts translates to these.
  { method: "GET", path: RUNS_LIST_PATH, permission: "Tenant.Runs.Read" },
  { method: "POST", path: RUNS_CREATE_PATH, permission: "Tenant.Runs.ReadWrite" },
  { method: "GET", path: RUNS_DETAIL_PATH, permission: "Tenant.Runs.Read" },
  { method: "GET", path: RUNS_RESULTS_PATH, permission: "Tenant.Runs.Read" },
  { method: "POST", path: RUNS_CANCEL_PATH, permission: "Tenant.Runs.ReadWrite" },
  { method: "POST", path: RUNS_RETRY_PATH, permission: "Tenant.Runs.ReadWrite" },
  { method: "GET", path: RUNS_ARTIFACTS_LIST_PATH, permission: "Tenant.Runs.Read" },
  { method: "GET", path: RUNS_ARTIFACTS_DOWNLOAD_PATH, permission: "Tenant.Runs.Read" },
  { method: "GET", path: RUNS_EVENTS_PATH, permission: "Tenant.Runs.Read" },
  // EPIC-011 users, BEC, offboarding, and user templates (T-0818).
  ...registryEntriesFromOpenApi(USERS_OPENAPI),
  ...registryEntriesFromOpenApi(BEC_OPENAPI),
  ...registryEntriesFromOpenApi(OFFBOARDING_OPENAPI),
  ...registryEntriesFromOpenApi(USER_TEMPLATES_OPENAPI),
  // EPIC-012 MFA, authentication methods, and the registration campaign (T-0818).
  ...registryEntriesFromOpenApi(MFA_OPENAPI),
  ...registryEntriesFromOpenApi(AUTH_METHODS_POLICY_OPENAPI),
  { method: "GET", path: REGISTRATION_CAMPAIGN_PATH, permission: REGISTRATION_CAMPAIGN_READ_PERMISSION },
  { method: "PUT", path: REGISTRATION_CAMPAIGN_PATH, permission: REGISTRATION_CAMPAIGN_WRITE_PERMISSION },
  // EPIC-013 roles, PIM, and JIT (T-0818). Every module uses Identity.Role.Read and
  // Identity.Role.ReadWrite; applying a PIM settings template is a Remediation.Apply
  // write (its preview needs only read).
  { method: "GET", path: ROLE_ASSIGNMENTS_PATH, permission: ROLES_READ_PERMISSION },
  { method: "GET", path: PIM_ASSIGNMENTS_PATH, permission: ROLES_READ_PERMISSION },
  { method: "POST", path: PIM_REQUESTS_PATH, permission: ROLES_WRITE_PERMISSION },
  { method: "GET", path: PIM_REQUESTS_PATH, permission: ROLES_READ_PERMISSION },
  { method: "GET", path: PIM_REQUEST_ITEM_PATH, permission: ROLES_READ_PERMISSION },
  { method: "POST", path: PIM_REQUEST_TRANSITION_PATH, permission: ROLES_WRITE_PERMISSION },
  { method: "GET", path: PIM_TEMPLATES_PATH, permission: ROLES_READ_PERMISSION },
  { method: "POST", path: PIM_TEMPLATES_PATH, permission: ROLES_WRITE_PERMISSION },
  { method: "GET", path: PIM_TEMPLATE_ITEM_PATH, permission: ROLES_READ_PERMISSION },
  { method: "PATCH", path: PIM_TEMPLATE_ITEM_PATH, permission: ROLES_WRITE_PERMISSION },
  { method: "DELETE", path: PIM_TEMPLATE_ITEM_PATH, permission: ROLES_WRITE_PERMISSION },
  { method: "POST", path: PIM_TEMPLATE_COMPARE_PATH, permission: ROLES_READ_PERMISSION },
  { method: "POST", path: PIM_TEMPLATE_APPLY_PATH, permission: PIM_APPLY_PERMISSION },
  { method: "POST", path: JIT_GRANTS_PATH, permission: ROLES_WRITE_PERMISSION },
  { method: "GET", path: JIT_GRANTS_PATH, permission: ROLES_READ_PERMISSION },
  { method: "POST", path: JIT_GRANT_REVOKE_PATH, permission: ROLES_WRITE_PERMISSION },
  { method: "POST", path: JIT_GRANT_EXTEND_PATH, permission: ROLES_WRITE_PERMISSION },
  { method: "GET", path: JIT_TEMPLATES_PATH, permission: ROLES_READ_PERMISSION },
  { method: "POST", path: JIT_TEMPLATES_PATH, permission: ROLES_WRITE_PERMISSION },
  { method: "GET", path: JIT_TEMPLATE_ITEM_PATH, permission: ROLES_READ_PERMISSION },
  { method: "PATCH", path: JIT_TEMPLATE_ITEM_PATH, permission: ROLES_WRITE_PERMISSION },
  { method: "DELETE", path: JIT_TEMPLATE_ITEM_PATH, permission: ROLES_WRITE_PERMISSION },
  // EPIC-014 groups (T-0819). /groups/usage precedes /groups/:groupId, as in app.ts.
  // The template deploy route enforces the group write permission.
  { method: "GET", path: GROUP_USAGE_PATH, permission: GROUPS_READ_PERMISSION },
  { method: "GET", path: GROUPS_BASE_PATH, permission: GROUPS_READ_PERMISSION },
  { method: "POST", path: GROUPS_BASE_PATH, permission: GROUPS_WRITE_PERMISSION },
  { method: "PATCH", path: GROUPS_ITEM_PATH, permission: GROUPS_WRITE_PERMISSION },
  { method: "DELETE", path: GROUPS_ITEM_PATH, permission: GROUPS_WRITE_PERMISSION },
  { method: "POST", path: GROUP_GAL_PATH, permission: GROUPS_WRITE_PERMISSION },
  { method: "POST", path: GROUP_DELIVERY_PATH, permission: GROUPS_WRITE_PERMISSION },
  { method: "POST", path: GROUP_MEMBERS_BULK_PATH, permission: GROUPS_WRITE_PERMISSION },
  { method: "POST", path: GROUP_OWNERS_BULK_PATH, permission: GROUPS_WRITE_PERMISSION },
  { method: "POST", path: GROUP_TEMPLATE_DEPLOY_PATH, permission: GROUPS_WRITE_PERMISSION },
  // EPIC-015 Conditional Access (T-0819).
  { method: "GET", path: CA_POLICIES_BASE_PATH, permission: CA_READ_PERMISSION },
  { method: "POST", path: CA_POLICIES_BASE_PATH, permission: CA_WRITE_PERMISSION },
  { method: "PATCH", path: CA_POLICIES_ITEM_PATH, permission: CA_WRITE_PERMISSION },
  { method: "DELETE", path: CA_POLICIES_ITEM_PATH, permission: CA_WRITE_PERMISSION },
  { method: "GET", path: CA_COVERAGE_PATH, permission: CA_READ_PERMISSION },
  { method: "GET", path: CA_HISTORY_PATH, permission: CA_READ_PERMISSION },
  { method: "GET", path: CA_REPORT_ONLY_PATH, permission: CA_READ_PERMISSION },
  { method: "GET", path: CA_NAMED_LOCATIONS_BASE_PATH, permission: CA_READ_PERMISSION },
  { method: "POST", path: CA_NAMED_LOCATIONS_BASE_PATH, permission: CA_WRITE_PERMISSION },
  { method: "PATCH", path: CA_NAMED_LOCATIONS_ITEM_PATH, permission: CA_WRITE_PERMISSION },
  { method: "DELETE", path: CA_NAMED_LOCATIONS_ITEM_PATH, permission: CA_WRITE_PERMISSION },
  { method: "POST", path: CA_TEMPLATE_DEPLOY_PATH, permission: CA_DEPLOY_PERMISSION },
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
