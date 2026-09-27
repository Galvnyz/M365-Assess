"use client";

// Executive drift report page (EPIC-009 SPEC.md §3.4; T-0170).
// Loads the T-0170 report route for the `?tenant=` tenant and renders it
// through `ExecutiveDriftReport` with the EPIC-005 report theme/branding.
// The Download PDF action produces the artifact through the EPIC-005 report
// pipeline (POST /v1/reports/render with the drift summary as the custom
// document). Zero colour literals: report theme tokens only.

import React, { useCallback, useEffect, useState, type CSSProperties, type ReactElement } from "react";
import {
  ExecutiveDriftReport,
  type ExecutiveDriftReportData,
} from "../../../components/drift/ExecutiveDriftReport";

const pageStyle: CSSProperties = {
  padding: "32px",
  maxWidth: "1100px",
  margin: "0 auto",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
  background: "var(--report-bg, var(--bg))",
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
  color: "var(--on-accent)",
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

export interface DriftReportPageProps {
  readonly fetcher?: typeof fetch;
  readonly tenantId?: string;
}

async function readError(response: Response, what: string): Promise<never> {
  let detail = response.statusText;
  try {
    const body = (await response.json()) as { message?: string };
    if (body?.message) detail = body.message;
  } catch {
    // non-JSON error body; keep the status text
  }
  throw new Error(`${what} failed: ${response.status} ${detail}`);
}

export default function DriftReportPage({ fetcher, tenantId = "" }: DriftReportPageProps): ReactElement {
  const doFetch = fetcher ?? fetch;
  const [tenant, setTenant] = useState(tenantId);
  const [report, setReport] = useState<ExecutiveDriftReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  const load = useCallback(
    async (tenantOverride?: string): Promise<void> => {
      const target = (tenantOverride ?? tenant).trim();
      if (!target) {
        setReport(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const response = await doFetch(`/v1/drift/${encodeURIComponent(target)}/report`);
        if (!response.ok) await readError(response, "Loading drift report");
        setReport((await response.json()) as ExecutiveDriftReportData);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setReport(null);
      } finally {
        setLoading(false);
      }
    },
    [doFetch, tenant],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("tenant") ?? "";
    if (fromQuery.trim()) {
      setTenant(fromQuery.trim());
      void load(fromQuery.trim());
    } else if (tenantId.trim()) {
      void load(tenantId);
    }
    // Load once on mount; tenant edits reload explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDownloadPdf = async (): Promise<void> => {
    if (!report) {
      setNotice("Load a drift report before generating the PDF artifact.");
      return;
    }
    setRendering(true);
    setNotice(null);
    try {
      const response = await doFetch("/v1/reports/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: report.tenantId,
          templateId: null,
          document: { type: "drift-executive", report },
        }),
      });
      if (!response.ok) await readError(response, "Generating drift report artifact");
      const created = (await response.json()) as { id?: string };
      setNotice(
        created.id
          ? `Report artifact queued (${created.id}); track it under Generated Reports.`
          : "Report artifact queued; track it under Generated Reports.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRendering(false);
    }
  };

  return (
    <div style={pageStyle} data-testid="drift-report-page">
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>Executive Drift Report</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-soft)", fontSize: "14px" }}>
            Deviations, accepted items, and remediation status for management.
          </p>
        </div>
        <div style={controlsStyle}>
          <input
            style={inputStyle}
            aria-label="Tenant id"
            data-testid="drift-report-tenant-input"
            placeholder="Tenant id…"
            value={tenant}
            onChange={(event) => setTenant(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void load();
            }}
          />
          <button type="button" style={primaryButtonStyle} data-testid="drift-report-load" onClick={() => void load()}>
            Load
          </button>
          <button
            type="button"
            style={buttonStyle}
            data-testid="drift-report-pdf"
            disabled={rendering || !report}
            onClick={() => void handleDownloadPdf()}
          >
            {rendering ? "Generating…" : "Download PDF"}
          </button>
        </div>
      </div>

      {notice && (
        <div style={noticeStyle} data-testid="drift-report-notice">
          {notice}
        </div>
      )}

      <ExecutiveDriftReport report={report} loading={loading} error={error} />
    </div>
  );
}
