// Typed MFA API client (EPIC-012 SPEC.md §3.1, §6; T-0221, T-0228).
// Wraps GET /v1/tenants/:tenantId/mfa-report behind a small typed function.
// A fetcher seam keeps the client testable without a live BFF.

export type MfaUserState = "registered" | "notRegistered";

export type MfaPhishingResistant =
  | "phishing-resistant"
  | "not-phishing-resistant"
  | "unknown";

export interface MfaUserRow {
  readonly userId: string;
  readonly displayName: string | null;
  readonly userPrincipalName: string;
  readonly methods: readonly string[];
  readonly defaultMethod: string | null;
  readonly phishingResistant: MfaPhishingResistant;
  readonly lastAuthDateTime: string | null;
  readonly state: MfaUserState;
  readonly licenses: readonly string[];
  readonly isAdmin: boolean;
}

export interface MfaReportKpis {
  readonly total: number;
  readonly registered: number;
  readonly notRegistered: number;
  readonly phishingResistant: number;
  readonly perMethod: Record<string, number>;
}

export type MfaRegisteredFilter = "registered" | "notRegistered";
export type MfaLicenseFilter = "licensed" | "unlicensed";

export interface MfaReportFilter {
  readonly search?: string;
  readonly registered?: MfaRegisteredFilter;
  readonly method?: string;
  readonly phishingResistant?: boolean;
  readonly license?: MfaLicenseFilter;
  readonly adminRole?: boolean;
  readonly cursor?: string | null;
  readonly limit?: number;
}

export interface MfaReport {
  readonly tenantId: string;
  readonly rows: readonly MfaUserRow[];
  readonly kpis: MfaReportKpis;
  readonly nextCursor: string | null;
  readonly retrievedAt: string;
}

export type Fetcher = typeof fetch;

export async function fetchMfaReport(
  tenantId: string,
  filter: MfaReportFilter = {},
  fetcher: Fetcher = fetch,
): Promise<MfaReport> {
  const query = new URLSearchParams();
  if (filter.search) query.set("search", filter.search);
  if (filter.registered) query.set("registered", filter.registered);
  if (filter.method) query.set("method", filter.method);
  if (filter.phishingResistant !== undefined) {
    query.set("phishingResistant", String(filter.phishingResistant));
  }
  if (filter.license) query.set("license", filter.license);
  if (filter.adminRole !== undefined) query.set("adminRole", String(filter.adminRole));
  if (filter.cursor) query.set("cursor", filter.cursor);
  if (filter.limit !== undefined) query.set("limit", String(filter.limit));

  const qs = query.toString();
  const url = `/v1/tenants/${encodeURIComponent(tenantId)}/mfa-report${qs ? `?${qs}` : ""}`;

  const res = await fetcher(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Failed to load MFA report (${res.status}): ${errorText}`);
  }

  return (await res.json()) as MfaReport;
}

export interface MfaResetResult {
  readonly userId: string;
  readonly status: "applied" | "planned" | "failed";
  readonly methods: readonly string[];
  readonly state: MfaUserState;
  readonly error: string | null;
}

export interface MfaBulkResetSummary {
  readonly total: number;
  readonly applied: number;
  readonly planned: number;
  readonly failed: number;
}

export interface MfaBulkResetResponse {
  readonly rows: readonly MfaResetResult[];
  readonly summary: MfaBulkResetSummary;
}

export interface TapCreateResult {
  readonly id: string | null;
  readonly userId: string;
  readonly status: "applied" | "planned" | "failed";
  readonly lifetimeMinutes: number;
  readonly oneTime: boolean;
  readonly startTime: string | null;
  readonly expiresAt: string | null;
  readonly temporaryAccessPass: string | null;
  readonly error: string | null;
}

export interface MfaPushResult {
  readonly userId: string;
  readonly status: "applied" | "planned" | "failed";
  readonly pushTarget: string | null;
  readonly error: string | null;
}

export interface MfaDefaultMethodResult {
  readonly userId: string;
  readonly status: "applied" | "planned" | "failed";
  readonly methods: readonly string[];
  readonly defaultMethod: string | null;
  readonly error: string | null;
}

export interface ResetMfaInput {
  readonly reason: string;
  readonly confirm?: boolean;
  readonly dryRun?: boolean;
}

export async function resetUserMfa(
  tenantId: string,
  userId: string,
  input: ResetMfaInput,
  fetcher: Fetcher = fetch,
): Promise<MfaResetResult> {
  const url = `/v1/tenants/${encodeURIComponent(tenantId)}/users/${encodeURIComponent(userId)}/reset-mfa`;
  const res = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      confirm: input.confirm ?? true,
      reason: input.reason,
      dryRun: input.dryRun ?? false,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Failed to reset MFA (${res.status}): ${errorText}`);
  }

  return (await res.json()) as MfaResetResult;
}

