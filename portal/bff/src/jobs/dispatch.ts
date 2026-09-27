// Job dispatch by type (T-0836).
//
// The queue runs every job through one RunWorkerFn. Job types run different worker
// entrypoints with different arguments, so this picks the runner registered for the
// envelope's type. A type with no runner fails its job instead of starting the wrong
// worker.
import type { JobType } from "@m365-assess/contracts";
import type { RunWorkerFn } from "./queue.js";
import { WorkerResultError } from "./supervisor.js";

export const NO_WORKER_FOR_JOB = "jobs.no_worker";

export function createJobDispatcher(runners: Partial<Record<JobType, RunWorkerFn>>): RunWorkerFn {
  return (envelope, signal) => {
    const run = runners[envelope.jobType];
    if (!run) {
      return Promise.reject(
        new WorkerResultError(NO_WORKER_FOR_JOB, `no worker is registered for ${envelope.jobType} jobs`),
      );
    }
    return run(envelope, signal);
  };
}
