import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer, type Route } from "../server.js";
import type { DeviceAction } from "../repository/device-actions.js";
import {
  DEVICE_ACTIONS_HISTORY_OPENAPI,
  DEVICE_ACTIONS_HISTORY_PATH,
  createDeviceActionsHistoryRoute,
  getDeviceActionsHistory,
  type DeviceActionHistoryStore,
} from "./device-actions-history.js";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const DEVICE_1 = "device-1";
const DEVICE_2 = "device-2";

class FakeStore implements DeviceActionHistoryStore {
  readonly calls: Array<{ tenantId: string; deviceId: string }> = [];

  constructor(private readonly rows: readonly DeviceAction[]) {}

  async listDeviceActions(tenantId: string, deviceId: string): Promise<DeviceAction[]> {
    this.calls.push({ tenantId, deviceId });
    return this.rows.filter((row) => row.tenantId === tenantId && row.deviceId === deviceId);
  }
}

function action(id: string, extra: Partial<DeviceAction> = {}): DeviceAction {
  return {
    id,
    tenantId: TENANT_A,
    deviceId: DEVICE_1,
    action: "sync",
    reason: null,
    state: "applied",
    appliedAt: "2026-01-01T00:00:00.000Z",
    appliedBy: "operator-1",
    result: "success",
    ...extra,
  };
}

const openServers: Server[] = [];

async function startServer(routes: readonly Route[]) {
  const server = buildServer({ routes });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  openServers.push(server);
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe("device action history handler", () => {
  it("returns the device's history newest first", async () => {
    const store = new FakeStore([
      action("oldest", { appliedAt: "2026-01-01T00:00:00.000Z" }),
      action("newest", { appliedAt: "2026-03-01T00:00:00.000Z" }),
      action("middle", { appliedAt: "2026-02-01T00:00:00.000Z" }),
    ]);

    const response = await getDeviceActionsHistory(store, TENANT_A, DEVICE_1);
    expect(response.status).toBe(200);
    expect(response.body.actions.map((row) => row.id)).toEqual(["newest", "middle", "oldest"]);
  });

  it("returns an empty history rather than an error", async () => {
    const response = await getDeviceActionsHistory(new FakeStore([]), TENANT_A, DEVICE_1);
    expect(response.status).toBe(200);
    expect(response.body.actions).toEqual([]);
  });
});

describe("device action history route", () => {
  it("serves history scoped by the tenant and device in the path", async () => {
    const store = new FakeStore([
      action("a1", { id: "a1" }),
      action("a2", { id: "a2" }),
      action("other-tenant", { id: "other-tenant", tenantId: TENANT_B }),
      action("other-device", { id: "other-device", deviceId: DEVICE_2 }),
    ]);
    const baseUrl = await startServer(createDeviceActionsHistoryRoute({ store }));

    const response = await fetch(
      `${baseUrl}/v1/tenants/${TENANT_A}/devices/${DEVICE_1}/actions`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { actions: DeviceAction[] };
    expect(body.actions.map((row) => row.id).sort()).toEqual(["a1", "a2"]);
    expect(store.calls).toEqual([{ tenantId: TENANT_A, deviceId: DEVICE_1 }]);
  });

  it("publishes the devices.read permission through the route module", () => {
    const path = DEVICE_ACTIONS_HISTORY_OPENAPI.paths["/tenants/{tenantId}/devices/{deviceId}/actions"];
    expect(path.get.permission).toBe("Endpoint.Device.Read");
    expect(path.get.operationId).toBe("listDeviceActions");
    expect(DEVICE_ACTIONS_HISTORY_PATH).toBe("/v1/tenants/:tenantId/devices/:deviceId/actions");
  });
});
