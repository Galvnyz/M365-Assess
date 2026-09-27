// Composition root (T-0817).
//
// Builds everything the HTTP server serves: one SQLite database, the shared
// authorizer, the authenticators, and the route list. Route modules stay free of
// wiring; this file is the only place that knows which store backs which route.
//
// Storage: the @m365-assess/db migrations run once on the shared connection, then the
// db repositories and the BFF's own repositories share it. Worker-backed runners call
// PowerShell entrypoints through runFeatureWorker (T-0815). Areas whose route stores
// have no implementation yet are mounted by later tickets (T-0818, T-0821..T-0825).
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  SqliteBecFindingRepository,
  SqliteOffboardingRepository,
  SqliteRepository,
  SqliteUserTemplateRepository,
  loadMigrations,
  runMigrations,
} from "@m365-assess/db";
import Database from "better-sqlite3";
import {
  createCredentialRowStore,
  createGdapRelationshipStore,
  createTenantGroupStore,
  createTenantStore,
  createTenantVariableStore,
} from "./adapters/tenants.js";
import { createAuditSink, type RecordAudit } from "./adapters/audit.js";
import { createCaProviders } from "./adapters/conditional-access.js";
import { createGroupProviders } from "./adapters/groups.js";
import { createIntuneProviders } from "./adapters/intune.js";
import {
  createBecFindingStore,
  createBecProviders,
  createOffboardingRunner,
  createOffboardingStore,
  createUserProviders,
  createUserTemplateStore,
  type OffboardingRunner,
} from "./adapters/users.js";
import {
  createGdapSyncRunner,
  createOnboardRunner,
  createEnvelopeWorker,
  createTestConnectionRunner,
  createWorkerRunner,
  type WorkerRunner,
} from "./adapters/workers.js";
import { createDevIdentityAuthenticator } from "./auth/dev-identity.js";
import type { BffConfig } from "./config.js";
import { createInMemoryCredentialStore } from "./credentials/store.js";
import { AppError } from "./errors.js";
import type { BaseRoleId } from "./rbac/base-roles.js";
import { RbacErrorCodes, requireTenantInScope, type Caller } from "./rbac/authorize.js";
import { testPortalAccess } from "./rbac/test-portal-access.js";
import { SqliteCaTemplateRepository } from "./repository/ca-templates.js";
import { SqliteGroupTemplateRepository } from "./repository/group-templates.js";
import { SqliteDeviceActionRepository } from "./repository/device-actions.js";
import { SqliteIntuneTemplateRepository } from "./repository/intune-templates.js";
import { SqliteKeyAccessAuditRepository } from "./repository/key-access-audit.js";
import { SqliteReusableSettingTemplateRepository } from "./repository/reusable-setting-templates.js";
import { createBaselinesCatalogRoutes } from "./routes/baselines-catalog.js";
import { createBecRoutes } from "./routes/bec.js";
import { createCaCoverageRoutes } from "./routes/ca-coverage.js";
import { createCaNamedLocationsRoutes } from "./routes/ca-named-locations.js";
import { createCaPoliciesCrudRoutes } from "./routes/ca-policies-crud.js";
import { createCaPoliciesRoute } from "./routes/ca-policies.js";
import { createCaReportOnlyRoutes } from "./routes/ca-report-only.js";
import { createCaTemplateDeployRoute } from "./routes/ca-templates-deploy.js";
import { createCaTemplateRoutes } from "./routes/ca-templates.js";
import { createCredentialRoutes } from "./routes/credentials.js";
import { DEVICE_ACTIONS_HISTORY_OPENAPI, createDeviceActionsHistoryRoute } from "./routes/device-actions-history.js";
import { DEVICE_BITLOCKER_PERMISSION, createDeviceBitLockerRoute } from "./routes/device-bitlocker.js";
import { DEVICE_LAPS_PERMISSION, createDeviceLapsRoute } from "./routes/device-laps.js";
import {
  SqliteAssignmentFilterTemplateRepository,
  createAssignmentFilterRoutes,
} from "./routes/intune-assignment-filters.js";
import { createIntuneCompareRoute } from "./routes/intune-compare.js";
import { createIntuneCrudRoutes } from "./routes/intune-policies-crud.js";
import { createIntunePoliciesRoutes } from "./routes/intune-policies.js";
import { createReusableSettingsRoutes } from "./routes/intune-reusable-settings.js";
import { createIntuneTemplateDeployRoute } from "./routes/intune-templates-deploy.js";
import { createGdapRoutes } from "./routes/gdap.js";
import { createOffboardingRoutes } from "./routes/offboarding.js";
import { createOnboardRoutes } from "./routes/onboard.js";
import { createTenantGroupRoutes } from "./routes/tenant-groups.js";
import { createTenantVariableRoutes } from "./routes/tenant-variables.js";
import { createTenantRoutes } from "./routes/tenants.js";
import { createTestConnectionRoutes } from "./routes/test-connection.js";
import { createUserTemplateRoutes } from "./routes/user-templates.js";
import { createTenantUsersRoute } from "./routes/users.js";
import { createGroupTemplatesDeployRoute } from "./routes/group-templates-deploy.js";
import { createGroupTemplatesRoutes } from "./routes/group-templates.js";
import { createGroupCrudRoutes } from "./routes/groups-crud.js";
import { createGroupGalDeliveryRoutes } from "./routes/groups-gal.js";
import { createGroupsListRoute } from "./routes/groups-list.js";
import { createGroupMembersRoutes } from "./routes/groups-members.js";
import { createGroupUsageRoutes } from "./routes/groups-usage.js";
import { createHealthRoutes } from "./routes/health.js";
import { createIntuneTemplateRoutes } from "./routes/intune-templates.js";
import type { RequestAuthenticator, RequestCaller, RequestContext, Route } from "./server.js";

