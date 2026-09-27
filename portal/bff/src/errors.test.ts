import { describe, expect, it } from "vitest";
import { ErrorCodes } from "./errors.js";
import { RbacErrorCodes } from "./rbac/authorize.js";
import { tenantScope } from "./rbac/scope.js";
import { InMemoryGroupTemplateRepository } from "./repository/group-templates.js";
import { GROUP_TEMPLATE_ITEM_PATH, createGroupTemplatesRoutes } from "./routes/group-templates.js";
import type { RequestContext } from "./server.js";

function request(path: string, params: Record<string, string> = {}): RequestContext {
  return { correlationId: "c", method: "GET", path, params, query: new URLSearchParams(), headers: {} };
}

describe("ErrorCodes (T-0813)", () => {
  it("defines forbidden and notFound", () => {
    expect(ErrorCodes.forbidden).toBe("auth.forbidden");
    expect(ErrorCodes.notFound).toBe("resource.not_found");
  });

  it("uses one code for every 403, whichever constant raised it", () => {
    expect(ErrorCodes.forbidden).toBe(RbacErrorCodes.forbidden);
  });

  it("keeps a missing resource distinct from an unknown route", () => {
    expect(ErrorCodes.notFound).not.toBe(ErrorCodes.routeNotFound);
  });

  it("every code is a defined, unique string", () => {
    const values = Object.values(ErrorCodes);
    expect(values.every((v) => typeof v === "string" && v.length > 0)).toBe(true);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("route errors carry a defined code (T-0813)", () => {
  const caller = (permissions: string[]) =>
    // Routes read an optional `permissions` list until the auth seam supplies one.
    ({ roles: ["operator"], tenantScope: tenantScope(["t-1"]), permissions }) as never;

  it("a 403 from a route using ErrorCodes.forbidden", async () => {
    const routes = createGroupTemplatesRoutes({
      repository: new InMemoryGroupTemplateRepository(),
      resolveCaller: () => caller([]),
    });
    const get = routes.find((r) => r.method === "GET" && r.path === GROUP_TEMPLATE_ITEM_PATH)!;
    await expect(get.handler(request("/v1/group-templates/x", { id: "x" }))).rejects.toMatchObject({
      status: 403,
      code: "auth.forbidden",
    });
  });

  it("a 404 from a route using ErrorCodes.notFound", async () => {
    const routes = createGroupTemplatesRoutes({
      repository: new InMemoryGroupTemplateRepository(),
      resolveCaller: () => caller(["groups.templates"]),
    });
    const get = routes.find((r) => r.method === "GET" && r.path === GROUP_TEMPLATE_ITEM_PATH)!;
    await expect(get.handler(request("/v1/group-templates/missing", { id: "missing" }))).rejects.toMatchObject({
      status: 404,
      code: "resource.not_found",
    });
  });
});
