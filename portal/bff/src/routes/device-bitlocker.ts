// BitLocker recovery-key reveal (EPIC-018 SPEC §2 US-4, §3.4, §4.2, §6).
// GET /v1/tenants/{id}/devices/{deviceId}/bitlocker returns the device's
// recovery key(s) with metadata. Every retrieval appends one KeyAccessAudit
// row per revealed key (actor, device, key type, timestamp); key values travel
// in the response body only and are never written to storage or logs.
import { randomUUID } from "node:crypto";
import { AppError, ErrorCodes } from "../errors.js";
import type {
  KeyAccessAudit,
  KeyAccessAuditRepository,
} from "../repository/key-access-audit.js";
import type { RequestContext, Route, RouteResponse } from "../server.js";

export const DEVICE_BITLOCKER_PATH = "/v1/tenants/:tenantId/devices/:deviceId/bitlocker";
export const DEVICE_BITLOCKER_PERMISSION = "Endpoint.DeviceKeys.Reveal";

const FORBIDDEN_CODE = "rbac.forbidden";

export interface BitLockerKey {
  readonly keyId: string;
  readonly key: string;
  readonly keyType: string;
  readonly createdAt: string | null;
}

export interface BitLockerKeysResult {
  readonly tenantId: string;
  readonly deviceId: string;
  readonly keys: readonly BitLockerKey[];
  readonly retrievedAt: string;
}

export interface BitLockerKeysProvider {
  getKeys(tenantId: string, deviceId: string): Promise<BitLockerKeysResult>;
}

export type BitLockerAuthorizer = (
  ctx: RequestContext,
  permission: string,
) => boolean | Promise<boolean>;

export type BitLockerAuditStore = Pick<KeyAccessAuditRepository, "appendKeyAccessAudit">;

export interface DeviceBitLockerOptions {
  readonly keys: BitLockerKeysProvider;
  readonly audit: BitLockerAuditStore;
  readonly authorize: BitLockerAuthorizer;
  readonly actor?: (ctx: RequestContext) => string;
  readonly now?: () => string;
}

export interface DeviceBitLockerResponse {
  readonly status: number;
  readonly body: {
    readonly tenantId: string;
    readonly deviceId: string;
    readonly keys: readonly BitLockerKey[];
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

export async function getDeviceBitLockerKeys(
  options: Pick<DeviceBitLockerOptions, "keys" | "audit" | "now">,
  tenantId: string,
  deviceId: string,
  actor: string,
): Promise<DeviceBitLockerResponse> {
  if (tenantId.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "tenantId is required", 400);
  }
  if (deviceId.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "deviceId is required", 400);
  }
  if (actor.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, "actor is required", 400);
  }
  const result = await options.keys.getKeys(tenantId, deviceId);
  const at = options.now ? options.now() : new Date().toISOString();
  const revealed = result.keys.length > 0 ? result.keys : [{ keyType: "bitlocker" }];
  for (const key of revealed) {
    const audit: KeyAccessAudit = {
      id: randomUUID(),
      tenantId,
      deviceId,
      keyType: key.keyType === "laps" ? "laps" : "bitlocker",
      actor,
      at,
    };
    await options.audit.appendKeyAccessAudit(audit);
  }
  return {
    status: 200,
    body: {
      tenantId,
      deviceId,
      keys: [...result.keys],
      retrievedAt: result.retrievedAt,
    },
  };
}

export function createDeviceBitLockerRoute(options: DeviceBitLockerOptions): Route[] {
  const actorOf = (ctx: RequestContext): string =>
    options.actor ? options.actor(ctx) : "system";

  const handler = async (ctx: RequestContext): Promise<RouteResponse> => {
    const allowed = await options.authorize(ctx, DEVICE_BITLOCKER_PERMISSION);
    if (!allowed) {
      throw new AppError(
        FORBIDDEN_CODE,
        `permission ${DEVICE_BITLOCKER_PERMISSION} is required`,
        403,
      );
    }
    const tenantId = requireParam(ctx, "tenantId");
    const deviceId = requireParam(ctx, "deviceId");
    const result = await getDeviceBitLockerKeys(options, tenantId, deviceId, actorOf(ctx));
    return { status: result.status, body: result.body };
  };
  return [{ method: "GET", path: DEVICE_BITLOCKER_PATH, handler }];
}

export const DEVICE_BITLOCKER_OPENAPI = {
  paths: {
    "/tenants/{tenantId}/devices/{deviceId}/bitlocker": {
      get: {
        operationId: "getDeviceBitLockerKeys",
        summary: "Reveal a device's BitLocker recovery keys; every reveal is audited",
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
          "200": { description: "The device's recovery keys and metadata." },
          "400": { description: "A required path parameter is missing." },
          "403": { description: "The caller lacks the devices.keys permission." },
        },
      },
    },
  },
} as const;
