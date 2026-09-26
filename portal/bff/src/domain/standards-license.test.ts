// T-0144 — standards licence gating and catalog builder.
import { describe, expect, it } from "vitest";
import {
  buildTenantLicenseSet,
  classifyStandardLicense,
  shouldSkipForLicense,
} from "./standards-license.js";
import { buildStandardsCatalog, type CatalogStandardRecord } from "../routes/standards-catalog.js";

describe("buildTenantLicenseSet", () => {
  it("normalises the preset and service plans", () => {
    const set = buildTenantLicenseSet("e5", ["aad_premium_p2", " "]);
    expect(set.preset).toBe("E5");
    expect(set.servicePlans).toEqual(["AAD_PREMIUM_P2"]);
  });

  it("maps an unknown or absent preset to null", () => {
    expect(buildTenantLicenseSet("E1").preset).toBeNull();
    expect(buildTenantLicenseSet(null).preset).toBeNull();
  });
});

describe("classifyStandardLicense", () => {
  const overlay = { "CA-SIGNINRISK-001": ["AAD_PREMIUM_P2"] };

  it("is eligible when the tenant meets the preset and service plans", () => {
    const tenant = buildTenantLicenseSet("E5", ["AAD_PREMIUM_P2"]);
    const result = classifyStandardLicense(
      { check: "CA-SIGNINRISK-001", licenseMinimum: "E5" },
      tenant,
      overlay,
    );
    expect(result.state).toBe("eligible");
    expect(result.reason).toBeNull();
  });

  it("classifies a missing preset as license-missing (not failed)", () => {
    const tenant = buildTenantLicenseSet("E3", []);
    const result = classifyStandardLicense(
      { check: "ENTRA-PIM-001", licenseMinimum: "E5" },
      tenant,
    );
    expect(result.state).toBe("license-missing");
    expect(result.requiredPreset).toBe("E5");
    expect(shouldSkipForLicense(result.state)).toBe(true);
  });

  it("lets an E5 tenant satisfy an E3 requirement", () => {
    const tenant = buildTenantLicenseSet("E5", []);
    expect(classifyStandardLicense({ check: "X", licenseMinimum: "E3" }, tenant).state).toBe(
      "eligible",
    );
  });

  it("classifies a missing overlay service plan as license-missing", () => {
    const tenant = buildTenantLicenseSet("E5", []);
    const result = classifyStandardLicense(
      { check: "CA-SIGNINRISK-001", licenseMinimum: "E5" },
      tenant,
      overlay,
    );
    expect(result.state).toBe("license-missing");
    expect(result.missingServicePlans).toEqual(["AAD_PREMIUM_P2"]);
  });

  it("surfaces an unrecognised licensing.minimum as unknown-license", () => {
    const tenant = buildTenantLicenseSet("E5", []);
    const result = classifyStandardLicense({ check: "X", licenseMinimum: "E7" }, tenant);
    expect(result.state).toBe("unknown-license");
    expect(result.reason).toMatch(/unrecognised licensing\.minimum/);
  });

  it("surfaces an overlay entry naming an unknown service plan explicitly", () => {
    // The overlay requires a plan the catalogue does not know about.
    const tenant = buildTenantLicenseSet("E5", ["FUTURE_PLAN"]);
    const result = classifyStandardLicense(
      { check: "CA-SIGNINRISK-001", licenseMinimum: "E5" },
      tenant,
      { "CA-SIGNINRISK-001": ["FUTURE_PLAN"] },
      new Set(["AAD_PREMIUM_P2"]),
    );
    expect(result.state).toBe("unknown-license");
    expect(result.reason).toMatch(/unknown service plan/);
  });

  it("treats a malformed overlay entry as unknown-license", () => {
    const tenant = buildTenantLicenseSet("E5", ["AAD_PREMIUM_P2"]);
    const result = classifyStandardLicense(
      { check: "BAD-001", licenseMinimum: null },
      tenant,
      { "BAD-001": "AAD_PREMIUM_P2" as unknown as string[] },
    );
    expect(result.state).toBe("unknown-license");
  });

  it("is eligible with no minimum and no overlay entry", () => {
    const tenant = buildTenantLicenseSet(null, []);
    expect(classifyStandardLicense({ check: "X", licenseMinimum: null }, tenant).state).toBe(
      "eligible",
    );
  });
});

describe("buildStandardsCatalog (T-0144)", () => {
  const definitions: CatalogStandardRecord[] = [
    { id: "a", check: "ENTRA-PIM-001", name: "PIM", category: "PIM", licensePreset: "E5" },
    { id: "b", check: "EXO-SHARING-001", name: "Sharing", category: "SHARING", licensePreset: "E3" },
  ];

  it("lists standards with category and licence metadata", () => {
    const items = buildStandardsCatalog(definitions);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "a",
      check: "ENTRA-PIM-001",
      category: "PIM",
      licensePreset: "E5",
      licenseState: null,
    });
  });

  it("classifies each standard for a tenant when one is supplied", () => {
    const items = buildStandardsCatalog(definitions, { tenant: buildTenantLicenseSet("E3", []) });
    expect(items.find((i) => i.check === "ENTRA-PIM-001")?.licenseState).toBe("license-missing");
    expect(items.find((i) => i.check === "EXO-SHARING-001")?.licenseState).toBe("eligible");
  });

  it("filters by category", () => {
    const items = buildStandardsCatalog(definitions, { category: "PIM" });
    expect(items.map((i) => i.id)).toEqual(["a"]);
  });
});
