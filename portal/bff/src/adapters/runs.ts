// EPIC-001/003 runs on real storage (T-0821).
//
// One run store implements every runs route's store interface over the db repository
// (the shapes match field for field), plus the progress hub's run/section writes. The
// run queue writes each tenant run's context.json under the storage root before
// handing the envelope to the job queue, since run-tenant.ps1 rebuilds its RunContext
// from that file. Findings ingestion stores a finished run's results (T-0833).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { findingsFromAssessmentExport, type Run, type SqliteRepository } from "@m365-assess/db";
import type { JobEnvelope, ResultEnvelope } from "@m365-assess/contracts";
import type Database from "better-sqlite3";
import { AppError } from "../errors.js";
import type { GroupMemberResolver } from "../domain/run-plan.js";
import { rollupRunStatus } from "../domain/runs/run-rollup.js";
import type { JobQueue, JobStatePersistence, RunWorkerFn } from "../jobs/queue.js";
import type { CredentialStoreRow } from "../routes/credentials.js";
import type { RunCreateStore, RunRecord } from "../routes/runs-create.js";
import type { RunsActionsStore } from "../routes/runs-actions.js";
import type { RunsArtifactsStore } from "../routes/runs-artifacts.js";
import type { RunsDetailStore } from "../routes/runs-detail.js";
import type { RunEventsStore } from "../routes/runs-events.js";
import type { RunListItem, RunListStore } from "../routes/runs-list.js";
import { resolveMembers, type TenantGroupStore } from "../routes/tenant-groups.js";
import type { TenantStore } from "../routes/tenants.js";
import type { RunProgressStore, RunSectionInput } from "../sse/hub.js";

export type RunStore = RunCreateStore &
  RunsDetailStore &
  RunsActionsStore &
  RunsArtifactsStore &
  RunEventsStore &
  RunListStore &
  RunProgressStore;

/**
 * Recompute a parent run from its children after one of them changed. Progress events
 * and results arrive per child (per tenant); nothing else moves the parent off queued.
 */
async function rollUpParent(repo: SqliteRepository, childRunId: string): Promise<void> {
  const child = await repo.getRunById(childRunId);
  if (!child?.parentRunId) return;
  const parent = await repo.getRunById(child.parentRunId);
  if (!parent) return;
  const rollup = rollupRunStatus(await repo.listRunsByParentId(parent.id));
  if (rollup.status === parent.status && rollup.finishedAt === parent.finishedAt) return;
  await repo.updateRun(parent.tenantId, parent.id, { ...rollup, updatedAt: new Date().toISOString() });
}

function toListItem(run: Run): RunListItem {
  const durationMs =
    run.startedAt && run.finishedAt ? Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt)) : null;
  return { ...(run as unknown as RunRecord), durationMs };
}

