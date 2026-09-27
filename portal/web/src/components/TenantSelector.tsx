"use client";

// Tenant selector header component (EPIC-004 SPEC.md §6, 99-reference/cipp-ui-patterns.md §1, T-0067).
// Dropdown with current-tenant persistence, recent tenants, favorite tenants, and RBAC scope filtering.
// Strictly uses report theme tokens with zero colour literals.

import React, {
  useState,
  useMemo,
  useEffect,
  useCallback,
  useRef,
  type CSSProperties,
  type ReactElement,
} from "react";
import {
  getCurrentTenantId,
  setCurrentTenantId,
  getRecentTenantIds,
  getFavoriteTenantIds,
  toggleFavoriteTenantId,
  onTenantChange as subscribeTenantChange,
} from "../lib/tenant-preference";

export interface TenantItem {
  readonly id: string;
  readonly displayName: string | null;
  readonly defaultDomain?: string | null;
  readonly initialDomain?: string | null;
  readonly status?: string;
}

export interface TenantSelectorProps {
  /** All available tenants */
  readonly tenants?: readonly TenantItem[];
  /** Caller's RBAC scope: if provided, only these tenants may be shown or selected */
  readonly allowedTenantIds?: readonly string[];
  /** Controlled current tenant ID */
  readonly selectedTenantId?: string | null;
  /** Selection change callback */
  readonly onTenantChange?: (tenantId: string | null) => void;
  /** Whether to offer the "All Tenants (Fleet View)" option (default: true) */
  readonly showFleetOption?: boolean;
  /** Label for fleet option (default: "All Tenants (Fleet View)") */
  readonly fleetOptionLabel?: string;
  /** Custom class name */
  readonly className?: string;
  /** Custom style */
  readonly style?: CSSProperties;
}

