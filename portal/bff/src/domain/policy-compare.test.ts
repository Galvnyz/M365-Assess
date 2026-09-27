import { describe, expect, it } from "vitest";
import {
  compareAssignments,
  comparePolicies,
  compareStructures,
  flattenStructure,
  normalizeAssignment,
  type CompareSubject,
} from "./policy-compare.js";

const settingsCatalog = (realtime: string, extra: Record<string, unknown>[] = []) => ({
  "@odata.type": "#microsoft.graph.deviceManagementConfigurationPolicy",
  platforms: "windows10",
  settings: [
    {
      settingInstance: {
        settingDefinitionId: "device_vendor_msft_policy_config_defender_allowrealtimemonitoring",
        choiceSettingValue: { value: realtime },
      },
    },
    ...extra,
  ],
});

describe("flattenStructure (T-0310)", () => {
  it("flattens nested objects to sorted dotted paths and ignores top-level identity fields", () => {
    const flat = flattenStructure({ id: "p1", displayName: "A", b: { y: 2, x: 1 }, a: true });
    expect([...flat.entries()]).toEqual([
      ["a", true],
      ["b.x", 1],
      ["b.y", 2],
    ]);
  });

  it("keys arrays of objects by an identity field, else by index", () => {
    const flat = flattenStructure({
      rules: [
        { settingDefinitionId: "s2", value: 2 },
        { settingDefinitionId: "s1", value: 1 },
      ],
      tags: ["a", "b"],
    });
    expect([...flat.keys()]).toEqual([
      "rules[settingDefinitionId=s2].settingDefinitionId",
      "rules[settingDefinitionId=s2].value",
      "rules[settingDefinitionId=s1].settingDefinitionId",
      "rules[settingDefinitionId=s1].value",
      "tags[0]",
      "tags[1]",
    ]);
  });

  it("keeps empty containers as leaves", () => {
    expect([...flattenStructure({ a: {}, b: [] }).entries()]).toEqual([
      ["a", {}],
      ["b", []],
    ]);
  });
});

describe("compareStructures (T-0310)", () => {
  it("reports added, removed, and changed leaf paths", () => {
    const diffs = compareStructures(
      { passwordRequired: true, passwordMinimumLength: 8, osMinimumVersion: "10.0" },
      { passwordRequired: true, passwordMinimumLength: 12, bitLockerEnabled: true },
    );
    expect(diffs).toEqual([
      { path: "bitLockerEnabled", kind: "added", right: true },
      { path: "osMinimumVersion", kind: "removed", left: "10.0" },
      { path: "passwordMinimumLength", kind: "changed", left: 8, right: 12 },
    ]);
  });

  it("treats reordered keyed settings and different identity fields as identical", () => {
    const a = { id: "1", name: "A", lastModifiedDateTime: "2026-01-01", settings: [{ id: "x", v: 1 }, { id: "y", v: 2 }] };
    const b = { id: "2", name: "B", lastModifiedDateTime: "2026-09-01", settings: [{ id: "y", v: 2 }, { id: "x", v: 1 }] };
    expect(compareStructures(a, b)).toEqual([]);
  });

  it("diffs settings-catalog policies by settingDefinitionId", () => {
    const diffs = compareStructures(
      settingsCatalog("allow_0"),
      settingsCatalog("allow_1", [{ settingInstance: { settingDefinitionId: "cloud", choiceSettingValue: { value: "on" } } }]),
    );
    expect(diffs.map((d) => [d.kind, d.path])).toEqual([
      ["added", "settings[settingDefinitionId=cloud].settingInstance.choiceSettingValue.value"],
      ["added", "settings[settingDefinitionId=cloud].settingInstance.settingDefinitionId"],
      [
        "changed",
        "settings[settingDefinitionId=device_vendor_msft_policy_config_defender_allowrealtimemonitoring].settingInstance.choiceSettingValue.value",
      ],
    ]);
  });

  it("does not report reordered settings-catalog entries", () => {
    const cloud = { settingInstance: { settingDefinitionId: "cloud", choiceSettingValue: { value: "on" } } };
    const a = settingsCatalog("allow_1", [cloud]);
    const b = { ...a, settings: [...a.settings].reverse() };
    expect(compareStructures(a, b)).toEqual([]);
  });

  it("compares type changes, not just values", () => {
    expect(compareStructures({ a: "1" }, { a: 1 })).toEqual([{ path: "a", kind: "changed", left: "1", right: 1 }]);
  });
});

