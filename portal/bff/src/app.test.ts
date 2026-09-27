import { existsSync, mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  DATABASE_FILE,
  guardRoute,
  authorizeCaller,
  authorizeContext,
  canAccess,
  createApp,
  type App,
} from "./app.js";
import { loadConfig, type BffConfig } from "./config.js";
import type { WorkerRunner } from "./adapters/workers.js";
import { ALL_TENANTS, tenantScope } from "./rbac/scope.js";
import { buildServer, type RequestContext } from "./server.js";

const opened: { server: Server; app: App }[] = [];

afterEach(async () => {
  for (const { server, app } of opened.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    app.close();
  }
});

function config(overrides: Partial<BffConfig> = {}): BffConfig {
  return { ...loadConfig({}), ...overrides };
}

async function serve(
  devIdentityRole: BffConfig["devIdentityRole"],
  db = new Database(":memory:"),
  workerRunner?: WorkerRunner,
) {
  const app = createApp(config({ devIdentityRole }), { db, ...(workerRunner ? { workerRunner } : {}) });
  const server = buildServer({ routes: app.routes, authenticators: app.authenticators });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  opened.push({ server, app });
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  return {
    get: (p: string) => fetch(`${base}${p}`),
    post: (p: string, body: unknown) =>
      fetch(`${base}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  };
}

const INTUNE_TEMPLATE = {
  name: "Win Baseline",
  platform: "windows10",
  policyType: "compliance",
  policyJson: { displayName: "Win Baseline", "@odata.type": "#microsoft.graph.windows10CompliancePolicy" },
};

describe("authorization (T-0817)", () => {
  const caller = (...roles: string[]) => ({ roles, tenantScope: ALL_TENANTS });

  it("maps EPIC-001 roles onto base roles", () => {
    expect(canAccess(caller("operator"), "Endpoint.Intune.Read")).toBe(true);
    expect(canAccess(caller("operator"), "Endpoint.Intune.ReadWrite")).toBe(false);
    expect(canAccess(caller("admin"), "Endpoint.Intune.ReadWrite")).toBe(true);
  });

  it("translates EPIC-001 run permissions", () => {
    expect(canAccess(caller("operator"), "runs.read")).toBe(true);
    expect(canAccess(caller("operator"), "runs.create")).toBe(false);
    expect(canAccess(caller("admin"), "runs.create")).toBe(true);
    expect(canAccess(caller("admin"), "admin")).toBe(true);
    expect(canAccess(caller("editor"), "admin")).toBe(false);
  });

  it("accepts EPIC-038 base roles directly and ignores unknown roles", () => {
    expect(canAccess(caller("editor"), "Endpoint.Intune.ReadWrite")).toBe(true);
    expect(canAccess(caller("editor"), "Remediation.Apply")).toBe(false);
    expect(canAccess(caller("mystery"), "Endpoint.Intune.Read")).toBe(false);
  });

  it("treats a missing caller as unauthenticated, never allowed", () => {
    expect(canAccess(null, "Endpoint.Intune.Read")).toBe(false);
    expect(() => authorizeCaller(undefined, "Endpoint.Intune.Read")).toThrowError(
      expect.objectContaining({ status: 401 }),
    );
    expect(() => authorizeContext({ caller: null } as RequestContext, "Endpoint.Intune.Read")).toThrowError(
      expect.objectContaining({ status: 401 }),
    );
    expect(() => authorizeCaller(caller("operator"), "Endpoint.Intune.ReadWrite")).toThrowError(
      expect.objectContaining({ status: 403, code: "auth.forbidden" }),
    );
  });
});

describe("createApp (T-0817)", () => {
  it("mounts health, the baselines catalog, and the template CRUD routes", () => {
    const app = createApp(config(), { db: new Database(":memory:") });
    const paths = new Set(app.routes.map((r) => r.path));
    for (const p of ["/v1/health", "/v1/baselines/catalog", "/v1/ca-templates", "/v1/intune-templates", "/v1/group-templates"]) {
      expect(paths.has(p), p).toBe(true);
    }
    expect(app.authenticators).toEqual([]);
    app.close();
  });

  it("opens the database under the storage path when none is injected", () => {
    const storagePath = mkdtempSync(path.join(tmpdir(), "bff-app-"));
    try {
      const app = createApp(config({ storagePath: path.join(storagePath, "nested") }));
      expect(existsSync(path.join(storagePath, "nested", DATABASE_FILE))).toBe(true);
      app.close();
    } finally {
      rmSync(storagePath, { recursive: true, force: true });
    }
  });
});

describe("the served app (T-0817)", () => {
  it("serves health without authentication", async () => {
    const api = await serve(null);
    const res = await api.get("/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ storage: { reachable: true } });
  });

  it("answers 401 on protected routes when nobody is authenticated", async () => {
    const api = await serve(null);
    expect((await api.get("/v1/intune-templates")).status).toBe(401);
    expect((await api.get("/v1/group-templates")).status).toBe(401);
    expect((await api.get("/v1/baselines/catalog")).status).toBe(401);
  });

  it("lets a read-only caller read and refuses its writes", async () => {
    const api = await serve("operator");
    expect((await api.get("/v1/intune-templates")).status).toBe(200);
    expect((await api.get("/v1/baselines/catalog")).status).toBe(200);
    const write = await api.post("/v1/intune-templates", INTUNE_TEMPLATE);
    expect(write.status).toBe(403);
    expect(await write.json()).toMatchObject({ code: "request.forbidden" });
    expect((await api.get("/v1/group-templates")).status).toBe(403);
  });

  it("lets an admin write, persisting to SQLite", async () => {
    const db = new Database(":memory:");
    const api = await serve("admin", db);
    const created = await api.post("/v1/intune-templates", INTUNE_TEMPLATE);
    expect(created.status).toBe(201);
    const list = (await (await api.get("/v1/intune-templates")).json()) as { items: { name: string }[] };
    expect(list.items.map((t) => t.name)).toEqual(["Win Baseline"]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM intune_templates").get()).toEqual({ n: 1 });
  });

  it("rejects invalid bodies through the pipeline", async () => {
    const api = await serve("admin");
    const res = await api.post("/v1/intune-templates", { name: "", platform: "tvos" });
    expect(res.status).toBe(400);
  });
});

describe("tenants and onboarding routes (T-0822)", () => {
  it("lets a read-only caller list tenants but not add one", async () => {
    const api = await serve("operator");
    expect((await api.get("/v1/tenants")).status).toBe(200);
    expect((await api.post("/v1/tenants", { id: "t-a", displayName: "Contoso" })).status).toBe(403);
  });

  it("persists a tenant, its credential, and variables for an admin", async () => {
    const db = new Database(":memory:");
    const api = await serve("admin", db);
    expect((await api.post("/v1/tenants", { id: "t-a", displayName: "Contoso" })).status).toBe(201);
    expect(await (await api.get("/v1/tenants/t-a")).json()).toMatchObject({ id: "t-a", displayName: "Contoso" });
    const credential = await api.post("/v1/tenants/t-a/credential", {
      authMethod: "certificate-thumbprint",
      clientId: "app-1",
      thumbprint: "ABC123",
    });
    expect(credential.status).toBe(201);
    expect(db.prepare("SELECT thumbprint FROM tenant_credentials WHERE tenantId = ?").get("t-a")).toEqual({ thumbprint: "ABC123" });
    expect((await api.post("/v1/tenant-variables", { name: "region", value: "eu", tenantId: "t-a" })).status).toBe(201);
  });

  it("runs the connection test worker with the tenant's credential block", async () => {
    const calls: { entrypoint: string; job: unknown }[] = [];
    const runner: WorkerRunner = async (entrypoint, job) => {
      calls.push({ entrypoint, job });
      return { tenantId: "t-a", success: true, testedAt: "2026-09-26T00:00:00Z", services: [] } as never;
    };
    const api = await serve("admin", new Database(":memory:"), runner);
    await api.post("/v1/tenants", { id: "t-a", displayName: "Contoso" });
    await api.post("/v1/tenants/t-a/credential", { authMethod: "certificate-thumbprint", clientId: "app-1", thumbprint: "ABC123" });
    const res = await api.post("/v1/tenants/t-a/test-connection", {});
    expect(res.status).toBe(200);
    expect(calls).toEqual([
      {
        entrypoint: "test-tenant-connection.ps1",
        job: {
          tenantId: "t-a",
          credential: {
            credentialRef: "tenants/t-a/credential",
            record: expect.objectContaining({ tenantId: "t-a", clientId: "app-1", thumbprint: "ABC123" }),
          },
        },
      },
    ]);
  });

  it("does not serve GDAP sync unless a partner tenant is configured", async () => {
    const api = await serve("admin");
    expect((await api.post("/v1/gdap/sync", {})).status).toBe(404);
  });
});

describe("Intune and device routes (T-0820)", () => {
  /** A fake worker runner answering per entrypoint/action, recording every job. */
  function recordingRunner() {
    const calls: { entrypoint: string; job: Record<string, unknown> }[] = [];
    const runner: WorkerRunner = async (entrypoint, job) => {
      const j = job as Record<string, unknown>;
      calls.push({ entrypoint, job: j });
      if (entrypoint === "get-intune-policies.ps1" && j["policyId"]) {
        return { id: j["policyId"], displayName: `Policy ${j["policyId"]}`, platform: "windows", body: { passwordMinimumLength: j["policyId"] === "p-1" ? 8 : 12 }, assignments: [] } as never;
      }
      if (entrypoint === "get-intune-policies.ps1") {
        return { tenantId: "t-a", kind: j["kind"], totalCount: 0, items: [], nextCursor: null } as never;
      }
      if (entrypoint === "get-bitlocker-keys.ps1") {
        return { tenantId: "t-a", deviceId: j["deviceId"], keys: [{ id: "k-1", key: "123-456", volumeType: "operatingSystemVolume", createdDateTime: null }] } as never;
      }
      return { tenantId: "t-a", items: [] } as never;
    };
    return { runner, calls };
  }

  async function adminWithTenant(runner: WorkerRunner, role: "admin" | "operator" = "admin") {
    const db = new Database(":memory:");
    const setup = await serve("admin", db, runner);
    await setup.post("/v1/tenants", { id: "t-a", displayName: "Contoso" });
    await setup.post("/v1/tenants/t-a/credential", { authMethod: "certificate-thumbprint", clientId: "app-1", thumbprint: "ABC123" });
    return role === "admin" ? setup : serve("operator", db, runner);
  }

  it("dispatches /intune/* paths to their own modules, not the generic :kind routes", async () => {
    const { runner, calls } = recordingRunner();
    const api = await adminWithTenant(runner);
    expect((await api.get("/v1/tenants/t-a/intune/assignment-filters")).status).toBe(200);
    expect((await api.get("/v1/tenants/t-a/intune/reusable-settings")).status).toBe(200);
    const compare = await api.get("/v1/tenants/t-a/intune/compare?left=policy:compliance:p-1&right=policy:compliance:p-2");
    expect(compare.status).toBe(200);
    expect(await compare.json()).toMatchObject({ settings: [{ path: "passwordMinimumLength", kind: "changed", left: 8, right: 12 }] });
    const list = await api.get("/v1/tenants/t-a/intune/compliance");
    expect(list.status).toBe(200);
    // The body is a JSON object, not a JSON-encoded string (T-0829 fix).
    expect(await list.json()).toMatchObject({ kind: "compliance", items: [] });
    expect(calls.map((c) => [c.entrypoint, c.job["action"] ?? c.job["policyId"] ?? c.job["kind"]])).toEqual([
      ["set-assignment-filter.ps1", "list"],
      ["sync-reusable-settings.ps1", "list"],
      ["get-intune-policies.ps1", "p-1"],
      ["get-intune-policies.ps1", "p-2"],
      ["get-intune-policies.ps1", "compliance"],
    ]);
    for (const call of calls) expect(call.job["credential"]).toMatchObject({ credentialRef: "tenants/t-a/credential" });
  });

  it("serves one policy's detail for the editor (T-0829)", async () => {
    const { runner } = recordingRunner();
    const api = await adminWithTenant(runner);
    const res = await api.get("/v1/tenants/t-a/intune/compliance/p-1");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "p-1", body: { passwordMinimumLength: 8 } });
  });

  it("lets a read-only caller list policies but not write them", async () => {
    const { runner, calls } = recordingRunner();
    const api = await adminWithTenant(runner, "operator");
    expect((await api.get("/v1/tenants/t-a/intune/compliance")).status).toBe(200);
    expect((await api.post("/v1/tenants/t-a/intune/compliance", { displayName: "x", preview: true })).status).toBe(403);
    expect(calls.filter((c) => c.entrypoint === "set-intune-policy.ps1")).toHaveLength(0);
  });

  it("reveals BitLocker keys to admins only, auditing each reveal", async () => {
    const { runner } = recordingRunner();
    const admin = await adminWithTenant(runner);
    const res = await admin.get("/v1/tenants/t-a/devices/d-1/bitlocker");
    expect(res.status).toBe(200);
    const operator = await serve("operator", new Database(":memory:"), runner);
    expect((await operator.get("/v1/tenants/t-a/devices/d-1/bitlocker")).status).toBe(403);
  });

  it("guards the device history route, which does no authorization itself", async () => {
    const anonymous = await serve(null);
    expect((await anonymous.get("/v1/tenants/t-a/devices/d-1/actions")).status).toBe(401);
    const operator = await serve("operator");
    expect((await operator.get("/v1/tenants/t-a/devices/d-1/actions")).status).toBe(200);

    const inner = { method: "GET", path: "/v1/tenants/:tenantId/x", handler: () => ({ status: 200 }) };
    const guarded = guardRoute(inner, "Endpoint.Device.Read");
    const ctx = (tenantId: string) =>
      ({ params: { tenantId }, caller: { roles: ["operator"], tenantScope: tenantScope(["t-a"]) } }) as unknown as RequestContext;
    expect(await guarded.handler(ctx("t-a"))).toEqual({ status: 200 });
    expect(() => guarded.handler(ctx("t-b"))).toThrowError(expect.objectContaining({ status: 403 }));
  });
});
