"use client";

// Runs list page (EPIC-003 SPEC.md §3.1, T-0049).
// Displays the Runs DataTable with status badges, progress bars, finding counts,
// filters, and wired row actions (View, Cancel, Retry, Download artifacts, Compare).
// Strictly uses report theme tokens with zero colour literals.

import React, { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import { RunsTable, type RunItem } from "../../components/RunsTable";

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
  alignItems: "center",
  borderBottom: "1px solid var(--border)",
  paddingBottom: "16px",
};

const titleStyle: CSSProperties = {
  fontSize: "24px",
  fontWeight: 700,
  margin: 0,
  fontFamily: "var(--font-display, var(--font-sans))",
};

const primaryLinkStyle: CSSProperties = {
  padding: "10px 18px",
  background: "var(--accent)",
  color: "var(--on-accent)",
  border: "1px solid var(--accent)",
  borderRadius: "6px",
  fontWeight: 600,
  fontSize: "14px",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  cursor: "pointer",
};

export default function RunsPage(): ReactElement {
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRuns = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/v1/runs");
      if (!res.ok) {
        throw new Error(`Failed to load assessment runs: ${res.statusText}`);
      }
      const data = await res.json();
      setRuns(data.items ?? data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRuns();
  }, []);

  const handleView = (run: RunItem): void => {
    window.location.href = `/runs/${run.id}`;
  };

  const handleCancel = async (run: RunItem): Promise<void> => {
    try {
      const res = await fetch(`/v1/runs/${run.id}/cancel`, { method: "POST" });
      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.message ?? "Failed to cancel run");
      }
      await fetchRuns();
    } catch (err) {
      alert(`Cancel failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleRetry = async (run: RunItem): Promise<void> => {
    try {
      const res = await fetch(`/v1/runs/${run.id}/retry`, { method: "POST" });
      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.message ?? "Failed to retry run");
      }
      await fetchRuns();
    } catch (err) {
      alert(`Retry failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDownloadArtifacts = (run: RunItem): void => {
    window.location.href = `/runs/${run.id}#artifacts`;
  };

  const handleCompare = (run: RunItem): void => {
    window.location.href = `/drift?baseRunId=${run.id}`;
  };

  const handleNewRun = (): void => {
    window.location.href = "/runs/new";
  };

  return (
    <div style={pageStyle} data-testid="runs-page">
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>Runs</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-soft)", fontSize: "14px" }}>
            Monitor live execution, review assessment history, and download reports.
          </p>
        </div>
        <a href="/runs/new" style={primaryLinkStyle} data-testid="page-new-run-link">
          New run
        </a>
      </div>

      <RunsTable
        runs={runs}
        loading={loading}
        error={error}
        onView={handleView}
        onCancel={handleCancel}
        onRetry={handleRetry}
        onDownloadArtifacts={handleDownloadArtifacts}
        onCompare={handleCompare}
        onNewRun={handleNewRun}
      />
    </div>
  );
}
