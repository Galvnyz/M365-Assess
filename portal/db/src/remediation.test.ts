import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  toManualInstructionView,
  toRemediationActionView,
  InvalidRemediationActionStateError,
  InvalidRemediationModeError,
  openSqliteRemediationRepository,
  type RemediationPlanInput,
} from "./remediation-repository.js";
import { openSqliteRepository } from "./sqlite-repository.js";

const TENANT_ID = "66666666-6666-6666-6666-666666666666";
const RUN_ID = "77777777-7777-7777-7777-777777777777";
const PLAN_ID = "88888888-8888-8888-8888-888888888888";

const tempDirs: string[] = [];

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "m365-remediation-"));
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

function planInput(extra: Partial<RemediationPlanInput> = {}): RemediationPlanInput {
  return {
    id: PLAN_ID,
    tenantId: TENANT_ID,
    runId: RUN_ID,
    findingIds: ["CA-REPORTONLY-001.1", "EXO-MAILBOX-007.1"],
    mode: "automated",
    createdBy: "operator-1",
    actions: [
      { id: "action-1", checkId: "CA-REPORTONLY-001", command: "Set-Place -Identity x" },
      { id: "action-2", checkId: "EXO-MAILBOX-007", command: "Set-Mailbox -Identity x", target: "mailbox-1" },
    ],
    ...extra,
  };
}

describe("remediation migration", () => {
  it("creates the SPEC §5 plan, action, and instruction columns", async () => {
    const filename = tempDbPath();
    const repo = await openSqliteRemediationRepository({ filename });
    expect(repo.schemaVersion).toBeGreaterThanOrEqual(51);
    repo.close();

    expect(columns(filename, "remediation_plans")).toEqual(
      expect.arrayContaining(["id", "tenantId", "runId", "findingIds", "mode", "createdAt", "createdBy"]),
    );
    expect(columns(filename, "remediation_actions")).toEqual(
      expect.arrayContaining([
        "id",
        "planId",
        "checkId",
        "command",
        "target",
        "state",
        "before",
        "after",
        "appliedAt",
        "appliedBy",
        "result",
        "error",
        "correlationId",
      ]),
    );
    expect(columns(filename, "manual_instructions")).toEqual(
      expect.arrayContaining(["checkId", "portalPath", "steps", "notes"]),
    );
  });
});

describe("remediation repository", () => {
  it("round-trips a plan with its actions and lists actions by plan and tenant", async () => {
    const filename = tempDbPath();
    await seedTenant(filename);

    const repo = await openSqliteRemediationRepository({ filename });
    const plan = await repo.createRemediationPlan(planInput());

    expect(plan.mode).toBe("automated");
    expect(plan.findingIds).toEqual(["CA-REPORTONLY-001.1", "EXO-MAILBOX-007.1"]);
    expect(plan.createdBy).toBe("operator-1");
    expect(plan.createdAt).toBeTruthy();

    const read = await repo.getRemediationPlan(PLAN_ID);
    expect(read).toEqual(plan);

    const byPlan = await repo.listRemediationActions(PLAN_ID);
    expect(byPlan.map((action) => action.id)).toEqual(["action-1", "action-2"]);
    expect(byPlan.every((action) => action.state === "planned")).toBe(true);
    expect(byPlan[1]?.target).toBe("mailbox-1");

    const byTenant = await repo.listRemediationActionsForTenant(TENANT_ID);
    expect(byTenant.map((action) => action.id)).toEqual(["action-1", "action-2"]);

    repo.close();
  });

  it("reads one action by id and presents actions and instructions with a check field", async () => {
    const filename = tempDbPath();
    await seedTenant(filename);

    const repo = await openSqliteRemediationRepository({ filename });
    await repo.createRemediationPlan(planInput());
    const action = await repo.getRemediationAction("action-2");
    expect(action?.target).toBe("mailbox-1");
    expect(await repo.getRemediationAction("missing")).toBeUndefined();

    const view = toRemediationActionView(action!);
    expect(view.check).toBe(action!.checkId);
    expect(view).not.toHaveProperty("checkId");
    const instruction = toManualInstructionView({ checkId: "EXO-1", portalPath: "p", steps: ["a"], notes: null });
    expect(instruction).toEqual({ check: "EXO-1", portalPath: "p", steps: ["a"], notes: null });
    repo.close();
  });

  it("records before/after/result/appliedAt on update and exposes no delete", async () => {
    const filename = tempDbPath();
    await seedTenant(filename);

    const repo = await openSqliteRemediationRepository({ filename });
    await repo.createRemediationPlan(planInput());

    const updated = await repo.updateRemediationAction("action-1", {
      state: "applied",
      before: { enabled: false },
      after: { enabled: true },
      result: { applied: true },
      appliedAt: "2026-01-01T00:00:00.000Z",
      appliedBy: "operator-1",
      correlationId: "corr-1",
    });
    expect(updated?.state).toBe("applied");
    expect(updated?.before).toEqual({ enabled: false });
    expect(updated?.after).toEqual({ enabled: true });
    expect(updated?.result).toEqual({ applied: true });
    expect(updated?.appliedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(updated?.appliedBy).toBe("operator-1");

    expect(await repo.updateRemediationAction("missing", { state: "applied" })).toBeUndefined();

    const raw = new Database(filename);
    try {
      expect(() =>
        raw.prepare("DELETE FROM remediation_actions WHERE id = ?").run("action-1"),
      ).toThrow();
    } finally {
      raw.close();
    }

    repo.close();
  });

  it("rejects an invalid plan mode and an invalid action state", async () => {
    const filename = tempDbPath();
    await seedTenant(filename);

    const repo = await openSqliteRemediationRepository({ filename });
    await expect(
      repo.createRemediationPlan(planInput({ mode: "wrong" as never })),
    ).rejects.toBeInstanceOf(InvalidRemediationModeError);

    await expect(
      repo.createRemediationPlan(
        planInput({ actions: [{ id: "action-1", checkId: "X", command: "y", state: "wrong" as never }] }),
      ),
    ).rejects.toBeInstanceOf(InvalidRemediationActionStateError);

    repo.close();
  });

  it("round-trips a manual instruction", async () => {
    const filename = tempDbPath();
    const repo = await openSqliteRemediationRepository({ filename });

    const instruction = await repo.upsertManualInstruction({
      checkId: "CA-REPORTONLY-001",
      portalPath: "security.microsoft.com > securescore",
      steps: ["security.microsoft.com", "Improvement actions"],
      notes: "Review and act on improvement actions.",
    });
    expect(instruction.portalPath).toBe("security.microsoft.com > securescore");
    expect(instruction.steps).toEqual(["security.microsoft.com", "Improvement actions"]);

    expect((await repo.getManualInstruction("CA-REPORTONLY-001"))?.notes).toBe(
      "Review and act on improvement actions.",
    );
    expect(await repo.listManualInstructions()).toHaveLength(1);

    repo.close();
  });
});
