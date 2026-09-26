// T-0187 — fleet overview endpoint.
import { describe, expect, it } from "vitest";
import { ALL_TENANTS, type Caller } from "../rbac/authorize.js";
import type { RequestContext } from "../server.js";
import {
  BASELINES_FLEET_OPENAPI,
  BASELINES_FLEET_PATH,
  buildFleetBaselineRows,
  buildTenantsNeedingAttention,
  createBaselinesFleetRoutes,
  type FleetDeviationStates,
  type FleetStore,
  type FleetOverview,
} from "./baselines-fleet.js";
import type { BaselineRecord } from "./baselines.js";
import type { BaselineRollout } from "../domain/baseline-rollout.js";

function baseline(id: string, name: string, stages = 2): BaselineRecord {
  const now = new Date().toISOString();
  return {
    id,
    name,
    logic: "and",
    alerting: { enabled: false },
    enabled: true,
    stages: Array.from({ length: stages }, (_, order) => ({ order, conditions: [], action: "report" as const })),
    createdAt: now,
    updatedAt: now,
  };
}

function rollout(
  baselineId: string,
  tenantId: string,
  stage: number,
  state: BaselineRollout["state"],
): BaselineRollout {
  return { baselineId, tenantId, stage, state, lastRunAt: "2026-09-26T00:00:00.000Z" };
}

const DEVIATIONS: FleetDeviationStates = {
  open: 3,
  accepted: 2,
  customerSpecific: 0,
  denied: 1,
  deletePending: 0,
  resolved: 4,
  total: 10,
};

class MemoryFleetStore implements FleetStore {
  constructor(
    private readonly baselines: BaselineRecord[] = [baseline("bl-1", "Servers")],
    private readonly rollouts: BaselineRollout[] = [
      rollout("bl-1", "contoso", 0, "active"),
      rollout("bl-1", "fabrikam", 1, "complete"),
    ],
    private readonly openByTenant: Record<string, number> = { contoso: 3 },
  ) {}

  async listBaselines(): Promise<readonly BaselineRecord[]> {
    return this.baselines;
  }
  async listRollouts(): Promise<readonly BaselineRollout[]> {
    return this.rollouts;
  }
  async countDeviationsByState(): Promise<FleetDeviationStates> {
    return DEVIATIONS;
  }
  async openDeviationsByTenant(): Promise<Readonly<Record<string, number>>> {
    return this.openByTenant;
  }
}

function ctx(): RequestContext {
  return { method: "GET", path: BASELINES_FLEET_PATH, params: {}, query: new Map(), headers: {}, correlationId: "t" };
}

describe("fleet builders (T-0187)", () => {
  it("computes per-baseline compliance from complete rollouts", () => {
    const rows = buildFleetBaselineRows([baseline("bl-1", "Servers")], [
      rollout("bl-1", "a", 1, "complete"),
      rollout("bl-1", "b", 0, "active"),
    ]);
    expect(rows[0]).toMatchObject({ assignedTenants: 2, fleetCompliance: 0.5, stages: 2 });
    expect(rows[0]?.lastRunAt).toBe("2026-09-26T00:00:00.000Z");
  });

  it("flags tenants with open deviations or stalled stages", () => {
    const flagged = buildTenantsNeedingAttention(
      [
        rollout("bl-1", "a", 0, "active"),
        rollout("bl-1", "b", 1, "complete"),
        rollout("bl-1", "c", 1, "complete"),
      ],
      { a: 0, c: 2 },
    );
    // a: stalled stage; c: complete but open deviations outstanding.
    expect(flagged.map((row) => row.tenantId)).toEqual(["a", "c"]);
    expect(flagged.find((row) => row.tenantId === "c")?.openDeviations).toBe(2);
  });
});

describe("GET /v1/baselines/fleet (T-0187)", () => {
  it("returns compliance, deviation states, and tenants needing attention", async () => {
    const routes = createBaselinesFleetRoutes({
      store: new MemoryFleetStore(),
      resolveCaller: () => ({ roles: ["admin"], tenantScope: ALL_TENANTS }) as Caller,
      authorize: () => {},
    });
    const response = await routes[0]!.handler(ctx());
    expect(response.status).toBe(200);
    const overview = response.body as FleetOverview;
    expect(overview.deviationStates).toEqual(DEVIATIONS);
    expect(overview.acceptedDenied).toEqual({ accepted: 2, denied: 1 });
    expect(overview.baselines[0]).toMatchObject({ id: "bl-1", fleetCompliance: 0.5 });
    // contoso: active stage + open deviations; fabrikam: complete and clean.
    expect(overview.needsAttention.map((row) => row.tenantId)).toEqual(["contoso"]);
  });

  it("documents the fleet endpoint", () => {
    expect(Object.keys(BASELINES_FLEET_OPENAPI)).toEqual(["/v1/baselines/fleet"]);
  });
});
