// Typed standards API client (EPIC-008 SPEC.md §3.1, §6; T-0146).
// Wraps the T-0143 template endpoints plus the T-0150 run-now/schedule paths
// (the server side of the latter lands in T-0150). A `fetcher` seam keeps the
// client testable without a live BFF.

export type StandardTemplateKind = "standards" | "drift";

export interface StandardTemplateActions {
  readonly report: boolean;
  readonly alert: boolean;
  readonly remediate: boolean;
}

export interface StandardTemplateSetting {
  readonly key: string;
  readonly value: unknown;
}

export interface StandardTemplate {
  readonly id: string;
  readonly name: string;
  readonly kind: StandardTemplateKind;
  readonly actions: StandardTemplateActions;
  readonly autoRemediate: boolean;
  readonly settings: readonly StandardTemplateSetting[];
  readonly scheduleId: string | null;
}

export interface CreateTemplateInput {
  readonly name: string;
  readonly kind?: StandardTemplateKind;
  readonly actions?: Partial<StandardTemplateActions>;
  readonly autoRemediate?: boolean;
  readonly settings?: readonly StandardTemplateSetting[];
  readonly scheduleId?: string | null;
}

export type UpdateTemplateInput = Partial<Omit<CreateTemplateInput, "name">> & {
  readonly name?: string;
};

export type Fetcher = typeof fetch;

function asFetcher(fetcher?: Fetcher): Fetcher {
  return fetcher ?? fetch;
}

async function expectOk(response: Response, what: string): Promise<Response> {
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
  return response;
}

async function readJson<T>(response: Response, what: string): Promise<T> {
  await expectOk(response, what);
  return response.json() as Promise<T>;
}

// ─── Templates ────────────────────────────────────────────────────────────────

export async function fetchStandardTemplates(
  options: { kind?: StandardTemplateKind } = {},
  fetcher?: Fetcher,
): Promise<StandardTemplate[]> {
  const query = options.kind ? `?kind=${encodeURIComponent(options.kind)}` : "";
  const body = await readJson<{ items?: StandardTemplate[] }>(
    await asFetcher(fetcher)(`/v1/standards/templates${query}`),
    "Loading standards templates",
  );
  return body.items ?? [];
}

export async function fetchStandardTemplate(id: string, fetcher?: Fetcher): Promise<StandardTemplate> {
  const body = await readJson<{ template: StandardTemplate }>(
    await asFetcher(fetcher)(`/v1/standards/templates/${encodeURIComponent(id)}`),
    "Loading standards template",
  );
  return body.template;
}

export async function createStandardTemplate(
  input: CreateTemplateInput,
  fetcher?: Fetcher,
): Promise<StandardTemplate> {
  const body = await readJson<{ template: StandardTemplate }>(
    await asFetcher(fetcher)("/v1/standards/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
    "Creating standards template",
  );
  return body.template;
}

export async function updateStandardTemplate(
  id: string,
  patch: UpdateTemplateInput,
  fetcher?: Fetcher,
): Promise<StandardTemplate> {
  const body = await readJson<{ template: StandardTemplate }>(
    await asFetcher(fetcher)(`/v1/standards/templates/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
    "Updating standards template",
  );
  return body.template;
}

export async function deleteStandardTemplate(id: string, fetcher?: Fetcher): Promise<void> {
  await expectOk(
    await asFetcher(fetcher)(`/v1/standards/templates/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
    "Deleting standards template",
  );
}

export async function cloneStandardTemplate(
  id: string,
  options: { name?: string; includeAssignments?: boolean } = {},
  fetcher?: Fetcher,
): Promise<StandardTemplate> {
  const body = await readJson<{ template: StandardTemplate }>(
    await asFetcher(fetcher)(`/v1/standards/templates/${encodeURIComponent(id)}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    }),
    "Cloning standards template",
  );
  return body.template;
}

/**
 * Creates a drift clone: a new `drift` template carrying the source's settings,
 * with remediation stripped (drift is observe-only). EPIC-009 owns drift.
 */
export async function createDriftClone(
  source: StandardTemplate,
  fetcher?: Fetcher,
): Promise<StandardTemplate> {
  return createStandardTemplate(
    {
      name: `${source.name} (drift)`,
      kind: "drift",
      actions: { report: true, alert: source.actions.alert, remediate: false },
      autoRemediate: false,
      settings: source.settings,
      scheduleId: null,
    },
    fetcher,
  );
}

/** Convert (a `kind` change) via PATCH; the server validates legality. */
export async function convertStandardTemplate(
  id: string,
  kind: StandardTemplateKind,
  fetcher?: Fetcher,
): Promise<StandardTemplate> {
  return updateStandardTemplate(id, { kind }, fetcher);
}

// ─── Run now / schedule (SPEC §6 paths; server side is T-0150) ────────────────

export async function runStandardTemplateNow(
  id: string,
  tenantId: string,
  fetcher?: Fetcher,
): Promise<{ jobId?: string; runId?: string }> {
  return readJson<{ jobId?: string; runId?: string }>(
    await asFetcher(fetcher)(`/v1/standards/templates/${encodeURIComponent(id)}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId }),
    }),
    "Running standards template",
  );
}

