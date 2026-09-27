// EPIC-006 remediation and EPIC-007 schedules and scripts on real storage (T-0824).
//
// Plans, schedules, and scripts persist through the db repositories, which already
// match the route stores. What these routes execute is not wired yet:
//
// - Remediation plan/apply/verify and schedule run-now enqueue job types other than a
//   tenant assessment. The job queue only supervises run-tenant.ps1, so a remediation
//   or scheduled standards/drift/report job would run the wrong worker. Dispatching job
//   types to their workers is T-0836.
// - Custom scripts run in the T-0126 sandbox, which has no worker entrypoint (T-0837).
//
// Those ports refuse with 501 before anything is enqueued or run.
import {
  toManualInstructionView,
  toRemediationActionView,
  type RemediationRepository,
} from "@m365-assess/db";
import type Database from "better-sqlite3";
import { AppError } from "../errors.js";
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

export function createUnavailableRemediationQueue(): RemediationQueue {
  return {
    async enqueue() {
      throw unavailable(JOB_DISPATCH_UNAVAILABLE, "remediation jobs cannot run yet: no worker dispatch for remediation jobs");
    },
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