export function createRunStore(repo: SqliteRepository, db: Database.Database): RunStore {
  const copy = (run: RunRecord) => ({ ...run, sections: [...run.sections] });

  // Progress events arrive per section as it moves pending -> running -> done. The
  // table has no (run, section) key, so the latest row for the section is updated in
  // place, keeping the first startedAt.
  async function recordRunSection(input: RunSectionInput): Promise<void> {
    const existing = db
      .prepare("SELECT id, startedAt FROM run_sections WHERE runId = ? AND section = ? ORDER BY createdAt DESC LIMIT 1")
      .get(input.runId, input.section) as { id: string; startedAt: string | null } | undefined;
    if (!existing) {
      await repo.createRunSection({ ...input, collector: input.collector ?? null, startedAt: input.startedAt ?? null, finishedAt: input.finishedAt ?? null });
      return;
    }
    db.prepare("UPDATE run_sections SET status = ?, startedAt = ?, finishedAt = ?, updatedAt = ? WHERE id = ?").run(
      input.status,
      existing.startedAt ?? input.startedAt ?? null,
      input.finishedAt ?? null,
      input.updatedAt ?? new Date().toISOString(),
      existing.id,
    );
  }

  // The route modules each declare their own RunRecord; all match the db Run field for
  // field except that the db also allows a "partial" status the BFF never writes. The
  // store is typed at this one boundary rather than per method.
  const store = {
    createRun: (run: RunRecord) => repo.createRun(copy(run)),
    createRunWithChildren: (parent: RunRecord, children: readonly RunRecord[]) =>
      repo.createRunWithChildren(copy(parent), children.map(copy)),
    getRunById: (runId: string) => repo.getRunById(runId),
    listChildRuns: (parentRunId: string) => repo.listChildRuns(parentRunId),
    listRunsByParentId: (parentRunId: string) => repo.listRunsByParentId(parentRunId),
    listRunSections: (tenantId: string, runId: string) => repo.listRunSections(tenantId, runId),
    listRunFindings: (tenantId: string, runId: string) => repo.listFindings(tenantId, runId),
    async updateRun(tenantId: string, runId: string, update: RunUpdate) {
      const updated = await repo.updateRun(tenantId, runId, update);
      if (update.status !== undefined) await rollUpParent(repo, runId);
      return updated;
    },
    async updateRunById(runId: string, update: RunUpdate) {
      const run = await repo.getRunById(runId);
      if (!run) return undefined;
      const updated = await repo.updateRun(run.tenantId, runId, update);
      if (update.status !== undefined) await rollUpParent(repo, runId);
      return updated;
    },
    appendAuditEvent: (event: object) => repo.appendAuditEvent(event as Parameters<SqliteRepository["appendAuditEvent"]>[0]),
    async listRuns(tenantId?: string) {
      const tenantIds = tenantId ? [tenantId] : (await repo.listTenants()).map((t) => t.id);
      const runs = (await Promise.all(tenantIds.map((id) => repo.listRuns(id)))).flat();
      return runs.map(toListItem);
    },
    recordRunSection,
  };
  return store as unknown as RunStore;
}

type RunUpdate = Parameters<SqliteRepository["updateRun"]>[2];

/** The job queue's persistence seam over the repository's jobs table. */
export function createJobPersistence(repo: SqliteRepository): JobStatePersistence {
  return {
    createJob: (input) => repo.createJob(input),
    getJob: (jobId) => repo.getJob(jobId),
    updateJobState: (jobId, state, update) => repo.updateJobState(jobId, state, update),
  };
}

/** Tenant-group runs target the group's resolved members. */
export function createRunGroupResolver(groups: TenantGroupStore): GroupMemberResolver {
  return {
    async resolveGroupMembers(groupId) {
      const group = await groups.getGroup(groupId);
      if (!group) {
        throw new AppError("tenant_group.not_found", `tenant group ${groupId} was not found`, 404);
      }
      return resolveMembers(groups, group);
    },
  };
}

export interface RunQueueOptions {
  readonly queue: JobQueue;
  readonly storageRoot: string;
  readonly tenants: TenantStore;
  readonly credentials: CredentialStoreRow;
  readonly repo: SqliteRepository;
}

export interface RunQueueAdapter {
  enqueue(envelope: JobEnvelope): Promise<string>;
  cancel(jobId: string): Promise<boolean>;
}

/**
 * Writes the run's context.json, then enqueues it. The context carries only the
 * non-secret credential record: the assessment signs in with the certificate
 * thumbprint from the host's certificate store. Runs whose tenant has no credential,
 * or one that needs secret material (client secret, PFX; see T-0827), are failed at
 * once with the reason instead of starting a worker that cannot sign in.
 */
