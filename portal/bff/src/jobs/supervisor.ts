import { spawn, type SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  EnvelopeValidationError,
  parseJobEnvelope,
  parseResultEnvelope,
  type JobEnvelope,
  type ResultEnvelope,
} from "@m365-assess/contracts";
import { parseProgressEvent, type ProgressEvent } from "@m365-assess/contracts/events";

// Default ceiling for one tenant worker before the supervisor treats it as
// hung. Thirty minutes comfortably covers a full assessment while still
// bounding orphaned-process fallout (ADR-0014 failure mode).
export const DEFAULT_JOB_TIMEOUT_MS = 30 * 60 * 1000;

// Conventional repo-relative entrypoint the supervisor launches. Callers pass
// this (resolved to an absolute path) as workerScriptPath.
export const WORKER_SCRIPT = "portal/workers/run-tenant.ps1";

export class JobTimeoutError extends Error {
  readonly code = "worker.timeout";
  readonly jobId: string;

  constructor(jobId: string, timeoutMs: number) {
    super(`worker for job ${jobId} exceeded its timeout of ${timeoutMs}ms`);
    this.name = "JobTimeoutError";
    this.jobId = jobId;
  }
}

export class JobCancelledError extends Error {
  readonly code = "worker.cancelled";
  readonly jobId: string;

  constructor(jobId: string) {
    super(`worker for job ${jobId} was cancelled`);
    this.name = "JobCancelledError";
    this.jobId = jobId;
  }
}

export class WorkerResultError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WorkerResultError";
    this.code = code;
  }
}

// Structural child-process seam: the real spawn return value satisfies this,
// and tests substitute an EventEmitter-backed fake.
export interface SpawnedProcess extends EventEmitter {
  readonly pid?: number;
  readonly stdout: EventEmitter | null;
  readonly stderr: EventEmitter | null;
  kill(signal?: string): boolean;
}

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => SpawnedProcess;

export interface SuperviseJobOptions {
  readonly workerScriptPath: string;
  readonly pwshPath?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly spawnImpl?: SpawnFn;
  readonly readResultFile?: (filePath: string) => Promise<string>;
  readonly onProgress?: (event: ProgressEvent) => void;
  /**
   * Directory the envelope's relative refs (context, output, result.json) resolve
   * against. The worker runs there; defaults to the BFF's working directory.
   */
  readonly storageRoot?: string;
  /** The worker's arguments; defaults to run-tenant.ps1's (buildWorkerArgs). */
  readonly buildArgs?: (envelope: JobEnvelope, workerScriptPath: string) => string[];
}

function defaultSpawn(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): SpawnedProcess {
  return spawn(command, [...args], options) as unknown as SpawnedProcess;
}

// run-tenant.ps1 takes context/output locations plus envelope ids; the
// envelope itself travels via those files, never as secrets on the argv.
export function buildWorkerArgs(
  envelope: JobEnvelope,
  workerScriptPath: string,
): string[] {
  return [
    "-NoProfile",
    "-NonInteractive",
    "-File",
    workerScriptPath,
    "-ContextFile",
    envelope.payload.contextRef,
    "-OutputFolder",
    envelope.payload.outputRef,
    "-JobId",
    envelope.jobId,
    "-RunId",
    envelope.runId,
    "-RequestId",
    envelope.requestId,
    "-CorrelationId",
    envelope.correlationId,
  ];
}

export function resultFilePath(envelope: JobEnvelope): string {
  return path.join(envelope.payload.outputRef, "result.json");
}

function killProcessTree(child: SpawnedProcess): void {
  const pid = child.pid;
  if (pid !== undefined) {
    if (process.platform === "win32") {
      try {
        spawn("taskkill", ["/pid", String(pid), "/t", "/f"]);
      } catch {
        // fall through to child.kill below
      }
    } else {
      // Negative pid targets the whole process group, which is why the
      // child is spawned detached on POSIX.
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // Group already gone; child.kill below finishes the job.
      }
    }
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // Already exited; exit handler settles the promise.
  }
}

function forwardProgressLines(
  chunk: unknown,
  carried: { text: string },
  onProgress: ((event: ProgressEvent) => void) | undefined,
): void {
  carried.text += String(chunk);
  const lines = carried.text.split(/\r?\n/);
  carried.text = lines.pop() ?? "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      const event = parseProgressEvent(trimmed);
      onProgress?.(event);
    } catch {
      // Diagnostics output shares stdout by contract; only JSON progress
      // lines are forwarded.
    }
  }
}

