import { describe, expect, it } from "vitest";
import { ALL_TENANTS, tenantScope } from "../rbac/scope.js";
import type { Route, RouteHandler, RouteResponse } from "../server.js";
import {
  SCHEDULES_OPENAPI,
  SCHEDULE_ALREADY_RUNNING,
  SCHEDULE_CONFLICT,
  SCHEDULE_HISTORY_PATH,
  SCHEDULE_NOT_FOUND,
  SCHEDULE_PATH,
  SCHEDULE_RUN_NOW_PATH,
  SCHEDULE_SYSTEM_IMMUTABLE,
  SCHEDULE_SYSTEM_PATH,
  SCHEDULE_UNKNOWN_COMMAND,
  SCHEDULES_PATH,
  createScheduleRoutes,
  type ScheduleCaller,
  type ScheduleCreateRecord,
  type ScheduleHistoryStore,
  type ScheduleRecord,
  type ScheduleRouteOptions,
  type ScheduleRunQueue,
  type ScheduleRunRecord,
  type ScheduleStore,
  type ScheduleUpdatePatch,
} from "./schedules.js";

const NOW = "2026-06-01T12:00:00.000Z";
const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";

class MemoryScheduleStore implements ScheduleStore {
  readonly records = new Map<string, ScheduleRecord>();

  async listSchedules(): Promise<ScheduleRecord[]> {
    return [...this.records.values()].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
  }

  async getSchedule(
    scheduleId: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<ScheduleRecord | undefined> {
    const found = this.records.get(scheduleId);
    if (found === undefined) return undefined;
    if (options.includeDeleted !== true && found.deletedAt !== null) return undefined;
    return { ...found };
  }

  async createSchedule(input: ScheduleCreateRecord): Promise<ScheduleRecord> {
    const stored: ScheduleRecord = {
      ...input,
      createdAt: input.createdAt ?? NOW,
      updatedAt: input.updatedAt ?? NOW,
      deletedAt: null,
    };
    this.records.set(stored.id, stored);
    return { ...stored };
  }

  async updateSchedule(
    scheduleId: string,
    patch: ScheduleUpdatePatch,
  ): Promise<ScheduleRecord | undefined> {
    const found = this.records.get(scheduleId);
    if (found === undefined || found.deletedAt !== null) return undefined;
    if (found.isSystem) {
      throw Object.assign(new Error(`schedule ${scheduleId} is read-only`), {
        code: "schedule.system_immutable",
      });
    }
    const updated: ScheduleRecord = { ...found, ...patch, updatedAt: NOW };
    this.records.set(scheduleId, updated);
    return { ...updated };
  }

  async softDeleteSchedule(scheduleId: string): Promise<boolean> {
    const found = this.records.get(scheduleId);
    if (found === undefined || found.deletedAt !== null) return false;
    if (found.isSystem) {
      throw Object.assign(new Error(`schedule ${scheduleId} is read-only`), {
        code: "schedule.system_immutable",
      });
    }
    this.records.set(scheduleId, { ...found, deletedAt: NOW, updatedAt: NOW });
    return true;
  }
}

class FakeQueue implements ScheduleRunQueue {
  readonly envelopes: Array<Record<string, unknown>> = [];

  async enqueue(envelope: unknown): Promise<string> {
    const record = envelope as Record<string, unknown>;
    this.envelopes.push(record);
    return String(record["jobId"]);
  }
}

// History derives from the enqueued jobs the way the wiring ticket maps the
// EPIC-003 queue persistence: every envelope carries its schedule id, so a
// run-now enqueue shows up in that schedule's history without extra writes.
class QueueBackedHistory implements ScheduleHistoryStore {
  constructor(private readonly queue: FakeQueue) {}

