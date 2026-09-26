import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { tenantScope } from "../rbac/scope.js";
import {
  InMemoryGroupTemplateRepository,
  type GroupTemplate,
} from "../repository/group-templates.js";
import {
  GROUP_TEMPLATE_DEPLOY_PATH,
  GROUPS_WRITE_PERMISSION,
  createGroupTemplatesDeployRoute,
  type DeployTemplateResult,
  type GroupTemplateDeployCaller,
  type GroupTemplateDeployProvider,
  type TargetDeployPlan,
} from "./group-templates-deploy.js";

const TENANT_1 = "tenant-a";
const TENANT_2 = "tenant-b";

const SAMPLE_TEMPLATE: GroupTemplate = {
  id: "tpl-dept-1",
  name: "Department Standard",
  groupType: "m365",
  naming: { prefix: "GRP-", suffix: "-Team", conflictBehavior: "block" },
  owners: ["user-admin-1"],
  members: ["user-member-1"],
  settings: { deliveryManagement: true },
  licensing: ["SPE_E5"],
  createdAt: "2026-09-26T18:00:00Z",
  updatedAt: "2026-09-26T18:00:00Z",
  deletedAt: null,
};

class FakeGroupTemplateDeployProvider implements GroupTemplateDeployProvider {
  async planDeploy(
    template: GroupTemplate,
    targets: readonly string[],
    variables?: Record<string, string>,
  ): Promise<readonly TargetDeployPlan[]> {
    return targets.map((tenantId) => ({
      tenantId,
      targetName: `GRP-${variables?.dept ?? "Dept"}-${template.name}-Team`,
      diff: [`Create group in ${tenantId}`],
      valid: tenantId !== "tenant-conflict",
      conflict: tenantId === "tenant-conflict",
      conflictError: tenantId === "tenant-conflict" ? "Name conflict in tenant" : null,
    }));
  }

  async executeDeploy(
    template: GroupTemplate,
    targets: readonly string[],
    variables?: Record<string, string>,
    createdBy?: string,
  ): Promise<readonly DeployTemplateResult[]> {
    return targets.map((tenantId) => {
      const isPartial = tenantId === TENANT_2;
      return {
        targetId: `grp-${tenantId}`,
        tenantId,
        deployment: {
          id: `dep-${tenantId}`,
          templateId: template.id,
          tenantId,
          state: isPartial ? "partial" : "succeeded",
          results: [
            { step: "createGroup", status: "succeeded" },
            { step: "members", status: isPartial ? "failed" : "succeeded", error: isPartial ? "Member missing" : undefined },
          ],
          createdBy: createdBy ?? "system",
          createdAt: "2026-09-26T18:00:00Z",
          updatedAt: "2026-09-26T18:00:00Z",
        },
        auditEvent: {
          id: `audit-${tenantId}`,
          tenantId,
          action: "group-template.deploy",
          targetId: `grp-${tenantId}`,
          targetName: template.name,
        },
      };
    });
  }
}

