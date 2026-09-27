import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { SqliteRepository, loadMigrations, runMigrations } from "@m365-assess/db";
import type { JobEnvelope, ResultEnvelope } from "@m365-assess/contracts";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { buildRunEnvelope } from "../domain/runs/run-lifecycle.js";
import { JobQueue } from "../jobs/queue.js";
import type { RunRecord } from "../routes/runs-create.js";
import {
  createJobPersistence,
  createRunGroupResolver,
  createRunQueue,
  createRunStore,
  RUN_OUTPUT_UNREADABLE,
  withFindingsIngestion,
} from "./runs.js";
import { createCredentialRowStore, createTenantGroupStore, createTenantStore } from "./tenants.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function setup() {
  const db = new Database(":memory:");
  const version = runMigrations(db, loadMigrations());
  const repo = new SqliteRepository(db, version, "memory");
  for (const id of ["t-a", "t-b"]) {
    await repo.upsertTenant({ id, displayName: `Tenant ${id}`, defaultDomain: null, initialDomain: null, source: "direct", status: "active", excluded: false, lastRunAt: null, errorCount: 0 });
  }
  return { db, repo, store: createRunStore(repo, db) };
}

function run(id: string, tenantId: string, overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id,
    tenantId,
    parentRunId: null,
    trigger: "manual",
    sections: ["Identity"],
    options: null,
    startedAt: null,
    finishedAt: null,
    status: "queued",
    artifactPath: `runs/${tenantId}/${id}`,
    summaryCounts: null,
    provenance: null,
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
    ...overrides,
  };
}

function envelope(tenantId: string, runId: string): JobEnvelope {
  return buildRunEnvelope({
    tenantId,
    runId,
    jobId: `job-${runId}`,
    requestId: `req-${runId}`,
    correlationId: "corr",
    sections: ["Identity", "Email"],
    createdAt: "2026-09-26T00:00:00.000Z",
  });
}

describe("run store (T-0821)", () => {
  it("creates parent and child runs and reads them back", async () => {
    const { store } = await setup();
    await store.createRunWithChildren!(run("p-1", "t-a"), [run("c-1", "t-a", { parentRunId: "p-1" }), run("c-2", "t-b", { parentRunId: "p-1" })]);
    expect((await store.getRunById("c-2"))!.tenantId).toBe("t-b");
    expect((await store.listRunsByParentId!("p-1")).map((r) => r.id).sort()).toEqual(["c-1", "c-2"]);
  });

  it("lists runs for one tenant or all, with durations", async () => {
    const { store } = await setup();
    await store.createRun!(run("r-a", "t-a", { status: "succeeded", startedAt: "2026-09-26T00:00:00.000Z", finishedAt: "2026-09-26T00:01:30.000Z" }));
    await store.createRun!(run("r-b", "t-b"));
    expect((await store.listRuns("t-a")).map((r) => [r.id, r.durationMs])).toEqual([["r-a", 90_000]]);
    expect((await store.listRuns()).map((r) => r.id).sort()).toEqual(["r-a", "r-b"]);
  });

  it("updates a run by id alone", async () => {
    const { store } = await setup();
    await store.createRun!(run("r-1", "t-a"));
    expect(await store.updateRunById!("r-1", { status: "cancelled" })).toMatchObject({ status: "cancelled" });
    expect(await store.updateRunById!("missing", { status: "cancelled" })).toBeUndefined();
  });

  it("rolls a parent run up from its children as they change", async () => {
    const { store } = await setup();
    await store.createRunWithChildren!(run("p-1", "t-a"), [run("c-1", "t-a", { parentRunId: "p-1" }), run("c-2", "t-b", { parentRunId: "p-1" })]);
    await store.updateRun!("t-a", "c-1", { status: "running", startedAt: "2026-09-26T00:00:01.000Z" });
    expect(await store.getRunById("p-1")).toMatchObject({ status: "running", startedAt: "2026-09-26T00:00:01.000Z" });
    await store.updateRun!("t-a", "c-1", { status: "succeeded", finishedAt: "2026-09-26T00:00:09.000Z" });
    expect((await store.getRunById("p-1"))!.status).toBe("running");
    await store.updateRunById!("c-2", { status: "failed", finishedAt: "2026-09-26T00:00:12.000Z" });
    expect(await store.getRunById("p-1")).toMatchObject({ status: "partial", finishedAt: "2026-09-26T00:00:12.000Z" });
  });

  it("keeps one section row per run section as progress arrives", async () => {
    const { store } = await setup();
    await store.createRun!(run("r-1", "t-a"));
    const base = { runId: "r-1", tenantId: "t-a", section: "Identity", createdAt: "2026-09-26T00:00:00.000Z" };
    await store.recordRunSection!({ ...base, id: "s-1", status: "running", startedAt: "2026-09-26T00:00:01.000Z", finishedAt: null, updatedAt: "2026-09-26T00:00:01.000Z" });
    await store.recordRunSection!({ ...base, id: "s-2", status: "succeeded", startedAt: null, finishedAt: "2026-09-26T00:00:09.000Z", updatedAt: "2026-09-26T00:00:09.000Z" });
    expect(await store.listRunSections("t-a", "r-1")).toEqual([
      expect.objectContaining({ id: "s-1", status: "succeeded", startedAt: "2026-09-26T00:00:01.000Z", finishedAt: "2026-09-26T00:00:09.000Z" }),
    ]);
  });
});

