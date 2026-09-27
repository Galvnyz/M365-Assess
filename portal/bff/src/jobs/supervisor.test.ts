import path from "node:path";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { EnvelopeValidationError } from "@m365-assess/contracts";
import {
  JobCancelledError,
  JobTimeoutError,
  WorkerResultError,
  buildWorkerArgs,
  superviseJob,
  type SpawnedProcess,
  type SpawnFn,
} from "./supervisor.js";
import type { JobEnvelope, ResultEnvelope } from "@m365-assess/contracts";
import type { ProgressEvent } from "@m365-assess/contracts/events";

const TENANT_ID = "00000000-0000-0000-0000-000000000000";

function makeJob(): JobEnvelope {
  return {
    schemaVersion: "v1",
    jobId: "job-0001",
    jobType: "assessment",
    tenantId: TENANT_ID,
    runId: "run-0001",
    requestId: "req-0001",
    correlationId: "corr-0001",
    createdAt: "2026-01-01T00:00:00.000Z",
    payload: {
      contextRef: "runs/run-0001/context.json",
      outputRef: "runs/run-0001/tenant",
      credentialRef: `tenants/${TENANT_ID}/credential`,
      sectionRefs: [],
      artifactRefs: [],
    },
  };
}

function makeResult(job: JobEnvelope): ResultEnvelope {
  return {
    schemaVersion: "v1",
    jobId: job.jobId,
    jobType: job.jobType,
    tenantId: job.tenantId,
    runId: job.runId,
    requestId: job.requestId,
    correlationId: job.correlationId,
    status: "succeeded",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:05:00.000Z",
    exitCode: 0,
    artifactRefs: [],
  };
}

function makeProgress(job: JobEnvelope): ProgressEvent {
  return {
    schemaVersion: "v1",
    sequence: 1,
    eventId: "evt-0001",
    runId: job.runId,
    tenantId: job.tenantId,
    jobId: job.jobId,
    jobType: job.jobType,
    requestId: job.requestId,
    correlationId: job.correlationId,
    at: "2026-01-01T00:00:05.000Z",
    state: "running",
  };
}

class FakeChild extends EventEmitter {
  pid: number | undefined = 42424242;
  stdout: EventEmitter | null = new EventEmitter();
  stderr: EventEmitter | null = new EventEmitter();
  killedWith: string[] = [];

  kill(signal?: string): boolean {
    this.killedWith.push(signal ?? "SIGTERM");
    return true;
  }
}

function captureSpawn(): { spawnImpl: SpawnFn; fakes: FakeChild[] } {
  const fakes: FakeChild[] = [];
  const spawnImpl: SpawnFn = () => {
    const fake = new FakeChild();
    fakes.push(fake);
    return fake;
  };
  return { spawnImpl, fakes };
}

