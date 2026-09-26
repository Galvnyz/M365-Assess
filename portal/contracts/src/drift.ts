// Drift contracts (EPIC-009 SPEC.md §5, §11.1, §11.4). A `DriftTemplate` is a
// `StandardTemplate` with `kind: drift`, enforced 1:1 per tenant (US-1): a tenant
// either has exactly one drift template or none, and "none" means drift is
// opt-out for that tenant (§9 "scope explosion" mitigation).
//
// The template's standards/settings live in the shared StandardTemplate shape;
// this type adds the tenant binding and the seed provenance. `portal/db` restates
// the shape locally (the same workspace-boundary pattern used elsewhere) because
// this module is not an exported subpath of @m365-assess/contracts.

import type { StandardTemplate } from "./standards.js";

export interface DriftTemplate {
  readonly tenantId: string;
  /** The bound template; always `kind: "drift"`. */
  readonly template: StandardTemplate;
  /** Template this one was clone-to-seeded from, when applicable. */
  readonly seededFrom: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// Triage-state vocabulary (SPEC §5). `deletePending` is the grace-window state
// between a deny decision and the destructive delete (SPEC §11.3).
export const DRIFT_DEVIATION_STATES = [
  "open",
  "accepted",
  "customerSpecific",
  "denied",
  "deletePending",
  "resolved",
] as const;
export type DriftDeviationState = (typeof DRIFT_DEVIATION_STATES)[number];

export const DRIFT_DEVIATION_KINDS = ["mismatch", "extra"] as const;
export type DriftDeviationKind = (typeof DRIFT_DEVIATION_KINDS)[number];

/** The stable triage key (SPEC §11.4): tenantId + standardKey + resourceId. */
export interface DriftDeviation {
  readonly id: string;
  readonly tenantId: string;
  readonly standardKey: string;
  readonly resourceId: string;
  readonly kind: DriftDeviationKind;
  readonly current: unknown;
  readonly expected: unknown;
  readonly state: DriftDeviationState;
  readonly reason: string | null;
  readonly expiresOn: string | null;
  readonly autoRemediateOnExpiry: boolean;
  readonly overrideValue: unknown;
  readonly lastSeenAt: string;
}

export function driftDeviationKey(
  tenantId: string,
  standardKey: string,
  resourceId: string,
): string {
  return `${tenantId}\u0000${standardKey}\u0000${resourceId}`;
}
