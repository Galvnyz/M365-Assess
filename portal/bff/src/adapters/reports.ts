// EPIC-004/005 dashboards and reports on real storage (T-0823).
//
// The dashboard, dashboard layout, and report template repositories already match
// their route stores. This file covers the generated-report store (the repository keys
// reports by tenant), the run reads the reports routes need, and the render ports.
//
// Report rendering is not built yet: nothing turns an executive payload or a template
// document into the HTML that render-report.ps1 prints to PDF (T-0835). The render
// ports therefore refuse with 501, marking any report already recorded as failed, so
// history never shows a report that will not arrive.
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { SqliteReportRepository, SqliteRepository } from "@m365-assess/db";
import type Database from "better-sqlite3";
import { AppError, ErrorCodes } from "../errors.js";
import type {
  ExecutiveRenderPayload,
  GeneratedReportStore,
  RenderQueuePort,
  RunReadPort,
  StoredGeneratedReport,
} from "../routes/reports.js";
import type { TemplateRenderPort } from "../routes/report-templates.js";

export const REPORT_RENDER_UNAVAILABLE = "report.render_unavailable";

const RENDER_UNAVAILABLE_MESSAGE =
  "report rendering is not available yet: no renderer builds report HTML for render-report.ps1";

type ReportRow = Awaited<ReturnType<SqliteReportRepository["getGeneratedReport"]>>;
type DbReportStatus = NonNullable<ReportRow>["status"];
type RouteReportStatus = StoredGeneratedReport["status"];

// The table names the render lifecycle queued/rendering/ready/failed; the route uses
// the run vocabulary. Cancelled has no column value and is kept as failed.
const TO_DB: Readonly<Record<RouteReportStatus, DbReportStatus>> = {
  queued: "queued",
  running: "rendering",
  succeeded: "ready",
  failed: "failed",
  cancelled: "failed",
};
const FROM_DB: Readonly<Record<DbReportStatus, RouteReportStatus>> = {
  queued: "queued",
  rendering: "running",
  ready: "succeeded",
  failed: "failed",
};

function toStored(report: NonNullable<ReportRow>): StoredGeneratedReport {
  return {
    id: report.id,
    templateId: report.templateId,
    tenantId: report.tenantId,
    status: FROM_DB[report.status],
    artifactRef: report.artifactRef,
    createdAt: report.createdAt,
    createdBy: report.createdBy,
    scheduleId: report.scheduleId,
  };
}

/**
 * Generated reports are stored per tenant, so a report with no tenant cannot be kept;
 * such requests are refused with a validation error.
 */
export function createGeneratedReportStore(
  reports: SqliteReportRepository,
  repo: SqliteRepository,
  db: Database.Database,
): GeneratedReportStore {
  const tenantOf = (id: string): string | undefined =>
    (db.prepare("SELECT tenantId FROM generated_reports WHERE id = ? AND deletedAt IS NULL").get(id) as
      | { tenantId: string }
      | undefined)?.tenantId;

  return {
    async create(input) {
      if (!input.tenantId) {
        throw new AppError(ErrorCodes.validationFailed, "tenantId is required to generate a report", 400, [
          { field: "tenantId", reason: "required" },
        ]);
      }
      const created = await reports.createGeneratedReport({
        id: input.id ?? globalThis.crypto.randomUUID(),
        templateId: input.templateId,
        tenantId: input.tenantId,
        status: TO_DB[input.status],
        artifactRef: input.artifactRef ?? null,
        createdBy: input.createdBy ?? "system",
        scheduleId: input.scheduleId ?? null,
      });
      return toStored(created);
    },
    async findById(id) {
      const tenantId = tenantOf(id);
      const report = tenantId ? await reports.getGeneratedReport(tenantId, id) : undefined;
      return report ? toStored(report) : undefined;
    },
    async list(options) {
      const tenantIds = options.tenantId ? [options.tenantId] : (await repo.listTenants()).map((t) => t.id);
      const lists = await Promise.all(tenantIds.map((id) => reports.listGeneratedReports(id)));
      return lists
        .flat()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(toStored);
    },
    async update(id, input) {
      const tenantId = tenantOf(id);
      if (!tenantId) return undefined;
      if (input.artifactRef !== undefined) {
        db.prepare("UPDATE generated_reports SET artifactRef = ?, updatedAt = ? WHERE id = ?").run(
          input.artifactRef,
          new Date().toISOString(),
          id,
        );
      }
      const updated = input.status
        ? await reports.updateGeneratedReportStatus(tenantId, id, TO_DB[input.status])
        : await reports.getGeneratedReport(tenantId, id);
      return updated ? toStored(updated) : undefined;
    },
  };
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html",
  ".json": "application/json",
  ".csv": "text/csv",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".log": "text/plain",
};

/** Run reads for the reports routes: the latest finished run and its artifacts. */
export function createReportRunReader(repo: SqliteRepository, artifactRoot: string): RunReadPort {
  return {
    async latestRunId(tenantId) {
      const finished = (await repo.listRuns(tenantId))
        .filter((run) => run.status === "succeeded" || run.status === "partial")
        .sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""));
      // A parent run only rolls up its per-tenant children; results live on the child.
      for (const run of finished) {
        if ((await repo.listRunsByParentId(run.id)).length === 0) return run.id;
      }
      return null;
    },
    async executivePayload(tenantId, runId): Promise<ExecutiveRenderPayload> {
      const [tenant, run] = await Promise.all([repo.getTenant(tenantId), repo.getRun(tenantId, runId)]);
      return {
        tenantId,
        runId,
        tenantFacts: tenant ? { displayName: tenant.displayName, defaultDomain: tenant.defaultDomain } : {},
        compliance: run?.summaryCounts ?? {},
        secureScore: {},
        actionBuckets: {},
      };
    },
    async runArtifacts(tenantId, runId) {
      const run = await repo.getRun(tenantId, runId);
      if (!run?.artifactPath) return [];
      const folder = path.resolve(artifactRoot, run.artifactPath);
      let entries: string[];
      try {
        entries = (await readdir(folder, { recursive: true })) as string[];
      } catch {
        return [];
      }
      const artifacts = [];
      for (const entry of entries.sort()) {
        const info = await stat(path.join(folder, entry));
        // context.json and result.json are the worker contract, not assessment output.
        if (!info.isFile() || entry === "context.json" || entry === "result.json") continue;
        artifacts.push({
          name: entry.split(path.sep).join("/"),
          contentType: CONTENT_TYPES[path.extname(entry).toLowerCase()] ?? "application/octet-stream",
          size: info.size,
          artifactRef: path.posix.join(run.artifactPath, entry.split(path.sep).join("/")),
        });
      }
      return artifacts;
    },
  };
}

function renderUnavailable(): AppError {
  return new AppError(REPORT_RENDER_UNAVAILABLE, RENDER_UNAVAILABLE_MESSAGE, 501);
}

/** Executive and custom renders: the report is already recorded, so it is failed first. */
export function createUnavailableRenderQueue(store: GeneratedReportStore): RenderQueuePort {
  return {
    async enqueue(jobId) {
      await store.update(jobId, { status: "failed" });
      throw renderUnavailable();
    },
  };
}

/** Template renders refuse before anything is recorded. */
export function createUnavailableTemplateRender(): TemplateRenderPort {
  return {
    async enqueue() {
      throw renderUnavailable();
    },
  };
}
