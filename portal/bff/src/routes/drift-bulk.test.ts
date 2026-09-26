// T-0167 — bulk drift triage.
import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { ALL_TENANTS, tenantScope } from "../rbac/scope.js";
import { RbacErrorCodes, type Caller } from "../rbac/authorize.js";
import type { RequestContext } from "../server.js";
import {
  DRIFT_BULK_PATH,
  DRIFT_BULK_PERMISSIONS,
  createDriftBulkRoutes,
  type DriftBulkStore,
} from "./drift-bulk.js";
import type { DriftDeviationRecord } from "./drift.js";
import type { DriftTriagePatch } from "../domain/drift-triage.js";
import type { DriftDeleteInstruction } from "../domain/drift-delete-queue.js";

const TENANT_1 = "11111111-1111-1111-1111-111111111111";
const TENANT_2 = "22222222-2222-2222-2222-222222222222";
const NOW = new Date("2026-01-01T00:00:00.000Z");

function deviation(id: string, overrides: Partial<DriftDeviationRecord> = {}): DriftDeviationRecord {
  return {
    id,
    tenantId: TENANT_1,
    standardKey: "CA-REPORTONLY-001",
    resourceId: `res-${id}`,
    kind: "mismatch",
    current: 1,
    expected: 2,
    state: "open",
    reason: null,
    expiresOn: null,
    autoRemediateOnExpiry: false,
    overrideValue: null,
    lastSeenAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

class BulkStore implements DriftBulkStore {
  readonly rows = new Map<string, DriftDeviationRecord>();
  constructor(rows: DriftDeviationRecord[]) {
    for (const row of rows) this.rows.set(row.id, row);
  }
  async getDeviationById(id: string): Promise<DriftDeviationRecord | undefined> {
    return this.rows.get(id);
  }
  async applyTriageByDeviationId(id: string, patch: DriftTriagePatch) {
    const row = this.rows.get(id);
    if (!row) return undefined;
    const updated = { ...row, ...patch } as DriftDeviationRecord;
    this.rows.set(id, updated);
    return updated;
  }
}

function adminCaller(): Caller {
  return { roles: ["admin"], tenantScope: ALL_TENANTS };
}

function allowAll(): void {}
function denyAll(): void {
  throw new AppError(RbacErrorCodes.forbidden, "not permitted to perform this action", 403);
}

function makeOptions(store: DriftBulkStore, overrides: Record<string, unknown> = {}) {
  return {
    store,
    remediation: { async queueDeletion() { return "job-1"; } },
    resolveCaller: () => adminCaller(),
    authorize: allowAll,
    now: () => NOW,
    ...overrides,
  };
}

function routeFor(opts: Parameters<typeof createDriftBulkRoutes>[0]) {
  const route = createDriftBulkRoutes(opts).find((r) => r.method === "POST" && r.path === DRIFT_BULK_PATH);
  if (!route) throw new Error("bulk route not found");
  return route;
}

function ctx(body: Record<string, unknown>): RequestContext & { body?: unknown } {
  return {
    correlationId: "corr-1",
    method: "POST",
    path: DRIFT_BULK_PATH,
    query: new URLSearchParams(),
    headers: {},
    params: {},
    body,
  };
}

describe("POST /v1/drift/bulk (T-0167)", () => {
  it("accepts a selection and returns per-item outcomes", async () => {
    const store = new BulkStore([deviation("a"), deviation("b")]);
    const audits: Record<string, unknown>[] = [];
    const route = routeFor(makeOptions(store, { audit: { record: (e: Record<string, unknown>) => { audits.push(e); } } }));

    const res = await route.handler(
      ctx({
        tenantId: TENANT_1,
        action: "accept",
        deviationIds: ["a", "b"],
        reason: "bulk accept",
        expiresOn: "2026-06-01",
      }),
    );

    expect(res.status).toBe(200);
    const body = res.body as { applied: { deviationId: string; state: string }[]; skipped: unknown[] };
    expect(body.applied.map((a) => a.deviationId)).toEqual(["a", "b"]);
    expect(body.applied.every((a) => a.state === "accepted")).toBe(true);
    expect(body.skipped).toHaveLength(0);

    // Every item audited with the reason.
    expect(audits).toHaveLength(2);
    expect(audits.every((a) => a["reason"] === "bulk accept" && a["action"] === "drift.bulk.accept")).toBe(true);
  });

  it("rejects a deny-delete batch without the confirmation flag", async () => {
    const store = new BulkStore([deviation("a")]);
    const route = routeFor(makeOptions(store));
    await expect(
      route.handler(ctx({ tenantId: TENANT_1, action: "deny-delete", deviationIds: ["a"], reason: "dup" })),
    ).rejects.toMatchObject({ status: 409 });
    // Nothing applied.
    expect(store.rows.get("a")?.state).toBe("open");
  });

  it("queues deletion for a confirmed deny-delete batch", async () => {
    const store = new BulkStore([deviation("a"), deviation("b")]);
    const instructions: DriftDeleteInstruction[] = [];
    const route = routeFor(
      makeOptions(store, { remediation: { async queueDeletion(i: DriftDeleteInstruction) { instructions.push(i); return "job"; } } }),
    );

    const res = await route.handler(
      ctx({ tenantId: TENANT_1, action: "deny-delete", deviationIds: ["a", "b"], reason: "duplicate", confirm: true }),
    );
    const body = res.body as { applied: { state: string }[] };
    expect(body.applied.every((a) => a.state === "deletePending")).toBe(true);
    expect(instructions).toHaveLength(2);
  });

  it("marks deny-remediate items as denied and remediable without deleting", async () => {
    const store = new BulkStore([deviation("a")]);
    let queued = 0;
    const route = routeFor(makeOptions(store, { remediation: { async queueDeletion() { queued += 1; return "job"; } } }));

    const res = await route.handler(
      ctx({ tenantId: TENANT_1, action: "deny-remediate", deviationIds: ["a"], reason: "revert" }),
    );
    const body = res.body as { applied: { state: string }[] };
    expect(body.applied[0]!.state).toBe("denied");
    expect(store.rows.get("a")?.autoRemediateOnExpiry).toBe(true);
    expect(queued).toBe(0);
  });

  it("validates selection membership all-or-nothing with no partial writes", async () => {
    const store = new BulkStore([deviation("a")]);
    const route = routeFor(makeOptions(store));
    await expect(
      route.handler(
        ctx({ tenantId: TENANT_1, action: "accept", deviationIds: ["a", "missing"], reason: "x", expiresOn: "2026-06-01" }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    // The valid item was NOT applied because membership failed.
    expect(store.rows.get("a")?.state).toBe("open");
  });

  it("rejects a selection containing another tenant's deviation", async () => {
    const store = new BulkStore([deviation("a"), deviation("foreign", { tenantId: TENANT_2 })]);
    const route = routeFor(makeOptions(store));
    await expect(
      route.handler(
        ctx({ tenantId: TENANT_1, action: "accept", deviationIds: ["a", "foreign"], reason: "x", expiresOn: "2026-06-01" }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(store.rows.get("a")?.state).toBe("open");
  });

  it("reports ineligible items in the partial-result shape", async () => {
    const store = new BulkStore([deviation("a"), deviation("b", { state: "deletePending" })]);
    const route = routeFor(makeOptions(store));
    const res = await route.handler(
      ctx({ tenantId: TENANT_1, action: "accept", deviationIds: ["a", "b"], reason: "x", expiresOn: "2026-06-01" }),
    );
    const body = res.body as { applied: { deviationId: string }[]; skipped: { deviationId: string }[] };
    expect(body.applied.map((a) => a.deviationId)).toEqual(["a"]);
    expect(body.skipped.map((s) => s.deviationId)).toEqual(["b"]);
  });

  it("requires the higher privileges for deny and tenant scope for all", async () => {
    const store = new BulkStore([deviation("a")]);
    // deny-delete without Remediation.Apply.
    const authorize = (_c: Caller, permission: string): void => {
      if (permission === DRIFT_BULK_PERMISSIONS.apply) {
        throw new AppError(RbacErrorCodes.forbidden, "no", 403);
      }
    };
    const denied = routeFor(makeOptions(store, { authorize }));
    await expect(
      denied.handler(ctx({ tenantId: TENANT_1, action: "deny-delete", deviationIds: ["a"], reason: "x", confirm: true })),
    ).rejects.toMatchObject({ status: 403 });

    // Out-of-scope tenant.
    const scoped = routeFor(
      makeOptions(store, { resolveCaller: () => ({ roles: ["operator"], tenantScope: tenantScope([TENANT_2]) }) }),
    );
    await expect(
      scoped.handler(ctx({ tenantId: TENANT_1, action: "accept", deviationIds: ["a"], reason: "x", expiresOn: "2026-06-01" })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("requires a reason and an expiresOn for accept", async () => {
    const store = new BulkStore([deviation("a")]);
    const route = routeFor(makeOptions(store));
    await expect(
      route.handler(ctx({ tenantId: TENANT_1, action: "accept", deviationIds: ["a"], expiresOn: "2026-06-01" })),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      route.handler(ctx({ tenantId: TENANT_1, action: "accept", deviationIds: ["a"], reason: "x" })),
    ).rejects.toMatchObject({ status: 400 });
  });
});
