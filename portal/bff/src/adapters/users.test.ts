import {
  SqliteBecFindingRepository,
  SqliteOffboardingRepository,
  SqliteRepository,
  SqliteUserTemplateRepository,
  loadMigrations,
  runMigrations,
} from "@m365-assess/db";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { BecFindingRecord } from "../routes/bec.js";
import type { CredentialRecord, CredentialStoreRow } from "../routes/credentials.js";
import {
  BEC_MISSING_TARGET,
  BEC_REMEDIATION_FAILED,
  createBecFindingStore,
  createBecProviders,
  createOffboardingRunner,
  createOffboardingStore,
  createUserProviders,
  createUserTemplateStore,
} from "./users.js";
import { createEnvelopeWorker, type WorkerRunner } from "./workers.js";

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

type Job = Record<string, unknown> & { payload: Record<string, unknown> };

function harness(respond: (entrypoint: string, job: Job) => unknown = () => ({})) {
  const calls: { entrypoint: string; job: Job }[] = [];
  const run: WorkerRunner = async (entrypoint, job) => {
    calls.push({ entrypoint, job: job as Job });
    return respond(entrypoint, job as Job) as never;
  };
  return { call: createEnvelopeWorker(run, credentials), calls };
}

function migrated() {
  const db = new Database(":memory:");
  const version = runMigrations(db, loadMigrations());
  const repo = new SqliteRepository(db, version, "memory");
  return { db, version, repo };
}

const FINDING: BecFindingRecord = {
  id: "f-1",
  tenantId: "t-a",
  userId: "u-1",
  check: "mailboxRules",
  detail: { evidence: [{ id: "rule-1" }, { id: "rule-2" }], remediation: { action: "removeInboxRule", automated: true } },
  state: "open",
  createdAt: "",
  updatedAt: "",
};

describe("user providers (T-0818)", () => {
  it("wraps inputs in the T-0007 envelope with the credential block at the top level", async () => {
    const { call, calls } = harness(() => ({ tenantId: "t-a", items: [{ id: "u-1" }], nextCursor: "100" }));
    const page = await createUserProviders(call).list.listUsers("t-a", { status: "enabled", inactiveDays: 30, cursor: null, limit: 50 });
    expect(page).toEqual({ items: [{ id: "u-1" }], nextCursor: "100" });
    expect(calls[0]).toEqual({
      entrypoint: "get-tenant-users.ps1",
      job: {
        tenantId: "t-a",
        credential: { credentialRef: "tenants/t-a/credential", record: expect.objectContaining({ thumbprint: "ABC" }) },
        schemaVersion: "v1",
        correlationId: expect.any(String),
        payload: { filters: { status: "enabled", inactiveDays: 30, top: 50 } },
      },
    });
  });

  it("normalises a one-row create result that PowerShell unrolled into an object", async () => {
    const { call, calls } = harness(() => ({ userPrincipalName: "a@x.invalid", status: "created", id: "id-a", password: "pw" }));
    const users = [{ userPrincipalName: "a@x.invalid", displayName: "A", givenName: null, surname: null, usageLocation: "US", licenses: [], groups: [] }];
    expect(await createUserProviders(call).create.createUsers("t-a", users, { dryRun: false })).toEqual([
      { userPrincipalName: "a@x.invalid", status: "created", id: "id-a", password: "pw" },
    ]);
    expect(calls[0]!.job.payload).toEqual({ users, dryRun: false });
  });

  it("treats an empty patch result as no rows", async () => {
    const { call } = harness(() => undefined);
    expect(await createUserProviders(call).patch.patchUsers("t-a", [], { preview: true })).toEqual([]);
  });

  it("sends lifecycle actions confirmed, since the route already gated them", async () => {
    const { call, calls } = harness(() => ({ status: "applied", password: "tmp" }));
    await createUserProviders(call).execute.executeAction("t-a", "u-1", "resetPassword", { dryRun: false, password: "x" });
    expect(calls[0]).toMatchObject({
      entrypoint: "invoke-user-action.ps1",
      job: { payload: { userId: "u-1", action: "resetPassword", password: "x", dryRun: false, confirm: true } },
    });
  });
});

