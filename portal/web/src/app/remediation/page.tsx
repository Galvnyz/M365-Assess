"use client";

// Remediation plan page (EPIC-006 SPEC.md §3.2, T-0112).
// Nav: Tenant Administration → Remediation. Title "Remediation Plan — <tenant>".
// Primary Generate plan (POST /v1/remediation/plans); secondary Export (JSON/MD/
// CSV) rendered client-side. The plan table (T-0112) renders KPIs, columns,
// filters, and row actions. Zero colour literals: report theme tokens only.

import React, { useCallback, useEffect, useState, type CSSProperties, type ReactElement } from "react";
import { RemediationPlanTable } from "../../components/remediation/RemediationPlanTable";
import {
  EXPORT_FORMATS,
  downloadPlan,
  fetchRemediationPlan,
  generateRemediationPlan,
  waitForRemediationPlan,
  type ExportFormat,
  type RemediationPlanResponse,
} from "../../lib/remediationApi";

const pageStyle: CSSProperties = {
  padding: "32px",
  maxWidth: "1400px",
  margin: "0 auto",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
  display: "flex",
  flexDirection: "column",
  gap: "24px",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "16px",
  borderBottom: "1px solid var(--border)",
  paddingBottom: "16px",
  flexWrap: "wrap",
};

const titleStyle: CSSProperties = {
  fontSize: "24px",
  fontWeight: 700,
  margin: 0,
  fontFamily: "var(--font-display, var(--font-sans))",
};

const buttonStyle: CSSProperties = {
  padding: "10px 18px",
  background: "var(--surface)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  fontWeight: 600,
  fontSize: "14px",
  cursor: "pointer",
};

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "var(--accent)",
  color: "var(--on-accent)",
  borderColor: "var(--accent)",
};

const toolbarStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  alignItems: "center",
  flexWrap: "wrap",
};

export interface RemediationPageProps {
  readonly tenantId?: string;
  readonly planId?: string;
  /** True when the caller holds `remediation.apply`. */
  readonly canApply?: boolean;
  readonly fetcher?: typeof fetch;
}

export default function RemediationPage({
  tenantId = "",
  planId = "",
  canApply = false,
  fetcher,
}: RemediationPageProps): ReactElement {
  const [plan, setPlan] = useState<RemediationPlanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (id: string): Promise<void> => {
      if (!id) return;
      setLoading(true);
      setError(null);
      try {
        setPlan(await fetchRemediationPlan(id, fetcher));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [fetcher],
  );

  useEffect(() => {
    void load(planId);
  }, [planId, load]);

  const handleGenerate = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await generateRemediationPlan({ tenantId }, fetcher);
      setPlan(await waitForRemediationPlan(result.planId, fetcher));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleExport = (format: ExportFormat): void => {
    if (plan) downloadPlan(plan, format);
  };

  return (
    <div style={pageStyle} data-testid="remediation-page">
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>Remediation Plan — {tenantId || "all tenants"}</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-soft)", fontSize: "14px" }}>
            Review gated remediation actions, apply automated fixes, and follow manual
            instructions. Applying requires <code>remediation.apply</code>.
          </p>
        </div>

        <div style={toolbarStyle}>
          <div style={{ display: "flex", gap: "4px" }} data-testid="export-toolbar">
            {EXPORT_FORMATS.map((format) => (
              <button
                key={format}
                type="button"
                style={buttonStyle}
                disabled={!plan}
                onClick={() => handleExport(format)}
                data-testid={`export-${format}`}
              >
                Export {format.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            type="button"
            style={primaryButtonStyle}
            disabled={busy || !tenantId}
            onClick={handleGenerate}
            data-testid="generate-plan-button"
          >
            {busy ? "Generating…" : "Generate plan"}
          </button>
        </div>
      </div>

      <RemediationPlanTable
        plan={plan}
        loading={loading}
        error={error}
        canApply={canApply}
      />
    </div>
  );
}