export interface SupervisedProcessOptions {
  /** Identifies the job in timeout/cancellation errors. */
  readonly jobId: string;
  readonly pwshPath?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly spawnImpl?: SpawnFn;
  /** Called with each stdout chunk as it arrives. */
  readonly onStdout?: (chunk: unknown) => void;
  /** Keep the full stdout text for the caller (feature workers print their result there). */
  readonly collectStdout?: boolean;
  /** Working directory for the worker process. */
  readonly cwd?: string;
}

export interface SupervisedProcessExit {
  readonly exitCode: number | null;
  readonly stdout: string;
  /** Last 2 KiB of stderr, for diagnostics. */
  readonly stderrTail: string;
}

/**
 * The one place a worker process is spawned and supervised: timeout and cancellation
 * kill the whole process tree, and a spawn failure is a WorkerResultError. Resolves on
 * exit with the exit code; interpreting the result is the caller's job.
 */
export function runSupervisedProcess(
  args: readonly string[],
  options: SupervisedProcessOptions,
): Promise<SupervisedProcessExit> {
  const {
    jobId,
    pwshPath = "pwsh",
    timeoutMs = DEFAULT_JOB_TIMEOUT_MS,
    signal,
    spawnImpl = defaultSpawn,
    onStdout,
    collectStdout = false,
    cwd,
  } = options;

  if (signal?.aborted === true) {
    return Promise.reject(new JobCancelledError(jobId));
  }

  const child = spawnImpl(pwshPath, args, {
    ...(cwd !== undefined ? { cwd } : {}),
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  return new Promise<SupervisedProcessExit>((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderrTail = "";

    const settle = (fn: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };

    const timer = setTimeout(() => {
      killProcessTree(child);
      settle(() => reject(new JobTimeoutError(jobId, timeoutMs)));
    }, timeoutMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }

    const onAbort = (): void => {
      killProcessTree(child);
      settle(() => reject(new JobCancelledError(jobId)));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: unknown) => {
      if (collectStdout) stdout += String(chunk);
      onStdout?.(chunk);
    });
    child.stderr?.on("data", (chunk: unknown) => {
      stderrTail = `${stderrTail}${String(chunk)}`.slice(-2048);
    });
    child.once("error", (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      settle(() => reject(new WorkerResultError("worker.spawn_failed", message)));
    });
    child.once("exit", (code: unknown) => {
      settle(() => resolve({ exitCode: typeof code === "number" ? code : null, stdout, stderrTail }));
    });
  });
}

export async function superviseJob(
  envelopeInput: unknown,
  options: SuperviseJobOptions,
): Promise<ResultEnvelope> {
  // Rejected here, before any process is spawned: a schema mismatch must
  // never silently start a worker.
  const envelope = parseJobEnvelope(envelopeInput);
  const {
    workerScriptPath,
    readResultFile = (filePath) => readFile(filePath, "utf8"),
    onProgress,
  } = options;

  const carried = { text: "" };
  const args = (options.buildArgs ?? buildWorkerArgs)(envelope, workerScriptPath);
  const { stderrTail } = await runSupervisedProcess(args, {
    jobId: envelope.jobId,
    ...(options.pwshPath !== undefined ? { pwshPath: options.pwshPath } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(options.spawnImpl !== undefined ? { spawnImpl: options.spawnImpl } : {}),
    ...(options.storageRoot !== undefined ? { cwd: options.storageRoot } : {}),
    onStdout: (chunk) => forwardProgressLines(chunk, carried, onProgress),
  });

  try {
    const resultPath = resultFilePath(envelope);
    const raw = await readResultFile(options.storageRoot !== undefined ? path.resolve(options.storageRoot, resultPath) : resultPath);
    const result = parseResultEnvelope(raw);
    if (
      result.jobId !== envelope.jobId ||
      result.runId !== envelope.runId ||
      result.tenantId !== envelope.tenantId
    ) {
      throw new EnvelopeValidationError(
        "envelope.invalid",
        "Result envelope does not belong to the supervised job",
        undefined,
      );
    }
    return result;
  } catch (error) {
    if (error instanceof EnvelopeValidationError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    const suffix = stderrTail.length > 0 ? ` diagnostics: ${stderrTail}` : "";
    throw new WorkerResultError(
      "worker.result_missing",
      `worker for job ${envelope.jobId} left no readable result envelope: ${detail}${suffix}`,
    );
  }
}

// Binds a supervisor configuration to the runner shape the queue consumes so
// queue construction stays a one-liner for callers.
export function createSupervisorRunner(
  options: Omit<SuperviseJobOptions, "signal">,
): (envelope: JobEnvelope, signal: AbortSignal) => Promise<ResultEnvelope> {
  return (envelope, signal) => superviseJob(envelope, { ...options, signal });
}