describe("BEC providers (T-0818)", () => {
  it("returns the check outcomes", async () => {
    const { call, calls } = harness(() => ({ tenantId: "t-a", userId: "u-1", checks: [{ check: "mailboxRules", state: "clear" }] }));
    expect(await createBecProviders(call).check.runCheck("t-a", "u-1")).toEqual([{ check: "mailboxRules", state: "clear" }]);
    expect(calls[0]!.job.payload).toEqual({ userId: "u-1" });
  });

  it("removes every rule in the finding's evidence, one worker run each", async () => {
    const { call, calls } = harness((_e, job) => ({
      status: "remediated",
      before: { id: job.payload["target"] },
      after: { action: "removeInboxRule" },
      error: null,
    }));
    const result = await createBecProviders(call).remediate.remediate("t-a", "u-1", FINDING, "removeInboxRule");
    expect(calls.map((c) => c.job.payload)).toEqual([
      { userId: "u-1", check: "mailboxRules", action: "removeInboxRule", target: "rule-1", confirm: true },
      { userId: "u-1", check: "mailboxRules", action: "removeInboxRule", target: "rule-2", confirm: true },
    ]);
    expect(result).toEqual({ before: { rules: [{ id: "rule-1" }, { id: "rule-2" }] }, after: { action: "removeInboxRule" } });
  });

  it("reports a failed removal, saying how far it got", async () => {
    let n = 0;
    const { call } = harness(() => (++n === 1 ? { status: "remediated", before: {}, after: {} } : { status: "failed", error: "Graph 404" }));
    await expect(createBecProviders(call).remediate.remediate("t-a", "u-1", FINDING, "removeInboxRule")).rejects.toMatchObject({
      status: 502,
      code: BEC_REMEDIATION_FAILED,
      message: expect.stringContaining("after 1 of 2 succeeded: Graph 404"),
    });
  });

  it("refuses to remove rules when the finding names none", async () => {
    const { call, calls } = harness();
    const finding = { ...FINDING, detail: { evidence: [] } };
    await expect(createBecProviders(call).remediate.remediate("t-a", "u-1", finding, "removeInboxRule")).rejects.toMatchObject({
      status: 409,
      code: BEC_MISSING_TARGET,
    });
    expect(calls).toHaveLength(0);
  });

  it("revokes sessions without a target", async () => {
    const { call, calls } = harness(() => ({ status: "remediated", before: null, after: { action: "revokeSessions" } }));
    const result = await createBecProviders(call).remediate.remediate("t-a", "u-1", { ...FINDING, check: "signinLocations" }, "revokeSessions");
    expect(calls[0]!.job.payload).not.toHaveProperty("target");
    expect(result).toEqual({ before: null, after: { action: "revokeSessions" } });
  });
});

describe("EPIC-011 stores (T-0818)", () => {
  async function seedTenant(repo: SqliteRepository) {
    await repo.upsertTenant({
      id: "t-a",
      displayName: null,
      defaultDomain: null,
      initialDomain: null,
      source: "direct",
      status: "active",
      excluded: false,
      lastRunAt: null,
      errorCount: 0,
    });
  }

  it("persists BEC findings and their state", async () => {
    const { db, version, repo } = migrated();
    await seedTenant(repo);
    const store = createBecFindingStore(new SqliteBecFindingRepository(db, version));
    await store.saveFindings([FINDING]);
    expect(await store.listFindings("t-a", "u-1")).toEqual([expect.objectContaining({ id: "f-1", check: "mailboxRules" })]);
    expect(await store.updateFindingState("f-1", "remediated")).toMatchObject({ state: "remediated" });
  });

  it("persists user templates, copying readonly arrays", async () => {
    const { db, version } = migrated();
    const store = createUserTemplateStore(new SqliteUserTemplateRepository(db, version));
    const input = { id: "ut-1", name: "Sales", properties: { department: "Sales" }, licenses: Object.freeze(["E3"]), groups: [], offboardingDefaults: {} };
    await store.createUserTemplate(input);
    expect(await store.updateUserTemplate("ut-1", { groups: Object.freeze(["g-1"]) })).toMatchObject({ licenses: ["E3"], groups: ["g-1"] });
    expect(await store.softDeleteUserTemplate("ut-1")).toBe(true);
  });

  it("creates offboarding steps and resets one for a re-run", async () => {
    const { db, version, repo } = migrated();
    await seedTenant(repo);
    const store = createOffboardingStore(new SqliteOffboardingRepository(db, version));
    await store.createJob({ id: "job-1", tenantId: "t-a", userIds: ["u-1"], options: {}, createdBy: "admin" });
    const steps = await store.createSteps("job-1", ["disable-sign-in", "remove-licenses"]);
    expect(steps.map((s) => [s.order, s.action])).toEqual([[1, "disable-sign-in"], [2, "remove-licenses"]]);
    expect(await store.resetStep("job-1", 2)).toMatchObject({ order: 2, state: "pending" });
    expect(await store.resetStep("job-1", 9)).toBeUndefined();
  });
});

