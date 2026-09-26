// T-0150 — standards run-now and schedule set/clear.
import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { ALL_TENANTS, tenantScope } from "../rbac/scope.js";
import { RbacErrorCodes, type Caller } from "../rbac/authorize.js";
import type { RequestContext } from "../server.js";
import {
  STANDARDS_DRIFT_NOT_SCHEDULABLE,
  STANDARDS_RUN_PATH,
  STANDARDS_SCHEDULE_PATH,
  STANDARDS_TEMPLATE_NOT_FOUND,
  STANDARDS_UNRESOLVED_VARIABLE,
  createStandardsRunRoutes,
  type CreateScheduleInput,
  type RunTemplateRecord,
  type StandardsRunStore,
} from "./standards-run.js";

const TENANT_1 = "11111111-1111-1111-1111-111111111111";
const TENANT_2 = "22222222-2222-2222-2222-222222222222";

class MemoryRunStore implements StandardsRunStore {
  constructor(public template: RunTemplateRecord | undefined) {}
  readonly schedules = new Map<string, CreateScheduleInput>();
  readonly deleted: string[] = [];

  async getStandardTemplate(): Promise<RunTemplateRecord | undefined> {
    return this.template;
  }

  async updateStandardTemplate(
    _templateId: string,
    patch: { scheduleId?: string | null },
  ): Promise<RunTemplateRecord | undefined> {
    if (this.template && "scheduleId" in patch) {
      this.template = { ...this.template, scheduleId: patch.scheduleId ?? null };
    }
    return this.template;
  }

  async createSchedule(input: CreateScheduleInput): Promise<{ id: string }> {
    this.schedules.set(input.id, input);
    return { id: input.id };
  }

  async softDeleteSchedule(scheduleId: string): Promise<boolean> {
    this.deleted.push(scheduleId);
    return true;
  }
}

function adminCaller(): Caller {
  return { roles: ["admin"], tenantScope: ALL_TENANTS };
}

function allowAll(): void {}
function denyAll(): void {
  throw new AppError(RbacErrorCodes.forbidden, "not permitted to perform this action", 403);
}

let seq = 0;
function makeOptions(store: StandardsRunStore, overrides: Record<string, unknown> = {}) {
  seq = 0;
  return {
    store,
    queue: { async enqueue() { return "job"; } },
    resolveCaller: () => adminCaller(),
    authorize: allowAll,
    idGenerator: () => `id-${(seq += 1)}`,
    now: () => "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function routeFor(opts: Parameters<typeof createStandardsRunRoutes>[0], method: string, path: string) {
  const route = createStandardsRunRoutes(opts).find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`route not found: ${method} ${path}`);
  return route;
}

function ctx(
  method: string,
  path: string,
  options: { params?: Record<string, string>; body?: Record<string, unknown> } = {},
): RequestContext & { body?: unknown } {
  return {
    correlationId: "corr-1",
    method,
    path,
    query: new URLSearchParams(),
    headers: {},
    params: options.params ?? {},
    body: options.body,
  };
}

const TEMPLATE: RunTemplateRecord = {
  id: "tpl-1",
  name: "Baseline",
  kind: "standards",
  settings: [
    { key: "ENTRA-SECDEFAULT-001", value: "%org%" },
    { key: "EXO-SHARING-001", value: "static" },
  ],
  scheduleId: null,
};

