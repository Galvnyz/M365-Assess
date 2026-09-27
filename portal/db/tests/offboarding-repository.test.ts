import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { openSqliteOffboardingRepository } from "../src/offboarding-repository.js";
import { openSqliteRepository } from "../src/sqlite-repository.js";

const TENANT_ID = "33333333-3333-3333-3333-333333333333";
const JOB_ID = "44444444-4444-4444-4444-444444444444";
const USER_ID = "55555555-5555-5555-5555-555555555555";
const V1_ACTIONS = [
  "disable-sign-in",
  "remove-licenses",
  "convert-mailbox",
  "remove-groups",
];

const tempDirs: string[] = [];

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "m365-offboarding-"));
  tempDirs.push(dir);
  return join(dir, "portal.db");
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

function columns(filename: string, table: string): string[] {
  const raw = new Database(filename);
  try {
    return (
      raw.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    ).map((row) => row.name);
  } finally {
    raw.close();
  }
}

async function seedTenant(filename: string): Promise<void> {
  const tenants = await openSqliteRepository({ filename });
  await tenants.upsertTenant({
    id: TENANT_ID,
    displayName: null,
    defaultDomain: null,
    initialDomain: null,
    source: "direct",
    status: "active",
    excluded: false,
    lastRunAt: null,
    errorCount: 0,
  });
  tenants.close();
}

describe("offboarding migration", () => {
  it("creates the SPEC §5 job and step columns", async () => {
    const filename = tempDbPath();
    const repo = await openSqliteOffboardingRepository({ filename });
    expect(repo.schemaVersion).toBeGreaterThan(2);
    repo.close();

    expect(columns(filename, "offboarding_jobs")).toEqual(
      expect.arrayContaining([
        "id",
        "tenantId",
        "userIds",
        "options",
        "state",
        "createdAt",
        "createdBy",
      ]),
    );
    expect(columns(filename, "offboarding_steps")).toEqual(
      expect.arrayContaining(["jobId", "order", "action", "state", "result", "error", "appliedAt"]),
    );
  });
});

describe("offboarding repository", () => {
  it("appends pending steps to an existing job in order", async () => {
    const filename = tempDbPath();
    await seedTenant(filename);

    const repo = await openSqliteOffboardingRepository({ filename });
    await repo.createOffboardingJob({ id: JOB_ID, tenantId: TENANT_ID, userIds: [USER_ID], options: {}, createdBy: "operator-1" });
    await repo.createOffboardingSteps(JOB_ID, V1_ACTIONS.slice(0, 2));
    const steps = await repo.createOffboardingSteps(JOB_ID, V1_ACTIONS.slice(2));

    expect(steps.map((step) => [step.order, step.action, step.state])).toEqual(
      V1_ACTIONS.map((action, index) => [index + 1, action, "pending"]),
    );
    repo.close();
  });

  it("round-trips a job with its steps, updates a step, and re-runs it", async () => {
    const filename = tempDbPath();
    await seedTenant(filename);

    const repo = await openSqliteOffboardingRepository({ filename });
    const job = await repo.createOffboardingJob({
      id: JOB_ID,
      tenantId: TENANT_ID,
      userIds: [USER_ID],
      options: { convertMailbox: true, mailboxAccess: { mode: "send-as", automap: true } },
      createdBy: "operator-1",
      steps: V1_ACTIONS.map((action, index) => ({ order: index + 1, action })),
    });

    expect(job.state).toBe("planned");
    expect(job.userIds).toEqual([USER_ID]);
    expect(job.options).toEqual({
      convertMailbox: true,
      mailboxAccess: { mode: "send-as", automap: true },
    });
    expect(job.createdBy).toBe("operator-1");

    const steps = await repo.listOffboardingSteps(JOB_ID);
    expect(steps.map((step) => step.action)).toEqual(V1_ACTIONS);
    expect(steps.map((step) => step.order)).toEqual([1, 2, 3, 4]);
    expect(steps.every((step) => step.state === "pending")).toBe(true);

    const updated = await repo.updateOffboardingStep(JOB_ID, 1, {
      state: "succeeded",
      result: { disabled: true },
      appliedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(updated?.state).toBe("succeeded");
    expect(updated?.result).toEqual({ disabled: true });
    expect(updated?.appliedAt).toBe("2026-01-01T00:00:00.000Z");

    const untouched = await repo.getOffboardingStep(JOB_ID, 2);
    expect(untouched?.state).toBe("pending");
    expect(untouched?.result).toBeNull();

    expect(await repo.resetOffboardingStep(JOB_ID, 1)).toBe(true);
    const reset = await repo.getOffboardingStep(JOB_ID, 1);
    expect(reset?.state).toBe("pending");
    expect(reset?.result).toBeNull();
    expect(reset?.error).toBeNull();
    expect(reset?.appliedAt).toBeNull();
    expect(await repo.resetOffboardingStep(JOB_ID, 99)).toBe(false);

    const running = await repo.updateOffboardingJobState(JOB_ID, "running");
    expect(running?.state).toBe("running");
    expect((await repo.listOffboardingJobs(TENANT_ID)).map((entry) => entry.id)).toEqual([JOB_ID]);

    repo.close();
  });

  it("reopens an existing database with its steps intact", async () => {
    const filename = tempDbPath();
    await seedTenant(filename);

    const first = await openSqliteOffboardingRepository({ filename });
    await first.createOffboardingJob({
      id: JOB_ID,
      tenantId: TENANT_ID,
      userIds: [USER_ID],
      options: {},
      createdBy: "operator-1",
      steps: [{ order: 1, action: "disable-sign-in", state: "succeeded" }],
    });
    first.close();

    const second = await openSqliteOffboardingRepository({ filename });
    const steps = await second.listOffboardingSteps(JOB_ID);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.state).toBe("succeeded");
    second.close();
  });
});
