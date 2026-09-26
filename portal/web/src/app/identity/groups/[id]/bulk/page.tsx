"use client";

// Bulk Membership Page — Identity Management -> Administration -> Groups -> [id] -> Bulk (EPIC-014 SPEC.md §3.3; T-0268).
import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { BulkMembershipWizard } from "../../../../../components/groups/BulkMembershipWizard";

export default function BulkMembershipPage(): React.ReactElement {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();

  const groupId = String(params.id || "");
  const tenantId = searchParams.get("tenantId") || "default-tenant";

  return (
    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <div style={{ fontSize: "12px", color: "var(--text-muted, #6b7280)" }}>
          Identity Management &gt; Administration &gt; Groups &gt; {groupId} &gt; Bulk Membership
        </div>
        <h1 style={{ fontSize: "24px", fontWeight: 700, margin: 0 }}>Bulk Membership Operations</h1>
      </div>

      <BulkMembershipWizard
        tenantId={tenantId}
        groupId={groupId}
        onDone={() => {
          router.push(`/identity/groups?tenantId=${encodeURIComponent(tenantId)}`);
        }}
      />
    </div>
  );
}
