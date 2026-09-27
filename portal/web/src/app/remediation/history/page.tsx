"use client";

// Remediation history page (EPIC-006 SPEC.md §3.4, T-0113).
// Nav: Tenant Administration → Remediation → History. Append-only log read from
// GET /v1/remediation/history. Export to SIEM is EPIC-041.
// Zero colour literals: report theme tokens only.

import React, { useCallback, useEffect, useState, type CSSProperties, type ReactElement } from "react";
import { RemediationHistoryTable } from "../../../components/remediation/RemediationHistoryTable";
import {
  fetchRemediationHistory,
  type RemediationHistoryRow,
} from "../../../lib/remediationApi";

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
  borderBottom: "1px solid var(--border)",
  paddingBottom: "16px",
};

const titleStyle: CSSProperties = {
  fontSize: "24px",
  fontWeight: 700,
  margin: 0,
  fontFamily: "var(--font-display, var(--font-sans))",
};

export interface RemediationHistoryPageProps {
  readonly tenantId?: string;
  readonly fetcher?: typeof fetch;
}

export default function RemediationHistoryPage({
  tenantId = "",
  fetcher,
}: RemediationHistoryPageProps): ReactElement {
  const [rows, setRows] = useState<readonly RemediationHistoryRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (cursor?: string): Promise<void> => {
      if (!tenantId) return;
      setLoading(true);
      setError(null);
      try {
        const page = await fetchRemediationHistory(tenantId, { cursor }, fetcher);
        setRows((previous) => (cursor ? [...previous, ...page.items] : page.items));
        setNextCursor(page.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [tenantId, fetcher],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={pageStyle} data-testid="remediation-history-page">
      <div style={headerStyle}>
        <h1 style={titleStyle}>Remediation History</h1>
        <p style={{ margin: "4px 0 0", color: "var(--text-soft)", fontSize: "14px" }}>
          Append-only audit log of remediation plans, applies, and verifications
          {tenantId ? ` for ${tenantId}` : ""}.
        </p>
      </div>

      <RemediationHistoryTable rows={rows} loading={loading} error={error} tenantId={tenantId} />

      {nextCursor && (
        <div style={{ display: "flex", justifyContent: "center" }}>
          <button
            type="button"
            onClick={() => void load(nextCursor)}
            disabled={loading}
            style={{
              padding: "8px 16px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              color: "var(--text)",
              cursor: "pointer",
            }}
            data-testid="history-load-more"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
