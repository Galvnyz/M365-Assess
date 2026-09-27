import { describe, expect, it } from "vitest";
import type { PolicyCompareResult } from "../domain/policy-compare.js";
import { tenantScope } from "../rbac/scope.js";
import { InMemoryIntuneTemplateRepository } from "../repository/intune-templates.js";
import {
  INTUNE_COMPARE_PATH,
  createIntuneCompareRoute,
  parseCompareRef,
  type ComparePolicy,
  type ComparePolicyProvider,
  type CompareRequestContext,
} from "./intune-compare.js";

const T1 = "tenant-a";

const POLICIES: Record<string, ComparePolicy> = {
  "compliance:p1": {
    id: "p1",
    displayName: "Win Compliance",
    platform: "windows",
    body: { "@odata.type": "#microsoft.graph.windows10CompliancePolicy", displayName: "Win Compliance", passwordRequired: true, passwordMinimumLength: 8 },
    assignments: [{ target: { "@odata.type": "#microsoft.graph.groupAssignmentTarget", groupId: "g-pilot" } }],
  },
  "compliance:p2": {
    id: "p2",
    displayName: "Win Compliance (strict)",
    platform: "windows",
    body: { "@odata.type": "#microsoft.graph.windows10CompliancePolicy", displayName: "Win Compliance (strict)", passwordRequired: true, passwordMinimumLength: 14 },
    assignments: [{ target: { "@odata.type": "#microsoft.graph.allDevicesAssignmentTarget" } }],
  },
  "configuration:c1": {
    id: "c1",
    displayName: "Defender",
    platform: "windows",
    body: { settings: [] },
    assignments: [],
  },
};

class FakeProvider implements ComparePolicyProvider {
  readonly calls: string[] = [];
  async getPolicy(tenantId: string, kind: string, policyId: string) {
    this.calls.push(`${tenantId}/${kind}/${policyId}`);
    return POLICIES[`${kind}:${policyId}`];
  }
}

async function setup() {
  const templates = new InMemoryIntuneTemplateRepository();
  await templates.create({
    id: "tpl-1",
    name: "Compliance baseline",
    platform: "windows10",
    policyType: "compliance",
    policyJson: {
      "@odata.type": "#microsoft.graph.windows10CompliancePolicy",
      displayName: "Compliance baseline",
      passwordRequired: true,
      passwordMinimumLength: 8,
      bitLockerEnabled: true,
    },
    assignments: [{ id: "g-pilot", target: "g-pilot", targetType: "groupAssignmentTarget" }],
  });
  const provider = new FakeProvider();
  const route = createIntuneCompareRoute({
    provider,
    templates,
    resolveCaller: () => ({ roles: ["operator"], tenantScope: tenantScope([T1]) }),
  });
  return { route, provider };
}

function ctx(query: string, tenantId = T1, permissions?: readonly string[]): CompareRequestContext {
  return {
    correlationId: "c",
    method: "GET",
    path: INTUNE_COMPARE_PATH.replace(":tenantId", tenantId),
    params: { tenantId },
    query: new URLSearchParams(query),
    headers: {},
    ...(permissions ? { permissions } : {}),
  };
}

describe("parseCompareRef (T-0310)", () => {
  it("parses policy and template references", () => {
    expect(parseCompareRef("policy:compliance:p1", "left", T1)).toEqual({ source: "policy", kind: "compliance", id: "p1" });
    expect(parseCompareRef("template:tpl-1", "right", T1)).toEqual({ source: "template", id: "tpl-1" });
    expect(parseCompareRef(`policy:compliance:p1@${T1}`, "left", T1)).toMatchObject({ id: "p1" });
  });

  it("rejects malformed references with a structured error", () => {
    for (const raw of [null, "", "policy:widgets:1", "policy:compliance:", "template:", "group:1"]) {
      expect(() => parseCompareRef(raw, "left", T1)).toThrowError(expect.objectContaining({ status: 400 }));
    }
  });
});

describe("GET /v1/tenants/:tenantId/intune/compare (T-0310)", () => {
  it("diffs two live policies, settings and assignments", async () => {
    const { route } = await setup();
    const res = await route.handler(ctx("left=policy:compliance:p1&right=policy:compliance:p2"));
    expect(res.status).toBe(200);
    const body = res.body as PolicyCompareResult;
    expect(body.settings).toEqual([{ path: "passwordMinimumLength", kind: "changed", left: 8, right: 14 }]);
    expect(body.assignments.map((a) => [a.kind, a.assignment.label])).toEqual([
      ["added", "All devices"],
      ["removed", "g-pilot"],
    ]);
    expect(body.left.label).toBe("Win Compliance");
    expect(body.identical).toBe(false);
  });

  it("diffs a policy against a template, matching assignments across shapes", async () => {
    const { route } = await setup();
    const res = await route.handler(ctx("left=policy:compliance:p1&right=template:tpl-1"));
    const body = res.body as PolicyCompareResult;
    expect(body.settings).toEqual([{ path: "bitLockerEnabled", kind: "added", right: true }]);
    expect(body.assignments).toEqual([]);
    expect(body.right).toMatchObject({ source: "template", platform: "windows10" });
  });

  it("rejects cross-tenant compare as deferred (501)", async () => {
    const { route, provider } = await setup();
    await expect(route.handler(ctx("left=policy:compliance:p1&right=policy:compliance:p2@tenant-b"))).rejects.toMatchObject({
      status: 501,
      code: "intune.compare.cross_tenant_deferred",
    });
    await expect(
      route.handler(ctx("left=policy:compliance:p1&right=policy:compliance:p2&rightTenantId=tenant-b")),
    ).rejects.toMatchObject({ status: 501 });
    expect(provider.calls).toEqual([]);
  });

  it("rejects kind mismatches, template<->template, and self-compare", async () => {
    const { route } = await setup();
    await expect(route.handler(ctx("left=policy:compliance:p1&right=policy:configuration:c1"))).rejects.toMatchObject({
      status: 400,
    });
    await expect(route.handler(ctx("left=template:tpl-1&right=template:tpl-1"))).rejects.toMatchObject({ status: 400 });
    await expect(route.handler(ctx("left=policy:compliance:p1&right=policy:compliance:p1"))).rejects.toMatchObject({
      status: 400,
    });
  });

  it("returns 404 for a missing policy or template", async () => {
    const { route } = await setup();
    await expect(route.handler(ctx("left=policy:compliance:nope&right=template:tpl-1"))).rejects.toMatchObject({
      status: 404,
      code: "intune.compare.not_found",
    });
    await expect(route.handler(ctx("left=policy:compliance:p1&right=template:nope"))).rejects.toMatchObject({ status: 404 });
  });

  it("requires tenant scope and intune.read", async () => {
    const { route } = await setup();
    await expect(route.handler(ctx("left=policy:compliance:p1&right=policy:compliance:p2", "tenant-z"))).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      route.handler(ctx("left=policy:compliance:p1&right=policy:compliance:p2", T1, ["intune.write"])),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("is read-only: a GET route that performs no writes", async () => {
    const { route } = await setup();
    expect(route.method).toBe("GET");
    expect(route.path).toBe("/v1/tenants/:tenantId/intune/compare");
  });
});