describe("POST .../run (T-0150)", () => {
  it("enqueues immediately with trigger manual and resolved settings", async () => {
    const store = new MemoryRunStore({ ...TEMPLATE });
    const enqueued: unknown[] = [];
    const route = routeFor(
      makeOptions(store, {
        queue: { async enqueue(e: unknown) { enqueued.push(e); return "job"; } },
        resolveVariables: async () => ({ tenant: [{ name: "org", value: "Contoso" }] }),
      }),
      "POST",
      STANDARDS_RUN_PATH,
    );

    const res = await route.handler(
      ctx("POST", STANDARDS_RUN_PATH, { params: { templateId: "tpl-1" }, body: { tenantId: TENANT_1 } }),
    );

    expect(res.status).toBe(202);
    const body = res.body as Record<string, unknown>;
    expect(body.trigger).toBe("manual");
    expect(body.tenantId).toBe(TENANT_1);

    expect(enqueued).toHaveLength(1);
    const envelope = enqueued[0] as { trigger: string; payload: { settings: { value: unknown }[] } };
    expect(envelope.trigger).toBe("manual");
    // The %org% token was substituted before enqueue.
    expect(envelope.payload.settings[0]!.value).toBe("Contoso");
  });

  it("rejects loudly on an unresolved variable and records it, without enqueuing", async () => {
    const store = new MemoryRunStore({ ...TEMPLATE });
    const enqueued: unknown[] = [];
    const audits: Record<string, unknown>[] = [];
    const route = routeFor(
      makeOptions(store, {
        queue: { async enqueue(e: unknown) { enqueued.push(e); return "job"; } },
        resolveVariables: async () => ({}),
        audit: { record: (e: Record<string, unknown>) => { audits.push(e); } },
      }),
      "POST",
      STANDARDS_RUN_PATH,
    );

    await expect(
      route.handler(ctx("POST", STANDARDS_RUN_PATH, { params: { templateId: "tpl-1" }, body: { tenantId: TENANT_1 } })),
    ).rejects.toMatchObject({ status: 422, code: STANDARDS_UNRESOLVED_VARIABLE });

    expect(enqueued).toHaveLength(0);
    const failure = audits.find((a) => a["action"] === "standards.variable_unresolved");
    expect(failure).toBeTruthy();
    expect(failure!["token"]).toBe("org");
    expect(failure!["resourceId"]).toBe("tpl-1");
  });

  it("returns 404 for an unknown template and 403 for an out-of-scope tenant", async () => {
    const missing = routeFor(makeOptions(new MemoryRunStore(undefined)), "POST", STANDARDS_RUN_PATH);
    await expect(
      missing.handler(ctx("POST", STANDARDS_RUN_PATH, { params: { templateId: "nope" }, body: { tenantId: TENANT_1 } })),
    ).rejects.toMatchObject({ code: STANDARDS_TEMPLATE_NOT_FOUND });

    const scoped = routeFor(
      makeOptions(new MemoryRunStore({ ...TEMPLATE }), {
        resolveCaller: () => ({ roles: ["operator"], tenantScope: tenantScope([TENANT_2]) }),
      }),
      "POST",
      STANDARDS_RUN_PATH,
    );
    await expect(
      scoped.handler(ctx("POST", STANDARDS_RUN_PATH, { params: { templateId: "tpl-1" }, body: { tenantId: TENANT_1 } })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("requires standards.run", async () => {
    const route = routeFor(
      makeOptions(new MemoryRunStore({ ...TEMPLATE }), { authorize: denyAll }),
      "POST",
      STANDARDS_RUN_PATH,
    );
    await expect(
      route.handler(ctx("POST", STANDARDS_RUN_PATH, { params: { templateId: "tpl-1" }, body: { tenantId: TENANT_1 } })),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("POST .../schedule (T-0150)", () => {
  it("creates a Schedule row from a cron and links it to the template", async () => {
    const store = new MemoryRunStore({ ...TEMPLATE });
    const route = routeFor(makeOptions(store), "POST", STANDARDS_SCHEDULE_PATH);

    const res = await route.handler(
      ctx("POST", STANDARDS_SCHEDULE_PATH, {
        params: { templateId: "tpl-1" },
        body: { cron: "0 0 */12 * * *" },
      }),
    );

    expect(res.status).toBe(200);
    const scheduleId = (res.body as { scheduleId: string }).scheduleId;
    expect(store.schedules.get(scheduleId)?.cron).toBe("0 0 */12 * * *");
    expect(store.schedules.get(scheduleId)?.type).toBe("standards");
    // The template now references the schedule.
    expect(store.template?.scheduleId).toBe(scheduleId);
  });

  it("links an existing schedule by id", async () => {
    const store = new MemoryRunStore({ ...TEMPLATE });
    const route = routeFor(makeOptions(store), "POST", STANDARDS_SCHEDULE_PATH);
    const res = await route.handler(
      ctx("POST", STANDARDS_SCHEDULE_PATH, { params: { templateId: "tpl-1" }, body: { scheduleId: "sch-9" } }),
    );
    expect((res.body as { scheduleId: string }).scheduleId).toBe("sch-9");
    expect(store.template?.scheduleId).toBe("sch-9");
  });

  it("clears the schedule and soft-deletes the Schedule row", async () => {
    const store = new MemoryRunStore({ ...TEMPLATE, scheduleId: "sch-1" });
    const route = routeFor(makeOptions(store), "POST", STANDARDS_SCHEDULE_PATH);
    const res = await route.handler(
      ctx("POST", STANDARDS_SCHEDULE_PATH, { params: { templateId: "tpl-1" }, body: { scheduleId: null } }),
    );
    expect((res.body as { scheduleId: null }).scheduleId).toBeNull();
    expect(store.deleted).toContain("sch-1");
    expect(store.template?.scheduleId).toBeNull();
  });

  it("rejects scheduling a drift template", async () => {
    const store = new MemoryRunStore({ ...TEMPLATE, kind: "drift" });
    const route = routeFor(makeOptions(store), "POST", STANDARDS_SCHEDULE_PATH);
    await expect(
      route.handler(ctx("POST", STANDARDS_SCHEDULE_PATH, { params: { templateId: "tpl-1" }, body: { cron: "0 0 * * * *" } })),
    ).rejects.toMatchObject({ status: 422, code: STANDARDS_DRIFT_NOT_SCHEDULABLE });
  });

  it("requires cron, an existing scheduleId, or null", async () => {
    const store = new MemoryRunStore({ ...TEMPLATE });
    const route = routeFor(makeOptions(store), "POST", STANDARDS_SCHEDULE_PATH);
    await expect(
      route.handler(ctx("POST", STANDARDS_SCHEDULE_PATH, { params: { templateId: "tpl-1" }, body: {} })),
    ).rejects.toMatchObject({ status: 400 });
  });
});
