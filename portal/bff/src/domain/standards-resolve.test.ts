// T-0142 — three-tier standards resolution.
import { describe, expect, it } from "vitest";
import type { StandardTemplate, TemplateAssignment } from "../../../contracts/src/standards.js";
import { resolveStandards } from "./standards-resolve.js";

function template(
  id: string,
  settings: Array<{ key: string; value: unknown }>,
): StandardTemplate {
  return {
    id,
    name: id,
    kind: "standards",
    actions: { report: true, alert: true, remediate: false },
    autoRemediate: false,
    settings,
    scheduleId: null,
  };
}

function assignment(
  templateId: string,
  targetType: TemplateAssignment["targetType"],
  targetId: string | null,
  precedence = 0,
): TemplateAssignment {
  return { templateId, targetType, targetId, precedence };
}

describe("resolveStandards (T-0142)", () => {
  it("merges AllTenants → Group → Tenant, tenant-specific winning per setting", () => {
    const templates = [
      template("all", [{ key: "mfa", value: "required" }, { key: "legacyAuth", value: "block" }]),
      template("group", [{ key: "mfa", value: "conditional" }]),
      template("tenant", [{ key: "mfa", value: "required-admins" }]),
    ];
    const assignments = [
      assignment("all", "allTenants", null),
      assignment("group", "group", "g1"),
      assignment("tenant", "tenant", "contoso"),
    ];

    const result = resolveStandards({
      tenantId: "contoso",
      groupIds: ["g1"],
      assignments,
      templates,
    });

    const byKey = new Map(result.settings.map((s) => [s.key, s]));
    // Tenant-specific wins for `mfa`...
    expect(byKey.get("mfa")?.value).toBe("required-admins");
    expect(byKey.get("mfa")?.source.targetType).toBe("tenant");
    // ...while `legacyAuth` only defined at the all-tenants tier falls through.
    expect(byKey.get("legacyAuth")?.value).toBe("block");
    expect(byKey.get("legacyAuth")?.source.targetType).toBe("allTenants");
  });

  it("ignores group assignments for groups the tenant is not a member of", () => {
    const result = resolveStandards({
      tenantId: "contoso",
      groupIds: ["other"],
      assignments: [assignment("group", "group", "g1"), assignment("tenant", "tenant", "contoso")],
      templates: [
        template("group", [{ key: "mfa", value: "group-value" }]),
        template("tenant", [{ key: "other", value: 1 }]),
      ],
    });
    expect(result.settings.map((s) => s.key)).toEqual(["other"]);
  });

  it("resolves two assignments in the same tier deterministically by precedence", () => {
    const templates = [
      template("low", [{ key: "mfa", value: "low" }]),
      template("high", [{ key: "mfa", value: "high" }]),
    ];
    const assignments = [
      assignment("low", "tenant", "contoso", 1),
      assignment("high", "tenant", "contoso", 10),
    ];

    const result = resolveStandards({ tenantId: "contoso", assignments, templates });
    expect(result.settings.find((s) => s.key === "mfa")?.value).toBe("high");
    expect(result.settings.find((s) => s.key === "mfa")?.source.templateId).toBe("high");
  });

  it("breaks an equal-precedence tie by templateId so the result is stable", () => {
    const templates = [
      template("alpha", [{ key: "mfa", value: "alpha" }]),
      template("zeta", [{ key: "mfa", value: "zeta" }]),
    ];
    const assignments = [
      assignment("zeta", "tenant", "contoso", 5),
      assignment("alpha", "tenant", "contoso", 5),
    ];

    const first = resolveStandards({ tenantId: "contoso", assignments, templates });
    const second = resolveStandards({
      tenantId: "contoso",
      assignments: [...assignments].reverse(),
      templates,
    });
    // Both orderings give the same winner (higher templateId sorts last => wins).
    expect(first.settings.find((s) => s.key === "mfa")?.value).toBe("zeta");
    expect(second.settings.find((s) => s.key === "mfa")?.value).toBe("zeta");
  });

  it("reports contributing templates highest-priority first and skips unknown templates", () => {
    const result = resolveStandards({
      tenantId: "contoso",
      groupIds: ["g1"],
      assignments: [
        assignment("all", "allTenants", null),
        assignment("group", "group", "g1"),
        assignment("missing", "tenant", "contoso"),
      ],
      templates: [
        template("all", [{ key: "a", value: 1 }]),
        template("group", [{ key: "b", value: 2 }]),
      ],
    });
    expect(result.appliedTemplateIds).toEqual(["group", "all"]);
    expect(result.settings.map((s) => s.key)).toEqual(["a", "b"]);
  });

  it("returns no settings when nothing applies", () => {
    const result = resolveStandards({
      tenantId: "contoso",
      assignments: [assignment("t", "tenant", "fabrikam")],
      templates: [template("t", [{ key: "x", value: 1 }])],
    });
    expect(result.settings).toEqual([]);
    expect(result.appliedTemplateIds).toEqual([]);
  });
});
