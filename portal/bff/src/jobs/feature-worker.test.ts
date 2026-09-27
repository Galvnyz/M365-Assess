import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FeatureWorkerError,
  buildFeatureWorkerArgs,
  parseWorkerOutput,
  runFeatureWorker,
} from "./feature-worker.js";
import { JobCancelledError, JobTimeoutError, WorkerResultError, type SpawnFn } from "./supervisor.js";

class FakeChild extends EventEmitter {
  pid: number | undefined = undefined;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killedWith: string[] = [];
  kill(signal?: string): boolean {
    this.killedWith.push(signal ?? "SIGTERM");
    return true;
  }
}

interface Spawned {
  command: string;
  args: readonly string[];
  job: Record<string, unknown>;
  jobFileMode: number;
  child: FakeChild;
}

/** A fake pwsh that records the call, reads the job file while it exists, then runs `behave`. */
function fakeSpawn(behave: (child: FakeChild, spawned: Spawned) => void): { spawnImpl: SpawnFn; calls: Spawned[] } {
  const calls: Spawned[] = [];
  const spawnImpl: SpawnFn = (command, args) => {
    const child = new FakeChild();
    const jobFile = args[args.indexOf("-JobFile") + 1]!;
    const spawned: Spawned = {
      command,
      args,
      job: JSON.parse(readFileSync(jobFile, "utf8")) as Record<string, unknown>,
      jobFileMode: statSync(jobFile).mode & 0o777,
      child,
    };
    calls.push(spawned);
    setImmediate(() => behave(child, spawned));
    return child;
  };
  return { spawnImpl, calls };
}

let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(path.join(tmpdir(), "feature-worker-test-"));
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

const noJobDirsLeft = () => readdirSync(tempRoot).filter((d) => d.startsWith("m365-job-"));

function options(spawnImpl: SpawnFn, extra: Record<string, unknown> = {}) {
  return { workersDir: "/repo/portal/workers", tempRoot, spawnImpl, ...extra };
}

describe("parseWorkerOutput (T-0815)", () => {
  it("takes the last JSON line and ignores diagnostics before it", () => {
    expect(parseWorkerOutput('WARNING: slow tenant\n{"ok":true}\n')).toEqual({ ok: true });
    expect(parseWorkerOutput('{"progress":1}\n{"ok":true}')).toEqual({ ok: true });
  });

  it("accepts pretty-printed JSON spanning lines", () => {
    expect(parseWorkerOutput('{\n  "ok": true\n}\n')).toEqual({ ok: true });
  });

  it("returns undefined when nothing parses", () => {
    expect(parseWorkerOutput("")).toBeUndefined();
    expect(parseWorkerOutput("Done.")).toBeUndefined();
  });
});

