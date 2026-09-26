// Local baseline catalog browse (EPIC-010 SPEC.md §3.2, §4.4, §6; T-0190).
//
//   GET /v1/baselines/catalog -> local prebuilt baselines with stages.
//
// Local catalog first (§11.4): each entry carries a name and staged standards
// that seed a new baseline (pair with a tenant/group assignment to satisfy
// the T-0182 save gate). No EPIC-039 dependency is introduced: the community
// source is represented as explicitly unavailable until that epic lands.
// Requires `baselines.read`.
//
// Route ordering matters: `/v1/baselines/catalog` is a static path at the
// same depth as `/v1/baselines/:baselineId`, so it must be registered before
// the detail route where the matcher is first-match-wins.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AppError } from "../errors.js";
import { requirePermission, type Caller } from "../rbac/authorize.js";
import type { Permission } from "../rbac/roles.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const BASELINES_CATALOG_PATH = "/v1/baselines/catalog";

export const BASELINES_CATALOG_PERMISSION = "baselines.read";
export const BASELINES_CATALOG_UNAUTHENTICATED = "request.unauthenticated";
export const BASELINE_CATALOG_INVALID = "baseline.catalog_invalid";

export interface CatalogCondition {
  readonly key: string;
  readonly expected: unknown;
}

export interface CatalogStage {
  readonly order: number;
  readonly action: "report" | "remediate";
  readonly conditions: readonly CatalogCondition[];
}

export interface CatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly stages: readonly CatalogStage[];
}

export interface CommunityCatalogStatus {
  /** Always false until EPIC-039 lands; no dependency is introduced here. */
  readonly available: false;
  readonly reason: string;
}

export interface BaselinesCatalog {
  readonly source: "local";
  readonly entries: readonly CatalogEntry[];
  readonly community: CommunityCatalogStatus;
}

export interface CatalogRouteOptions {
  readonly resolveCaller: (ctx: RequestContext) => Caller | undefined;
  readonly authorize?: (caller: Caller, permission: string) => void | Promise<void>;
  readonly catalogPath?: string;
}

const DEFAULT_CATALOG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "domain",
  "baseline-catalog.json",
);

export function loadBaselinesCatalog(catalogPath: string = DEFAULT_CATALOG_PATH): BaselinesCatalog {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(catalogPath, "utf8")) as unknown;
  } catch (error) {
    throw new AppError(
      BASELINE_CATALOG_INVALID,
      `Baseline catalog at ${catalogPath} is not valid JSON`,
      500,
    );
  }
  const record = parsed as { source?: unknown; entries?: unknown };
  if (record.source !== "local" || !Array.isArray(record.entries)) {
    throw new AppError(BASELINE_CATALOG_INVALID, "Baseline catalog must have source 'local' and an entries array", 500);
  }
  const entries = (record.entries as unknown[]).map((entry, index) => {
    const item = entry as Partial<CatalogEntry>;
    if (typeof item.id !== "string" || !item.id || typeof item.name !== "string" || !item.name) {
      throw new AppError(BASELINE_CATALOG_INVALID, `Catalog entry ${index} needs an id and a name`, 500);
    }
    if (!Array.isArray(item.stages) || item.stages.length === 0) {
      throw new AppError(
        BASELINE_CATALOG_INVALID,
        `Catalog entry ${item.id} needs at least one stage`,
        500,
      );
    }
    return {
      id: item.id,
      name: item.name,
      description: typeof item.description === "string" ? item.description : "",
      stages: item.stages,
    };
  });
  return {
    source: "local",
    entries,
    community: {
      available: false,
      reason: "Community catalog arrives with the EPIC-039 integration; only local entries are listed.",
    },
  };
}

async function ensureAuthorized(
  options: CatalogRouteOptions,
  caller: Caller,
  permission: string,
): Promise<void> {
  if (options.authorize) {
    await options.authorize(caller, permission);
    return;
  }
  // baselines.* is not in the roles.ts union yet (EPIC-038); deny without a seam.
  requirePermission(caller, permission as Permission);
}

function requireCaller(options: CatalogRouteOptions, ctx: RequestContext): Caller {
  const caller = options.resolveCaller(ctx);
  if (!caller) {
    throw new AppError(BASELINES_CATALOG_UNAUTHENTICATED, "authentication required", 401);
  }
  return caller;
}

export function createBaselinesCatalogRoutes(options: CatalogRouteOptions): Route[] {
  async function handleCatalog(ctx: RequestContext): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, BASELINES_CATALOG_PERMISSION);
    return { status: 200, body: loadBaselinesCatalog(options.catalogPath) };
  }

  return [{ method: "GET", path: BASELINES_CATALOG_PATH, handler: handleCatalog }];
}

// ─── OpenAPI fragment (§6) ───────────────────────────────────────────────────

export const BASELINES_CATALOG_OPENAPI = {
  "/v1/baselines/catalog": {
    get: {
      tags: ["Baselines"],
      operationId: "getBaselinesCatalog",
      summary: "Browse local prebuilt baselines.",
      permission: BASELINES_CATALOG_PERMISSION,
      security: [{ bearerAuth: [] }],
      responses: {
        "200": { description: "Local catalog.", content: { "application/json": { schema: { $ref: "#/components/schemas/BaselinesCatalog" } } } },
        "401": { description: "Unauthenticated.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
} as const;
