"use client";

// Standard picker (EPIC-008 SPEC.md §3.2, T-0147; CIPP CippBaselineStandardDialog
// analogue). Search, category, impact filter, sort, and a card/list toggle; draws
// from the T-0144 catalog and flags licence-missing standards. Zero colour
// literals: report theme tokens only.

import React, { useMemo, useState, type CSSProperties, type ReactElement } from "react";
import {
  isLicenseMissing,
  standardImpact,
  type CatalogStandard,
} from "../../lib/standardsApi.js";

export interface StandardPickerProps {
  readonly items?: readonly CatalogStandard[];
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onAdd?: (selected: readonly CatalogStandard[]) => void;
  readonly onClose?: () => void;
}

type ViewMode = "list" | "card";
type SortKey = "name" | "category" | "impact";

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--overlay, rgba(0,0,0,0.5))",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px",
  zIndex: 50,
};

const dialogStyle: CSSProperties = {
  width: "100%",
  maxWidth: "820px",
  maxHeight: "85vh",
  display: "flex",
  flexDirection: "column",
  gap: "14px",
  padding: "20px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  boxShadow: "var(--shadow-card)",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
};

const barStyle: CSSProperties = {
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
};

const selectStyle: CSSProperties = { ...inputStyle, cursor: "pointer" };

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

const resultsStyle: CSSProperties = {
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  minHeight: "160px",
};

const cardGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
  gap: "8px",
};

const rowStyle = (selected: boolean): CSSProperties => ({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "10px",
  padding: "10px 12px",
  background: selected ? "var(--accent-soft)" : "var(--surface)",
  border: selected ? "1px solid var(--accent)" : "1px solid var(--border)",
  borderRadius: "6px",
  cursor: "pointer",
  textAlign: "left",
});

const badgeBaseStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 600,
};

function licenseBadgeStyle(): CSSProperties {
  return { ...badgeBaseStyle, background: "var(--warning-soft)", color: "var(--warning-text)", border: "1px solid var(--warning)" };
}

export function StandardPicker({
  items = [],
  loading = false,
  error = null,
  onAdd,
  onClose,
}: StandardPickerProps): ReactElement {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [impactFilter, setImpactFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) if (item.category) set.add(item.category);
    return [...set].sort();
  }, [items]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const result = items.filter((item) => {
      if (categoryFilter !== "all" && item.category !== categoryFilter) return false;
      if (impactFilter !== "all" && standardImpact(item) !== impactFilter) return false;
      if (query) {
        const haystack = `${item.name} ${item.check} ${item.category}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
    const rank = { high: 0, standard: 1, unknown: 2 } as const;
    return [...result].sort((left, right) => {
      if (sortKey === "category") return left.category.localeCompare(right.category) || left.name.localeCompare(right.name);
      if (sortKey === "impact") return rank[standardImpact(left)] - rank[standardImpact(right)] || left.name.localeCompare(right.name);
      return left.name.localeCompare(right.name);
    });
  }, [items, search, categoryFilter, impactFilter, sortKey]);

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = (): void => {
    const chosen = filtered.filter((item) => selected.has(item.id));
    onAdd?.(chosen);
    setSelected(new Set());
  };

  const renderItem = (item: CatalogStandard): ReactElement => (
    <button
      key={item.id}
      type="button"
      style={rowStyle(selected.has(item.id))}
      onClick={() => toggle(item.id)}
      data-testid={`picker-item-${item.check}`}
      aria-pressed={selected.has(item.id)}
    >
      <span>
        <strong>{item.name}</strong>
        <span style={{ display: "block", fontSize: "12px", color: "var(--text-soft)", fontFamily: "var(--font-mono, monospace)" }}>
          {item.check} · {item.category}
        </span>
      </span>
      {isLicenseMissing(item) && (
        <span style={licenseBadgeStyle()} data-testid={`picker-license-${item.check}`}>
          license missing
        </span>
      )}
    </button>
  );

  return (
    <div style={overlayStyle} data-testid="standard-picker">
      <div style={dialogStyle} role="dialog" aria-modal="true" aria-label="Add standards">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: "16px" }}>Add standards</h2>
          <button type="button" style={buttonStyle} onClick={onClose} data-testid="picker-close">
            Close
          </button>
        </div>

        <div style={barStyle}>
          <input
            type="text"
            placeholder="Search standards..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, flex: "1 1 200px" }}
            aria-label="Search standards"
            data-testid="picker-search"
          />
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={selectStyle} aria-label="Category" data-testid="picker-category">
            <option value="all">All categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
          <select value={impactFilter} onChange={(e) => setImpactFilter(e.target.value)} style={selectStyle} aria-label="Impact" data-testid="picker-impact">
            <option value="all">All impact</option>
            <option value="high">High</option>
            <option value="standard">Standard</option>
            <option value="unknown">Unknown</option>
          </select>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} style={selectStyle} aria-label="Sort" data-testid="picker-sort">
            <option value="name">Sort: name</option>
            <option value="category">Sort: category</option>
            <option value="impact">Sort: impact</option>
          </select>
          <button
            type="button"
            style={buttonStyle}
            onClick={() => setViewMode((v) => (v === "list" ? "card" : "list"))}
            data-testid="picker-view-toggle"
          >
            {viewMode === "list" ? "Card view" : "List view"}
          </button>
        </div>

        {loading && <div style={{ color: "var(--text-soft)" }}>Loading catalog...</div>}
        {error && (
          <div style={{ padding: "10px", background: "var(--danger-soft)", border: "1px solid var(--danger)", borderRadius: "6px", color: "var(--danger-text)" }} role="alert">
            {error}
          </div>
        )}

        {!loading && !error && (
          <div
            style={viewMode === "card" ? { ...resultsStyle, ...cardGridStyle } : resultsStyle}
            data-testid={`picker-results-${viewMode}`}
          >
            {filtered.length === 0 && (
              <div style={{ color: "var(--text-soft)", padding: "16px" }} data-testid="picker-empty">
                No standards match.
              </div>
            )}
            {filtered.map(renderItem)}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button type="button" style={buttonStyle} onClick={onClose} data-testid="picker-cancel">
            Cancel
          </button>
          <button
            type="button"
            style={primaryButtonStyle}
            disabled={selected.size === 0}
            onClick={handleAdd}
            data-testid="picker-add"
          >
            Add {selected.size > 0 ? `(${selected.size})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
