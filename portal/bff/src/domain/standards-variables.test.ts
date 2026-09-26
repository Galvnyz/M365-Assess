// T-0150 — standard setting variable resolution.
import { describe, expect, it } from "vitest";
import {
  collectTemplateTokens,
  resolveStandardSetting,
  resolveStandardSettings,
  substituteSettingValue,
} from "./standards-variables.js";

const scopes = {
  global: [{ name: "org", value: "Contoso" }],
  tenant: [{ name: "site", value: "https://contoso.sharepoint.com" }],
};

describe("substituteSettingValue", () => {
  it("substitutes macros in strings, including nested structures", () => {
    expect(substituteSettingValue("Hello %org%", scopes)).toBe("Hello Contoso");
    expect(substituteSettingValue({ url: "%site%", n: 3 }, scopes)).toEqual({
      url: "https://contoso.sharepoint.com",
      n: 3,
    });
    expect(substituteSettingValue(["%org%", true], scopes)).toEqual(["Contoso", true]);
  });

  it("lets a tenant value win over a global of the same name", () => {
    const both = {
      global: [{ name: "x", value: "g" }],
      tenant: [{ name: "x", value: "t" }],
    };
    expect(substituteSettingValue("%x%", both)).toBe("t");
  });
});

describe("resolveStandardSetting", () => {
  it("resolves a clean setting", () => {
    const result = resolveStandardSetting({ key: "ENTRA-X", value: "%org%" }, scopes);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.value).toBe("Contoso");
  });

  it("returns a failure record naming the token instead of throwing", () => {
    const result = resolveStandardSetting({ key: "ENTRA-X", value: "%missing%" }, scopes);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.key).toBe("ENTRA-X");
      expect(result.failure.token).toBe("missing");
      // The message names the token but never a value.
      expect(result.failure.error).toContain("missing");
    }
  });
});

describe("resolveStandardSettings", () => {
  it("splits clean resolutions from loud failures", () => {
    const result = resolveStandardSettings(
      [
        { key: "a", value: "%org%" },
        { key: "b", value: "%nope%" },
        { key: "c", value: "static" },
      ],
      scopes,
    );
    expect(result.resolved.map((r) => r.key)).toEqual(["a", "c"]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.key).toBe("b");
  });
});

describe("collectTemplateTokens", () => {
  it("lists referenced tokens, deduped", () => {
    const tokens = collectTemplateTokens([
      { key: "a", value: "%org% %site%" },
      { key: "b", value: { nested: "%org%" } },
    ]);
    expect(tokens.sort()).toEqual(["org", "site"]);
  });
});
