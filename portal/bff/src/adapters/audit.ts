// Audit sink (T-0820): routes hand over the audit events their workers return; this
// records them in the append-only audit_events table (0001_init) through the db
// repository. Worker events carry { id, tenantId, action, targetId, targetName, actor,
// timestamp, before, after }; route-built events carry actorUserId and createdAt instead.
// Anything missing gets a safe default.
import type { SqliteRepository } from "@m365-assess/db";

export type RecordAudit = (event: Record<string, unknown>) => Promise<void>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function createAuditSink(repo: SqliteRepository): RecordAudit {
  return async (event) => {
    await repo.appendAuditEvent({
      id: text(event["id"]) ?? globalThis.crypto.randomUUID(),
      timestamp: text(event["timestamp"]) ?? text(event["createdAt"]) ?? new Date().toISOString(),
      actorUserId: text(event["actor"]) ?? text(event["actorUserId"]),
      actorType: "user",
      tenantId: text(event["tenantId"]),
      action: text(event["action"]) ?? "worker.write",
      targetType: text(event["targetType"]) ?? text(event["kind"]),
      targetId: text(event["targetId"]),
      before: object(event["before"]),
      after: object(event["after"]),
      result: event["result"] === "failure" ? "failure" : "success",
      error: text(event["error"]),
      source: "request",
      correlationId: text(event["correlationId"]),
    });
  };
}
