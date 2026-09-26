"use client";

// IntunePolicyTable — Shared table component for Intune policy list pages (EPIC-016 SPEC.md §3.1; T-0303).
// Columns: Name · Platform · Type · Assigned to · Last modified · Modified by.
// Filters: platform, type, assigned, modified date, search. Filters are sent to the list API
// and also applied to the loaded rows, so the table is correct whichever side narrows.
// Row actions: View, Edit, Clone, Assign, Compare, Export, Delete.
// Off-canvas detail: settings and assignments; Clone to template action.
import React, { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  createIntuneTemplate,
  deleteIntunePolicy,
  exportIntunePolicyJson,
  fetchIntunePolicies,
  IntuneApiError,
  templateInputFromPolicy,
  type IntunePolicyItem,
  type IntunePoliciesFilter,
  type IntunePolicyKind,
} from "../../lib/intuneApi";
import { IntunePolicyDetailDrawer } from "./IntunePolicyDetailDrawer";

export type IntunePolicyRowAction =
  | "view"
  | "edit"
  | "clone"
  | "assign"
  | "compare"
  | "export"
  | "delete"
  /** Detail-drawer action: save the policy as an Intune template (§3.2). */
  | "cloneToTemplate";

export interface IntunePolicyTableProps {
  readonly kind: IntunePolicyKind;
  readonly tenantId?: string;
  readonly policies?: readonly IntunePolicyItem[];
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly filter?: IntunePoliciesFilter;
  readonly onFilterChange?: (filter: IntunePoliciesFilter) => void;
  readonly onAction?: (action: IntunePolicyRowAction, policy: IntunePolicyItem) => void;
  readonly onCreatePolicy?: () => void;
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  width: "100%",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text, #111827)",
};

const headerBarStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "16px",
  background: "var(--bg-elev, #f9fafb)",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "8px",
};

const filterBarStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
  padding: "12px 16px",
  background: "var(--bg-elev, #f9fafb)",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "8px",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "14px",
  background: "var(--bg, #ffffff)",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "8px",
  overflow: "hidden",
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "10px 14px",
  background: "var(--bg-elev, #f3f4f6)",
  fontWeight: 600,
  fontSize: "12px",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--text-muted, #6b7280)",
  borderBottom: "1px solid var(--border, #e5e7eb)",
};

const tdStyle: CSSProperties = {
  padding: "10px 14px",
  borderBottom: "1px solid var(--border, #e5e7eb)",
  verticalAlign: "middle",
};

const actionBtnStyle: CSSProperties = {
  padding: "3px 8px",
  fontSize: "12px",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "4px",
  background: "var(--bg, #ffffff)",
  cursor: "pointer",
  color: "var(--text, #111827)",
  marginRight: "4px",
};

const inputStyle: CSSProperties = {
  padding: "6px 10px",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "6px",
  fontSize: "13px",
  background: "var(--bg, #ffffff)",
  color: "var(--text, #111827)",
};

const createBtnStyle: CSSProperties = {
  padding: "8px 16px",
  background: "var(--accent, #2563eb)",
  color: "#ffffff",
  border: "none",
  borderRadius: "6px",
  cursor: "pointer",
  fontSize: "13px",
  fontWeight: 600,
};

const badgeStyle = (assigned: boolean): CSSProperties => ({
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: "9999px",
  fontSize: "12px",
  fontWeight: 600,
  background: assigned ? "var(--accent-light, #dbeafe)" : "var(--bg-elev, #f3f4f6)",
  color: assigned ? "var(--accent, #2563eb)" : "var(--text-muted, #6b7280)",
});

const KIND_LABELS: Record<string, string> = {
  configuration: "Configuration Policies",
  compliance: "Compliance Policies",
  "app-protection": "App Protection Policies",
};

const ROW_ACTIONS: readonly { readonly action: IntunePolicyRowAction; readonly label: string }[] = [
  { action: "view", label: "View" },
  { action: "edit", label: "Edit" },
  { action: "clone", label: "Clone" },
  { action: "assign", label: "Assign" },
  { action: "compare", label: "Compare" },
  { action: "export", label: "Export" },
  { action: "delete", label: "Delete" },
];

