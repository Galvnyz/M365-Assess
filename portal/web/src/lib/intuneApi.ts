// intuneApi.ts — Client API helpers for Intune policies (EPIC-016 SPEC.md §3.1, §6; T-0303).

export type IntunePlatform = "windows" | "android" | "ios" | "macos";
export type IntunePolicyKind = "configuration" | "compliance" | "app-protection";

export interface IntunePolicyAssignment {
  readonly id: string;
  readonly target: string;
  readonly targetType: string;
}

export interface IntunePolicyItem {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly platform: string;
  readonly policyType: string;
  readonly assignedToCount: number;
  readonly assignments: readonly IntunePolicyAssignment[];
  readonly lastModifiedDateTime: string | null;
  readonly modifiedBy: string | null;
  readonly settingsSummary?: Record<string, unknown>;
}

export interface IntunePoliciesPage {
  readonly tenantId: string;
  readonly kind: string;
  readonly totalCount: number;
  readonly items: readonly IntunePolicyItem[];
  readonly nextCursor: string | null;
}

export interface IntunePoliciesFilter {
  readonly platform?: string;
  readonly policyType?: string;
  readonly assigned?: boolean;
  /** ISO date (YYYY-MM-DD); policies modified on or after this day. */
  readonly modifiedDate?: string;
  readonly search?: string;
  readonly cursor?: string | null;
  readonly limit?: number;
}

/** Error carrying the HTTP status and BFF error code, so pages can tell 501 (unsupported kind) apart. */
export class IntuneApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "IntuneApiError";
  }
}

async function throwApiError(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
  throw new IntuneApiError(body.message || `${fallback}: HTTP ${res.status}`, res.status, body.code);
}

export async function fetchIntunePolicies(
  tenantId: string,
  kind: IntunePolicyKind,
  filter?: IntunePoliciesFilter,
  baseUrl = "",
): Promise<IntunePoliciesPage> {
  const params = new URLSearchParams();
  if (filter?.platform) params.set("platform", filter.platform);
  if (filter?.policyType) params.set("policyType", filter.policyType);
  if (filter?.assigned !== undefined) params.set("assigned", String(filter.assigned));
  if (filter?.modifiedDate) params.set("modifiedDate", filter.modifiedDate);
  if (filter?.search) params.set("search", filter.search);
  if (filter?.cursor) params.set("cursor", filter.cursor);
  if (filter?.limit !== undefined) params.set("limit", String(filter.limit));

  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(
    `${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/intune/${kind}${query}`,
  );
  if (!res.ok) await throwApiError(res, "Failed to list Intune policies");
  return res.json() as Promise<IntunePoliciesPage>;
}

export async function deleteIntunePolicy(
  tenantId: string,
  kind: IntunePolicyKind,
  policyId: string,
  confirmName: string,
  baseUrl = "",
): Promise<void> {
  const res = await fetch(
    `${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/intune/${kind}/${encodeURIComponent(policyId)}`,
    {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmName }),
    },
  );
  if (!res.ok) await throwApiError(res, "Failed to delete Intune policy");
}

// ---- Templates (T-0305 API) ----

export interface IntuneTemplateInput {
  readonly name: string;
  readonly platform: string;
  readonly policyType: "configuration" | "compliance";
  readonly policyJson: Record<string, unknown>;
  readonly assignments?: readonly Record<string, unknown>[];
}

export interface IntuneTemplate extends IntuneTemplateInput {
  readonly id: string;
  readonly source: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Build the template payload for "Clone to template". Returns null when the
 * policy's kind/platform has no v1 template support (the T-0305 API accepts
 * Windows configuration and compliance only; the list API reports "windows",
 * the template registry names it "windows10").
 */
export function templateInputFromPolicy(
  policy: IntunePolicyItem,
  kind: IntunePolicyKind,
): IntuneTemplateInput | null {
  if (kind === "app-protection") return null;
  if (policy.platform.toLowerCase() !== "windows") return null;
  const displayName = policy.displayName || policy.name;
  return {
    name: displayName,
    platform: "windows10",
    policyType: kind,
    policyJson: {
      displayName,
      "@odata.type": policyTypeInfo(kind, "windows")!.odataType,
      settings: { ...(policy.settingsSummary ?? {}) },
    },
    assignments: policy.assignments.map((a) => ({ target: a.target, targetType: a.targetType })),
  };
}

