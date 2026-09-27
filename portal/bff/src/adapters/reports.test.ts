import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SqliteReportRepository, SqliteRepository, loadMigrations, runMigrations } from "@m365-assess/db";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  REPORT_RENDER_UNAVAILABLE,
  createGeneratedReportStore,
  createReportRunReader,
  createUnavailableRenderQueue,
  createUnavailableTemplateRender,
} from "./reports.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function setup() {
  const db = new Database(":memory:");
  const version = runMigrations(db, loadMigrations());
  const repo = new SqliteRepository(db, version, "memory");
  for (const id of ["t-a", "t-b"]) {
    await repo.upsertTenant({ id, displayName: `Tenant ${id}`, defaultDomain: `${id}.example`, initialDomain: null, source: "direct", status: "active", excluded: false, lastRunAt: null, errorCount: 0 });
  }
  const store = createGeneratedReportStore(new SqliteReportRepository(db, version, repo), repo, db);
  return { db, repo, store };
}

describe("generated report store (T-0823)", () => {
  it("round-trips reports, translating the render statuses", async () => {
    const { store } = await setup();
    const created = await store.create({ id: "r-1", templateId: null, tenantId: "t-a", status: "queued", createdBy: "user-1" });
    expect(created).toMatchObject({ id: "r-1", tenantId: "t-a", status: "queued", createdBy: "user-1" });

    expect(await store.update("r-1", { status: "running" })).toMatchObject({ status: "running" });
    expect(await store.update("r-1", { status: "succeeded", artifactRef: "reports/t-a/r-1.pdf" })).toMatchObject({
      status: "succeeded",
      artifactRef: "reports/t-a/r-1.pdf",
    });
    expect(await store.findById("r-1")).toMatchObject({ status: "succeeded" });
    expect(await store.findById("missing")).toBeUndefined();
    expect(await store.update("missing", { status: "failed" })).toBeUndefined();
  });

  it("lists one tenant's reports or every tenant's, newest first", async () => {
    const { store } = await setup();
    await store.create({ id: "r-a", templateId: null, tenantId: "t-a", status: "queued" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await store.create({ id: "r-b", templateId: null, tenantId: "t-b", status: "queued" });
    expect((await store.list({ tenantId: "t-a" })).map((r) => r.id)).toEqual(["r-a"]);
    expect((await store.list({})).map((r) => r.id)).toEqual(["r-b", "r-a"]);
  });

  it("refuses a report with no tenant, which the table cannot hold", async () => {
    const { store } = await setup();
    await expect(store.create({ templateId: "tpl", tenantId: null, status: "queued" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("report run reader (T-0823)", () => {
  it("finds the latest finished run and lists its artifacts", async () => {
    const { repo } = await setup();
    const root = mkdtempSync(path.join(tmpdir(), "m365-report-runs-"));
    dirs.push(root);
    const base = { tenantId: "t-a", parentRunId: null, trigger: "manual" as const, sections: [], options: null, startedAt: null, artifactPath: null, summaryCounts: null, provenance: null };
    await repo.createRun({ ...base, id: "old", status: "succeeded", finishedAt: "2026-09-01T00:00:00.000Z", artifactPath: "runs/t-a/old" });
    // A newer parent run is skipped: its results live on its child ("new").
    await repo.createRun({ ...base, id: "parent", status: "succeeded", finishedAt: "2026-09-21T00:00:00.000Z" });
    await repo.createRun({ ...base, parentRunId: "parent", id: "new", status: "partial", finishedAt: "2026-09-20T00:00:00.000Z", artifactPath: "runs/t-a/new", summaryCounts: { pass: 3 } });
    await repo.createRun({ ...base, id: "live", status: "running", finishedAt: null });

    const folder = path.join(root, "runs/t-a/new");
    mkdirSync(path.join(folder, "Assessment_2026"), { recursive: true });
    writeFileSync(path.join(folder, "Assessment_2026", "report.html"), "<html></html>");
    writeFileSync(path.join(folder, "result.json"), "{}");

    const reader = createReportRunReader(repo, root);
    expect(await reader.latestRunId("t-a")).toBe("new");
    expect(await reader.latestRunId("t-b")).toBeNull();
    expect(await reader.runArtifacts("t-a", "new")).toEqual([
      { name: "Assessment_2026/report.html", contentType: "text/html", size: 13, artifactRef: "runs/t-a/new/Assessment_2026/report.html" },
    ]);
    expect(await reader.executivePayload("t-a", "new")).toMatchObject({
      tenantFacts: { displayName: "Tenant t-a", defaultDomain: "t-a.example" },
      compliance: { pass: 3 },
    });
  });
});

describe("render ports (T-0823)", () => {
  it("fails an already-recorded report and refuses with 501", async () => {
    const { store } = await setup();
    await store.create({ id: "r-1", templateId: null, tenantId: "t-a", status: "queued" });
    await expect(createUnavailableRenderQueue(store).enqueue("r-1", {})).rejects.toMatchObject({ status: 501, code: REPORT_RENDER_UNAVAILABLE });
    expect(await store.findById("r-1")).toMatchObject({ status: "failed" });
  });

  it("refuses template renders before recording anything", async () => {
    await expect(
      createUnavailableTemplateRender().enqueue({ template: {}, templateId: "tpl", tenantId: "t-a", requestedBy: null, correlationId: "c" }),
    ).rejects.toMatchObject({ status: 501 });
  });
});