/** Client-side application of the §3.1 filters to already-loaded rows. */
export function filterIntunePolicies(
  policies: readonly IntunePolicyItem[],
  filter: IntunePoliciesFilter,
): IntunePolicyItem[] {
  const search = filter.search?.trim().toLowerCase();
  const since = filter.modifiedDate ? Date.parse(filter.modifiedDate) : NaN;
  return policies.filter((p) => {
    if (filter.platform && p.platform.toLowerCase() !== filter.platform.toLowerCase()) return false;
    if (filter.policyType && p.policyType !== filter.policyType) return false;
    if (filter.assigned !== undefined && p.assignedToCount > 0 !== filter.assigned) return false;
    if (!Number.isNaN(since)) {
      const modified = p.lastModifiedDateTime ? Date.parse(p.lastModifiedDateTime) : NaN;
      if (Number.isNaN(modified) || modified < since) return false;
    }
    if (search && !`${p.displayName} ${p.name}`.toLowerCase().includes(search)) return false;
    return true;
  });
}

function formatDate(dt: string | null | undefined): string {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dt;
  }
}

export function IntunePolicyTable({
  kind,
  tenantId,
  policies = [],
  loading = false,
  error = null,
  filter = {},
  onFilterChange,
  onAction,
  onCreatePolicy,
}: IntunePolicyTableProps) {
  const [detailPolicy, setDetailPolicy] = useState<IntunePolicyItem | null>(null);
  const [search, setSearch] = useState(filter.search ?? "");
  const [platformFilter, setPlatformFilter] = useState(filter.platform ?? "");
  const [assignedFilter, setAssignedFilter] = useState<string>(
    filter.assigned !== undefined ? (filter.assigned ? "yes" : "no") : "",
  );

  const [typeFilter, setTypeFilter] = useState(filter.policyType ?? "");
  const [modifiedFilter, setModifiedFilter] = useState(filter.modifiedDate ?? "");

  const pageTitle = KIND_LABELS[kind] ?? `${kind} Policies`;
  const typeOptions = useMemo(
    () => Array.from(new Set(policies.map((p) => p.policyType).filter(Boolean))).sort(),
    [policies],
  );
  const visiblePolicies = useMemo(
    () =>
      filterIntunePolicies(policies, {
        search: search || undefined,
        platform: platformFilter || undefined,
        policyType: typeFilter || undefined,
        assigned: assignedFilter === "yes" ? true : assignedFilter === "no" ? false : undefined,
        modifiedDate: modifiedFilter || undefined,
      }),
    [policies, search, platformFilter, typeFilter, assignedFilter, modifiedFilter],
  );

  function applyFilter(patch: Partial<IntunePoliciesFilter>) {
    onFilterChange?.({ ...filter, ...patch });
  }

  function handleSearch(value: string) {
    setSearch(value);
    applyFilter({ search: value || undefined });
  }

  function handlePlatformFilter(value: string) {
    setPlatformFilter(value);
    applyFilter({ platform: value || undefined });
  }

  function handleAssignedFilter(value: string) {
    setAssignedFilter(value);
    applyFilter({
      assigned: value === "yes" ? true : value === "no" ? false : undefined,
    });
  }

  function handleTypeFilter(value: string) {
    setTypeFilter(value);
    applyFilter({ policyType: value || undefined });
  }

  function handleModifiedFilter(value: string) {
    setModifiedFilter(value);
    applyFilter({ modifiedDate: value || undefined });
  }

  function handleRowAction(action: IntunePolicyRowAction, policy: IntunePolicyItem) {
    if (action === "view") {
      setDetailPolicy(policy);
    } else {
      onAction?.(action, policy);
    }
  }

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerBarStyle}>
        <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>{pageTitle}</h2>
        {onCreatePolicy && (
          <button style={createBtnStyle} onClick={onCreatePolicy}>
            + New Policy
          </button>
        )}
      </div>

      {/* Filters */}
      <div style={filterBarStyle}>
        <input
          style={inputStyle}
          type="search"
          placeholder="Search policies…"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          aria-label="Search policies"
        />
        <select
          style={inputStyle}
          value={platformFilter}
          onChange={(e) => handlePlatformFilter(e.target.value)}
          aria-label="Filter by platform"
        >
          <option value="">All platforms</option>
          <option value="windows">Windows</option>
          <option value="android">Android</option>
          <option value="ios">iOS</option>
          <option value="macos">macOS</option>
        </select>
        <select
          style={inputStyle}
          value={typeFilter}
          onChange={(e) => handleTypeFilter(e.target.value)}
          aria-label="Filter by type"
        >
          <option value="">All types</option>
          {typeOptions.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          style={inputStyle}
          value={assignedFilter}
          onChange={(e) => handleAssignedFilter(e.target.value)}
          aria-label="Filter by assignment"
        >
          <option value="">All</option>
          <option value="yes">Assigned</option>
          <option value="no">Unassigned</option>
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
          Modified since
          <input
            style={inputStyle}
            type="date"
            value={modifiedFilter}
            onChange={(e) => handleModifiedFilter(e.target.value)}
            aria-label="Filter by modified date"
          />
        </label>
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          style={{
            padding: "12px 16px",
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: "8px",
            color: "#b91c1c",
          }}
        >
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ padding: "24px", textAlign: "center", color: "var(--text-muted, #6b7280)" }}>
          Loading {pageTitle.toLowerCase()}…
        </div>
      )}

      {/* Table */}
      {!loading && !error && (
        <table style={tableStyle} aria-label={pageTitle}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Platform</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Assigned to</th>
              <th style={thStyle}>Last modified</th>
              <th style={thStyle}>Modified by</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visiblePolicies.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  style={{ ...tdStyle, textAlign: "center", color: "var(--text-muted, #6b7280)" }}
                >
                  No {pageTitle.toLowerCase()} found.
                </td>
              </tr>
            ) : (
              visiblePolicies.map((policy) => (
                <tr key={policy.id} data-testid={`row-${policy.id}`}>
                  <td style={tdStyle}>
                    <button
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--accent, #2563eb)",
                        fontWeight: 500,
                        padding: 0,
                        fontSize: "14px",
                      }}
                      onClick={() => handleRowAction("view", policy)}
                    >
                      {policy.displayName || policy.name}
                    </button>
                  </td>
                  <td style={tdStyle}>{policy.platform}</td>
                  <td style={tdStyle}>{policy.policyType}</td>
                  <td style={tdStyle}>
                    <span style={badgeStyle(policy.assignedToCount > 0)}>
                      {policy.assignedToCount > 0 ? `${policy.assignedToCount} group(s)` : "Unassigned"}
                    </span>
                  </td>
                  <td style={tdStyle}>{formatDate(policy.lastModifiedDateTime)}</td>
                  <td style={tdStyle}>{policy.modifiedBy ?? "—"}</td>
                  <td style={tdStyle}>
                    {ROW_ACTIONS.map(({ action, label }) => (
                      <button
                        key={action}
                        style={
                          action === "delete"
                            ? { ...actionBtnStyle, color: "var(--danger, #dc2626)" }
                            : actionBtnStyle
                        }
                        onClick={() => handleRowAction(action, policy)}
                        aria-label={`${label} ${policy.displayName || policy.name}`}
                      >
                        {label}
                      </button>
                    ))}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}

      {/* Detail drawer */}
      {detailPolicy && (
        <IntunePolicyDetailDrawer
          policy={detailPolicy}
          tenantId={tenantId}
          onClose={() => setDetailPolicy(null)}
          onAction={(action) => {
            onAction?.(action, detailPolicy);
            setDetailPolicy(null);
          }}
        />
      )}
    </div>
  );
}

