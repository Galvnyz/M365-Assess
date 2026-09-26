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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** The template's standards count (one setting per referenced standard). */
export function standardsCount(template: Pick<StandardTemplate, "settings">): number {
  return template.settings.length;
}

/** Human label for a kind. */
export function kindLabel(kind: StandardTemplateKind): string {
  return kind === "drift" ? "Drift" : "Standards";
}
