// EPIC-006 remediation and EPIC-007 schedules and scripts on real storage (T-0824).
//
// Plans, schedules, and scripts persist through the db repositories, which already
// match the route stores.
//
// Remediation plan jobs run plan-remediation.ps1 through the job queue's dispatcher and
// their plans are stored when the job succeeds (T-0836). Still not wired, and refused
// with 501 before anything is enqueued or run:
//
// - Remediation apply and verify (T-0838, T-0839).
// - Schedule run-now (T-0840).
// - Custom scripts, which run in the T-0126 sandbox with no worker entrypoint (T-0837).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  remediationPlanFromWorkerOutput,
  toManualInstructionView,
  toRemediationActionView,
  type RemediationRepository,
  type SqliteRepository,
} from "@m365-assess/db";
import type { JobEnvelope } from "@m365-assess/contracts";
import type Database from "better-sqlite3";
import { AppError } from "../errors.js";
import type { JobQueue, RunWorkerFn } from "../jobs/queue.js";
import { WorkerResultError, superviseJob, type SuperviseJobOptions } from "../jobs/supervisor.js";
import type { RemediationPlanStore, RemediationQueue } from "../routes/remediation.js";
import type { ScheduleHistoryStore, ScheduleRunOutcome, ScheduleRunQueue } from "../routes/schedules.js";
import type { ScriptSandbox } from "../routes/scripts.js";

export const JOB_DISPATCH_UNAVAILABLE = "jobs.dispatch_unavailable";
export const SCRIPT_SANDBOX_UNAVAILABLE = "scripts.sandbox_unavailable";

function unavailable(code: string, message: string): AppError {
  return new AppError(code, message, 501);
}

/** Remediation reads; the db package renames each action's check reference for the routes. */
export function createRemediationStore(repo: RemediationRepository): RemediationPlanStore {
  return {
    getRemediationPlan: (planId) => repo.getRemediationPlan(planId),
    listRemediationActions: async (planId) => (await repo.listRemediationActions(planId)).map(toRemediationActionView),
    async getRemediationAction(actionId) {
      const action = await repo.getRemediationAction(actionId);
      return action ? toRemediationActionView(action) : undefined;
    },
    listRemediationActionsForTenant: async (tenantId) =>
      (await repo.listRemediationActionsForTenant(tenantId)).map(toRemediationActionView),
    async getManualInstruction(check) {
      const instruction = await repo.getManualInstruction(check);
      return instruction ? toManualInstructionView(instruction) : undefined;
    },
  };
}

export const PLAN_WORKER = "plan-remediation.ps1";
export const REMEDIATION_OUTPUT_UNREADABLE = "remediation.output_unreadable";
const PLAN_FILE = "remediation-plan.json";
const FINDINGS_FILE = "findings.json";

function operationOf(envelope: JobEnvelope): unknown {
  return (envelope.payload as unknown as Record<string, unknown>)["operation"];
}

export interface RemediationQueueOptions {
  readonly jobs: Pick<JobQueue, "enqueue">;
  readonly repo: Pick<SqliteRepository, "listFindings">;
  readonly storageRoot: string;
}

/**
 * Plan jobs: writes the job file and the run's findings into the job's folder, then
 * enqueues. The plan worker makes no tenant calls, so the job file carries no
 * credential. Apply and verify are refused until their workers are wired.
 */
export function createRemediationQueue(options: RemediationQueueOptions): RemediationQueue {
  const { jobs, repo, storageRoot } = options;
  return {
    async enqueue(envelope) {
      const operation = operationOf(envelope);
      if (operation !== "plan") {
        throw unavailable(
          JOB_DISPATCH_UNAVAILABLE,
          `remediation ${String(operation)} jobs cannot run yet: no worker dispatch for them`,
        );
      }
      const folder = path.resolve(storageRoot, envelope.payload.outputRef);
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const findings = await repo.listFindings(envelope.tenantId, envelope.runId);
      await writeFile(path.join(folder, FINDINGS_FILE), JSON.stringify(findings), { mode: 0o600 });
      await writeFile(path.resolve(storageRoot, envelope.payload.contextRef), JSON.stringify(envelope), { mode: 0o600 });
      return jobs.enqueue(envelope);
    },
  };
}

/** plan-remediation.ps1 reads the job file and findings from the job's folder. */
export function buildPlanWorkerArgs(envelope: JobEnvelope, workerScriptPath: string): string[] {
  return [
    "-NoProfile",
    "-NonInteractive",
    "-File",
    workerScriptPath,
    "-JobFile",
    envelope.payload.contextRef,
    "-OutputFolder",
    envelope.payload.outputRef,
    "-FindingsFile",
    path.posix.join(envelope.payload.outputRef, FINDINGS_FILE),
  ];
}

export type RemediationWorkerOptions = Omit<SuperviseJobOptions, "signal" | "workerScriptPath" | "buildArgs"> & {
  readonly workersDir: string;
};