describe("assignments (T-0310)", () => {
  it("normalises portal and Graph assignment shapes to the same key", () => {
    expect(normalizeAssignment({ id: "G1", target: "IT", targetType: "groupAssignmentTarget" })?.key).toBe(
      "groupAssignmentTarget:it",
    );
    expect(
      normalizeAssignment({ target: { "@odata.type": "#microsoft.graph.groupAssignmentTarget", groupId: "g1" } })?.key,
    ).toBe("groupAssignmentTarget:g1");
    expect(normalizeAssignment({ target: { "@odata.type": "#microsoft.graph.allDevicesAssignmentTarget" } })).toEqual({
      key: "allDevicesAssignmentTarget",
      targetType: "allDevicesAssignmentTarget",
      label: "All devices",
    });
    expect(normalizeAssignment("nope")).toBeUndefined();
  });

  it("distinguishes exclusion from inclusion of the same group", () => {
    const diffs = compareAssignments(
      [{ target: { "@odata.type": "#microsoft.graph.groupAssignmentTarget", groupId: "g1" } }],
      [{ target: { "@odata.type": "#microsoft.graph.exclusionGroupAssignmentTarget", groupId: "g1" } }],
    );
    expect(diffs.map((d) => [d.kind, d.assignment.targetType])).toEqual([
      ["removed", "groupAssignmentTarget"],
      ["added", "exclusionGroupAssignmentTarget"],
    ]);
  });

  it("reports added and removed assignment targets", () => {
    const diffs = compareAssignments(
      [{ targetType: "allDevicesAssignmentTarget" }, { id: "g1", target: "Pilot", targetType: "groupAssignmentTarget" }],
      [{ targetType: "allLicensedUsersAssignmentTarget" }, { id: "g1", target: "Pilot", targetType: "groupAssignmentTarget" }],
    );
    expect(diffs.map((d) => [d.kind, d.assignment.label])).toEqual([
      ["removed", "All devices"],
      ["added", "All users"],
    ]);
  });
});

describe("comparePolicies (T-0310)", () => {
  const subject = (overrides: Partial<CompareSubject>): CompareSubject => ({
    ref: "policy:compliance:p1",
    label: "Win Compliance",
    source: "policy",
    kind: "compliance",
    platform: "windows",
    body: { passwordRequired: true },
    assignments: [],
    ...overrides,
  });

  it("summarises settings and assignment differences", () => {
    const result = comparePolicies(
      subject({ body: { passwordRequired: true, passwordMinimumLength: 8 } }),
      subject({
        ref: "template:t1",
        source: "template",
        platform: "windows10",
        body: { passwordRequired: false, bitLockerEnabled: true },
        assignments: [{ targetType: "allDevicesAssignmentTarget" }],
      }),
    );
    expect(result.summary).toEqual({ added: 1, removed: 1, changed: 1, assignmentsAdded: 1, assignmentsRemoved: 0 });
    expect(result.identical).toBe(false);
    expect(result.right).toEqual({ ref: "template:t1", label: "Win Compliance", source: "template", platform: "windows10" });
  });

  it("is identical when only identity fields differ", () => {
    const result = comparePolicies(
      subject({ body: { id: "a", displayName: "A", passwordRequired: true } }),
      subject({ ref: "policy:compliance:p2", body: { id: "b", displayName: "B", passwordRequired: true } }),
    );
    expect(result.identical).toBe(true);
    expect(result.settings).toEqual([]);
  });
});
