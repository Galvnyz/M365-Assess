// T-0186 — manual stage advance.
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../errors.js";
import { ALL_TENANTS, tenantScope } from "../rbac/scope.js";
import { RbacErrorCodes, type Caller } from "../rbac/authorize.js";
import type { RequestContext } from "../server.js";
import {
  BASELINE_ADVANCE_OPENAPI,
  BASELINE_ADVANCE_PATH,
  createBaselinesAdvanceRoutes,
  type AdvanceStore,
} from "./baselines-advance.js";
import type { BaselineRecord } from "./baselines.js";
import type { BaselineRollout } from "../domain/baseline-rollout.js";

function baseline(): BaselineRecord {
  const now = new Date().toISOString();
  return {
    id: "bl-1",
    name: "Server baseline",
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

class MemoryAdvanceStore implements AdvanceStore {
  rollouts = new Map<string, BaselineRollout>();
  readonly baselines = new Map<string, BaselineRecord>([["bl-1", baseline()]]);

  async getBaseline(baselineId: string): Promise<BaselineRecord | undefined> {
    return this.baselines.get(baselineId);
  }

  async getRollout(baselineId: string, tenantId: string): Promise<BaselineRollout | undefined> {
    return this.rollouts.get(`${baselineId}${tenantId}`);
  }

  async upsertRollout(input: {
    baselineId: string;
    tenantId: string;
    stage: number;
    state: BaselineRollout["state"];
  }): Promise<BaselineRollout> {
    const rollout: BaselineRollout = { ...input, lastRunAt: new Date().toISOString() };
    this.rollouts.set(`${input.baselineId}${input.tenantId}`, rollout);
    return rollout;
  }
}

function ctx(params: Record<string, string>, body: unknown): RequestContext & { body?: unknown } {
  return {
    method: "POST",
    path: BASELINE_ADVANCE_PATH,
    params,
    query: new Map(),
    headers: {},
    correlationId: "test-correlation",
    body,
  };
}

describe("manual stage advance (T-0186)", () => {
  function setup(rollout?: BaselineRollout, caller?: Caller) {
    const store = new MemoryAdvanceStore();
    if (rollout) store.rollouts.set(`${rollout.baselineId}${rollout.tenantId}`, rollout);
    const audit = { record: vi.fn() };
    const history: { events: unknown[]; append: (event: never) => void } = {
      events: [],
      append(event: never) {
        this.events.push(event);
      },
    };
    const routes = createBaselinesAdvanceRoutes({
      store,
      resolveCaller: () => caller ?? ({ roles: ["admin"], tenantScope: ALL_TENANTS } as Caller),
      authorize: () => {},
      audit,
      history,
    });
    return { store, audit, history, handler: routes[0]!.handler };
  }

  const eligible: BaselineRollout = {
    baselineId: "bl-1",
    tenantId: "contoso",
    stage: 0,
    state: "eligible",
    lastRunAt: new Date().toISOString(),
  };

  it("advances an eligible tenant one stage, audited with a history event", async () => {
    const { audit, history, handler } = setup(eligible);
    const response = await handler(ctx({ baselineId: "bl-1", order: "0" }, { tenantId: "contoso" }));
    expect(response.status).toBe(200);
    expect((response.body as { rollout: BaselineRollout }).rollout).toMatchObject({
      stage: 1,
      state: "active",
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "baseline.advance", tenantId: "contoso" }),
    );
    expect(history.events).toHaveLength(1);
    expect(history.events[0]).toMatchObject({
      baselineId: "bl-1",
      tenantId: "contoso",
      event: "stage.advanced",
    });
  });

  it("rejects an ineligible advance with no state change", async () => {
    const active: BaselineRollout = { ...eligible, state: "active" };
    const { store, audit, history, handler } = setup(active);
    let code = "";
    try {
      await handler(ctx({ baselineId: "bl-1", order: "0" }, { tenantId: "contoso" }));
    } catch (error) {
      code = (error as AppError).code;
    }
    expect(code).toBe("baseline.advance_not_eligible");
    expect((await store.getRollout("bl-1", "contoso"))?.state).toBe("active");
    expect(audit.record).not.toHaveBeenCalled();
    expect(history.events).toHaveLength(0);
  });

  it("rejects an advance for a missing rollout or a wrong stage", async () => {
    const { handler } = setup();
    for (const params of [
      { baselineId: "bl-1", order: "0" },
      { baselineId: "bl-1", order: "9" },
    ]) {
      let code = "";
      try {
        await handler(ctx(params, { tenantId: "contoso" }));
      } catch (error) {
        code = (error as AppError).code;
      }
      expect(["baseline.advance_not_eligible", "baseline.stage_not_found"]).toContain(code);
    }
  });

  it("refuses callers without baselines.advance and out-of-scope tenants", async () => {
    const deny = (): void => {
      throw new AppError(RbacErrorCodes.forbidden, "nope", 403);
    };
    const store = new MemoryAdvanceStore();
    const denied = createBaselinesAdvanceRoutes({
      store,
      resolveCaller: () => ({ roles: ["admin"], tenantScope: ALL_TENANTS }) as Caller,
      authorize: deny,
    });
    let code = "";
    try {
      await denied[0]!.handler(ctx({ baselineId: "bl-1", order: "0" }, { tenantId: "contoso" }));
    } catch (error) {
      code = (error as AppError).code;
    }
    expect(code).toBe(RbacErrorCodes.forbidden);

    const scoped = createBaselinesAdvanceRoutes({
      store,
      resolveCaller: () => ({ roles: ["admin"], tenantScope: tenantScope(["fabrikam"]) }) as Caller,
      authorize: () => {},
    });
    try {
      await scoped[0]!.handler(ctx({ baselineId: "bl-1", order: "0" }, { tenantId: "contoso" }));
    } catch (error) {
      code = (error as AppError).code;
    }
    expect(code).toBe(RbacErrorCodes.forbidden);
  });

  it("documents the advance endpoint", () => {
    expect(Object.keys(BASELINE_ADVANCE_OPENAPI)).toEqual([
      "/v1/baselines/{id}/stages/{order}/advance",
    ]);
  });
});
