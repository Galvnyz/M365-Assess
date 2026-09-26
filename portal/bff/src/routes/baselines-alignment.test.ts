// T-0809 — baseline alignment: stage progress and run events.
import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { type Caller } from "../rbac/authorize.js";
import { ALL_TENANTS, tenantScope } from "../rbac/scope.js";
import type { RequestContext } from "../server.js";
import {
  BASELINE_ALIGNMENT_OPENAPI,
  BASELINE_ALIGNMENT_PATH,
  buildStageProgress,
  createBaselinesAlignmentRoutes,
  type AlignmentStore,
  type BaselineAlignment,
} from "./baselines-alignment.js";
import type { BaselineRecord } from "./baselines.js";
import type { BaselineRollout } from "../domain/baseline-rollout.js";
import type { HistoryEvent, TrendPoint } from "../domain/baseline-history.js";

function baseline(): BaselineRecord {
  const now = new Date().toISOString();
  return {
    id: "bl-1",
    name: "Servers",
    logic: "and",
    alerting: { enabled: false },
    enabled: true,
    stages: [
      { order: 0, conditions: [{ key: "A", expected: 1 }], action: "report" },
      { order: 1, conditions: [{ key: "B", expected: 2 }], action: "remediate" },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

const ROLLOUTS: BaselineRollout[] = [
  { baselineId: "bl-1", tenantId: "contoso", stage: 0, state: "active", lastRunAt: "2026-09-26T00:00:00Z" },
  { baselineId: "bl-1", tenantId: "fabrikam", stage: 1, state: "eligible", lastRunAt: "2026-09-26T01:00:00Z" },
];

const EVENTS: HistoryEvent[] = [
  {
    id: "h2",
    baselineId: "bl-1",
    tenantId: "fabrikam",
    event: "stage.evaluated",
    detail: {},
    at: "2026-09-26T01:00:00Z",
  },
  {
    id: "h1",
    baselineId: "bl-1",
    tenantId: "contoso",
    event: "stage.evaluated",
    detail: {},
    at: "2026-09-26T00:00:00Z",
  },
];

const TREND: TrendPoint[] = [
  { baselineId: "bl-1", tenantId: "contoso", at: "2026-09-26T00:00:00Z", compliance: 0.5 },
];

class MemoryAlignmentStore implements AlignmentStore {
  async getBaseline(baselineId: string): Promise<BaselineRecord | undefined> {
    return baselineId === "bl-1" ? baseline() : undefined;
  }
  async listRollouts(): Promise<readonly BaselineRollout[]> {
    return ROLLOUTS;
  }
  async listHistory(_baselineId: string, limit: number): Promise<readonly HistoryEvent[]> {
    return EVENTS.slice(0, limit);
  }
  async listTrend(): Promise<readonly TrendPoint[]> {
    return TREND;
  }
}

function ctx(params: Record<string, string>, query: Record<string, string> = {}): RequestContext {
  return {
    method: "GET",
    path: BASELINE_ALIGNMENT_PATH,
    params,
    query: new Map(Object.entries(query)),
    headers: {},
    correlationId: "test-correlation",
  };
}

function setup(caller?: Caller) {
  const routes = createBaselinesAlignmentRoutes({
    store: new MemoryAlignmentStore(),
    resolveCaller: () => caller ?? ({ roles: ["admin"], tenantScope: ALL_TENANTS }) as Caller,
    authorize: () => {},
  });
  return routes[0]!.handler;
}

describe("stage progress (T-0809)", () => {
  it("aggregates rollout states per stage", () => {
    const progress = buildStageProgress(baseline(), ROLLOUTS);
    expect(progress).toEqual([
      { order: 0, action: "report", conditions: 1, tenants: 1, complete: 0, eligible: 0, active: 1 },
      { order: 1, action: "remediate", conditions: 1, tenants: 1, complete: 0, eligible: 1, active: 0 },
    ]);
  });
});

describe("GET /v1/baselines/:baselineId/alignment (T-0809)", () => {
  it("returns progress, run events newest-first, and trend points", async () => {
    const response = await setup()(ctx({ baselineId: "bl-1" }));
    expect(response.status).toBe(200);
    const alignment = response.body as BaselineAlignment;
    expect(alignment.stages).toHaveLength(2);
    expect(alignment.rollouts).toHaveLength(2);
    expect(alignment.runEvents.map((event) => event.id)).toEqual(["h2", "h1"]);
    expect(alignment.trend).toHaveLength(1);
  });

  it("honours the event limit and tenant filter", async () => {
    const limited = (await setup()(ctx({ baselineId: "bl-1" }, { limit: "1" }))).body as BaselineAlignment;
    expect(limited.runEvents).toHaveLength(1);
    const filtered = (await setup()(ctx({ baselineId: "bl-1" }, { tenantId: "contoso" }))).body as BaselineAlignment;
    expect(filtered.rollouts.map((rollout) => rollout.tenantId)).toEqual(["contoso"]);
  });

  it("excludes out-of-scope tenant rows", async () => {
    const scoped = { roles: ["admin"], tenantScope: tenantScope(["contoso"]) } as Caller;
    const alignment = (await setup(scoped)(ctx({ baselineId: "bl-1" }))).body as BaselineAlignment;
    expect(alignment.rollouts.map((rollout) => rollout.tenantId)).toEqual(["contoso"]);
    expect(alignment.runEvents.map((event) => event.tenantId)).toEqual(["contoso"]);
    expect(alignment.trend.map((point) => point.tenantId)).toEqual(["contoso"]);
  });

  it("refuses unauthenticated callers and unknown baselines", async () => {
    const noCaller = createBaselinesAlignmentRoutes({
      store: new MemoryAlignmentStore(),
      resolveCaller: () => undefined,
      authorize: () => {},
    });
    let code = "";
    try {
      await noCaller[0]!.handler(ctx({ baselineId: "bl-1" }));
    } catch (error) {
      code = (error as AppError).code;
    }
    expect(code).toBe("request.unauthenticated");

    try {
      await setup()(ctx({ baselineId: "missing" }));
    } catch (error) {
      code = (error as AppError).code;
    }
    expect(code).toBe("baseline.not_found");
  });

  it("documents the alignment endpoint", () => {
    expect(Object.keys(BASELINE_ALIGNMENT_OPENAPI)).toEqual(["/v1/baselines/{id}/alignment"]);
  });
});
