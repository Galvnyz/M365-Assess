// LAPS credential reveal (EPIC-018 SPEC §2 US-5, §3.4, §6, §11.4).
// GET /v1/tenants/{id}/devices/{deviceId}/laps returns the device's
// local-admin credential from whichever backend holds it (Windows LAPS or
// legacy LAPS), with the backend identified. Every retrieval appends one
// KeyAccessAudit row (actor, device, key type, timestamp); a device with
// neither credential yields a structured 404. Credential values travel in
// the response body only and are never written to storage or logs.
import { randomUUID } from "node:crypto";
import { AppError, ErrorCodes } from "../errors.js";
import type {
  KeyAccessAudit,
  KeyAccessAuditRepository,
} from "../repository/key-access-audit.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const DEVICE_LAPS_PATH = "/v1/tenants/:tenantId/devices/:deviceId/laps";
export const DEVICE_LAPS_PERMISSION = "Endpoint.DeviceKeys.Reveal";
export const DEVICE_LAPS_NOT_FOUND_CODE = "laps.not_found";

const FORBIDDEN_CODE = "rbac.forbidden";

export type LapsBackend = "windowsLaps" | "legacyLaps";

export interface LapsCredentialsResult {
  readonly tenantId: string;
  readonly deviceId: string;
  readonly backend: LapsBackend;
  readonly accountName: string | null;
  readonly password: string;
  readonly backedUpAt: string | null;
  readonly retrievedAt: string;
}

export interface LapsCredentialsProvider {
  getCredentials(tenantId: string, deviceId: string): Promise<LapsCredentialsResult | null>;
}

export type LapsAuthorizer = (
  ctx: RequestContext,
  permission: string,
) => boolean | Promise<boolean>;

export type LapsAuditStore = Pick<KeyAccessAuditRepository, "appendKeyAccessAudit">;

export interface DeviceLapsOptions {
  readonly credentials: LapsCredentialsProvider;
  readonly audit: LapsAuditStore;
  readonly authorize: LapsAuthorizer;
  readonly actor?: (ctx: RequestContext) => string;
  readonly now?: () => string;
}

export interface DeviceLapsResponse {
  readonly status: number;
  readonly body: {
    readonly tenantId: string;
    readonly deviceId: string;
    readonly backend: LapsBackend;
    readonly accountName: string | null;
    readonly password: string;
    readonly backedUpAt: string | null;
    readonly retrievedAt: string;
  };
}

function requireParam(ctx: RequestContext, name: string): string {
  const value = ctx.params[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, `${name} is required`, 400);
  }
  return value.trim();
}

export async function getDeviceLapsCredentials(
  options: Pick<DeviceLapsOptions, "credentials" | "audit" | "now">,
  tenantId: string,
  deviceId: string,
  actor: string,
): Promise<DeviceLapsResponse> {
  if (tenantId.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "tenantId is required", 400);
  }
  if (deviceId.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "deviceId is required", 400);
  }
  if (actor.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "actor is required", 400);
  }
  let result: LapsCredentialsResult | null;
  try {
    result = await options.credentials.getCredentials(tenantId, deviceId);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) {
      throw error;
    }
    throw error;
  }
  if (!result || result.password.length === 0) {
    throw new AppError(
      DEVICE_LAPS_NOT_FOUND_CODE,
      `No LAPS credential found for device '${deviceId}'.`,
      404,
    );
  }
  const at = options.now ? options.now() : new Date().toISOString();
  const audit: KeyAccessAudit = {
    id: randomUUID(),
    tenantId,
    deviceId,
    keyType: "laps",
    actor,
    at,
  };
  await options.audit.appendKeyAccessAudit(audit);
  return {
    status: 200,
    body: {
      tenantId,
      deviceId,
      backend: result.backend,
      accountName: result.accountName,
      password: result.password,
      backedUpAt: result.backedUpAt,
      retrievedAt: result.retrievedAt,
    },
  };
}

export function createDeviceLapsRoute(options: DeviceLapsOptions): Route[] {
  const actorOf = (ctx: RequestContext): string =>
    options.actor ? options.actor(ctx) : "system";

  const handler = async (ctx: RequestContext): Promise<RouteResponse> => {
    const allowed = await options.authorize(ctx, DEVICE_LAPS_PERMISSION);
    if (!allowed) {
      throw new AppError(
        FORBIDDEN_CODE,
        `permission ${DEVICE_LAPS_PERMISSION} is required`,
        403,
      );
    }
    const tenantId = requireParam(ctx, "tenantId");
    const deviceId = requireParam(ctx, "deviceId");
    const result = await getDeviceLapsCredentials(options, tenantId, deviceId, actorOf(ctx));
    return { status: result.status, body: result.body };
  };
  return [{ method: "GET", path: DEVICE_LAPS_PATH, handler }];
}

export const DEVICE_LAPS_OPENAPI = {
  paths: {
    "/tenants/{tenantId}/devices/{deviceId}/laps": {
      get: {
        operationId: "getDeviceLapsCredentials",
        summary: "Reveal a device's LAPS credential; every reveal is audited",
        permission: "Endpoint.DeviceKeys.Reveal",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "tenantId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "deviceId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": { description: "The device's LAPS credential and metadata." },
          "400": { description: "A required path parameter is missing." },
          "403": { description: "The caller lacks the devices.keys permission." },
          "404": { description: "The device holds no LAPS credential in either backend." },
        },
      },
    },
  },
} as const;
