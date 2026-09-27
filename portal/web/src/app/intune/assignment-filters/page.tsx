"use client";

// Assignment Filters page — EPIC-016 SPEC.md §3.3; T-0810.
// Nav: Intune → Device Management → Assignment Filters.
import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { resolveTenantId, useCurrentTenantId } from "../../../lib/useCurrentTenant";
import { AssignmentFilterTable } from "../../../components/intune/AssignmentFilterTable";
import { listDeployTargets, type DeployTenantOption } from "../../../lib/intuneApi";

export default function AssignmentFiltersPage() {
  const searchParams = useSearchParams();
  const tenantId = resolveTenantId(searchParams.get("tenantId"), useCurrentTenantId());
  const [tenants, setTenants] = useState<DeployTenantOption[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    listDeployTargets()
      .then(({ tenants: t }) => setTenants(t))
      .catch((err: unknown) =>
        setNotice(err instanceof Error ? `Deploy targets unavailable: ${err.message}` : "Deploy targets unavailable."),
      );
  }, []);

  if (!tenantId) {
    return <main style={{ padding: "24px" }}>No tenant selected.</main>;
  }

  return (
    <main style={{ padding: "24px", maxWidth: "1280px", margin: "0 auto" }}>
      {notice && (
        <div role="status" style={{ marginBottom: "16px", fontSize: "13px" }}>
          {notice}
        </div>
      )}
      <AssignmentFilterTable tenantId={tenantId} tenants={tenants} />
    </main>
  );
}
