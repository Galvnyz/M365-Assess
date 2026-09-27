import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { tenantScope } from "../rbac/scope.js";
import {
  CA_POLICIES_BASE_PATH,
  CA_POLICIES_ITEM_PATH,
  CA_WRITE_PERMISSION,
  createCaPoliciesCrudRoutes,
  type CaCrudResult,
  type CaPlan,
  type CaPoliciesCrudRoutesOptions,
  type CaPolicyCreateInput,
  type CaPolicyCrudProvider,
  type CaPolicyEditInput,
} from "./ca-policies-crud.js";

const TENANT = "tenant-test";

class FakeCaCrudProvider implements CaPolicyCrudProvider {
  readonly createCalls: Array<{ tenantId: string; input: CaPolicyCreateInput; preview: boolean }> = [];
  readonly editCalls: Array<{ tenantId: string; policyId: string; input: CaPolicyEditInput; preview: boolean }> = [];
  readonly deleteCalls: Array<{ tenantId: string; policyId: string; confirmName: string; preview: boolean }> = [];

  async createPolicy(
    tenantId: string,
    input: CaPolicyCreateInput,
    preview: boolean,
  ): Promise<CaCrudResult | CaPlan> {
    this.createCalls.push({ tenantId, input, preview });
    const plan: CaPlan = {
      action: "create",
      policyId: "new-ca-1",
      targetName: input.displayName || "Untitled",
      diff: ["+ Policy"],
      valid: true,
      dryRun: preview,
      requiresConfirmation: false,
    };
    if (preview) return plan;
    return {
      success: true,
      plan,
      result: { id: "new-ca-1", displayName: input.displayName },
    };
  }

  async editPolicy(
    tenantId: string,
    policyId: string,
    input: CaPolicyEditInput,
    preview: boolean,
  ): Promise<CaCrudResult | CaPlan> {
    this.editCalls.push({ tenantId, policyId, input, preview });
    const plan: CaPlan = {
      action: "edit",
      policyId,
      targetName: input.displayName || "Existing",
      diff: ["~ Updated"],
      valid: true,
      dryRun: preview,
      requiresConfirmation: false,
    };
    if (preview) return plan;
    return {
      success: true,
      plan,
      result: { id: policyId, displayName: input.displayName },
    };
  }

  async deletePolicy(
    tenantId: string,
    policyId: string,
    confirmName: string,
    preview: boolean,
  ): Promise<CaCrudResult | CaPlan> {
    this.deleteCalls.push({ tenantId, policyId, confirmName, preview });
    const plan: CaPlan = {
      action: "delete",
      policyId,
      targetName: confirmName,
      diff: ["- Policy"],
      valid: true,
      dryRun: preview,
      requiresConfirmation: true,
    };
    if (preview) return plan;
    return {
      success: true,
      plan,
    };
  }
}

function makeOptions(provider: FakeCaCrudProvider, permissions: readonly string[] = [CA_WRITE_PERMISSION]): CaPoliciesCrudRoutesOptions {
  return {
    provider,
    resolveCaller: () => ({
      tenantScope: tenantScope([TENANT]),
      permissions,
    }),
  };
}