describe("Group template deploy route (T-0266)", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const repo = new InMemoryGroupTemplateRepository();
    const route = createGroupTemplatesDeployRoute({
      repository: repo,
      provider: new FakeGroupTemplateDeployProvider(),
      resolveCaller: () => undefined,
    });

    await expect(
      route.handler({
        method: "POST",
        path: `/v1/group-templates/tpl-1/deploy`,
        params: { id: "tpl-1" },
        query: new URLSearchParams(),
        headers: {},
        body: { targets: [TENANT_1] },
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects callers missing groups.write with 403", async () => {
    const repo = new InMemoryGroupTemplateRepository();
    const caller: GroupTemplateDeployCaller = {
      tenantScope: tenantScope([TENANT_1]),
      permissions: ["groups.read"],
    };
    const route = createGroupTemplatesDeployRoute({
      repository: repo,
      provider: new FakeGroupTemplateDeployProvider(),
      resolveCaller: () => caller,
    });

    await expect(
      route.handler({
        method: "POST",
        path: `/v1/group-templates/tpl-1/deploy`,
        params: { id: "tpl-1" },
        query: new URLSearchParams(),
        headers: {},
        body: { targets: [TENANT_1] },
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects target tenant outside caller scope with 403", async () => {
    const repo = new InMemoryGroupTemplateRepository();
    await repo.create({ id: SAMPLE_TEMPLATE.id, ...SAMPLE_TEMPLATE });

    const caller: GroupTemplateDeployCaller = {
      tenantScope: tenantScope([TENANT_1]), // missing TENANT_2
      permissions: [GROUPS_WRITE_PERMISSION],
    };
    const route = createGroupTemplatesDeployRoute({
      repository: repo,
      provider: new FakeGroupTemplateDeployProvider(),
      resolveCaller: () => caller,
    });

    await expect(
      route.handler({
        method: "POST",
        path: `/v1/group-templates/${SAMPLE_TEMPLATE.id}/deploy`,
        params: { id: SAMPLE_TEMPLATE.id },
        query: new URLSearchParams(),
        headers: {},
        body: { targets: [TENANT_1, TENANT_2] },
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("returns plan preview with resolved variables and conflict detail", async () => {
    const repo = new InMemoryGroupTemplateRepository();
    await repo.create({ id: SAMPLE_TEMPLATE.id, ...SAMPLE_TEMPLATE });

    const caller: GroupTemplateDeployCaller = {
      tenantScope: tenantScope([TENANT_1, "tenant-conflict"]),
      permissions: [GROUPS_WRITE_PERMISSION],
    };
    const route = createGroupTemplatesDeployRoute({
      repository: repo,
      provider: new FakeGroupTemplateDeployProvider(),
      resolveCaller: () => caller,
    });

    const response = await route.handler({
      method: "POST",
      path: `/v1/group-templates/${SAMPLE_TEMPLATE.id}/deploy`,
      params: { id: SAMPLE_TEMPLATE.id },
      query: new URLSearchParams("preview=true"),
      headers: {},
      body: {
        targets: [TENANT_1, "tenant-conflict"],
        variables: { dept: "Finance" },
      },
    });

    expect(response.status).toBe(200);
    const body = response.body as any;
    expect(body.preview).toBe(true);
    expect(body.plans).toHaveLength(2);
    expect(body.plans[0].valid).toBe(true);
    expect(body.plans[1].valid).toBe(false);
    expect(body.plans[1].conflict).toBe(true);
    expect(body.allValid).toBe(false);
  });

  it("executes deploy per target, records GroupTemplateDeployment and reports partial failures", async () => {
    const repo = new InMemoryGroupTemplateRepository();
    await repo.create({ id: SAMPLE_TEMPLATE.id, ...SAMPLE_TEMPLATE });

    const caller: GroupTemplateDeployCaller = {
      userId: "user-operator",
      tenantScope: tenantScope([TENANT_1, TENANT_2]),
      permissions: [GROUPS_WRITE_PERMISSION],
    };
    const route = createGroupTemplatesDeployRoute({
      repository: repo,
      provider: new FakeGroupTemplateDeployProvider(),
      resolveCaller: () => caller,
    });

    const response = await route.handler({
      method: "POST",
      path: `/v1/group-templates/${SAMPLE_TEMPLATE.id}/deploy`,
      params: { id: SAMPLE_TEMPLATE.id },
      query: new URLSearchParams(),
      headers: {},
      body: {
        targets: [TENANT_1, TENANT_2],
      },
    });

    // When one succeeded and one had partial failure, returns 207 Multi-Status
    expect(response.status).toBe(207);
    const body = response.body as any;
    expect(body.success).toBe(true);
    expect(body.deployments).toHaveLength(2);

    const dep1 = body.deployments.find((d: any) => d.tenantId === TENANT_1);
    expect(dep1.state).toBe("succeeded");
    expect(dep1.createdBy).toBe("user-operator");

    const dep2 = body.deployments.find((d: any) => d.tenantId === TENANT_2);
    expect(dep2.state).toBe("partial");
    expect(dep2.results[1].error).toBe("Member missing");
  });
});