export function createRunQueue(options: RunQueueOptions): RunQueueAdapter {
  const { queue, storageRoot, tenants, credentials, repo } = options;

  async function failRun(envelope: JobEnvelope, message: string): Promise<string> {
    const now = new Date().toISOString();
    await repo.updateRun(envelope.tenantId, envelope.runId, {
      status: "failed",
      finishedAt: now,
      updatedAt: now,
      summaryCounts: { error: message },
    });
    await rollUpParent(repo, envelope.runId);
    return envelope.jobId;
  }

  return {
    async enqueue(envelope) {
      const credential = await credentials.getCredential(envelope.tenantId);
      if (!credential) {
        return failRun(envelope, `tenant ${envelope.tenantId} has no credential; set one before running an assessment`);
      }
      if (credential.authMethod !== "certificate-thumbprint" || !credential.thumbprint) {
        return failRun(
          envelope,
          `assessment runs need a certificate-thumbprint credential; ${credential.authMethod} is not supported yet`,
        );
      }
      const tenant = await tenants.getTenant(envelope.tenantId);
      const context = {
        SchemaVersion: 1,
        Tenant: {
          TenantId: envelope.tenantId,
          DisplayName: tenant?.displayName ?? null,
          DefaultDomain: tenant?.defaultDomain ?? null,
          InitialDomain: tenant?.initialDomain ?? null,
        },
        Auth: {
          Method: "Certificate",
          ClientId: credential.clientId,
          CertificateThumbprint: credential.thumbprint,
          M365Environment: credential.environment,
        },
        Scope: { Sections: [...envelope.payload.sectionRefs] },
        Output: { OutputFolder: path.resolve(storageRoot, envelope.payload.outputRef) },
      };
      const contextPath = path.resolve(storageRoot, envelope.payload.contextRef);
      await mkdir(path.dirname(contextPath), { recursive: true });
      await writeFile(contextPath, JSON.stringify(context), { mode: 0o600 });
      return queue.enqueue(envelope);
    },
    cancel: (jobId) => queue.cancel(jobId),
  };
}

export const RUN_OUTPUT_UNREADABLE = "run.output_unreadable";

// Export-AssessmentBridgeJson writes `_Assessment[_<domain>].json` into the assessment's
// timestamped folder; the log file shares the prefix but not the extension.
const ASSESSMENT_EXPORT = /(^|\/)_Assessment[^/]*\.json$/;

export interface FindingsIngestionOptions {
  readonly repo: SqliteRepository;
  readonly storageRoot: string;
}

/**
 * Stores an assessment run's findings and summary counts before the queue reports the
 * job finished, so a run shows succeeded only once its results are readable. A
 * succeeded worker whose findings export is missing or unreadable fails the run with
 * the reason; a failed worker's error is kept on the run the same way.
 */
export function withFindingsIngestion(runWorker: RunWorkerFn, options: FindingsIngestionOptions): RunWorkerFn {
  const { repo, storageRoot } = options;

  async function recordError(envelope: JobEnvelope, message: string): Promise<void> {
    await repo.updateRun(envelope.tenantId, envelope.runId, {
      summaryCounts: { error: message },
      updatedAt: new Date().toISOString(),
    });
  }

  async function ingest(envelope: JobEnvelope, result: ResultEnvelope): Promise<void> {
    const exports = result.artifactRefs
      .map((ref) => ref.split(path.sep).join("/"))
      .filter((ref) => ASSESSMENT_EXPORT.test(ref))
      .sort();
    const ref = exports.at(-1);
    if (!ref) throw new Error("the assessment wrote no findings export (_Assessment*.json)");
    const outputFolder = path.resolve(storageRoot, envelope.payload.outputRef);
    const file = path.resolve(outputFolder, ref);
    if (!file.startsWith(outputFolder + path.sep)) throw new Error(`findings export ${ref} is outside the run folder`);
    const { findings, summaryCounts } = findingsFromAssessmentExport(await readFile(file, "utf8"), {
      tenantId: envelope.tenantId,
      runId: envelope.runId,
    });
    await repo.replaceRunFindings(envelope.tenantId, envelope.runId, findings);
    await repo.updateRun(envelope.tenantId, envelope.runId, { summaryCounts, updatedAt: new Date().toISOString() });
  }

  return async (envelope, signal) => {
    const result = await runWorker(envelope, signal);
    if (envelope.jobType !== "assessment") return result;
    if (result.status === "failed" && result.error?.message) {
      await recordError(envelope, result.error.message);
      return result;
    }
    if (result.status !== "succeeded") return result;
    try {
      await ingest(envelope, result);
      return result;
    } catch (error) {
      const message = `run output unreadable: ${error instanceof Error ? error.message : String(error)}`;
      await recordError(envelope, message);
      return {
        ...result,
        status: "failed",
        error: { code: RUN_OUTPUT_UNREADABLE, message, retryable: false },
      };
    }
  };
}
