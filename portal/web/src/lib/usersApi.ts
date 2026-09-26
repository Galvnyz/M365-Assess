// Typed users API client (EPIC-011 SPEC.md §3.1, §6; T-0209).
// Wraps the T-0201 directory read (list/search/filter/reports) and the
// T-0202 create plus T-0204 lifecycle-action endpoints behind small typed
// functions. A `fetcher` seam keeps the client testable without a live BFF.

export type TenantUserType = "member" | "guest";
export type TenantUserStatus = "enabled" | "disabled";
export type TenantUsersReport = "inactive" | "guest" | "signin";

export interface TenantUser {
  readonly id: string;
  readonly displayName: string | null;
  readonly userPrincipalName: string;
  readonly userType: TenantUserType;
  readonly licenses: readonly string[];
  readonly mfaState: "registered" | "notRegistered" | "unknown";
  readonly lastSignInDateTime: string | null;
  readonly status: TenantUserStatus;
  readonly department: string | null;
}

export interface TenantUsersFilter {
  readonly search?: string;
  readonly status?: TenantUserStatus;
  readonly type?: TenantUserType;
  readonly license?: "licensed" | "unlicensed";
  readonly mfaState?: TenantUser["mfaState"];
  readonly department?: string;
  readonly inactiveDays?: number;
  readonly report?: TenantUsersReport;
  readonly limit?: number;
}

export interface TenantUsersPage {
  readonly items: readonly TenantUser[];
  readonly nextCursor: string | null;
}

export type UserLifecycleAction =
  | "resetPassword"
  | "requirePasswordChange"
  | "revokeSessions"
  | "disable"
  | "enable"
  | "restore";

export interface UserActionResult {
  readonly userId: string;
  readonly action: UserLifecycleAction;
  readonly status: "applied" | "planned" | "failed";
  readonly password: string | null;
  readonly error: string | null;
}

export interface UserCreateRowResult {
  readonly row: number;
  readonly userPrincipalName: string;
  readonly status: "created" | "planned" | "failed";
  readonly id: string | null;
  readonly error: string | null;
}

export type Fetcher = typeof fetch;

function asFetcher(fetcher?: Fetcher): Fetcher {
  return fetcher ?? fetch;
}

async function expectOk(response: Response, what: string): Promise<unknown> {
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { message?: string };
      if (body?.message) detail = body.message;
    } catch {
      // non-JSON error body; keep the status text
    }
    throw new Error(`${what} failed: ${response.status} ${detail}`);
  }
  return response.json();
}

function usersQuery(filter: TenantUsersFilter = {}): string {
  const params = new URLSearchParams();
  if (filter.search) params.set("search", filter.search);
  if (filter.status) params.set("status", filter.status);
  if (filter.type) params.set("type", filter.type);
  if (filter.license) params.set("license", filter.license);
  if (filter.mfaState) params.set("mfaState", filter.mfaState);
  if (filter.department) params.set("department", filter.department);
  if (filter.inactiveDays !== undefined) params.set("inactiveDays", String(filter.inactiveDays));
  if (filter.report) params.set("report", filter.report);
  if (filter.limit !== undefined) params.set("limit", String(filter.limit));
  const query = params.toString();
  return query.length > 0 ? `?${query}` : "";
}

export async function listTenantUsers(
  tenantId: string,
  filter: TenantUsersFilter = {},
  fetcher?: Fetcher,
): Promise<TenantUsersPage> {
  const response = await asFetcher(fetcher)(
    `/v1/tenants/${encodeURIComponent(tenantId)}/users${usersQuery(filter)}`,
  );
  const body = (await expectOk(response, "List users")) as {
    items?: TenantUser[];
    nextCursor?: string | null;
  };
  return { items: body.items ?? [], nextCursor: body.nextCursor ?? null };
}

export async function createTenantUsers(
  tenantId: string,
  input: Record<string, unknown>,
  fetcher?: Fetcher,
): Promise<{ rows: readonly UserCreateRowResult[] }> {
  const response = await asFetcher(fetcher)(
    `/v1/tenants/${encodeURIComponent(tenantId)}/users`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  const body = (await expectOk(response, "Create users")) as {
    rows?: UserCreateRowResult[];
  };
  return { rows: body.rows ?? [] };
}

export async function executeUserAction(
  tenantId: string,
  userId: string,
  action: UserLifecycleAction,
  input: { confirm?: boolean; dryRun?: boolean; password?: string } = {},
  fetcher?: Fetcher,
): Promise<UserActionResult> {
  const response = await asFetcher(fetcher)(
    `/v1/tenants/${encodeURIComponent(tenantId)}/users/${encodeURIComponent(userId)}/actions/${encodeURIComponent(action)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return (await expectOk(response, `User action ${action}`)) as UserActionResult;
}
