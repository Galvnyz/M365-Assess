import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { tenantScope } from "../rbac/scope.js";
import type { Route } from "../server.js";
import {
  ASSIGNMENT_FILTERS_PATH,
  ASSIGNMENT_FILTER_PATH,
  ASSIGNMENT_FILTER_PLATFORMS,
  FILTER_TEMPLATES_PATH,
  FILTER_TEMPLATE_DEPLOY_PATH,
  FILTER_TEMPLATE_PATH,
  InMemoryAssignmentFilterTemplateRepository,
  SqliteAssignmentFilterTemplateRepository,
  collectFilterIssues,
  createAssignmentFilterRoutes,
  validateFilterRule,
  type AssignmentFilterCaller,
  type AssignmentFilterProvider,
  type AssignmentFilterRequestContext,
  type AssignmentFilterTemplateRepository,
  type GraphFilterInput,
} from "./intune-assignment-filters.js";

const T1 = "tenant-a";
const T2 = "tenant-b";
const RULE = '(device.deviceOwnership -eq "Corporate") and (device.model -startsWith "Surface")';

const OPERATOR: AssignmentFilterCaller = {
  userId: "user-operator",
  roles: ["operator"],
  tenantScope: tenantScope([T1, T2]),
};
const ALL = ["Endpoint.Intune.Read", "Endpoint.Intune.ReadWrite", "Endpoint.IntuneTemplate.ReadWrite"];

describe("filter rule grammar (T-0309)", () => {
  it.each([
    '(device.deviceName -startsWith "HR-")',
    'device.deviceName -eq "PC1"',
    '(device.manufacturer -in ["Dell", "HP"]) or (device.model -notContains "VM")',
    RULE,
    '((device.osVersion -startsWith "10.0.2") and (device.deviceOwnership -eq "Corporate")) or (device.isRooted -eq "False")',
    '(DEVICE.DEVICENAME -EQ "x") AND (device.model -match "^Surface")',
  ])("accepts %s", (rule) => {
    expect(validateFilterRule(rule)).toEqual([]);
  });

  it.each([
    ["", "rule must be a non-empty string"],
    ['(device.deviceName -eq "x"', "expected ')'"],
    ['(device.deviceName -eq "x)', "unterminated string value"],
    ['(device.color -eq "red")', "unknown property 'device.color'"],
    ['(device.deviceName -like "x")', "expected an operator"],
    ['(device.deviceName -eq x)', "expected a quoted value"],
    ['(device.deviceName -in "x")', '-in and -notIn take a ["..."] list'],
    ['(device.deviceName -eq ["x"])', "a [...] list is only valid with -in or -notIn"],
    ['(device.manufacturer -in ["Dell" "HP"])', "expected ',' or ']'"],
    ['(device.deviceName -eq "x") xor (device.model -eq "y")', "expected 'and', 'or', or the end of the rule"],
  ])("rejects %j", (rule, message) => {
    const issues = validateFilterRule(rule);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain(message);
  });

  it("reports the position of the offending token", () => {
    expect(validateFilterRule('(device.deviceName -eq "x") and (device.colour -eq "y")')[0]!.position).toBe(33);
  });

  it("enforces the Intune length limit", () => {
    const long = `(device.deviceName -eq "${"x".repeat(3100)}")`;
    expect(validateFilterRule(long)[0]!.message).toMatch(/exceeds 3072/);
  });

  it("validates platforms against the T-0301 registry", () => {
    expect([...ASSIGNMENT_FILTER_PLATFORMS].sort()).toEqual(["android", "ios", "macos", "windows"]);
    expect(collectFilterIssues({ displayName: "x", platform: "windowsPhone", rule: RULE })).toEqual([
      expect.objectContaining({ field: "platform" }),
    ]);
    expect(collectFilterIssues({ displayName: "x", platform: "ios", rule: RULE })).toEqual([]);
  });
});

