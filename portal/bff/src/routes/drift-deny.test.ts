// T-0166 — drift deny (queued deletion) route.
import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { ALL_TENANTS } from "../rbac/scope.js";
import { RbacErrorCodes, type Caller } from "../rbac/authorize.js";
import type { RequestContext } from "../server.js";
import {
  DRIFT_DENY_OPENAPI,
  DRIFT_DENY_PATH,
  DRIFT_DENY_PERMISSIONS,
  createDriftDenyRoutes,
  type DriftDenyStore,
} from "./drift-deny.js";
import type { DriftDeviationRecord } from "./drift.js";
import type { DriftDeleteInstruction, DriftTriagePatchLike } from "../domain/drift-delete-queue.js";

const TENANT_1 = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-01-01T00:00:00.000Z");

function deviation(overrides: Partial<DriftDeviationRecord> = {}): DriftDeviationRecord {
  return {
    id: "dev-1",
    tenantId: TENANT_1,
    standardKey: "extra:conditionalAccess",
    resourceId: "policy-1",
    kind: "extra",
    current: { present: true },
    expected: null,
    state: "open",
    reason: null,
    expiresOn: null,
    autoRemediateOnExpiry: false,
    overrideValue: null,
    lastSeenAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

class DenyStore implements DriftDenyStore {
  row: DriftDeviationRecord | undefined;
  constructor(row: DriftDeviationRecord | undefined = deviation()) {
    this.row = row;
  }
  async applyTriageByDeviationId(deviationId: string, patch: DriftTriagePatchLike) {
    if (!this.row || this.row.id !== deviationId) return undefined;
    this.row = {
      ...this.row,
      state: patch.state,
      reason: patch.reason,
      expiresOn: patch.expiresOn,
      autoRemediateOnExpiry: patch.autoRemediateOnExpiry,
      overrideValue: patch.overrideValue,
    };
    return this.row;
  }
}

function adminCaller(): Caller {
  return { roles: ["admin"], tenantScope: ALL_TENANTS };
}

function allowAll(): void {}
function denyAll(): void {
  throw new AppError(RbacErrorCodes.forbidden, "not permitted to perform this action", 403);
}

function makeOptions(store: DriftDenyStore, overrides: Record<string, unknown> = {}) {
  return {
    store,
    remediation: { async queueDeletion() { return "job-1"; } },
    resolveCaller: () => adminCaller(),
    authorize: allowAll,
    now: () => NOW,
    ...overrides,
  };
}

function routeFor(opts: Parameters<typeof createDriftDenyRoutes>[0]) {
  const route = createDriftDenyRoutes(opts).find((r) => r.method === "POST" && r.path === DRIFT_DENY_PATH);
  if (!route) throw new Error("deny route not found");
  return route;
}

function ctx(body: Record<string, unknown>, deviationId = "dev-1"): RequestContext & { body?: unknown } {
  return {
    correlationId: "corr-1",
    method: "POST",
    path: `/v1/drift/deviations/${deviationId}/deny`,
    query: new URLSearchParams(),
    headers: {},
    params: { deviationId },
    body,
  };
}

describe("POST .../deny (T-0166)", () => {
  it("requires confirmation and never mutates without it", async () => {
    const store = new DenyStore();
    const route = routeFor(makeOptions(store));
    await expect(route.handler(ctx({ reason: "duplicate" }))).rejects.toMatchObject({ status: 409 });
    expect(store.row?.state).toBe("open");
  });

  it("moves denied -> deletePending, queues deletion via EPIC-006, and never deletes synchronously", async () => {
    const store = new DenyStore();
    const instructions: DriftDeleteInstruction[] = [];
    const audits: Record<string, unknown>[] = [];
    const route = routeFor(
      makeOptions(store, {
        remediation: {
          async queueDeletion(instruction: DriftDeleteInstruction) {
            instructions.push(instruction);
            return "job-9";
          },
        },
        audit: { record: (e: Record<string, unknown>) => { audits.push(e); } },
      }),
    );

    const res = await route.handler(ctx({ reason: "duplicate", confirm: true }));
    expect(res.status).toBe(202);
    const body = res.body as { deviation: DriftDeviationRecord; deletionQueued: boolean; jobId: string };
    expect(body.deletionQueued).toBe(true);
    expect(body.jobId).toBe("job-9");
    // End state is deletePending; the tenant delete is queued, not performed here.
    expect(body.deviation.state).toBe("deletePending");
    expect(store.row?.state).toBe("deletePending");

    expect(instructions).toHaveLength(1);
    expect(instructions[0]).toMatchObject({
      kind: "drift-deny-delete",
      tenantId: TENANT_1,
      resourceId: "policy-1",
      notBefore: NOW.toISOString(),
    });

    // Audited with actor context and the reason.
    expect(audits.map((a) => a["action"])).toEqual(["drift.deny", "drift.deny_queued"]);
    expect(audits[0]!["reason"]).toBe("duplicate");
    expect(audits[0]!["correlationId"]).toBe("corr-1");
  });

  it("defers deletion when a delay is configured", async () => {
    const store = new DenyStore();
    let queued = 0;
    const route = routeFor(
      makeOptions(store, {
        remediation: { async queueDeletion() { queued += 1; return "job-x"; } },
      }),
    );

    const res = await route.handler(ctx({ reason: "wait", confirm: true, delayDays: 3 }));
    expect(res.status).toBe(202);
    const body = res.body as { deviation: DriftDeviationRecord; deletionQueued: boolean };
    // Still denied: the grace window has not elapsed.
    expect(body.deviation.state).toBe("denied");
    expect(body.deviation.expiresOn).toBe("2026-01-04T00:00:00.000Z");
    expect(body.deletionQueued).toBe(false);
    expect(queued).toBe(0);
  });

  it("requires both drift.remediate and Remediation.Apply", async () => {
    const store = new DenyStore();
    // Deny the second (EPIC-006) permission.
    const authorize = (_caller: Caller, permission: string): void => {
      if (permission === DRIFT_DENY_PERMISSIONS.remediate) {
        throw new AppError(RbacErrorCodes.forbidden, "not permitted", 403);
      }
    };
    const route = routeFor(makeOptions(store, { authorize }));
    await expect(route.handler(ctx({ reason: "x", confirm: true }))).rejects.toMatchObject({ status: 403 });
    expect(store.row?.state).toBe("open");
  });

  it("returns 404 for an unknown deviation", async () => {
    const route = routeFor(makeOptions(new DenyStore()));
    await expect(route.handler(ctx({ reason: "x", confirm: true }, "missing"))).rejects.toMatchObject({
      status: 404,
    });
  });

  it("publishes both required permissions", () => {
    const op = DRIFT_DENY_OPENAPI["/v1/drift/deviations/{deviationId}/deny"].post;
    expect(op.permission).toBe(DRIFT_DENY_PERMISSIONS.triage);
    expect(op.additionalPermission).toBe(DRIFT_DENY_PERMISSIONS.remediate);
  });

  it("rejects a deny without drift.triage (first permission)", async () => {
    const store = new DenyStore();
    const route = routeFor(makeOptions(store, { authorize: denyAll }));
    await expect(route.handler(ctx({ reason: "x", confirm: true }))).rejects.toMatchObject({ status: 403 });
  });
});
