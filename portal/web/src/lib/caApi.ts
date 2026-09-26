// caApi.ts — Client API helpers for Conditional Access (EPIC-015 SPEC.md §3.1, §4.1, §6; T-0281, T-0282, T-0283).

export type CaPolicyState = "enabled" | "disabled" | "enabledForReportingButNotEnforced";

export interface CaPolicyUsersTargeted {
  readonly includeUsers?: readonly string[];
  readonly excludeUsers?: readonly string[];
  readonly includeGroups?: readonly string[];
  readonly excludeGroups?: readonly string[];
  readonly includeRoles?: readonly string[];
  readonly excludeRoles?: readonly string[];
  readonly summary?: string;
}

export interface CaPolicyAppsTargeted {
  readonly includeApplications?: readonly string[];
  readonly excludeApplications?: readonly string[];
  readonly summary?: string;
}

export interface CaPolicyGrantControls {
  readonly operator?: string;
  readonly builtInControls?: readonly string[];
  readonly authenticationStrength?: unknown;
  readonly summary?: string;
}

export interface CaPolicyConditions {
  readonly clientAppTypes?: readonly string[];
  readonly platforms?: Record<string, unknown>;
  readonly locations?: Record<string, unknown>;
  readonly signInRiskLevels?: readonly string[];
  readonly userRiskLevels?: readonly string[];
  readonly devices?: Record<string, unknown>;
  readonly summary?: string;
}

export interface CaPolicyItem {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly state: CaPolicyState | string;
  readonly usersTargeted: CaPolicyUsersTargeted;
  readonly apps: CaPolicyAppsTargeted;
  readonly grantControls: CaPolicyGrantControls;
  readonly sessionControls?: Record<string, unknown>;
  readonly conditions: CaPolicyConditions;
  readonly createdDateTime?: string | null;
  readonly modifiedDateTime?: string | null;
  readonly modifiedBy?: string | null;
}

export interface CaPoliciesFilter {
  readonly state?: string;
  readonly target?: string;
  readonly control?: string;
  readonly condition?: string;
  readonly modifiedDate?: string;
  readonly search?: string;
  readonly cursor?: string | null;
  readonly limit?: number;
}

export interface CaPoliciesPage {
  readonly tenantId: string;
  readonly totalCount: number;
  readonly items: readonly CaPolicyItem[];
  readonly nextCursor: string | null;
}

export interface CaPlan {
  readonly action: "create" | "edit" | "delete";
  readonly policyId?: string;
  readonly targetName: string;
  readonly before?: Record<string, unknown> | null;
  readonly after?: Record<string, unknown> | null;
  readonly diff: readonly string[];
  readonly valid: boolean;
  readonly warnings?: readonly unknown[];
  readonly dryRun: boolean;
  readonly requiresConfirmation: boolean;
}

export interface CaCrudResult {
  readonly success: boolean;
  readonly plan: CaPlan;
  readonly result?: Record<string, unknown>;
  readonly auditEvent?: Record<string, unknown>;
}

export interface CaPolicyCreateInput {
  readonly displayName: string;
  readonly state?: CaPolicyState | string;
  readonly conditions?: Record<string, unknown>;
  readonly grantControls?: Record<string, unknown>;
  readonly sessionControls?: Record<string, unknown>;
  readonly preview?: boolean;
}

export interface CaPolicyEditInput {
  readonly displayName?: string;
  readonly state?: CaPolicyState | string;
  readonly conditions?: Record<string, unknown>;
  readonly grantControls?: Record<string, unknown>;
  readonly sessionControls?: Record<string, unknown>;
  readonly preview?: boolean;
}

export async function listCaPolicies(
  tenantId: string,
  filter?: CaPoliciesFilter,
  baseUrl = "",
): Promise<CaPoliciesPage> {
  const params = new URLSearchParams();
  if (filter?.state) params.set("state", filter.state);
  if (filter?.target) params.set("target", filter.target);
  if (filter?.control) params.set("control", filter.control);
  if (filter?.condition) params.set("condition", filter.condition);
  if (filter?.modifiedDate) params.set("modifiedDate", filter.modifiedDate);
  if (filter?.search) params.set("search", filter.search);
  if (filter?.cursor) params.set("cursor", filter.cursor);
  if (filter?.limit) params.set("limit", String(filter.limit));

  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/ca/policies${query}`);
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.message || `Failed to list CA policies: HTTP ${res.status}`);
  }
  return res.json();
}

export async function createCaPolicy(
  tenantId: string,
  input: CaPolicyCreateInput,
  preview = false,
  baseUrl = "",
): Promise<CaCrudResult | CaPlan> {
  const res = await fetch(`${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/ca/policies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, preview }),
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.message || `Failed to create CA policy: HTTP ${res.status}`);
  }
  return res.json();
}