describe.each([
  ["in-memory", () => new InMemoryAssignmentFilterTemplateRepository()],
  ["sqlite", () => new SqliteAssignmentFilterTemplateRepository(new Database(":memory:"))],
] as const)("AssignmentFilterTemplate repository (%s) (T-0309)", (_name, make) => {
  it("persists, updates, lists, and soft-deletes", async () => {
    const repo: AssignmentFilterTemplateRepository = make();
    const created = await repo.create({ id: "t1", name: "Corporate", platform: "windows", rule: RULE });
    expect(created).toMatchObject({ source: "local", platform: "windows", rule: RULE });
    await repo.create({ id: "t0", name: "Apple", platform: "ios", rule: '(device.model -startsWith "iPad")' });
    expect((await repo.list()).map((t) => t.name)).toEqual(["Apple", "Corporate"]);
    expect((await repo.update("t1", { rule: '(device.model -eq "X")' }))?.rule).toBe('(device.model -eq "X")');
    expect(await repo.remove("t1")).toBe(true);
    expect(await repo.get("t1")).toBeUndefined();
    expect(await repo.remove("t1")).toBe(false);
  });

  it("rejects invalid rules and platforms with structured detail", async () => {
    const repo: AssignmentFilterTemplateRepository = make();
    await expect(repo.create({ name: "x", platform: "tvos", rule: "nope" })).rejects.toMatchObject({
      status: 400,
      code: "assignment_filter.invalid",
      details: [expect.objectContaining({ field: "platform" }), expect.objectContaining({ field: "rule" })],
    });
    await repo.create({ id: "ok", name: "ok", platform: "windows", rule: RULE });
    await expect(repo.update("ok", { rule: "(device.deviceName" })).rejects.toMatchObject({ status: 400 });
  });
});

class FakeProvider implements AssignmentFilterProvider {
  readonly calls: { op: string; tenantId: string; input?: unknown; filterId?: string; confirmName?: string; actor?: string }[] = [];

  async list(tenantId: string) {
    return [{ id: "f-1", displayName: "Corporate", description: "", platform: "windows" as const, graphPlatform: "windows10AndLater", rule: RULE }];
  }
  async create(tenantId: string, input: GraphFilterInput, actor: string) {
    this.calls.push({ op: "create", tenantId, input, actor });
    return { filter: null, auditEvent: { id: "a-create", before: null, after: input } };
  }
  async update(tenantId: string, filterId: string, input: Partial<GraphFilterInput>, actor: string) {
    this.calls.push({ op: "update", tenantId, filterId, input, actor });
    return { filter: null, auditEvent: { id: "a-update", before: { rule: RULE }, after: input } };
  }
  async remove(tenantId: string, filterId: string, confirmName: string, actor: string) {
    this.calls.push({ op: "remove", tenantId, filterId, confirmName, actor });
    return { filter: null, auditEvent: { id: "a-delete", before: { id: filterId }, after: null } };
  }
  async planDeploy(tenantId: string, input: GraphFilterInput) {
    this.calls.push({ op: "plan", tenantId, input });
    if (tenantId === T2) throw new Error("tenant-b unreachable");
    return { tenantId, action: "create" as const, filterId: null, diff: [`+ rule: ${input.rule}`], valid: true };
  }
  async deploy(tenantId: string, input: GraphFilterInput, actor: string) {
    this.calls.push({ op: "deploy", tenantId, input, actor });
    if (tenantId === T2) throw new Error("Graph 403");
    return { tenantId, state: "succeeded" as const, filterId: "f-new", auditEvent: { id: `a-deploy-${tenantId}` } };
  }
}

function ctx(
  path: string,
  params: Record<string, string>,
  body?: unknown,
  permissions: readonly string[] = ALL,
): AssignmentFilterRequestContext {
  return { correlationId: "c", method: "POST", path, params, query: new URLSearchParams(), headers: {}, body, permissions };
}

async function setup(caller: AssignmentFilterCaller | null = OPERATOR) {
  const repository = new InMemoryAssignmentFilterTemplateRepository();
  await repository.create({ id: "tpl-corp", name: "Corporate laptops", platform: "windows", rule: RULE });
  const provider = new FakeProvider();
  const recordAudit = vi.fn(async () => {});
  const routes = createAssignmentFilterRoutes({ repository, provider, resolveCaller: () => caller ?? undefined, recordAudit });
  const route = (method: string, path: string): Route => routes.find((r) => r.method === method && r.path === path)!;
  return { provider, recordAudit, route };
}

