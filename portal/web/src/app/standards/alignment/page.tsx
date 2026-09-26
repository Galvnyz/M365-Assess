"use client";

// Standard & Drift Alignment + per-tenant Standards Report (EPIC-008 SPEC.md
// §3.3, §3.4; T-0148).
// Page title "Standard & Drift Alignment" with the three-way view switcher; when
// a tenant is selected it becomes "Standards Report — <tenant>" with search, a
// Standard Logs drawer, a Run standard report dialog, and a Compare-tenant-to-
// standard mode. Zero colour literals: report theme tokens only.

import React, { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react";
import { AlignmentReport } from "../../../components/standards/AlignmentReport.js";
import {
  fetchStandardsAlignment,
  fetchStandardsCompare,
  runStandardTemplateNow,
  type AlignmentAggregateRow,
  type AlignmentByStandardRow,
  type AlignmentSummaryRow,
  type AlignmentView,
  type StandardsCompareResponse,
} from "../../../lib/standardsApi.js";

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

const inputStyle: CSSProperties = {
  padding: "8px 12px",
  background: "var(--input-bg, var(--bg))",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "14px",
};

const panelStyle: CSSProperties = {
  padding: "16px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  boxShadow: "var(--shadow-card)",
};

const drawerStyle: CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  height: "100%",
  width: "min(440px, 100%)",
  overflowY: "auto",
  background: "var(--bg-elev)",
  borderLeft: "1px solid var(--border)",
  padding: "20px",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  zIndex: 40,
};

const monoStyle: CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  fontSize: "12px",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  margin: 0,
};

export interface AlignmentPageProps {
  readonly fetcher?: typeof fetch;
  /** Pre-selected tenant; when set, the per-tenant report renders. */
  readonly tenantId?: string;
}

