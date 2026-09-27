import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import type { KeyAccessAudit } from "../repository/key-access-audit.js";
import { buildServer, type RequestContext, type Route } from "../server.js";
import {
  DEVICE_LAPS_NOT_FOUND_CODE,
  DEVICE_LAPS_OPENAPI,
  DEVICE_LAPS_PATH,
  DEVICE_LAPS_PERMISSION,
  createDeviceLapsRoute,
  getDeviceLapsCredentials,
  type LapsAuditStore,
  type LapsCredentialsProvider,
  type LapsCredentialsResult,
} from "./device-laps.js";

const TENANT = "tenant-a";
const DEVICE = "device-1";
const ACTOR = "operator-1";
const AT = "2026-04-01T00:00:00.000Z";

function lapsResult(overrides: Partial<LapsCredentialsResult> = {}): LapsCredentialsResult {
  return {
    tenantId: TENANT,
    deviceId: DEVICE,
    backend: "windowsLaps",
    accountName: "Administrator",
    password: "windows-secret",
    backedUpAt: "2026-01-01T00:00:00.000Z",
    retrievedAt: AT,
    ...overrides,
  };
}

class FakeCredentials implements LapsCredentialsProvider {
  readonly calls: Array<{ tenantId: string; deviceId: string }> = [];

  constructor(private readonly stored: LapsCredentialsResult | null) {}

  async getCredentials(
    tenantId: string,
    deviceId: string,
  ): Promise<LapsCredentialsResult | null> {
    this.calls.push({ tenantId, deviceId });
    return this.stored;
  }
}

class FakeAudit implements LapsAuditStore {
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
    path: `/v1/tenants/${TENANT}/devices/${DEVICE}/laps`,
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

const WINDOWS_CREDENTIAL = lapsResult();
const LEGACY_CREDENTIAL = lapsResult({
  backend: "legacyLaps",
  accountName: "Admin",
  password: "legacy-secret",
});

describe("device laps handler", () => {
  it("returns the Windows LAPS credential with the backend identified", async () => {
    const credentials = new FakeCredentials(WINDOWS_CREDENTIAL);
    const audit = new FakeAudit();

    const response = await getDeviceLapsCredentials(
      { credentials, audit, now: () => AT },
      TENANT,
      DEVICE,
      ACTOR,
    );

    expect(response.status).toBe(200);
    expect(response.body.tenantId).toBe(TENANT);
    expect(response.body.deviceId).toBe(DEVICE);
    expect(response.body.backend).toBe("windowsLaps");
    expect(response.body.password).toBe("windows-secret");
    expect(response.body.retrievedAt).toBe(AT);
    expect(credentials.calls).toEqual([{ tenantId: TENANT, deviceId: DEVICE }]);
  });

  it("returns the legacy LAPS credential with the backend identified", async () => {
    const credentials = new FakeCredentials(LEGACY_CREDENTIAL);
    const audit = new FakeAudit();

    const response = await getDeviceLapsCredentials(
      { credentials, audit, now: () => AT },
      TENANT,
      DEVICE,
      ACTOR,
    );

    expect(response.status).toBe(200);
    expect(response.body.backend).toBe("legacyLaps");
    expect(response.body.password).toBe("legacy-secret");
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      tenantId: TENANT,
      deviceId: DEVICE,
      keyType: "laps",
      actor: ACTOR,
      at: AT,
    });
  });

