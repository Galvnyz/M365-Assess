"use client";

// Manage Drift page (EPIC-009 SPEC.md §3.1; T-0168).
// Breakdown, filters, table, and row drawer render from the T-0164 API;
// triage dialogs call the T-0165/T-0166 accept/override/deny endpoints and
// bulk actions submit through the T-0167 endpoint. Primary buttons: Refresh
// data, Generate report (T-0170 surface), Edit template (standards builder),
// Run standard now (T-0150 endpoint when a template id is provided). The Move
// to next stage dialog belongs to EPIC-010 and is intentionally absent.
// Zero colour literals: report theme tokens only.

import React, { useCallback, useEffect, useState, type CSSProperties, type ReactElement } from "react";
import { DriftTable, type DriftRowAction } from "../../components/drift/DriftTable";
import {
  AcceptDeviationDialog,
  BulkTriageDialog,
  DenyDeviationDialog,
  OverrideDeviationDialog,
} from "../../components/drift/DriftDialogs";
import {
  acceptDeviation,
  bulkTriageDrift,
  denyDeviation,
  fetchDrift,
  overrideDeviation,
  refreshDrift,
  type AcceptDeviationInput,
  type BulkTriageInput,
  type DenyDeviationInput,
  type DriftBreakdown,
  type DriftBulkAction,
  type DriftDeviation,
  type OverrideDeviationInput,
} from "../../lib/driftApi";
import { runStandardTemplateNow } from "../../lib/standardsApi";
import { useCurrentTenantId } from "../../lib/useCurrentTenant";

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

const controlsStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
  alignItems: "center",
};

const inputStyle: CSSProperties = {
  padding: "8px 12px",
  background: "var(--input-bg, var(--bg))",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "14px",
};

const buttonStyle: CSSProperties = {
  padding: "8px 14px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "14px",
  fontWeight: 500,
  cursor: "pointer",
};

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "var(--accent)",
  color: "var(--accent-text)",
  borderColor: "var(--accent)",
};

const noticeStyle: CSSProperties = {
  padding: "10px 14px",
  background: "var(--accent-soft)",
  border: "1px solid var(--accent)",
  borderRadius: "6px",
  color: "var(--accent-text)",
  fontSize: "13px",
};

export interface DriftPageProps {
  readonly fetcher?: typeof fetch;
  /** Tenant whose drift is managed; editable in the tenant box when empty. */
  readonly tenantId?: string;
  /** Standards/drift template id used by Run standard now. */
  readonly templateId?: string;
}

type DialogState =
  | { readonly kind: "accept" | "override" | "deny"; readonly deviation: DriftDeviation }
  | { readonly kind: "bulk"; readonly action: DriftBulkAction; readonly ids: string[] }
  | { readonly kind: "none" };

