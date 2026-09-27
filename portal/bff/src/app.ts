// Composition root (T-0817).
//
// Builds everything the HTTP server serves: one SQLite database, the shared
// authorizer, the authenticators, and the route list. Route modules stay free of
// wiring; this file is the only place that knows which store backs which route.
//
// Storage: the @m365-assess/db migrations run once on the shared connection, then the
// db repositories and the BFF's own repositories share it. Worker-backed runners call
// PowerShell entrypoints through runFeatureWorker (T-0815). Areas whose route stores
// have no implementation yet are mounted by later tickets (T-0818..T-0825).
import { mkdirSync } from "node:fs";
import path from "node:path";
import { SqliteRepository, loadMigrations, runMigrations } from "@m365-assess/db";
import Database from "better-sqlite3";
import {
  createCredentialRowStore,
  createGdapRelationshipStore,
  createTenantGroupStore,
  createTenantStore,
  createTenantVariableStore,
} from "./adapters/tenants.js";
import {
  createGdapSyncRunner,
  createOnboardRunner,
  createTestConnectionRunner,
  createWorkerRunner,
  type WorkerRunner,
} from "./adapters/workers.js";
import { createDevIdentityAuthenticator } from "./auth/dev-identity.js";
import type { BffConfig } from "./config.js";
import { createInMemoryCredentialStore } from "./credentials/store.js";
import { AppError } from "./errors.js";
import type { BaseRoleId } from "./rbac/base-roles.js";
import { RbacErrorCodes, type Caller } from "./rbac/authorize.js";
import { testPortalAccess } from "./rbac/test-portal-access.js";
import { SqliteCaTemplateRepository } from "./repository/ca-templates.js";
import { SqliteGroupTemplateRepository } from "./repository/group-templates.js";
import { SqliteIntuneTemplateRepository } from "./repository/intune-templates.js";
import { createBaselinesCatalogRoutes } from "./routes/baselines-catalog.js";
import { createCaTemplateRoutes } from "./routes/ca-templates.js";
import { createCredentialRoutes } from "./routes/credentials.js";
import { createGdapRoutes } from "./routes/gdap.js";
import { createOnboardRoutes } from "./routes/onboard.js";
import { createTenantGroupRoutes } from "./routes/tenant-groups.js";
import { createTenantVariableRoutes } from "./routes/tenant-variables.js";
import { createTenantRoutes } from "./routes/tenants.js";
import { createTestConnectionRoutes } from "./routes/test-connection.js";
import { createGroupTemplatesRoutes } from "./routes/group-templates.js";
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

/** `resolveCaller` for routes: the server-resolved caller, or undefined when anonymous. */
export function resolveCaller(ctx: RequestContext): Caller | undefined {
  // Route modules type the caller as the EPIC-001 Caller; RequestCaller has the same
  // fields with base-role ids allowed, which the authorizer above understands.
  return (ctx.caller ?? undefined) as Caller | undefined;
}

// ---- Composition -----------------------------------------------------------

export interface App {
  readonly routes: readonly Route[];
  readonly authenticators: readonly RequestAuthenticator[];
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
  const credentialRows = createCredentialRowStore(repo);
  const caller = { resolveCaller, authorize: authorizeCaller };

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
    ...createCaTemplateRoutes(new SqliteCaTemplateRepository(db), { authorize: authorizeContext }),
    ...createIntuneTemplateRoutes(new SqliteIntuneTemplateRepository(db), { authorize: authorizeContext }),
    ...createGroupTemplatesRoutes({
      repository: new SqliteGroupTemplateRepository(db),
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
  ];

  return {
    routes,
    authenticators,
    close: () => {
      if (!options.db) db.close();
    },
  };
}
