// Typed JIT admin & Schedule Request API client (EPIC-013 SPEC §3.3, §3.4; T-0249).
// Pure typed wrappers for /v1/tenants/:tenantId/jit-grants, /v1/jit-grants/:id/*,
// /v1/jit-templates, and /v1/tenants/:tenantId/pim/requests.

export type JitGrantState = "active" | "revoked" | "expired" | "extended";
export type JitAssignmentType = "eligible" | "active";

export interface JitGrant {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly roleId: string;
  readonly templateId?: string | null;
  readonly assignmentType: JitAssignmentType;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly durationHours: number;
  readonly maxDurationHours: number;
  readonly state: JitGrantState;
  readonly justification?: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revokedAt?: string | null;
  readonly revokedBy?: string | null;
}

export interface JitAdminTemplate {
  readonly id: string;
  readonly name: string;
  readonly description?: string | null;
  readonly allowedRoles: readonly string[];
  readonly duration: number;
  readonly maxDuration: number;
  readonly justificationRequired: boolean;
  readonly approvalRequired: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt?: string | null;
}

export type RoleChangeRequestState =
  | "pending"
  | "approved"
  | "rejected"
  | "active"
  | "completed"
  | "cancelled";

export interface RoleChangeRequest {
  readonly id: string;
  readonly tenantId: string;
  readonly principalId: string;
  readonly roleId: string;
  readonly action: string;
  readonly state: RoleChangeRequestState;
  readonly justification: string;
  readonly durationHours: number;
  readonly ticketNumber?: string | null;
  readonly approverId?: string | null;
  readonly rejectionReason?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startsAt?: string | null;
  readonly endsAt?: string | null;
}

export async function fetchJitGrants(
  tenantId: string,
  filter?: { userId?: string; state?: JitGrantState },
): Promise<{ tenantId: string; items: JitGrant[] }> {
  const query = new URLSearchParams();
  if (filter?.userId) query.set("userId", filter.userId);
  if (filter?.state) query.set("state", filter.state);
  const qStr = query.toString();
  const url = `/v1/tenants/${encodeURIComponent(tenantId)}/jit-grants${qStr ? `?${qStr}` : ""}`;

  const res = await fetch(url);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to load JIT grants (${res.status}): ${errorText}`);
  }
  return res.json() as Promise<{ tenantId: string; items: JitGrant[] }>;
}

export async function createJitGrant(
  tenantId: string,
  input: {
    userId: string;
    roleId: string;
    templateId?: string;
    assignmentType?: JitAssignmentType;
    durationHours?: number;
    maxDurationHours?: number;
    justification?: string;
  },
): Promise<JitGrant> {
  const res = await fetch(`/v1/tenants/${encodeURIComponent(tenantId)}/jit-grants`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to create JIT grant (${res.status}): ${errorText}`);
  }
  return res.json() as Promise<JitGrant>;
}

export async function revokeJitGrant(grantId: string): Promise<JitGrant> {
  const res = await fetch(`/v1/jit-grants/${encodeURIComponent(grantId)}/revoke`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to revoke JIT grant (${res.status}): ${errorText}`);
  }
  return res.json() as Promise<JitGrant>;
}

export async function extendJitGrant(
  grantId: string,
  additionalHours: number,
): Promise<JitGrant> {
  const res = await fetch(`/v1/jit-grants/${encodeURIComponent(grantId)}/extend`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ additionalHours }),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to extend JIT grant (${res.status}): ${errorText}`);
  }
  return res.json() as Promise<JitGrant>;
}

export async function fetchJitTemplates(): Promise<{ items: JitAdminTemplate[] }> {
  const res = await fetch("/v1/jit-templates");
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to load JIT templates (${res.status}): ${errorText}`);
  }
  return res.json() as Promise<{ items: JitAdminTemplate[] }>;
}

export async function createJitTemplate(input: {
  id?: string;
  name: string;
  description?: string | null;
  allowedRoles: readonly string[];
  duration?: number;
  maxDuration?: number;
  justificationRequired?: boolean;
  approvalRequired?: boolean;
}): Promise<JitAdminTemplate> {
  const res = await fetch("/v1/jit-templates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to create JIT template (${res.status}): ${errorText}`);
  }
  return res.json() as Promise<JitAdminTemplate>;
}

export async function updateJitTemplate(
  id: string,
  input: Partial<JitAdminTemplate>,
): Promise<JitAdminTemplate> {
  const res = await fetch(`/v1/jit-templates/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to update JIT template (${res.status}): ${errorText}`);
  }
  return res.json() as Promise<JitAdminTemplate>;
}

export async function deleteJitTemplate(id: string): Promise<void> {
  const res = await fetch(`/v1/jit-templates/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to delete JIT template (${res.status}): ${errorText}`);
  }
}

export async function submitPimScheduleRequest(
  tenantId: string,
  input: {
    principalId: string;
    roleId: string;
    action?: string;
    justification: string;
    durationHours?: number;
    approvalRequired?: boolean;
    ticketNumber?: string;
  },
): Promise<RoleChangeRequest> {
  const res = await fetch(`/v1/tenants/${encodeURIComponent(tenantId)}/pim/requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to submit PIM request (${res.status}): ${errorText}`);
  }
  return res.json() as Promise<RoleChangeRequest>;
}
