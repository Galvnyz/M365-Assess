// Per-device action history (EPIC-018 SPEC §6, §3.2 "Actions" tab). Read-only:
// the route returns the append-only DeviceAction records for one device, newest
// first, scoped by the tenant in the path so a caller cannot read another
// tenant's history. RBAC (`Endpoint.Device.Read`, SPEC §7) is declared for the OpenAPI
// path item and enforced by the shared authorize layer (T-0013).
import { AppError, ErrorCodes } from "../errors.js";
import type { DeviceAction, DeviceActionRepository } from "../repository/device-actions.js";
import type { RequestContext, Route, RouteHandler } from "../server.js";

export const DEVICE_ACTIONS_HISTORY_PATH = "/v1/tenants/:tenantId/devices/:deviceId/actions";

export type DeviceActionHistoryStore = Pick<DeviceActionRepository, "listDeviceActions">;

export interface DeviceActionHistoryResponse {
  readonly status: number;
  readonly body: { readonly actions: DeviceAction[] };
}

function requireParam(ctx: RequestContext, name: string): string {
  const value = ctx.params[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(ErrorCodes.validationFailed, `${name} is required`, 400);
  }
  return value.trim();
}

export async function getDeviceActionsHistory(
  store: DeviceActionHistoryStore,
  tenantId: string,
  deviceId: string,
): Promise<DeviceActionHistoryResponse> {
  const actions = await store.listDeviceActions(tenantId, deviceId);
  const newestFirst = [...actions].sort((left, right) =>
    right.appliedAt.localeCompare(left.appliedAt),
  );
  return { status: 200, body: { actions: newestFirst } };
}

export interface DeviceActionHistoryRouteOptions {
  readonly store: DeviceActionHistoryStore;
}

export function createDeviceActionsHistoryRoute(
  options: DeviceActionHistoryRouteOptions,
): Route[] {
  const handler: RouteHandler = async (ctx) => {
    const tenantId = requireParam(ctx, "tenantId");
    const deviceId = requireParam(ctx, "deviceId");
    const result = await getDeviceActionsHistory(options.store, tenantId, deviceId);
    return { status: result.status, body: result.body };
  };
  return [{ method: "GET", path: DEVICE_ACTIONS_HISTORY_PATH, handler }];
}

export const DEVICE_ACTIONS_HISTORY_OPENAPI = {
  paths: {
    "/tenants/{tenantId}/devices/{deviceId}/actions": {
      get: {
        operationId: "listDeviceActions",
        summary: "List a device's append-only action history, newest first",
        permission: "Endpoint.Device.Read",
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
          "200": { description: "The device's action records, newest first." },
          "400": { description: "A required path parameter is missing." },
        },
      },
    },
  },
} as const;