describe("assignment filter tenant routes (T-0309)", () => {
  it("lists live filters", async () => {
    const { route } = await setup();
    const res = await route("GET", ASSIGNMENT_FILTERS_PATH).handler(ctx(ASSIGNMENT_FILTERS_PATH, { tenantId: T1 }));
    expect((res.body as any).items[0].displayName).toBe("Corporate");
  });

  it("creates with the Graph platform, audits, and rejects invalid input with structured errors", async () => {
    const { route, provider, recordAudit } = await setup();
    const res = await route("POST", ASSIGNMENT_FILTERS_PATH).handler(
      ctx(ASSIGNMENT_FILTERS_PATH, { tenantId: T1 }, { displayName: "Corporate", platform: "windows", rule: RULE }),
    );
    expect(res.status).toBe(201);
    expect(provider.calls[0]).toMatchObject({
      op: "create",
      input: { displayName: "Corporate", platform: "windows10AndLater", rule: RULE },
      actor: "user-operator",
    });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ id: "a-create", before: null }));

    await expect(
      route("POST", ASSIGNMENT_FILTERS_PATH).handler(
        ctx(ASSIGNMENT_FILTERS_PATH, { tenantId: T1 }, { displayName: "", platform: "tvos", rule: '(device.x -eq "y")' }),
      ),
    ).rejects.toMatchObject({
      status: 400,
      code: "assignment_filter.invalid",
      details: [
        expect.objectContaining({ field: "displayName" }),
        expect.objectContaining({ field: "platform" }),
        expect.objectContaining({ field: "rule", position: 1 }),
      ],
    });
    expect(provider.calls).toHaveLength(1);
  });

  it("edits the rule with audit and refuses a platform change", async () => {
    const { route, provider, recordAudit } = await setup();
    const res = await route("PATCH", ASSIGNMENT_FILTER_PATH).handler(
      ctx(ASSIGNMENT_FILTER_PATH, { tenantId: T1, filterId: "f-1" }, { rule: '(device.model -eq "X")' }),
    );
    expect(res.status).toBe(200);
    expect(provider.calls[0]).toMatchObject({ op: "update", filterId: "f-1", input: { rule: '(device.model -eq "X")' } });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ before: { rule: RULE } }));
    await expect(
      route("PATCH", ASSIGNMENT_FILTER_PATH).handler(
        ctx(ASSIGNMENT_FILTER_PATH, { tenantId: T1, filterId: "f-1" }, { platform: "ios" }),
      ),
    ).rejects.toMatchObject({ status: 400, details: [expect.objectContaining({ field: "platform" })] });
    await expect(
      route("PATCH", ASSIGNMENT_FILTER_PATH).handler(ctx(ASSIGNMENT_FILTER_PATH, { tenantId: T1, filterId: "f-1" }, {})),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("deletes only with a confirmName, and audits", async () => {
    const { route, provider, recordAudit } = await setup();
    await expect(
      route("DELETE", ASSIGNMENT_FILTER_PATH).handler(ctx(ASSIGNMENT_FILTER_PATH, { tenantId: T1, filterId: "f-1" }, {})),
    ).rejects.toMatchObject({ status: 400, details: [{ field: "confirmName", reason: "required" }] });
    await route("DELETE", ASSIGNMENT_FILTER_PATH).handler(
      ctx(ASSIGNMENT_FILTER_PATH, { tenantId: T1, filterId: "f-1" }, { confirmName: "Corporate" }),
    );
    expect(provider.calls[0]).toMatchObject({ op: "remove", confirmName: "Corporate" });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ id: "a-delete", after: null }));
  });

  it("enforces authentication, tenant scope, and write permission", async () => {
    const anon = await setup(null);
    await expect(
      anon.route("GET", ASSIGNMENT_FILTERS_PATH).handler(ctx(ASSIGNMENT_FILTERS_PATH, { tenantId: T1 })),
    ).rejects.toMatchObject({ status: 401 });
    const { route } = await setup();
    await expect(
      route("GET", ASSIGNMENT_FILTERS_PATH).handler(ctx(ASSIGNMENT_FILTERS_PATH, { tenantId: "tenant-z" })),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      route("POST", ASSIGNMENT_FILTERS_PATH).handler(
        ctx(ASSIGNMENT_FILTERS_PATH, { tenantId: T1 }, { displayName: "x", platform: "windows", rule: RULE }, ["Endpoint.Intune.Read"]),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("assignment filter templates and deploy (T-0309)", () => {
  it("creates, updates, and deletes templates, rejecting invalid rules", async () => {
    const { route } = await setup();
    const created = await route("POST", FILTER_TEMPLATES_PATH).handler(
      ctx(FILTER_TEMPLATES_PATH, {}, { name: "iPads", platform: "ios", rule: '(device.model -startsWith "iPad")' }),
    );
    expect(created.status).toBe(201);
    const id = (created.body as any).id;
    const patched = await route("PATCH", FILTER_TEMPLATE_PATH).handler(ctx(FILTER_TEMPLATE_PATH, { id }, { name: "iPads v2" }));
    expect((patched.body as any).name).toBe("iPads v2");
    const list = await route("GET", FILTER_TEMPLATES_PATH).handler(ctx(FILTER_TEMPLATES_PATH, {}));
    expect((list.body as any).items.map((t: any) => t.name)).toEqual(["Corporate laptops", "iPads v2"]);
    expect((await route("DELETE", FILTER_TEMPLATE_PATH).handler(ctx(FILTER_TEMPLATE_PATH, { id }))).status).toBe(204);
    await expect(
      route("POST", FILTER_TEMPLATES_PATH).handler(ctx(FILTER_TEMPLATES_PATH, {}, { name: "bad", platform: "ios", rule: "iPad" })),
    ).rejects.toMatchObject({ status: 400, details: [expect.objectContaining({ field: "rule" })] });
    await expect(
      route("POST", FILTER_TEMPLATES_PATH).handler(
        ctx(FILTER_TEMPLATES_PATH, {}, { name: "x", platform: "ios", rule: RULE }, ["Endpoint.Intune.Read"]),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("previews a deploy per target with the target count", async () => {
    const { route, provider } = await setup();
    const res = await route("POST", FILTER_TEMPLATE_DEPLOY_PATH).handler(
      ctx(FILTER_TEMPLATE_DEPLOY_PATH, { id: "tpl-corp" }, { targets: [T1, T2] }),
    );
    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body).toMatchObject({ preview: true, targetCount: 2, allValid: false });
    expect(body.plans[1]).toMatchObject({ tenantId: T2, valid: false, issue: "tenant-b unreachable" });
    expect(provider.calls[0]!.input).toEqual({ displayName: "Corporate laptops", platform: "windows10AndLater", rule: RULE });
    expect(provider.calls.some((c) => c.op === "deploy")).toBe(false);
  });

  it("deploys to many tenants only with the confirmed count and reports partial failure", async () => {
    const { route, recordAudit } = await setup();
    await expect(
      route("POST", FILTER_TEMPLATE_DEPLOY_PATH).handler(
        ctx(FILTER_TEMPLATE_DEPLOY_PATH, { id: "tpl-corp" }, { targets: [T1, T2], preview: false }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    const res = await route("POST", FILTER_TEMPLATE_DEPLOY_PATH).handler(
      ctx(FILTER_TEMPLATE_DEPLOY_PATH, { id: "tpl-corp" }, { targets: [T1, T2], preview: false, confirmTargetCount: 2 }),
    );
    expect(res.status).toBe(207);
    expect((res.body as any).results.map((r: any) => [r.tenantId, r.state])).toEqual([
      [T1, "succeeded"],
      [T2, "failed"],
    ]);
    expect(recordAudit).toHaveBeenCalledTimes(1);
  });

  it("rejects a deploy target outside the caller scope and an unknown template", async () => {
    const { route } = await setup({ roles: ["operator"], tenantScope: tenantScope([T1]) });
    await expect(
      route("POST", FILTER_TEMPLATE_DEPLOY_PATH).handler(ctx(FILTER_TEMPLATE_DEPLOY_PATH, { id: "tpl-corp" }, { targets: [T2] })),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      route("POST", FILTER_TEMPLATE_DEPLOY_PATH).handler(ctx(FILTER_TEMPLATE_DEPLOY_PATH, { id: "nope" }, { targets: [T1] })),
    ).rejects.toMatchObject({ status: 404 });
  });
});
