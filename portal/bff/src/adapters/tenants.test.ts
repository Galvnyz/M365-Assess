import { SqliteRepository, loadMigrations, runMigrations } from "@m365-assess/db";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import type { CredentialRecord } from "../routes/credentials.js";
import type { TenantRecord } from "../routes/tenants.js";
import {
  createCredentialRowStore,
  createGdapRelationshipStore,
  createTenantGroupStore,
  createTenantStore,
  createTenantVariableStore,
} from "./tenants.js";
import {
  NO_CREDENTIAL,
  createGdapSyncRunner,
  createOnboardRunner,
  createTestConnectionRunner,
  credentialBlock,
  type WorkerRunner,
} from "./workers.js";

const NOW = "2026-09-26T12:00:00.000Z";

function openRepos() {
  const db = new Database(":memory:");
  const version = runMigrations(db, loadMigrations());
  return { repo: new SqliteRepository(db, version, "memory") };
}

function tenant(id: string, overrides: Partial<TenantRecord> = {}): TenantRecord {
  return {
    id,
    displayName: id,
    defaultDomain: `${id}.example`,
    initialDomain: `${id}.onmicrosoft.com`,
    source: "direct",
    status: "active",
    excluded: false,
    excludeReason: null,
    excludeDate: null,
    environment: "commercial",
    lastRunAt: null,
    errorCount: 0,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function credential(tenantId: string, overrides: Partial<CredentialRecord> = {}): CredentialRecord {
  return {
    id: `cred-${tenantId}`,
    tenantId,
    authMethod: "certificate-thumbprint",
    clientId: "app-1",
    secretRef: "thumbprint://ABC123",
    thumbprint: "ABC123",
    environment: "commercial",
    expiresOn: null,
    lastValidated: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("tenant store adapter (T-0822)", () => {
  it("round-trips tenants through SQLite and soft-deletes", async () => {
    const { repo } = openRepos();
    const store = createTenantStore(repo);
    await store.upsertTenant(tenant("t-a", { displayName: "Contoso" }));
    await store.upsertTenant(tenant("t-b"));
    expect((await store.getTenant("t-a"))?.displayName).toBe("Contoso");
    expect((await store.listTenants()).map((t) => t.id).sort()).toEqual(["t-a", "t-b"]);
    expect(await store.softDeleteTenant("t-b")).toBe(true);
    expect((await store.listTenants()).map((t) => t.id)).toEqual(["t-a"]);
    expect((await store.getTenant("t-b", { includeDeleted: true }))?.deletedAt).not.toBeNull();
  });

  it("appends audit events", async () => {
    const { repo } = openRepos();
    const event = await createTenantStore(repo).appendAuditEvent({
      id: "a-1",
      timestamp: NOW,
      actorUserId: "u-1",
      actorType: "user",
      tenantId: "t-a",
      action: "tenant.create",
      targetType: "tenant",
      targetId: "t-a",
      before: null,
      after: { id: "t-a" },
      result: "success",
      error: null,
      source: "request",
      correlationId: "c-1",
    });
    expect(event).toMatchObject({ id: "a-1", action: "tenant.create" });
  });
});

describe("tenant group store adapter (T-0822)", () => {
  it("manages groups and members", async () => {
    const { repo } = openRepos();
    await repo.upsertTenant(tenant("t-a"));
    const store = createTenantGroupStore(repo);
    await store.upsertGroup({ id: "g-1", name: "EU", kind: "static", filter: null, createdAt: NOW, updatedAt: NOW, deletedAt: null });
    await store.addMember({ groupId: "g-1", tenantId: "t-a", createdAt: NOW, updatedAt: NOW });
    expect((await store.listGroups()).map((g) => g.name)).toEqual(["EU"]);
    expect((await store.listMembers("g-1")).map((m) => m.tenantId)).toEqual(["t-a"]);
    expect(await store.removeMember("g-1", "t-a")).toBe(true);
    expect(await store.softDeleteGroup("g-1")).toBe(true);
    expect(await store.getGroup("g-1")).toBeUndefined();
  });

  it("builds filter candidates from non-secret tenant variables, with no SKU inventory yet", async () => {
    const { repo } = openRepos();
    await repo.upsertTenant(tenant("t-a"));
    await repo.upsertTenant(tenant("t-b"));
    await repo.upsertTenantVariable({ id: "v-1", tenantId: "t-a", name: "region", value: "eu", isSecret: false });
    await repo.upsertTenantVariable({ id: "v-2", tenantId: "t-a", name: "apiKey", value: "hidden", isSecret: true });
    await repo.upsertTenantVariable({ id: "v-3", tenantId: null, name: "global", value: "x", isSecret: false });

    const candidates = await createTenantGroupStore(repo).listCandidates();
    expect(candidates.find((c) => c.id === "t-a")).toEqual({ id: "t-a", skus: [], variables: { region: "eu" } });
    expect(candidates.find((c) => c.id === "t-b")).toEqual({ id: "t-b", skus: [], variables: {} });
  });
});

describe("tenant variable and credential adapters (T-0822)", () => {
  it("round-trips variables", async () => {
    const { repo } = openRepos();
    const store = createTenantVariableStore(repo);
    await store.upsertVariable({ id: "v-1", tenantId: null, name: "region", value: "eu", isSecret: false, createdAt: NOW, updatedAt: NOW });
    expect((await store.getVariable("v-1"))?.value).toBe("eu");
    expect((await store.listVariables()).map((v) => v.name)).toEqual(["region"]);
    expect(await store.deleteVariable("v-1")).toBe(true);
  });

  it("round-trips credential rows without secret material", async () => {
    const { repo } = openRepos();
    await repo.upsertTenant(tenant("t-a"));
    const store = createCredentialRowStore(repo);
    await store.upsertCredential(credential("t-a"));
    expect(await store.getCredential("t-a")).toMatchObject({ tenantId: "t-a", thumbprint: "ABC123" });
    expect(await store.getCredential("t-z")).toBeUndefined();
  });

  it("stores GDAP relationships, defaulting optional fields to null", async () => {
    const { repo } = openRepos();
    await repo.upsertTenant(tenant("t-a", { source: "gdap" }));
    const store = createGdapRelationshipStore(repo);
    await store.upsertGdapRelationship({ tenantId: "t-a", delegatedPrivilegeStatus: "active" });
    expect(await store.getGdapRelationship("t-a")).toMatchObject({
      tenantId: "t-a",
      delegatedPrivilegeStatus: "active",
      relationshipEnd: null,
      cpvConsentState: null,
    });
  });
});

describe("worker runners (T-0822)", () => {
  function fakeRun(result: unknown = {}) {
    const calls: { entrypoint: string; job: Record<string, unknown> }[] = [];
    const run: WorkerRunner = async (entrypoint, job) => {
      calls.push({ entrypoint, job: job as Record<string, unknown> });
      return result as never;
    };
    return { run, calls };
  }

  it("builds the credential block from the non-secret row only", async () => {
    const { repo } = openRepos();
    await repo.upsertTenant(tenant("t-a"));
    const rows = createCredentialRowStore(repo);
    await rows.upsertCredential(credential("t-a", { expiresOn: "2027-01-01T00:00:00Z" }));
    expect(await credentialBlock(rows, "t-a")).toEqual({
      credentialRef: "tenants/t-a/credential",
      record: {
        tenantId: "t-a",
        authMethod: "certificate-thumbprint",
        clientId: "app-1",
        secretRef: "thumbprint://ABC123",
        thumbprint: "ABC123",
        environment: "commercial",
      },
    });
    await expect(credentialBlock(rows, "t-missing")).rejects.toMatchObject({ status: 409, code: NO_CREDENTIAL });
  });

  it("runs the connection test with the tenant's credential block", async () => {
    const { run, calls } = fakeRun({ tenantId: "t-a", success: true, testedAt: NOW, services: [] });
    const result = await createTestConnectionRunner(run)("t-a", credential("t-a"));
    expect(result.success).toBe(true);
    expect(calls[0]).toMatchObject({
      entrypoint: "test-tenant-connection.ps1",
      job: { tenantId: "t-a", credential: { credentialRef: "tenants/t-a/credential" } },
    });
  });

  it("reports a failed connection test without running a worker when there is no credential", async () => {
    const { run, calls } = fakeRun();
    const result = await createTestConnectionRunner(run)("t-a", undefined);
    expect(result.success).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("passes onboarding inputs and the confirmation flag through", async () => {
    const { run, calls } = fakeRun({ tenantId: "t-a", status: "succeeded" });
    await createOnboardRunner(run)("t-a", { confirmed: true, adminUpn: "admin@contoso.example", createNew: true });
    expect(calls[0]).toEqual({
      entrypoint: "onboard-tenant.ps1",
      job: { tenantId: "t-a", confirmed: true, createNew: true, adminUpn: "admin@contoso.example" },
    });
  });

  it("runs GDAP sync as the partner tenant with its credential", async () => {
    const { repo } = openRepos();
    await repo.upsertTenant(tenant("partner"));
    const rows = createCredentialRowStore(repo);
    await rows.upsertCredential(credential("partner"));
    const { run, calls } = fakeRun({ syncedAt: NOW, totalDiscovered: 0, tenants: [], relationships: [] });
    await createGdapSyncRunner(run, rows, "partner")();
    expect(calls[0]).toMatchObject({
      entrypoint: "sync-gdap-tenants.ps1",
      job: { tenantId: "partner", credential: { credentialRef: "tenants/partner/credential" } },
    });
    const failing = vi.fn();
    await expect(createGdapSyncRunner(failing as never, rows, "no-cred")()).rejects.toMatchObject({ status: 409 });
    expect(failing).not.toHaveBeenCalled();
  });
});
