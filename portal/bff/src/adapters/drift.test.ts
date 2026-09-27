import { DEFAULT_STANDARDS_REGISTRY_PATH, SqliteDriftRepository, loadMigrations, runMigrations } from "@m365-assess/db";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { DRIFT_BULK_PATH } from "../routes/drift-bulk.js";
import { DRIFT_DENY_PATH } from "../routes/drift-deny.js";
import type { RequestContext, Route } from "../server.js";
import { JOB_DISPATCH_UNAVAILABLE } from "./automation.js";
import {
  createDriftStore,
  createDriftTriageStore,
  createUnavailableDriftDeletion,
  createUnavailableDriftRefresh,
  refuseDriftDeletion,
} from "./drift.js";

async function setup() {
  const db = new Database(":memory:");
  const repo = new SqliteDriftRepository(db, runMigrations(db, loadMigrations()), DEFAULT_STANDARDS_REGISTRY_PATH);
  await repo.upsertDeviations("t-a", [{ standardKey: "CA-1", resourceId: "p-1", kind: "mismatch", current: 1, expected: 2 }]);
  await repo.upsertDeviations("t-b", [{ standardKey: "CA-1", resourceId: "p-2", kind: "extra", current: 1, expected: null }]);
  return repo;
}

describe("drift adapters (T-0825)", () => {
  it("lists deviations per tenant and across tenants", async () => {
    const store = createDriftStore(await setup());
    expect(await store.listDeviations("t-a")).toHaveLength(1);
    expect(await store.listDeviations("t-b", { kind: "mismatch" })).toEqual([]);
    expect((await store.listAllDeviations!()).map((d) => d.tenantId)).toEqual(["t-a", "t-b"]);
  });

  it("applies triage by deviation id", async () => {
    const repo = await setup();
    const store = createDriftTriageStore(repo);
    const [row] = await repo.listDeviations("t-a");
    expect(await store.getDeviationById(row!.id)).toMatchObject({ tenantId: "t-a", state: "open" });
    const accepted = await store.applyTriageByDeviationId(row!.id, {
      state: "accepted",
      reason: "known",
      expiresOn: "2027-01-01T00:00:00.000Z",
      autoRemediateOnExpiry: false,
      overrideValue: null,
    });
    expect(accepted).toMatchObject({ id: row!.id, state: "accepted", reason: "known" });
    expect(await store.applyTriageByDeviationId("missing", { state: "accepted", reason: null, expiresOn: null, autoRemediateOnExpiry: false, overrideValue: null })).toBeUndefined();
  });

  it("refuses refresh and deletion with 501", async () => {
    await expect(createUnavailableDriftRefresh().refresh("t-a")).rejects.toMatchObject({ code: JOB_DISPATCH_UNAVAILABLE, status: 501 });
    await expect(createUnavailableDriftDeletion().queueDeletion({} as never)).rejects.toMatchObject({ status: 501 });
  });

  it("refuses deny and bulk deny-delete before the route runs, after authorizing", async () => {
    let ran = 0;
    let authorized = 0;
    const route = (path: string): Route => ({ method: "POST", path, handler: () => ((ran += 1), { status: 200, body: null }) });
    const ctx = (body: unknown) => ({ body }) as unknown as RequestContext;
    const authorize = () => {
      authorized += 1;
    };

    expect(() => refuseDriftDeletion(route(DRIFT_DENY_PATH), authorize).handler(ctx({ reason: "x", confirm: true }))).toThrow(
      expect.objectContaining({ status: 501 }),
    );
    const bulk = refuseDriftDeletion(route(DRIFT_BULK_PATH), authorize);
    expect(() => bulk.handler(ctx({ action: "deny-delete" }))).toThrow(expect.objectContaining({ status: 501 }));
    expect(authorized).toBe(2);
    expect(ran).toBe(0);

    await bulk.handler(ctx({ action: "accept" }));
    await bulk.handler(ctx({ action: "deny-remediate" }));
    expect(ran).toBe(2);
  });
});