export async function setStandardTemplateSchedule(
  id: string,
  scheduleId: string | null,
  fetcher?: Fetcher,
): Promise<StandardTemplate> {
  const body = await readJson<{ template: StandardTemplate }>(
    await asFetcher(fetcher)(`/v1/standards/templates/${encodeURIComponent(id)}/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduleId }),
    }),
    "Setting standards template schedule",
  );
  return body.template;
}

// ─── Catalog (SPEC §3.2 picker, §6; T-0144/T-0147) ───────────────────────────

export interface CatalogStandard {
  readonly id: string;
  readonly check: string;
  readonly name: string;
  readonly category: string;
  readonly licensePreset: string | null;
  /** eligible | license-missing | unknown-license, or null when unevaluated. */
  readonly licenseState: string | null;
  readonly licenseReason: string | null;
}

export async function fetchStandardsCatalog(
  options: { category?: string; tenantId?: string } = {},
  fetcher?: Fetcher,
): Promise<CatalogStandard[]> {
  const query = new URLSearchParams();
  if (options.category) query.set("category", options.category);
  if (options.tenantId) query.set("tenantId", options.tenantId);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const body = await readJson<{ items?: CatalogStandard[] }>(
    await asFetcher(fetcher)(`/v1/standards/catalog${suffix}`),
    "Loading standards catalog",
  );
  return body.items ?? [];
}

/** Derived impact used by the picker's impact filter (E5 checks are higher impact). */
export type StandardImpact = "standard" | "high" | "unknown";

export function standardImpact(standard: Pick<CatalogStandard, "licensePreset">): StandardImpact {
  if (standard.licensePreset === "E5") return "high";
  if (standard.licensePreset === "E3") return "standard";
  return "unknown";
}

export function isLicenseMissing(standard: Pick<CatalogStandard, "licenseState">): boolean {
  return standard.licenseState === "license-missing";
}

// ─── Alignment / compare (SPEC §3.3, §3.4, §6; T-0148) ───────────────────────

export const ALIGNMENT_STATUSES = [
  "compliant",
  "non-compliant",
  "accepted deviation",
  "customer specific",
  "license missing",
  "reporting disabled",
] as const;
export type AlignmentStatus = (typeof ALIGNMENT_STATUSES)[number];

export const ALIGNMENT_VIEWS = ["summary", "by-standard", "aggregate"] as const;
export type AlignmentView = (typeof ALIGNMENT_VIEWS)[number];

export const ALIGNMENT_VIEW_LABELS: Record<AlignmentView, string> = {
  summary: "Tenant/template summary",
  "by-standard": "Tenant rows for each standard",
  aggregate: "Aggregate tenant compliance by standard",
};

export interface ComplianceCounts {
  readonly total: number;
  readonly compliant: number;
  readonly nonCompliant: number;
  readonly acceptedDeviation: number;
  readonly customerSpecific: number;
  readonly licenseMissing: number;
  readonly reportingDisabled: number;
  readonly compliantPct: number;
}

export interface AlignmentSummaryRow extends ComplianceCounts {
  readonly tenantId: string;
}

export interface AlignmentAggregateRow extends ComplianceCounts {
  readonly check: string;
}

export interface AlignmentByStandardRow {
  readonly tenantId: string;
  readonly check: string;
  readonly current: unknown;
  readonly expected: unknown;
  readonly state: AlignmentStatus;
  readonly lastRunAt: string | null;
}

export async function fetchStandardsAlignment(
  view: AlignmentView = "summary",
  options: { tenantId?: string } = {},
  fetcher?: Fetcher,
): Promise<{ view: AlignmentView; items: readonly unknown[] }> {
  const query = new URLSearchParams({ view });
  if (options.tenantId) query.set("tenantId", options.tenantId);
  return readJson<{ view: AlignmentView; items: readonly unknown[] }>(
    await asFetcher(fetcher)(`/v1/standards/alignment?${query.toString()}`),
    "Loading standards alignment",
  );
}

export interface StandardsCompareResponse {
  readonly tenantId: string;
  readonly summary: ComplianceCounts;
  readonly items: readonly AlignmentByStandardRow[];
}

export async function fetchStandardsCompare(
  tenantId: string,
  fetcher?: Fetcher,
): Promise<StandardsCompareResponse> {
  return readJson<StandardsCompareResponse>(
    await asFetcher(fetcher)(`/v1/standards/compare/${encodeURIComponent(tenantId)}`),
    "Loading standards comparison",
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** The template's standards count (one setting per referenced standard). */
export function standardsCount(template: Pick<StandardTemplate, "settings">): number {
  return template.settings.length;
}

/** Human label for a kind. */
export function kindLabel(kind: StandardTemplateKind): string {
  return kind === "drift" ? "Drift" : "Standards";
}
