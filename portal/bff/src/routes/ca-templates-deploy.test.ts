import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { tenantScope } from "../rbac/scope.js";
import type { CaTemplate, CaTemplateRepository } from "../repository/ca-templates.js";
import {
  CA_DEPLOY_PERMISSION,
  CA_TEMPLATE_DEPLOY_PATH,
  createCaTemplateDeployRoute,
  type CaDeployDrawerOptions,
  type CaDeployPlan,
  type CaDeployResult,
  type CaTemplateDeployProvider,
  type CaTemplateDeployRouteOptions,
} from "./ca-templates-deploy.js";

const TENANT = "tenant-test";

const SAFE_TEMPLATE: CaTemplate = {
  id: "tmpl-mfa",
  name: "Require MFA Template",
  source: "local",
  category: "Identity",
  version: 1,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  deletedAt: null,
  policyJson: {
    displayName: "Require MFA Policy",
    conditions: {
      users: {
        includeUsers: ["All"],
        excludeUsers: ["bg@contoso.com"],
      },
    },
    grantControls: {
      builtInControls: ["mfa"],
    },
  },
};

const DANGEROUS_TEMPLATE: CaTemplate = {
  id: "tmpl-block-all",
  name: "Block All Access",
  source: "local",
  category: "Security",
  version: 1,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  deletedAt: null,
  policyJson: {
    displayName: "Block All Access",
    conditions: {
      users: {
        includeUsers: ["All"],
        excludeUsers: [],
      },
    },
    grantControls: {
      builtInControls: ["block"],
    },
  },
};

class FakeRepo implements Partial<CaTemplateRepository> {
  private readonly store = new Map<string, CaTemplate>([
    [SAFE_TEMPLATE.id, SAFE_TEMPLATE],
    [DANGEROUS_TEMPLATE.id, DANGEROUS_TEMPLATE],
  ]);

  async get(id: string): Promise<CaTemplate | undefined> {
    return this.store.get(id);
  }
}

class FakeProvider implements CaTemplateDeployProvider {
  readonly planCalls: Array<{ template: CaTemplate; options: CaDeployDrawerOptions }> = [];
  readonly execCalls: Array<{ template: CaTemplate; options: CaDeployDrawerOptions }> = [];

  async planDeploy(template: CaTemplate, options: CaDeployDrawerOptions): Promise<CaDeployPlan> {
    this.planCalls.push({ template, options });
    return {
      action: options.overwrite ? "update" : "create",
      tenantId: options.tenantId,
      templateId: template.id,
      policyName: options.policyName || template.name,
      policyState: options.policyState || "enabledForReportingButNotEnforced",
      disableSecurityDefaults: Boolean(options.disableSecurityDefaults),
      overwrite: Boolean(options.overwrite),
      conflict: false,
      conflictMessage: null,
      diff: ["+ Policy"],
      groupsToCreate: options.createGroups ? ["SG-CA-Group"] : [],
      valid: true,
      dryRun: true,
    };
  }

  async executeDeploy(template: CaTemplate, options: CaDeployDrawerOptions): Promise<CaDeployResult> {
    this.execCalls.push({ template, options });
    const plan = await this.planDeploy(template, options);
    return {
      success: true,
      plan: { ...plan, dryRun: false },
      result: { id: "deployed-pol-id" },
      auditEvent: { action: "ca.template.deploy", targetId: "deployed-pol-id" },
    };
  }
}

function makeOptions(
  repo: FakeRepo,
  provider: FakeProvider,
  permissions: readonly string[] = [CA_DEPLOY_PERMISSION],
): CaTemplateDeployRouteOptions {
  return {
    repository: repo as CaTemplateRepository,
    provider,
    resolveCaller: () => ({
      tenantScope: tenantScope([TENANT]),
      permissions,
    }),
  };
}

