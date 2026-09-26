// T-0149 — standards system timer: dedupe, single-flight, change-detection.
import { describe, expect, it } from "vitest";
import {
  STANDARDS_DEDUPE_WINDOW_MS,
  STANDARDS_SCHEDULE_ID,
  STANDARDS_TRIGGER,
  buildStandardsEnvelope,
  createMemoryStandardsDedupeStore,
  runStandardsTimer,
  standardsWindowStart,
  type StandardsTimerIds,
  type StandardsTimerOptions,
} from "./standards-timer.js";
import {
  computeConfigFingerprint,
  createMemoryChangeDetectionStore,
  detectChanges,
  type ConfigItem,
} from "./change-detection.js";

const TENANT_1 = "11111111-1111-1111-1111-111111111111";
const TENANT_2 = "22222222-2222-2222-2222-222222222222";

function ids(): StandardsTimerIds {
  return { jobId: "job-1", runId: "run-1", requestId: "req-1", correlationId: "corr-1" };
}

function collectEnvelopes() {
  const envelopes: Array<{ tenantId: string; trigger: string; jobType: string }> = [];
  return {
    envelopes,
    queue: {
      async enqueue(envelope: unknown) {
        const e = envelope as { tenantId: string; trigger: string; jobType: string };
        envelopes.push({ tenantId: e.tenantId, trigger: e.trigger, jobType: e.jobType });
        return "enqueued";
      },
    },
  };
}

function baseOptions(
  tenantIds: string[],
  overrides: Partial<StandardsTimerOptions> = {},
): StandardsTimerOptions {
  return {
    queue: collectEnvelopes().queue,
    tenants: { listTenants: async () => tenantIds.map((id) => ({ id })) },
    dedupe: createMemoryStandardsDedupeStore(),
    isRunning: () => false,
    newIds: ids,
    now: new Date("2026-01-01T05:00:00.000Z"),
    ...overrides,
  };
}

describe("standardsWindowStart (T-0149)", () => {
  it("aligns to 12 h windows", () => {
    expect(STANDARDS_DEDUPE_WINDOW_MS).toBe(12 * 60 * 60 * 1000);
    const start = standardsWindowStart(new Date("2026-01-01T13:37:00.000Z"));
    expect(start.toISOString()).toBe("2026-01-01T12:00:00.000Z");
    // Two instants inside the same window share the start.
    expect(standardsWindowStart(new Date("2026-01-01T23:59:00.000Z")).toISOString()).toBe(
      "2026-01-01T12:00:00.000Z",
    );
    expect(standardsWindowStart(new Date("2026-01-02T00:01:00.000Z")).toISOString()).toBe(
      "2026-01-02T00:00:00.000Z",
    );
  });
});

describe("buildStandardsEnvelope", () => {
  it("marks the job trigger as schedule with the system schedule id", () => {
    const envelope = buildStandardsEnvelope(TENANT_1, new Date("2026-01-01T05:00:00.000Z"), ids());
    expect(envelope.jobType).toBe("standards");
    expect(envelope.trigger).toBe(STANDARDS_TRIGGER);
    expect(envelope.scheduleId).toBe(STANDARDS_SCHEDULE_ID);
    expect(envelope.tenantId).toBe(TENANT_1);
    expect(envelope.payload.credentialRef).toBe(`tenants/${TENANT_1}/credential`);
  });
});