function downloadJson(fileName: string, json: string) {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Page body shared by the three §3.1 list pages: loads `kind` for `tenantId` and
 * wires the row actions; the page supplies `navigate` (Next's router.push). Edit/Clone/Assign route to the T-0304
 * editor, Compare to T-0310, Clone to template posts to the T-0305 template API.
 */
export interface IntunePolicyListPageProps {
  readonly kind: IntunePolicyKind;
  readonly tenantId: string;
  readonly navigate: (href: string) => void;
}

export function IntunePolicyListPage({ kind, tenantId, navigate }: IntunePolicyListPageProps) {
  const [policies, setPolicies] = useState<readonly IntunePolicyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<IntunePoliciesFilter>({});

  const load = useCallback(async () => {
    if (!tenantId) {
      setError("No tenant selected.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const page = await fetchIntunePolicies(tenantId, kind, filter);
      setPolicies(page.items);
    } catch (err: unknown) {
      setPolicies([]);
      if (err instanceof IntuneApiError && err.status === 501) {
        setError(`${KIND_LABELS[kind] ?? kind} are not yet supported in v1. ${err.message}`);
      } else {
        setError(err instanceof Error ? err.message : "Failed to load policies.");
      }
    } finally {
      setLoading(false);
    }
  }, [tenantId, kind, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const tenantQuery = `tenantId=${encodeURIComponent(tenantId)}`;
  const policyPath = (policy: IntunePolicyItem) =>
    `/intune/policies/${kind}/${encodeURIComponent(policy.id)}`;

  async function handleAction(action: IntunePolicyRowAction, policy: IntunePolicyItem) {
    setNotice(null);
    const name = policy.displayName || policy.name;
    switch (action) {
      case "edit":
        navigate(`${policyPath(policy)}?${tenantQuery}`);
        return;
      case "assign":
        navigate(`${policyPath(policy)}?${tenantQuery}&section=assignments`);
        return;
      case "clone":
        navigate(
          `/intune/policies/${kind}/new?${tenantQuery}&cloneFrom=${encodeURIComponent(policy.id)}`,
        );
        return;
      case "compare":
        navigate(
          `/intune/policies/compare?${tenantQuery}&kind=${kind}&left=${encodeURIComponent(policy.id)}`,
        );
        return;
      case "export":
        downloadJson(`${name.replace(/[^\w.-]+/g, "_")}.json`, exportIntunePolicyJson(policy));
        return;
      case "cloneToTemplate": {
        const input = templateInputFromPolicy(policy, kind);
        if (!input) {
          setNotice(`Templates support Windows configuration and compliance policies only in v1.`);
          return;
        }
        try {
          const template = await createIntuneTemplate(input);
          setNotice(`Saved '${template.name}' as a policy template.`);
        } catch (err: unknown) {
          setNotice(err instanceof Error ? err.message : "Failed to create template.");
        }
        return;
      }
      case "delete": {
        const confirmName = window.prompt(`Type the policy name '${name}' to confirm deletion:`);
        if (!confirmName) return;
        try {
          await deleteIntunePolicy(tenantId, kind, policy.id, confirmName);
          await load();
        } catch (err: unknown) {
          setNotice(err instanceof Error ? err.message : "Failed to delete policy.");
        }
        return;
      }
      default:
        return;
    }
  }

  return (
    <main style={{ padding: "24px", maxWidth: "1280px", margin: "0 auto" }}>
      {notice && (
        <div
          role="status"
          style={{
            marginBottom: "16px",
            padding: "12px 16px",
            background: "var(--bg-elev, #f9fafb)",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: "8px",
          }}
        >
          {notice}
        </div>
      )}
      <IntunePolicyTable
        kind={kind}
        tenantId={tenantId}
        policies={policies}
        loading={loading}
        error={error}
        filter={filter}
        onFilterChange={setFilter}
        onAction={(action, policy) => void handleAction(action, policy)}
        onCreatePolicy={() => navigate(`/intune/policies/${kind}/new?${tenantQuery}`)}
      />
    </main>
  );
}
