import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  InvalidRunStatusError,
  VALID_RUN_STATUSES,
  type AuditEventInput,
  type FindingInput,
  type RunInput,
  type RunStatus,
  type TenantInput,
} from "./repository.js";
import { openSqliteRepository } from "./sqlite-repository.js";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

const tempDirs: string[] = [];

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "m365-runs-"));
  tempDirs.push(dir);
  return join(dir, "portal.db");
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

function tenant(id: string, extra: Partial<TenantInput> = {}): TenantInput {
  return {
    id,
    displayName: `Tenant ${id.slice(0, 4)}`,
    defaultDomain: null,
    initialDomain: null,
    source: "direct",
    status: "active",
    excluded: false,
    lastRunAt: null,
    errorCount: 0,
    ...extra,
  };
}

function runInput(id: string, tenantId: string, extra: Partial<RunInput> = {}): RunInput {
  return {
    id,
    tenantId,
    parentRunId: null,
    trigger: "manual",
    sections: ["Identity", "Security"],
    options: { quickScan: false, skipPurview: true },
    startedAt: null,
    finishedAt: null,
    status: "queued",
    artifactPath: null,
    summaryCounts: { pass: 10, fail: 2 },
    provenance: null,
    ...extra,
  };
}

describe("migration 0003 (T-0041)", () => {
  it("applies after earlier migrations, is re-runnable, and advances SchemaVersion", async () => {
    const filename = tempDbPath();
    const first = await openSqliteRepository({ filename });
    expect(first.schemaVersion).toBeGreaterThanOrEqual(3);
    first.close();

    const raw = new Database(filename);
    const versions = (
      raw.prepare("SELECT version FROM schema_versions").all() as Array<{ version: number }>
    ).map((r) => r.version);
    expect(versions).toContain(3);

    const cols = (
      raw.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(cols).toContain("parentRunId");
    expect(cols).toContain("options");

    const indices = (
      raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{
        name: string;
      }>
    ).map((i) => i.name);
    expect(indices).toContain("idx_runs_parentRunId");
    raw.close();

    const second = await openSqliteRepository({ filename });
    expect(second.schemaVersion).toBe(first.schemaVersion);
    second.close();
  });
});

describe("Parent/child runs (T-0041)", () => {
  it("creates a parent run with child runs and resolves children by parentRunId", async () => {
    const repo = await openSqliteRepository({ filename: tempDbPath() });
    await repo.upsertTenant(tenant(TENANT_A));
    await repo.upsertTenant(tenant(TENANT_B));

    const parent = runInput("parent-001", TENANT_A, {
      options: { bulk: true, timeoutMinutes: 60 },
      summaryCounts: { tenants: 2 },
    });
    const child1 = runInput("child-001", TENANT_A, {
      sections: ["Identity"],
    });
    const child2 = runInput("child-002", TENANT_B, {
      sections: ["Security"],
    });

    const result = await repo.createRunWithChildren(parent, [child1, child2]);
    expect(result.parent.id).toBe("parent-001");
    expect(result.parent.parentRunId).toBeNull();
    expect(result.parent.options).toEqual({ bulk: true, timeoutMinutes: 60 });
    expect(result.children).toHaveLength(2);
    expect(result.children[0].parentRunId).toBe("parent-001");
    expect(result.children[1].parentRunId).toBe("parent-001");

    const children = await repo.listChildRuns("parent-001");
    expect(children).toHaveLength(2);
    expect(children.map((c) => c.id).sort()).toEqual(["child-001", "child-002"]);

    const aliasChildren = await repo.listRunsByParentId("parent-001");
    expect(aliasChildren).toHaveLength(2);

    const retrievedParent = await repo.getRunById("parent-001");
    expect(retrievedParent).toBeDefined();
    expect(retrievedParent?.id).toBe("parent-001");

    const retrievedChild = await repo.getRunById("child-001");
    expect(retrievedChild).toBeDefined();
    expect(retrievedChild?.parentRunId).toBe("parent-001");

    repo.close();
  });
});

describe("Run status taxonomy constraint (T-0041)", () => {
  it("accepts all six valid statuses in the taxonomy", async () => {
    const repo = await openSqliteRepository({ filename: tempDbPath() });
    await repo.upsertTenant(tenant(TENANT_A));

    for (const [idx, status] of VALID_RUN_STATUSES.entries()) {
      const id = `run-${idx}-${status}`;
      const created = await repo.createRun(runInput(id, TENANT_A, { status }));
      expect(created.status).toBe(status);

      const updated = await repo.updateRun(TENANT_A, id, {
        status: status === "queued" ? "running" : status,
      });
      expect(updated?.status).toBe(status === "queued" ? "running" : status);
    }

    repo.close();
  });

  it("rejects an unknown status in createRun and updateRun", async () => {
    const repo = await openSqliteRepository({ filename: tempDbPath() });
    await repo.upsertTenant(tenant(TENANT_A));

    await expect(
      repo.createRun(runInput("invalid-run", TENANT_A, { status: "unknown_status" as RunStatus })),
    ).rejects.toThrow(InvalidRunStatusError);

    const validRun = await repo.createRun(runInput("valid-run", TENANT_A, { status: "queued" }));
    expect(validRun.status).toBe("queued");

    await expect(
      repo.updateRun(TENANT_A, "valid-run", { status: "bogus_status" as RunStatus }),
    ).rejects.toThrow(InvalidRunStatusError);

    repo.close();
  });

  it("rejects an unknown status at the database layer via SQL trigger", async () => {
    const filename = tempDbPath();
    const repo = await openSqliteRepository({ filename });
    await repo.upsertTenant(tenant(TENANT_A));
    repo.close();

    const raw = new Database(filename);
    expect(() =>
      raw
        .prepare(
          `INSERT INTO runs (id, tenantId, trigger, sections, status, createdAt, updatedAt)
           VALUES ('raw-invalid', ?, 'manual', '[]', 'not_a_valid_status', datetime('now'), datetime('now'))`,
        )
        .run(TENANT_A),
    ).toThrow(/invalid run status/);

    raw
      .prepare(
        `INSERT INTO runs (id, tenantId, trigger, sections, status, createdAt, updatedAt)
         VALUES ('raw-valid', ?, 'manual', '[]', 'queued', datetime('now'), datetime('now'))`,
      )
      .run(TENANT_A);

    expect(() =>
      raw.prepare(`UPDATE runs SET status = 'bad_state' WHERE id = 'raw-valid'`).run(),
    ).toThrow(/invalid run status/);

    raw.close();
  });
});

describe("Retention window enforcement (T-0041)", () => {
  it("prunes runs older than configured window and keeps audit rows", async () => {
    const filename = tempDbPath();
    const repo = await openSqliteRepository({ filename });
    await repo.upsertTenant(tenant(TENANT_A));

    const now = Date.now();
    const oldTimestamp = new Date(now - 45 * 86400 * 1000).toISOString();
    const newTimestamp = new Date(now - 5 * 86400 * 1000).toISOString();

    // 1. Create old run and old audit event
    const oldRun = await repo.createRun(
      runInput("old-run-1", TENANT_A, {
        status: "succeeded",
        createdAt: oldTimestamp,
        updatedAt: oldTimestamp,
        finishedAt: oldTimestamp,
      }),
    );
    await repo.createRunSection({
      id: "old-section-1",
      runId: "old-run-1",
      tenantId: TENANT_A,
      section: "Identity",
      collector: "Graph",
      status: "Pass",
      startedAt: oldTimestamp,
      finishedAt: oldTimestamp,
      createdAt: oldTimestamp,
      updatedAt: oldTimestamp,
    });
    await repo.createFinding({
      id: "old-finding-1",
      runId: "old-run-1",
      tenantId: TENANT_A,
      checkId: "CHK-001",
      controlName: "MFA Check",
      category: "Identity",
      collector: "Graph",
      status: "Pass",
      severity: "High",
      currentValue: "Enforced",
      recommendedValue: "Enforced",
      evidence: null,
      frameworkRefs: [],
      remediationMode: null,
      createdAt: oldTimestamp,
      updatedAt: oldTimestamp,
    });

    const oldAudit: AuditEventInput = {
      id: "old-audit-1",
      timestamp: oldTimestamp,
      actorUserId: "user-1",
      actorType: "user",
      tenantId: TENANT_A,
      action: "run.create",
      targetType: "run",
      targetId: "old-run-1",
      before: null,
      after: { id: "old-run-1" },
      result: "success",
      error: null,
      source: "request",
      correlationId: "corr-old",
    };
    await repo.appendAuditEvent(oldAudit);

    // 2. Create new run and new audit event
    const newRun = await repo.createRun(
      runInput("new-run-1", TENANT_A, {
        status: "succeeded",
        createdAt: newTimestamp,
        updatedAt: newTimestamp,
        finishedAt: newTimestamp,
      }),
    );
    const newAudit: AuditEventInput = {
      id: "new-audit-1",
      timestamp: newTimestamp,
      actorUserId: "user-1",
      actorType: "user",
      tenantId: TENANT_A,
      action: "run.create",
      targetType: "run",
      targetId: "new-run-1",
      before: null,
      after: { id: "new-run-1" },
      result: "success",
      error: null,
      source: "request",
      correlationId: "corr-new",
    };
    await repo.appendAuditEvent(newAudit);

    // 3. Enforce 30-day retention window
    const retentionResult = await repo.enforceRetention({ retentionDays: 30 });
    expect(retentionResult.prunedRunsCount).toBeGreaterThanOrEqual(1);

    // 4. Old run and its child records are pruned
    expect(await repo.getRun(TENANT_A, oldRun.id)).toBeUndefined();
    expect(await repo.listRunSections(TENANT_A, oldRun.id)).toHaveLength(0);
    expect(await repo.listFindings(TENANT_A, oldRun.id)).toHaveLength(0);

    // 5. New run remains intact
    expect(await repo.getRun(TENANT_A, newRun.id)).toBeDefined();

    // 6. Audit rows MUST be kept (both old and new audit events remain)
    const auditEvents = await repo.listAuditEvents(TENANT_A);
    const auditIds = auditEvents.map((a) => a.id);
    expect(auditIds).toContain("old-audit-1");
    expect(auditIds).toContain("new-audit-1");

    repo.close();
  });
});

describe("Replacing a run's findings (T-0833)", () => {
  function finding(id: string, runId: string, tenantId: string, checkId: string): FindingInput {
    return {
      id,
      runId,
      tenantId,
      checkId,
      controlName: null,
      category: null,
      collector: null,
      status: "Pass",
      severity: null,
      currentValue: null,
      recommendedValue: null,
      evidence: null,
      frameworkRefs: ["cis-m365-v6"],
      remediationMode: null,
    };
  }

  it("swaps the run's findings in insertion order and leaves other runs alone", async () => {
    const repo = await openSqliteRepository({ filename: tempDbPath() });
    await repo.upsertTenant(tenant(TENANT_A));
    await repo.createRun(runInput("run-1", TENANT_A));
    await repo.createRun(runInput("run-2", TENANT_A));
    await repo.createFinding(finding("other", "run-2", TENANT_A, "KEEP-001.1"));

    await repo.replaceRunFindings(TENANT_A, "run-1", [finding("a", "run-1", TENANT_A, "A-001.1")]);
    const replaced = await repo.replaceRunFindings(TENANT_A, "run-1", [
      finding("c", "run-1", TENANT_A, "C-001.1"),
      finding("b", "run-1", TENANT_A, "B-001.1"),
    ]);

    expect(replaced.map((f) => f.id)).toEqual(["c", "b"]);
    expect(replaced[0]!.frameworkRefs).toEqual(["cis-m365-v6"]);
    expect((await repo.listFindings(TENANT_A, "run-2")).map((f) => f.id)).toEqual(["other"]);
    repo.close();
  });

  it("refuses findings for another run and keeps the existing ones", async () => {
    const repo = await openSqliteRepository({ filename: tempDbPath() });
    await repo.upsertTenant(tenant(TENANT_A));
    await repo.createRun(runInput("run-1", TENANT_A));
    await repo.replaceRunFindings(TENANT_A, "run-1", [finding("a", "run-1", TENANT_A, "A-001.1")]);

    await expect(
      repo.replaceRunFindings(TENANT_A, "run-1", [finding("x", "run-9", TENANT_A, "X-001.1")]),
    ).rejects.toThrow(/does not belong/);
    expect((await repo.listFindings(TENANT_A, "run-1")).map((f) => f.id)).toEqual(["a"]);
    repo.close();
  });
});
