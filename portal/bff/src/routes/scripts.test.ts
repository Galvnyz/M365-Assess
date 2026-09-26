// T-0127 — Custom script CRUD, versions, and dry-run/run API.
// Route-level tests over in-memory seams: a script store and a sandbox stub.

import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { ALL_TENANTS, tenantScope } from "../rbac/scope.js";
import { RbacErrorCodes, type Caller } from "../rbac/authorize.js";
import type { RequestContext } from "../server.js";
import {
  SCRIPTS_DRY_RUN_NOT_SUPPORTED,
  SCRIPTS_NOT_FOUND,
  SCRIPTS_OPENAPI,
  SCRIPTS_PERMISSIONS,
  SCRIPT_DETAIL_PATH,
  SCRIPT_RUN_PATH,
  SCRIPT_VERSIONS_PATH,
  SCRIPTS_PATH,
  createScriptRoutes,
  declaresDryRunContract,
  type AppendVersionInput,
  type CustomScriptRecord,
  type CustomScriptStore,
  type CustomScriptVersionRecord,
  type RegisterScriptInput,
  type ScriptSandbox,
  type ScriptSandboxRunInput,
  type SetScriptFlagsInput,
} from "./scripts.js";

const TENANT_1 = "11111111-1111-1111-1111-111111111111";
const TENANT_2 = "22222222-2222-2222-2222-222222222222";

class MemoryScriptStore implements CustomScriptStore {
  readonly scripts = new Map<string, CustomScriptRecord>();
  readonly versions = new Map<string, CustomScriptVersionRecord[]>();

  async listScripts(): Promise<readonly CustomScriptRecord[]> {
    return [...this.scripts.values()];
  }

  async getScript(id: string): Promise<CustomScriptRecord | undefined> {
    return this.scripts.get(id);
  }

  async registerScript(input: RegisterScriptInput): Promise<CustomScriptRecord> {
    const script: CustomScriptRecord = {
      id: input.id,
      name: input.name,
      author: input.author,
      enabled: input.enabled ?? false,
      alertsEnabled: input.alertsEnabled ?? false,
      currentVersionId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    this.scripts.set(script.id, script);
    this.versions.set(script.id, []);
    return script;
  }

  async setScriptFlags(input: SetScriptFlagsInput): Promise<CustomScriptRecord | undefined> {
    const script = this.scripts.get(input.scriptId);
    if (!script) return undefined;
    const updated: CustomScriptRecord = {
      ...script,
      enabled: input.enabled ?? script.enabled,
      alertsEnabled: input.alertsEnabled ?? script.alertsEnabled,
    };
    this.scripts.set(updated.id, updated);
    return updated;
  }

  async appendVersion(input: AppendVersionInput): Promise<CustomScriptVersionRecord> {
    const version: CustomScriptVersionRecord = {
      id: input.id,
      scriptId: input.scriptId,
      content: input.content,
      markdownTemplate: input.markdownTemplate ?? null,
      parameters: input.parameters ?? null,
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: input.createdBy,
    };
    const list = this.versions.get(input.scriptId) ?? [];
    list.push(version);
    this.versions.set(input.scriptId, list);
    const script = this.scripts.get(input.scriptId);
    if (script) this.scripts.set(script.id, { ...script, currentVersionId: version.id });
    return version;
  }

  async listVersions(scriptId: string): Promise<readonly CustomScriptVersionRecord[]> {
    return this.versions.get(scriptId) ?? [];
  }

  async getVersion(versionId: string): Promise<CustomScriptVersionRecord | undefined> {
    for (const list of this.versions.values()) {
      const found = list.find((v) => v.id === versionId);
      if (found) return found;
    }
    return undefined;
  }

  async deleteScript(scriptId: string): Promise<boolean> {
    const existed = this.scripts.delete(scriptId);
    this.versions.delete(scriptId);
    return existed;
  }
}

class FakeSandbox implements ScriptSandbox {
  readonly calls: ScriptSandboxRunInput[] = [];
  async run(input: ScriptSandboxRunInput): Promise<{ output: string; exitCode: number }> {
    this.calls.push(input);
    return { output: input.dryRun ? "planned change" : "applied change", exitCode: 0 };
  }
}

function adminCaller(): Caller {
  return { roles: ["admin"], tenantScope: ALL_TENANTS };
}

function allowAll(): void {}
function denyAll(): void {
  throw new AppError(RbacErrorCodes.forbidden, "not permitted to perform this action", 403);
}

let seq = 0;
function makeOptions(store: CustomScriptStore, sandbox: ScriptSandbox, overrides: Record<string, unknown> = {}) {
  seq = 0;
  return {
    store,
    sandbox,
    resolveCaller: () => adminCaller(),
    authorize: allowAll,
    idGenerator: () => `id-${(seq += 1)}`,
    ...overrides,
  };
}

function routeFor(opts: Parameters<typeof createScriptRoutes>[0], method: string, path: string) {
  const route = createScriptRoutes(opts).find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`route not found: ${method} ${path}`);
  return route;
}

