"use client";
// ExecutiveReportButton — opens a PDF preview dialog and triggers executive
// report generation for the current tenant (EPIC-005 SPEC.md §3.1, §4.1).
// The PDF is rendered server-side; this component polls the generated report
// handle until status=succeeded, then surfaces the inline preview and download.

import { useState } from "react";
import PdfPreviewDialog from "./PdfPreviewDialog";

export interface ExecutiveReportButtonProps {
  readonly tenantId: string;
  /** Override the fetch implementation for tests. */
  readonly fetcher?: typeof fetch;
}

async function requestExecutive(
  fetcher: typeof fetch,
  tenantId: string,
): Promise<{ id: string; status: string; artifactRef: string | null }> {
  const res = await fetcher("/v1/reports/executive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantId }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`Failed to enqueue executive report: ${msg}`);
  }
  return res.json() as Promise<{ id: string; status: string; artifactRef: string | null }>;
}

async function pollReport(
  fetcher: typeof fetch,
  id: string,
  maxAttempts = 30,
  intervalMs = 2000,
): Promise<{ id: string; status: string; artifactRef: string | null }> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const res = await fetcher(`/v1/reports?id=${encodeURIComponent(id)}`);
    if (res.ok) {
      const page = await res.json() as { items: Array<{ id: string; status: string; artifactRef: string | null }> };
      const report = page.items.find((r) => r.id === id);
      if (report && (report.status === "succeeded" || report.status === "failed")) {
        return report;
      }
    }
    await new Promise<void>((resolve) => { setTimeout(resolve, intervalMs); });
  }
  throw new Error("Report generation timed out.");
}

export default function ExecutiveReportButton({
  tenantId,
  fetcher = fetch,
}: ExecutiveReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reportId, setReportId] = useState<string | null>(null);
  const [artifactRef, setArtifactRef] = useState<string | null>(null);

  async function handleOpen() {
    setBusy(true);
    setError("");
    setArtifactRef(null);
    setReportId(null);
    try {
      const handle = await requestExecutive(fetcher, tenantId);
      setReportId(handle.id);
      setOpen(true);
      const done = await pollReport(fetcher, handle.id);
      if (done.status === "failed") {
        setError("Report generation failed. Please try again.");
      } else {
        setArtifactRef(done.artifactRef);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Report generation failed.");
    } finally {
      setBusy(false);
    }
  }

  function handleClose() {
    setOpen(false);
    setError("");
    setArtifactRef(null);
    setReportId(null);
  }

  return (
    <>
      <button
        type="button"
        data-testid="executive-report-btn"
        disabled={busy}
        onClick={handleOpen}
        style={{ color: "var(--on-accent)", background: "var(--accent)", border: "none", borderRadius: "6px", padding: "8px 16px", cursor: busy ? "not-allowed" : "pointer" }}
      >
        {busy ? "Generating…" : "Executive Report"}
      </button>

      {open ? (
        <PdfPreviewDialog
          reportId={reportId}
          artifactRef={artifactRef}
          error={error}
          tenantId={tenantId}
          onClose={handleClose}
        />
      ) : null}
    </>
  );
}