  it("appends one audit row per retrieval with actor, device, key type, and timestamp", async () => {
    const credentials = new FakeCredentials(WINDOWS_CREDENTIAL);
    const audit = new FakeAudit();

    await getDeviceLapsCredentials({ credentials, audit, now: () => AT }, TENANT, DEVICE, ACTOR);

    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      tenantId: TENANT,
      deviceId: DEVICE,
      keyType: "laps",
      actor: ACTOR,
      at: AT,
    });
  });

  it("never stores credential values in the audit rows", async () => {
    const credentials = new FakeCredentials(WINDOWS_CREDENTIAL);
    const audit = new FakeAudit();

    await getDeviceLapsCredentials({ credentials, audit, now: () => AT }, TENANT, DEVICE, ACTOR);

    for (const row of audit.rows) {
      expect(JSON.stringify(row)).not.toContain(WINDOWS_CREDENTIAL.password);
    }
  });

  it("returns a structured not-found error when neither backend holds a credential", async () => {
    const credentials = new FakeCredentials(null);
    const audit = new FakeAudit();

    await expect(
      getDeviceLapsCredentials({ credentials, audit, now: () => AT }, TENANT, DEVICE, ACTOR),
    ).rejects.toMatchObject({ status: 404, code: DEVICE_LAPS_NOT_FOUND_CODE });
    expect(audit.rows).toHaveLength(0);
  });

  it("propagates a structured provider 404 without auditing", async () => {
    const missing: LapsCredentialsProvider = {
      getCredentials: () =>
        Promise.reject(new AppError(DEVICE_LAPS_NOT_FOUND_CODE, "No LAPS credential.", 404)),
    };
    const audit = new FakeAudit();

    await expect(
      getDeviceLapsCredentials({ credentials: missing, audit, now: () => AT }, TENANT, DEVICE, ACTOR),
    ).rejects.toMatchObject({ status: 404, code: DEVICE_LAPS_NOT_FOUND_CODE });
    expect(audit.rows).toHaveLength(0);
  });

  it("rejects blank tenant, device, and actor values", async () => {
    const credentials = new FakeCredentials(WINDOWS_CREDENTIAL);
    const audit = new FakeAudit();
    const options = { credentials, audit, now: () => AT };

    await expect(getDeviceLapsCredentials(options, "  ", DEVICE, ACTOR)).rejects.toMatchObject({
      status: 400,
    });
    await expect(getDeviceLapsCredentials(options, TENANT, "", ACTOR)).rejects.toMatchObject({
      status: 400,
    });
    await expect(getDeviceLapsCredentials(options, TENANT, DEVICE, " ")).rejects.toMatchObject({
      status: 400,
    });
    expect(audit.rows).toHaveLength(0);
  });
});

describe("device laps route", () => {
  function options(allowed: boolean, actor = ACTOR) {
    const credentials = new FakeCredentials(WINDOWS_CREDENTIAL);
    const audit = new FakeAudit();
    const routes = createDeviceLapsRoute({
      credentials,
      audit,
      authorize: () => allowed,
      actor: () => actor,
      now: () => AT,
    });
    return { credentials, audit, routes };
  }

  it("serves the credential scoped by the tenant and device in the path", async () => {
    const { audit, routes } = options(true);
    const baseUrl = await startServer(routes);

    const response = await fetch(`${baseUrl}/v1/tenants/${TENANT}/devices/${DEVICE}/laps`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { backend: string; deviceId: string };
    expect(body.deviceId).toBe(DEVICE);
    expect(body.backend).toBe("windowsLaps");
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.actor).toBe(ACTOR);
  });

  it("requires the high-privilege devices.keys permission", async () => {
    const { audit, routes } = options(false);
    const baseUrl = await startServer(routes);

    const response = await fetch(`${baseUrl}/v1/tenants/${TENANT}/devices/${DEVICE}/laps`);
    expect(response.status).toBe(403);
    expect(audit.rows).toHaveLength(0);
  });

  it("rejects a blank device id with a 400", async () => {
    const { routes } = options(true);
    const handler = routes[0]?.handler;
    if (!handler) throw new Error("laps route handler is missing");
    await expect(handler(context({ tenantId: TENANT, deviceId: "   " }))).rejects.toMatchObject({
      status: 400,
    });
  });

  it("publishes the devices.keys permission through the route module", () => {
    const path =
      DEVICE_LAPS_OPENAPI.paths["/tenants/{tenantId}/devices/{deviceId}/laps"];
    expect(path.get.permission).toBe("Endpoint.DeviceKeys.Reveal");
    expect(path.get.operationId).toBe("getDeviceLapsCredentials");
    expect(DEVICE_LAPS_PERMISSION).toBe("Endpoint.DeviceKeys.Reveal");
    expect(DEVICE_LAPS_PATH).toBe("/v1/tenants/:tenantId/devices/:deviceId/laps");
  });
});
