// Tests for Intune policy-type registry (T-0301).
// Covers every registered type entry: presence, graph resource, scopes, support flag.
import { describe, expect, it } from "vitest";
import {
  INTUNE_POLICY_TYPES,
  isKnownKind,
  lookupByKind,
  supportedEntriesForKind,
  type IntunePolicyKind,
  type IntunePlatform,
} from "./intune-policy-types.js";

describe("INTUNE_POLICY_TYPES registry (T-0301)", () => {
  it("contains at least one entry per known kind", () => {
    const kinds: IntunePolicyKind[] = ["configuration", "compliance", "app-protection"];
    for (const kind of kinds) {
      const entries = INTUNE_POLICY_TYPES.filter((e) => e.kind === kind);
      expect(entries.length, `expected entries for kind '${kind}'`).toBeGreaterThan(0);
    }
  });

  it("every entry has a non-empty displayName, graphResource, odataTypePrefix, and requiredScopes", () => {
    for (const entry of INTUNE_POLICY_TYPES) {
      const tag = `${entry.kind}/${entry.platform}`;
      expect(entry.displayName, `displayName ${tag}`).toBeTruthy();
      expect(entry.graphResource, `graphResource ${tag}`).toBeTruthy();
      expect(entry.odataTypePrefix, `odataTypePrefix ${tag}`).toBeTruthy();
      expect(entry.requiredScopes.length, `requiredScopes ${tag}`).toBeGreaterThan(0);
    }
  });

  it("windows/configuration is supported in v1", () => {
    const entry = INTUNE_POLICY_TYPES.find(
      (e) => e.kind === "configuration" && e.platform === "windows",
    );
    expect(entry).toBeDefined();
    expect(entry!.supported).toBe(true);
    expect(entry!.graphResource).toContain("configurationPolicies");
    expect(entry!.requiredScopes).toContain("DeviceManagementConfiguration.Read.All");
  });

  it("windows/compliance is supported in v1", () => {
    const entry = INTUNE_POLICY_TYPES.find(
      (e) => e.kind === "compliance" && e.platform === "windows",
    );
    expect(entry).toBeDefined();
    expect(entry!.supported).toBe(true);
    expect(entry!.graphResource).toContain("deviceCompliancePolicies");
    expect(entry!.requiredScopes).toContain("DeviceManagementConfiguration.Read.All");
  });

  it("non-windows entries are not supported in v1", () => {
    const nonWindows = INTUNE_POLICY_TYPES.filter((e) => e.platform !== "windows");
    expect(nonWindows.length).toBeGreaterThan(0);
    for (const entry of nonWindows) {
      expect(entry.supported, `${entry.kind}/${entry.platform} should be unsupported`).toBe(false);
    }
  });

  it("app-protection entries are not supported in v1", () => {
    const appProtection = INTUNE_POLICY_TYPES.filter((e) => e.kind === "app-protection");
    expect(appProtection.length).toBeGreaterThan(0);
    for (const entry of appProtection) {
      expect(
        entry.supported,
        `app-protection/${entry.platform} should be unsupported`,
      ).toBe(false);
    }
  });

  it("no duplicate kind/platform combinations", () => {
    const seen = new Set<string>();
    for (const entry of INTUNE_POLICY_TYPES) {
      const key = `${entry.kind}/${entry.platform}`;
      expect(seen.has(key), `duplicate entry for ${key}`).toBe(false);
      seen.add(key);
    }
  });
});

describe("lookupByKind (T-0301)", () => {
  it("returns all entries for a known kind", () => {
    const entries = lookupByKind("compliance");
    expect(entries).toBeDefined();
    expect(entries!.length).toBeGreaterThan(0);
    for (const e of entries!) {
      expect(e.kind).toBe("compliance");
    }
  });

  it("returns undefined for an unknown kind", () => {
    expect(lookupByKind("unknown-kind")).toBeUndefined();
  });
});

describe("supportedEntriesForKind (T-0301)", () => {
  it("returns only supported entries for configuration", () => {
    const entries = supportedEntriesForKind("configuration");
    expect(entries).toBeDefined();
    for (const e of entries!) {
      expect(e.supported).toBe(true);
    }
    // Only windows is supported in v1
    expect(entries!.every((e) => e.platform === "windows")).toBe(true);
  });

  it("returns only supported entries for compliance", () => {
    const entries = supportedEntriesForKind("compliance");
    expect(entries).toBeDefined();
    for (const e of entries!) {
      expect(e.supported).toBe(true);
    }
    expect(entries!.every((e) => e.platform === "windows")).toBe(true);
  });

  it("returns undefined for an unknown kind", () => {
    expect(supportedEntriesForKind("unknown")).toBeUndefined();
  });

  it("returns an empty array (not undefined) for app-protection (known but all unsupported)", () => {
    const entries = supportedEntriesForKind("app-protection");
    expect(entries).toBeDefined();
    expect(entries).toBeInstanceOf(Array);
    expect(entries!.length).toBe(0);
  });
});

describe("isKnownKind (T-0301)", () => {
  it("returns true for known kinds", () => {
    expect(isKnownKind("configuration")).toBe(true);
    expect(isKnownKind("compliance")).toBe(true);
    expect(isKnownKind("app-protection")).toBe(true);
  });

  it("returns false for unknown kinds", () => {
    expect(isKnownKind("unknown")).toBe(false);
    expect(isKnownKind("")).toBe(false);
    expect(isKnownKind("scripts")).toBe(false);
  });
});
