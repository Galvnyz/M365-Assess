// Groups API client (EPIC-014 SPEC.md §3, §6; T-0261, T-0263).

export type GroupType = "m365" | "security" | "mailEnabledSecurity" | "distribution" | "dynamic";

export interface GroupPrincipal {
  readonly id: string;
  readonly displayName: string;
  readonly userPrincipalName?: string;
  readonly mail?: string;
}

export interface GroupItem {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly type: GroupType;
  readonly groupType: GroupType;
  readonly membershipCount: number;
  readonly ownerCount: number;
  readonly hiddenFromAddressListsEnabled: boolean;
  readonly deliveryManagementEnabled: boolean;
  readonly dynamicRule: string;
  readonly isDynamic: boolean;
  readonly mail?: string;
  readonly members?: readonly GroupPrincipal[];
  readonly owners?: readonly GroupPrincipal[];
}

export interface GroupsFilter {
  readonly type?: GroupType | "all" | "";
  readonly hidden?: boolean | string;
  readonly dynamic?: boolean | string;
  readonly membershipSize?: string;
  readonly search?: string;
  readonly cursor?: string | null;
  readonly limit?: number;
}

export interface GroupsPage {
  readonly tenantId: string;
  readonly totalCount: number;
  readonly items: readonly GroupItem[];
  readonly nextCursor: string | null;
}

export interface CreateGroupPayload {
  readonly displayName: string;
  readonly groupType: GroupType;
  readonly mailNickname?: string;
  readonly description?: string;
  readonly dynamicRule?: string;
  readonly preview?: boolean;
}

export interface EditGroupPayload {
  readonly displayName?: string;
  readonly description?: string;
  readonly dynamicRule?: string;
  readonly preview?: boolean;
}

export interface GroupPlan {
  readonly action: "create" | "edit" | "delete" | "convert";
  readonly groupId?: string;
  readonly targetName: string;
  readonly before?: Record<string, unknown> | null;
  readonly after?: Record<string, unknown> | null;
  readonly diff: readonly string[];
  readonly valid: boolean;
  readonly dryRun: boolean;
  readonly requiresConfirmation: boolean;
}

export interface GroupCrudResult {
  readonly success: boolean;
  readonly plan: GroupPlan;
  readonly result?: Record<string, unknown>;
}

export async function listGroups(tenantId: string, filter?: GroupsFilter): Promise<GroupsPage> {
  const params = new URLSearchParams();
  if (filter?.type && filter.type !== "all") params.set("type", filter.type);
  if (filter?.hidden !== undefined && filter.hidden !== "all" && filter.hidden !== "") {
    params.set("hidden", String(filter.hidden));
  }
  if (filter?.dynamic !== undefined && filter.dynamic !== "all" && filter.dynamic !== "") {
    params.set("dynamic", String(filter.dynamic));
  }
  if (filter?.membershipSize && filter.membershipSize !== "all") {
    params.set("membershipSize", filter.membershipSize);
  }
  if (filter?.search) params.set("search", filter.search);
  if (filter?.cursor) params.set("cursor", filter.cursor);
  if (filter?.limit) params.set("limit", String(filter.limit));

  const query = params.toString();
  const url = `/v1/tenants/${encodeURIComponent(tenantId)}/groups${query ? `?${query}` : ""}`;
  const response = await fetch(url);
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.message ?? `Failed to list groups: HTTP ${response.status}`);
  }
  return response.json();
}

export async function createGroup(tenantId: string, payload: CreateGroupPayload): Promise<GroupCrudResult | GroupPlan> {
  const url = `/v1/tenants/${encodeURIComponent(tenantId)}/groups`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message ?? `Failed to create group: HTTP ${response.status}`);
  }
  return response.json();
}

export async function editGroup(tenantId: string, groupId: string, payload: EditGroupPayload): Promise<GroupCrudResult | GroupPlan> {
  const url = `/v1/tenants/${encodeURIComponent(tenantId)}/groups/${encodeURIComponent(groupId)}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message ?? `Failed to edit group: HTTP ${response.status}`);
  }
  return response.json();
}

export async function deleteGroup(tenantId: string, groupId: string, confirmName: string, preview = false): Promise<GroupCrudResult | GroupPlan> {
  const url = `/v1/tenants/${encodeURIComponent(tenantId)}/groups/${encodeURIComponent(groupId)}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmName, preview }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message ?? `Failed to delete group: HTTP ${response.status}`);
  }
  return response.json();
}