describe("job persistence (T-0821)", () => {
  it("backs the job queue with the jobs table", async () => {
    const { repo, store } = await setup();
    await store.createRun!(run("r-1", "t-a"));
    const env = envelope("t-a", "r-1");
    const queue = new JobQueue({
      persistence: createJobPersistence(repo),
      runWorker: async (job): Promise<ResultEnvelope> => ({
        schemaVersion: "v1",
        jobId: job.jobId,
        jobType: job.jobType,
        tenantId: job.tenantId,
        runId: job.runId,
        requestId: job.requestId,
        correlationId: job.correlationId,
        status: "succeeded",
        startedAt: "2026-09-26T00:00:00.000Z",
        finishedAt: "2026-09-26T00:00:05.000Z",
        exitCode: 0,
        artifactRefs: [],
        summary: { total: 0, byStatus: {} },
        error: null,
      } as unknown as ResultEnvelope),
    });
    await queue.enqueue(env);
    await queue.drain();
    expect(await queue.getState(env.jobId)).toBe("succeeded");
    expect((await repo.getJob(env.jobId))!.state).toBe("done");
  });
});

describe("run group resolver (T-0821)", () => {
  it("resolves a static tenant group's members", async () => {
    const { repo } = await setup();
    const groups = createTenantGroupStore(repo);
    await groups.upsertGroup({ id: "g-1", name: "Pilot", kind: "static", filter: null, description: null } as never);
    await groups.addMember({ groupId: "g-1", tenantId: "t-b" } as never);
    expect(await createRunGroupResolver(groups).resolveGroupMembers("g-1")).toEqual(["t-b"]);
    await expect(createRunGroupResolver(groups).resolveGroupMembers("nope")).rejects.toMatchObject({ status: 404 });
  });
});