function ctx(
  method: string,
  path: string,
  options: { params?: Record<string, string>; body?: Record<string, unknown> } = {},
): RequestContext & { body?: unknown } {
  return {
    correlationId: "corr-1",
    method,
    path,
    query: new URLSearchParams(),
    headers: {},
    params: options.params ?? {},
    body: options.body,
  };
}

async function seedScript(store: MemoryScriptStore, sandbox: FakeSandbox, dryRunContract = true) {
  const create = routeFor(makeOptions(store, sandbox), "POST", SCRIPTS_PATH);
  const res = await create.handler(
    ctx("POST", SCRIPTS_PATH, {
      body: {
        name: "Inventory",
        content: "Write-Output 'hi'",
        author: "user-1",
        parameters: { dryRunContract },
      },
    }),
  );
  const body = res.body as { script: { id: string }; version: { id: string } };
  return body.script.id;
}

describe("custom script CRUD and versions (T-0127)", () => {
  it("creates a script and always appends its first version", async () => {
    const store = new MemoryScriptStore();
    const route = routeFor(makeOptions(store, new FakeSandbox()), "POST", SCRIPTS_PATH);
    const res = await route.handler(
      ctx("POST", SCRIPTS_PATH, { body: { name: "Inventory", content: "Write-Output 'x'", author: "u1" } }),
    );
    expect(res.status).toBe(201);
    const body = res.body as { script: Record<string, unknown>; version: Record<string, unknown> };
    expect(body.script.name).toBe("Inventory");
    expect(body.version.content).toBe("Write-Output 'x'");
    expect(store.versions.get(body.script.id as string)).toHaveLength(1);
  });

  it("reads, patches (appending a version), lists versions, and deletes", async () => {
    const store = new MemoryScriptStore();
    const sandbox = new FakeSandbox();
    const scriptId = await seedScript(store, sandbox);

    const get = routeFor(makeOptions(store, sandbox), "GET", SCRIPT_DETAIL_PATH);
    const got = await get.handler(ctx("GET", SCRIPT_DETAIL_PATH, { params: { scriptId } }));
    expect((got.body as { script: { id: string } }).script.id).toBe(scriptId);

    const patch = routeFor(makeOptions(store, sandbox), "PATCH", SCRIPT_DETAIL_PATH);
    const patched = await patch.handler(
      ctx("PATCH", SCRIPT_DETAIL_PATH, { params: { scriptId }, body: { enabled: true, content: "Write-Output 'v2'" } }),
    );
    expect((patched.body as { script: { enabled: boolean } }).script.enabled).toBe(true);
    expect((patched.body as { version: { content: string } }).version.content).toBe("Write-Output 'v2'");
    expect(store.versions.get(scriptId)).toHaveLength(2);

    const versions = routeFor(makeOptions(store, sandbox), "GET", SCRIPT_VERSIONS_PATH);
    const listed = await versions.handler(ctx("GET", SCRIPT_VERSIONS_PATH, { params: { scriptId } }));
    expect((listed.body as { items: unknown[] }).items).toHaveLength(2);

    const del = routeFor(makeOptions(store, sandbox), "DELETE", SCRIPT_DETAIL_PATH);
    const deleted = await del.handler(ctx("DELETE", SCRIPT_DETAIL_PATH, { params: { scriptId } }));
    expect(deleted.status).toBe(204);
    expect(store.scripts.has(scriptId)).toBe(false);
  });

  it("returns 404 for an unknown script", async () => {
    const store = new MemoryScriptStore();
    const route = routeFor(makeOptions(store, new FakeSandbox()), "GET", SCRIPT_DETAIL_PATH);
    await expect(route.handler(ctx("GET", SCRIPT_DETAIL_PATH, { params: { scriptId: "nope" } }))).rejects.toMatchObject({
      status: 404,
      code: SCRIPTS_NOT_FOUND,
    });
  });
});

