import React, { useState, useMemo, type CSSProperties, type ReactElement } from "react";
import { CredentialBadge, type CredentialState } from "./CredentialBadge";

export interface TenantItem {
  readonly id: string;
  readonly displayName: string | null;
  readonly defaultDomain: string | null;
  readonly initialDomain?: string | null;
  readonly source: "direct" | "gdap";
  readonly status: "active" | "excluded" | "error";
  readonly credentialState?: CredentialState;
  readonly credentialExpiresOn?: string | null;
  readonly lastRunAt?: string | null;
  readonly errorCount: number;
  readonly lastError?: string | null;
  readonly environment?: string;
}

export interface TenantTableProps {
  readonly tenants?: readonly TenantItem[];
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onView?: (tenant: TenantItem) => void;
  readonly onEdit?: (tenant: TenantItem) => void;
  readonly onTestCredential?: (tenant: TenantItem) => void;
  readonly onSetCredential?: (tenant: TenantItem) => void;
  readonly onToggleExclude?: (tenant: TenantItem) => void;
  readonly onRemove?: (tenant: TenantItem) => void;
  readonly onBulkExclude?: (selectedIds: string[]) => void;
  readonly onBulkAddToGroup?: (selectedIds: string[]) => void;
  readonly onBulkRunAssessment?: (selectedIds: string[]) => void;
  readonly defaultViewMode?: "table" | "card";
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  width: "100%",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
};

const filterBarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "12px",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "16px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
};

const filterGroupStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
  alignItems: "center",
};

const inputStyle: CSSProperties = {
  padding: "8px 12px",
  background: "var(--input-bg, var(--bg))",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "14px",
  minWidth: "220px",
};

const selectStyle: CSSProperties = {
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

const bulkBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 16px",
  background: "var(--accent-soft)",
  border: "1px solid var(--accent-border, var(--border))",
  borderRadius: "6px",
  color: "var(--accent-text, var(--text))",
};

const tableWrapperStyle: CSSProperties = {
  overflowX: "auto",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  boxShadow: "var(--shadow-card)",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "14px",
  textAlign: "left",
};

const thStyle: CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text-soft)",
  fontWeight: 600,
  fontSize: "12px",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const tdStyle: CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid var(--border)",
  color: "var(--text)",
};

const statusTagStyle = (status: "active" | "excluded" | "error"): CSSProperties => {
  if (status === "active") {
    return {
      padding: "2px 8px",
      borderRadius: "999px",
      fontSize: "12px",
      fontWeight: 600,
      background: "var(--success-soft)",
      color: "var(--success-text)",
      border: "1px solid var(--success)",
      display: "inline-block",
    };
  }
  if (status === "error") {
    return {
      padding: "2px 8px",
      borderRadius: "999px",
      fontSize: "12px",
      fontWeight: 600,
      background: "var(--danger-soft)",
      color: "var(--danger-text)",
      border: "1px solid var(--danger)",
      display: "inline-block",
    };
  }
  return {
    padding: "2px 8px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 600,
    background: "var(--chip)",
    color: "var(--text-soft)",
    border: "1px solid var(--border)",
    display: "inline-block",
  };
};

const actionBtnStyle: CSSProperties = {
  padding: "4px 8px",
  fontSize: "12px",
  borderRadius: "4px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  cursor: "pointer",
  marginRight: "6px",
};

const cardGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
  gap: "16px",
};

const cardStyle: CSSProperties = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  padding: "16px",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  boxShadow: "var(--shadow-card)",
};

