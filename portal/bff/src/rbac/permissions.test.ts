import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { testPortalAccess } from "./test-portal-access.js";
import { OPENAPI_ROUTE, type Route } from "../server.js";
import { InMemoryCaTemplateRepository } from "../repository/ca-templates.js";
import type { CveExceptionRepository } from "../repository/cve-exceptions.js";
import { createInMemoryDefenderDeploymentTemplateRepository } from "../repository/defender-deployment-templates.js";
import { InMemoryIntuneTemplateRepository } from "../repository/intune-templates.js";
import { createApiClientRoutes, createInMemoryApiClientStore } from "../routes/api-clients.js";
import { createCaTemplateRoutes } from "../routes/ca-templates.js";
import {
  createDashboardLayoutRoutes,
  type DashboardLayoutStore,
} from "../routes/dashboard-layout.js";
import { createDefenderCveExceptionRoutes } from "../routes/defender-cve-exceptions.js";
import { createDefenderTemplateRoutes } from "../routes/defender-templates.js";
import { createDeviceActionsHistoryRoute } from "../routes/device-actions-history.js";
import { createIntuneTemplateRoutes } from "../routes/intune-templates.js";
import {
  createReportTemplateRoutes,
  type ReportTemplateDependencies,
  type ReportTemplateStore,
} from "../routes/report-templates.js";
import {
  PermissionRegistry,
  isPermissionString,
  isPublicPermission,
  isReservedPermission,
  permissionForEndpoint,
} from "./permissions.js";

const dashboardStore: DashboardLayoutStore = {
  getLayout: async () => {
    throw new Error("not used");
  },
  saveLayout: async () => {
    throw new Error("not used");
  },
  resetLayout: async () => {
    throw new Error("not used");
  },
};

// The CVE repository is a concrete class over sqlite; the factories only
// close over it, and this test never invokes a handler, so a structural stub
// is enough to enumerate the mounted routes.
const cveRepository = {
  list: async () => [],
  create: async () => {
    throw new Error("not used");
  },
  get: async () => undefined,
  update: async () => {
    throw new Error("not used");
  },
  remove: async () => false,
} as unknown as CveExceptionRepository;

const reportStore: ReportTemplateStore = {
  createTemplate: async () => {
    throw new Error("not used");
  },
  getTemplate: async () => undefined,
  listTemplates: async () => [],
  updateTemplate: async () => undefined,
  softDeleteTemplate: async () => false,
  cloneTemplate: async () => undefined,
};

const reportDeps: ReportTemplateDependencies = {
  store: reportStore,
  contract: { parse: (input: unknown) => input },
  render: {
    enqueue: async () => {
      throw new Error("not used");
    },
  },
};

function mountedEndpoints(): Route[] {
  return [
    { method: "GET", path: OPENAPI_ROUTE, handler: () => ({ status: 200, body: null }) },
    ...createApiClientRoutes(createInMemoryApiClientStore()),
    ...createCaTemplateRoutes(new InMemoryCaTemplateRepository()),
    ...createDashboardLayoutRoutes({
      store: dashboardStore,
      resolveCaller: () => ({ userId: "test-user" }),
    }),
    ...createDefenderTemplateRoutes(createInMemoryDefenderDeploymentTemplateRepository()),
    ...createDefenderCveExceptionRoutes({ repository: cveRepository, authorize: () => true }),
    ...createDeviceActionsHistoryRoute({ store: { listDeviceActions: async () => [] } }),
    ...createIntuneTemplateRoutes(new InMemoryIntuneTemplateRepository()),
    ...createReportTemplateRoutes(reportDeps),
  ];
}

function endpointKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

describe("permission registry completeness", () => {
  it("resolves exactly one permission for every mounted endpoint", () => {
    const mounted = mountedEndpoints();
    expect(mounted.length).toBeGreaterThan(0);
    for (const route of mounted) {
      // Strip any route-carried permission so the assertion exercises the
      // registry table itself: deleting the entry must break this test.
      const permission = permissionForEndpoint({ method: route.method, path: route.path });
      expect(
        permission,
        `no permission declared for ${route.method} ${route.path}`,
      ).toBeDefined();
      expect(typeof permission).toBe("string");
    }
  });

  it("declares exactly one registry entry per mounted endpoint and no extras", () => {
    const mountedKeys = mountedEndpoints().map((route) => endpointKey(route.method, route.path));
    const registryKeys = PermissionRegistry.map((entry) =>
      endpointKey(entry.method, entry.path),
    );
    expect([...registryKeys].sort()).toEqual([...mountedKeys].sort());
  });

  it("returns undefined for an endpoint with no declaration", () => {
    expect(permissionForEndpoint("GET", "/v1/no-such-endpoint")).toBeUndefined();
    expect(permissionForEndpoint("DELETE", "/v1/dashboard/layout")).toBeUndefined();
    expect(permissionForEndpoint("GET", "/v1/ca-templates/extra/deep")).toBeUndefined();
  });
});