describe("run queue (T-0821)", () => {
  async function queueSetup() {
    const ctx = await setup();
    const root = mkdtempSync(path.join(tmpdir(), "m365-runs-"));
    dirs.push(root);
    const enqueued: JobEnvelope[] = [];
    const jobs = { enqueue: async (e: JobEnvelope) => (enqueued.push(e), e.jobId), cancel: async () => true } as unknown as JobQueue;
    const credentials = createCredentialRowStore(ctx.repo);
    const queue = createRunQueue({ queue: jobs, storageRoot: root, tenants: createTenantStore(ctx.repo), credentials, repo: ctx.repo });
    return { ...ctx, root, enqueued, credentials, queue };
  }

  it("writes the run context with the thumbprint credential, then enqueues", async () => {
    const { root, enqueued, credentials, queue, store } = await queueSetup();
    await credentials.upsertCredential({
      id: "cred-a",
      tenantId: "t-a",
      authMethod: "certificate-thumbprint",
      clientId: "app-1",
      secretRef: "thumbprint://ABC",
      thumbprint: "ABC",
      environment: "gcc",
      expiresOn: null,
      lastValidated: null,
      createdAt: "",
      updatedAt: "",
    });
    await store.createRun!(run("r-1", "t-a"));
    const env = envelope("t-a", "r-1");
    expect(await queue.enqueue(env)).toBe("job-r-1");
    expect(enqueued).toEqual([env]);

    const contextFile = path.join(root, "runs/t-a/r-1/context.json");
    expect(JSON.parse(readFileSync(contextFile, "utf8"))).toEqual({
      SchemaVersion: 1,
      Tenant: { TenantId: "t-a", DisplayName: "Tenant t-a", DefaultDomain: null, InitialDomain: null },
      Auth: { Method: "Certificate", ClientId: "app-1", CertificateThumbprint: "ABC", M365Environment: "gcc" },
      Scope: { Sections: ["Identity", "Email"] },
      Output: { OutputFolder: path.join(root, "runs/t-a/r-1") },
    });
    if (process.platform !== "win32") expect(statSync(contextFile).mode & 0o777).toBe(0o600);
  });

  it("fails the run instead of enqueueing when the tenant has no usable credential", async () => {
    const { enqueued, credentials, queue, store } = await queueSetup();
    await store.createRun!(run("r-none", "t-a"));
    await queue.enqueue(envelope("t-a", "r-none"));
    expect(await store.getRunById("r-none")).toMatchObject({ status: "failed", summaryCounts: { error: expect.stringContaining("no credential") } });

    await credentials.upsertCredential({
      id: "cred-b",
      tenantId: "t-b",
      authMethod: "client-secret",
      clientId: "app-2",
      secretRef: "secrets://t-b",
      thumbprint: null,
      environment: "commercial",
      expiresOn: null,
      lastValidated: null,
      createdAt: "",
      updatedAt: "",
    });
    await store.createRun!(run("r-secret", "t-b"));
    await queue.enqueue(envelope("t-b", "r-secret"));
    expect(await store.getRunById("r-secret")).toMatchObject({ status: "failed", summaryCounts: { error: expect.stringContaining("client-secret") } });
    expect(enqueued).toEqual([]);
  });
});