  async listScheduleRuns(scheduleId: string): Promise<ScheduleRunRecord[]> {
    return this.queue.envelopes
      .filter((envelope) => envelope["scheduleId"] === scheduleId)
      .map((envelope) => ({
        runId: String(envelope["runId"]),
        jobId: String(envelope["jobId"]),
        scheduleId: String(envelope["scheduleId"]),
        startedAt: String(envelope["createdAt"]),
        finishedAt: null,
        outcome: "queued" as const,
        error: null,
      }));
  }
}

function record(id: string, extra: Partial<ScheduleRecord> = {}): ScheduleRecord {
  return {
    id,
    name: `Task ${id}`,
    type: "assessment",
    cron: "0 0 * * * *",
    timezone: "UTC",
    targetScope: { type: "tenant", id: TENANT_A },
    command: "Invoke-M365Assessment",
    parameters: {},
    enabled: true,
    isSystem: false,
    lastRunAt: null,
    nextRunAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...extra,
  };
}

function adminCaller(): ScheduleCaller {
  return { roles: ["admin"], tenantScope: ALL_TENANTS, userId: "operator-1" };
}

function scopedCaller(): ScheduleCaller {
  return { roles: ["operator"], tenantScope: tenantScope([TENANT_A]), userId: "operator-2" };
}

interface Harness {
  routes: Route[];
  store: MemoryScheduleStore;
  queue: FakeQueue;
  seenPermissions: string[];
}

function harness(overrides: Partial<ScheduleRouteOptions> = {}): Harness {
  const store = new MemoryScheduleStore();
  const queue = new FakeQueue();
  const seenPermissions: string[] = [];
  const routes = createScheduleRoutes({
    store,
    history: new QueueBackedHistory(queue),
    queue,
    resolveCaller: () => adminCaller(),
    authorize: (caller, permission) => {
      void caller;
      seenPermissions.push(permission);
    },
    now: () => NOW,
    newIds: () => ({
      jobId: "job-1",
      runId: "run-1",
      requestId: "req-1",
      correlationId: "corr-1",
    }),
    ...overrides,
  });
  return { routes, store, queue, seenPermissions };
}

interface TestContext {
  correlationId: string;
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  params: Record<string, string>;
  body?: unknown;
}

type HandlerContext = Parameters<RouteHandler>[0];

function context(overrides: Partial<TestContext> = {}): HandlerContext {
  return {
    correlationId: "corr-test",
    method: "GET",
    path: SCHEDULES_PATH,
    query: new URLSearchParams(),
    headers: {},
    params: {},
    ...overrides,
  } as unknown as HandlerContext;
}

function findRoute(routes: readonly Route[], method: string, path: string): RouteHandler {
  const route = routes.find((candidate) => candidate.method === method && candidate.path === path);
  if (route === undefined) {
    throw new Error(`no route registered for ${method} ${path}`);
  }
  return route.handler;
}

function invoke(
  routes: readonly Route[],
  method: string,
  path: string,
  overrides: Partial<TestContext> = {},
): Promise<RouteResponse> {
  return Promise.resolve(
    findRoute(routes, method, path)(context({ method, path, ...overrides })),
  );
}

function createBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Nightly assessment",
    type: "assessment",
    cron: "0 0 * * * *",
    timezone: "UTC",
    targetScope: { type: "tenant", id: TENANT_A },
    command: "Invoke-M365Assessment",
    ...extra,
  };
}