describe("offboarding runner (T-0818)", () => {
  async function setup(respond: (entrypoint: string, job: Job) => unknown) {
    const { db, version, repo } = migrated();
    await repo.upsertTenant({
      id: "t-a",
      displayName: null,
      defaultDomain: null,
      initialDomain: null,
      source: "direct",
      status: "active",
      excluded: false,
      lastRunAt: null,
      errorCount: 0,
    });
    const offboarding = new SqliteOffboardingRepository(db, version);
    await offboarding.createOffboardingJob({
      id: "job-1",
      tenantId: "t-a",
      userIds: ["u-1"],
      options: { mailboxAccess: { mode: "full", automap: false } },
      createdBy: "admin",
      steps: [
        { order: 1, action: "disable-sign-in" },
        { order: 2, action: "remove-licenses" },
        { order: 3, action: "remove-groups" },
      ],
    });
    const { call, calls } = harness(respond);
    return { runner: createOffboardingRunner(call, offboarding), offboarding, calls };
  }

  const ok = (order: number) => ({ order, state: "succeeded", result: { outcomes: [] }, error: null, appliedAt: "2026-09-26T00:00:00Z" });
  const failed = (order: number) => ({ order, state: "failed", result: { outcomes: [] }, error: "Graph 403", appliedAt: null });

  it("runs every pending step and completes the job", async () => {
    const { runner, offboarding, calls } = await setup((_e, job) => ({
      state: "completed",
      steps: (job.payload["steps"] as { order: number }[]).map((s) => ok(s.order)),
    }));
    await runner.enqueue({ jobId: "job-1", tenantId: "t-a" });
    await runner.idle();
    expect(calls[0]!.job.payload).toMatchObject({
      jobId: "job-1",
      userIds: ["u-1"],
      steps: [{ order: 1, action: "disable-sign-in" }, { order: 2, action: "remove-licenses" }, { order: 3, action: "remove-groups" }],
      mailboxAccess: { mode: "full", automap: false },
      actor: "admin",
    });
    expect((await offboarding.getOffboardingJob("job-1"))!.state).toBe("completed");
    expect((await offboarding.listOffboardingSteps("job-1")).map((s) => s.state)).toEqual(["succeeded", "succeeded", "succeeded"]);
  });

  it("stops at a failed step and resumes the remaining steps after a successful re-run", async () => {
    let attempt = 0;
    const { runner, offboarding, calls } = await setup((_e, job) => {
      attempt += 1;
      if (attempt === 1) return { state: "failed", steps: [ok(1), failed(2)] };
      if (job.payload["rerunOrder"] === 2) return ok(2);
      return { state: "completed", steps: (job.payload["steps"] as { order: number }[]).map((s) => ok(s.order)) };
    });
    await runner.enqueue({ jobId: "job-1", tenantId: "t-a" });
    await runner.idle();
    expect((await offboarding.getOffboardingJob("job-1"))!.state).toBe("failed");
    expect((await offboarding.listOffboardingSteps("job-1")).map((s) => s.state)).toEqual(["succeeded", "failed", "pending"]);

    await offboarding.resetOffboardingStep("job-1", 2);
    await runner.enqueue({ jobId: "job-1", tenantId: "t-a", rerunOrder: 2 });
    await runner.idle();
    expect(calls[1]!.job.payload).toMatchObject({ rerunOrder: 2 });
    expect(calls[2]!.job.payload["steps"]).toEqual([{ order: 3, action: "remove-groups" }]);
    expect((await offboarding.getOffboardingJob("job-1"))!.state).toBe("completed");
  });

  it("fails the first step with the reason when the worker cannot run", async () => {
    const { runner, offboarding } = await setup(() => {
      throw new Error("pwsh not found");
    });
    await runner.enqueue({ jobId: "job-1", tenantId: "t-a" });
    await runner.idle();
    const steps = await offboarding.listOffboardingSteps("job-1");
    expect(steps[0]).toMatchObject({ state: "failed", error: "pwsh not found" });
    expect(steps.slice(1).map((s) => s.state)).toEqual(["pending", "pending"]);
    expect((await offboarding.getOffboardingJob("job-1"))!.state).toBe("failed");
  });
});
