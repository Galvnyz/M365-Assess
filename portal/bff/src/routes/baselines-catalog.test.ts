// T-0190 — local baseline catalog.
import { describe, expect, it } from "vitest";
import { ALL_TENANTS } from "../rbac/scope.js";
import { type Caller } from "../rbac/authorize.js";
import type { RequestContext } from "../server.js";
import { validateBaselineInput } from "../domain/baseline-validate.js";
import {
  BASELINES_CATALOG_OPENAPI,
  BASELINES_CATALOG_PATH,
  createBaselinesCatalogRoutes,
  loadBaselinesCatalog,
  type BaselinesCatalog,
} from "./baselines-catalog.js";

function ctx(): RequestContext {
  return {
    method: "GET",
    path: BASELINES_CATALOG_PATH,
    params: {},
    query: new Map(),
    headers: {},
    correlationId: "test-correlation",
  };
}

describe("local baseline catalog (T-0190)", () => {
  it("returns the local prebuilt baselines with their stages", () => {
    const catalog = loadBaselinesCatalog();
    expect(catalog.source).toBe("local");
    expect(catalog.entries.length).toBeGreaterThan(0);
    for (const entry of catalog.entries) {
      expect(entry.name.trim().length).toBeGreaterThan(0);
      expect(entry.stages.length).toBeGreaterThan(0);
      const orders = entry.stages.map((stage) => stage.order);
      expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    }
  });

  it("seeds a baseline that passes the T-0182 save validation", () => {
    const catalog = loadBaselinesCatalog();
    for (const entry of catalog.entries) {
      expect(() =>
        validateBaselineInput({
          name: entry.name,
          assignments: [{ targetType: "tenant", targetId: "contoso" }],
          stages: entry.stages.map((stage) => ({
            order: stage.order,
            conditions: [...stage.conditions],
            action: stage.action,
          })),
        }),
      ).not.toThrow();
    }
  });

  it("marks the community source as unavailable without an EPIC-039 dependency", async () => {
    const routes = createBaselinesCatalogRoutes({
      resolveCaller: () => ({ roles: ["admin"], tenantScope: ALL_TENANTS }) as Caller,
      authorize: () => {},
    });
    const response = await routes[0]!.handler(ctx());
    expect(response.status).toBe(200);
    const catalog = response.body as BaselinesCatalog;
    expect(catalog.community.available).toBe(false);
    expect(catalog.community.reason).toContain("EPIC-039");
  });

  it("documents the catalog endpoint", () => {
    expect(Object.keys(BASELINES_CATALOG_OPENAPI)).toEqual(["/v1/baselines/catalog"]);
  });
});
