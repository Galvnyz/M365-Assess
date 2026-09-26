// Typed baselines API client (EPIC-010 SPEC.md §6; T-0183).
// Wraps the T-0182 CRUD and assignment endpoints behind small typed
// functions. A `fetcher` seam keeps the client testable without a live BFF.

export type BaselineStageAction = "report" | "remediate";

export interface BaselineConditionInput {
  readonly key: string;
  readonly expected: unknown;
}

export interface BaselineStageInput {
  readonly order: number;
  readonly conditions: readonly BaselineConditionInput[];
  readonly action: BaselineStageAction;
}

export type BaselineTargetType = "allTenants" | "group" | "tenant";

export interface BaselineAssignmentInput {
  readonly targetType: BaselineTargetType;
  readonly targetId?: string | null;
  readonly precedence?: number;
}

export interface BaselineSummary {
  readonly id: string;
  readonly name: string;
  readonly logic: "and";
  readonly alerting: { enabled: boolean };
  readonly enabled: boolean;
  readonly stages: readonly BaselineStageInput[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BaselineDetail extends BaselineSummary {
  readonly assignments: readonly {
    readonly baselineId: string;
    readonly targetType: BaselineTargetType;
    readonly targetId: string | null;
    readonly precedence: number;
  }[];
}

export interface CreateBaselineRequest {
  readonly id?: string;
  readonly name: string;
  readonly alerting?: { enabled: boolean };
  readonly enabled?: boolean;
  readonly stages?: readonly BaselineStageInput[];
  readonly assignments?: readonly BaselineAssignmentInput[];
}

export type UpdateBaselineRequest = Partial<CreateBaselineRequest>;

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

export async function fetchBaselines(fetcher?: Fetcher): Promise<BaselineSummary[]> {
  const response = await asFetcher(fetcher)("/v1/baselines");
  const body = (await expectOk(response, "Loading baselines")) as { items?: BaselineSummary[] };
  return body.items ?? [];
}

export async function fetchBaseline(baselineId: string, fetcher?: Fetcher): Promise<BaselineDetail> {
  const response = await asFetcher(fetcher)(`/v1/baselines/${encodeURIComponent(baselineId)}`);
  return (await expectOk(response, "Loading baseline")) as BaselineDetail;
}

export async function createBaseline(input: CreateBaselineRequest, fetcher?: Fetcher): Promise<BaselineDetail> {
  const response = await asFetcher(fetcher)("/v1/baselines", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await expectOk(response, "Creating baseline")) as BaselineDetail;
}

export async function updateBaseline(
  baselineId: string,
  patch: UpdateBaselineRequest,
  fetcher?: Fetcher,
): Promise<BaselineDetail> {
  const response = await asFetcher(fetcher)(`/v1/baselines/${encodeURIComponent(baselineId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return (await expectOk(response, "Updating baseline")) as BaselineDetail;
}

export async function deleteBaseline(baselineId: string, fetcher?: Fetcher): Promise<void> {
  const response = await asFetcher(fetcher)(`/v1/baselines/${encodeURIComponent(baselineId)}`, {
    method: "DELETE",
  });
  await expectOk(response, "Deleting baseline");
}

export async function assignBaseline(
  baselineId: string,
  assignments: readonly BaselineAssignmentInput[],
  fetcher?: Fetcher,
): Promise<BaselineDetail["assignments"]> {
  const response = await asFetcher(fetcher)(`/v1/baselines/${encodeURIComponent(baselineId)}/assign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignments }),
  });
  const body = (await expectOk(response, "Assigning baseline")) as {
    assignments: BaselineDetail["assignments"];
  };
  return body.assignments;
}

// ─── Fleet overview (T-0187) ────────────────────────────────────────────────

export interface FleetDeviationStates {
  readonly open: number;
  readonly accepted: number;
  readonly customerSpecific: number;
  readonly denied: number;
  readonly deletePending: number;
  readonly resolved: number;
  readonly total: number;
}

export interface FleetBaselineRow {
  readonly id: string;
  readonly name: string;
  readonly stages: number;
  readonly assignedTenants: number;
  readonly fleetCompliance: number;
  readonly lastRunAt: string | null;
}

export interface TenantNeedingAttention {
  readonly tenantId: string;
  readonly baselineId: string;
  readonly stage: number;
  readonly state: string;
  readonly openDeviations: number;
}

export interface FleetOverview {
  readonly baselines: readonly FleetBaselineRow[];
  readonly deviationStates: FleetDeviationStates;
  readonly needsAttention: readonly TenantNeedingAttention[];
  readonly acceptedDenied: { readonly accepted: number; readonly denied: number };
}

export async function fetchFleetOverview(fetcher?: Fetcher): Promise<FleetOverview> {
  const response = await asFetcher(fetcher)("/v1/baselines/fleet");
  return (await expectOk(response, "Loading fleet overview")) as FleetOverview;
}