describe("runStandardsTimer", () => {
  it("enqueues one job per tenant with trigger: schedule", async () => {
    const { envelopes, queue } = collectEnvelopes();
    const result = await runStandardsTimer(baseOptions([TENANT_1, TENANT_2], { queue }));

    expect(result.enqueued).toEqual([TENANT_1, TENANT_2]);
    expect(envelopes).toHaveLength(2);
    expect(envelopes.every((e) => e.trigger === "schedule")).toBe(true);
    expect(envelopes.every((e) => e.jobType === "standards")).toBe(true);
  });

  it("does not enqueue a tenant twice within the same 12 h window", async () => {
    const { envelopes, queue } = collectEnvelopes();
    const dedupe = createMemoryStandardsDedupeStore();
    const now = new Date("2026-01-01T05:00:00.000Z");

    const first = await runStandardsTimer(baseOptions([TENANT_1], { queue, dedupe, now }));
    expect(first.enqueued).toEqual([TENANT_1]);

    // A second tick inside the same window is deduped.
    const second = await runStandardsTimer(
      baseOptions([TENANT_1], { queue, dedupe, now: new Date("2026-01-01T06:30:00.000Z") }),
    );
    expect(second.enqueued).toEqual([]);
    expect(second.skippedDeduped).toEqual([TENANT_1]);
    expect(envelopes).toHaveLength(1);

    // A tick in the next window enqueues again.
    const third = await runStandardsTimer(
      baseOptions([TENANT_1], { queue, dedupe, now: new Date("2026-01-01T13:00:00.000Z") }),
    );
    expect(third.enqueued).toEqual([TENANT_1]);
    expect(envelopes).toHaveLength(2);
  });

  it("skips a tenant with a run in flight (single-flight)", async () => {
    const { envelopes, queue } = collectEnvelopes();
    const result = await runStandardsTimer(
      baseOptions([TENANT_1, TENANT_2], {
        queue,
        isRunning: (tenantId) => tenantId === TENANT_1,
      }),
    );
    expect(result.skippedRunning).toEqual([TENANT_1]);
    expect(result.enqueued).toEqual([TENANT_2]);
    expect(envelopes.map((e) => e.tenantId)).toEqual([TENANT_2]);
  });

  it("is a no-op when the tenant's config is unchanged, and re-evaluates on change", async () => {
    const { envelopes, queue } = collectEnvelopes();
    const changeDetection = createMemoryChangeDetectionStore();

    let config: ConfigItem[] = [
      { cacheKey: "ca-policy-1", configType: "conditional-access", config: { state: "enabled" } },
    ];
    const options = (now: Date): StandardsTimerOptions =>
      baseOptions([TENANT_1], {
        queue,
        changeDetection,
        collectConfig: async () => config,
        now,
      });

    // First run: nothing cached yet -> enqueued.
    const first = await runStandardsTimer(options(new Date("2026-01-01T01:00:00.000Z")));
    expect(first.enqueued).toEqual([TENANT_1]);

    // Different window, same config -> unchanged tenant is a no-op.
    const second = await runStandardsTimer(options(new Date("2026-01-01T13:00:00.000Z")));
    expect(second.enqueued).toEqual([]);
    expect(second.skippedUnchanged).toEqual([TENANT_1]);

    // Config changes -> the standard is re-evaluated.
    config = [{ cacheKey: "ca-policy-1", configType: "conditional-access", config: { state: "disabled" } }];
    const third = await runStandardsTimer(options(new Date("2026-01-02T01:00:00.000Z")));
    expect(third.enqueued).toEqual([TENANT_1]);
    expect(envelopes).toHaveLength(2);
  });

  it("records a per-tenant failure without aborting the tick", async () => {
    const queue = {
      async enqueue(envelope: unknown) {
        const e = envelope as { tenantId: string };
        if (e.tenantId === TENANT_1) throw new Error("queue down");
        return "ok";
      },
    };
    const result = await runStandardsTimer(baseOptions([TENANT_1, TENANT_2], { queue }));
    expect(result.failed).toEqual([{ tenantId: TENANT_1, error: "queue down" }]);
    expect(result.enqueued).toEqual([TENANT_2]);
  });
});

describe("change-detection", () => {
  it("fingerprints equal configs identically and detects a change", async () => {
    expect(computeConfigFingerprint({ a: 1, b: [2, 3] })).toBe(
      computeConfigFingerprint({ b: [2, 3], a: 1 }),
    );
    expect(computeConfigFingerprint({ a: 1 })).not.toBe(computeConfigFingerprint({ a: 2 }));

    const store = createMemoryChangeDetectionStore();
    const first = await detectChanges(store, {
      tenantId: TENANT_1,
      items: [{ cacheKey: "p1", configType: "intune", config: { x: 1 } }],
    });
    expect(first.changedKeys).toEqual(["p1"]);
    expect(first.allUnchanged).toBe(false);

    const second = await detectChanges(store, {
      tenantId: TENANT_1,
      items: [{ cacheKey: "p1", configType: "intune", config: { x: 1 } }],
    });
    expect(second.unchangedKeys).toEqual(["p1"]);
    expect(second.allUnchanged).toBe(true);
  });

  it("always re-evaluates a non-cacheable config type", async () => {
    const store = createMemoryChangeDetectionStore();
    const result = await detectChanges(store, {
      tenantId: TENANT_1,
      items: [{ cacheKey: "exo-1", configType: "exchange", config: { a: 1 } }],
    });
    expect(result.reEvaluatedKeys).toEqual(["exo-1"]);
    expect(result.allUnchanged).toBe(false);
  });

  it("treats a non-cacheable item alongside an unchanged cacheable item as not-all-unchanged", async () => {
    const store = createMemoryChangeDetectionStore();
    await detectChanges(store, {
      tenantId: TENANT_1,
      items: [{ cacheKey: "p1", configType: "intune", config: { x: 1 } }],
    });
    const result = await detectChanges(store, {
      tenantId: TENANT_1,
      items: [
        { cacheKey: "p1", configType: "intune", config: { x: 1 } },
        { cacheKey: "exo-1", configType: "exchange", config: { a: 1 } },
      ],
    });
    expect(result.unchangedKeys).toEqual(["p1"]);
    expect(result.reEvaluatedKeys).toEqual(["exo-1"]);
    expect(result.allUnchanged).toBe(false);
  });
});
