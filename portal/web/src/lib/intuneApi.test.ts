// Tests for the compare-page helpers in intuneApi (T-0810).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCompareOptions,
  fetchAllIntunePolicies,
  fetchAllIntuneTemplates,
  type IntunePolicyItem,
  type IntuneTemplate,
} from "./intuneApi";

afterEach(() => {
  vi.unstubAllGlobals();
});

const policy = (id: string, displayName: string): IntunePolicyItem => ({
  id,
  name: displayName,
  displayName,
  platform: "windows",
  policyType: "Compliance Policy",
  assignedToCount: 0,
  assignments: [],
  lastModifiedDateTime: null,
  modifiedBy: null,
});

const template = (id: string, name: string, policyType: "configuration" | "compliance"): IntuneTemplate => ({
  id,
  name,
  platform: "windows10",
  policyType,
  policyJson: {},
  assignments: [],
  source: "local",
  createdAt: "",
  updatedAt: "",
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("buildCompareOptions (T-0810)", () => {
  it("lists other same-kind policies, then same-type templates, each by label", () => {
    const options = buildCompareOptions(
      "compliance",
      "p1",
      [policy("p2", "Win Strict"), policy("p1", "Win Baseline"), policy("p3", "Android")],
      [template("t2", "Zeta", "compliance"), template("t1", "Alpha", "compliance"), template("t3", "Defender", "configuration")],
    );
    expect(options).toEqual([
      { ref: "policy:compliance:p3", label: "Android" },
      { ref: "policy:compliance:p2", label: "Win Strict" },
      { ref: "template:t1", label: "Alpha" },
      { ref: "template:t2", label: "Zeta" },
    ]);
  });

  it("falls back to the policy name when displayName is empty", () => {
    const options = buildCompareOptions("compliance", "x", [{ ...policy("p2", ""), name: "raw-name" }], []);
    expect(options).toEqual([{ ref: "policy:compliance:p2", label: "raw-name" }]);
  });

  it("returns nothing to compare against when the left policy stands alone", () => {
    expect(buildCompareOptions("configuration", "p1", [policy("p1", "Only")], [template("t", "C", "compliance")])).toEqual([]);
  });
});

describe("fetchAll helpers (T-0810)", () => {
  it("walks every page of policies and templates", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("/v1/tenants/t-a/intune/compliance")) {
        return url.includes("cursor=c2")
          ? json({ items: [policy("p2", "B")], nextCursor: null })
          : json({ items: [policy("p1", "A")], nextCursor: "c2" });
      }
      return url.includes("cursor=n2")
        ? json({ items: [template("t2", "B", "compliance")], nextCursor: null })
        : json({ items: [template("t1", "A", "compliance")], nextCursor: "n2" });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchAllIntunePolicies("t-a", "compliance")).map((p) => p.id)).toEqual(["p1", "p2"]);
    expect((await fetchAllIntuneTemplates()).map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
