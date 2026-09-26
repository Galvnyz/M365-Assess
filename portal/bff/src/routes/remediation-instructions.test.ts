// T-0106 — GET /v1/remediation/instructions/{check}.
// Returns the materialized manual instruction, resolves sub-numbered ids, and
// returns an empty-state marker when nothing is defined.

import { describe, expect, it } from "vitest";
import { ALL_TENANTS } from "../rbac/scope.js";
import type { Caller } from "../rbac/authorize.js";
import type { RequestContext } from "../server.js";
import {
  REMEDIATION_INSTRUCTION_PATH,
  REMEDIATION_OPENAPI,
  REMEDIATION_PERMISSIONS,
  createRemediationRoutes,
  type ManualInstructionRecord,
  type RemediationPlanRecord,
  type RemediationPlanStore,
  type RemediationQueue,
} from "./remediation.js";

class InstructionStore implements RemediationPlanStore {
  constructor(private readonly instructions: Map<string, ManualInstructionRecord>) {}

  async getRemediationPlan(): Promise<RemediationPlanRecord | undefined> {
    return undefined;
  }

  async listRemediationActions(): Promise<never[]> {
    return [];
  }

  async getManualInstruction(check: string): Promise<ManualInstructionRecord | undefined> {
    return this.instructions.get(check);
  }
}

const NO_QUEUE: RemediationQueue = { async enqueue() { return "job"; } };

function adminCaller(): Caller {
  return { roles: ["admin"], tenantScope: ALL_TENANTS };
}

function context(check: string): RequestContext & { body?: unknown } {
  return {
    correlationId: "corr-instr-1",
    method: "GET",
    path: `/v1/remediation/instructions/${check}`,
    query: new URLSearchParams(),
    headers: {},
    params: { check },
  };
}

function routeFor(store: RemediationPlanStore) {
  const route = createRemediationRoutes({
    store,
    queue: NO_QUEUE,
    resolveCaller: () => adminCaller(),
    authorize: () => {},
  }).find((r) => r.method === "GET" && r.path === REMEDIATION_INSTRUCTION_PATH);
  if (!route) throw new Error("instruction route not found");
  return route;
}

function withInstruction(check: string, instruction: ManualInstructionRecord): InstructionStore {
  return new InstructionStore(new Map([[check, instruction]]));
}

describe("GET /v1/remediation/instructions/{check} (T-0106)", () => {
  it("returns portal path and numbered steps for a check with an instruction", async () => {
    const store = withInstruction("ENTRA-SECDEFAULT-001", {
      check: "ENTRA-SECDEFAULT-001",
      portalPath: "Microsoft Entra admin center > Entra ID > Properties",
      steps: ["Open the admin center", "Set Security defaults to Enabled", "Save"],
      notes: "Do not enable with Conditional Access in use.",
    });
    const res = await routeFor(store).handler(context("ENTRA-SECDEFAULT-001"));

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.found).toBe(true);
    expect(body.portalPath).toBe("Microsoft Entra admin center > Entra ID > Properties");
    expect(body.steps).toEqual([
      "Open the admin center",
      "Set Security defaults to Enabled",
      "Save",
    ]);
    expect(body.notes).toContain("Conditional Access");
  });

  it("resolves a sub-numbered id to the same instruction as its base id", async () => {
    const store = withInstruction("CA-REPORTONLY-001", {
      check: "CA-REPORTONLY-001",
      portalPath: "Entra > Conditional Access",
      steps: ["Step one"],
      notes: null,
    });
    const res = await routeFor(store).handler(context("CA-REPORTONLY-001.2"));

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.check).toBe("CA-REPORTONLY-001.2");
    expect(body.found).toBe(true);
    expect(body.portalPath).toBe("Entra > Conditional Access");
    expect(body.steps).toEqual(["Step one"]);
  });

  it("returns the empty-state marker when no instruction is defined", async () => {
    const res = await routeFor(new InstructionStore(new Map())).handler(context("UNKNOWN-001"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      check: "UNKNOWN-001",
      found: false,
      portalPath: null,
      steps: [],
      notes: null,
    });
  });

  it("returns 401 without an authenticated caller", async () => {
    const route = createRemediationRoutes({
      store: new InstructionStore(new Map()),
      queue: NO_QUEUE,
      resolveCaller: () => undefined,
    }).find((r) => r.method === "GET" && r.path === REMEDIATION_INSTRUCTION_PATH)!;
    await expect(route.handler(context("X-001"))).rejects.toMatchObject({ status: 401 });
  });

  it("publishes the instruction operation with the read permission", () => {
    expect(REMEDIATION_OPENAPI["/v1/remediation/instructions/{check}"].get.permission).toBe(
      REMEDIATION_PERMISSIONS.read,
    );
  });
});
