// Standards catalog API (EPIC-008 SPEC.md §4.4, §6; T-0144).
//
// `GET /v1/standards/catalog` lists the available standards for the template
// builder, with category and licence metadata. When a tenant is named, each
// standard is classified against that tenant's licences so the picker can show
// `license missing` up front and the executor (T-0145) skips rather than fails.
//
// The catalogue and the tenant licence set are injected seams; the licence
// classification itself is the pure logic in standards-license.ts.

import { AppError, ErrorCodes } from "../errors.js";
import { requirePermission, requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { Permission } from "../rbac/roles.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";
import {
  classifyStandardLicense,
  type StandardLicenseState,
  type TenantLicenseSet,
} from "../domain/standards-license.js";

export const STANDARDS_CATALOG_PATH = "/v1/standards/catalog";
export const STANDARDS_CATALOG_PERMISSION = "standards.read";
export const STANDARDS_CATALOG_UNAUTHENTICATED = "request.unauthenticated";

// ─── Records and seams ────────────────────────────────────────────────────────

export interface CatalogStandardRecord {
  readonly id: string;
  readonly check: string;
  readonly name: string;
  readonly category: string;
  readonly licensePreset: string | null;
}

export interface StandardsCatalogStore {
  listDefinitions(): Promise<readonly CatalogStandardRecord[]>;
}

export interface StandardsCatalogOptions {
  readonly catalog: StandardsCatalogStore;
  readonly resolveCaller: (ctx: RequestContext) => Caller | undefined;
  readonly authorize?: (caller: Caller, permission: string) => void | Promise<void>;
  /** Resolves a tenant's licence set when a `tenantId` is supplied. */
  readonly resolveTenantLicense?: (tenantId: string) => Promise<TenantLicenseSet>;
  /** licensing-overlay.json map; defaults to no overlay. */
  readonly overlay?: Readonly<Record<string, readonly string[]>>;
  /** Known service-plan ids used to flag unrecognised overlay entries. */
  readonly knownServicePlans?: ReadonlySet<string>;
}

export interface CatalogItem {
  readonly id: string;
  readonly check: string;
  readonly name: string;
  readonly category: string;
  readonly licensePreset: string | null;
  readonly licenseState: StandardLicenseState | null;
  readonly licenseReason: string | null;
}

export interface BuildCatalogOptions {
  readonly tenant?: TenantLicenseSet;
  readonly overlay?: Readonly<Record<string, readonly string[]>>;
  readonly knownServicePlans?: ReadonlySet<string>;
  readonly category?: string;
}

/**
 * Pure catalogue builder shared by the route and its tests. Without a tenant,
 * `licenseState` is null (not yet evaluated against any licence set).
 */
export function buildStandardsCatalog(
  definitions: readonly CatalogStandardRecord[],
  options: BuildCatalogOptions = {},
): CatalogItem[] {
  const filtered = options.category
    ? definitions.filter((definition) => definition.category === options.category)
    : definitions;

  return filtered.map((definition) => {
    if (!options.tenant) {
      return {
        id: definition.id,
        check: definition.check,
        name: definition.name,
        category: definition.category,
        licensePreset: definition.licensePreset,
        licenseState: null,
        licenseReason: null,
      };
    }
    const classification = classifyStandardLicense(
      { check: definition.check, licenseMinimum: definition.licensePreset },
      options.tenant,
      options.overlay ?? {},
      options.knownServicePlans,
    );
    return {
      id: definition.id,
      check: definition.check,
      name: definition.name,
      category: definition.category,
      licensePreset: definition.licensePreset,
      licenseState: classification.state,
      licenseReason: classification.reason,
    };
  });
}

// ─── Route factory ────────────────────────────────────────────────────────────

async function ensureAuthorized(
  options: StandardsCatalogOptions,
  caller: Caller,
  permission: string,
): Promise<void> {
  if (options.authorize) {
    await options.authorize(caller, permission);
    return;
  }
  // standards.* is not in the roles.ts union yet (EPIC-038); deny without a seam.
  requirePermission(caller, permission as Permission);
}

export function createStandardsCatalogRoutes(options: StandardsCatalogOptions): Route[] {
  async function handleCatalog(ctx: RequestContext): Promise<RouteResponse> {
    const caller = options.resolveCaller(ctx);
    if (!caller) {
      throw new AppError(STANDARDS_CATALOG_UNAUTHENTICATED, "authentication required", 401);
    }
    await ensureAuthorized(options, caller, STANDARDS_CATALOG_PERMISSION);

    const tenantId = ctx.query.get("tenantId");
    const category = ctx.query.get("category") ?? undefined;
    if (tenantId) requireTenantInScope(caller, tenantId);

    let tenant: TenantLicenseSet | undefined;
    if (tenantId) {
      if (!options.resolveTenantLicense) {
        throw new AppError(
          ErrorCodes.internalError,
          "tenant licence resolver is not configured",
          500,
        );
      }
      tenant = await options.resolveTenantLicense(tenantId);
    }

    const definitions = await options.catalog.listDefinitions();
    const items = buildStandardsCatalog(definitions, {
      tenant,
      overlay: options.overlay,
      knownServicePlans: options.knownServicePlans,
      category,
    });
    return { status: 200, body: { items } };
  }

  return [{ method: "GET", path: STANDARDS_CATALOG_PATH, handler: handleCatalog }];
}

// ─── OpenAPI fragment (§6) ───────────────────────────────────────────────────

export const STANDARDS_CATALOG_OPENAPI = {
  "/v1/standards/catalog": {
    get: {
      tags: ["Standards"],
      operationId: "getStandardsCatalog",
      summary: "List available standards with licence metadata.",
      permission: STANDARDS_CATALOG_PERMISSION,
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: "category", in: "query", required: false, schema: { type: "string" } },
        { name: "tenantId", in: "query", required: false, schema: { type: "string" } },
      ],
      responses: {
        "200": { description: "Catalog.", content: { "application/json": { schema: { $ref: "#/components/schemas/StandardsCatalogResponse" } } } },
        "401": { description: "Unauthenticated.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "403": { description: "Forbidden or tenant out of scope.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
} as const;
