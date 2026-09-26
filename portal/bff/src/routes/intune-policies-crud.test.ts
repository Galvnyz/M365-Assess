// Tests for Intune policy CRUD BFF route (T-0302).
import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { tenantScope } from "../rbac/scope.js";
import {
  INTUNE_CRUD_BASE_PATH,
  INTUNE_CRUD_ITEM_PATH,
  INTUNE_WRITE_PERMISSION,
  createIntuneCrudRoutes,
  type IntuneCrudProvider,
  type IntuneCrudResult,
  type IntuneCrudRoutesOptions,
  type IntunePlan,
  type IntunePolicyCreateInput,
  type IntunePolicyEditInput,
} from "./intune-policies-crud.js";

const TENANT = "tenant-crud-test";

class FakeIntuneCrudProvider implements IntuneCrudProvider {
  readonly createCalls: Array<{
    tenantId: string;
    kind: string;
    input: IntunePolicyCreateInput;
    preview: boolean;
  }> = [];
  readonly editCalls: Array<{
    tenantId: string;
    kind: string;
    policyId: string;
    input: IntunePolicyEditInput;
    preview: boolean;
  }> = [];
  readonly deleteCalls: Array<{
    tenantId: string;
    kind: string;
    policyId: string;
    confirmName: string;
    preview: boolean;
  }> = [];

  samplePlan: IntunePlan = {
    action: "create",
    kind: "configuration",
    policyId: undefined,
    targetName: "Windows Security Baseline",
    before: null,
    after: { name: "Windows Security Baseline", platforms: "windows" },
    diff: ["+ Policy created: Windows Security Baseline"],
    valid: true,
    dryRun: true,
    requiresConfirmation: false,
  };

  sampleResult: IntuneCrudResult = {
    success: true,
    plan: {
      action: "create",
      kind: "configuration",
      policyId: "pol-new-1",
      targetName: "Windows Security Baseline",
      before: null,
      after: { name: "Windows Security Baseline" },
      diff: ["+ Policy created: Windows Security Baseline"],
      valid: true,
      dryRun: false,
      requiresConfirmation: false,
    },
    result: { id: "pol-new-1" },
    auditEvent: {
      id: "audit-1",
      tenantId: TENANT,
      action: "intune.configuration.create",
      targetId: "pol-new-1",
      targetName: "Windows Security Baseline",
      kind: "configuration",
      timestamp: "2026-09-26T19:00:00Z",
      before: null,
      after: { name: "Windows Security Baseline" },
    },
  };

  async createPolicy(
    tenantId: string,
    kind: string,
    input: IntunePolicyCreateInput,
    preview: boolean,
  ): Promise<IntuneCrudResult | IntunePlan> {
    this.createCalls.push({ tenantId, kind, input, preview });
    return preview ? this.samplePlan : this.sampleResult;
  }

  async editPolicy(
    tenantId: string,
    kind: string,
    policyId: string,
    input: IntunePolicyEditInput,
    preview: boolean,
  ): Promise<IntuneCrudResult | IntunePlan> {
    this.editCalls.push({ tenantId, kind, policyId, input, preview });
    return preview ? { ...this.samplePlan, action: "edit" } : { ...this.sampleResult };
  }

  async deletePolicy(
    tenantId: string,
    kind: string,
    policyId: string,
    confirmName: string,
    preview: boolean,
  ): Promise<IntuneCrudResult | IntunePlan> {
    this.deleteCalls.push({ tenantId, kind, policyId, confirmName, preview });
    return preview
      ? { ...this.samplePlan, action: "delete" }
      : { ...this.sampleResult, plan: { ...this.sampleResult.plan, action: "delete" } };
  }
}

