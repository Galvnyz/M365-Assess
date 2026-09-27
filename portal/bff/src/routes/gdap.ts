// GDAP discovery and synchronization routes (EPIC-002 SPEC.md §4.3, §6).
// Enabled strictly behind a feature flag (ADR-0017). When the flag is disabled,
// no GDAP routes are served and direct tenants are unchanged.
// When enabled, POST /v1/gdap/sync discovers partner relationships, upserts
// `source: gdap` tenants, tracks CPV metadata, and marks unavailable relationships
// as excluded rather than silently dropping them. Direct tenants are never touched.

import { randomUUID } from "node:crypto";
import { AppError, ErrorCodes } from "../errors.js";
import type { Caller } from "../rbac/authorize.js";
import type { RequestContext, Route } from "../server.js";
import type { GdapRelationship, GdapRelationshipStore } from "../tenants/gdap-tenant-source.js";
import type { TenantAuditInput, TenantRecord, TenantStore } from "./tenants.js";

export const GDAP_SYNC_PATH = "/v1/gdap/sync";
export const GDAP_PERMISSION = "Tenant.Administration.ReadWrite";

export const GDAP_UNAUTHENTICATED = "request.unauthenticated";
export const GDAP_DISABLED = "gdap.disabled";

export interface GdapDiscoveredTenant {
  readonly id: string;
  readonly displayName: string | null;
  readonly defaultDomain?: string | null;
  readonly initialDomain?: string | null;
  readonly source: "gdap";
  readonly status: "active" | "excluded";
  readonly excluded: boolean;
  readonly excludeReason: string | null;
  readonly excludeDate?: string | null;
  readonly environment?: string;
}

export interface GdapSyncResult {
  readonly syncedAt: string;
  readonly totalDiscovered: number;
  readonly tenants: readonly GdapDiscoveredTenant[];
  readonly relationships: readonly GdapRelationship[];
}

export type GdapSyncRunner = () => Promise<GdapSyncResult>;

export interface GdapCaller extends Caller {
  readonly userId?: string;
}

export type GdapAuthorizer = (
  caller: GdapCaller,
  permission: string,
) => void | Promise<void>;

export interface GdapRouteOptions {
  readonly enabled?: boolean;
  readonly tenantStore: TenantStore;
  readonly relationshipStore?: GdapRelationshipStore;
  readonly runner?: GdapSyncRunner;
  readonly resolveCaller: (ctx: RequestContext) => GdapCaller | undefined;
  readonly authorize?: GdapAuthorizer;
  readonly now?: () => string;
}

function unauthenticatedError(): AppError {
  return new AppError(GDAP_UNAUTHENTICATED, "authentication required", 401);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => GdapCaller | undefined,
  ctx: RequestContext,
): GdapCaller {
  const caller = resolveCaller(ctx);
  if (caller === undefined) {
    throw unauthenticatedError();
  }
  return caller;
}

export function createGdapRoutes(options: GdapRouteOptions): Route[] {
  // If the feature flag is disabled, no GDAP route is served.
  if (!options.enabled) {
    return [];
  }

  const now = options.now ?? (() => new Date().toISOString());
  const authorize: GdapAuthorizer =
    options.authorize ??
    ((caller, perm) => {
      if (!caller.roles.includes("admin")) {
        throw new AppError("rbac.forbidden", `permission ${perm} required`, 403);
      }
    });

  return [
    {
      method: "POST",
      path: GDAP_SYNC_PATH,
      handler: async (ctx: RequestContext) => {
        const caller = requireCaller(options.resolveCaller, ctx);
        await authorize(caller, GDAP_PERMISSION);

        if (!options.runner) {
          throw new AppError(ErrorCodes.internalError, "GDAP sync runner not configured", 500);
        }

        const syncResult = await options.runner();
        const instant = now();

        let updatedCount = 0;
        for (const discovered of syncResult.tenants) {
          const prior = await options.tenantStore.getTenant(discovered.id, { includeDeleted: true });

          // Direct tenants are first-class and must never be altered or downgraded by GDAP sync
          if (prior && prior.source === "direct") {
            continue;
          }

          const tenantRecord: TenantRecord = {
            id: discovered.id,
            displayName: discovered.displayName ?? prior?.displayName ?? null,
            defaultDomain: discovered.defaultDomain ?? prior?.defaultDomain ?? null,
            initialDomain: discovered.initialDomain ?? prior?.initialDomain ?? null,
            source: "gdap",
            status: discovered.status,
            excluded: discovered.excluded,
            excludeReason: discovered.excludeReason ?? null,
            excludeDate: discovered.excludeDate ?? (discovered.excluded ? instant : null),
            environment: discovered.environment ?? prior?.environment ?? "commercial",
            lastRunAt: prior?.lastRunAt ?? null,
            errorCount: prior?.errorCount ?? 0,
            lastError: prior?.lastError ?? null,
            createdAt: prior?.createdAt ?? instant,
            updatedAt: instant,
            deletedAt: null,
          };

          await options.tenantStore.upsertTenant(tenantRecord);
          updatedCount++;
        }

        if (options.relationshipStore) {
          for (const rel of syncResult.relationships) {
            await options.relationshipStore.upsertGdapRelationship({
              ...rel,
              lastSynced: instant,
              updatedAt: instant,
            });
          }
        }

        if (options.tenantStore.appendAuditEvent) {
          const audit: TenantAuditInput = {
            id: randomUUID(),
            timestamp: instant,
            actorUserId: caller.userId ?? null,
            actorType: caller.userId ? "user" : "system",
            tenantId: null,
            action: "gdap.sync",
            targetType: "system",
            targetId: "gdap",
            before: null,
            after: { totalDiscovered: syncResult.totalDiscovered, updatedCount },
            result: "success",
            error: null,
            source: "request",
            correlationId: (ctx.headers["x-correlation-id"] as string) ?? null,
          };
          await options.tenantStore.appendAuditEvent(audit);
        }

        return {
          status: 200,
          body: {
            synced: true,
            totalDiscovered: syncResult.totalDiscovered,
            syncedCount: updatedCount,
            syncedAt: instant,
          },
        };
      },
    },
  ];
}

export const GDAP_OPENAPI = {
  paths: {
    "/v1/gdap/sync": {
      post: {
        operationId: "syncGdapTenants",
        summary: "Synchronize partner tenants and relationships from GDAP",
        permission: GDAP_PERMISSION,
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "GDAP synchronization completed successfully." },
          "401": { description: "Authentication required." },
          "403": { description: "Permission required." },
          "500": { description: "Sync runner failed." },
        },
      },
    },
  },
} as const;
