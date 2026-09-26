import { describe, expect, it } from "vitest";
import {
  AUTH_METHOD_POLICY_IDS,
  AUTH_METHOD_PRESET_IDS,
  AuthMethodPresetError,
  isAuthMethodPresetId,
  parseAuthMethodPreset,
  presetPolicy,
  validatePolicyShape,
} from "./presets.js";
import {
  diffAuthMethodPolicy,
  resolveProposedPolicy,
} from "../../routes/auth-methods-policy.js";

describe("auth-methods presets (T-0225)", () => {
  it("exposes the three required v1 presets", () => {
    expect(AUTH_METHOD_PRESET_IDS).toEqual([
      "phishingResistantRequired",
      "mfaRequired",
      "standard",
    ]);
  });

  it("identifies valid preset ids", () => {
    expect(isAuthMethodPresetId("phishingResistantRequired")).toBe(true);
    expect(isAuthMethodPresetId("mfaRequired")).toBe(true);
    expect(isAuthMethodPresetId("standard")).toBe(true);
    expect(isAuthMethodPresetId("invalid")).toBe(false);
    expect(isAuthMethodPresetId(null)).toBe(false);
  });

  it("parses valid preset ids and rejects unknown ones with structured error", () => {
    expect(parseAuthMethodPreset("standard")).toBe("standard");
    expect(() => parseAuthMethodPreset("custom")).toThrow(AuthMethodPresetError);
    try {
      parseAuthMethodPreset("custom");
    } catch (e) {
      expect((e as AuthMethodPresetError).code).toBe("authMethods.unknown_preset");
    }
  });

  it("returns a complete policy shape for each preset covering all canonical methods", () => {
    for (const preset of AUTH_METHOD_PRESET_IDS) {
      const shape = presetPolicy(preset);
      expect(shape.methods).toHaveLength(AUTH_METHOD_POLICY_IDS.length);
      const methodIds = shape.methods.map((m) => m.id);
      expect(methodIds.sort()).toEqual([...AUTH_METHOD_POLICY_IDS].sort());
      for (const m of shape.methods) {
        expect(["enabled", "disabled"]).toContain(m.state);
      }
    }
  });

  it("phishingResistantRequired disables SMS, phone, software OATH, and email", () => {
    const shape = presetPolicy("phishingResistantRequired");
    const byId = new Map(shape.methods.map((m) => [m.id, m.state]));
    expect(byId.get("phone")).toBe("disabled");
    expect(byId.get("email")).toBe("disabled");
    expect(byId.get("softwareOath")).toBe("disabled");
    expect(byId.get("fido2")).toBe("enabled");
    expect(byId.get("windowsHelloForBusiness")).toBe("enabled");
  });

  it("returns an independent clone from presetPolicy that cannot mutate catalogue", () => {
    const a = presetPolicy("standard");
    (a.methods[0] as { state: string }).state = "mutated";
    const b = presetPolicy("standard");
    expect(b.methods[0].state).not.toBe("mutated");
  });

  it("validates a complete, valid raw policy shape", () => {
    const raw = presetPolicy("standard");
    const validated = validatePolicyShape(raw);
    expect(validated.methods).toHaveLength(AUTH_METHOD_POLICY_IDS.length);
  });

  it("rejects policy shape with missing methods, duplicates, or invalid states", () => {
    expect(() => validatePolicyShape(null)).toThrow(AuthMethodPresetError);
    expect(() => validatePolicyShape({ methods: "not-an-array" })).toThrow(AuthMethodPresetError);
    expect(() =>
      validatePolicyShape({
        methods: [{ id: "fido2", state: "invalid" }],
      }),
    ).toThrow(AuthMethodPresetError);

    // Missing methods
    expect(() =>
      validatePolicyShape({
        methods: [{ id: "fido2", state: "enabled" }],
      }),
    ).toThrow(AuthMethodPresetError);

    // Duplicate methods
    const duplicate = presetPolicy("standard");
    duplicate.methods.push({ id: "fido2", state: "enabled" });
    expect(() => validatePolicyShape(duplicate)).toThrow(AuthMethodPresetError);
  });

  it("resolves proposed policy from preset or raw policy object", () => {
    const fromPreset = resolveProposedPolicy({ preset: "standard" });
    expect(fromPreset.preset).toBe("standard");
    expect(fromPreset.policy.methods).toHaveLength(AUTH_METHOD_POLICY_IDS.length);

    const raw = presetPolicy("mfaRequired");
    const fromRaw = resolveProposedPolicy({ policy: raw });
    expect(fromRaw.preset).toBeNull();
    expect(fromRaw.policy.methods).toHaveLength(AUTH_METHOD_POLICY_IDS.length);

    expect(() => resolveProposedPolicy({})).toThrow();
    expect(() => resolveProposedPolicy({ preset: "standard", policy: raw })).toThrow();
  });

  it("computes diff between current and proposed policy accurately", () => {
    const current = presetPolicy("standard");
    const proposed = presetPolicy("phishingResistantRequired");
    const diff = diffAuthMethodPolicy(current, proposed);
    expect(diff.length).toBeGreaterThan(0);
    for (const d of diff) {
      expect(d.before).not.toBe(d.after);
    }
  });
});