function createHarness(overrides?: Partial<IntuneCrudRoutesOptions>) {
  const provider = new FakeIntuneCrudProvider();
  let defaultCaller: any = {
    userId: "user-1",
    roles: ["admin"],
    permissions: [INTUNE_WRITE_PERMISSION],
    tenantScope: tenantScope([TENANT]),
  };

  const routes = createIntuneCrudRoutes({
    provider,
    resolveCaller: () => defaultCaller,
    ...overrides,
  });

  const getRoute = (method: string, path: string) => {
    const route = routes.find((r) => r.method === method && r.path === path);
    if (!route) throw new Error(`Route not found: ${method} ${path}`);
    return route;
  };

  return {
    provider,
    routes,
    getRoute,
    setCaller: (c: any) => {
      defaultCaller = c;
    },
  };
}

function makeCreateCtx(kind: string, body: Record<string, unknown> = {}) {
  return {
    path: `/v1/tenants/${TENANT}/intune/${kind}`,
    params: { tenantId: TENANT, kind },
    query: new URLSearchParams(),
    headers: {},
    body: { displayName: "Windows Security Baseline", platform: "windows", ...body },
  };
}

function makeItemCtx(
  kind: string,
  policyId: string,
  body: Record<string, unknown> = {},
) {
  return {
    path: `/v1/tenants/${TENANT}/intune/${kind}/${policyId}`,
    params: { tenantId: TENANT, kind, policyId },
    query: new URLSearchParams(),
    headers: {},
    body,
  };
}

