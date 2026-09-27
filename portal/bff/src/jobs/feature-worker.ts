// Feature worker runner (T-0815).
//
// Route providers for EPIC-011 onward call a PowerShell entrypoint under portal/workers
// with a JSON job envelope and read the JSON it prints. This runs that exchange on the
// job supervisor's process core (runSupervisedProcess), so timeouts, cancellation, and
// process-tree cleanup behave exactly as for assessment runs:
//
//   pwsh -NoProfile -NonInteractive -File <workersDir>/<entrypoint> -JobFile <tmp>/job.json
//
// The job file lives in a private temp directory (0700, file 0600) because envelopes can
// carry tenant data, and it is always removed. The worker's result is the last stdout
// line that parses as JSON; anything printed before it is diagnostics.
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runSupervisedProcess, type SpawnFn } from "./supervisor.js";

/** Feature jobs are shorter than assessment runs. */
export const DEFAULT_FEATURE_TIMEOUT_MS = 5 * 60 * 1000;

const ENTRYPOINT_PATTERN = /^[a-z0-9][a-z0-9-]*\.ps1$/;

export interface FeatureJob {
  readonly tenantId: string;
  readonly [field: string]: unknown;
}

export interface RunFeatureWorkerOptions {
  /** Absolute path of portal/workers. */
  readonly workersDir: string;
  readonly pwshPath?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly spawnImpl?: SpawnFn;
  /** Parent directory for the per-job temp directory (defaults to the OS temp dir). */
  readonly tempRoot?: string;
  /** Identifies the job in errors and logs; defaults to a random id. */
  readonly jobId?: string;
}

export type FeatureWorkerErrorCode = "worker.failed" | "worker.bad_output" | "worker.invalid_entrypoint";

/** A worker that exited non-zero, printed no JSON, or was not a valid entrypoint. */
export class FeatureWorkerError extends Error {
  constructor(
    readonly code: FeatureWorkerErrorCode,
    message: string,
    readonly exitCode: number | null = null,
    /** Last 2 KiB of stderr: PowerShell writes terminating errors there. */
    readonly diagnostics: string = "",
  ) {
    super(message);
    this.name = "FeatureWorkerError";
  }
}

/** The last stdout line that parses as JSON, else the whole output, else undefined. */
export function parseWorkerOutput(stdout: string): unknown {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]!) as unknown;
    } catch {
      // Not the result line; keep looking.
    }
  }
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    return undefined;
  }
}

export function buildFeatureWorkerArgs(entrypointPath: string, jobFile: string): string[] {
  return ["-NoProfile", "-NonInteractive", "-File", entrypointPath, "-JobFile", jobFile];
}

/**
 * Run `entrypoint` (a file name in `workersDir`, e.g. "deploy-intune-template.ps1") with
 * `job` and return its parsed JSON result.
 */
export async function runFeatureWorker<T = unknown>(
  entrypoint: string,
  job: FeatureJob,
  options: RunFeatureWorkerOptions,
): Promise<T> {
  // A bare file name only: providers must not be able to point pwsh elsewhere.
  if (!ENTRYPOINT_PATTERN.test(entrypoint)) {
    throw new FeatureWorkerError("worker.invalid_entrypoint", `'${entrypoint}' is not a worker entrypoint name`);
  }
  const jobId = options.jobId ?? globalThis.crypto.randomUUID();
  const dir = await mkdtemp(path.join(options.tempRoot ?? tmpdir(), "m365-job-"));
  try {
    await chmod(dir, 0o700);
    const jobFile = path.join(dir, "job.json");
    await writeFile(jobFile, JSON.stringify({ jobId, ...job }), { mode: 0o600 });

    const exit = await runSupervisedProcess(
      buildFeatureWorkerArgs(path.join(options.workersDir, entrypoint), jobFile),
      {
        jobId,
        collectStdout: true,
        timeoutMs: options.timeoutMs ?? DEFAULT_FEATURE_TIMEOUT_MS,
        ...(options.pwshPath !== undefined ? { pwshPath: options.pwshPath } : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        ...(options.spawnImpl !== undefined ? { spawnImpl: options.spawnImpl } : {}),
      },
    );

    if (exit.exitCode !== 0) {
      throw new FeatureWorkerError(
        "worker.failed",
        `${entrypoint} exited with code ${exit.exitCode ?? "unknown"}`,
        exit.exitCode,
        exit.stderrTail,
      );
    }
    const result = parseWorkerOutput(exit.stdout);
    if (result === undefined) {
      throw new FeatureWorkerError(
        "worker.bad_output",
        `${entrypoint} printed no JSON result`,
        exit.exitCode,
        exit.stderrTail,
      );
    }
    return result as T;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
