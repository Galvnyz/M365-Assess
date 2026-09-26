// Typed drift API client (EPIC-009 SPEC.md §3.1, §3.2, §6; T-0168).
// Wraps the T-0164 read/refresh endpoints, the T-0165 accept/override
// endpoints, the T-0166 deny endpoint, and the T-0167 bulk endpoint behind
// small typed functions. A `fetcher` seam keeps the client testable without
// a live BFF.

export type DriftDeviationState =
  | "open"
  | "accepted"
  | "customerSpecific"
  | "denied"
  | "deletePending"
  | "resolved";

export type DriftDeviationKind = "mismatch" | "extra";

export type DriftBulkAction = "accept" | "deny-delete" | "deny-remediate";

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

export interface DriftBreakdown {
  readonly open: number;
  readonly accepted: number;
  readonly customerSpecific: number;
  readonly denied: number;
  readonly deletePending: number;
  readonly resolved: number;
  readonly total: number;
}

export interface DriftResponse {
  readonly tenantId: string;
  readonly breakdown: DriftBreakdown;
  readonly items: readonly DriftDeviation[];
}

/** Shown verbatim in the deny confirmation (SPEC §3.2, §8; BFF DRIFT_DENY_WARNING). */
export const DRIFT_DENY_WARNING =
  "DELETED from the tenant on the next remediation run; cannot be undone";

export interface DriftQueryFilters {
  readonly state?: DriftDeviationState;
  readonly kind?: DriftDeviationKind;
}

export interface AcceptDeviationInput {
  readonly reason: string;
  readonly expiresOn: string;
  readonly autoRemediateOnExpiry?: boolean;
}

export interface OverrideDeviationInput {
  readonly overrideValue: unknown;
  readonly reason?: string | null;
}

export interface DenyDeviationInput {
  readonly reason: string;
  readonly confirm: true;
  readonly delayDays?: number;
}

export interface BulkTriageInput {
  readonly tenantId: string;
  readonly action: DriftBulkAction;
  readonly deviationIds: readonly string[];
  readonly reason: string;
  readonly confirm?: boolean;
  readonly delayDays?: number;
  readonly expiresOn?: string | null;
  readonly autoRemediateOnExpiry?: boolean;
}

export interface BulkTriageResult {
  readonly tenantId: string;
  readonly action: DriftBulkAction;
  readonly applied: readonly { deviationId: string; state: DriftDeviationState }[];
  readonly skipped: readonly { deviationId: string; reason: string }[];
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

async function postJson<T>(path: string, body: unknown, what: string, fetcher?: Fetcher): Promise<T> {
  const response = await asFetcher(fetcher)(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await expectOk(response, what)) as T;
}

// ─── Read / refresh (T-0164) ────────────────────────────────────────────────

export async function fetchDrift(
  tenantId: string,
  filters: DriftQueryFilters = {},
  fetcher?: Fetcher,
): Promise<DriftResponse> {
  const query = new URLSearchParams();
  if (filters.state) query.set("state", filters.state);
  if (filters.kind) query.set("kind", filters.kind);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const response = await asFetcher(fetcher)(`/v1/drift/${encodeURIComponent(tenantId)}${suffix}`);
  return (await expectOk(response, "Loading drift deviations")) as DriftResponse;
}

export async function refreshDrift(
  tenantId: string,
  fetcher?: Fetcher,
): Promise<{ tenantId: string; status: string }> {
  const response = await asFetcher(fetcher)(`/v1/drift/${encodeURIComponent(tenantId)}/refresh`, {
    method: "POST",
  });
  return (await expectOk(response, "Refreshing drift deviations")) as {
    tenantId: string;
    status: string;
  };
}

// ─── Triage: accept / override (T-0165) ─────────────────────────────────────

export async function acceptDeviation(
  deviationId: string,
  input: AcceptDeviationInput,
  fetcher?: Fetcher,
): Promise<{ deviation: DriftDeviation }> {
  return postJson<{ deviation: DriftDeviation }>(
    `/v1/drift/deviations/${encodeURIComponent(deviationId)}/accept`,
    {
      reason: input.reason,
      expiresOn: input.expiresOn,
      autoRemediateOnExpiry: input.autoRemediateOnExpiry === true,
    },
    "Accepting drift deviation",
    fetcher,
  );
}

export async function overrideDeviation(
  deviationId: string,
  input: OverrideDeviationInput,
  fetcher?: Fetcher,
): Promise<{ deviation: DriftDeviation }> {
  return postJson<{ deviation: DriftDeviation }>(
    `/v1/drift/deviations/${encodeURIComponent(deviationId)}/override`,
    { overrideValue: input.overrideValue, reason: input.reason ?? null },
    "Overriding drift deviation",
    fetcher,
  );
}

export async function removeDeviationOverride(
  deviationId: string,
  fetcher?: Fetcher,
): Promise<{ deviation: DriftDeviation }> {
  const response = await asFetcher(fetcher)(
    `/v1/drift/deviations/${encodeURIComponent(deviationId)}/override`,
    { method: "DELETE" },
  );
  return (await expectOk(response, "Removing drift override")) as {
    deviation: DriftDeviation;
  };
}

// ─── Deny: queued deletion (T-0166) ─────────────────────────────────────────

export async function denyDeviation(
  deviationId: string,
  input: DenyDeviationInput,
  fetcher?: Fetcher,
): Promise<{ deviation: DriftDeviation; deletionQueued: boolean }> {
  return postJson(
    `/v1/drift/deviations/${encodeURIComponent(deviationId)}/deny`,
    { reason: input.reason, confirm: true, delayDays: input.delayDays ?? 0 },
    "Denying drift deviation",
    fetcher,
  );
}

// ─── Bulk triage (T-0167) ───────────────────────────────────────────────────

export async function bulkTriageDrift(
  input: BulkTriageInput,
  fetcher?: Fetcher,
): Promise<BulkTriageResult> {
  return postJson<BulkTriageResult>(
    "/v1/drift/bulk",
    {
      tenantId: input.tenantId,
      action: input.action,
      deviationIds: [...input.deviationIds],
      reason: input.reason,
      confirm: input.confirm === true,
      delayDays: input.delayDays ?? 0,
      expiresOn: input.expiresOn ?? null,
      autoRemediateOnExpiry: input.autoRemediateOnExpiry === true,
    },
    "Applying bulk drift triage",
    fetcher,
  );
}
