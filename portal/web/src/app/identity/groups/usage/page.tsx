"use client";

// Group Usage Report Page — Identity Management -> Administration -> Groups -> Usage (EPIC-014 SPEC.md §3.5; T-0270).
import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RequireTenant } from "../../../../components/shell/RequireTenant";
import { resolveTenantId, useCurrentTenantId } from "../../../../lib/useCurrentTenant";
import {
  GroupUsageReport,
  type GroupUsageReportData,
} from "../../../../components/groups/GroupUsageReport";

function GroupUsageView({ tenantId }: { readonly tenantId: string }): React.ReactElement {
  const [report, setReport] = useState<GroupUsageReportData | null>(null);
  const [threshold, setThreshold] = useState<number>(90);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsage = async () => {
    try {
      setLoading(true);
      setError(null);
      const url = `/v1/tenants/${encodeURIComponent(tenantId)}/groups/usage?inactiveDaysThreshold=${threshold}`;
      const res = await fetch(url);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || `Failed to fetch usage report: HTTP ${res.status}`);
      }
      const data = await res.json();
      setReport(data);
    } catch (err: any) {
      setError(err.message || "Failed to load usage report");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsage();
  }, [tenantId, threshold]);

  return (
    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <div style={{ fontSize: "12px", color: "var(--text-muted, #6b7280)" }}>
          <a href={`/identity/groups?tenantId=${encodeURIComponent(tenantId)}`} style={{ color: "inherit", textDecoration: "none" }}>
            Identity Management &gt; Administration &gt; Groups
          </a>{" "}
          &gt; Usage Report
        </div>
        <h1 style={{ fontSize: "24px", fontWeight: 700, margin: 0 }}>Group Usage Report</h1>
      </div>

      <GroupUsageReport
        report={report}
        loading={loading}
        error={error}
        inactiveDaysThreshold={threshold}
        onThresholdChange={setThreshold}
        onRefresh={fetchUsage}
      />
    </div>
  );
}

export default function GroupUsagePage(): React.ReactElement {
  const searchParams = useSearchParams();
  const tenantId = resolveTenantId(searchParams.get("tenantId"), useCurrentTenantId());
  return (
    <RequireTenant tenantId={tenantId}>
      <GroupUsageView tenantId={tenantId} />
    </RequireTenant>
  );
}
