// Typed Roles & PIM API client (EPIC-013 SPEC.md §3.1, §3.2, §6; T-0248).
// Typed wrappers for /v1/tenants/:tenantId/role-assignments, /v1/tenants/:tenantId/pim,
// and /v1/pim-settings-templates.

export type RoleAssignmentType = "permanent" | "eligible" | "active";
export type RolePrincipalType = "user" | "group" | "servicePrincipal";

export interface RoleAssignment {
  readonly id: string;
  readonly roleDefinitionId: string;
  readonly roleName: string;
  readonly principalId: string;
  readonly principalDisplayName: string | null;
  readonly principalEmail: string | null;
  readonly principalType: RolePrincipalType;
  readonly assignmentType: RoleAssignmentType;
  readonly directoryScopeId: string;
  readonly scope: string;
  readonly startDateTime: string | null;
  readonly endDateTime: string | null;
  readonly status: string;
}

export interface RoleAssignmentsFilter {
  readonly role?: string;
  readonly principalType?: RolePrincipalType;
  readonly assignmentType?: RoleAssignmentType;
  readonly scope?: string;
  readonly search?: string;
  readonly cursor?: string | null;
  readonly limit?: number;
}

export interface RoleAssignmentsPage {
  readonly tenantId: string;
  readonly totalCount: number;
  readonly items: readonly RoleAssignment[];
  readonly nextCursor: string | null;
}

export interface PimLicenseGateResult {
  readonly supported: boolean;
  readonly status: "licensed" | "license-missing";
  readonly requiredLicense: string;
  readonly message: string | null;
  readonly documentationUrl?: string;
}

export interface PimAssignment {
  readonly id: string;
  readonly roleDefinitionId: string;
  readonly roleName: string;
  readonly principalId: string;
  readonly principalDisplayName: string | null;
  readonly principalEmail: string | null;
  readonly principalType: RolePrincipalType;
  readonly assignmentType: "eligible" | "active";
  readonly directoryScopeId: string;
  readonly scope: string;
  readonly startDateTime: string | null;
  readonly endDateTime: string | null;
  readonly status: string;
  readonly memberType?: string;
}

export interface PimAssignmentsFilter {
  readonly role?: string;
  readonly principalType?: RolePrincipalType;
  readonly assignmentType?: "eligible" | "active";
  readonly scope?: string;
  readonly search?: string;
  readonly cursor?: string | null;
  readonly limit?: number;
}

export interface PimAssignmentsPage {
  readonly tenantId: string;
  readonly gate: PimLicenseGateResult;
  readonly totalCount: number;
  readonly items: readonly PimAssignment[];
  readonly nextCursor: string | null;
}

export interface PimRoleSettings {
  readonly maximumDurationInHours?: number;
  readonly requireMfa?: boolean;
  readonly requireJustification?: boolean;
  readonly requireApproval?: boolean;
  readonly approverIds?: readonly string[];
  readonly [key: string]: unknown;
}

export interface PimRoleSettingsTemplate {
  readonly id: string;
  readonly name: string;
  readonly roleId: string | null;
  readonly settings: PimRoleSettings;
  readonly scope: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt?: string | null;
}

export interface SettingDiff {
  readonly setting: string;
  readonly current: unknown;
  readonly template: unknown;
  readonly matches: boolean;
}

export interface PimCompareResult {
  readonly templateId: string;
  readonly tenantId: string;
  readonly roleId: string;
  readonly diffs: readonly SettingDiff[];
  readonly hasDifferences: boolean;
}

export interface PimApplyResult {
  readonly templateId: string;
  readonly tenantId: string;
  readonly roleId: string;
  readonly dryRun: boolean;
  readonly current: PimRoleSettings;
  readonly proposed: PimRoleSettings;
  readonly diffs: readonly SettingDiff[];
  readonly applied: PimRoleSettings | null;
}

function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const query = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null && val !== "") {
      query.set(key, String(val));
    }
  }
  const qStr = query.toString();
  return qStr.length > 0 ? `?${qStr}` : "";
}

export async function fetchRoleAssignments(
  tenantId: string,
  filter?: RoleAssignmentsFilter,
): Promise<RoleAssignmentsPage> {
  const qs = buildQuery({
    role: filter?.role,
    principalType: filter?.principalType,
    assignmentType: filter?.assignmentType,
    scope: filter?.scope,
    search: filter?.search,
    cursor: filter?.cursor ?? undefined,
    limit: filter?.limit ?? undefined,
  });

  const res = await fetch(`/v1/tenants/${encodeURIComponent(tenantId)}/role-assignments${qs}`);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to load role assignments (${res.status}): ${errorText}`);
  }
  return res.json() as Promise<RoleAssignmentsPage>;
}

export async function fetchPimAssignments(
  tenantId: string,
  filter?: PimAssignmentsFilter,
): Promise<PimAssignmentsPage> {
  const qs = buildQuery({
    role: filter?.role,
    principalType: filter?.principalType,
    assignmentType: filter?.assignmentType,
    scope: filter?.scope,
    search: filter?.search,
    cursor: filter?.cursor ?? undefined,
    limit: filter?.limit ?? undefined,
  });

  const res = await fetch(`/v1/tenants/${encodeURIComponent(tenantId)}/pim${qs}`);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to load PIM assignments (${res.status}): ${errorText}`);
  }
  return res.json() as Promise<PimAssignmentsPage>;
}

export async function fetchPimSettingsTemplates(): Promise<{ items: PimRoleSettingsTemplate[] }> {
  const res = await fetch("/v1/pim-settings-templates");
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to load PIM templates (${res.status}): ${errorText}`);
  }
  return res.json() as Promise<{ items: PimRoleSettingsTemplate[] }>;
}

export async function createPimSettingsTemplate(input: {
  id?: string;
  name: string;
  roleId?: string | null;
  settings?: PimRoleSettings;
  scope?: string;
}): Promise<PimRoleSettingsTemplate> {
  const res = await fetch("/v1/pim-settings-templates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to create PIM template (${res.status}): ${errorText}`);
  }
  return res.json() as Promise<PimRoleSettingsTemplate>;
}

export async function updatePimSettingsTemplate(
  id: string,
  input: {
    name?: string;
    roleId?: string | null;
    settings?: PimRoleSettings;
    scope?: string;
  },
): Promise<PimRoleSettingsTemplate> {
  const res = await fetch(`/v1/pim-settings-templates/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to update PIM template (${res.status}): ${errorText}`);
  }
  return res.json() as Promise<PimRoleSettingsTemplate>;
}

export async function deletePimSettingsTemplate(id: string): Promise<void> {
  const res = await fetch(`/v1/pim-settings-templates/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to delete PIM template (${res.status}): ${errorText}`);
  }
}

export async function comparePimSettingsTemplate(
  templateId: string,
  tenantId: string,
  roleId?: string,
): Promise<PimCompareResult> {
  const res = await fetch(`/v1/pim-settings-templates/${encodeURIComponent(templateId)}/compare`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId, roleId }),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to compare PIM template (${res.status}): ${errorText}`);
  }
  return res.json() as Promise<PimCompareResult>;
}

export async function applyPimSettingsTemplate(
  templateId: string,
  input: {
    tenantId: string;
    roleId?: string;
    preview?: boolean;
    confirm?: boolean;
    reason?: string;
  },
): Promise<PimApplyResult> {
  const res = await fetch(`/v1/pim-settings-templates/${encodeURIComponent(templateId)}/apply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to apply PIM template (${res.status}): ${errorText}`);
  }
  return res.json() as Promise<PimApplyResult>;
}
