// Tests for the compare-page helpers in intuneApi (T-0810).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assignmentsFromDetail,
  buildCompareOptions,
  editableSettingsFromDetail,
  getIntunePolicy,
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

describe("policy detail for the editor (T-0829)", () => {
  it("flattens settings-catalog settings to definition id -> value", () => {
    const settings = editableSettingsFromDetail("configuration", {
      name: "Defender",
      platforms: "windows10",
      settings: [
        { settingInstance: { settingDefinitionId: "rtm", choiceSettingValue: { value: "rtm_1" } } },
        { settingInstance: { settingDefinitionId: "cloud", choiceSettingValue: { value: "cloud_0" } } },
        { settingInstance: { settingDefinitionId: "len", simpleSettingValue: { value: 12 } } },
        { settingInstance: { settingDefinitionId: "mode", choiceSettingValue: { value: "mode_audit" } } },
      ],
    });
    expect(settings).toEqual({ rtm: true, cloud: false, len: 12, mode: "mode_audit" });
  });

  it("keeps compliance properties minus identity fields", () => {
    expect(
      editableSettingsFromDetail("compliance", {
        "@odata.type": "#microsoft.graph.windows10CompliancePolicy",
        displayName: "Win",
        passwordRequired: true,
        scheduledActionsForRule: [],
      }),
    ).toEqual({ passwordRequired: true, scheduledActionsForRule: [] });
  });

  it("maps Graph assignments to the portal shape", () => {
    expect(
      assignmentsFromDetail([
        { target: { "@odata.type": "#microsoft.graph.groupAssignmentTarget", groupId: "g-1" } },
        { target: { "@odata.type": "#microsoft.graph.allDevicesAssignmentTarget" } },
        { nope: true },
      ]),
    ).toEqual([
      { id: "g-1", target: "g-1", targetType: "groupAssignmentTarget" },
      { id: "allDevicesAssignmentTarget", target: "allDevicesAssignmentTarget", targetType: "allDevicesAssignmentTarget" },
    ]);
  });

  it("reads the detail route and returns null for a missing policy", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/p-1")
        ? json({ id: "p-1", displayName: "Win", platform: "windows", body: { passwordRequired: true }, assignments: [] })
        : new Response("{}", { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const policy = await getIntunePolicy("t-a", "compliance", "p-1");
    expect(fetchMock.mock.calls[0]![0]).toBe("/v1/tenants/t-a/intune/compliance/p-1");
    expect(policy).toMatchObject({ id: "p-1", settingsSummary: { passwordRequired: true }, assignments: [] });
    expect(await getIntunePolicy("t-a", "compliance", "gone")).toBeNull();
  });
});