describe("custom script run (T-0127)", () => {
  it("dry-runs an opted-in script and returns output without persisting side effects", async () => {
    const store = new MemoryScriptStore();
    const sandbox = new FakeSandbox();
    const scriptId = await seedScript(store, sandbox, true);
    const versionsBefore = store.versions.get(scriptId)!.length;

    const route = routeFor(makeOptions(store, sandbox), "POST", SCRIPT_RUN_PATH);
    const res = await route.handler(
      ctx("POST", SCRIPT_RUN_PATH, { params: { scriptId }, body: { tenantId: TENANT_1, dryRun: true } }),
    );

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.dryRun).toBe(true);
    expect(body.output).toBe("planned change");
    expect(sandbox.calls).toHaveLength(1);
    expect(sandbox.calls[0]!.dryRun).toBe(true);
    // No side effects: the store is unchanged.
    expect(store.versions.get(scriptId)).toHaveLength(versionsBefore);
  });

  it("rejects a dry run when the script does not declare the contract", async () => {
    const store = new MemoryScriptStore();
    const sandbox = new FakeSandbox();
    const scriptId = await seedScript(store, sandbox, false);

    const route = routeFor(makeOptions(store, sandbox), "POST", SCRIPT_RUN_PATH);
    await expect(
      route.handler(ctx("POST", SCRIPT_RUN_PATH, { params: { scriptId }, body: { tenantId: TENANT_1, dryRun: true } })),
    ).rejects.toMatchObject({ status: 422, code: SCRIPTS_DRY_RUN_NOT_SUPPORTED });
    expect(sandbox.calls).toHaveLength(0);
  });

  it("rejects a non-dry run by a caller without scripts.run", async () => {
    const store = new MemoryScriptStore();
    const sandbox = new FakeSandbox();
    const scriptId = await seedScript(store, sandbox, true);

    const route = routeFor(
      makeOptions(store, sandbox, { authorize: denyAll }),
      "POST",
      SCRIPT_RUN_PATH,
    );
    await expect(
      route.handler(ctx("POST", SCRIPT_RUN_PATH, { params: { scriptId }, body: { tenantId: TENANT_1, dryRun: false } })),
    ).rejects.toMatchObject({ status: 403 });
    expect(sandbox.calls).toHaveLength(0);
  });

  it("runs for real with scripts.run and the contract present", async () => {
    const store = new MemoryScriptStore();
    const sandbox = new FakeSandbox();
    const scriptId = await seedScript(store, sandbox, true);

    const route = routeFor(makeOptions(store, sandbox), "POST", SCRIPT_RUN_PATH);
    const res = await route.handler(
      ctx("POST", SCRIPT_RUN_PATH, { params: { scriptId }, body: { tenantId: TENANT_1, dryRun: false } }),
    );
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).dryRun).toBe(false);
    expect(sandbox.calls[0]!.dryRun).toBe(false);
  });

  it("returns 403 when the tenant is outside the caller scope", async () => {
    const store = new MemoryScriptStore();
    const sandbox = new FakeSandbox();
    const scriptId = await seedScript(store, sandbox, true);

    const route = routeFor(
      makeOptions(store, sandbox, { resolveCaller: () => ({ roles: ["operator"], tenantScope: tenantScope([TENANT_2]) }) }),
      "POST",
      SCRIPT_RUN_PATH,
    );
    await expect(
      route.handler(ctx("POST", SCRIPT_RUN_PATH, { params: { scriptId }, body: { tenantId: TENANT_1, dryRun: true } })),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("route set and contracts (T-0127)", () => {
  it("exposes the full SPEC §6 script surface", () => {
    const keys = createScriptRoutes(makeOptions(new MemoryScriptStore(), new FakeSandbox()))
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(keys).toEqual(
      [
        `GET ${SCRIPT_DETAIL_PATH}`,
        `GET ${SCRIPT_VERSIONS_PATH}`,
        `GET ${SCRIPTS_PATH}`,
        `DELETE ${SCRIPT_DETAIL_PATH}`,
        `PATCH ${SCRIPT_DETAIL_PATH}`,
        `POST ${SCRIPT_VERSIONS_PATH}`,
        `POST ${SCRIPT_RUN_PATH}`,
        `POST ${SCRIPTS_PATH}`,
      ].sort(),
    );
  });

  it("recognises the dry-run contract only when explicitly declared", () => {
    expect(declaresDryRunContract({ dryRunContract: true })).toBe(true);
    expect(declaresDryRunContract({ dryRunContract: false })).toBe(false);
    expect(declaresDryRunContract({})).toBe(false);
    expect(declaresDryRunContract(null)).toBe(false);
  });

  it("publishes run with the higher-privilege scripts.run permission", () => {
    expect(SCRIPTS_OPENAPI["/v1/scripts/{scriptId}/run"].post.permission).toBe(
      SCRIPTS_PERMISSIONS.run,
    );
  });
});
