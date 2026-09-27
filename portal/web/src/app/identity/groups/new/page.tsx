"use client";

// Create Group Page — Identity Management -> Administration -> Groups -> New (EPIC-014 SPEC.md §4.1; T-0264).
import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RequireTenant } from "../../../../components/shell/RequireTenant";
import { resolveTenantId, useCurrentTenantId } from "../../../../lib/useCurrentTenant";
import { GroupForm } from "../../../../components/groups/GroupForm";

function NewGroupView({ tenantId }: { readonly tenantId: string }): React.ReactElement {
  const router = useRouter();

  return (
    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <div style={{ fontSize: "12px", color: "var(--text-muted, #6b7280)" }}>
          Identity Management &gt; Administration &gt; Groups &gt; New
        </div>
        <h1 style={{ fontSize: "24px", fontWeight: 700, margin: 0 }}>Add Group</h1>
      </div>

      <GroupForm
        tenantId={tenantId}
        mode="create"
        onSuccess={() => {
          router.push(`/identity/groups?tenantId=${encodeURIComponent(tenantId)}`);
        }}
        onCancel={() => {
          router.push(`/identity/groups?tenantId=${encodeURIComponent(tenantId)}`);
        }}
      />
    </div>
  );
}

export default function NewGroupPage(): React.ReactElement {
  const searchParams = useSearchParams();
  const tenantId = resolveTenantId(searchParams.get("tenantId"), useCurrentTenantId());
  return (
    <RequireTenant tenantId={tenantId}>
      <NewGroupView tenantId={tenantId} />
    </RequireTenant>
  );
}