describe("permissionForEndpoint", () => {
  it("maps concrete paths through path parameters", () => {
    expect(permissionForEndpoint("GET", "/v1/api-clients/550e8400-e29b-41d4-a716-446655440000")).toBe(
      "CIPP.ApiClients.Read",
    );
    expect(permissionForEndpoint("POST", "/v1/api-clients/some-id/rotate-secret")).toBe(
      "CIPP.ApiClients.ReadWrite",
    );
    expect(permissionForEndpoint("GET", "/v1/tenants/tenant-a/devices/device-1/actions")).toBe(
      "Endpoint.Device.Read",
    );
    expect(permissionForEndpoint("GET", "/v1/ca-templates/template-1/versions")).toBe("Tenant.ConditionalAccess.Read");
    expect(permissionForEndpoint("POST", "/v1/report-templates/template-1/generate")).toBe(
      "Tenant.Reports.ReadWrite",
    );
  });

  it("matches case-insensitively on method and OpenAPI-style paths", () => {
    expect(permissionForEndpoint("get", "/v1/ca-templates")).toBe("Tenant.ConditionalAccess.Read");
    expect(permissionForEndpoint("GET", "/api-clients")).toBe("CIPP.ApiClients.Read");
    expect(permissionForEndpoint("GET", "/api-clients/{id}")).toBe("CIPP.ApiClients.Read");
  });

  it("maps each route family to its declared permission", () => {
    expect(permissionForEndpoint("POST", "/v1/ca-templates")).toBe("Tenant.ConditionalAccess.ReadWrite");
    expect(permissionForEndpoint("GET", "/v1/dashboard/layout")).toBe("Portal.Dashboard.Read");
    expect(permissionForEndpoint("PUT", "/v1/dashboard/layout")).toBe("Portal.Dashboard.ReadWrite");
    expect(permissionForEndpoint("GET", "/v1/tenants/t/defender/templates")).toBe("Security.Defender.Read");
    expect(permissionForEndpoint("POST", "/v1/tenants/t/defender/templates")).toBe(
      "Security.Defender.ReadWrite",
    );
    expect(permissionForEndpoint("GET", "/v1/tenants/t/defender/cve-exceptions")).toBe(
      "Security.Defender.Read",
    );
    expect(permissionForEndpoint("DELETE", "/v1/tenants/t/defender/cve-exceptions/e-1")).toBe(
      "Security.Defender.ReadWrite",
    );
    expect(permissionForEndpoint("GET", "/v1/intune-templates")).toBe("Endpoint.Intune.Read");
    expect(permissionForEndpoint("POST", "/v1/intune-templates")).toBe("Endpoint.IntuneTemplate.ReadWrite");
    expect(permissionForEndpoint("GET", "/v1/report-templates")).toBe("Tenant.Reports.Read");
    expect(permissionForEndpoint("POST", "/v1/report-templates")).toBe("Tenant.ReportTemplate.ReadWrite");
  });

  it("resolves the served contract document to Public", () => {
    expect(permissionForEndpoint("GET", OPENAPI_ROUTE)).toBe("Public");
    expect(permissionForEndpoint({ method: "GET", path: OPENAPI_ROUTE })).toBe("Public");
    expect(isPublicPermission(permissionForEndpoint("GET", OPENAPI_ROUTE) ?? "")).toBe(true);
  });

  it("prefers a permission carried by the route object itself", () => {
    expect(
      permissionForEndpoint({ method: "GET", path: "/v1/unregistered", permission: "Tenant.Read" }),
    ).toBe("Tenant.Read");
    expect(permissionForEndpoint({ method: "GET", path: "/v1/ca-templates" })).toBe("Tenant.ConditionalAccess.Read");
  });
});

describe("permission taxonomy", () => {
  it("accepts Area.Resource.Action strings and Public", () => {
    for (const value of [
      "Tenant.Read",
      "Tenant.Standards.ReadWrite",
      "Remediation.Apply",
      "Remediation.Plan",
      "CIPP.Admin",
      "CIPP.SuperAdmin",
      "Portal.Dashboard.Read",
      "Tenant.ReportTemplate.ReadWrite",
      "Public",
    ]) {
      expect(isPermissionString(value), value).toBe(true);
    }
  });

  it("rejects reserved defaults, wildcards, and malformed strings", () => {
    for (const value of [
      "anonymous",
      "authenticated",
      "admin",
      "",
      "a.b.c.d",
      "*.Read",
      "Tenant.",
      ".Read",
      "Tenant..Read",
    ]) {
      expect(isPermissionString(value), value).toBe(false);
    }
  });

  it("keeps every registry permission in taxonomy with Public only on the contract route", () => {
    expect(PermissionRegistry.length).toBeGreaterThan(0);
    for (const entry of PermissionRegistry) {
      expect(isPermissionString(entry.permission), `${entry.method} ${entry.path}`).toBe(true);
      expect(isReservedPermission(entry.permission)).toBe(false);
    }
    const publicEntries = PermissionRegistry.filter((entry) =>
      isPublicPermission(entry.permission),
    );
    expect(publicEntries).toHaveLength(1);
    expect(publicEntries[0]).toMatchObject({ method: "GET", path: OPENAPI_ROUTE });
  });

  it("treats anonymous and authenticated as reserved, matched exactly", () => {
    expect(isReservedPermission("anonymous")).toBe(true);
    expect(isReservedPermission("authenticated")).toBe(true);
    expect(isReservedPermission("Public")).toBe(false);
    expect(isReservedPermission("Tenant.Read")).toBe(false);
    expect(isPublicPermission("Public")).toBe(true);
    expect(isPublicPermission("public")).toBe(false);
  });
});

