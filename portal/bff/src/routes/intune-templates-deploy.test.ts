import { describe, expect, it, vi } from "vitest";
import { tenantScope } from "../rbac/scope.js";
import {
  InMemoryIntuneTemplateRepository,
  type IntuneTemplate,
} from "../repository/intune-templates.js";
import {
  INTUNE_TEMPLATE_DEPLOY_PATH,
  createIntuneTemplateDeployRoute,
  type IntuneDeployCaller,
  type IntuneDeployRequestContext,
  type IntuneDeployOptions,
  type IntuneTargetPlan,
  type IntuneTargetResult,
  type IntuneTemplateDeployProvider,
} from "./intune-templates-deploy.js";

const T1 = "tenant-a";
const T2 = "tenant-b";
const T3 = "tenant-c";
const TEMPLATE_ID = "tpl-win-compliance";

const OPERATOR: IntuneDeployCaller = {
  userId: "user-operator",
  roles: ["operator"],
  tenantScope: tenantScope([T1, T2, T3]),
};
const DEPLOYER = ["Endpoint.IntuneTemplate.ReadWrite", "Endpoint.Intune.ReadWrite"];

async function seededRepo(): Promise<InMemoryIntuneTemplateRepository> {
  const repo = new InMemoryIntuneTemplateRepository();
  await repo.create({
    id: TEMPLATE_ID,
    name: "Win Baseline",
    platform: "windows10",
    policyType: "compliance",
    policyJson: {
      displayName: "Win Baseline",
      "@odata.type": "#microsoft.graph.windows10CompliancePolicy",
    },
  });
  return repo;
}

/** Fake worker: T2 plans a conflict and deploys partially; T3 throws. */
class FakeProvider implements IntuneTemplateDeployProvider {
  readonly planCalls: { tenantId: string; options: IntuneDeployOptions }[] = [];
  readonly deployCalls: { tenantId: string; createdBy: string }[] = [];

  async planTarget(
    template: IntuneTemplate,
    tenantId: string,
    options: IntuneDeployOptions,
  ): Promise<IntuneTargetPlan> {
    this.planCalls.push({ tenantId, options });
    if (tenantId === T3) throw new Error("tenant-c: consent revoked");
    const conflict = tenantId === T2 && !options.overwrite;
    return {
      tenantId,
      policyName: options.policyName ?? template.name,
      action: tenantId === T2 && options.overwrite ? "update" : "create",
      conflict,
      conflictMessage: conflict ? "exists; enable overwrite" : null,
      groupsToCreate: options.createGroups ? [...options.groups] : [],
      assignments: [...options.groups],
      issues: [],
      diff: [`+ Policy: ${template.name}`],
      valid: !conflict,
    };
  }

  async deployTarget(
    template: IntuneTemplate,
    tenantId: string,
    _options: IntuneDeployOptions,
    createdBy: string,
  ): Promise<IntuneTargetResult> {
    this.deployCalls.push({ tenantId, createdBy });
    if (tenantId === T3) throw new Error("worker crashed");
    const partial = tenantId === T2;
    return {
      tenantId,
      state: partial ? "partial" : "succeeded",
      policyId: `pol-${tenantId}`,
      steps: [
        { step: "createPolicy", status: "succeeded" },
        { step: "assign", status: partial ? "failed" : "succeeded", ...(partial ? { error: "403" } : {}) },
      ],
      error: null,
      auditEvent: { id: `audit-${tenantId}`, tenantId, action: "intune.template.deploy.create", targetName: template.name },
    };
  }
}

function request(
  body: Record<string, unknown>,
  permissions: readonly string[] = DEPLOYER,
): IntuneDeployRequestContext {
  return {
    correlationId: "corr-1",
    method: "POST",
    path: INTUNE_TEMPLATE_DEPLOY_PATH.replace(":id", TEMPLATE_ID),
    params: { id: TEMPLATE_ID },
    query: new URLSearchParams(),
    headers: {},
    body,
    permissions,
  };
}

async function setup(caller: IntuneDeployCaller | null = OPERATOR) {
  const provider = new FakeProvider();
  const recordAudit = vi.fn(async () => {});
  const route = createIntuneTemplateDeployRoute({
    repository: await seededRepo(),
    provider,
    resolveCaller: () => caller ?? undefined,
    recordAudit,
  });
  return { route, provider, recordAudit };
}

