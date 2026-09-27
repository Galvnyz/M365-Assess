// CA named locations CRUD API (EPIC-015 SPEC.md §3.4, §5, §6, §11.5; T-0288).
// Exposes GET/POST /v1/tenants/:tenantId/ca/named-locations
// and PATCH/DELETE /v1/tenants/:tenantId/ca/named-locations/:locationId.
// Validates IP CIDR notation and ISO 3166-1 alpha-2 country codes.
// Shows which policies reference each location and warns/requires confirmation before deletion.
import { AppError, ErrorCodes } from "../errors.js";
import { requireTenantInScope, type Caller } from "../rbac/authorize.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const CA_NAMED_LOCATIONS_BASE_PATH = "/v1/tenants/:tenantId/ca/named-locations";
export const CA_NAMED_LOCATIONS_ITEM_PATH = "/v1/tenants/:tenantId/ca/named-locations/:locationId";

export const CA_READ_PERMISSION = "Tenant.ConditionalAccess.Read";
export const CA_WRITE_PERMISSION = "Tenant.ConditionalAccess.ReadWrite";
export const REMEDIATION_APPLY_PERMISSION = "Remediation.Apply";
export const CA_DEPLOY_PERMISSION = "Tenant.ConditionalAccess.ReadWrite";
export const CA_UNAUTHENTICATED = "request.unauthenticated";

export interface ReferencingPolicy {
  readonly id: string;
  readonly displayName: string;
}

export interface CaNamedLocationItem {
  readonly id: string;
  readonly displayName: string;
  readonly locationType: "ip" | "country";
  readonly isTrusted?: boolean;
  readonly ipRanges?: readonly string[];
  readonly countriesAndRegions?: readonly string[];
  readonly includeUnknownCountriesAndRegions?: boolean;
  readonly countryLookupMethod?: string;
  readonly referencingPolicies: readonly ReferencingPolicy[];
  readonly inUse: boolean;
  readonly createdDateTime?: string;
  readonly modifiedDateTime?: string;
}

export interface CaNamedLocationsListResponse {
  readonly tenantId: string;
  readonly totalCount: number;
  readonly items: readonly CaNamedLocationItem[];
}

export interface CaNamedLocationPlan {
  readonly action: "create" | "edit" | "delete";
  readonly locationId?: string;
  readonly targetName: string;
  readonly before?: Record<string, unknown> | null;
  readonly after?: Record<string, unknown> | null;
  readonly diff: readonly string[];
  readonly valid: boolean;
  readonly dryRun: boolean;
  readonly referencingPolicies?: readonly ReferencingPolicy[];
  readonly inUse: boolean;
  readonly requiresConfirmation: boolean;
  readonly warning?: string;
}

export interface CaNamedLocationAuditEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly action: string;
  readonly targetId: string;
  readonly targetName: string;
  readonly timestamp: string;
  readonly before?: Record<string, unknown> | null;
  readonly after?: Record<string, unknown> | null;
}

export interface CaNamedLocationMutationResult {
  readonly success: boolean;
  readonly plan: CaNamedLocationPlan;
  readonly result?: Record<string, unknown>;
  readonly auditEvent?: CaNamedLocationAuditEvent;
}

export interface CaNamedLocationCreateInput {
  readonly displayName: string;
  readonly locationType: "ip" | "country";
  readonly isTrusted?: boolean;
  readonly ipRanges?: readonly string[];
  readonly countriesAndRegions?: readonly string[];
  readonly includeUnknownCountriesAndRegions?: boolean;
  readonly countryLookupMethod?: string;
  readonly preview?: boolean;
}

export interface CaNamedLocationEditInput {
  readonly displayName?: string;
  readonly isTrusted?: boolean;
  readonly ipRanges?: readonly string[];
  readonly countriesAndRegions?: readonly string[];
  readonly includeUnknownCountriesAndRegions?: boolean;
  readonly countryLookupMethod?: string;
  readonly preview?: boolean;
}

