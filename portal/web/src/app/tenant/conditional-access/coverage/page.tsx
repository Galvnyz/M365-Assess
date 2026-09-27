"use client";

// Conditional Access Coverage and History Page (EPIC-015 SPEC §3.1, §4.4; T-0290).
import React, { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { RequireTenant } from "../../../../components/shell/RequireTenant";
import { resolveTenantId, useCurrentTenantId } from "../../../../lib/useCurrentTenant";
import {
  CoverageView,
  type CaCoverageSummary,
  type CoverageGap,
  type CoveredUser,
  type UncoveredUser,
  type CoveredApp,
  type UncoveredApp,
} from "../../../../components/conditionalAccess/CoverageView";
import {
  ChangeHistoryPanel,
  type CaPolicyChangeRecord,
} from "../../../../components/conditionalAccess/ChangeHistoryPanel";

function CaCoverageView({ tenantId }: { readonly tenantId: string }) {
  const [activeMainTab, setActiveMainTab] = useState<"coverage" | "history">("coverage");

  // Coverage state
  const [summary, setSummary] = useState<CaCoverageSummary | undefined>(undefined);
  const [gaps, setGaps] = useState<CoverageGap[]>([]);
  const [coveredUsers, setCoveredUsers] = useState<CoveredUser[]>([]);
  const [uncoveredUsers, setUncoveredUsers] = useState<UncoveredUser[]>([]);
  const [coveredApps, setCoveredApps] = useState<CoveredApp[]>([]);
  const [uncoveredApps, setUncoveredApps] = useState<UncoveredApp[]>([]);
  const [coverageLoading, setCoverageLoading] = useState<boolean>(true);
  const [coverageError, setCoverageError] = useState<string | null>(null);

  // History state
  const [historyItems, setHistoryItems] = useState<CaPolicyChangeRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const fetchCoverage = useCallback(async () => {
    setCoverageLoading(true);
    setCoverageError(null);
    try {
      const res = await fetch(`/v1/tenants/${encodeURIComponent(tenantId)}/ca/coverage`);
      if (!res.ok) throw new Error(`Coverage fetch failed: ${res.statusText}`);
      const data = await res.json();
      setSummary(data.summary);
      setGaps(data.gaps || []);
      setCoveredUsers(data.coveredUsers || []);
      setUncoveredUsers(data.uncoveredUsers || []);
      setCoveredApps(data.coveredApps || []);
      setUncoveredApps(data.uncoveredApps || []);
    } catch (err: any) {
      setCoverageError(err?.message || "Failed to load coverage data.");
    } finally {
      setCoverageLoading(false);
    }
  }, [tenantId]);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch(`/v1/tenants/${encodeURIComponent(tenantId)}/ca/history`);
      if (!res.ok) throw new Error(`History fetch failed: ${res.statusText}`);
      const data = await res.json();
      setHistoryItems(data.items || []);
    } catch (err: any) {
      setHistoryError(err?.message || "Failed to load history data.");
    } finally {
      setHistoryLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchCoverage();
    fetchHistory();
  }, [fetchCoverage, fetchHistory]);

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      {/* Top Navigation */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "24px", borderBottom: "1px solid var(--border, #e5e7eb)", paddingBottom: "12px" }}>
        <button
          type="button"
          onClick={() => setActiveMainTab("coverage")}
          style={{
            padding: "8px 18px",
            borderRadius: "6px",
            border: "none",
            backgroundColor: activeMainTab === "coverage" ? "var(--primary, #2563eb)" : "transparent",
            color: activeMainTab === "coverage" ? "#ffffff" : "var(--text-secondary, #4b5563)",
            fontWeight: 600,
            cursor: "pointer",
            fontSize: "14px",
          }}
          data-testid="main-tab-coverage"
        >
          Coverage & Gaps
        </button>
        <button
          type="button"
          onClick={() => setActiveMainTab("history")}
          style={{
            padding: "8px 18px",
            borderRadius: "6px",
            border: "none",
            backgroundColor: activeMainTab === "history" ? "var(--primary, #2563eb)" : "transparent",
            color: activeMainTab === "history" ? "#ffffff" : "var(--text-secondary, #4b5563)",
            fontWeight: 600,
            cursor: "pointer",
            fontSize: "14px",
          }}
          data-testid="main-tab-history"
        >
          Change History
        </button>
      </div>

      {activeMainTab === "coverage" ? (
        <CoverageView
          summary={summary}
          gaps={gaps}
          coveredUsers={coveredUsers}
          uncoveredUsers={uncoveredUsers}
          coveredApps={coveredApps}
          uncoveredApps={uncoveredApps}
          loading={coverageLoading}
          error={coverageError}
          onRefresh={fetchCoverage}
        />
      ) : (
        <ChangeHistoryPanel
          items={historyItems}
          loading={historyLoading}
          error={historyError}
          onRefresh={fetchHistory}
        />
      )}
    </div>
  );
}

export default function CaCoveragePage() {
  const searchParams = useSearchParams();
  const tenantId = resolveTenantId(searchParams.get("tenantId"), useCurrentTenantId());
  return (
    <RequireTenant tenantId={tenantId}>
      <CaCoverageView tenantId={tenantId} />
    </RequireTenant>
  );
}