export async function editCaPolicy(
  tenantId: string,
  policyId: string,
  input: CaPolicyEditInput,
  preview = false,
  baseUrl = "",
): Promise<CaCrudResult | CaPlan> {
  const res = await fetch(
    `${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/ca/policies/${encodeURIComponent(policyId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, preview }),
    },
  );
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.message || `Failed to update CA policy: HTTP ${res.status}`);
  }
  return res.json();
}

export async function deleteCaPolicy(
  tenantId: string,
  policyId: string,
  confirmName: string,
  preview = false,
  baseUrl = "",
): Promise<CaCrudResult | CaPlan> {
  const res = await fetch(
    `${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/ca/policies/${encodeURIComponent(policyId)}`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName, preview }),
    },
  );
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.message || `Failed to delete CA policy: HTTP ${res.status}`);
  }
  return res.json();
}

export interface CaTemplate {
  id: string;
  name: string;
  policyJson: Record<string, unknown>;
  source: "local";
  category: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface CaDeployDrawerOptions {
  readonly tenantId: string;
  readonly policyName?: string;
  readonly policyState?: string;
  readonly groupUserHandling?: "all" | "assigned" | "custom" | string;
  readonly createGroups?: boolean;
  readonly overwrite?: boolean;
  readonly disableSecurityDefaults?: boolean;
  readonly breakGlassExclusions?: readonly string[];
  readonly preview?: boolean;
}

export interface CaDeployPlan {
  readonly action: "create" | "update";
  readonly tenantId: string;
  readonly templateId: string;
  readonly policyName: string;
  readonly policyState: string;
  readonly disableSecurityDefaults: boolean;
  readonly overwrite: boolean;
  readonly conflict: boolean;
  readonly conflictMessage?: string | null;
  readonly diff: readonly string[];
  readonly groupsToCreate: readonly string[];
  readonly valid: boolean;
  readonly dryRun: boolean;
}

export interface CaDeployResult {
  readonly success: boolean;
  readonly plan: CaDeployPlan;
  readonly result?: Record<string, unknown>;
  readonly auditEvent?: Record<string, unknown>;
}

export async function listCaTemplates(baseUrl = ""): Promise<CaTemplate[]> {
  const res = await fetch(`${baseUrl}/v1/ca-templates`);
  if (!res.ok) {
    throw new Error(`Failed to list CA templates: HTTP ${res.status}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : data.items || [];
}

export async function getCaTemplate(id: string, baseUrl = ""): Promise<CaTemplate> {
  const res = await fetch(`${baseUrl}/v1/ca-templates/${encodeURIComponent(id)}`);
  if (!res.ok) {
    throw new Error(`Failed to get CA template: HTTP ${res.status}`);
  }
  return res.json();
}

export async function createCaTemplate(input: Partial<CaTemplate>, baseUrl = ""): Promise<CaTemplate> {
  const res = await fetch(`${baseUrl}/v1/ca-templates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`Failed to create CA template: HTTP ${res.status}`);
  }
  return res.json();
}

export async function updateCaTemplate(id: string, input: Partial<CaTemplate>, baseUrl = ""): Promise<CaTemplate> {
  const res = await fetch(`${baseUrl}/v1/ca-templates/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`Failed to update CA template: HTTP ${res.status}`);
  }
  return res.json();
}

export async function deleteCaTemplate(id: string, baseUrl = ""): Promise<boolean> {
  const res = await fetch(`${baseUrl}/v1/ca-templates/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return res.ok;
}

export async function deployCaTemplate(
  id: string,
  options: CaDeployDrawerOptions,
  baseUrl = "",
): Promise<CaDeployPlan | CaDeployResult> {
  const res = await fetch(`${baseUrl}/v1/ca-templates/${encodeURIComponent(id)}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.message || `Failed to deploy CA template: HTTP ${res.status}`);
  }
  return res.json();
}
