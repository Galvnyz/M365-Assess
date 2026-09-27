import { SqliteJitRepository, SqliteRepository, loadMigrations, runMigrations, type JitGrant } from "@m365-assess/db";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { CredentialRecord, CredentialStoreRow } from "../routes/credentials.js";
import { createActiveGrantsResolver, createRoleProviders } from "./roles.js";
import { createTenantWorker, type WorkerRunner } from "./workers.js";

const CRED: CredentialRecord = {
  id: "c",
  tenantId: "t-a",
  authMethod: "certificate-thumbprint",
  clientId: "app-1",
  secretRef: "thumbprint://ABC",
  thumbprint: "ABC",
  environment: "commercial",
  expiresOn: null,
  lastValidated: null,
  createdAt: "",
  updatedAt: "",
};

const credentials: CredentialStoreRow = {
  getCredential: async (tenantId) => (tenantId === "t-a" ? CRED : undefined),
  upsertCredential: async (input) => input,
  appendAuditEvent: async () => undefined,
};

function harness(respond: (entrypoint: string, job: Record<string, unknown>) => unknown = () => ({})) {
  const calls: { entrypoint: string; job: Record<string, unknown> }[] = [];
  const run: WorkerRunner = async (entrypoint, job) => {
    calls.push({ entrypoint, job: job as Record<string, unknown> });
    return respond(entrypoint, job as Record<string, unknown>) as never;
  };
  return { providers: createRoleProviders(createTenantWorker(run, credentials)), calls };
}

const GRANT: JitGrant = {
  id: "g-1",
  tenantId: "t-a",
  userId: "u-1",
  roleId: "role-ga",
  templateId: null,
  assignmentType: "active",
  startsAt: "2026-09-26T08:00:00.000Z",
  endsAt: "2026-09-26T16:00:00.000Z",
  durationHours: 8,
  maxDurationHours: 24,
  state: "active",
  justification: "Incident 42",
  createdBy: "admin",
  createdAt: "",
  updatedAt: "",
};

describe("role and PIM providers (T-0818)", () => {
  it("lists role and PIM assignments with flat filter fields", async () => {
    const { providers, calls } = harness((entrypoint) =>
      entrypoint === "get-pim-assignments.ps1"
        ? { tenantId: "t-a", gate: { supported: true }, totalCount: 1, items: { id: "a-1" }, nextCursor: null }
        : { tenantId: "t-a", totalCount: 0, items: [], nextCursor: null },
    );
    await providers.roles.listRoleAssignments("t-a", { principalType: "user", search: "admin", cursor: null, limit: 25 });
    const pim = await providers.pim.listPimAssignments("t-a", { assignmentType: "eligible", cursor: "25", limit: 25 });
    expect(calls[0]).toMatchObject({
      entrypoint: "get-role-assignments.ps1",
      job: { tenantId: "t-a", principalType: "user", search: "admin", top: 25, credential: { credentialRef: "tenants/t-a/credential" } },
    });
    expect(calls[1]!.job).toMatchObject({ assignmentType: "eligible", top: 25, cursor: "25" });
    // The license gate passes through; a one-item page is restored to an array.
    expect(pim).toMatchObject({ gate: { supported: true }, items: [{ id: "a-1" }] });
  });

  it("submits PIM requests through the request worker", async () => {
    const { providers, calls } = harness(() => ({ id: "req-9", state: "active", startsAt: "s", endsAt: "e" }));
    const out = await providers.pimRequests.submitRequest("t-a", {
      principalId: "u-1",
      roleId: "role-ga",
      action: "assign",
      justification: "Audit",
      durationHours: 4,
      approvalRequired: false,
      ticketNumber: "INC-1",
    });
    expect(calls[0]).toMatchObject({
      entrypoint: "new-pim-request.ps1",
      job: { principalId: "u-1", roleId: "role-ga", action: "assign", justification: "Audit", durationHours: 4, approvalRequired: false, ticketNumber: "INC-1" },
    });
    expect(out).toEqual({ id: "req-9", state: "active", startsAt: "s", endsAt: "e" });
  });

  it("reads live PIM settings with a get action and applies templates", async () => {
    const { providers, calls } = harness((_e, job) =>
      job["action"] === "get" ? { requireMfa: true } : { dryRun: false, before: { requireMfa: false }, after: { requireMfa: true } },
    );
    expect(await providers.liveSettings.getLiveRoleSettings("t-a", "role-ga")).toEqual({ requireMfa: true });
    expect(await providers.applySettings.applySettings("t-a", "role-ga", { requireMfa: true }, { dryRun: false })).toEqual({
      applied: { requireMfa: true },
      before: { requireMfa: false },
      after: { requireMfa: true },
    });
    expect(calls.map((c) => [c.entrypoint, c.job["action"], c.job["roleId"]])).toEqual([
      ["set-pim-role-settings.ps1", "get", "role-ga"],
      ["set-pim-role-settings.ps1", "apply", "role-ga"],
    ]);
  });
});

describe("JIT execution provider (T-0818)", () => {
  it("grants and revokes through the JIT worker", async () => {
    const { providers, calls } = harness((_e, job) =>
      job["action"] === "grant" ? { id: "sched-1", startsAt: "2026-09-26T08:00:00Z", endsAt: "2026-09-26T16:00:00Z" } : {},
    );
    expect(await providers.jit.grantRole("t-a", GRANT)).toEqual({
      grantId: "sched-1",
      startsAt: "2026-09-26T08:00:00Z",
      endsAt: "2026-09-26T16:00:00Z",
    });
    await providers.jit.revokeRole("t-a", GRANT);
    expect(calls[0]!.job).toMatchObject({ action: "grant", userId: "u-1", roleId: "role-ga", assignmentType: "active", durationHours: 8, maxDurationHours: 24, justification: "Incident 42" });
    expect(calls[1]!.job).toMatchObject({ action: "revoke", userId: "u-1", roleId: "role-ga", assignmentType: "active" });
  });

  it("extends to the route's new end, sending the added hours for the worker's maximum check", async () => {
    const { providers, calls } = harness();
    await providers.jit.extendRole("t-a", GRANT, "2026-09-26T20:00:00.000Z");
    expect(calls[0]!.job).toMatchObject({
      action: "extend",
      durationHours: 8,
      maxDurationHours: 24,
      additionalHours: 4,
      newEndsAt: "2026-09-26T20:00:00.000Z",
    });
  });
});

describe("JIT template in-use check (T-0818)", () => {
  it("finds grants still in force for a template across tenants", async () => {
    const db = new Database(":memory:");
    const version = runMigrations(db, loadMigrations());
    const tenants = new SqliteRepository(db, version, "memory");
    for (const id of ["t-a", "t-b"]) {
      await tenants.upsertTenant({ id, displayName: null, defaultDomain: null, initialDomain: null, source: "direct", status: "active", excluded: false, lastRunAt: null, errorCount: 0 });
    }
    const repo = new SqliteJitRepository(db, version);
    await repo.createGrant({ ...GRANT, id: "g-a", templateId: "tpl-1" });
    await repo.createGrant({ ...GRANT, id: "g-b", tenantId: "t-b", templateId: "tpl-1", state: "extended" });
    await repo.createGrant({ ...GRANT, id: "g-old", templateId: "tpl-1", state: "revoked" });
    await repo.createGrant({ ...GRANT, id: "g-other", templateId: "tpl-2" });

    const active = await createActiveGrantsResolver(db, repo).getActiveGrantsForTemplate("tpl-1");
    expect(active.map((g) => g.id).sort()).toEqual(["g-a", "g-b"]);
  });
});