export interface BulkResetMfaInput {
  readonly userIds: readonly string[];
  readonly reason: string;
  readonly confirmCount: number;
  readonly confirm?: boolean;
  readonly dryRun?: boolean;
}

export async function bulkResetMfa(
  tenantId: string,
  input: BulkResetMfaInput,
  fetcher: Fetcher = fetch,
): Promise<MfaBulkResetResponse> {
  const url = `/v1/tenants/${encodeURIComponent(tenantId)}/mfa-reset`;
  const res = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      userIds: input.userIds,
      reason: input.reason,
      confirm: input.confirm ?? true,
      confirmCount: input.confirmCount,
      dryRun: input.dryRun ?? false,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Failed to bulk reset MFA (${res.status}): ${errorText}`);
  }

  return (await res.json()) as MfaBulkResetResponse;
}

export interface CreateTapInput {
  readonly lifetimeMinutes?: number;
  readonly oneTime?: boolean;
  readonly startTime?: string | null;
  readonly reason?: string;
  readonly confirm?: boolean;
  readonly dryRun?: boolean;
}

export async function createTemporaryAccessPass(
  tenantId: string,
  userId: string,
  input: CreateTapInput = {},
  fetcher: Fetcher = fetch,
): Promise<TapCreateResult> {
  const url = `/v1/tenants/${encodeURIComponent(tenantId)}/users/${encodeURIComponent(userId)}/tap`;
  const res = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      confirm: input.confirm ?? true,
      reason: input.reason ?? "Temporary Access Pass generation",
      lifetimeMinutes: input.lifetimeMinutes,
      oneTime: input.oneTime,
      startTime: input.startTime,
      dryRun: input.dryRun ?? false,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Failed to create TAP (${res.status}): ${errorText}`);
  }

  return (await res.json()) as TapCreateResult;
}

export interface SendPushInput {
  readonly reason?: string;
  readonly confirm?: boolean;
  readonly dryRun?: boolean;
}

export async function sendPushNotification(
  tenantId: string,
  userId: string,
  input: SendPushInput = {},
  fetcher: Fetcher = fetch,
): Promise<MfaPushResult> {
  const url = `/v1/tenants/${encodeURIComponent(tenantId)}/users/${encodeURIComponent(userId)}/push`;
  const res = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      confirm: input.confirm ?? true,
      reason: input.reason ?? "MFA push notification test",
      dryRun: input.dryRun ?? false,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Failed to send push notification (${res.status}): ${errorText}`);
  }

  return (await res.json()) as MfaPushResult;
}

export interface SetDefaultMethodInput {
  readonly method: string;
  readonly reason?: string;
  readonly confirm?: boolean;
  readonly dryRun?: boolean;
}

export async function setUserDefaultMethod(
  tenantId: string,
  userId: string,
  input: SetDefaultMethodInput,
  fetcher: Fetcher = fetch,
): Promise<MfaDefaultMethodResult> {
  const url = `/v1/tenants/${encodeURIComponent(tenantId)}/users/${encodeURIComponent(userId)}/default-method`;
  const res = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      method: input.method,
      confirm: input.confirm ?? true,
      reason: input.reason ?? "Default authentication method update",
      dryRun: input.dryRun ?? false,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Failed to set default method (${res.status}): ${errorText}`);
  }

  return (await res.json()) as MfaDefaultMethodResult;
}

