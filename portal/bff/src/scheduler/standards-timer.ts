// Standards system timer (EPIC-008 SPEC.md §4.3, §9; T-0149).
//
// The code-deployed `standards` timer (EPIC-007, every 12 h) enqueues one
// standards job per tenant per 12 h window. Three guards keep scheduled
// enforcement safe:
//   1. single-flight per tenant (SPEC §9 "schedule overlap") — a tenant with a
//      run in flight is skipped;
//   2. a dedupe cache keyed to the 12 h window (CIPP RerunCache analogue) — a
//      tenant already enqueued in this window is not enqueued again;
//   3. change-detection (CIPP IntunePolicyTypeTracking analogue) — a tenant whose
//      cacheable config is unchanged is a no-op.
//
// Storage, queue, and tenant listing are injected seams, so this module stays
// free of SQL and the real queue.

import { randomUUID } from "node:crypto";
import { detectChanges, type ChangeDetectionStore, type ConfigItem } from "./change-detection.js";

export const STANDARDS_SYSTEM_TIMER_NAME = "standards";
export const STANDARDS_SCHEDULE_ID = "system-standards";
export const STANDARDS_TRIGGER = "schedule" as const;
export const STANDARDS_DEDUPE_WINDOW_MS = 12 * 60 * 60 * 1000;

/** Start of the 12 h window containing `now` (aligned to the epoch). */
export function standardsWindowStart(now: Date): Date {
  const ms = Math.floor(now.getTime() / STANDARDS_DEDUPE_WINDOW_MS) * STANDARDS_DEDUPE_WINDOW_MS;
  return new Date(ms);
}

// ─── Seams ───────────────────────────────────────────────────────────────────

export interface StandardsTenant {
  readonly id: string;
}

export interface StandardsTenantSource {
  listTenants(): Promise<readonly StandardsTenant[]>;
}

export interface StandardsQueue {
  enqueue(envelope: unknown): Promise<string>;
}

export interface StandardsDedupeStore {
  /** The window start the tenant was last enqueued in, if any. */
  getWindow(tenantId: string): Promise<string | undefined>;
  setWindow(tenantId: string, windowStart: string, enqueuedAt: string): Promise<void>;
}

export function createMemoryStandardsDedupeStore(): StandardsDedupeStore {
  const windows = new Map<string, string>();
  return {
    async getWindow(tenantId) {
      return windows.get(tenantId);
    },
    async setWindow(tenantId, windowStart) {
      windows.set(tenantId, windowStart);
    },
  };
}

export interface StandardsTimerIds {
  readonly jobId: string;
  readonly runId: string;
  readonly requestId: string;
  readonly correlationId: string;
}

export interface StandardsTimerOptions {
  readonly queue: StandardsQueue;
  readonly tenants: StandardsTenantSource;
  readonly dedupe: StandardsDedupeStore;
  readonly isRunning: (tenantId: string) => boolean | Promise<boolean>;
  /** Change-detection store; when omitted the guard is disabled. */
  readonly changeDetection?: ChangeDetectionStore;
  /** Collects a tenant's cacheable config for the change-detection guard. */
  readonly collectConfig?: (tenantId: string) => Promise<readonly ConfigItem[]>;
  readonly now?: Date;
  readonly newIds?: () => StandardsTimerIds;
}

export interface StandardsTimerResult {
  readonly windowStart: string;
  readonly enqueued: readonly string[];
  readonly skippedRunning: readonly string[];
  readonly skippedDeduped: readonly string[];
  readonly skippedUnchanged: readonly string[];
  readonly failed: readonly { readonly tenantId: string; readonly error: string }[];
}

// ─── Envelope ────────────────────────────────────────────────────────────────

export interface StandardsJobEnvelope {
  readonly schemaVersion: "v1";
  readonly jobId: string;
  readonly jobType: "standards";
  readonly tenantId: string;
  readonly runId: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly payload: {
    readonly contextRef: string;
    readonly outputRef: string;
    readonly credentialRef: string;
    readonly sectionRefs: readonly string[];
    readonly artifactRefs: readonly string[];
  };
  readonly trigger: typeof STANDARDS_TRIGGER;
  readonly scheduleId: string;
}

export function buildStandardsEnvelope(
  tenantId: string,
  now: Date,
  ids: StandardsTimerIds,
): StandardsJobEnvelope {
  return {
    schemaVersion: "v1",
    jobId: ids.jobId,
    jobType: "standards",
    tenantId,
    runId: ids.runId,
    requestId: ids.requestId,
    correlationId: ids.correlationId,
    createdAt: now.toISOString(),
    payload: {
      contextRef: `schedules/${STANDARDS_SCHEDULE_ID}/context.json`,
      outputRef: `schedules/${STANDARDS_SCHEDULE_ID}/${tenantId}/${ids.runId}`,
      credentialRef: `tenants/${tenantId}/credential`,
      sectionRefs: [],
      artifactRefs: [],
    },
    trigger: STANDARDS_TRIGGER,
    scheduleId: STANDARDS_SCHEDULE_ID,
  };
}

// ─── Timer ───────────────────────────────────────────────────────────────────

function defaultIds(): StandardsTimerIds {
  return {
    jobId: randomUUID(),
    runId: randomUUID(),
    requestId: randomUUID(),
    correlationId: randomUUID(),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runStandardsTimer(
  options: StandardsTimerOptions,
): Promise<StandardsTimerResult> {
  const now = options.now ?? new Date();
  const newIds = options.newIds ?? defaultIds;
  const windowStart = standardsWindowStart(now).toISOString();

  const enqueued: string[] = [];
  const skippedRunning: string[] = [];
  const skippedDeduped: string[] = [];
  const skippedUnchanged: string[] = [];
  const failed: { tenantId: string; error: string }[] = [];

  for (const tenant of await options.tenants.listTenants()) {
    // 1. Single-flight per tenant (SPEC §9).
    if (await options.isRunning(tenant.id)) {
      skippedRunning.push(tenant.id);
      continue;
    }

    // 2. Dedupe cache keyed to the 12 h window.
    const lastWindow = await options.dedupe.getWindow(tenant.id);
    if (lastWindow === windowStart) {
      skippedDeduped.push(tenant.id);
      continue;
    }

    try {
      // 3. Change-detection: an unchanged tenant is a no-op.
      if (options.changeDetection && options.collectConfig) {
        const items = await options.collectConfig(tenant.id);
        const changes = await detectChanges(options.changeDetection, {
          tenantId: tenant.id,
          items,
        });
        if (changes.allUnchanged) {
          // The window is still marked so the tenant is not reconsidered this
          // window; nothing is enqueued because nothing changed.
          await options.dedupe.setWindow(tenant.id, windowStart, now.toISOString());
          skippedUnchanged.push(tenant.id);
          continue;
        }
      }

      await options.queue.enqueue(buildStandardsEnvelope(tenant.id, now, newIds()));
      await options.dedupe.setWindow(tenant.id, windowStart, now.toISOString());
      enqueued.push(tenant.id);
    } catch (error) {
      failed.push({ tenantId: tenant.id, error: errorMessage(error) });
    }
  }

  return { windowStart, enqueued, skippedRunning, skippedDeduped, skippedUnchanged, failed };
}
