"use client";

// CustomDashboard canvas component (EPIC-004 SPEC.md §3.4, §4.3, §11.2, T-0068).
// Consumes GET /v1/dashboard/widgets (RBAC-filtered) and layout from GET/PUT /v1/dashboard/layout.
// Supports add, remove, reorder, and grid resize with optimistic updates and revert on failure.
// Strictly uses report theme tokens with zero colour literals.

import React, { useState, useEffect, useCallback, type CSSProperties, type ReactElement } from "react";
import { WidgetPicker, type StockWidgetDefinition } from "./WidgetPicker";

export interface DashboardWidgetSize {
  readonly width: number;
  readonly height: number;
}

export interface DashboardWidgetPlacement {
  readonly id: string;
  readonly position: number;
  readonly size: DashboardWidgetSize;
  readonly settings: Record<string, unknown>;
}

export interface DashboardLayout {
  readonly id: string;
  readonly userId: string;
  readonly scope: "global" | "tenant";
  readonly tenantId: string | null;
  readonly widgets: DashboardWidgetPlacement[];
  readonly isDefault: boolean;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface CustomDashboardProps {
  /** Optional tenant context for tenant-scoped layout */
  readonly tenantId?: string | null;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export function CustomDashboard(props: CustomDashboardProps): ReactElement {
  const { tenantId = null, className, style } = props;

  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [availableWidgets, setAvailableWidgets] = useState<StockWidgetDefinition[]>([]);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load available widgets and initial layout
  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      // 1. Available stock widgets (RBAC-filtered by BFF)
      const widgetsRes = await fetch("/v1/dashboard/widgets");
      if (widgetsRes.ok) {
        const widgetsData = await widgetsRes.json();
        setAvailableWidgets(widgetsData.widgets ?? []);
      }

      // 2. Dashboard layout for user and tenant
      const url = tenantId
        ? `/v1/dashboard/layout?tenantId=${encodeURIComponent(tenantId)}`
        : "/v1/dashboard/layout";
      const layoutRes = await fetch(url);
      if (layoutRes.ok) {
        const layoutData = await layoutRes.json();
        setLayout(layoutData.layout);
      } else {
        throw new Error(`Failed to load layout: ${layoutRes.statusText}`);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Persist updated widgets to layout endpoint with optimistic revert on error
  const persistWidgets = async (
    nextWidgets: DashboardWidgetPlacement[],
    prevLayout: DashboardLayout,
  ) => {
    setSaving(true);
    setSaveStatus("saving");
    setErrorMessage(null);

    const url = tenantId
      ? `/v1/dashboard/layout?tenantId=${encodeURIComponent(tenantId)}`
      : "/v1/dashboard/layout";

    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: tenantId ?? undefined,
          widgets: nextWidgets,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.message ?? `Failed to save layout: ${res.statusText}`);
      }

      const resData = await res.json();
      setLayout(resData.layout);
      setSaveStatus("saved");
    } catch (err) {
      // Revert optimistic update
      setLayout(prevLayout);
      setSaveStatus("error");
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  // Add widget
  const handleAddWidget = (widgetDef: StockWidgetDefinition) => {
    if (!layout) return;
    const prev = layout;
    const newPlacement: DashboardWidgetPlacement = {
      id: widgetDef.id,
      position: layout.widgets.length,
      size: { ...widgetDef.defaultSize },
      settings: {},
    };
    const nextWidgets = [...layout.widgets, newPlacement];
    setLayout({ ...layout, widgets: nextWidgets, isDefault: false });
    void persistWidgets(nextWidgets, prev);
  };

  // Remove widget
  const handleRemoveWidget = (widgetId: string) => {
    if (!layout) return;
    const prev = layout;
    const nextWidgets = layout.widgets
      .filter((w) => w.id !== widgetId)
      .map((w, idx) => ({ ...w, position: idx }));
    setLayout({ ...layout, widgets: nextWidgets, isDefault: false });
    void persistWidgets(nextWidgets, prev);
  };

  // Reorder widget (up/down)
  const handleMoveWidget = (widgetId: string, direction: "up" | "down") => {
    if (!layout) return;
    const prev = layout;
    const idx = layout.widgets.findIndex((w) => w.id === widgetId);
    if (idx < 0) return;
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= layout.widgets.length) return;

    const copy = [...layout.widgets];
    const [item] = copy.splice(idx, 1);
    copy.splice(targetIdx, 0, item);

    const nextWidgets = copy.map((w, index) => ({ ...w, position: index }));
    setLayout({ ...layout, widgets: nextWidgets, isDefault: false });
    void persistWidgets(nextWidgets, prev);
  };

  // Resize widget column span
  const handleResizeWidget = (widgetId: string, newWidth: number) => {
    if (!layout) return;
    const prev = layout;
    const nextWidgets = layout.widgets.map((w) => {
      if (w.id === widgetId) {
        return { ...w, size: { ...w.size, width: newWidth } };
      }
      return w;
    });
    setLayout({ ...layout, widgets: nextWidgets, isDefault: false });
    void persistWidgets(nextWidgets, prev);
  };

  // Reset to default stock layout
  const handleResetToDefault = async () => {
    if (!layout) return;
    setSaving(true);
    setSaveStatus("saving");
    setErrorMessage(null);

    const url = tenantId
      ? `/v1/dashboard/layout?tenantId=${encodeURIComponent(tenantId)}`
      : "/v1/dashboard/layout";

    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true, tenantId: tenantId ?? undefined }),
      });

      if (!res.ok) {
        throw new Error(`Failed to reset layout: ${res.statusText}`);
      }

      const resData = await res.json();
      setLayout(resData.layout);
      setSaveStatus("saved");
    } catch (err) {
      setSaveStatus("error");
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div
        data-testid="custom-dashboard-loading"
        style={{ padding: "64px 0", textAlign: "center", color: "var(--muted)" }}
      >
        Loading custom dashboard canvas...
      </div>
    );
  }

  const activeWidgetIds = layout?.widgets.map((w) => w.id) ?? [];
  const widgetsList = [...(layout?.widgets ?? [])].sort((a, b) => a.position - b.position);

  return (
    <div
      data-testid="custom-dashboard-container"
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        width: "100%",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        color: "var(--text)",
        ...style,
      }}
    >
      {/* Top Toolbar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius, 8px)",
          padding: "12px 16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontWeight: 600, fontSize: "14px" }}>
            {tenantId ? `Tenant Layout: ${tenantId}` : "Global Default Layout"}
          </span>
          {layout?.isDefault && (
            <span
              data-testid="layout-default-badge"
              style={{
                fontSize: "11px",
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: "999px",
                background: "var(--subtle)",
                color: "var(--muted)",
                border: "1px solid var(--border)",
              }}
            >
              Default Layout
            </span>
          )}
          {saveStatus === "saving" && (
            <span data-testid="save-status-saving" style={{ fontSize: "12px", color: "var(--accent-text)" }}>
              Saving...
            </span>
          )}
          {saveStatus === "saved" && (
            <span data-testid="save-status-saved" style={{ fontSize: "12px", color: "var(--success-text)" }}>
              ✓ Saved
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button
            type="button"
            data-testid="reset-layout-btn"
            disabled={saving}
            onClick={handleResetToDefault}
            style={{
              padding: "6px 12px",
              fontSize: "12px",
              fontWeight: 500,
              background: "transparent",
              color: "var(--text-soft)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius, 6px)",
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            Reset to Default
          </button>

          <button
            type="button"
            data-testid="open-widget-picker-btn"
            onClick={() => setIsPickerOpen(true)}
            style={{
              padding: "6px 14px",
              fontSize: "12px",
              fontWeight: 600,
              background: "var(--accent)",
              color: "var(--on-accent)",
              border: "1px solid var(--accent)",
              borderRadius: "var(--radius, 6px)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            + Add Widget
          </button>
        </div>
      </div>

      {/* Error alert if any */}
      {errorMessage && (
        <div
          data-testid="custom-dashboard-error"
          style={{
            padding: "12px 16px",
            borderRadius: "var(--radius, 6px)",
            background: "var(--danger-soft)",
            border: "1px solid var(--danger)",
            color: "var(--danger-text)",
            fontSize: "13px",
          }}
        >
          {errorMessage}
        </div>
      )}

      {/* Widgets Canvas Grid */}
      <div
        data-testid="custom-widgets-canvas"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
          gap: "20px",
          width: "100%",
        }}
      >
        {widgetsList.length === 0 ? (
          <div
            data-testid="canvas-empty-state"
            style={{
              gridColumn: "span 12",
              padding: "64px 24px",
              textAlign: "center",
              background: "var(--surface)",
              border: "1px dashed var(--border)",
              borderRadius: "var(--radius, 10px)",
              color: "var(--muted)",
              fontSize: "14px",
            }}
          >
            No widgets in your custom canvas. Click "+ Add Widget" to build your view.
          </div>
        ) : (
          widgetsList.map((placement, index) => {
            const widgetDef = availableWidgets.find((w) => w.id === placement.id);
            const widgetName = widgetDef?.name ?? placement.id;
            const colSpan = placement.size.width || 12;

            return (
              <div
                key={placement.id}
                data-testid={`canvas-widget-${placement.id}`}
                style={{
                  gridColumn: `span ${colSpan}`,
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius, 10px)",
                  boxShadow: "var(--shadow-card)",
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                {/* Widget Card Header Controls */}
                <div
                  style={{
                    padding: "10px 14px",
                    borderBottom: "1px solid var(--border)",
                    background: "var(--bg-elev)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--text)" }}>
                      {widgetName}
                    </span>
                    <span
                      style={{
                        fontSize: "10px",
                        color: "var(--muted)",
                        background: "var(--subtle)",
                        padding: "1px 6px",
                        borderRadius: "999px",
                      }}
                    >
                      {colSpan} cols
                    </span>
                  </div>

                  {/* Actions: Reorder, Resize, Remove */}
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    {/* Move Up */}
                    <button
                      type="button"
                      data-testid={`move-up-${placement.id}`}
                      disabled={index === 0}
                      onClick={() => handleMoveWidget(placement.id, "up")}
                      title="Move earlier"
                      style={{
                        padding: "2px 6px",
                        fontSize: "11px",
                        background: "transparent",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius, 4px)",
                        color: index === 0 ? "var(--muted)" : "var(--text-soft)",
                        cursor: index === 0 ? "not-allowed" : "pointer",
                      }}
                    >
                      ▲
                    </button>

                    {/* Move Down */}
                    <button
                      type="button"
                      data-testid={`move-down-${placement.id}`}
                      disabled={index === widgetsList.length - 1}
                      onClick={() => handleMoveWidget(placement.id, "down")}
                      title="Move later"
                      style={{
                        padding: "2px 6px",
                        fontSize: "11px",
                        background: "transparent",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius, 4px)",
                        color: index === widgetsList.length - 1 ? "var(--muted)" : "var(--text-soft)",
                        cursor: index === widgetsList.length - 1 ? "not-allowed" : "pointer",
                      }}
                    >
                      ▼
                    </button>

                    {/* Resize width dropdown/buttons */}
                    <select
                      data-testid={`resize-widget-${placement.id}`}
                      value={colSpan}
                      onChange={(e) => handleResizeWidget(placement.id, Number(e.target.value))}
                      style={{
                        padding: "2px 4px",
                        fontSize: "11px",
                        background: "var(--input-bg, var(--bg))",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius, 4px)",
                        color: "var(--text)",
                        cursor: "pointer",
                      }}
                    >
                      <option value={3}>3 cols (25%)</option>
                      <option value={4}>4 cols (33%)</option>
                      <option value={6}>6 cols (50%)</option>
                      <option value={12}>12 cols (100%)</option>
                    </select>

                    {/* Remove button */}
                    <button
                      type="button"
                      data-testid={`remove-widget-${placement.id}`}
                      onClick={() => handleRemoveWidget(placement.id)}
                      title="Remove from canvas"
                      style={{
                        padding: "2px 6px",
                        fontSize: "11px",
                        background: "transparent",
                        border: "none",
                        color: "var(--danger-text)",
                        cursor: "pointer",
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Widget Preview Card Body */}
                <div
                  style={{
                    padding: "24px 16px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                    gap: "8px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: 600,
                      color: "var(--text-soft)",
                    }}
                  >
                    {widgetName} Content
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                    {widgetDef?.description ?? "Stock widget telemetry"}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Widget Picker Modal */}
      <WidgetPicker
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        availableWidgets={availableWidgets}
        activeWidgetIds={activeWidgetIds}
        onAddWidget={handleAddWidget}
      />
    </div>
  );
}