export async function createIntuneTemplate(
  input: IntuneTemplateInput,
  baseUrl = "",
): Promise<IntuneTemplate> {
  const res = await fetch(`${baseUrl}/v1/intune-templates`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) await throwApiError(res, "Failed to create Intune template");
  return res.json() as Promise<IntuneTemplate>;
}

/** JSON for the `Export` row action: the policy as listed, for download. */
export function exportIntunePolicyJson(policy: IntunePolicyItem): string {
  return JSON.stringify(policy, null, 2);
}

// ---- Policy-type registry mirror (T-0301) ----

export interface IntunePolicyTypeInfo {
  readonly kind: IntunePolicyKind;
  readonly platform: IntunePlatform;
  readonly odataType: string;
  /** Whether v1 supports writes for this kind/platform. */
  readonly supported: boolean;
}

/** Web mirror of the BFF registry in portal/bff/src/domain/intune-policy-types.ts. */
export const INTUNE_POLICY_TYPES: readonly IntunePolicyTypeInfo[] = [
  { kind: "configuration", platform: "windows", odataType: "#microsoft.graph.deviceManagementConfigurationPolicy", supported: true },
  { kind: "compliance", platform: "windows", odataType: "#microsoft.graph.windows10CompliancePolicy", supported: true },
  { kind: "configuration", platform: "android", odataType: "#microsoft.graph.deviceManagementConfigurationPolicy", supported: false },
  { kind: "configuration", platform: "ios", odataType: "#microsoft.graph.deviceManagementConfigurationPolicy", supported: false },
  { kind: "configuration", platform: "macos", odataType: "#microsoft.graph.deviceManagementConfigurationPolicy", supported: false },
  { kind: "compliance", platform: "android", odataType: "#microsoft.graph.androidCompliancePolicy", supported: false },
  { kind: "compliance", platform: "ios", odataType: "#microsoft.graph.iosCompliancePolicy", supported: false },
  { kind: "compliance", platform: "macos", odataType: "#microsoft.graph.macOSCompliancePolicy", supported: false },
  { kind: "app-protection", platform: "android", odataType: "#microsoft.graph.androidManagedAppProtection", supported: false },
  { kind: "app-protection", platform: "ios", odataType: "#microsoft.graph.iosManagedAppProtection", supported: false },
];

export function policyTypeInfo(kind: string, platform: string): IntunePolicyTypeInfo | undefined {
  const p = platform.toLowerCase();
  return INTUNE_POLICY_TYPES.find((t) => t.kind === kind && t.platform === p);
}

// ---- Policy CRUD with plan preview (T-0302 API) ----

export interface IntunePlan {
  readonly action: "create" | "edit" | "delete";
  readonly kind: string;
  readonly policyId?: string;
  readonly targetName: string;
  readonly before?: Record<string, unknown> | null;
  readonly after?: Record<string, unknown> | null;
  readonly beforeAssignments?: readonly IntunePolicyAssignment[];
  readonly afterAssignments?: readonly IntunePolicyAssignment[];
  readonly diff: readonly string[];
  readonly valid: boolean;
  readonly dryRun: boolean;
  readonly requiresConfirmation: boolean;
}

export interface IntuneCrudResult {
  readonly success: boolean;
  readonly plan: IntunePlan;
  readonly result?: Record<string, unknown>;
}

export interface IntunePolicySaveInput {
  readonly displayName: string;
  readonly platform: string;
  /** Structured settings (common types). */
  readonly settings?: Record<string, unknown>;
  /** Raw policy JSON text (advanced types). */
  readonly policyJson?: string;
  readonly assignments: readonly IntunePolicyAssignment[];
}

/**
 * Create (policyId null) or edit a policy. `preview: true` returns the plan
 * without applying; `preview: false` applies. The route may answer with a bare
 * plan or a result wrapping one; both are normalised to IntuneCrudResult.
 */
export async function saveIntunePolicy(
  tenantId: string,
  kind: IntunePolicyKind,
  policyId: string | null,
  input: IntunePolicySaveInput,
  preview: boolean,
  baseUrl = "",
): Promise<IntuneCrudResult> {
  const base = `${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/intune/${kind}`;
  const res = await fetch(policyId ? `${base}/${encodeURIComponent(policyId)}` : base, {
    method: policyId ? "PATCH" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, preview }),
  });
  if (!res.ok) await throwApiError(res, "Failed to save Intune policy");
  const body = (await res.json()) as IntuneCrudResult | IntunePlan;
  return "plan" in body ? body : { success: !preview, plan: body };
}

