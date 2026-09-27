"use client";

// Baselines list page (EPIC-010 SPEC.md §3.1, §3.2; T-0187).
// Fleet Overview (FleetOverview) plus the Baselines table: Name · Stages ·
// Assigned tenants/groups · Fleet compliance · Last run. Primary button Add
// baseline; header actions Migrate from standards (T-0189) and Browse baseline
// catalog (T-0190). Row actions View, Edit, Run now, Delete, Export.
// Zero colour literals: report theme tokens only.

import React, { useCallback, useEffect, useState, type CSSProperties, type ReactElement } from "react";
import { FleetOverview } from "../../components/baselines/FleetOverview";
import {
  deleteBaseline,
  fetchBaselines,
  fetchFleetOverview,
  type BaselineSummary,
  type FleetOverview as FleetOverviewData,
} from "../../lib/baselinesApi";

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

const actionBtnStyle: CSSProperties = {
  padding: "4px 8px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "4px",
  color: "var(--text)",
  fontSize: "12px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const tableWrapStyle: CSSProperties = {
  overflowX: "auto",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "13px",
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid var(--border)",
  color: "var(--text-soft)",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const tdStyle: CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--border)",
  verticalAlign: "top",
};

const noticeStyle: CSSProperties = {
  padding: "10px 14px",
  background: "var(--accent-soft)",
  border: "1px solid var(--accent)",
  borderRadius: "6px",
  color: "var(--accent-text)",
  fontSize: "13px",
};

export interface BaselinesPageProps {
  readonly fetcher?: typeof fetch;
}

function complianceLabel(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default function BaselinesPage({ fetcher }: BaselinesPageProps): ReactElement {
  const doFetch = fetcher ?? fetch;
  const [baselines, setBaselines] = useState<readonly BaselineSummary[]>([]);
  const [fleet, setFleet] = useState<FleetOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [items, overview] = await Promise.all([
        fetchBaselines(doFetch),
        fetchFleetOverview(doFetch),
      ]);
      setBaselines(items);
      setFleet(overview);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBaselines([]);
      setFleet(null);
    } finally {
      setLoading(false);
    }
  }, [doFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const complianceFor = (id: string): number | null => {
    const row = fleet?.baselines.find((entry) => entry.id === id);
    return row ? row.fleetCompliance : null;
  };

  const assignedFor = (id: string): string => {
    const row = fleet?.baselines.find((entry) => entry.id === id);
    return row ? String(row.assignedTenants) : "—";
  };

  const lastRunFor = (id: string): string => {
    const row = fleet?.baselines.find((entry) => entry.id === id);
    return row?.lastRunAt ?? "—";
  };

  const handleDelete = async (id: string, name: string): Promise<void> => {
    try {
      await deleteBaseline(id, doFetch);
      await load();
    } catch (err) {
      setError(`Deleting “${name}”: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleExport = (baseline: BaselineSummary): void => {
    const blob = new Blob([JSON.stringify(baseline, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `baseline-${baseline.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={pageStyle} data-testid="baselines-page">
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>Baselines</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-soft)", fontSize: "14px" }}>
            Staged rollouts of desired state across tenants.
          </p>
        </div>
        <div style={controlsStyle}>
          <button
            type="button"
            style={primaryButtonStyle}
            data-testid="baselines-add"
            onClick={() => {
              window.location.href = "/baselines/new/edit";
            }}
          >
            Add baseline
          </button>
          <button
            type="button"
            style={buttonStyle}
            data-testid="baselines-migrate"
            onClick={() => setNotice("Migrate from standards arrives with T-0189.")}
          >
            Migrate from standards
          </button>
          <button
            type="button"
            style={buttonStyle}
            data-testid="baselines-catalog"
            onClick={() => setNotice("Browse baseline catalog arrives with T-0190.")}
          >
            Browse baseline catalog
          </button>
        </div>
      </div>

      {notice && (
        <div style={noticeStyle} data-testid="baselines-notice">
          {notice}
        </div>
      )}

      <FleetOverview overview={fleet} loading={loading} error={error} />

      <div style={tableWrapStyle}>
        <table style={tableStyle} data-testid="baselines-table">
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Stages</th>
              <th style={thStyle}>Assigned tenants/groups</th>
              <th style={thStyle}>Fleet compliance</th>
              <th style={thStyle}>Last run</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {baselines.map((baseline) => {
              const compliance = complianceFor(baseline.id);
              return (
                <tr key={baseline.id} data-testid={`baseline-row-${baseline.id}`}>
                  <td style={tdStyle}>{baseline.name}</td>
                  <td style={tdStyle} data-testid={`baseline-stages-${baseline.id}`}>
                    {baseline.stages.length}
                  </td>
                  <td style={tdStyle} data-testid={`baseline-assigned-${baseline.id}`}>
                    {assignedFor(baseline.id)}
                  </td>
                  <td style={tdStyle} data-testid={`baseline-compliance-${baseline.id}`}>
                    {compliance === null ? "—" : complianceLabel(compliance)}
                  </td>
                  <td style={tdStyle}>{lastRunFor(baseline.id)}</td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        style={actionBtnStyle}
                        data-testid={`baseline-view-${baseline.id}`}
                        onClick={() => {
                          window.location.href = `/baselines/${baseline.id}/edit`;
                        }}
                      >
                        View
                      </button>
                      <button
                        type="button"
                        style={actionBtnStyle}
                        data-testid={`baseline-edit-${baseline.id}`}
                        onClick={() => {
                          window.location.href = `/baselines/${baseline.id}/edit`;
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        style={actionBtnStyle}
                        data-testid={`baseline-run-${baseline.id}`}
                        onClick={() =>
                          setNotice("Baseline runs are driven by the baseline system timer (EPIC-007).")
                        }
                      >
                        Run now
                      </button>
                      <button
                        type="button"
                        style={actionBtnStyle}
                        data-testid={`baseline-delete-${baseline.id}`}
                        onClick={() => void handleDelete(baseline.id, baseline.name)}
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        style={actionBtnStyle}
                        data-testid={`baseline-export-${baseline.id}`}
                        onClick={() => handleExport(baseline)}
                      >
                        Export
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && baselines.length === 0 && (
              <tr>
                <td colSpan={6} style={{ ...tdStyle, textAlign: "center", color: "var(--text-soft)" }} data-testid="baselines-empty">
                  No baselines yet. Add one to start a staged rollout.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