export default function DriftPage({ fetcher, tenantId = "", templateId = "" }: DriftPageProps): ReactElement {
  const doFetch = fetcher ?? fetch;
  const [tenant, setTenant] = useState(tenantId);
  // Follow the tenant chosen in the shell; the box still accepts another id.
  const currentTenant = useCurrentTenantId();
  useEffect(() => {
    if (currentTenant) {
      setTenant(currentTenant);
      void load(currentTenant);
    }
  }, [currentTenant]);
  const [deviations, setDeviations] = useState<readonly DriftDeviation[]>([]);
  const [breakdown, setBreakdown] = useState<DriftBreakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });

  const load = useCallback(
    async (tenantOverride?: string): Promise<void> => {
      const target = (tenantOverride ?? tenant).trim();
      if (!target) {
        setDeviations([]);
        setBreakdown(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const response = await fetchDrift(target, {}, doFetch);
        setDeviations(response.items);
        setBreakdown(response.breakdown);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setDeviations([]);
        setBreakdown(null);
      } finally {
        setLoading(false);
      }
    },
    [doFetch, tenant],
  );

  useEffect(() => {
    if (tenantId.trim()) {
      void load(tenantId);
    }
  }, [tenantId, load]);

  const requireTenant = (): string | null => {
    if (!tenant.trim()) {
      setNotice("Enter a tenant id before managing drift.");
      return null;
    }
    return tenant.trim();
  };

  const handleRefresh = async (): Promise<void> => {
    const target = requireTenant();
    if (!target) return;
    try {
      await refreshDrift(target, doFetch);
      setNotice("Drift recomputed; triage state preserved.");
      await load(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleGenerateReport = (): void => {
    const target = requireTenant();
    if (!target) return;
    window.location.href = `/drift/report?tenant=${encodeURIComponent(target)}`;
  };

  const handleEditTemplate = (): void => {
    window.location.href = "/standards";
  };

  const handleRunStandardNow = async (): Promise<void> => {
    const target = requireTenant();
    if (!target) return;
    if (!templateId.trim()) {
      setNotice("Run standard now needs a template id; open this page with a template selected.");
      return;
    }
    try {
      await runStandardTemplateNow(templateId.trim(), target, doFetch);
      setNotice("Standard run enqueued.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const openRowDialog = (action: DriftRowAction, deviation: DriftDeviation): void => {
    setDialog({ kind: action, deviation });
  };

  const submitAccept = async (deviation: DriftDeviation, input: AcceptDeviationInput): Promise<void> => {
    try {
      await acceptDeviation(deviation.id, input, doFetch);
      setDialog({ kind: "none" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const submitOverride = async (deviation: DriftDeviation, input: OverrideDeviationInput): Promise<void> => {
    try {
      await overrideDeviation(deviation.id, input, doFetch);
      setDialog({ kind: "none" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const submitDeny = async (deviation: DriftDeviation, input: DenyDeviationInput): Promise<void> => {
    try {
      await denyDeviation(deviation.id, input, doFetch);
      setDialog({ kind: "none" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const submitBulk = async (input: BulkTriageInput): Promise<void> => {
    try {
      const result = await bulkTriageDrift(input, doFetch);
      setDialog({ kind: "none" });
      if (result.skipped.length > 0) {
        setNotice(
          `Bulk ${input.action}: ${result.applied.length} applied, ${result.skipped.length} skipped.`,
        );
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div style={pageStyle} data-testid="drift-page">
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>Manage Drift</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-soft)", fontSize: "14px" }}>
            Desired-state deviations with accept, tenant-override, and deny triage.
          </p>
        </div>
        <div style={controlsStyle}>
          <input
            style={inputStyle}
            aria-label="Tenant id"
            data-testid="drift-tenant-input"
            placeholder="Tenant id…"
            value={tenant}
            onChange={(event) => setTenant(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void load();
            }}
          />
          <button type="button" style={primaryButtonStyle} data-testid="drift-load" onClick={() => void load()}>
            Load
          </button>
          <button type="button" style={buttonStyle} data-testid="drift-refresh" onClick={() => void handleRefresh()}>
            Refresh data
          </button>
          <button type="button" style={buttonStyle} data-testid="drift-report" onClick={handleGenerateReport}>
            Generate report
          </button>
          <button type="button" style={buttonStyle} data-testid="drift-edit-template" onClick={handleEditTemplate}>
            Edit template
          </button>
          <button type="button" style={buttonStyle} data-testid="drift-run-standard" onClick={() => void handleRunStandardNow()}>
            Run standard now
          </button>
        </div>
      </div>

      {notice && (
        <div style={noticeStyle} data-testid="drift-notice">
          {notice}
        </div>
      )}

      <DriftTable
        deviations={deviations}
        breakdown={breakdown}
        loading={loading}
        error={error}
        onAccept={(deviation) => openRowDialog("accept", deviation)}
        onOverride={(deviation) => openRowDialog("override", deviation)}
        onDeny={(deviation) => openRowDialog("deny", deviation)}
        onBulk={(action, ids) => {
          const target = requireTenant();
          if (!target) return;
          setDialog({ kind: "bulk", action, ids });
        }}
      />

      {dialog.kind === "accept" && (
        <AcceptDeviationDialog
          deviation={dialog.deviation}
          onClose={() => setDialog({ kind: "none" })}
          onSubmit={submitAccept}
        />
      )}
      {dialog.kind === "override" && (
        <OverrideDeviationDialog
          deviation={dialog.deviation}
          onClose={() => setDialog({ kind: "none" })}
          onSubmit={submitOverride}
        />
      )}
      {dialog.kind === "deny" && (
        <DenyDeviationDialog
          deviation={dialog.deviation}
          onClose={() => setDialog({ kind: "none" })}
          onSubmit={submitDeny}
        />
      )}
      {dialog.kind === "bulk" && (
        <BulkTriageDialog
          action={dialog.action}
          tenantId={tenant.trim()}
          deviationIds={dialog.ids}
          onClose={() => setDialog({ kind: "none" })}
          onSubmit={submitBulk}
        />
      )}
    </div>
  );
}