// T-0816: route permissions follow the EPIC-038 taxonomy so the base roles grant them.

/** Deliberately outside Read/ReadWrite: only admin/superadmin (or a custom role) hold them. */
const ADMIN_ONLY_PERMISSIONS: readonly string[] = [
  "Remediation.Plan", // generating remediation plans (SPEC §11 item 2 example)
  "Remediation.Apply", // applying changes to tenants; editor excludes it explicitly
  "Endpoint.DeviceKeys.Reveal", // BitLocker recovery keys and LAPS passwords
  "CIPP.Scripts.Execute", // running custom scripts against tenants
  "CIPP.Admin.TenantCredentials", // tenant app credentials
];

/**
 * EPIC-001 run permissions checked through rbac/roles.ts (admin/operator), not the
 * EPIC-038 base roles. T-0817 reconciles the two role systems when it wires authorization.
 */
const EPIC001_RUN_PERMISSIONS: readonly string[] = ["runs.read", "runs.create", "runs.cancel", "runs.retry", "admin"];

const ROUTES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../routes");
const DOTTED = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*){1,2}$/;
const ERROR_CODE_PREFIXES = ["request.", "auth.", "rbac."];

/** Permission-like strings on permission-bearing lines of the route sources. */
function routePermissionStrings(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const file of readdirSync(ROUTES_DIR)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    let inPermissionObject = false;
    for (const line of readFileSync(path.join(ROUTES_DIR, file), "utf8").split("\n")) {
      if (/PERMISSIONS?\s*=\s*\{/.test(line)) inPermissionObject = true;
      const relevant = inPermissionObject || /PERMISSION|[Pp]ermission|includes\(/.test(line);
      if (relevant && !line.trim().startsWith("//")) {
        for (const [, value] of line.matchAll(/"([^"]+)"/g)) {
          if (!DOTTED.test(value!) || ERROR_CODE_PREFIXES.some((p) => value!.startsWith(p))) continue;
          if (!found.has(value!)) found.set(value!, new Set());
          found.get(value!)!.add(file);
        }
      }
      if (inPermissionObject && /^\s*\}/.test(line)) inPermissionObject = false;
    }
  }
  return found;
}

describe("route permissions follow the EPIC-038 taxonomy (T-0816)", () => {
  const permissions = routePermissionStrings();
  const taxonomy = [...permissions.keys()].filter((p) => !EPIC001_RUN_PERMISSIONS.includes(p));

  it("finds the route permissions", () => {
    expect(taxonomy.length).toBeGreaterThan(40);
  });

  it("uses {Area}.{Resource}.{Read|ReadWrite} or a documented admin-only permission", () => {
    const offenders = taxonomy
      .filter((p) => !ADMIN_ONLY_PERMISSIONS.includes(p))
      .filter((p) => !/^[A-Z][A-Za-z0-9]*\.[A-Z][A-Za-z0-9]*\.(Read|ReadWrite)$/.test(p))
      .map((p) => `${p} (${[...permissions.get(p)!].join(", ")})`);
    expect(offenders).toEqual([]);
  });

  it("lets readonly hold every Read permission and nothing more", () => {
    for (const permission of taxonomy) {
      const allowed = testPortalAccess({ permission, roles: ["readonly"] }).allowed;
      expect(allowed, permission).toBe(permission.endsWith(".Read") && !permission.startsWith("CIPP.Admin."));
    }
  });

  it("lets editor hold every Read and ReadWrite permission but no admin-only one", () => {
    for (const permission of taxonomy) {
      const expected = /\.(Read|ReadWrite)$/.test(permission) && !ADMIN_ONLY_PERMISSIONS.includes(permission);
      expect(testPortalAccess({ permission, roles: ["editor"] }).allowed, permission).toBe(expected);
    }
  });

  it("lets admin hold every route permission", () => {
    for (const permission of taxonomy) {
      expect(testPortalAccess({ permission, roles: ["admin"] }).allowed, permission).toBe(true);
    }
  });
});
