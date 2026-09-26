// Intune policy-type registry (EPIC-016 SPEC.md §9; T-0301).
//
// Maps every supported Intune policy kind/platform to its Graph resource,
// required Graph scopes, and settings shape. Drives both the list handler
// and later CRUD/editor tickets.
//
// v1 supports Windows configuration and compliance policies only.
// Unsupported kinds must return a structured "not yet supported" error
// rather than an empty list.

export type IntunePolicyKind = "configuration" | "compliance" | "app-protection";
export type IntunePlatform = "windows" | "android" | "ios" | "macos";

export interface IntunePolicyTypeEntry {
  /** The kind (matches URL segment). */
  readonly kind: IntunePolicyKind;
  /** Target platform. */
  readonly platform: IntunePlatform;
  /** Human-readable display name. */
  readonly displayName: string;
  /** Microsoft Graph API resource path (relative, no leading /). */
  readonly graphResource: string;
  /** OData type prefix used by this entry (e.g. for server-side filtering). */
  readonly odataTypePrefix: string;
  /** Required Graph delegated/application scopes. */
  readonly requiredScopes: readonly string[];
  /**
   * Whether v1 supports this kind/platform combination.
   * When false the route returns 501 with `unsupported` error code.
   */
  readonly supported: boolean;
}

/**
 * The shared Intune policy-type registry.
 *
 * Order: supported entries first, then unsupported, alphabetical within group.
 */
export const INTUNE_POLICY_TYPES: readonly IntunePolicyTypeEntry[] = [
  // ---- Supported in v1 ----
  {
    kind: "compliance",
    platform: "windows",
    displayName: "Windows Compliance Policies",
    graphResource: "v1.0/deviceManagement/deviceCompliancePolicies",
    odataTypePrefix: "#microsoft.graph.windows10CompliancePolicy",
    requiredScopes: ["DeviceManagementConfiguration.Read.All"],
    supported: true,
  },
  {
    kind: "configuration",
    platform: "windows",
    displayName: "Windows Configuration Policies",
    graphResource:
      "v1.0/deviceManagement/configurationPolicies",
    odataTypePrefix: "#microsoft.graph.deviceManagementConfigurationPolicy",
    requiredScopes: ["DeviceManagementConfiguration.Read.All"],
    supported: true,
  },
  // ---- Not yet supported (v1 deferred) ----
  {
    kind: "app-protection",
    platform: "android",
    displayName: "Android App Protection Policies",
    graphResource: "v1.0/deviceAppManagement/androidManagedAppProtections",
    odataTypePrefix: "#microsoft.graph.androidManagedAppProtection",
    requiredScopes: ["DeviceManagementApps.Read.All"],
    supported: false,
  },
  {
    kind: "app-protection",
    platform: "ios",
    displayName: "iOS App Protection Policies",
    graphResource: "v1.0/deviceAppManagement/iosManagedAppProtections",
    odataTypePrefix: "#microsoft.graph.iosManagedAppProtection",
    requiredScopes: ["DeviceManagementApps.Read.All"],
    supported: false,
  },
  {
    kind: "compliance",
    platform: "android",
    displayName: "Android Compliance Policies",
    graphResource: "v1.0/deviceManagement/deviceCompliancePolicies",
    odataTypePrefix: "#microsoft.graph.androidCompliancePolicy",
    requiredScopes: ["DeviceManagementConfiguration.Read.All"],
    supported: false,
  },
  {
    kind: "compliance",
    platform: "ios",
    displayName: "iOS Compliance Policies",
    graphResource: "v1.0/deviceManagement/deviceCompliancePolicies",
    odataTypePrefix: "#microsoft.graph.iosCompliancePolicy",
    requiredScopes: ["DeviceManagementConfiguration.Read.All"],
    supported: false,
  },
  {
    kind: "compliance",
    platform: "macos",
    displayName: "macOS Compliance Policies",
    graphResource: "v1.0/deviceManagement/deviceCompliancePolicies",
    odataTypePrefix: "#microsoft.graph.macOSCompliancePolicy",
    requiredScopes: ["DeviceManagementConfiguration.Read.All"],
    supported: false,
  },
  {
    kind: "configuration",
    platform: "android",
    displayName: "Android Configuration Policies",
    graphResource: "v1.0/deviceManagement/configurationPolicies",
    odataTypePrefix: "#microsoft.graph.deviceManagementConfigurationPolicy",
    requiredScopes: ["DeviceManagementConfiguration.Read.All"],
    supported: false,
  },
  {
    kind: "configuration",
    platform: "ios",
    displayName: "iOS Configuration Policies",
    graphResource: "v1.0/deviceManagement/configurationPolicies",
    odataTypePrefix: "#microsoft.graph.deviceManagementConfigurationPolicy",
    requiredScopes: ["DeviceManagementConfiguration.Read.All"],
    supported: false,
  },
  {
    kind: "configuration",
    platform: "macos",
    displayName: "macOS Configuration Policies",
    graphResource: "v1.0/deviceManagement/configurationPolicies",
    odataTypePrefix: "#microsoft.graph.deviceManagementConfigurationPolicy",
    requiredScopes: ["DeviceManagementConfiguration.Read.All"],
    supported: false,
  },
];

/**
 * Returns all registry entries for a given kind,
 * or undefined if no entries exist for that kind at all.
 */
export function lookupByKind(
  kind: string,
): readonly IntunePolicyTypeEntry[] | undefined {
  const entries = INTUNE_POLICY_TYPES.filter((e) => e.kind === kind);
  return entries.length > 0 ? entries : undefined;
}

/**
 * Returns the supported entries for a given kind,
 * or undefined if the kind is unknown.
 */
export function supportedEntriesForKind(
  kind: string,
): readonly IntunePolicyTypeEntry[] | undefined {
  const all = lookupByKind(kind);
  if (all === undefined) return undefined;
  return all.filter((e) => e.supported);
}

/** Returns true if the supplied string is a known IntunePolicyKind. */
export function isKnownKind(kind: string): kind is IntunePolicyKind {
  return ["configuration", "compliance", "app-protection"].includes(kind);
}
