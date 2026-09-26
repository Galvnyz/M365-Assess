// Standards contracts (EPIC-008 SPEC.md §5, §11.1, §11.4). A `StandardDefinition`
// maps one standard to a registry check; for v1 the mapping is 1:1 with the
// control registry (grouping is deferred), so `id` is the `checkId`.
//
// §11.4 makes the definition derived from the registry at load, with an optional
// curated `StandardDefinitionOverride` row winning when present. Standards are
// keyed by `checkId` so a registry sync can be re-validated (§9 drift risk).
//
// The shape is shared by storage and the BFF/UI. `portal/db` restates the shape
// locally (see schedule-repository.ts for the same workspace-boundary pattern)
// because this module is not an exported subpath of @m365-assess/contracts.

export const STANDARD_LICENSE_PRESETS = ["E3", "E5"] as const;

export type StandardLicensePreset = (typeof STANDARD_LICENSE_PRESETS)[number];

export interface StandardDefinition {
  /** Stable id; equal to `checkId` for the v1 1:1 mapping. */
  id: string;
  checkId: string;
  name: string;
  category: string;
  /** Registry `licensing.minimum` when it is a known preset, otherwise null. */
  licensePreset: StandardLicensePreset | null;
}

/**
 * A curated override for a single registry-derived definition. Only the fields
 * present are applied; the registry supplies anything the override omits.
 */
export interface StandardDefinitionOverride {
  checkId: string;
  name?: string;
  category?: string;
  /** Set `licensePreset: null` deliberately to clear a registry preset. */
  licensePreset?: StandardLicensePreset | null;
  updatedAt?: string;
  updatedBy?: string;
}

export function isStandardLicensePreset(value: unknown): value is StandardLicensePreset {
  return (
    typeof value === "string" && (STANDARD_LICENSE_PRESETS as readonly string[]).includes(value)
  );
}
