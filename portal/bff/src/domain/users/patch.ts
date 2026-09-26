// Bulk patch wizard domain (EPIC-011 SPEC.md §3.3, §4.2 US-3; T-0203).
//
// The wizard selects users, chooses properties, and previews the diff before
// apply. This module owns the patchable property catalogue, input validation,
// and the before/after diff: only properties that would actually change appear
// in the diff, and a property outside the catalogue is rejected, never passed
// through. Pure module: no Graph client, no queue, no tenant write.

export const PATCHABLE_USER_PROPERTIES = [
  "displayName",
  "givenName",
  "surname",
  "department",
  "jobTitle",
  "officeLocation",
  "mobilePhone",
  "usageLocation",
] as const;

export type PatchableUserProperty = (typeof PATCHABLE_USER_PROPERTIES)[number];

export interface UserPatchDiff {
  readonly property: PatchableUserProperty;
  readonly before: string | null;
  readonly after: string | null;
}

export class UserPatchError extends Error {
  readonly code = "users.patch_invalid";
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "UserPatchError";
  }
}

const USAGE_LOCATION_PATTERN = /^[A-Za-z]{2}$/;

function asText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Validates one row of desired properties. Unknown properties and non-string
// values are rejected; valid input is normalized (blank clears to null).
export function validatePatchProperties(
  properties: unknown,
): { errors: string[]; properties: Partial<Record<PatchableUserProperty, string | null>> } {
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
    return { errors: ["properties must be an object"], properties: {} };
  }
  const record = properties as Record<string, unknown>;
  const errors: string[] = [];
  const valid: Partial<Record<PatchableUserProperty, string | null>> = {};
  const allowed = new Set<string>(PATCHABLE_USER_PROPERTIES);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      errors.push(`property '${key}' cannot be patched; patchable: ${PATCHABLE_USER_PROPERTIES.join(", ")}`);
      continue;
    }
    const value = record[key];
    if (value !== null && typeof value !== "string") {
      errors.push(`property '${key}' must be a string or null`);
      continue;
    }
    const text = asText(value);
    if (key === "usageLocation" && text !== null && !USAGE_LOCATION_PATTERN.test(text)) {
      errors.push(`usageLocation '${text}' must be a 2-letter country code`);
      continue;
    }
    valid[key as PatchableUserProperty] = text;
  }
  if (Object.keys(valid).length === 0 && errors.length === 0) {
    errors.push("properties must include at least one patchable property");
  }
  return { errors, properties: valid };
}

// Diffs two snapshots over the patchable catalogue. Only properties whose
// normalized value would change are returned; the caller decides preview vs
// apply. A property the worker does not report is treated as currently null.
export function computeUserPatchDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): UserPatchDiff[] {
  const diffs: UserPatchDiff[] = [];
  for (const property of PATCHABLE_USER_PROPERTIES) {
    const beforeValue = asText(before[property]);
    const afterValue = asText(after[property]);
    if (beforeValue !== afterValue) {
      diffs.push({ property, before: beforeValue, after: afterValue });
    }
  }
  return diffs;
}
