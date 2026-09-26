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