export default function AlignmentPage({ fetcher, tenantId = "" }: AlignmentPageProps): ReactElement {
  const doFetch = fetcher ?? fetch;
  const [view, setView] = useState<AlignmentView>("summary");
  const [summary, setSummary] = useState<AlignmentSummaryRow[]>([]);
  const [byStandard, setByStandard] = useState<AlignmentByStandardRow[]>([]);
  const [aggregate, setAggregate] = useState<AlignmentAggregateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedTenant, setSelectedTenant] = useState<string>(tenantId);
  const [report, setReport] = useState<StandardsCompareResponse | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [drawerCheck, setDrawerCheck] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [showRunDialog, setShowRunDialog] = useState(false);
  const [runTemplateId, setRunTemplateId] = useState("");
  const [runNotice, setRunNotice] = useState<string | null>(null);

  const loadAlignment = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, byStandardRes, aggregateRes] = await Promise.all([
        fetchStandardsAlignment("summary", {}, doFetch),
        fetchStandardsAlignment("by-standard", {}, doFetch),
        fetchStandardsAlignment("aggregate", {}, doFetch),
      ]);
      setSummary(summaryRes.items as AlignmentSummaryRow[]);
      setByStandard(byStandardRes.items as AlignmentByStandardRow[]);
      setAggregate(aggregateRes.items as AlignmentAggregateRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [doFetch]);

  useEffect(() => {
    void loadAlignment();
  }, [loadAlignment]);

  const loadReport = useCallback(
    async (tenant: string): Promise<void> => {
      if (!tenant) return;
      setReportLoading(true);
      setError(null);
      try {
        setReport(await fetchStandardsCompare(tenant, doFetch));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setReport(null);
      } finally {
        setReportLoading(false);
      }
    },
    [doFetch],
  );

  useEffect(() => {
    if (selectedTenant) void loadReport(selectedTenant);
  }, [selectedTenant, loadReport]);

  const filteredReportItems = useMemo(() => {
    const items = report?.items ?? [];
    if (!search.trim()) return items;
    const query = search.trim().toLowerCase();
    return items.filter(
      (item) => item.check.toLowerCase().includes(query) || item.state.toLowerCase().includes(query),
    );
  }, [report, search]);

  const drawerItem = report?.items.find((item) => item.check === drawerCheck) ?? null;

  const handleRunReport = async (): Promise<void> => {
    if (!runTemplateId.trim() || !selectedTenant) {
      setRunNotice("A template id and tenant are required.");
      return;
    }
    try {
      await runStandardTemplateNow(runTemplateId.trim(), selectedTenant, doFetch);
      setShowRunDialog(false);
      setRunNotice(`Enqueued report for ${selectedTenant}.`);
      await loadReport(selectedTenant);
    } catch (err) {
      setRunNotice(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div style={pageStyle} data-testid="alignment-page">
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>
            {selectedTenant ? `Standards Report — ${selectedTenant}` : "Standard & Drift Alignment"}
          </h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-soft)", fontSize: "14px" }}>
            {selectedTenant
              ? "Per-tenant current vs expected state across the effective standards."
              : "Compliance across tenants and standards, sharing the drift status vocabulary."}
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Tenant id"
            value={selectedTenant}
            onChange={(e) => setSelectedTenant(e.target.value)}
            style={inputStyle}
            aria-label="Tenant id"
            data-testid="alignment-tenant"
          />
          {selectedTenant && (
            <>
              <input
                type="text"
                placeholder="Search standards..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={inputStyle}
                aria-label="Search standards"
                data-testid="report-search"
              />
              <button
                type="button"
                style={compareMode ? primaryButtonStyle : buttonStyle}
                onClick={() => setCompareMode((v) => !v)}
                data-testid="compare-mode-toggle"
              >
                Compare tenant to standard
              </button>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={() => setShowRunDialog(true)}
                data-testid="run-report-button"
              >
                Run standard report
              </button>
            </>
          )}
        </div>
      </div>

      {runNotice && (
        <div style={{ padding: "10px 14px", background: "var(--accent-soft)", border: "1px solid var(--accent)", borderRadius: "6px", color: "var(--accent-text)", fontSize: "13px" }} data-testid="run-notice">
          {runNotice}
        </div>
      )}

      {!selectedTenant && (
        <AlignmentReport
          view={view}
          summary={summary}
          byStandard={byStandard}
          aggregate={aggregate}
          loading={loading}
          error={error}
          onViewChange={setView}
          onSelectTenant={setSelectedTenant}
        />
      )}

      {selectedTenant && (
        <div style={panelStyle} data-testid="tenant-report">
          {reportLoading && <div style={{ color: "var(--text-soft)" }}>Loading report...</div>}
          {error && (
            <div style={{ padding: "12px", background: "var(--danger-soft)", border: "1px solid var(--danger)", borderRadius: "6px", color: "var(--danger-text)" }} role="alert">
              {error}
            </div>
          )}
          {!reportLoading && report && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px", textAlign: "left" }} aria-label="Standards report">
              <thead>
                <tr>
                  <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", color: "var(--text-soft)", fontSize: "12px", textTransform: "uppercase" }}>Check</th>
                  {compareMode && <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", color: "var(--text-soft)", fontSize: "12px", textTransform: "uppercase" }}>Current</th>}
                  {compareMode && <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", color: "var(--text-soft)", fontSize: "12px", textTransform: "uppercase" }}>Expected</th>}
                  <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", color: "var(--text-soft)", fontSize: "12px", textTransform: "uppercase" }}>Status</th>
                  <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", color: "var(--text-soft)", fontSize: "12px", textTransform: "uppercase" }}>Logs</th>
                </tr>
              </thead>
              <tbody>
                {filteredReportItems.length === 0 && (
                  <tr>
                    <td colSpan={compareMode ? 5 : 3} style={{ padding: "16px", textAlign: "center", color: "var(--text-soft)" }} data-testid="report-empty">
                      No standards match.
                    </td>
                  </tr>
                )}
                {filteredReportItems.map((item) => (
                  <tr key={item.check} data-testid={`report-row-${item.check}`}>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>{item.check}</td>
                    {compareMode && <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>{JSON.stringify(item.current)}</td>}
                    {compareMode && <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>{JSON.stringify(item.expected)}</td>}
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>{item.state}</td>
                    <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
                      <button
                        type="button"
                        style={buttonStyle}
                        onClick={() => setDrawerCheck(item.check)}
                        data-testid={`logs-${item.check}`}
                      >
                        Standard Logs
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {drawerItem && (
        <aside style={drawerStyle} role="dialog" aria-modal="true" aria-label="Standard logs" data-testid="standard-logs-drawer">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0, fontSize: "16px" }}>Standard Logs — {drawerItem.check}</h2>
            <button type="button" style={buttonStyle} onClick={() => setDrawerCheck(null)} data-testid="logs-close">
              Close
            </button>
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-soft)" }}>Status: {drawerItem.state}</div>
          <div style={{ fontSize: "12px", color: "var(--text-soft)" }}>Last run: {drawerItem.lastRunAt ?? "—"}</div>
          <div>
            <div style={{ fontSize: "12px", color: "var(--text-soft)", textTransform: "uppercase" }}>Current</div>
            <pre style={monoStyle}>{JSON.stringify(drawerItem.current, null, 2)}</pre>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "var(--text-soft)", textTransform: "uppercase" }}>Expected</div>
            <pre style={monoStyle}>{JSON.stringify(drawerItem.expected, null, 2)}</pre>
          </div>
        </aside>
      )}

      {showRunDialog && (
        <div style={{ position: "fixed", inset: 0, background: "var(--overlay, rgba(0,0,0,0.5))", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} data-testid="run-report-dialog">
          <div style={{ ...panelStyle, width: "min(420px, 100%)", display: "flex", flexDirection: "column", gap: "12px" }}>
            <h2 style={{ margin: 0, fontSize: "16px" }}>Run standard report</h2>
            <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px" }}>
              Template id
              <input
                type="text"
                value={runTemplateId}
                onChange={(e) => setRunTemplateId(e.target.value)}
                style={inputStyle}
                data-testid="run-template-id"
              />
            </label>
            <div style={{ fontSize: "13px", color: "var(--text-soft)" }}>Tenant: {selectedTenant}</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button type="button" style={buttonStyle} onClick={() => setShowRunDialog(false)} data-testid="run-report-cancel">
                Cancel
              </button>
              <button type="button" style={primaryButtonStyle} onClick={handleRunReport} data-testid="run-report-confirm">
                Run report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