export const DATABASE_FILE = "portal.db";
export const UNAUTHENTICATED = "auth.unauthenticated";

// ---- Authorization ---------------------------------------------------------

/**
 * EPIC-001 roles (rbac/roles.ts) mapped onto the EPIC-038 base roles, so portal users
 * and API clients are authorized one way. `operator` held only runs.read.
 */
export const LEGACY_ROLE_BASE_ROLES: Readonly<Record<string, BaseRoleId>> = {
  admin: "admin",
  operator: "readonly",
};

/** EPIC-001 run permissions under their EPIC-038 taxonomy names. */
export const LEGACY_PERMISSIONS: Readonly<Record<string, string>> = {
  "runs.read": "Tenant.Runs.Read",
  "runs.create": "Tenant.Runs.ReadWrite",
  "runs.cancel": "Tenant.Runs.ReadWrite",
  "runs.retry": "Tenant.Runs.ReadWrite",
  admin: "CIPP.Admin.Diagnostics",
};

const BASE_ROLE_IDS: ReadonlySet<string> = new Set(["readonly", "editor", "admin", "superadmin"]);

function baseRolesOf(caller: RequestCaller): BaseRoleId[] {
  const roles = new Set<BaseRoleId>();
  for (const role of caller.roles) {
    const base = LEGACY_ROLE_BASE_ROLES[role] ?? (BASE_ROLE_IDS.has(role) ? (role as BaseRoleId) : undefined);
    if (base) roles.add(base);
  }
  return [...roles];
}

/** Whether `caller` holds `permission` (EPIC-001 names are translated first). */
export function canAccess(caller: RequestCaller | null | undefined, permission: string): boolean {
  if (!caller) return false;
  return testPortalAccess({
    permission: LEGACY_PERMISSIONS[permission] ?? permission,
    roles: baseRolesOf(caller),
  }).allowed;
}

function unauthenticated(): AppError {
  return new AppError(UNAUTHENTICATED, "authentication required", 401);
}

function forbidden(permission: string): AppError {
  return new AppError(RbacErrorCodes.forbidden, `forbidden: requires ${permission}`, 403);
}

