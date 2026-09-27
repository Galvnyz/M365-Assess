// Migrate from standards (EPIC-010 SPEC.md §3.2, §4.4, §6; T-0189).
//
//   POST /v1/baselines/{id}/migrate-from-standards
//
// Converts an EPIC-008 standards template (T-0143) into a staged baseline:
// every template setting becomes a condition in a single opening stage, the
// template's assignments carry over so the T-0182 save gate (name +
// assignment + staged standard) passes unchanged, and the source template is
// never mutated. Drift-kind templates are observe-only (EPIC-009 compares
// desired vs current) and cannot migrate. Requires `Tenant.Baselines.ReadWrite`.

import { AppError, ErrorCodes } from "../errors.js";
import { requirePermission, requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { Permission } from "../rbac/roles.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";
import { validateBaselineInput, BaselineValidationError } from "../domain/baseline-validate.js";
import {
  BASELINES_PERMISSIONS,
  BASELINES_UNAUTHENTICATED,
  type BaselineRecord,
} from "./baselines.js";

export const BASELINE_MIGRATE_PATH = "/v1/baselines/:baselineId/migrate-from-standards";

export const BASELINE_NOT_FOUND = "baseline.not_found";
export const BASELINE_MIGRATE_TEMPLATE_NOT_FOUND = "baseline.migrate_template_not_found";
export const BASELINE_MIGRATE_DRIFT_NOT_ALLOWED = "baseline.migrate_drift_not_allowed";

export interface MigrateSourceSetting {
  readonly key: string;
  readonly value: unknown;
}

export interface MigrateSourceAssignment {
  readonly targetType: "allTenants" | "group" | "tenant";
  readonly targetId: string | null;
  readonly precedence: number;
}

export interface MigrateSourceTemplate {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly settings: readonly MigrateSourceSetting[];
  readonly assignments: readonly MigrateSourceAssignment[];
}

export interface MigrateStore {
  getSourceTemplate(templateId: string): Promise<MigrateSourceTemplate | undefined>;
  createBaseline(input: {
    name: string;
    stages: BaselineRecord["stages"];
    assignments: readonly { targetType: "allTenants" | "group" | "tenant"; targetId: string | null; precedence: number }[];
  }): Promise<BaselineRecord>;
}

export interface MigrateRouteOptions {
  readonly store: MigrateStore;
  readonly resolveCaller: (ctx: RequestContext) => Caller | undefined;
  readonly authorize?: (caller: Caller, permission: string) => void | Promise<void>;
}

export interface MigrateRequest extends RequestContext {
  readonly body?: unknown;
}

async function ensureAuthorized(
  options: MigrateRouteOptions,
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

function requireCaller(options: MigrateRouteOptions, ctx: MigrateRequest): Caller {
  const caller = options.resolveCaller(ctx);
  if (!caller) {
    throw new AppError(BASELINES_UNAUTHENTICATED, "authentication required", 401);
  }
  return caller;
}

function requireParam(ctx: MigrateRequest, name: string): string {
  const value = ctx.params[name];
  if (!value || value.length === 0) {
    throw new AppError(ErrorCodes.validationFailed, `Missing route parameter '${name}'`, 400, [
      { field: name, reason: "required" },
    ]);
  }
  return value;
}

function optionalName(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const name = (body as Record<string, unknown>)["name"];
  return typeof name === "string" && name.trim().length > 0 ? name.trim() : null;
}

export function createBaselinesMigrateRoutes(options: MigrateRouteOptions): Route[] {
  async function handleMigrate(ctx: MigrateRequest): Promise<RouteResponse> {
    const caller = requireCaller(options, ctx);
    await ensureAuthorized(options, caller, BASELINES_PERMISSIONS.write);

    // {id} is the source EPIC-008 template; the baseline is created new.
    const templateId = requireParam(ctx, "baselineId");
    const source = await options.store.getSourceTemplate(templateId);
    if (!source) {
      throw new AppError(
        BASELINE_MIGRATE_TEMPLATE_NOT_FOUND,
        `Standards template ${templateId} not found`,
        404,
      );
    }
    if (source.kind === "drift") {
      throw new AppError(
        BASELINE_MIGRATE_DRIFT_NOT_ALLOWED,
        `Drift template ${templateId} cannot migrate to a baseline`,
        400,
        [{ field: "kind", reason: "drift_not_allowed" }],
      );
    }

    const name = optionalName(ctx.body) ?? `${source.name} (baseline)`;
    const stages: BaselineRecord["stages"] = [
      {
        order: 0,
        conditions: source.settings.map((setting) => ({ key: setting.key, expected: setting.value })),
        action: "report",
      },
    ];
    const assignments = source.assignments.map((assignment) => ({ ...assignment }));
    for (const assignment of assignments) {
      if (assignment.targetType === "tenant" && assignment.targetId) {
        requireTenantInScope(caller, assignment.targetId);
      }
    }

    try {
      validateBaselineInput({ name, assignments, stages });
    } catch (error) {
      if (error instanceof BaselineValidationError) {
        throw new AppError(error.code, error.message, 400, [
          ...error.violations.map((violation) => ({ field: violation.field, reason: violation.reason })),
        ]);
      }
      throw error;
    }

    const created = await options.store.createBaseline({ name, stages, assignments });
    return { status: 201, body: { baseline: created } };
  }

  return [{ method: "POST", path: BASELINE_MIGRATE_PATH, handler: handleMigrate }];
}

// ─── OpenAPI fragment (§6) ───────────────────────────────────────────────────

export const BASELINE_MIGRATE_OPENAPI = {
  "/v1/baselines/{id}/migrate-from-standards": {
    post: {
      tags: ["Baselines"],
      operationId: "migrateBaselineFromStandards",
      summary: "Convert a standards template into a staged baseline.",
      permission: BASELINES_PERMISSIONS.write,
      security: [{ bearerAuth: [] }],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "201": { description: "Migrated baseline.", content: { "application/json": { schema: { $ref: "#/components/schemas/Baseline" } } } },
        "400": { description: "Drift template or save gate failure.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        "404": { description: "Template not found.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
} as const;
