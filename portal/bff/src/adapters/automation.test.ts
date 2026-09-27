import { SqliteRemediationRepository, SqliteRepository, loadMigrations, runMigrations } from "@m365-assess/db";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  JOB_DISPATCH_UNAVAILABLE,
  SCRIPT_SANDBOX_UNAVAILABLE,
  createRemediationStore,
  createScheduleHistoryStore,
  createUnavailableRemediationQueue,
  createUnavailableScheduleQueue,
  createUnavailableScriptSandbox,
} from "./automation.js";

async function setup() {
  const db = new Database(":memory:");
  const version = runMigrations(db, loadMigrations());
  const repo = new SqliteRepository(db, version, "memory");
  await repo.upsertTenant({ id: "t-a", displayName: null, defaultDomain: null, initialDomain: null, source: "direct", status: "active", excluded: false, lastRunAt: null, errorCount: 0 });
  return { db, version, repo };
}

describe("remediation store (T-0824)", () => {
  it("serves plans and actions with the check reference renamed for the routes", async () => {
    const { db, version, repo } = await setup();
    await repo.createRun({ id: "run-1", tenantId: "t-a", parentRunId: null, trigger: "manual", sections: [], options: null, startedAt: null, finishedAt: null, status: "succeeded", artifactPath: null, summaryCounts: null, provenance: null });
    const remediation = new SqliteRemediationRepository(db, version);
    await remediation.createRemediationPlan({
      id: "plan-1",
      tenantId: "t-a",
      runId: "run-1",
      findingIds: ["f-1"],
      mode: "automated",
      createdBy: "admin",
      actions: [{ id: "act-1", planId: "plan-1", checkId: "CA-1", command: "Set-Thing", target: null, state: "planned" }],
    } as never);
    const store = createRemediationStore(remediation);

    expect(await store.getRemediationPlan("plan-1")).toMatchObject({ id: "plan-1", tenantId: "t-a" });
    const [action] = await store.listRemediationActions("plan-1");
    expect(action).toMatchObject({ id: "act-1", check: "CA-1", state: "planned" });
    expect(await store.getRemediationAction!("act-1")).toMatchObject({ check: "CA-1" });
    expect(await store.listRemediationActionsForTenant!("t-a")).toHaveLength(1);
    expect(await store.getManualInstruction!("missing")).toBeUndefined();
  });
});

describe("schedule history (T-0824)", () => {
  it("lists a schedule's jobs, newest first, from the jobs table", async () => {
    const { db, repo } = await setup();
    const job = (id: string, scheduleId: string, state: "queued" | "done" | "failed", progress: Record<string, unknown>, createdAt: string) =>
      repo.createJob({
        id,
        type: "assessment",
        tenantId: "t-a",
        payload: { contextRef: `schedules/${scheduleId}/context.json`, outputRef: `schedules/${scheduleId}/${id}-run` },
        state,
        attempts: 0,
        progress,
        createdAt,
      });
    await job("j-1", "sch-1", "done", { queueState: "succeeded", runId: "r-1" }, "2026-09-26T01:00:00.000Z");
    await job("j-2", "sch-1", "failed", { queueState: "failed", runId: "r-2", error: "worker.failed" }, "2026-09-26T02:00:00.000Z");
    await job("j-3", "sch-10", "queued", { queueState: "queued" }, "2026-09-26T03:00:00.000Z");

    const runs = await createScheduleHistoryStore(db).listScheduleRuns("sch-1");
    expect(runs.map((r) => [r.jobId, r.runId, r.outcome, r.error])).toEqual([
      ["j-2", "r-2", "failed", "worker.failed"],
      ["j-1", "r-1", "succeeded", null],
    ]);
    expect(runs[0]!.finishedAt).not.toBeNull();
  });
});

describe("unwired execution (T-0824)", () => {
  it("refuses remediation, scheduled, and script runs with 501", async () => {
    await expect(createUnavailableRemediationQueue().enqueue({} as never)).rejects.toMatchObject({ status: 501, code: JOB_DISPATCH_UNAVAILABLE });
    await expect(createUnavailableScheduleQueue().enqueue({})).rejects.toMatchObject({ status: 501, code: JOB_DISPATCH_UNAVAILABLE });
    await expect(
      createUnavailableScriptSandbox().run({ content: "x", tenantId: "t-a", dryRun: true, parameters: null }),
    ).rejects.toMatchObject({ status: 501, code: SCRIPT_SANDBOX_UNAVAILABLE });
  });
});