export interface CaNamedLocationsProvider {
  listLocations(tenantId: string): Promise<CaNamedLocationsListResponse>;
  createLocation(
    tenantId: string,
    input: CaNamedLocationCreateInput,
    preview: boolean,
  ): Promise<CaNamedLocationMutationResult | CaNamedLocationPlan>;
  editLocation(
    tenantId: string,
    locationId: string,
    input: CaNamedLocationEditInput,
    preview: boolean,
  ): Promise<CaNamedLocationMutationResult | CaNamedLocationPlan>;
  deleteLocation(
    tenantId: string,
    locationId: string,
    confirmName?: string,
    preview?: boolean,
  ): Promise<CaNamedLocationMutationResult | CaNamedLocationPlan>;
}

export interface CaNamedLocationsCaller extends Caller {
  readonly userId?: string;
}

export type CaNamedLocationsAuthorizer = (
  caller: CaNamedLocationsCaller,
  permission: string,
) => void | Promise<void>;

export interface CaNamedLocationsRoutesOptions {
  readonly provider: CaNamedLocationsProvider;
  readonly resolveCaller: (ctx: RequestContext) => CaNamedLocationsCaller | undefined;
  readonly authorize?: CaNamedLocationsAuthorizer;
}

function unauthenticatedError(): AppError {
  return new AppError(CA_UNAUTHENTICATED, "authentication required", 401);
}

function requireCaller(
  resolveCaller: (ctx: RequestContext) => CaNamedLocationsCaller | undefined,
  ctx: RequestContext,
): CaNamedLocationsCaller {
  const caller = resolveCaller(ctx);
  if (caller === undefined) {
    throw unauthenticatedError();
  }
  return caller;
}

function requireTenantParam(ctx: RequestContext): string {
  const value = ctx.params["tenantId"];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "tenantId is required", 400, [
      { field: "tenantId", reason: "required" },
    ]);
  }
  return value.trim();
}

function requireLocationIdParam(ctx: RequestContext): string {
  const value = ctx.params["locationId"];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "locationId is required", 400, [
      { field: "locationId", reason: "required" },
    ]);
  }
  return value.trim();
}

export function validateCidr(cidr: string): boolean {
  if (typeof cidr !== "string" || cidr.trim().length === 0) return false;
  const trimmed = cidr.trim();

  // IPv4 CIDR
  const ipv4Match = trimmed.match(
    /^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\/([0-9]|[12][0-9]|3[0-2])$/,
  );
  if (ipv4Match) return true;

  // IPv6 CIDR
  const ipv6Match = trimmed.match(
    /^([0-9a-fA-F:]+)\/([0-9]|[1-9][0-9]|1[01][0-9]|12[0-8])$/,
  );
  if (ipv6Match && trimmed.includes(":")) {
    const parts = ipv6Match[1]!.split(":");
    if (parts.length >= 3 && parts.length <= 8) return true;
  }

  return false;
}

export function validateCountryCode(code: string): boolean {
  if (typeof code !== "string") return false;
  return /^[A-Za-z]{2}$/.test(code.trim());
}

async function authorizeRead(
  options: CaNamedLocationsRoutesOptions,
  caller: CaNamedLocationsCaller,
): Promise<void> {
  if (options.authorize) {
    await options.authorize(caller, CA_READ_PERMISSION);
    return;
  }
  const permissions = caller.permissions ?? [];
  const allowed =
    permissions.includes(CA_READ_PERMISSION) ||
    permissions.includes(CA_WRITE_PERMISSION) ||
    permissions.includes(REMEDIATION_APPLY_PERMISSION) ||
    permissions.includes(CA_DEPLOY_PERMISSION) ||
    permissions.includes("*");
  if (!allowed) {
    throw new AppError(
      ErrorCodes.forbidden,
      `forbidden: read requires ${CA_READ_PERMISSION}`,
      403,
    );
  }
}