/** Authorizer for routes that take `(caller, permission) => void`. */
export function authorizeCaller(caller: RequestCaller | null | undefined, permission: string): void {
  if (!caller) throw unauthenticated();
  if (!canAccess(caller, permission)) throw forbidden(permission);
}

/**
 * Authorizer for routes that take `(ctx, permission) => boolean` and raise their own 403.
 * An anonymous request is a 401 here rather than a 403 from the route.
 */
export function authorizeContext(ctx: RequestContext, permission: string): boolean {
  if (!ctx.caller) throw unauthenticated();
  return canAccess(ctx.caller, permission);
}

/**
 * `resolveCaller` for routes: the server-resolved caller, or undefined when anonymous.
 * Portal users carry `id`; routes that stamp a creator read `userId`, so it is added.
 */
export function resolveCaller(ctx: RequestContext): (Caller & { userId?: string }) | undefined {
  // Route modules type the caller as the EPIC-001 Caller; RequestCaller has the same
  // fields with base-role ids allowed, which the authorizer above understands.
  if (!ctx.caller) return undefined;
  const id = (ctx.caller as { id?: unknown }).id;
  return (typeof id === "string" ? { ...ctx.caller, userId: id } : ctx.caller) as Caller & { userId?: string };
}

/**
 * Wrap a route whose module does no authorization of its own: require `permission`
 * and, when the path names a tenant, that the tenant is in the caller's scope.
 */
export function guardRoute(route: Route, permission: string): Route {
  return {
    ...route,
    handler: (ctx) => {
      authorizeCaller(ctx.caller, permission);
      const tenantId = ctx.params["tenantId"];
      if (tenantId) requireTenantInScope(ctx.caller as Caller, tenantId);
      return route.handler(ctx);
    },
  };
}

