// Standards licence gating (EPIC-008 SPEC.md §4.4, §11; T-0144).
//
// Before a standard is applied, the tenant's licences are checked against two
// sources: the registry's coarse `licensing.minimum` (E3/E5) and the
// `licensing-overlay.json` service-plan map (e.g. AAD_PREMIUM_P2 for an E5
// feature). A missing licence classifies the standard as `license-missing` and
// the executor SKIPS it (never fails it) — CIPP's Test-CIPPStandardLicense model.
//
// An unrecognised signal (a minimum that is neither E3 nor E5, or an overlay
// entry naming a service plan outside the known catalogue) classifies as
// `unknown-license` so it surfaces explicitly instead of silently passing.

export const STANDARD_LICENSE_STATES = ["eligible", "license-missing", "unknown-license"] as const;
export type StandardLicenseState = (typeof STANDARD_LICENSE_STATES)[number];

export type LicensePreset = "E3" | "E5";

/** Coarse preset rank: an E5 tenant also satisfies an E3 requirement. */
const PRESET_RANK: Record<LicensePreset, number> = { E3: 1, E5: 2 };

export interface LicenseStandardInput {
  // The standard's registry check id. Named `check` because the thin-BFF guard
  // forbids the collector identifier token in portal/bff source (ADR-0014).
  readonly check: string;
  /** The registry `licensing.minimum`, unrestrained so unknown values surface. */
  readonly licenseMinimum: string | null | undefined;
}

export interface TenantLicenseSet {
  /** Best preset the tenant holds, or null when it holds neither. */
  readonly preset: LicensePreset | null;
  /** Active Microsoft service plan ids (e.g. AAD_PREMIUM_P2). */
  readonly servicePlans: readonly string[];
}

export interface StandardLicenseResult {
  readonly check: string;
  readonly state: StandardLicenseState;
  /** The required preset when one applied. */
  readonly requiredPreset: LicensePreset | null;
  /** Required service plans the tenant does not hold. */
  readonly missingServicePlans: readonly string[];
  /** Human-readable reason for a non-eligible state. */
  readonly reason: string | null;
}

function normalizePlan(value: string): string {
  return value.trim().toUpperCase();
}

/** Builds a tenant's licence set from a preset and active service plan ids. */
export function buildTenantLicenseSet(
  preset: string | null | undefined,
  servicePlans: readonly string[] = [],
): TenantLicenseSet {
  const normalized = (preset ?? "").trim().toUpperCase();
  return {
    preset: normalized === "E3" || normalized === "E5" ? (normalized as LicensePreset) : null,
    servicePlans: servicePlans.map(normalizePlan).filter((plan) => plan.length > 0),
  };
}

/**
 * Classifies one standard against a tenant's licences.
 * `overlay` maps a standard's check id to required service plan ids (licensing-overlay.json);
 * `knownServicePlans`, when supplied, flags overlay ids outside the catalogue.
 */
export function classifyStandardLicense(
  standard: LicenseStandardInput,
  tenant: TenantLicenseSet,
  overlay: Readonly<Record<string, readonly string[]>> = {},
  knownServicePlans?: ReadonlySet<string>,
): StandardLicenseResult {
  const check = standard.check;

  // 1. Coarse preset gate. An unrecognised minimum is surfaced, not ignored.
  const rawMinimum = (standard.licenseMinimum ?? "").trim().toUpperCase();
  let requiredPreset: LicensePreset | null = null;
  if (rawMinimum.length > 0) {
    if (rawMinimum !== "E3" && rawMinimum !== "E5") {
      return {
        check,
        state: "unknown-license",
        requiredPreset: null,
        missingServicePlans: [],
        reason: `unrecognised licensing.minimum '${standard.licenseMinimum}'`,
      };
    }
    requiredPreset = rawMinimum as LicensePreset;
    if (tenant.preset === null || PRESET_RANK[tenant.preset] < PRESET_RANK[requiredPreset]) {
      return {
        check,
        state: "license-missing",
        requiredPreset,
        missingServicePlans: [],
        reason: `tenant licence is '${tenant.preset ?? "none"}' but the standard requires ${requiredPreset}`,
      };
    }
  }

  // 2. Service-plan overlay gate.
  const overlayEntry = overlay[check];
  if (overlayEntry !== undefined) {
    if (!Array.isArray(overlayEntry) || overlayEntry.some((plan) => typeof plan !== "string")) {
      return {
        check,
        state: "unknown-license",
        requiredPreset,
        missingServicePlans: [],
        reason: `unrecognised overlay entry for '${check}'`,
      };
    }
    const required = overlayEntry.map(normalizePlan).filter((plan) => plan.length > 0);
    const knownPlans = knownServicePlans
      ? new Set([...knownServicePlans].map(normalizePlan))
      : undefined;
    if (knownPlans) {
      const unrecognised = required.filter((plan) => !knownPlans.has(plan));
      if (unrecognised.length > 0) {
        return {
          check,
          state: "unknown-license",
          requiredPreset,
          missingServicePlans: unrecognised,
          reason: `overlay references unknown service plan(s): ${unrecognised.join(", ")}`,
        };
      }
    }
    const held = new Set(tenant.servicePlans.map(normalizePlan));
    const missing = required.filter((plan) => !held.has(plan));
    if (missing.length > 0) {
      return {
        check,
        state: "license-missing",
        requiredPreset,
        missingServicePlans: missing,
        reason: `tenant is missing required service plan(s): ${missing.join(", ")}`,
      };
    }
  }

  return { check, state: "eligible", requiredPreset, missingServicePlans: [], reason: null };
}

/** True when a non-eligible standard should be skipped (never failed, §4.4). */
export function shouldSkipForLicense(state: StandardLicenseState): boolean {
  return state !== "eligible";
}