/** The remediation runner for the job dispatcher: plan jobs only (see the file header). */
export function createRemediationWorkerRunner(options: RemediationWorkerOptions): RunWorkerFn {
  const { workersDir, ...supervise } = options;
  return async (envelope, signal) => {
    if (operationOf(envelope) !== "plan") {
      throw new WorkerResultError(JOB_DISPATCH_UNAVAILABLE, `no worker runs remediation ${String(operationOf(envelope))} jobs`);
    }
    return superviseJob(envelope, {
      ...supervise,
      workerScriptPath: path.join(workersDir, PLAN_WORKER),
      buildArgs: buildPlanWorkerArgs,
      signal,
    });
  };
}

export interface RemediationIngestionOptions {
  readonly remediation: Pick<RemediationRepository, "createRemediationPlan" | "getRemediationPlan" | "upsertManualInstruction">;
  readonly storageRoot: string;
}

/**
 * Stores a succeeded plan job's plan, actions, and manual instructions before the
 * queue reports the job finished. Output that is missing or malformed fails the job.
 */
export function withRemediationPlanIngestion(runWorker: RunWorkerFn, options: RemediationIngestionOptions): RunWorkerFn {
  const { remediation, storageRoot } = options;
  return async (envelope, signal) => {
    const result = await runWorker(envelope, signal);
    if (envelope.jobType !== "remediation" || operationOf(envelope) !== "plan" || result.status !== "succeeded") {
      return result;
    }
    const payload = envelope.payload as unknown as Record<string, unknown>;
    try {
      const planId = payload["planId"];
      if (typeof planId !== "string" || planId === "") throw new Error("the plan job has no planId");
      const file = path.resolve(storageRoot, envelope.payload.outputRef, PLAN_FILE);
      const { plan, instructions } = remediationPlanFromWorkerOutput(await readFile(file, "utf8"), {
        planId,
        tenantId: envelope.tenantId,
        runId: envelope.runId,
        createdBy: typeof payload["createdBy"] === "string" ? payload["createdBy"] : "system",
      });
      // A retried job must not fail on the plan its first attempt stored.
      if (!(await remediation.getRemediationPlan(planId))) await remediation.createRemediationPlan(plan);
      for (const instruction of instructions) await remediation.upsertManualInstruction(instruction);
      return result;
    } catch (error) {
      const message = `remediation plan output unreadable: ${error instanceof Error ? error.message : String(error)}`;
      return { ...result, status: "failed", error: { code: REMEDIATION_OUTPUT_UNREADABLE, message, retryable: false } };
    }
  };
}

export function createUnavailableScheduleQueue(): ScheduleRunQueue {
  return {
    async enqueue() {
      throw unavailable(JOB_DISPATCH_UNAVAILABLE, "scheduled jobs cannot run yet: no worker dispatch for scheduled jobs");
    },
  };
}

export function createUnavailableScriptSandbox(): ScriptSandbox {
  return {
    async run() {
      throw unavailable(SCRIPT_SANDBOX_UNAVAILABLE, "custom scripts cannot run yet: the script sandbox has no worker entrypoint");
    },
  };
}

interface JobRow {
  readonly id: string;
  readonly state: string;
  readonly progress: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const OUTCOME_BY_QUEUE_STATE: Readonly<Record<string, ScheduleRunOutcome>> = {
  queued: "queued",
  running: "running",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
  done: "succeeded",
};

/**
 * A schedule's runs are the jobs it enqueued. The queue persists only the envelope's
 * payload, whose refs sit under `schedules/<scheduleId>/` (buildScheduledEnvelope).
 */
export function createScheduleHistoryStore(db: Database.Database): ScheduleHistoryStore {
  return {
    async listScheduleRuns(scheduleId) {
      const rows = db
        .prepare(
          `SELECT id, state, progress, createdAt, updatedAt FROM jobs
            WHERE json_extract(payload, '$.outputRef') LIKE ? ESCAPE '\\'
            ORDER BY createdAt DESC`,
        )
        .all(`schedules/${scheduleId.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`) as JobRow[];
      return rows.map((row) => {
        const progress = row.progress ? (JSON.parse(row.progress) as Record<string, unknown>) : {};
        const queueState = typeof progress["queueState"] === "string" ? progress["queueState"] : row.state;
        const outcome = OUTCOME_BY_QUEUE_STATE[queueState] ?? "failed";
        const terminal = outcome !== "queued" && outcome !== "running";
        const error = progress["error"];
        return {
          runId: typeof progress["runId"] === "string" ? progress["runId"] : row.id,
          jobId: row.id,
          scheduleId,
          startedAt: row.createdAt,
          finishedAt: terminal ? row.updatedAt : null,
          outcome,
          error: typeof error === "string" ? error : error && typeof error === "object" ? JSON.stringify(error) : null,
        };
      });
    },
  };
}
