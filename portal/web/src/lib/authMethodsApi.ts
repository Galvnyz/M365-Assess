// Typed Authentication Methods & Registration Campaign API client
// (EPIC-012 SPEC.md §3.3, §3.4; T-0225, T-0226, T-0230).
// Pure typed wrappers around /v1/tenants/:tenantId/auth-methods-policy
// and /v1/tenants/:tenantId/registration-campaign.

export type AuthMethodPolicyId =
  | "fido2"
  | "passkey"
  | "windowsHelloForBusiness"
  | "certificateBasedAuthentication"
  | "microsoftAuthenticator"
  | "softwareOath"
  | "temporaryAccessPass"
  | "phone"
  | "email"
  | "password"
  | string;

export type AuthMethodState = "enabled" | "disabled";

export interface AuthMethodConfig {
  readonly id: AuthMethodPolicyId;
  readonly state: AuthMethodState;
}

export interface AuthMethodPolicyShape {
  readonly methods: readonly AuthMethodConfig[];
}

export type AuthMethodPresetId =
  | "phishingResistantRequired"
  | "mfaRequired"
  | "standard";

export interface AuthMethodPolicyDiff {
  readonly id: AuthMethodPolicyId;
  readonly before: AuthMethodState | "unknown" | string;
  readonly after: AuthMethodState;
}

export interface AuthMethodsPolicySnapshot {
  readonly tenantId: string;
  readonly policy: AuthMethodPolicyShape;
  readonly retrievedAt: string;
}

export interface AuthMethodsPolicyPreview {
  readonly current: AuthMethodPolicyShape;
  readonly proposed: AuthMethodPolicyShape;
  readonly diff: readonly AuthMethodPolicyDiff[];
  readonly applied: AuthMethodPolicyShape | null;
}

export type CampaignState = "enabled" | "disabled";

export interface RegistrationCampaignState {
  readonly tenantId?: string;
  readonly state: CampaignState;
  readonly snoozeDurationInDays: number;
  readonly includeTargets: readonly string[];
  readonly excludeTargets: readonly string[];
  readonly eligibleUserCount: number;
  readonly retrievedAt?: string;
  readonly appliedAt?: string;
}

export type Fetcher = typeof fetch;

export async function fetchAuthMethodsPolicy(
  tenantId: string,
  fetcher: Fetcher = fetch,
): Promise<AuthMethodsPolicySnapshot> {
  const url = `/v1/tenants/${encodeURIComponent(tenantId)}/auth-methods-policy`;
  const res = await fetcher(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Failed to load auth methods policy (${res.status}): ${errorText}`);
  }

  return (await res.json()) as AuthMethodsPolicySnapshot;
}

export interface PreviewPolicyInput {
  readonly preset?: AuthMethodPresetId | string;
  readonly policy?: AuthMethodPolicyShape;
}

export async function previewAuthMethodsPolicy(
  tenantId: string,
  input: PreviewPolicyInput,
  fetcher: Fetcher = fetch,
): Promise<AuthMethodsPolicyPreview> {
  const url = `/v1/tenants/${encodeURIComponent(tenantId)}/auth-methods-policy`;
  const res = await fetcher(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      ...input,
      preview: true,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Failed to preview policy (${res.status}): ${errorText}`);
  }

  return (await res.json()) as AuthMethodsPolicyPreview;
}

export interface ApplyPolicyInput {
  readonly preset?: AuthMethodPresetId | string;
  readonly policy?: AuthMethodPolicyShape;
  readonly reason: string;
  readonly confirm?: boolean;
}

export async function applyAuthMethodsPolicy(
  tenantId: string,
  input: ApplyPolicyInput,
  fetcher: Fetcher = fetch,
): Promise<AuthMethodsPolicyPreview> {
  const url = `/v1/tenants/${encodeURIComponent(tenantId)}/auth-methods-policy`;
  const res = await fetcher(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      preset: input.preset,
      policy: input.policy,
      reason: input.reason,
      confirm: input.confirm ?? true,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Failed to apply policy (${res.status}): ${errorText}`);
  }

  return (await res.json()) as AuthMethodsPolicyPreview;
}

export async function fetchRegistrationCampaign(
  tenantId: string,
  fetcher: Fetcher = fetch,
): Promise<RegistrationCampaignState> {
  const url = `/v1/tenants/${encodeURIComponent(tenantId)}/registration-campaign`;
  const res = await fetcher(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Failed to load registration campaign (${res.status}): ${errorText}`);
  }

  return (await res.json()) as RegistrationCampaignState;
}

export interface UpdateRegistrationCampaignInput {
  readonly state: CampaignState;
  readonly snoozeDurationInDays: number;
  readonly includeTargets: readonly string[];
  readonly excludeTargets: readonly string[];
  readonly reason: string;
  readonly confirm?: boolean;
}

export async function updateRegistrationCampaign(
  tenantId: string,
  input: UpdateRegistrationCampaignInput,
  fetcher: Fetcher = fetch,
): Promise<RegistrationCampaignState> {
  const url = `/v1/tenants/${encodeURIComponent(tenantId)}/registration-campaign`;
  const res = await fetcher(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      state: input.state,
      snoozeDurationInDays: input.snoozeDurationInDays,
      includeTargets: input.includeTargets,
      excludeTargets: input.excludeTargets,
      reason: input.reason,
      confirm: input.confirm ?? true,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Failed to update registration campaign (${res.status}): ${errorText}`);
  }

  return (await res.json()) as RegistrationCampaignState;
}