describe("CA Policy CRUD Routes (T-0282)", () => {
  it("exposes POST, PATCH, and DELETE routes", () => {
    const provider = new FakeCaCrudProvider();
    const routes = createCaPoliciesCrudRoutes(makeOptions(provider));

    expect(routes).toHaveLength(3);
    expect(routes.find((r) => r.method === "POST" && r.path === CA_POLICIES_BASE_PATH)).toBeDefined();
    expect(routes.find((r) => r.method === "PATCH" && r.path === CA_POLICIES_ITEM_PATH)).toBeDefined();
    expect(routes.find((r) => r.method === "DELETE" && r.path === CA_POLICIES_ITEM_PATH)).toBeDefined();
  });

  it("rejects unauthenticated caller with 401", async () => {
    const provider = new FakeCaCrudProvider();
    const routes = createCaPoliciesCrudRoutes({
      provider,
      resolveCaller: () => undefined,
    });
    const postRoute = routes.find((r) => r.method === "POST")!;

    await expect(
      postRoute.handler({
        path: `/v1/tenants/${TENANT}/ca/policies`,
        method: "POST",
        headers: {},
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
        body: { displayName: "Test" },
      }),
    ).rejects.toThrow(AppError);
  });

  it("rejects missing ca.write permission with 403", async () => {
    const provider = new FakeCaCrudProvider();
    const routes = createCaPoliciesCrudRoutes(makeOptions(provider, ["Tenant.ConditionalAccess.Read"]));
    const postRoute = routes.find((r) => r.method === "POST")!;

    await expect(
      postRoute.handler({
        path: `/v1/tenants/${TENANT}/ca/policies`,
        method: "POST",
        headers: {},
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
        body: { displayName: "Test" },
      }),
    ).rejects.toThrow(AppError);
  });

  it("hard-blocks 'All users' + 'Block' without break-glass exclusion with 400", async () => {
    const provider = new FakeCaCrudProvider();
    const routes = createCaPoliciesCrudRoutes(makeOptions(provider));
    const postRoute = routes.find((r) => r.method === "POST")!;

    await expect(
      postRoute.handler({
        path: `/v1/tenants/${TENANT}/ca/policies`,
        method: "POST",
        headers: {},
        params: { tenantId: TENANT },
        query: new URLSearchParams(),
        body: {
          displayName: "Block Everyone",
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
      }),
    ).rejects.toThrow(AppError);
  });

  it("defaults new policy state to report-only when unspecified", async () => {
    const provider = new FakeCaCrudProvider();
    const routes = createCaPoliciesCrudRoutes(makeOptions(provider));
    const postRoute = routes.find((r) => r.method === "POST")!;

    const response = await postRoute.handler({
      path: `/v1/tenants/${TENANT}/ca/policies`,
      method: "POST",
      headers: {},
      params: { tenantId: TENANT },
      query: new URLSearchParams(),
      body: {
        displayName: "New Safe Policy",
      },
    });

    expect(response.status).toBe(201);
    expect(provider.createCalls).toHaveLength(1);
    expect(provider.createCalls[0]!.input.state).toBe("enabledForReportingButNotEnforced");
  });

  it("returns 200 with plan preview when preview flag is set on create", async () => {
    const provider = new FakeCaCrudProvider();
    const routes = createCaPoliciesCrudRoutes(makeOptions(provider));
    const postRoute = routes.find((r) => r.method === "POST")!;

    const response = await postRoute.handler({
      path: `/v1/tenants/${TENANT}/ca/policies`,
      method: "POST",
      headers: {},
      params: { tenantId: TENANT },
      query: new URLSearchParams(),
      body: {
        displayName: "Preview Policy",
        preview: true,
      },
    });

    expect(response.status).toBe(200);
    expect(provider.createCalls).toHaveLength(1);
    expect(provider.createCalls[0]!.preview).toBe(true);
    const plan = response.body as CaPlan;
    expect(plan.dryRun).toBe(true);
  });

  it("handles PATCH and DELETE with provider delegation", async () => {
    const provider = new FakeCaCrudProvider();
    const routes = createCaPoliciesCrudRoutes(makeOptions(provider));
    const patchRoute = routes.find((r) => r.method === "PATCH")!;
    const deleteRoute = routes.find((r) => r.method === "DELETE")!;

    const patchRes = await patchRoute.handler({
      path: `/v1/tenants/${TENANT}/ca/policies/ca-1`,
      method: "PATCH",
      headers: {},
      params: { tenantId: TENANT, policyId: "ca-1" },
      query: new URLSearchParams(),
      body: { displayName: "Updated Name" },
    });
    expect(patchRes.status).toBe(200);
    expect(provider.editCalls).toHaveLength(1);
    expect(provider.editCalls[0]!.policyId).toBe("ca-1");

    const deleteRes = await deleteRoute.handler({
      path: `/v1/tenants/${TENANT}/ca/policies/ca-1`,
      method: "DELETE",
      headers: {},
      params: { tenantId: TENANT, policyId: "ca-1" },
      query: new URLSearchParams(),
      body: { confirmName: "Updated Name" },
    });
    expect(deleteRes.status).toBe(200);
    expect(provider.deleteCalls).toHaveLength(1);
    expect(provider.deleteCalls[0]!.confirmName).toBe("Updated Name");
  });
});