export function TenantTable({
  tenants = [],
  loading = false,
  error = null,
  onView,
  onEdit,
  onTestCredential,
  onSetCredential,
  onToggleExclude,
  onRemove,
  onBulkExclude,
  onBulkAddToGroup,
  onBulkRunAssessment,
  defaultViewMode = "table",
}: TenantTableProps): ReactElement {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [credentialFilter, setCredentialFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"table" | "card">(defaultViewMode);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const filteredTenants = useMemo(() => {
    return tenants.filter((tenant) => {
      if (search.trim()) {
        const query = search.toLowerCase();
        const nameMatch = tenant.displayName?.toLowerCase().includes(query) ?? false;
        const domainMatch = tenant.defaultDomain?.toLowerCase().includes(query) ?? false;
        const idMatch = tenant.id.toLowerCase().includes(query);
        if (!nameMatch && !domainMatch && !idMatch) return false;
      }
      if (statusFilter !== "all" && tenant.status !== statusFilter) {
        return false;
      }
      if (sourceFilter !== "all" && tenant.source !== sourceFilter) {
        return false;
      }
      if (credentialFilter !== "all") {
        const credState = tenant.credentialState ?? "missing";
        if (credState !== credentialFilter) {
          return false;
        }
      }
      return true;
    });
  }, [tenants, search, statusFilter, sourceFilter, credentialFilter]);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>): void => {
    if (e.target.checked) {
      setSelectedIds(filteredTenants.map((t) => t.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (id: string): void => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  if (loading) {
    return (
      <div style={{ ...containerStyle, padding: "32px", textAlign: "center" }} data-testid="tenant-loading">
        <p style={{ color: "var(--text-soft)", fontSize: "16px" }}>Loading tenants...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          ...containerStyle,
          padding: "20px",
          background: "var(--danger-soft)",
          border: "1px solid var(--danger)",
          borderRadius: "var(--radius, 10px)",
          color: "var(--danger-text)",
        }}
        data-testid="tenant-error"
      >
        <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>Failed to load tenants</h3>
        <p style={{ margin: "4px 0 0" }}>{error}</p>
      </div>
    );
  }

  return (
    <div style={containerStyle} data-testid="tenant-table-container">
      {/* Controls & Filter bar */}
      <div style={filterBarStyle} data-testid="tenant-filter-bar">
        <div style={filterGroupStyle}>
          <input
            type="text"
            placeholder="Search by name, domain, or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={inputStyle}
            data-testid="tenant-search-input"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={selectStyle}
            data-testid="tenant-status-filter"
            aria-label="Filter by status"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="excluded">Excluded</option>
            <option value="error">Error</option>
          </select>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            style={selectStyle}
            data-testid="tenant-source-filter"
            aria-label="Filter by source"
          >
            <option value="all">All Sources</option>
            <option value="direct">Direct</option>
            <option value="gdap">GDAP</option>
          </select>
          <select
            value={credentialFilter}
            onChange={(e) => setCredentialFilter(e.target.value)}
            style={selectStyle}
            data-testid="tenant-credential-filter"
            aria-label="Filter by credential state"
          >
            <option value="all">All Credentials</option>
            <option value="valid">Valid</option>
            <option value="expiring">Expiring</option>
            <option value="expired">Expired</option>
            <option value="missing">Missing</option>
          </select>
        </div>

        <div style={filterGroupStyle}>
          <button
            type="button"
            onClick={() => setViewMode(viewMode === "table" ? "card" : "table")}
            style={buttonStyle}
            data-testid="tenant-view-toggle"
          >
            {viewMode === "table" ? "Card View" : "Table View"}
          </button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.length > 0 && (
        <div style={bulkBarStyle} data-testid="tenant-bulk-actions">
          <span>{selectedIds.length} tenant(s) selected</span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={() => onBulkExclude?.(selectedIds)}
              style={buttonStyle}
              data-testid="bulk-exclude-btn"
            >
              Exclude
            </button>
            <button
              type="button"
              onClick={() => onBulkAddToGroup?.(selectedIds)}
              style={buttonStyle}
              data-testid="bulk-add-group-btn"
            >
              Add to Group
            </button>
            <button
              type="button"
              onClick={() => onBulkRunAssessment?.(selectedIds)}
              style={primaryButtonStyle}
              data-testid="bulk-run-assessment-btn"
            >
              Run Assessment
            </button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {filteredTenants.length === 0 ? (
        <div
          style={{
            padding: "48px 16px",
            textAlign: "center",
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius, 10px)",
            color: "var(--text-soft)",
          }}
          data-testid="tenant-empty-state"
        >
          <p style={{ margin: 0, fontSize: "16px" }}>No tenants match the current filter.</p>
        </div>
      ) : viewMode === "table" ? (
        /* Table View */
        <div style={tableWrapperStyle}>
          <table style={tableStyle} data-testid="tenant-data-table">
            <thead>
              <tr>
                <th style={{ ...thStyle, width: "36px" }}>
                  <input
                    type="checkbox"
                    checked={
                      filteredTenants.length > 0 && selectedIds.length === filteredTenants.length
                    }
                    onChange={handleSelectAll}
                    aria-label="Select all tenants"
                    data-testid="select-all-checkbox"
                  />
                </th>
                <th style={thStyle}>Display Name</th>
                <th style={thStyle}>Primary Domain</th>
                <th style={thStyle}>Tenant ID</th>
                <th style={thStyle}>Source</th>
                <th style={thStyle}>Credential</th>
                <th style={thStyle}>Last Run</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Error Count</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTenants.map((t) => {
                const isSelected = selectedIds.includes(t.id);
                const credState = t.credentialState ?? "missing";
                return (
                  <tr
                    key={t.id}
                    style={{
                      background: isSelected ? "var(--hover)" : undefined,
                    }}
                    data-testid={`tenant-row-${t.id}`}
                  >
                    <td style={tdStyle}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleSelectOne(t.id)}
                        aria-label={`Select ${t.displayName ?? t.id}`}
                        data-testid={`select-tenant-${t.id}`}
                      />
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>
                      <button
                        type="button"
                        onClick={() => onView?.(t)}
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          color: "var(--accent-text, var(--accent))",
                          textDecoration: "underline",
                          cursor: "pointer",
                          fontWeight: 600,
                          fontSize: "14px",
                        }}
                        data-testid={`view-link-${t.id}`}
                      >
                        {t.displayName ?? "—"}
                      </button>
                    </td>
                    <td style={tdStyle}>{t.defaultDomain ?? "—"}</td>
                    <td
                      style={{
                        ...tdStyle,
                        fontFamily: "var(--font-mono, monospace)",
                        fontSize: "13px",
                      }}
                    >
                      {t.id}
                    </td>
                    <td style={{ ...tdStyle, textTransform: "capitalize" }}>{t.source}</td>
                    <td style={tdStyle}>
                      <CredentialBadge state={credState} expiresOn={t.credentialExpiresOn} />
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        fontVariantNumeric: "tabular-nums",
                        color: "var(--text-soft)",
                      }}
                    >
                      {t.lastRunAt ? new Date(t.lastRunAt).toLocaleDateString() : "Never"}
                    </td>
                    <td style={tdStyle}>
                      <span style={statusTagStyle(t.status)}>{t.status}</span>
                    </td>
                    <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>
                      {t.errorCount}
                    </td>
                    <td style={tdStyle}>
                      <button
                        type="button"
                        onClick={() => onView?.(t)}
                        style={actionBtnStyle}
                        data-testid={`action-view-${t.id}`}
                      >
                        View
                      </button>
                      <button
                        type="button"
                        onClick={() => onEdit?.(t)}
                        style={actionBtnStyle}
                        data-testid={`action-edit-${t.id}`}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onTestCredential?.(t)}
                        style={actionBtnStyle}
                        data-testid={`action-test-${t.id}`}
                      >
                        Test credential
                      </button>
                      <button
                        type="button"
                        onClick={() => onSetCredential?.(t)}
                        style={actionBtnStyle}
                        data-testid={`action-set-cred-${t.id}`}
                      >
                        Set credential
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleExclude?.(t)}
                        style={actionBtnStyle}
                        data-testid={`action-exclude-${t.id}`}
                      >
                        {t.status === "excluded" ? "Include" : "Exclude"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove?.(t)}
                        style={{ ...actionBtnStyle, color: "var(--danger)" }}
                        data-testid={`action-remove-${t.id}`}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* Card View for Mobile / Compact Screens */
        <div style={cardGridStyle} data-testid="tenant-card-view">
          {filteredTenants.map((t) => {
            const credState = t.credentialState ?? "missing";
            return (
              <div key={t.id} style={cardStyle} data-testid={`tenant-card-${t.id}`}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>
                      {t.displayName ?? t.id}
                    </h4>
                    <p style={{ margin: "4px 0 0", color: "var(--text-soft)", fontSize: "13px" }}>
                      {t.defaultDomain ?? "No primary domain"}
                    </p>
                  </div>
                  <span style={statusTagStyle(t.status)}>{t.status}</span>
                </div>

                <div style={{ fontSize: "13px", color: "var(--text-soft)", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div>
                    <span>ID: </span>
                    <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{t.id}</span>
                  </div>
                  <div>
                    <span>Source: </span>
                    <span style={{ textTransform: "capitalize", color: "var(--text)" }}>{t.source}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span>Credential: </span>
                    <CredentialBadge state={credState} expiresOn={t.credentialExpiresOn} />
                  </div>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "auto", paddingTop: "8px" }}>
                  <button type="button" onClick={() => onView?.(t)} style={actionBtnStyle}>
                    View
                  </button>
                  <button type="button" onClick={() => onEdit?.(t)} style={actionBtnStyle}>
                    Edit
                  </button>
                  <button type="button" onClick={() => onTestCredential?.(t)} style={actionBtnStyle}>
                    Test
                  </button>
                  <button type="button" onClick={() => onToggleExclude?.(t)} style={actionBtnStyle}>
                    {t.status === "excluded" ? "Include" : "Exclude"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