export function TenantSelector(props: TenantSelectorProps): ReactElement {
  const {
    tenants = [],
    allowedTenantIds,
    selectedTenantId: controlledTenantId,
    onTenantChange: externalOnChange,
    showFleetOption = true,
    fleetOptionLabel = "All Tenants (Fleet View)",
    className,
    style,
  } = props;

  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [internalTenantId, setInternalTenantId] = useState<string | null>(() => getCurrentTenantId());
  const [recentIds, setRecentIds] = useState<string[]>(() => getRecentTenantIds());
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => getFavoriteTenantIds());

  const containerRef = useRef<HTMLDivElement>(null);

  // Sync internal tenant state if controlledTenantId changes
  const activeTenantId = controlledTenantId !== undefined ? controlledTenantId : internalTenantId;

  // Listen to cross-component tenant changes
  useEffect(() => {
    const unsubscribe = subscribeTenantChange((newTenantId) => {
      if (controlledTenantId === undefined) {
        setInternalTenantId(newTenantId);
      }
      setRecentIds(getRecentTenantIds());
    });
    return unsubscribe;
  }, [controlledTenantId]);

  // Click outside and Escape key listener
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Filter tenants by caller's RBAC scope
  const scopedTenants = useMemo(() => {
    if (!allowedTenantIds) return tenants;
    const allowed = new Set(allowedTenantIds);
    return tenants.filter((t) => allowed.has(t.id));
  }, [tenants, allowedTenantIds]);

  const activeTenant = useMemo(() => {
    if (!activeTenantId) return null;
    return scopedTenants.find((t) => t.id === activeTenantId) ?? null;
  }, [activeTenantId, scopedTenants]);

  // Filtered tenants by search query
  const filteredTenants = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return scopedTenants;
    return scopedTenants.filter(
      (t) =>
        t.id.toLowerCase().includes(q) ||
        (t.displayName ?? "").toLowerCase().includes(q) ||
        (t.defaultDomain ?? "").toLowerCase().includes(q),
    );
  }, [scopedTenants, search]);

  // Scoped favorites & recents
  const favoriteTenants = useMemo(() => {
    const favSet = new Set(favoriteIds);
    return scopedTenants.filter((t) => favSet.has(t.id));
  }, [scopedTenants, favoriteIds]);

  const recentTenants = useMemo(() => {
    const tenantMap = new Map(scopedTenants.map((t) => [t.id, t]));
    return recentIds
      .map((id) => tenantMap.get(id))
      .filter((t): t is TenantItem => Boolean(t))
      .filter((t) => t.id !== activeTenantId);
  }, [scopedTenants, recentIds, activeTenantId]);

  const handleSelectTenant = useCallback(
    (tenantId: string | null) => {
      if (controlledTenantId === undefined) {
        setInternalTenantId(tenantId);
      }
      setCurrentTenantId(tenantId);
      setRecentIds(getRecentTenantIds());
      externalOnChange?.(tenantId);
      setIsOpen(false);
      setSearch("");
    },
    [controlledTenantId, externalOnChange],
  );

  const handleToggleFavorite = (tenantId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavoriteTenantId(tenantId);
    setFavoriteIds(getFavoriteTenantIds());
  };

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", display: "inline-block", ...style }}
      className={className}
      data-testid="tenant-selector-container"
    >
      {/* Header Selector Trigger Button */}
      <button
        type="button"
        data-testid="tenant-selector-trigger"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          padding: "6px 14px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius, 6px)",
          color: "var(--text)",
          fontSize: "13px",
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "var(--font-sans, system-ui, sans-serif)",
          boxShadow: "var(--shadow-card)",
          transition: "border-color 0.15s ease",
        }}
      >
        <span
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: activeTenant ? "var(--success)" : "var(--accent)",
          }}
        />
        <span
          data-testid="tenant-selector-current-label"
          style={{ maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {activeTenant ? activeTenant.displayName || activeTenant.defaultDomain || activeTenant.id : fleetOptionLabel}
        </span>
        <span style={{ fontSize: "10px", color: "var(--muted)", marginLeft: "4px" }}>▼</span>
      </button>

      {/* Popover Dropdown Menu */}
      {isOpen && (
        <div
          data-testid="tenant-selector-dropdown"
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 1000,
            width: "320px",
            maxHeight: "420px",
            overflowY: "auto",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius, 8px)",
            boxShadow: "var(--shadow-card)",
            padding: "8px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            fontFamily: "var(--font-sans, system-ui, sans-serif)",
          }}
        >
          {/* Search Input */}
          <input
            type="text"
            data-testid="tenant-selector-search"
            placeholder="Search tenants in scope..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
            style={{
              padding: "7px 10px",
              background: "var(--input-bg, var(--bg))",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius, 6px)",
              color: "var(--text)",
              fontSize: "13px",
              width: "100%",
              boxSizing: "border-box",
            }}
          />

          {/* Fleet Option */}
          {showFleetOption && !search && (
            <div
              data-testid="tenant-option-fleet"
              onClick={() => handleSelectTenant(null)}
              role="option"
              aria-selected={activeTenantId === null}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 10px",
                borderRadius: "var(--radius, 6px)",
                cursor: "pointer",
                background: activeTenantId === null ? "var(--accent-soft)" : "transparent",
                color: activeTenantId === null ? "var(--accent-text)" : "var(--text)",
                fontWeight: activeTenantId === null ? 600 : 500,
                fontSize: "13px",
              }}
            >
              <span>{fleetOptionLabel}</span>
              {activeTenantId === null && <span style={{ fontSize: "12px" }}>✓</span>}
            </div>
          )}

          {/* Favorites Section */}
          {!search && favoriteTenants.length > 0 && (
            <div data-testid="tenant-selector-favorites" style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "var(--muted)",
                  padding: "4px 8px 2px",
                }}
              >
                ★ Favorites
              </div>
              {favoriteTenants.map((t) => (
                <TenantRow
                  key={`fav-${t.id}`}
                  tenant={t}
                  isActive={activeTenantId === t.id}
                  isFavorite={true}
                  onSelect={() => handleSelectTenant(t.id)}
                  onToggleFavorite={(e) => handleToggleFavorite(t.id, e)}
                  testId={`favorite-tenant-${t.id}`}
                />
              ))}
            </div>
          )}

          {/* Recent Tenants Section */}
          {!search && recentTenants.length > 0 && (
            <div data-testid="tenant-selector-recents" style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "var(--muted)",
                  padding: "4px 8px 2px",
                }}
              >
                Recent
              </div>
              {recentTenants.map((t) => (
                <TenantRow
                  key={`recent-${t.id}`}
                  tenant={t}
                  isActive={activeTenantId === t.id}
                  isFavorite={favoriteIds.includes(t.id)}
                  onSelect={() => handleSelectTenant(t.id)}
                  onToggleFavorite={(e) => handleToggleFavorite(t.id, e)}
                  testId={`recent-tenant-${t.id}`}
                />
              ))}
            </div>
          )}

          {/* All Scoped Tenants Section */}
          <div data-testid="tenant-selector-all" style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--muted)",
                padding: "4px 8px 2px",
              }}
            >
              All Tenants ({filteredTenants.length})
            </div>

            {filteredTenants.length === 0 ? (
              <div
                style={{
                  padding: "16px 8px",
                  textAlign: "center",
                  fontSize: "12px",
                  color: "var(--muted)",
                }}
              >
                No tenants found in your scope.
              </div>
            ) : (
              filteredTenants.map((t) => (
                <TenantRow
                  key={t.id}
                  tenant={t}
                  isActive={activeTenantId === t.id}
                  isFavorite={favoriteIds.includes(t.id)}
                  onSelect={() => handleSelectTenant(t.id)}
                  onToggleFavorite={(e) => handleToggleFavorite(t.id, e)}
                  testId={`tenant-item-${t.id}`}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface TenantRowProps {
  readonly tenant: TenantItem;
  readonly isActive: boolean;
  readonly isFavorite: boolean;
  readonly onSelect: () => void;
  readonly onToggleFavorite: (e: React.MouseEvent) => void;
  readonly testId: string;
}

function TenantRow({
  tenant,
  isActive,
  isFavorite,
  onSelect,
  onToggleFavorite,
  testId,
}: TenantRowProps): ReactElement {
  return (
    <div
      data-testid={testId}
      onClick={onSelect}
      role="option"
      aria-selected={isActive}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "6px 8px",
        borderRadius: "var(--radius, 6px)",
        cursor: "pointer",
        background: isActive ? "var(--accent-soft)" : "transparent",
        color: isActive ? "var(--accent-text)" : "var(--text)",
        fontSize: "13px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", paddingRight: "8px" }}>
        <span style={{ fontWeight: 600, textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
          {tenant.displayName || tenant.id}
        </span>
        {tenant.defaultDomain && (
          <span style={{ fontSize: "11px", color: "var(--muted)" }}>{tenant.defaultDomain}</span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
        {isActive && <span style={{ fontSize: "12px" }}>✓</span>}
        <button
          type="button"
          data-testid={`toggle-fav-${tenant.id}`}
          onClick={onToggleFavorite}
          aria-label={isFavorite ? `Remove ${tenant.id} from favorites` : `Add ${tenant.id} to favorites`}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            fontSize: "14px",
            padding: "2px 4px",
            color: isFavorite ? "var(--warn)" : "var(--muted)",
          }}
        >
          {isFavorite ? "★" : "☆"}
        </button>
      </div>
    </div>
  );
}