/** Find one policy by id. The list API has no item route, so this walks its pages. */
export async function getIntunePolicy(
  tenantId: string,
  kind: IntunePolicyKind,
  policyId: string,
  baseUrl = "",
): Promise<IntunePolicyItem | null> {
  let cursor: string | null = null;
  do {
    const page: IntunePoliciesPage = await fetchIntunePolicies(
      tenantId,
      kind,
      { cursor, limit: 100 },
      baseUrl,
    );
    const hit = page.items.find((p) => p.id === policyId);
    if (hit) return hit;
    cursor = page.nextCursor;
  } while (cursor);
  return null;
}

// ---- Template list/edit/delete (T-0305 API) and deploy (T-0306 API) ----

export interface IntuneTemplatesPage {
  readonly items: readonly IntuneTemplate[];
  readonly nextCursor: string | null;
}

export async function listIntuneTemplates(
  filter?: { readonly policyType?: string; readonly cursor?: string | null; readonly limit?: number },
  baseUrl = "",
): Promise<IntuneTemplatesPage> {
  const params = new URLSearchParams();
  if (filter?.policyType) params.set("policyType", filter.policyType);
  if (filter?.cursor) params.set("cursor", filter.cursor);
  if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`${baseUrl}/v1/intune-templates${query}`);
  if (!res.ok) await throwApiError(res, "Failed to list Intune templates");
  return res.json() as Promise<IntuneTemplatesPage>;
}

export async function updateIntuneTemplate(
  id: string,
  patch: Partial<IntuneTemplateInput>,
  baseUrl = "",
): Promise<IntuneTemplate> {
  const res = await fetch(`${baseUrl}/v1/intune-templates/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) await throwApiError(res, "Failed to update Intune template");
  return res.json() as Promise<IntuneTemplate>;
}

export async function deleteIntuneTemplate(id: string, baseUrl = ""): Promise<void> {
  const res = await fetch(`${baseUrl}/v1/intune-templates/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) await throwApiError(res, "Failed to delete Intune template");
}

export type IntuneAssignmentMode =
  | "template"
  | "none"
  | "allDevices"
  | "allUsers"
  | "allUsersAndDevices"
  | "groups";

export type IntuneDeployPolicyState = "enabled" | "disabled";

export interface IntuneDeployRequest {
  readonly targets: readonly string[];
  readonly policyName?: string;
  readonly assignmentMode: IntuneAssignmentMode;
  readonly groups: readonly string[];
  readonly policyState: IntuneDeployPolicyState;
  readonly overwrite: boolean;
  readonly createGroups: boolean;
}

export interface IntuneTargetPlan {
  readonly tenantId: string;
  readonly policyName: string;
  readonly action: "create" | "update";
  readonly conflict: boolean;
  readonly conflictMessage?: string | null;
  readonly groupsToCreate: readonly string[];
  readonly assignments: readonly string[];
  readonly issues: readonly string[];
  readonly diff: readonly string[];
  readonly valid: boolean;
}

export interface IntuneDeployPreview {
  readonly templateId: string;
  readonly preview: true;
  readonly targetCount: number;
  readonly plans: readonly IntuneTargetPlan[];
  readonly allValid: boolean;
}

export interface IntuneDeployStep {
  readonly step: string;
  readonly target?: string;
  readonly status: "succeeded" | "failed";
  readonly error?: string;
}

export interface IntuneTargetResult {
  readonly tenantId: string;
  readonly state: "succeeded" | "partial" | "failed";
  readonly policyId?: string | null;
  readonly steps: readonly IntuneDeployStep[];
  readonly error?: string | null;
}

export interface IntuneDeployOutcome {
  readonly templateId: string;
  readonly targetCount: number;
  readonly success: boolean;
  readonly summary: { readonly succeeded: number; readonly partial: number; readonly failed: number };
  readonly results: readonly IntuneTargetResult[];
}

