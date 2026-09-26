"use client";

// ChangeHistoryPanel — Conditional Access Per-Policy Change History (EPIC-015 SPEC §4.4, §5, §6, §11.4; T-0290).
// Renders per-policy events merging directory audits (provenance) with portal before/after audit records.
import React, { useState, useMemo, type CSSProperties } from "react";

export interface CaPolicyChangeRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly policyId: string;
  readonly policyName: string;
  readonly timestamp: string;
  readonly initiatedBy: string;
  readonly action: string;
  readonly source: "portal" | "directoryAudit" | "merged";
  readonly diff?: readonly string[];
  readonly before?: Record<string, unknown> | null;
  readonly after?: Record<string, unknown> | null;
  readonly rawAudit?: Record<string, unknown>;
}

export interface ChangeHistoryPanelProps {
  readonly items?: readonly CaPolicyChangeRecord[];
  readonly selectedPolicyId?: string;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onRefresh?: () => void;
  readonly onPolicySelect?: (policyId: string | undefined) => void;
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "20px",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text, #111827)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "18px",
  fontWeight: 600,
};

const timelineItemStyle: CSSProperties = {
  padding: "16px",
  borderRadius: "8px",
  border: "1px solid var(--border, #e5e7eb)",
  backgroundColor: "var(--bg, #ffffff)",
  display: "flex",
  flexDirection: "column",
  gap: "10px",
};

const badgeStyle = (bgColor: string, textColor: string): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: "12px",
  fontSize: "11px",
  fontWeight: 500,
  backgroundColor: bgColor,
  color: textColor,
});

const diffBoxStyle: CSSProperties = {
  padding: "12px",
  borderRadius: "6px",
  backgroundColor: "#f9fafb",
  border: "1px solid #e5e7eb",
  fontFamily: "monospace",
  fontSize: "12px",
  whiteSpace: "pre-wrap",
};

export function ChangeHistoryPanel({
  items = [],
  selectedPolicyId,
  loading = false,
  error = null,
  onRefresh,
  onPolicySelect,
}: ChangeHistoryPanelProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedDiffs, setExpandedDiffs] = useState<Record<string, boolean>>({});

  const filteredItems = useMemo(() => {
    let list = items;
    if (selectedPolicyId) {
      list = list.filter((i) => i.policyId === selectedPolicyId);
    }
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      list = list.filter(
        (i) =>
          i.policyName.toLowerCase().includes(term) ||
          i.initiatedBy.toLowerCase().includes(term) ||
          i.action.toLowerCase().includes(term),
      );
    }
    return list;
  }, [items, selectedPolicyId, searchTerm]);

  const toggleDiff = (id: string) => {
    setExpandedDiffs((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  return (
    <div style={containerStyle} data-testid="change-history-panel">
      {/* Header */}
      <div style={headerStyle}>
        <div>
          <h3 style={titleStyle}>Conditional Access Change History</h3>
          <p style={{ margin: "2px 0 0 0", fontSize: "13px", color: "var(--text-secondary, #4b5563)" }}>
            Directory audits merged with portal before/after snapshots for full audit provenance.
          </p>
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            style={{
              padding: "6px 12px",
              borderRadius: "6px",
              border: "1px solid var(--border, #d1d5db)",
              backgroundColor: "transparent",
              cursor: "pointer",
              fontSize: "13px",
            }}
            data-testid="refresh-history-btn"
          >
            Refresh
          </button>
        )}
      </div>

      {/* Controls: Search and Policy Filter Reset */}
      <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
        <input
          type="text"
          placeholder="Filter history by user, policy, or action..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            padding: "8px 12px",
            borderRadius: "6px",
            border: "1px solid var(--border, #d1d5db)",
            fontSize: "13px",
            width: "100%",
            maxWidth: "360px",
          }}
          data-testid="history-search-input"
        />

        {selectedPolicyId && onPolicySelect && (
          <button
            type="button"
            onClick={() => onPolicySelect(undefined)}
            style={{
              padding: "6px 12px",
              borderRadius: "6px",
              border: "1px solid var(--border, #d1d5db)",
              backgroundColor: "transparent",
              fontSize: "12px",
              cursor: "pointer",
            }}
            data-testid="clear-policy-filter-btn"
          >
            Clear Policy Filter ({selectedPolicyId})
          </button>
        )}
      </div>

      {/* Loading state */}
      {loading && (
        <div style={{ textAlign: "center", padding: "30px", color: "var(--text-muted, #6b7280)", fontSize: "13px" }} data-testid="history-loading">
          Loading change history records...
        </div>
      )}

      {/* Error state */}
      {error && (
        <div style={{ padding: "10px", borderRadius: "6px", backgroundColor: "#fef2f2", color: "#991b1b", fontSize: "13px" }} data-testid="history-error">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && filteredItems.length === 0 && !error && (
        <div style={{ padding: "32px", textAlign: "center", border: "1px dashed var(--border, #d1d5db)", borderRadius: "8px", color: "var(--text-muted, #6b7280)", fontSize: "13px" }} data-testid="history-empty">
          No change history records found.
        </div>
      )}

      {/* Timeline items */}
      {!loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }} data-testid="history-items-list">
          {filteredItems.map((item) => {
            const isDiffOpen = Boolean(expandedDiffs[item.id]);
            const isPortal = item.source === "portal";
            const isDirAudit = item.source === "directoryAudit";

            return (
              <div key={item.id} style={timelineItemStyle} data-testid={`history-item-${item.id}`}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <strong style={{ fontSize: "14px" }}>{item.policyName}</strong>
                      <span
                        style={badgeStyle(
                          isPortal ? "#e0e7ff" : isDirAudit ? "#fef3c7" : "#dcfce7",
                          isPortal ? "#3730a3" : isDirAudit ? "#92400e" : "#166534",
                        )}
                        data-testid="source-badge"
                      >
                        {isPortal ? "Portal Audit" : isDirAudit ? "Directory Audit" : "Merged"}
                      </span>
                      <span style={badgeStyle("#f3f4f6", "#374151")}>{item.action}</span>
                    </div>
                    <span style={{ fontSize: "12px", color: "var(--text-secondary, #4b5563)" }}>
                      By <strong>{item.initiatedBy}</strong> • {new Date(item.timestamp).toLocaleString()}
                    </span>
                  </div>

                  {item.diff && item.diff.length > 0 && (
                    <button
                      type="button"
                      onClick={() => toggleDiff(item.id)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--primary, #2563eb)",
                        cursor: "pointer",
                        fontSize: "12px",
                        fontWeight: 500,
                      }}
                      data-testid={`toggle-diff-btn-${item.id}`}
                    >
                      {isDiffOpen ? "Hide Changes" : "View Changes"}
                    </button>
                  )}
                </div>

                {isDiffOpen && item.diff && (
                  <div style={diffBoxStyle} data-testid={`diff-box-${item.id}`}>
                    {item.diff.join("\n")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