describe("findings ingestion (T-0833)", () => {
  // The export fixture Export-AssessmentBridgeJson's Pester test keeps in step.
  const FIXTURE = fileURLToPath(new URL("../../../db/src/fixtures/assessment-bridge.json", import.meta.url));

  function result(env: JobEnvelope, status: "succeeded" | "failed", artifactRefs: string[], error?: string): ResultEnvelope {
    return {
      schemaVersion: "v1",
      jobId: env.jobId,
      jobType: env.jobType,
      tenantId: env.tenantId,
      runId: env.runId,
      requestId: env.requestId,
      correlationId: env.correlationId,
      status,
      startedAt: "2026-09-27T00:00:00.000Z",
      finishedAt: "2026-09-27T00:05:00.000Z",
      exitCode: status === "succeeded" ? 0 : 1,
      artifactRefs,
      ...(error ? { error: { code: "worker.assessment_failed", message: error, retryable: false } } : {}),
    };
  }

  async function ingestSetup() {
    const ctx = await setup();
    const root = mkdtempSync(path.join(tmpdir(), "m365-findings-"));
    dirs.push(root);
    await ctx.store.createRun!(run("r-1", "t-a"));
    const env = envelope("t-a", "r-1");
    const outputFolder = path.join(root, env.payload.outputRef);
    return { ...ctx, root, env, outputFolder };
  }

  it("stores a succeeded run's findings and counts from its export", async () => {
    const { repo, root, env, outputFolder } = await ingestSetup();
    mkdirSync(path.join(outputFolder, "Assessment_20260927"), { recursive: true });
    copyFileSync(FIXTURE, path.join(outputFolder, "Assessment_20260927", "_Assessment_fixture.json"));
    const refs = ["Assessment_20260927/_Assessment-Log_fixture.txt", "Assessment_20260927/_Assessment_fixture.json"];
    const worker = withFindingsIngestion(async (e) => result(e, "succeeded", refs), { repo, storageRoot: root });

    expect(await worker(env, new AbortController().signal)).toMatchObject({ status: "succeeded" });
    const findings = await repo.listFindings("t-a", "r-1");
    expect(findings.map((f) => [f.checkId, f.status])).toEqual([
      ["CA-REPORTONLY-001.1", "Warning"],
      ["EXO-AUDIT-001.1", "Pass"],
      ["SPO-SHARING-001.1", "Fail"],
      ["ENTRA-GUEST-001.1", "Review"],
    ]);
    expect((await repo.getRun("t-a", "r-1"))!.summaryCounts).toEqual({ pass: 1, fail: 1, warning: 1, review: 1, info: 0, skipped: 0, total: 4 });

    // Ingesting the same run again replaces rather than duplicates.
    await worker(env, new AbortController().signal);
    expect(await repo.listFindings("t-a", "r-1")).toHaveLength(4);
  });

  it("fails a succeeded run whose export is missing or unreadable, with the reason", async () => {
    const { repo, root, env, outputFolder } = await ingestSetup();
    const missing = withFindingsIngestion(async (e) => result(e, "succeeded", ["Assessment_1/report.html"]), { repo, storageRoot: root });
    expect(await missing(env, new AbortController().signal)).toMatchObject({ status: "failed", error: { code: RUN_OUTPUT_UNREADABLE } });
    expect((await repo.getRun("t-a", "r-1"))!.summaryCounts).toEqual({ error: expect.stringContaining("no findings export") });

    mkdirSync(outputFolder, { recursive: true });
    writeFileSync(path.join(outputFolder, "_Assessment.json"), "{ not json");
    const broken = withFindingsIngestion(async (e) => result(e, "succeeded", ["_Assessment.json"]), { repo, storageRoot: root });
    expect(await broken(env, new AbortController().signal)).toMatchObject({ status: "failed" });
    expect((await repo.getRun("t-a", "r-1"))!.summaryCounts).toEqual({ error: expect.stringContaining("not valid JSON") });

    const escape = withFindingsIngestion(async (e) => result(e, "succeeded", ["../../_Assessment.json"]), { repo, storageRoot: root });
    expect(await escape(env, new AbortController().signal)).toMatchObject({ status: "failed" });
    expect(await repo.listFindings("t-a", "r-1")).toEqual([]);
  });

  it("keeps a failed worker's error on the run and passes other job types through", async () => {
    const { repo, root, env } = await ingestSetup();
    const failed = withFindingsIngestion(async (e) => result(e, "failed", [], "Graph sign-in failed"), { repo, storageRoot: root });
    expect(await failed(env, new AbortController().signal)).toMatchObject({ status: "failed" });
    expect((await repo.getRun("t-a", "r-1"))!.summaryCounts).toEqual({ error: "Graph sign-in failed" });

    const other = { ...env, jobType: "remediation" } as JobEnvelope;
    const passthrough = withFindingsIngestion(async (e) => result(e, "succeeded", []), { repo, storageRoot: root });
    expect(await passthrough(other, new AbortController().signal)).toMatchObject({ status: "succeeded" });
  });
});
