// Structural policy compare (EPIC-016 SPEC.md §3.4, §4.4, §9; T-0310).
//
// Pure and read-only. Follows the module's baseline comparison approach
// (Compare-M365Baseline): match items on a stable key, then classify each as
// added, removed, or changed. Here the items are leaf setting paths:
// - Objects flatten to dotted paths.
// - Arrays of objects are keyed by the first identity field every element has
//   (settingDefinitionId, directly or under settingInstance as in settings-catalog
//   policies, then id, name, displayName), so reordering is not a change; other
//   arrays are compared by index.
// - Identity and volatile fields (ids, names, timestamps, version) are ignored,
//   so two policies with the same configuration compare equal.
// Assignments are compared separately, keyed by target, because assignment drift
// (SPEC §9) matters independently of settings.

export type DiffKind = "added" | "removed" | "changed";

export interface SettingDiff {
  readonly path: string;
  readonly kind: DiffKind;
  /** JSON-serialisable value on the left side (absent for "added"). */
  readonly left?: unknown;
  /** JSON-serialisable value on the right side (absent for "removed"). */
  readonly right?: unknown;
}

export interface CompareAssignment {
  /** Stable identity: target type plus group id/name. */
  readonly key: string;
  readonly targetType: string;
  readonly label: string;
}

export interface AssignmentDiff {
  readonly kind: "added" | "removed";
  readonly assignment: CompareAssignment;
}

export interface CompareSubject {
  readonly ref: string;
  readonly label: string;
  readonly source: "policy" | "template";
  readonly kind: string;
  readonly platform: string;
  readonly body: Record<string, unknown>;
  readonly assignments: readonly unknown[];
}

export interface PolicyCompareResult {
  readonly left: { readonly ref: string; readonly label: string; readonly source: string; readonly platform: string };
  readonly right: { readonly ref: string; readonly label: string; readonly source: string; readonly platform: string };
  readonly kind: string;
  readonly settings: readonly SettingDiff[];
  readonly assignments: readonly AssignmentDiff[];
  readonly summary: {
    readonly added: number;
    readonly removed: number;
    readonly changed: number;
    readonly assignmentsAdded: number;
    readonly assignmentsRemoved: number;
  };
  readonly identical: boolean;
}

/** Fields that identify or version an object rather than configure it. */
export const IGNORED_FIELDS: ReadonlySet<string> = new Set([
  "id",
  "name",
  "displayName",
  "description",
  "createdDateTime",
  "lastModifiedDateTime",
  "modifiedDateTime",
  "version",
  "assignments",
  "isAssigned",
  "settingCount",
  "@odata.context",
  "@odata.etag",
]);

