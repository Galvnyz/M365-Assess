// T-0162 — DriftDeviation entity and triage-state-preserving upsert.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openSqliteDriftRepository } from "./drift-repository.js";

const TENANT_1 = "11111111-1111-1111-1111-111111111111";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "m365-drift-dev-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

async function openRepo(dir: string) {
  return openSqliteDriftRepository({
    filename: join(dir, "portal.db"),
    // The registry is not needed for deviation storage, but the opener requires a path.
    registryPath: join(dir, "registry.json"),
  });
}

const CA = "CA-REPORTONLY-001";

describe("upsertDeviations (T-0162)", () => {
  it("inserts by the triage key and does not duplicate across re-runs", async () => {
    const dir = tempDir();
    const repo = await openRepo(dir);
    try {
      const first = await repo.upsertDeviations(TENANT_1, [
        { standardKey: CA, resourceId: "policy-1", kind: "mismatch", current: { state: "disabled" }, expected: { state: "enabled" } },
      ]);
      expect(first.inserted).toBe(1);

      // Re-running with a changed current value updates the same row.
      const second = await repo.upsertDeviations(TENANT_1, [
        { standardKey: CA, resourceId: "policy-1", kind: "mismatch", current: { state: "reportOnly" }, expected: { state: "enabled" } },
      ]);
      expect(second.updated).toBe(1);
      expect(second.inserted).toBe(0);

      const all = await repo.listDeviations(TENANT_1);
      expect(all).toHaveLength(1);
      expect(all[0]!.current).toEqual({ state: "reportOnly" });
      expect(all[0]!.state).toBe("open");
    } finally {
      repo.close();
    }
  });

  it("keys extras by resourceId so different policies stay distinct", async () => {
    const dir = tempDir();
    const repo = await openRepo(dir);
    try {
      const result = await repo.upsertDeviations(TENANT_1, [
        { standardKey: CA, resourceId: "policy-a", kind: "extra", current: { present: true }, expected: null },
        { standardKey: CA, resourceId: "policy-b", kind: "extra", current: { present: true }, expected: null },
      ]);
      expect(result.inserted).toBe(2);
      expect(await repo.listDeviations(TENANT_1)).toHaveLength(2);
    } finally {
      repo.close();
    }
  });

  it("preserves accepted/customerSpecific/denied state and reason across upserts", async () => {
    const dir = tempDir();
    const repo = await openRepo(dir);
    try {
      await repo.upsertDeviations(TENANT_1, [
        { standardKey: CA, resourceId: "p1", kind: "mismatch", current: 1, expected: 2 },
        { standardKey: CA, resourceId: "p2", kind: "mismatch", current: 1, expected: 2 },
        { standardKey: CA, resourceId: "p3", kind: "mismatch", current: 1, expected: 2 },
      ]);

      await repo.setDeviationTriage(TENANT_1, CA, "p1", {
        state: "accepted",
        reason: "business exception",
        expiresOn: "2026-06-01",
        autoRemediateOnExpiry: true,
      });
      await repo.setDeviationTriage(TENANT_1, CA, "p2", {
        state: "customerSpecific",
        reason: "tenant uses a different baseline",
        overrideValue: { state: "reportOnly" },
      });
      await repo.setDeviationTriage(TENANT_1, CA, "p3", { state: "denied", reason: "duplicate" });

      // A new run reports all three with changed current values.
      const result = await repo.upsertDeviations(TENANT_1, [
        { standardKey: CA, resourceId: "p1", kind: "mismatch", current: 9, expected: 2 },
        { standardKey: CA, resourceId: "p2", kind: "mismatch", current: 9, expected: 2 },
        { standardKey: CA, resourceId: "p3", kind: "mismatch", current: 9, expected: 2 },
      ]);

      expect(result.preserved).toBe(3);
      expect(result.updated).toBe(0);

      const p1 = await repo.getDeviation(TENANT_1, CA, "p1");
      expect(p1).toMatchObject({
        state: "accepted",
        reason: "business exception",
        expiresOn: "2026-06-01",
        autoRemediateOnExpiry: true,
        current: 9,
      });

      const p2 = await repo.getDeviation(TENANT_1, CA, "p2");
      expect(p2).toMatchObject({
        state: "customerSpecific",
        reason: "tenant uses a different baseline",
        overrideValue: { state: "reportOnly" },
        current: 9,
      });

      const p3 = await repo.getDeviation(TENANT_1, CA, "p3");
      expect(p3).toMatchObject({ state: "denied", reason: "duplicate", current: 9 });
    } finally {
      repo.close();
    }
  });

  it("reopens a resolved deviation on the next run", async () => {
    const dir = tempDir();
    const repo = await openRepo(dir);
    try {
      await repo.upsertDeviations(TENANT_1, [
        { standardKey: CA, resourceId: "p1", kind: "mismatch", current: 1, expected: 2 },
      ]);
      await repo.setDeviationTriage(TENANT_1, CA, "p1", { state: "resolved", reason: "remediated" });

      const result = await repo.upsertDeviations(TENANT_1, [
        { standardKey: CA, resourceId: "p1", kind: "mismatch", current: 1, expected: 2 },
      ]);
      // A resolved row is not "settled", so the new sighting reopens it.
      expect(result.updated).toBe(1);
      expect(await repo.getDeviation(TENANT_1, CA, "p1")).toMatchObject({ state: "open", reason: null });
    } finally {
      repo.close();
    }
  });

  it("filters deviations by state and kind", async () => {
    const dir = tempDir();
    const repo = await openRepo(dir);
    try {
      await repo.upsertDeviations(TENANT_1, [
        { standardKey: CA, resourceId: "p1", kind: "mismatch", current: 1, expected: 2 },
        { standardKey: CA, resourceId: "extra-1", kind: "extra", current: 1, expected: null },
      ]);
      await repo.setDeviationTriage(TENANT_1, CA, "p1", { state: "accepted", reason: "ok" });

      expect((await repo.listDeviations(TENANT_1, { state: "accepted" })).map((d) => d.resourceId)).toEqual(["p1"]);
      expect((await repo.listDeviations(TENANT_1, { kind: "extra" })).map((d) => d.resourceId)).toEqual(["extra-1"]);
    } finally {
      repo.close();
    }
  });
});

describe("deviation state constraint (T-0162)", () => {
  it("rejects an unknown state", async () => {
    const dir = tempDir();
    const repo = await openRepo(dir);
    try {
      await repo.upsertDeviations(TENANT_1, [
        { standardKey: CA, resourceId: "p1", kind: "mismatch", current: 1, expected: 2 },
      ]);
      await expect(
        // Cast past the type system: the DB CHECK constraint must still reject it.
        repo.setDeviationTriage(TENANT_1, CA, "p1", { state: "bogus" as never }),
      ).rejects.toThrow(/CHECK constraint/i);
    } finally {
      repo.close();
    }
  });

  it("returns undefined when triaging a deviation that does not exist", async () => {
    const dir = tempDir();
    const repo = await openRepo(dir);
    try {
      expect(await repo.setDeviationTriage(TENANT_1, CA, "missing", { state: "accepted" })).toBeUndefined();
    } finally {
      repo.close();
    }
  });
});