async function authorizeWrite(
  options: CaNamedLocationsRoutesOptions,
  caller: CaNamedLocationsCaller,
): Promise<void> {
  if (options.authorize) {
    await options.authorize(caller, CA_WRITE_PERMISSION);
    return;
  }
  const permissions = caller.permissions ?? [];
  const allowed =
    permissions.includes(CA_WRITE_PERMISSION) ||
    permissions.includes(REMEDIATION_APPLY_PERMISSION) ||
    permissions.includes(CA_DEPLOY_PERMISSION) ||
    permissions.includes("*");
  if (!allowed) {
    throw new AppError(
      ErrorCodes.forbidden,
      `forbidden: write requires ${CA_WRITE_PERMISSION} or ${REMEDIATION_APPLY_PERMISSION}`,
      403,
    );
  }
}

export function createCaNamedLocationsRoutes(options: CaNamedLocationsRoutesOptions): Route[] {
  return [
    // GET /v1/tenants/:tenantId/ca/named-locations
    {
      method: "GET",
      path: CA_NAMED_LOCATIONS_BASE_PATH,
      handler: async (ctx: RequestContext): Promise<RouteResponse> => {
        const caller = requireCaller(options.resolveCaller, ctx);
        const tenantId = requireTenantParam(ctx);
        requireTenantInScope(caller, tenantId);
        await authorizeRead(options, caller);

        const result = await options.provider.listLocations(tenantId);
        return {
          status: 200,
          body: result,
        };
      },
    },

    // POST /v1/tenants/:tenantId/ca/named-locations
    {
      method: "POST",
      path: CA_NAMED_LOCATIONS_BASE_PATH,
      handler: async (ctx: RequestContext): Promise<RouteResponse> => {
        const caller = requireCaller(options.resolveCaller, ctx);
        const tenantId = requireTenantParam(ctx);
        requireTenantInScope(caller, tenantId);
        await authorizeWrite(options, caller);

        const body = (ctx.body ?? {}) as Record<string, unknown>;
        const isPreview = Boolean(body.preview || ctx.query.get("preview") === "true");

        const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
        if (!displayName) {
          throw new AppError(ErrorCodes.validationFailed, "displayName is required", 400, [
            { field: "displayName", reason: "required" },
          ]);
        }

        const locationType = body.locationType;
        if (locationType !== "ip" && locationType !== "country") {
          throw new AppError(
            ErrorCodes.validationFailed,
            "locationType must be 'ip' or 'country'",
            400,
            [{ field: "locationType", reason: "invalid" }],
          );
        }

        let ipRanges: string[] | undefined;
        let countriesAndRegions: string[] | undefined;

        if (locationType === "ip") {
          if (!Array.isArray(body.ipRanges) || body.ipRanges.length === 0) {
            throw new AppError(
              ErrorCodes.validationFailed,
              "At least one CIDR IP range is required for IP named location",
              400,
              [{ field: "ipRanges", reason: "required" }],
            );
          }
          for (const range of body.ipRanges) {
            if (!validateCidr(range)) {
              throw new AppError(
                ErrorCodes.validationFailed,
                `Invalid CIDR range: '${range}'. Must be a valid IPv4 or IPv6 CIDR prefix.`,
                400,
                [{ field: "ipRanges", reason: "invalid_cidr" }],
              );
            }
          }
          ipRanges = body.ipRanges.map((r: string) => r.trim());
        } else {
          if (!Array.isArray(body.countriesAndRegions) || body.countriesAndRegions.length === 0) {
            throw new AppError(
              ErrorCodes.validationFailed,
              "At least one country code is required for country named location",
              400,
              [{ field: "countriesAndRegions", reason: "required" }],
            );
          }
          for (const code of body.countriesAndRegions) {
            if (!validateCountryCode(code)) {
              throw new AppError(
                ErrorCodes.validationFailed,
                `Invalid country code: '${code}'. Must be a 2-letter ISO 3166-1 alpha-2 code.`,
                400,
                [{ field: "countriesAndRegions", reason: "invalid_country_code" }],
              );
            }
          }
          countriesAndRegions = body.countriesAndRegions.map((c: string) => c.trim().toUpperCase());
        }

        const input: CaNamedLocationCreateInput = {
          displayName,
          locationType,
          isTrusted: Boolean(body.isTrusted),
          ipRanges,
          countriesAndRegions,
          includeUnknownCountriesAndRegions: Boolean(body.includeUnknownCountriesAndRegions),
          countryLookupMethod: typeof body.countryLookupMethod === "string" ? body.countryLookupMethod : "clientIpAddress",
          preview: isPreview,
        };

        const result = await options.provider.createLocation(tenantId, input, isPreview);
        const status = isPreview ? 200 : 201;
        return {
          status,
          body: result,
        };
      },
    },

    // PATCH /v1/tenants/:tenantId/ca/named-locations/:locationId
    {
      method: "PATCH",
      path: CA_NAMED_LOCATIONS_ITEM_PATH,
      handler: async (ctx: RequestContext): Promise<RouteResponse> => {
        const caller = requireCaller(options.resolveCaller, ctx);
        const tenantId = requireTenantParam(ctx);
        const locationId = requireLocationIdParam(ctx);
        requireTenantInScope(caller, tenantId);
        await authorizeWrite(options, caller);

        const body = (ctx.body ?? {}) as Record<string, unknown>;
        const isPreview = Boolean(body.preview || ctx.query.get("preview") === "true");

        let ipRanges: string[] | undefined;
        if (Array.isArray(body.ipRanges)) {
          for (const range of body.ipRanges) {
            if (!validateCidr(range)) {
              throw new AppError(
                ErrorCodes.validationFailed,
                `Invalid CIDR range: '${range}'. Must be a valid IPv4 or IPv6 CIDR prefix.`,
                400,
                [{ field: "ipRanges", reason: "invalid_cidr" }],
              );
            }
          }
          ipRanges = body.ipRanges.map((r: string) => r.trim());
        }

        let countriesAndRegions: string[] | undefined;
        if (Array.isArray(body.countriesAndRegions)) {
          for (const code of body.countriesAndRegions) {
            if (!validateCountryCode(code)) {
              throw new AppError(
                ErrorCodes.validationFailed,
                `Invalid country code: '${code}'. Must be a 2-letter ISO 3166-1 alpha-2 code.`,
                400,
                [{ field: "countriesAndRegions", reason: "invalid_country_code" }],
              );
            }
          }
          countriesAndRegions = body.countriesAndRegions.map((c: string) => c.trim().toUpperCase());
        }

        const input: CaNamedLocationEditInput = {
          displayName: typeof body.displayName === "string" ? body.displayName.trim() : undefined,
          isTrusted: typeof body.isTrusted === "boolean" ? body.isTrusted : undefined,
          ipRanges,
          countriesAndRegions,
          includeUnknownCountriesAndRegions: typeof body.includeUnknownCountriesAndRegions === "boolean" ? body.includeUnknownCountriesAndRegions : undefined,
          countryLookupMethod: typeof body.countryLookupMethod === "string" ? body.countryLookupMethod : undefined,
          preview: isPreview,
        };

        const result = await options.provider.editLocation(tenantId, locationId, input, isPreview);
        return {
          status: 200,
          body: result,
        };
      },
    },

    // DELETE /v1/tenants/:tenantId/ca/named-locations/:locationId
    {
      method: "DELETE",
      path: CA_NAMED_LOCATIONS_ITEM_PATH,
      handler: async (ctx: RequestContext): Promise<RouteResponse> => {
        const caller = requireCaller(options.resolveCaller, ctx);
        const tenantId = requireTenantParam(ctx);
        const locationId = requireLocationIdParam(ctx);
        requireTenantInScope(caller, tenantId);
        await authorizeWrite(options, caller);

        const body = (ctx.body ?? {}) as Record<string, unknown>;
        const isPreview = Boolean(body.preview || ctx.query.get("preview") === "true");
        const confirmName = typeof body.confirmName === "string" ? body.confirmName : undefined;

        const result = await options.provider.deleteLocation(
          tenantId,
          locationId,
          confirmName,
          isPreview,
        );
        return {
          status: 200,
          body: result,
        };
      },
    },
  ];
}