/** Candidate identity paths for array elements, most specific first. */
const ARRAY_KEY_PATHS = ["settingDefinitionId", "settingInstance.settingDefinitionId", "id", "name", "displayName"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valueAt(item: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((v, key) => (isPlainObject(v) ? v[key] : undefined), item);
}

function arrayKeyPath(items: readonly unknown[]): string | undefined {
  if (items.length === 0 || !items.every(isPlainObject)) return undefined;
  return ARRAY_KEY_PATHS.find((path) => {
    const values = items.map((item) => valueAt(item, path));
    return values.every((v) => typeof v === "string" && v.length > 0) && new Set(values).size === values.length;
  });
}

/** Flatten to leaf path -> value. Empty objects/arrays are leaves so their presence still compares. */
export function flattenStructure(
  value: unknown,
  ignored: ReadonlySet<string> = IGNORED_FIELDS,
  path = "",
  out: Map<string, unknown> = new Map(),
): Map<string, unknown> {
  if (isPlainObject(value)) {
    const keys = Object.keys(value).filter((k) => !(path === "" && ignored.has(k)));
    if (keys.length === 0 && path !== "") out.set(path, {});
    for (const key of keys.sort()) {
      flattenStructure(value[key], ignored, path ? `${path}.${key}` : key, out);
    }
  } else if (Array.isArray(value)) {
    if (value.length === 0) {
      out.set(path, []);
      return out;
    }
    const keyPath = arrayKeyPath(value);
    value.forEach((item, index) => {
      // Label the segment with the key's last part: [settingDefinitionId=...].
      const segment = keyPath
        ? `[${keyPath.split(".").pop()}=${String(valueAt(item, keyPath))}]`
        : `[${index}]`;
      flattenStructure(item, ignored, `${path}${segment}`, out);
    });
  } else {
    out.set(path, value);
  }
  return out;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Structural diff of two configuration bodies; top-level identity fields are ignored. */
export function compareStructures(left: unknown, right: unknown): SettingDiff[] {
  const l = flattenStructure(left);
  const r = flattenStructure(right);
  const diffs: SettingDiff[] = [];
  for (const [path, value] of l) {
    if (!r.has(path)) diffs.push({ path, kind: "removed", left: value });
    else if (!sameValue(value, r.get(path))) diffs.push({ path, kind: "changed", left: value, right: r.get(path) });
  }
  for (const [path, value] of r) {
    if (!l.has(path)) diffs.push({ path, kind: "added", right: value });
  }
  return diffs.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Normalise an assignment from either the portal shape ({ id, target, targetType }) or
 * the Graph shape ({ target: { "@odata.type", groupId } }).
 */
export function normalizeAssignment(raw: unknown): CompareAssignment | undefined {
  if (!isPlainObject(raw)) return undefined;
  const graphTarget = isPlainObject(raw["target"]) ? raw["target"] : undefined;
  const odataType = typeof graphTarget?.["@odata.type"] === "string" ? String(graphTarget["@odata.type"]) : "";
  const targetType = odataType
    ? odataType.replace("#microsoft.graph.", "")
    : typeof raw["targetType"] === "string"
      ? raw["targetType"]
      : "groupAssignmentTarget";
  if (targetType === "allDevicesAssignmentTarget") return { key: targetType, targetType, label: "All devices" };
  if (targetType === "allLicensedUsersAssignmentTarget") return { key: targetType, targetType, label: "All users" };
  const group =
    (typeof graphTarget?.["groupId"] === "string" && graphTarget["groupId"]) ||
    (typeof raw["target"] === "string" && raw["target"]) ||
    (typeof raw["id"] === "string" && raw["id"]) ||
    "";
  if (!group) return undefined;
  const label = typeof raw["target"] === "string" && raw["target"] ? raw["target"] : group;
  // Exclusion targets are a distinct assignment from inclusion of the same group.
  return { key: `${targetType}:${group.toLowerCase()}`, targetType, label };
}

export function compareAssignments(left: readonly unknown[], right: readonly unknown[]): AssignmentDiff[] {
  const index = (items: readonly unknown[]) => {
    const map = new Map<string, CompareAssignment>();
    for (const item of items) {
      const a = normalizeAssignment(item);
      if (a) map.set(a.key, a);
    }
    return map;
  };
  const l = index(left);
  const r = index(right);
  const diffs: AssignmentDiff[] = [];
  for (const [key, a] of l) if (!r.has(key)) diffs.push({ kind: "removed", assignment: a });
  for (const [key, a] of r) if (!l.has(key)) diffs.push({ kind: "added", assignment: a });
  // By label, then removed before added.
  return diffs.sort(
    (a, b) => a.assignment.label.localeCompare(b.assignment.label) || (a.kind === "removed" ? -1 : 1),
  );
}

export function comparePolicies(left: CompareSubject, right: CompareSubject): PolicyCompareResult {
  const settings = compareStructures(left.body, right.body);
  const assignments = compareAssignments(left.assignments, right.assignments);
  const count = (kind: DiffKind) => settings.filter((d) => d.kind === kind).length;
  const summary = {
    added: count("added"),
    removed: count("removed"),
    changed: count("changed"),
    assignmentsAdded: assignments.filter((a) => a.kind === "added").length,
    assignmentsRemoved: assignments.filter((a) => a.kind === "removed").length,
  };
  const describe = (s: CompareSubject) => ({ ref: s.ref, label: s.label, source: s.source, platform: s.platform });
  return {
    left: describe(left),
    right: describe(right),
    kind: left.kind,
    settings,
    assignments,
    summary,
    identical: settings.length === 0 && assignments.length === 0,
  };
}
