"use client";

// Conditional Access Report-Only Evaluation Page (EPIC-015 SPEC §3.5; T-0289).
import React, { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  ReportOnlyPanel,
  type CaReportOnlyPolicyResult,
  type CaReportOnlySummary,
} from "../../../../components/conditionalAccess/ReportOnlyPanel";

export default function CaReportOnlyPage() {
  const searchParams = useSearchParams();
  const tenantId = searchParams.get("tenantId") || "default-tenant";

  const [policies, setPolicies] = useState<CaReportOnlyPolicyResult[]>([]);
  const [summary, setSummary] = useState<CaReportOnlySummary | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReportOnlyData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/v1/tenants/${encodeURIComponent(tenantId)}/ca/report-only`);
      if (!res.ok) {
        throw new Error(`Failed to load report-only evaluations: ${res.statusText}`);
      }
      const data = await res.json();
      setPolicies(data.reportOnlyPolicies || []);
      setSummary(data.summary);
    } catch (err: any) {
      setError(err?.message || "Failed to load report-only evaluation data.");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchReportOnlyData();
  }, [fetchReportOnlyData]);

  return (
    <div style={{ padding: "24px" }}>
      <ReportOnlyPanel
        policies={policies}
        summary={summary}
        tenantId={tenantId}
        loading={loading}
        error={error}
        onRefresh={fetchReportOnlyData}
      />
    </div>
  );
}