describe("Intune template deploy route (T-0306)", () => {
  it("is mounted at POST /v1/intune-templates/:id/deploy", async () => {
    const { route } = await setup();
    expect(route.method).toBe("POST");
    expect(route.path).toBe("/v1/intune-templates/:id/deploy");
  });

  it("rejects unauthenticated requests with 401", async () => {
    const { route } = await setup(null);
    await expect(route.handler(request({ targets: [T1] }))).rejects.toMatchObject({ status: 401 });
  });

  it("requires intune.templates and write semantics", async () => {
    const { route } = await setup();
    for (const permissions of [["Endpoint.Intune.ReadWrite"], ["Endpoint.IntuneTemplate.ReadWrite"], ["Endpoint.Intune.Read"]]) {
      await expect(route.handler(request({ targets: [T1] }, permissions))).rejects.toMatchObject({
        status: 403,
      });
    }
    const res = await route.handler(
      request({ targets: [T1], preview: true }, ["Endpoint.IntuneTemplate.ReadWrite", "Remediation.Apply"]),
    );
    expect(res.status).toBe(200);
  });

  it("rejects a target tenant outside the caller scope", async () => {
    const { route } = await setup({ roles: ["operator"], tenantScope: tenantScope([T1]) });
    await expect(route.handler(request({ targets: [T1, T2] }))).rejects.toMatchObject({ status: 403 });
  });

  it("returns 404 for an unknown template", async () => {
    const { route } = await setup();
    await expect(
      route.handler({ ...request({ targets: [T1] }), params: { id: "missing" } }),
    ).rejects.toMatchObject({ status: 404, code: "intune_template.not_found" });
  });

  it("validates targets and the deploy-drawer options", async () => {
    const { route } = await setup();
    await expect(route.handler(request({}))).rejects.toMatchObject({ status: 400 });
    await expect(
      route.handler(request({ targets: [T1], assignmentMode: "everyone" })),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      route.handler(request({ targets: [T1], policyState: "paused" })),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      route.handler(request({ targets: [T1], assignmentMode: "groups", groups: [] })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("previews a per-target plan with the target count and passes the §3.2 options", async () => {
    const { route, provider } = await setup();
    const res = await route.handler(
      request({
        targets: [T1, T2, T3, T1],
        preview: true,
        assignmentMode: "groups",
        groups: ["Pilot"],
        policyState: "enabled",
        createGroups: true,
        policyName: "Win Baseline (Pilot)",
      }),
    );
    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.preview).toBe(true);
    expect(body.targetCount).toBe(3);
    expect(body.allValid).toBe(false);
    expect(body.plans.map((p: IntuneTargetPlan) => [p.tenantId, p.valid])).toEqual([
      [T1, true],
      [T2, false],
      [T3, false],
    ]);
    expect(body.plans[1].conflict).toBe(true);
    expect(body.plans[2].issues).toEqual(["tenant-c: consent revoked"]);
    expect(body.plans[0].groupsToCreate).toEqual(["Pilot"]);
    expect(provider.planCalls[0]!.options).toEqual({
      policyName: "Win Baseline (Pilot)",
      assignmentMode: "groups",
      groups: ["Pilot"],
      policyState: "enabled",
      overwrite: false,
      createGroups: true,
    });
    expect(provider.deployCalls).toHaveLength(0);
  });

  it("requires the confirmed target count before applying to many tenants", async () => {
    const { route, provider } = await setup();
    await expect(route.handler(request({ targets: [T1, T2] }))).rejects.toMatchObject({
      status: 400,
      details: [{ field: "confirmTargetCount", reason: "required" }],
    });
    await expect(
      route.handler(request({ targets: [T1, T2], confirmTargetCount: 3 })),
    ).rejects.toMatchObject({ status: 400 });
    expect(provider.deployCalls).toHaveLength(0);
  });

  it("applies to a single tenant without a target-count confirmation", async () => {
    const { route, recordAudit } = await setup();
    const res = await route.handler(request({ tenantId: T1 }));
    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.summary).toEqual({ succeeded: 1, partial: 0, failed: 0 });
    expect(recordAudit).toHaveBeenCalledTimes(1);
  });

  it("applies per target and reports partial failures with 207", async () => {
    const { route, provider, recordAudit } = await setup();
    const res = await route.handler(
      request({ targets: [T1, T2, T3], overwrite: true, confirmTargetCount: 3 }),
    );
    expect(res.status).toBe(207);
    const body = res.body as any;
    expect(body.success).toBe(true);
    expect(body.summary).toEqual({ succeeded: 1, partial: 1, failed: 1 });
    expect(body.results.map((r: IntuneTargetResult) => [r.tenantId, r.state])).toEqual([
      [T1, "succeeded"],
      [T2, "partial"],
      [T3, "failed"],
    ]);
    expect(body.results[1].steps[1]).toMatchObject({ step: "assign", status: "failed", error: "403" });
    expect(body.results[2].error).toBe("worker crashed");
    expect(provider.deployCalls.map((c) => c.createdBy)).toEqual([
      "user-operator",
      "user-operator",
      "user-operator",
    ]);
    expect(body.auditEvents.map((e: any) => e.id)).toEqual(["audit-tenant-a", "audit-tenant-b"]);
    expect(recordAudit).toHaveBeenCalledTimes(2);
  });

  it("answers 422 when every target fails", async () => {
    const { route } = await setup();
    const res = await route.handler(request({ targets: [T3] }));
    expect(res.status).toBe(422);
    expect((res.body as any).success).toBe(false);
  });
});
