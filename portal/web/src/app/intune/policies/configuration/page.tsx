"use client";

// Configuration Policies page — EPIC-016 SPEC.md §3.1; T-0303.
// Nav: Intune → Device Management → Configuration Policies.
import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RequireTenant } from "../../../../components/shell/RequireTenant";
import { resolveTenantId, useCurrentTenantId } from "../../../../lib/useCurrentTenant";
import { IntunePolicyListPage } from "../../../../components/intune/IntunePolicyTable";

export default function Page() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tenantId = resolveTenantId(searchParams.get("tenantId"), useCurrentTenantId());
  return (
    <RequireTenant tenantId={tenantId}>
      <IntunePolicyListPage kind="configuration" tenantId={tenantId} navigate={(href) => router.push(href)} />
    </RequireTenant>
  );
}
