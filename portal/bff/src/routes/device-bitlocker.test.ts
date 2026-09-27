import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { KeyAccessAudit } from "../repository/key-access-audit.js";
import { buildServer, type RequestContext, type Route } from "../server.js";
import {
  DEVICE_BITLOCKER_OPENAPI,
  DEVICE_BITLOCKER_PATH,
  DEVICE_BITLOCKER_PERMISSION,
  createDeviceBitLockerRoute,
  getDeviceBitLockerKeys,
  type BitLockerAuditStore,
  type BitLockerKey,
  type BitLockerKeysProvider,
  type BitLockerKeysResult,
} from "./device-bitlocker.js";

const TENANT = "tenant-a";
const DEVICE = "device-1";
const ACTOR = "operator-1";
const AT = "2026-04-01T00:00:00.000Z";

function keysResult(keys: BitLockerKeysResult["keys"]): BitLockerKeysResult {
  return {
    tenantId: TENANT,
    deviceId: DEVICE,
    keys: [...keys],
    retrievedAt: AT,
  };
}

class FakeKeys implements BitLockerKeysProvider {
  readonly calls: Array<{ tenantId: string; deviceId: string }> = [];

  constructor(private readonly stored: readonly BitLockerKey[]) {}

  async getKeys(tenantId: string, deviceId: string): Promise<BitLockerKeysResult> {
    this.calls.push({ tenantId, deviceId });
    return keysResult(this.stored);
  }
}

class FakeAudit implements BitLockerAuditStore {
  readonly rows: KeyAccessAudit[] = [];

  async appendKeyAccessAudit(input: KeyAccessAudit): Promise<KeyAccessAudit> {
    this.rows.push({ ...input });
    return input;
  }
}

function context(params: Record<string, string>): RequestContext {
  return {
    correlationId: "correlation-1",
    method: "GET",
    path: `/v1/tenants/${TENANT}/devices/${DEVICE}/bitlocker`,
    query: new URLSearchParams(),
    headers: {},
    params,
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

const SAMPLE_KEY = {
  keyId: "recovery-key-1",
  key: "111111-222222-333333-444444-555555-666666-777777-888888",
  keyType: "bitlocker",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("device bitlocker handler", () => {
  it("returns the device's recovery keys and metadata", async () => {
    const keys = new FakeKeys([SAMPLE_KEY]);
    const audit = new FakeAudit();

    const response = await getDeviceBitLockerKeys({ keys, audit, now: () => AT }, TENANT, DEVICE, ACTOR);

    expect(response.status).toBe(200);
    expect(response.body.tenantId).toBe(TENANT);
    expect(response.body.deviceId).toBe(DEVICE);
    expect(response.body.retrievedAt).toBe(AT);
    expect([...response.body.keys]).toEqual([SAMPLE_KEY]);
    expect(keys.calls).toEqual([{ tenantId: TENANT, deviceId: DEVICE }]);
  });

  it("appends one audit row per revealed key with actor, device, key type, and timestamp", async () => {
    const keys = new FakeKeys([
      SAMPLE_KEY,
      { ...SAMPLE_KEY, keyId: "recovery-key-2" },
    ]);
    const audit = new FakeAudit();

    await getDeviceBitLockerKeys({ keys, audit, now: () => AT }, TENANT, DEVICE, ACTOR);

    expect(audit.rows).toHaveLength(2);
    for (const row of audit.rows) {
      expect(row.tenantId).toBe(TENANT);
      expect(row.deviceId).toBe(DEVICE);
      expect(row.keyType).toBe("bitlocker");
      expect(row.actor).toBe(ACTOR);
      expect(row.at).toBe(AT);
    }
  });

  it("audits the retrieval even when the device has no keys", async () => {
    const keys = new FakeKeys([]);
    const audit = new FakeAudit();

    const response = await getDeviceBitLockerKeys({ keys, audit, now: () => AT }, TENANT, DEVICE, ACTOR);

    expect(response.status).toBe(200);
    expect([...response.body.keys]).toEqual([]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      tenantId: TENANT,
      deviceId: DEVICE,
      keyType: "bitlocker",
      actor: ACTOR,
      at: AT,
    });
  });

  it("never stores key values in the audit rows", async () => {
    const keys = new FakeKeys([SAMPLE_KEY]);
    const audit = new FakeAudit();

    await getDeviceBitLockerKeys({ keys, audit, now: () => AT }, TENANT, DEVICE, ACTOR);

    for (const row of audit.rows) {
      expect(JSON.stringify(row)).not.toContain(SAMPLE_KEY.key);
    }
  });

  it("rejects blank tenant, device, and actor values", async () => {
    const keys = new FakeKeys([SAMPLE_KEY]);
    const audit = new FakeAudit();
    const options = { keys, audit, now: () => AT };

    await expect(getDeviceBitLockerKeys(options, "  ", DEVICE, ACTOR)).rejects.toMatchObject({
      status: 400,
    });
    await expect(getDeviceBitLockerKeys(options, TENANT, "", ACTOR)).rejects.toMatchObject({
      status: 400,
    });
    await expect(getDeviceBitLockerKeys(options, TENANT, DEVICE, " ")).rejects.toMatchObject({
      status: 400,
    });
    expect(audit.rows).toHaveLength(0);
  });
});

describe("device bitlocker route", () => {
  function options(allowed: boolean, actor = ACTOR) {
    const keys = new FakeKeys([SAMPLE_KEY]);
    const audit = new FakeAudit();
    const routes = createDeviceBitLockerRoute({
      keys,
      audit,
      authorize: () => allowed,
      actor: () => actor,
      now: () => AT,
    });
    return { keys, audit, routes };
  }

  it("serves keys scoped by the tenant and device in the path", async () => {
    const { audit, routes } = options(true);
    const baseUrl = await startServer(routes);

    const response = await fetch(`${baseUrl}/v1/tenants/${TENANT}/devices/${DEVICE}/bitlocker`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { keys: unknown[]; deviceId: string };
    expect(body.deviceId).toBe(DEVICE);
    expect(body.keys).toHaveLength(1);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.actor).toBe(ACTOR);
  });

  it("requires the high-privilege devices.keys permission", async () => {
    const { audit, routes } = options(false);
    const baseUrl = await startServer(routes);

    const response = await fetch(`${baseUrl}/v1/tenants/${TENANT}/devices/${DEVICE}/bitlocker`);
    expect(response.status).toBe(403);
    expect(audit.rows).toHaveLength(0);
  });

  it("rejects a blank device id with a 400", async () => {
    const { routes } = options(true);
    const handler = routes[0]?.handler;
    if (!handler) throw new Error("bitlocker route handler is missing");
    await expect(handler(context({ tenantId: TENANT, deviceId: "   " }))).rejects.toMatchObject({
      status: 400,
    });
  });

  it("publishes the devices.keys permission through the route module", () => {
    const path =
      DEVICE_BITLOCKER_OPENAPI.paths["/tenants/{tenantId}/devices/{deviceId}/bitlocker"];
    expect(path.get.permission).toBe("Endpoint.DeviceKeys.Reveal");
    expect(path.get.operationId).toBe("getDeviceBitLockerKeys");
    expect(DEVICE_BITLOCKER_PERMISSION).toBe("Endpoint.DeviceKeys.Reveal");
    expect(DEVICE_BITLOCKER_PATH).toBe("/v1/tenants/:tenantId/devices/:deviceId/bitlocker");
  });
});