describe("runFeatureWorker (T-0815)", () => {
  it("runs the entrypoint with -JobFile and returns the parsed result", async () => {
    const { spawnImpl, calls } = fakeSpawn((child) => {
      child.stdout.emit("data", "starting\n");
      child.stdout.emit("data", '{"items":[1,2]}\n');
      child.emit("exit", 0);
    });
    const result = await runFeatureWorker<{ items: number[] }>(
      "get-intune-policies.ps1",
      { tenantId: "t-1", kind: "compliance" },
      options(spawnImpl, { jobId: "job-7" }),
    );
    expect(result).toEqual({ items: [1, 2] });
    expect(calls[0]!.command).toBe("pwsh");
    expect(calls[0]!.args).toEqual(
      buildFeatureWorkerArgs("/repo/portal/workers/get-intune-policies.ps1", calls[0]!.args[5]!),
    );
    expect(calls[0]!.args.slice(0, 4)).toEqual(["-NoProfile", "-NonInteractive", "-File", "/repo/portal/workers/get-intune-policies.ps1"]);
    expect(calls[0]!.job).toEqual({ jobId: "job-7", tenantId: "t-1", kind: "compliance" });
    expect(noJobDirsLeft()).toEqual([]);
  });

  it("writes the job file readable by its owner only", async () => {
    const { spawnImpl, calls } = fakeSpawn((child) => {
      child.stdout.emit("data", "{}");
      child.emit("exit", 0);
    });
    await runFeatureWorker("x.ps1", { tenantId: "t" }, options(spawnImpl));
    expect(calls[0]!.jobFileMode).toBe(0o600);
  });

  it("maps a non-zero exit to worker.failed with the stderr diagnostics", async () => {
    const { spawnImpl } = fakeSpawn((child) => {
      child.stderr.emit("data", "Deploy blocked for tenant 't': conflict");
      child.emit("exit", 1);
    });
    const error = await runFeatureWorker("deploy-intune-template.ps1", { tenantId: "t" }, options(spawnImpl)).catch((e) => e);
    expect(error).toBeInstanceOf(FeatureWorkerError);
    expect(error).toMatchObject({ code: "worker.failed", exitCode: 1 });
    expect(error.diagnostics).toContain("Deploy blocked");
    expect(noJobDirsLeft()).toEqual([]);
  });

  it("maps a clean exit with no JSON to worker.bad_output", async () => {
    const { spawnImpl } = fakeSpawn((child) => {
      child.stdout.emit("data", "Done.\n");
      child.emit("exit", 0);
    });
    await expect(runFeatureWorker("x.ps1", { tenantId: "t" }, options(spawnImpl))).rejects.toMatchObject({
      code: "worker.bad_output",
    });
    expect(noJobDirsLeft()).toEqual([]);
  });

  it("times out, kills the worker, and still removes the job file", async () => {
    const { spawnImpl, calls } = fakeSpawn(() => {
      /* never exits */
    });
    await expect(
      runFeatureWorker("x.ps1", { tenantId: "t" }, options(spawnImpl, { timeoutMs: 20 })),
    ).rejects.toBeInstanceOf(JobTimeoutError);
    expect(calls[0]!.child.killedWith).toContain("SIGKILL");
    expect(noJobDirsLeft()).toEqual([]);
  });

  it("honours cancellation", async () => {
    const controller = new AbortController();
    const { spawnImpl, calls } = fakeSpawn(() => controller.abort());
    await expect(
      runFeatureWorker("x.ps1", { tenantId: "t" }, options(spawnImpl, { signal: controller.signal })),
    ).rejects.toBeInstanceOf(JobCancelledError);
    expect(calls[0]!.child.killedWith).toContain("SIGKILL");
    expect(noJobDirsLeft()).toEqual([]);
  });

  it("does not spawn when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const { spawnImpl, calls } = fakeSpawn(() => undefined);
    await expect(
      runFeatureWorker("x.ps1", { tenantId: "t" }, options(spawnImpl, { signal: controller.signal })),
    ).rejects.toBeInstanceOf(JobCancelledError);
    expect(calls).toHaveLength(0);
    expect(noJobDirsLeft()).toEqual([]);
  });

  it("surfaces a spawn failure", async () => {
    const { spawnImpl } = fakeSpawn((child) => child.emit("error", new Error("pwsh not found")));
    await expect(runFeatureWorker("x.ps1", { tenantId: "t" }, options(spawnImpl))).rejects.toBeInstanceOf(
      WorkerResultError,
    );
  });

  it("rejects entrypoints that are not bare worker file names", async () => {
    const { spawnImpl, calls } = fakeSpawn(() => undefined);
    for (const bad of ["../evil.ps1", "/abs/x.ps1", "x.sh", "sub/x.ps1", "X.ps1"]) {
      await expect(runFeatureWorker(bad, { tenantId: "t" }, options(spawnImpl))).rejects.toMatchObject({
        code: "worker.invalid_entrypoint",
      });
    }
    expect(calls).toHaveLength(0);
  });
});

const hasPwsh = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).status === 0;

describe.skipIf(!hasPwsh)("runFeatureWorker with real pwsh (T-0815)", () => {
  it("round-trips a job through a real entrypoint", async () => {
    const workersDir = mkdtempSync(path.join(tmpdir(), "feature-workers-"));
    try {
      writeFileSync(
        path.join(workersDir, "echo-job.ps1"),
        [
          "param([Parameter(Mandatory)][string]$JobFile)",
          "$ErrorActionPreference = 'Stop'",
          "$job = Get-Content -LiteralPath $JobFile -Raw | ConvertFrom-Json",
          "if ($job.fail) { throw 'asked to fail' }",
          "Write-Output 'diagnostic line'",
          "[pscustomobject]@{ tenantId = $job.tenantId; doubled = $job.n * 2 } | ConvertTo-Json -Compress",
        ].join("\n"),
      );
      const result = await runFeatureWorker("echo-job.ps1", { tenantId: "t-9", n: 21 }, { workersDir, tempRoot });
      expect(result).toEqual({ tenantId: "t-9", doubled: 42 });

      const error = await runFeatureWorker("echo-job.ps1", { tenantId: "t", fail: true }, { workersDir, tempRoot }).catch((e) => e);
      expect(error).toMatchObject({ code: "worker.failed" });
      expect(error.diagnostics).toContain("asked to fail");
      expect(noJobDirsLeft()).toEqual([]);
    } finally {
      rmSync(workersDir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("worker entrypoint convention (T-0815)", () => {
  it("every job-file worker entrypoint takes -JobFile, not -JobPath", () => {
    const workers = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../workers");
    const offenders = readdirSync(workers)
      .filter((f) => f.endsWith(".ps1") && f !== "run-tenant.ps1")
      .filter((f) => /\$JobPath\b/.test(readFileSync(path.join(workers, f), "utf8")));
    expect(offenders).toEqual([]);
    expect(existsSync(path.join(workers, "get-intune-policies.ps1"))).toBe(true);
  });
});