/** The signed-in user's id for audit records. */
function actorOf(ctx: RequestContext): string {
  const caller = ctx.caller as { id?: unknown } | null | undefined;
  return typeof caller?.id === "string" ? caller.id : "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Record the audit events a worker-backed write returns in its response body
 * (`auditEvent`, or `auditEvents` for bulk and multi-tenant writes), stamped with the
 * signed-in actor. Used for routes whose modules hand events back instead of taking
 * an audit sink. Previews return plans and carry no events.
 */
export function recordResponseAudit(route: Route, recordAudit: RecordAudit): Route {
  return {
    ...route,
    handler: async (ctx) => {
      const response = await route.handler(ctx);
      const body: unknown = response.body;
      if (isRecord(body)) {
        const events = [
          ...(isRecord(body["auditEvent"]) ? [body["auditEvent"]] : []),
          ...(Array.isArray(body["auditEvents"]) ? body["auditEvents"].filter(isRecord) : []),
        ];
        for (const event of events) {
          await recordAudit({ actor: actorOf(ctx), ...event });
        }
      }
      return response;
    },
  };
}

// ---- Composition -----------------------------------------------------------

export interface App {
  readonly routes: readonly Route[];
  readonly authenticators: readonly RequestAuthenticator[];
  /** Background offboarding runs; `idle()` waits for the ones in flight. */
  readonly offboarding: OffboardingRunner;
  close(): void;
}

export interface CreateAppOptions {
  /** Use this database instead of opening `<storagePath>/portal.db` (tests pass ":memory:"). */
  readonly db?: Database.Database;
  /** Run worker entrypoints with this instead of pwsh (tests pass a fake). */
  readonly workerRunner?: WorkerRunner;
  readonly version?: string;
}

function openDatabase(config: BffConfig): Database.Database {
  mkdirSync(config.storagePath, { recursive: true });
  const db = new Database(path.join(config.storagePath, DATABASE_FILE));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function createApp(config: BffConfig, options: CreateAppOptions = {}): App {
  const db = options.db ?? openDatabase(config);

  const authenticators: RequestAuthenticator[] = [];
  if (config.devIdentityRole) {
    authenticators.push(createDevIdentityAuthenticator(config.devIdentityRole));
  }

  const schemaVersion = runMigrations(db, loadMigrations());
  const journalMode = String(db.pragma("journal_mode", { simple: true }) ?? "memory");
  const repo = new SqliteRepository(db, schemaVersion, journalMode);
  const run = options.workerRunner ?? createWorkerRunner({ workersDir: config.workersDir });

  const tenantStore = createTenantStore(repo);
  const recordAudit = createAuditSink(repo);
  const intuneTemplates = new SqliteIntuneTemplateRepository(db);
  const credentialRows = createCredentialRowStore(repo);
  const intune = createIntuneProviders(run, credentialRows);
  const keyAudit = new SqliteKeyAccessAuditRepository(db, schemaVersion);
  const caller = { resolveCaller, authorize: authorizeCaller };
  const groups = createGroupProviders(run, credentialRows);
  const ca = createCaProviders(run, credentialRows, db);
  const caTemplates = new SqliteCaTemplateRepository(db);
  const groupTemplates = new SqliteGroupTemplateRepository(db);
  const audited = (route: Route) => recordResponseAudit(route, recordAudit);
  // Route modules type their audit events as interfaces; the sink takes any record.
  const routeAudit = (event: object) => recordAudit({ ...event });
  const envelope = createEnvelopeWorker(run, credentialRows);
  const users = createUserProviders(envelope);
  const bec = createBecProviders(envelope);
  const offboardingRepo = new SqliteOffboardingRepository(db, schemaVersion);
  const offboarding = createOffboardingRunner(envelope, offboardingRepo);

  const routes: Route[] = [
    ...createHealthRoutes({
      ...(options.version !== undefined ? { version: options.version } : {}),
      storage: {
        checkReachability: () => {
          try {
            db.prepare("SELECT 1").get();
            return true;
          } catch {
            return false;
          }
        },
      },
    }),
    ...createBaselinesCatalogRoutes({ resolveCaller, authorize: authorizeCaller }),
    ...createCaTemplateRoutes(caTemplates, { authorize: authorizeContext }),
    ...createIntuneTemplateRoutes(intuneTemplates, { authorize: authorizeContext }),
    ...createGroupTemplatesRoutes({
      repository: groupTemplates,
      resolveCaller,
      authorize: authorizeCaller,
    }),
    // EPIC-002 tenants and onboarding (T-0822).
    ...createTenantRoutes({ store: tenantStore, ...caller }),
    ...createTenantGroupRoutes({ store: createTenantGroupStore(repo), ...caller }),
    ...createTenantVariableRoutes({ store: createTenantVariableStore(repo), ...caller }),
    ...createCredentialRoutes({
      records: credentialRows,
      // Secret material has no persistent backend yet (T-0827): client-secret and PFX
      // material set here lasts until restart. Thumbprint credentials need none.
      secrets: createInMemoryCredentialStore(),
      ...caller,
    }),
    ...createGdapRoutes({
      enabled: config.gdapPartnerTenantId !== null,
      tenantStore,
      relationshipStore: createGdapRelationshipStore(repo),
      ...(config.gdapPartnerTenantId
        ? { runner: createGdapSyncRunner(run, credentialRows, config.gdapPartnerTenantId) }
        : {}),
      ...caller,
    }),
    ...createOnboardRoutes({ tenantStore, credentialStore: credentialRows, runner: createOnboardRunner(run), ...caller }),
    ...createTestConnectionRoutes({
      tenantStore,
      credentialStore: credentialRows,
      runner: createTestConnectionRunner(run),
      ...caller,
    }),

    // EPIC-016 Intune (T-0820). Order matters: the server takes the first match, and the
    // generic /intune/:kind policy routes would otherwise capture compare,
    // reusable-settings, and assignment-filters.
    createIntuneCompareRoute({ provider: intune.compare, templates: intuneTemplates, resolveCaller, authorize: authorizeContext }),
    ...createReusableSettingsRoutes({
      repository: new SqliteReusableSettingTemplateRepository(db),
      provider: intune.reusableSettings,
      resolveCaller,
      authorize: authorizeContext,
      recordAudit,
    }),
    ...createAssignmentFilterRoutes({
      repository: new SqliteAssignmentFilterTemplateRepository(db),
      provider: intune.assignmentFilters,
      resolveCaller,
      authorize: authorizeContext,
      recordAudit,
    }),
    createIntuneTemplateDeployRoute({
      repository: intuneTemplates,
      provider: intune.deploy,
      resolveCaller,
      authorize: authorizeContext,
      recordAudit,
    }),
    ...createIntunePoliciesRoutes({ provider: intune.policies, ...caller }),
    ...createIntuneCrudRoutes({ provider: intune.crud, ...caller }),

    // EPIC-011 users, offboarding, BEC, and user templates (T-0818).
    ...createTenantUsersRoute({
      provider: users.list,
      create: users.create,
      execute: users.execute,
      patch: users.patch,
      recordAudit: routeAudit,
      ...caller,
    }),
    ...createBecRoutes({
      provider: bec.check,
      remediate: bec.remediate,
      store: createBecFindingStore(new SqliteBecFindingRepository(db, schemaVersion)),
      recordAudit: routeAudit,
      ...caller,
    }),
    ...createOffboardingRoutes({
      store: createOffboardingStore(offboardingRepo),
      queue: offboarding,
      recordAudit: routeAudit,
      ...caller,
    }),
    ...createUserTemplateRoutes({
      store: createUserTemplateStore(new SqliteUserTemplateRepository(db, schemaVersion)),
      recordAudit: routeAudit,
      ...caller,
    }),

    // EPIC-014 groups (T-0819). /groups/usage is mounted before the /groups/:groupId
    // routes so the id pattern cannot capture it.
    ...createGroupUsageRoutes({ provider: groups.usage, ...caller }),
    createGroupsListRoute({ provider: groups.list, ...caller }),
    ...createGroupCrudRoutes({ provider: groups.crud, ...caller }).map(audited),
    ...createGroupGalDeliveryRoutes({ provider: groups.gal, ...caller }).map(audited),
    ...createGroupMembersRoutes({ provider: groups.members, ...caller }).map(audited),
    audited(createGroupTemplatesDeployRoute({ repository: groupTemplates, provider: groups.templateDeploy, ...caller })),

    // EPIC-015 Conditional Access (T-0819).
    createCaPoliciesRoute({ provider: ca.policies, ...caller }),
    ...createCaPoliciesCrudRoutes({ provider: ca.crud, ...caller }).map(audited),
    ...createCaCoverageRoutes({ provider: ca.coverage, ...caller }),
    ...createCaReportOnlyRoutes({ provider: ca.reportOnly, ...caller }),
    ...createCaNamedLocationsRoutes({ provider: ca.namedLocations, ...caller }).map(audited),
    audited(createCaTemplateDeployRoute({ repository: caTemplates, provider: ca.templateDeploy, ...caller })),

    // EPIC-018 devices (T-0820). These modules check permissions but not tenant scope,
    // and the history route checks neither, so each is guarded here.
    ...createDeviceActionsHistoryRoute({ store: new SqliteDeviceActionRepository(db, schemaVersion) }).map((r) =>
      guardRoute(r, DEVICE_ACTIONS_HISTORY_OPENAPI.paths["/tenants/{tenantId}/devices/{deviceId}/actions"].get.permission),
    ),
    ...createDeviceBitLockerRoute({ keys: intune.bitlocker, audit: keyAudit, authorize: authorizeContext, actor: actorOf }).map(
      (r) => guardRoute(r, DEVICE_BITLOCKER_PERMISSION),
    ),
    ...createDeviceLapsRoute({ credentials: intune.laps, audit: keyAudit, authorize: authorizeContext, actor: actorOf }).map(
      (r) => guardRoute(r, DEVICE_LAPS_PERMISSION),
    ),
  ];

  return {
    routes,
    authenticators,
    offboarding,
    close: () => {
      if (!options.db) db.close();
    },
  };
}