describe("POST /v1/tenants/:tenantId/intune/:kind (T-0302 create)", () => {
  it("rejects unauthenticated caller", async () => {
    const harness = createHarness({ resolveCaller: () => undefined });
    const route = harness.getRoute("POST", INTUNE_CRUD_BASE_PATH);
    await expect(route.handler(makeCreateCtx("configuration"))).rejects.toMatchObject({
      status: 401,
    });
  });

  it("rejects caller without write permission", async () => {
    const harness = createHarness();
    harness.setCaller({
      userId: "user-2",
      permissions: ["intune.read"],
      tenantScope: tenantScope([TENANT]),
    });
    const route = harness.getRoute("POST", INTUNE_CRUD_BASE_PATH);
    await expect(route.handler(makeCreateCtx("configuration"))).rejects.toMatchObject({
      status: 403,
    });
  });

  it("returns 400 for unknown kind", async () => {
    const harness = createHarness();
    const route = harness.getRoute("POST", INTUNE_CRUD_BASE_PATH);
    await expect(
      route.handler({ ...makeCreateCtx("scripts"), params: { tenantId: TENANT, kind: "scripts" } }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("returns 501 for app-protection (unsupported in v1)", async () => {
    const harness = createHarness();
    const route = harness.getRoute("POST", INTUNE_CRUD_BASE_PATH);
    await expect(
      route.handler({
        ...makeCreateCtx("app-protection"),
        params: { tenantId: TENANT, kind: "app-protection" },
      }),
    ).rejects.toMatchObject({ status: 501 });
  });

  it("returns 201 with audit event on successful create", async () => {
    const harness = createHarness();
    const route = harness.getRoute("POST", INTUNE_CRUD_BASE_PATH);
    const res = await route.handler(makeCreateCtx("configuration"));
    expect(res.status).toBe(201);
    const body = JSON.parse(res.body as string) as IntuneCrudResult;
    expect(body.success).toBe(true);
    expect(body.auditEvent).toBeDefined();
    expect(body.auditEvent!.action).toBe("intune.configuration.create");
    expect(harness.provider.createCalls[0]!.kind).toBe("configuration");
    expect(harness.provider.createCalls[0]!.preview).toBe(false);
  });

  it("returns 200 plan on preview=true create", async () => {
    const harness = createHarness();
    const route = harness.getRoute("POST", INTUNE_CRUD_BASE_PATH);
    const res = await route.handler(makeCreateCtx("configuration", { preview: true }));
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string) as IntunePlan;
    expect(body.dryRun).toBe(true);
    expect(harness.provider.createCalls[0]!.preview).toBe(true);
  });

  it("returns 400 when displayName is missing and not preview", async () => {
    const harness = createHarness();
    const route = harness.getRoute("POST", INTUNE_CRUD_BASE_PATH);
    await expect(
      route.handler({
        path: `/v1/tenants/${TENANT}/intune/configuration`,
        params: { tenantId: TENANT, kind: "configuration" },
        query: new URLSearchParams(),
        headers: {},
        body: { platform: "windows" },
      }),
    ).rejects.toMatchObject({ status: 400, code: "request.validation_failed" });
  });

  it("forwards settings and policyJson to provider", async () => {
    const harness = createHarness();
    const route = harness.getRoute("POST", INTUNE_CRUD_BASE_PATH);
    const settings = { "device.encryption": true };
    await route.handler(
      makeCreateCtx("compliance", { settings, policyJson: '{"key":"val"}' }),
    );
    const call = harness.provider.createCalls[0]!;
    expect(call.input.settings).toEqual(settings);
    expect(call.input.policyJson).toBe('{"key":"val"}');
  });
});

describe("PATCH /v1/tenants/:tenantId/intune/:kind/:policyId (T-0302 edit)", () => {
  it("returns 200 with updated result", async () => {
    const harness = createHarness();
    const route = harness.getRoute("PATCH", INTUNE_CRUD_ITEM_PATH);
    const res = await route.handler(
      makeItemCtx("configuration", "pol-1", { displayName: "Updated Policy" }),
    );
    expect(res.status).toBe(200);
    const call = harness.provider.editCalls[0]!;
    expect(call.policyId).toBe("pol-1");
    expect(call.kind).toBe("configuration");
    expect(call.input.displayName).toBe("Updated Policy");
  });

  it("returns 200 plan on preview=true edit", async () => {
    const harness = createHarness();
    const route = harness.getRoute("PATCH", INTUNE_CRUD_ITEM_PATH);
    const res = await route.handler(
      makeItemCtx("configuration", "pol-1", { preview: true }),
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string) as IntunePlan;
    expect(body.action).toBe("edit");
  });

  it("captures assignment changes in edit input", async () => {
    const harness = createHarness();
    const route = harness.getRoute("PATCH", INTUNE_CRUD_ITEM_PATH);
    const assignments = [{ id: "asgn-1", target: "All Devices", targetType: "allDevicesAssignmentTarget" }];
    await route.handler(makeItemCtx("compliance", "pol-2", { assignments }));
    expect(harness.provider.editCalls[0]!.input.assignments).toEqual(assignments);
  });
});

describe("DELETE /v1/tenants/:tenantId/intune/:kind/:policyId (T-0302 delete)", () => {
  it("returns 200 with audit event on delete", async () => {
    const harness = createHarness();
    const route = harness.getRoute("DELETE", INTUNE_CRUD_ITEM_PATH);
    const res = await route.handler(
      makeItemCtx("configuration", "pol-1", { confirmName: "Windows Security Baseline" }),
    );
    expect(res.status).toBe(200);
    const call = harness.provider.deleteCalls[0]!;
    expect(call.policyId).toBe("pol-1");
    expect(call.confirmName).toBe("Windows Security Baseline");
    expect(call.kind).toBe("configuration");
  });

  it("returns 200 plan on preview=true delete", async () => {
    const harness = createHarness();
    const route = harness.getRoute("DELETE", INTUNE_CRUD_ITEM_PATH);
    const res = await route.handler(makeItemCtx("configuration", "pol-1", { preview: true }));
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string) as IntunePlan;
    expect(body.action).toBe("delete");
  });

  it("forwards empty confirmName when not provided (enforcement deferred to worker)", async () => {
    const harness = createHarness();
    const route = harness.getRoute("DELETE", INTUNE_CRUD_ITEM_PATH);
    await route.handler(makeItemCtx("compliance", "pol-3"));
    expect(harness.provider.deleteCalls[0]!.confirmName).toBe("");
  });
});