describe("schedule routes", () => {
  it("registers the system path before the item path so /system is not shadowed", () => {
    const value = harness();
    const paths = value.routes.map((route) => `${route.method} ${route.path}`);
    expect(paths.indexOf(`GET ${SCHEDULE_SYSTEM_PATH}`)).toBeLessThan(
      paths.indexOf(`GET ${SCHEDULE_PATH}`),
    );
  });

  it("creates a task and reads, updates, and deletes it", async () => {
    const value = harness();
    const created = (await invoke(value.routes, "POST", SCHEDULES_PATH, {
      body: createBody({ id: "sch-1" }),
    })) as { status: number; body: ScheduleRecord };
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      id: "sch-1",
      name: "Nightly assessment",
      command: "Invoke-M365Assessment",
      isSystem: false,
    });
    expect(created.body.nextRunAt).not.toBeNull();

    const fetched = await invoke(value.routes, "GET", SCHEDULE_PATH, {
      params: { id: "sch-1" },
    });
    expect(fetched.status).toBe(200);
    expect(fetched.body).toMatchObject({ id: "sch-1" });

    const updated = (await invoke(value.routes, "PATCH", SCHEDULE_PATH, {
      params: { id: "sch-1" },
      body: { name: "Renamed", enabled: false },
    })) as { status: number; body: ScheduleRecord };
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: "Renamed", enabled: false });

    const removed = await invoke(value.routes, "DELETE", SCHEDULE_PATH, {
      params: { id: "sch-1" },
    });
    expect(removed.status).toBe(204);

    await expect(
      invoke(value.routes, "GET", SCHEDULE_PATH, { params: { id: "sch-1" } }),
    ).rejects.toMatchObject({ code: SCHEDULE_NOT_FOUND, status: 404 });
  });

  it("rejects a duplicate create with a structured conflict", async () => {
    const value = harness();
    value.store.records.set("sch-1", record("sch-1"));
    await expect(
      invoke(value.routes, "POST", SCHEDULES_PATH, { body: createBody({ id: "sch-1" }) }),
    ).rejects.toMatchObject({ code: SCHEDULE_CONFLICT, status: 409 });
  });

  it("rejects an unknown command at creation with a structured 422", async () => {
    const value = harness();
    const error = await invoke(value.routes, "POST", SCHEDULES_PATH, {
      body: createBody({ command: "Invoke-SomethingElse" }),
    }).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: SCHEDULE_UNKNOWN_COMMAND, status: 422 });
    expect(
      (error as { details?: Array<Record<string, unknown>> }).details?.[0],
    ).toMatchObject({ field: "command", reason: "unknown_command" });
  });

  it("rejects an unknown command on update with a structured 422", async () => {
    const value = harness();
    value.store.records.set("sch-1", record("sch-1"));
    await expect(
      invoke(value.routes, "PATCH", SCHEDULE_PATH, {
        params: { id: "sch-1" },
        body: { command: "Invoke-SomethingElse" },
      }),
    ).rejects.toMatchObject({ code: SCHEDULE_UNKNOWN_COMMAND, status: 422 });
  });

  it("accepts every system-timer command as a known command", async () => {
    const value = harness();
    for (const command of ["Invoke-StandardsRun", "Invoke-DriftRun", "Invoke-WebhookRenewal"]) {
      const response = (await invoke(value.routes, "POST", SCHEDULES_PATH, {
        body: createBody({ command }),
      })) as { status: number; body: ScheduleRecord };
      expect(response.status).toBe(201);
      expect(response.body.command).toBe(command);
    }
  });

  it("rejects an invalid cron with a 400", async () => {
    const value = harness();
    await expect(
      invoke(value.routes, "POST", SCHEDULES_PATH, { body: createBody({ cron: "not a cron" }) }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects creating a system timer through the user endpoint", async () => {
    const value = harness();
    await expect(
      invoke(value.routes, "POST", SCHEDULES_PATH, {
        body: createBody({ isSystem: true }),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("runs now by setting the task due immediately and enqueuing", async () => {
    const value = harness();
    value.store.records.set("sch-1", record("sch-1", { nextRunAt: "2026-07-01T00:00:00.000Z" }));
    const response = (await invoke(value.routes, "POST", SCHEDULE_RUN_NOW_PATH, {
      params: { id: "sch-1" },
    })) as { status: number; body: Record<string, unknown> };
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ scheduleId: "sch-1", jobId: "job-1", runId: "run-1" });

    expect(value.queue.envelopes).toHaveLength(1);
    expect(value.queue.envelopes[0]).toMatchObject({ trigger: "schedule", scheduleId: "sch-1" });
    expect(value.store.records.get("sch-1")?.nextRunAt).toBe(NOW);

    const history = (await invoke(value.routes, "GET", SCHEDULE_HISTORY_PATH, {
      params: { id: "sch-1" },
    })) as { status: number; body: { scheduleId: string; runs: ScheduleRunRecord[] } };
    expect(history.status).toBe(200);
    expect(history.body.scheduleId).toBe("sch-1");
    expect(history.body.runs.map((run) => run.jobId)).toEqual(["job-1"]);
  });

  it("returns history newest first", async () => {
    const value = harness();
    value.store.records.set("sch-1", record("sch-1"));
    value.queue.envelopes.push(
      { jobId: "job-old", runId: "run-old", scheduleId: "sch-1", createdAt: "2026-05-01T00:00:00.000Z" },
      { jobId: "job-new", runId: "run-new", scheduleId: "sch-1", createdAt: "2026-05-02T00:00:00.000Z" },
      { jobId: "job-other", runId: "run-other", scheduleId: "sch-9", createdAt: "2026-05-03T00:00:00.000Z" },
    );
    const history = (await invoke(value.routes, "GET", SCHEDULE_HISTORY_PATH, {
      params: { id: "sch-1" },
    })) as { status: number; body: { runs: ScheduleRunRecord[] } };
    expect(history.body.runs.map((run) => run.jobId)).toEqual(["job-new", "job-old"]);
  });

  it("rejects run-now for an unknown schedule and for one already running", async () => {
    const value = harness();
    await expect(
      invoke(value.routes, "POST", SCHEDULE_RUN_NOW_PATH, { params: { id: "sch-missing" } }),
    ).rejects.toMatchObject({ code: SCHEDULE_NOT_FOUND, status: 404 });

    const busy = harness({ isRunning: () => true });
    busy.store.records.set("sch-1", record("sch-1"));
    await expect(
      invoke(busy.routes, "POST", SCHEDULE_RUN_NOW_PATH, { params: { id: "sch-1" } }),
    ).rejects.toMatchObject({ code: SCHEDULE_ALREADY_RUNNING, status: 409 });
  });

  it("lists system timers read-only with a next run", async () => {
    const value = harness();
    const response = (await invoke(value.routes, "GET", SCHEDULE_SYSTEM_PATH)) as {
      status: number;
      body: { items: ScheduleRecord[] };
    };
    expect(response.status).toBe(200);
    expect(response.body.items.length).toBeGreaterThan(0);
    for (const item of response.body.items) {
      expect(item.isSystem).toBe(true);
      expect(item.id.startsWith("system-")).toBe(true);
    }
    expect(response.body.items.map((item) => item.name)).toContain("standards");
  });

  it("rejects any write attempt against the system collection", async () => {
    const value = harness();
    for (const method of ["POST", "PATCH", "DELETE"]) {
      await expect(
        invoke(value.routes, method, SCHEDULE_SYSTEM_PATH, { body: {} }),
      ).rejects.toMatchObject({ code: SCHEDULE_SYSTEM_IMMUTABLE, status: 403 });
    }
  });

  it("refuses to edit or delete a system timer addressed by id", async () => {
    const value = harness();
    await expect(
      invoke(value.routes, "PATCH", SCHEDULE_PATH, {
        params: { id: "system-standards" },
        body: { name: "Renamed" },
      }),
    ).rejects.toMatchObject({ code: SCHEDULE_SYSTEM_IMMUTABLE, status: 403 });
    await expect(
      invoke(value.routes, "DELETE", SCHEDULE_PATH, { params: { id: "system-standards" } }),
    ).rejects.toMatchObject({ code: SCHEDULE_SYSTEM_IMMUTABLE, status: 403 });

    const fetched = (await invoke(value.routes, "GET", SCHEDULE_PATH, {
      params: { id: "system-standards" },
    })) as { status: number; body: ScheduleRecord };
    expect(fetched.status).toBe(200);
    expect(fetched.body).toMatchObject({ id: "system-standards", isSystem: true });
  });

  it("refuses to edit or delete a stored row flagged as system", async () => {
    const value = harness();
    value.store.records.set("sch-sys", record("sch-sys", { isSystem: true }));
    await expect(
      invoke(value.routes, "PATCH", SCHEDULE_PATH, {
        params: { id: "sch-sys" },
        body: { name: "Renamed" },
      }),
    ).rejects.toMatchObject({ code: SCHEDULE_SYSTEM_IMMUTABLE, status: 403 });
    await expect(
      invoke(value.routes, "DELETE", SCHEDULE_PATH, { params: { id: "sch-sys" } }),
    ).rejects.toMatchObject({ code: SCHEDULE_SYSTEM_IMMUTABLE, status: 403 });
  });

  it("scopes tenant-targeted tasks to the caller", async () => {
    const value = harness({ resolveCaller: () => scopedCaller() });
    value.store.records.set("sch-a", record("sch-a"));
    value.store.records.set("sch-b", record("sch-b", {
      targetScope: { type: "tenant", id: TENANT_B },
    }));

    const listed = (await invoke(value.routes, "GET", SCHEDULES_PATH)) as {
      status: number;
      body: { items: ScheduleRecord[] };
    };
    expect(listed.body.items.map((item) => item.id)).toEqual(["sch-a"]);

    await expect(
      invoke(value.routes, "GET", SCHEDULE_PATH, { params: { id: "sch-b" } }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      invoke(value.routes, "POST", SCHEDULES_PATH, {
        body: createBody({ targetScope: { type: "tenant", id: TENANT_B } }),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("gates reads, writes, and runs on the scheduler permissions", async () => {
    const value = harness();
    value.store.records.set("sch-1", record("sch-1"));
    await invoke(value.routes, "GET", SCHEDULES_PATH);
    await invoke(value.routes, "POST", SCHEDULES_PATH, { body: createBody() });
    await invoke(value.routes, "GET", SCHEDULE_PATH, { params: { id: "sch-1" } });
    await invoke(value.routes, "PATCH", SCHEDULE_PATH, {
      params: { id: "sch-1" },
      body: { name: "Renamed" },
    });
    await invoke(value.routes, "POST", SCHEDULE_RUN_NOW_PATH, { params: { id: "sch-1" } });
    await invoke(value.routes, "GET", SCHEDULE_HISTORY_PATH, { params: { id: "sch-1" } });
    await invoke(value.routes, "GET", SCHEDULE_SYSTEM_PATH);
    await invoke(value.routes, "DELETE", SCHEDULE_PATH, { params: { id: "sch-1" } });
    expect(value.seenPermissions).toEqual([
      "CIPP.Scheduler.Read",
      "CIPP.Scheduler.ReadWrite",
      "CIPP.Scheduler.Read",
      "CIPP.Scheduler.ReadWrite",
      "CIPP.Scheduler.ReadWrite",
      "CIPP.Scheduler.Read",
      "CIPP.Scheduler.Read",
      "CIPP.Scheduler.ReadWrite",
    ]);
  });

  it("requires authentication", async () => {
    const value = harness({ resolveCaller: () => undefined });
    await expect(invoke(value.routes, "GET", SCHEDULES_PATH)).rejects.toMatchObject({
      status: 401,
    });
  });

  it("publishes every endpoint in the OpenAPI fragment", () => {
    expect(Object.keys(SCHEDULES_OPENAPI.paths)).toEqual(
      expect.arrayContaining([
        "/schedules",
        "/schedules/system",
        "/schedules/{id}",
        "/schedules/{id}/run-now",
        "/schedules/{id}/history",
      ]),
    );
    expect(SCHEDULES_OPENAPI.paths["/schedules"].post.responses).toHaveProperty("422");
    expect(SCHEDULES_OPENAPI.paths["/schedules/{id}"].patch.responses).toHaveProperty("403");
  });
});