describe("CA Template Deploy Route (T-0286)", () => {
  it("exposes POST /v1/ca-templates/:id/deploy", () => {
    const repo = new FakeRepo();
    const provider = new FakeProvider();
    const route = createCaTemplateDeployRoute(makeOptions(repo, provider));

    expect(route.method).toBe("POST");
    expect(route.path).toBe(CA_TEMPLATE_DEPLOY_PATH);
  });

  it("returns 404 when template not found", async () => {
    const repo = new FakeRepo();
    const provider = new FakeProvider();
    const route = createCaTemplateDeployRoute(makeOptions(repo, provider));

    await expect(
      route.handler({
        path: "/v1/ca-templates/tmpl-unknown/deploy",
        method: "POST",
        headers: {},
        params: { id: "tmpl-unknown" },
        query: new URLSearchParams(),
        body: { tenantId: TENANT },
      }),
    ).rejects.toThrow(AppError);
  });

  it("rejects unauthenticated request with 401", async () => {
    const repo = new FakeRepo();
    const provider = new FakeProvider();
    const route = createCaTemplateDeployRoute({
      repository: repo as CaTemplateRepository,
      provider,
      resolveCaller: () => undefined,
    });

    await expect(
      route.handler({
        path: `/v1/ca-templates/${SAFE_TEMPLATE.id}/deploy`,
        method: "POST",
        headers: {},
        params: { id: SAFE_TEMPLATE.id },
        query: new URLSearchParams(),
        body: { tenantId: TENANT },
      }),
    ).rejects.toThrow(AppError);
  });

  it("rejects unauthorized caller with 403", async () => {
    const repo = new FakeRepo();
    const provider = new FakeProvider();
    const route = createCaTemplateDeployRoute(makeOptions(repo, provider, ["other.read"]));

    await expect(
      route.handler({
        path: `/v1/ca-templates/${SAFE_TEMPLATE.id}/deploy`,
        method: "POST",
        headers: {},
        params: { id: SAFE_TEMPLATE.id },
        query: new URLSearchParams(),
        body: { tenantId: TENANT },
      }),
    ).rejects.toThrow(AppError);
  });

  it("hard-blocks deploy on All users + Block without break-glass exclusion with 400", async () => {
    const repo = new FakeRepo();
    const provider = new FakeProvider();
    const route = createCaTemplateDeployRoute(makeOptions(repo, provider));

    await expect(
      route.handler({
        path: `/v1/ca-templates/${DANGEROUS_TEMPLATE.id}/deploy`,
        method: "POST",
        headers: {},
        params: { id: DANGEROUS_TEMPLATE.id },
        query: new URLSearchParams(),
        body: { tenantId: TENANT },
      }),
    ).rejects.toThrow(AppError);
  });

  it("admits deploy on dangerous template when breakGlassExclusions provided", async () => {
    const repo = new FakeRepo();
    const provider = new FakeProvider();
    const route = createCaTemplateDeployRoute(makeOptions(repo, provider));

    const response = await route.handler({
      path: `/v1/ca-templates/${DANGEROUS_TEMPLATE.id}/deploy`,
      method: "POST",
      headers: {},
      params: { id: DANGEROUS_TEMPLATE.id },
      query: new URLSearchParams(),
      body: {
        tenantId: TENANT,
        breakGlassExclusions: ["breakglass@contoso.com"],
        preview: true,
      },
    });

    expect(response.status).toBe(200);
    expect(provider.planCalls).toHaveLength(1);
    expect(provider.planCalls[0]!.options.breakGlassExclusions).toContain("breakglass@contoso.com");
  });

  it("returns 200 with plan preview when preview flag is true", async () => {
    const repo = new FakeRepo();
    const provider = new FakeProvider();
    const route = createCaTemplateDeployRoute(makeOptions(repo, provider));

    const response = await route.handler({
      path: `/v1/ca-templates/${SAFE_TEMPLATE.id}/deploy`,
      method: "POST",
      headers: {},
      params: { id: SAFE_TEMPLATE.id },
      query: new URLSearchParams(),
      body: {
        tenantId: TENANT,
        policyState: "enabledForReportingButNotEnforced",
        disableSecurityDefaults: true,
        createGroups: true,
        overwrite: true,
        preview: true,
      },
    });

    expect(response.status).toBe(200);
    const plan = response.body as CaDeployPlan;
    expect(plan.dryRun).toBe(true);
    expect(plan.disableSecurityDefaults).toBe(true);
    expect(plan.groupsToCreate).toHaveLength(1);
  });

  it("executes deploy and returns 201 when preview is false", async () => {
    const repo = new FakeRepo();
    const provider = new FakeProvider();
    const route = createCaTemplateDeployRoute(makeOptions(repo, provider));

    const response = await route.handler({
      path: `/v1/ca-templates/${SAFE_TEMPLATE.id}/deploy`,
      method: "POST",
      headers: {},
      params: { id: SAFE_TEMPLATE.id },
      query: new URLSearchParams(),
      body: {
        tenantId: TENANT,
        policyState: "enabledForReportingButNotEnforced",
      },
    });

    expect(response.status).toBe(201);
    expect(provider.execCalls).toHaveLength(1);
    const res = response.body as CaDeployResult;
    expect(res.success).toBe(true);
    expect(res.auditEvent).toBeDefined();
  });
});