async function postDeploy(id: string, body: Record<string, unknown>, baseUrl: string): Promise<Response> {
  return fetch(`${baseUrl}/v1/intune-templates/${encodeURIComponent(id)}/deploy`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function previewIntuneTemplateDeploy(
  id: string,
  request: IntuneDeployRequest,
  baseUrl = "",
): Promise<IntuneDeployPreview> {
  const res = await postDeploy(id, { ...request, preview: true }, baseUrl);
  if (!res.ok) await throwApiError(res, "Failed to preview deploy");
  return res.json() as Promise<IntuneDeployPreview>;
}

/**
 * Apply a deploy. 207 (some targets partial/failed) and 422 (all failed) still
 * carry per-target results, so they resolve rather than throw.
 */
export async function applyIntuneTemplateDeploy(
  id: string,
  request: IntuneDeployRequest,
  baseUrl = "",
): Promise<IntuneDeployOutcome> {
  const res = await postDeploy(
    id,
    { ...request, preview: false, confirmTargetCount: request.targets.length },
    baseUrl,
  );
  if (!res.ok && res.status !== 422) await throwApiError(res, "Failed to deploy template");
  return res.json() as Promise<IntuneDeployOutcome>;
}

// ---- Deploy targets (tenants and tenant groups) ----

export interface DeployTenantOption {
  readonly id: string;
  readonly displayName: string | null;
}

export interface DeployTenantGroupOption {
  readonly id: string;
  readonly name: string;
  readonly memberTenantIds: readonly string[];
}

export async function listDeployTargets(
  baseUrl = "",
): Promise<{ tenants: DeployTenantOption[]; groups: DeployTenantGroupOption[] }> {
  const [tenantsRes, groupsRes] = await Promise.all([
    fetch(`${baseUrl}/v1/tenants`),
    fetch(`${baseUrl}/v1/tenant-groups`),
  ]);
  if (!tenantsRes.ok) await throwApiError(tenantsRes, "Failed to load tenants");
  const tenantsBody = (await tenantsRes.json()) as { items?: unknown[] } | unknown[];
  const rawTenants = (Array.isArray(tenantsBody) ? tenantsBody : tenantsBody.items ?? []) as Record<string, unknown>[];
  let rawGroups: Record<string, unknown>[] = [];
  if (groupsRes.ok) {
    const groupsBody = (await groupsRes.json()) as { items?: unknown[] } | unknown[];
    rawGroups = (Array.isArray(groupsBody) ? groupsBody : groupsBody.items ?? []) as Record<string, unknown>[];
  }
  return {
    tenants: rawTenants.map((t) => ({
      id: String(t.id),
      displayName: typeof t.displayName === "string" ? t.displayName : null,
    })),
    groups: rawGroups.map((g) => ({
      id: String(g.id),
      name: String(g.name ?? g.id),
      memberTenantIds: Array.isArray(g.memberTenantIds) ? g.memberTenantIds.map(String) : [],
    })),
  };
}

// ---- Compare page options (T-0810) ----

/** A compare target for PolicyCompareView: policy:<kind>:<id> or template:<id>. */
export interface CompareOption {
  readonly ref: string;
  readonly label: string;
}

/**
 * The right-hand choices for comparing `leftPolicyId`: the other policies of the same
 * kind, then templates of that policy type, each sorted by label. Compare is within one
 * tenant in v1, so every policy option comes from the current tenant's list.
 */
export function buildCompareOptions(
  kind: IntunePolicyKind,
  leftPolicyId: string,
  policies: readonly IntunePolicyItem[],
  templates: readonly IntuneTemplate[],
): CompareOption[] {
  const byLabel = (a: CompareOption, b: CompareOption) => a.label.localeCompare(b.label);
  const policyOptions = policies
    .filter((p) => p.id !== leftPolicyId)
    .map((p) => ({ ref: `policy:${kind}:${p.id}`, label: p.displayName || p.name }))
    .sort(byLabel);
  const templateOptions = templates
    .filter((t) => t.policyType === kind)
    .map((t) => ({ ref: `template:${t.id}`, label: t.name }))
    .sort(byLabel);
  return [...policyOptions, ...templateOptions];
}

/** Read every page of a kind's policies (the compare picker needs the whole set). */
export async function fetchAllIntunePolicies(
  tenantId: string,
  kind: IntunePolicyKind,
  baseUrl = "",
): Promise<IntunePolicyItem[]> {
  const all: IntunePolicyItem[] = [];
  let cursor: string | null = null;
  do {
    const page: IntunePoliciesPage = await fetchIntunePolicies(tenantId, kind, { cursor, limit: 100 }, baseUrl);
    all.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return all;
}

/** Read every page of Intune templates. */
export async function fetchAllIntuneTemplates(baseUrl = ""): Promise<IntuneTemplate[]> {
  const all: IntuneTemplate[] = [];
  let cursor: string | null = null;
  do {
    const page: IntuneTemplatesPage = await listIntuneTemplates({ cursor, limit: 100 }, baseUrl);
    all.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return all;
}