describe("superviseJob", () => {
  it("rejects an envelope schema mismatch without spawning a worker", async () => {
    const { spawnImpl, fakes } = captureSpawn();
    await expect(
      superviseJob(
        { ...makeJob(), schemaVersion: "v99" },
        { workerScriptPath: "/workers/run-tenant.ps1", spawnImpl },
      ),
    ).rejects.toBeInstanceOf(EnvelopeValidationError);
    expect(fakes.length).toBe(0);
  });

  it("spawns pwsh with the envelope and resolves the parsed result", async () => {
    const job = makeJob();
    const result = makeResult(job);
    const seen: { command?: string; args?: readonly string[] } = {};
    const fake = new FakeChild();
    fake.pid = undefined;
    const spawnImpl: SpawnFn = (command, args) => {
      seen.command = command;
      seen.args = args;
      return fake;
    };
    const events: ProgressEvent[] = [];
    const pending = superviseJob(job, {
      workerScriptPath: "/workers/run-tenant.ps1",
      spawnImpl,
      readResultFile: async () => JSON.stringify(result),
      onProgress: (event) => {
        events.push(event);
      },
    });

    expect(seen.command).toBe("pwsh");
    expect(seen.args).toEqual(buildWorkerArgs(job, "/workers/run-tenant.ps1"));
    fake.stdout?.emit("data", "diagnostic line, not JSON\n");
    fake.stdout?.emit("data", `${JSON.stringify(makeProgress(job))}\n`);
    fake.emit("exit", 0, null);

    await expect(pending).resolves.toEqual(result);
    expect(events.length).toBe(1);
    expect(events[0]?.state).toBe("running");
  });

  it("runs the worker in the storage root and reads the result from there", async () => {
    const job = makeJob();
    const fake = new FakeChild();
    fake.pid = undefined;
    let cwd: unknown;
    let readPath = "";
    const pending = superviseJob(job, {
      workerScriptPath: "/workers/run-tenant.ps1",
      storageRoot: "/srv/portal",
      spawnImpl: (_command, _args, options) => {
        cwd = options.cwd;
        return fake;
      },
      readResultFile: async (filePath) => {
        readPath = filePath;
        return JSON.stringify(makeResult(job));
      },
    });
    fake.emit("exit", 0, null);
    await pending;
    expect(cwd).toBe("/srv/portal");
    expect(readPath).toBe(path.resolve("/srv/portal", job.payload.outputRef, "result.json"));
  });

  it("rejects a result envelope with a schema mismatch", async () => {
    const job = makeJob();
    const fake = new FakeChild();
    fake.pid = undefined;
    const pending = superviseJob(job, {
      workerScriptPath: "/workers/run-tenant.ps1",
      spawnImpl: () => fake,
      readResultFile: async () => JSON.stringify({ schemaVersion: "v99" }),
    });
    fake.emit("exit", 0, null);
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EnvelopeValidationError);
    expect((error as EnvelopeValidationError).code).toBe(
      "envelope.unsupported_schema_version",
    );
  });

  it("rejects a result envelope that belongs to another job", async () => {
    const job = makeJob();
    const other = { ...makeResult(job), jobId: "job-9999" };
    const fake = new FakeChild();
    fake.pid = undefined;
    const pending = superviseJob(job, {
      workerScriptPath: "/workers/run-tenant.ps1",
      spawnImpl: () => fake,
      readResultFile: async () => JSON.stringify(other),
    });
    fake.emit("exit", 0, null);
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EnvelopeValidationError);
    expect((error as EnvelopeValidationError).code).toBe("envelope.invalid");
  });

  it("kills a hung worker on timeout", async () => {
    const job = makeJob();
    const fake = new FakeChild();
    const pending = superviseJob(job, {
      workerScriptPath: "/workers/run-tenant.ps1",
      spawnImpl: () => fake,
      timeoutMs: 20,
      readResultFile: async () => JSON.stringify(makeResult(job)),
    });
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JobTimeoutError);
    expect((error as JobTimeoutError).code).toBe("worker.timeout");
    expect(fake.killedWith).toContain("SIGKILL");
  });

  it("kills the worker when the caller cancels", async () => {
    const job = makeJob();
    const controller = new AbortController();
    const fake = new FakeChild();
    fake.pid = undefined;
    const pending = superviseJob(job, {
      workerScriptPath: "/workers/run-tenant.ps1",
      spawnImpl: () => fake,
      signal: controller.signal,
      readResultFile: async () => JSON.stringify(makeResult(job)),
    });
    controller.abort();
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JobCancelledError);
    expect(fake.killedWith).toContain("SIGKILL");
  });

  it("rejects immediately when already cancelled before spawn", async () => {
    const { spawnImpl, fakes } = captureSpawn();
    const controller = new AbortController();
    controller.abort();
    await expect(
      superviseJob(makeJob(), {
        workerScriptPath: "/workers/run-tenant.ps1",
        spawnImpl,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(JobCancelledError);
    expect(fakes.length).toBe(0);
  });

  it("reports a spawn failure instead of hanging", async () => {
    const fake = new FakeChild();
    fake.pid = undefined;
    const pending = superviseJob(makeJob(), {
      workerScriptPath: "/workers/run-tenant.ps1",
      spawnImpl: () => fake,
    });
    fake.emit("error", new Error("pwsh not found"));
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WorkerResultError);
    expect((error as WorkerResultError).code).toBe("worker.spawn_failed");
  });
});
