"use client";

// QueueTracker component (EPIC-003 SPEC.md §3.4, §4.2, T-0051).
// Persistent top-bar badge showing active runs that opens a drawer with per-tenant/per-section
// progress and a Cancel action. Supports multi-queue aggregate tooltip merging concurrent runs
// and expandable check-level detail (§4.2). Report theme tokens only with zero colour literals.

import React, {
  useState,
  useMemo,
  useCallback,
  type CSSProperties,
  type ReactElement,
  useEffect,
} from "react";
import {
  type ProgressEvent,
  type RunState,
  type SectionState,
} from "@m365-assess/contracts/events";
import { useRunEvents } from "../lib/useRunEvents";

export interface QueueTrackerCheck {
  readonly id: string;
  readonly message: string;
  readonly at?: string;
  readonly state?: string;
  readonly sequence?: number;
}

export interface QueueTrackerSection {
  readonly id?: string;
  readonly name: string;
  readonly state: SectionState | string;
  readonly completed?: number;
  readonly total?: number;
  readonly message?: string;
  readonly checks?: readonly QueueTrackerCheck[];
}

export interface QueueTrackerRun {
  readonly id: string;
  readonly tenantId: string;
  readonly tenantDisplayName?: string | null;
  readonly status: RunState | string;
  readonly progress?: {
    readonly completed: number;
    readonly total: number;
    readonly percentage?: number;
  } | number | null;
  readonly sections?: readonly QueueTrackerSection[];
  readonly startedAt?: string | null;
  readonly trigger?: string;
}

export interface QueueTrackerProps {
  /** Active runs to track */
  readonly runs?: readonly QueueTrackerRun[];
  /** Controlled open state for the drawer */
  readonly open?: boolean;
  /** Callback when drawer open state changes */
  readonly onOpenChange?: (open: boolean) => void;
  /** Callback when operator clicks Cancel on a run */
  readonly onCancel?: (runId: string) => void | Promise<void>;
  /** Callback when operator clicks a run to view details */
  readonly onViewRun?: (runId: string) => void;
  /** Whether to stream live progress events via SSE (default: true) */
  readonly streamEvents?: boolean;
  /** Base URL for SSE endpoint (default: "") */
  readonly baseUrl?: string;
  /** Optional custom EventSource implementation */
  readonly eventSourceImpl?: {
    new (url: string, eventSourceInitDict?: EventSourceInit): EventSource;
  };
  /** Variant: "single" | "multi" | "auto" (default: "auto") */
  readonly variant?: "single" | "multi" | "auto";
  /** Task noun for multi-queue tooltip (default: "tasks") */
  readonly taskNoun?: string;
  /** Unit noun for multi-queue tooltip (default: "caches" or "tenants") */
  readonly unitNoun?: string;
  /** Label prefix for multi-queue tooltip (default: "Sync running") */
  readonly tooltipLabel?: string;
  /** Custom class name */
  readonly className?: string;
}

export function isRunActive(status: string): boolean {
  const s = status.toLowerCase();
  return s === "running" || s === "queued";
}

export function calculateRunProgressPercentage(run: QueueTrackerRun): number {
  if (typeof run.progress === "number") {
    return Math.min(100, Math.max(0, run.progress));
  }
  if (run.progress && typeof run.progress === "object") {
    if (typeof run.progress.percentage === "number") {
      return Math.min(100, Math.max(0, run.progress.percentage));
    }
    if (run.progress.total > 0) {
      return Math.min(
        100,
        Math.max(0, Math.round((run.progress.completed / run.progress.total) * 100))
      );
    }
  }
  if (run.sections && run.sections.length > 0) {
    const completedCount = run.sections.filter(
      (s) => s.state === "succeeded" || s.state === "skipped"
    ).length;
    return Math.min(100, Math.max(0, Math.round((completedCount / run.sections.length) * 100)));
  }
  if (run.status === "succeeded") return 100;
  if (run.status === "queued") return 0;
  if (run.status === "running") return 50;
  return 0;
}

export function buildMultiQueueTooltip(
  runs: readonly QueueTrackerRun[],
  options: {
    label?: string;
    taskNoun?: string;
    unitNoun?: string;
  } = {}
): string {
  const label = options.label || "Sync running";
  const taskNoun = options.taskNoun || "tasks";
  const unitNoun = options.unitNoun || "caches";

  let totalCompleted = 0;
  let totalTasks = 0;

  for (const run of runs) {
    if (run.progress && typeof run.progress === "object") {
      totalCompleted += run.progress.completed || 0;
      totalTasks += run.progress.total || 0;
    } else if (run.sections && run.sections.length > 0) {
      const completedSections = run.sections.filter(
        (s) => s.state === "succeeded" || s.state === "skipped"
      ).length;
      totalCompleted += completedSections;
      totalTasks += run.sections.length;
    } else {
      if (run.status === "succeeded") totalCompleted += 1;
      totalTasks += 1;
    }
  }

  const percentage = totalTasks > 0 ? Math.round((totalCompleted / totalTasks) * 100) : 0;
  const count = runs.length;

  return `${label} — ${percentage}% (${totalCompleted}/${totalTasks} ${taskNoun} across ${count} ${unitNoun})`;
}

export function QueueTracker(props: QueueTrackerProps): ReactElement {
  const {
    runs = [],
    open: controlledOpen,
    onOpenChange,
    onCancel,
    onViewRun,
    streamEvents = true,
    baseUrl = "",
    eventSourceImpl,
    variant = "auto",
    taskNoun = "tasks",
    unitNoun = "caches",
    tooltipLabel = "Sync running",
    className,
  } = props;

  const [internalOpen, setInternalOpen] = useState<boolean>(false);
  const isDrawerOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;

  const setDrawerOpen = useCallback(
    (nextOpen: boolean) => {
      if (controlledOpen === undefined) {
        setInternalOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [controlledOpen, onOpenChange]
  );

  // Expanded sections state: Map runId:sectionName -> boolean
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  // Cancelling runs state
  const [cancellingRunIds, setCancellingRunIds] = useState<ReadonlySet<string>>(new Set());

  const toggleSection = useCallback((runId: string, sectionName: string) => {
    const key = `${runId}:${sectionName}`;
    setExpandedSections((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  // Internal state tracking live runs and live progress
  const [liveRuns, setLiveRuns] = useState<readonly QueueTrackerRun[]>(runs);

  // Sync when prop runs change
  useEffect(() => {
    setLiveRuns(runs);
  }, [runs]);

  // Determine active runs for SSE subscriptions and badge
  const activeRuns = useMemo(() => {
    return liveRuns.filter((r) => isRunActive(r.status));
  }, [liveRuns]);

  const activeRunIds = useMemo(() => {
    return activeRuns.map((r) => r.id);
  }, [activeRuns]);

  // Live SSE progress events handler
  const handleProgressEvent = useCallback((event: ProgressEvent) => {
    setLiveRuns((prev) => {
      const runIndex = prev.findIndex((r) => r.id === event.runId);
      if (runIndex === -1) return prev;

      const targetRun = prev[runIndex];
      const nextRun: QueueTrackerRun = {
        ...targetRun,
        status: event.state,
        progress:
          event.completed !== undefined && event.total !== undefined
            ? {
                completed: event.completed,
                total: event.total,
                percentage:
                  event.total > 0
                    ? Math.round((event.completed / event.total) * 100)
                    : 0,
              }
            : targetRun.progress,
      };

      // Handle section update if event has section
      if (event.section) {
        const sections = Array.from(targetRun.sections || []);
        const sIndex = sections.findIndex((s) => s.name === event.section);
        const checkItem: QueueTrackerCheck | undefined = event.message
          ? {
              id: event.eventId,
              message: event.message,
              at: event.at,
              sequence: event.sequence,
            }
          : undefined;

        if (sIndex >= 0) {
          const existingSection = sections[sIndex];
          const checks = checkItem
            ? [...(existingSection.checks || []), checkItem]
            : existingSection.checks;
          sections[sIndex] = {
            ...existingSection,
            state: event.sectionState || existingSection.state,
            completed: event.completed ?? existingSection.completed,
            total: event.total ?? existingSection.total,
            message: event.message ?? existingSection.message,
            checks,
          };
        } else {
          sections.push({
            name: event.section,
            state: event.sectionState || "running",
            completed: event.completed,
            total: event.total,
            message: event.message,
            checks: checkItem ? [checkItem] : [],
          });
        }
        (nextRun as { sections: readonly QueueTrackerSection[] }).sections = sections;
      }

      const updated = [...prev];
      updated[runIndex] = nextRun;
      return updated;
    });
  }, []);

  // Hook for live events
  useRunEvents({
    runIds: activeRunIds,
    enabled: streamEvents && activeRunIds.length > 0,
    baseUrl,
    eventSourceImpl,
    onEvent: handleProgressEvent,
  });

  const handleCancelClick = async (runId: string) => {
    if (!onCancel || cancellingRunIds.has(runId)) return;
    setCancellingRunIds((prev) => new Set([...prev, runId]));
    try {
      await onCancel(runId);
    } finally {
      setCancellingRunIds((prev) => {
        const next = new Set(prev);
        next.delete(runId);
        return next;
      });
    }
  };

  const isMultiVariant =
    variant === "multi" || (variant === "auto" && activeRuns.length > 1);

  const tooltipText = useMemo(() => {
    if (activeRuns.length === 0) {
      return "No active runs in queue";
    }
    if (isMultiVariant) {
      return buildMultiQueueTooltip(activeRuns, {
        label: tooltipLabel,
        taskNoun,
        unitNoun,
      });
    }
    const single = activeRuns[0];
    const pct = calculateRunProgressPercentage(single);
    const tenant = single.tenantDisplayName || single.tenantId;
    return `${tenant} assessment running — ${pct}%`;
  }, [activeRuns, isMultiVariant, tooltipLabel, taskNoun, unitNoun]);

  const activeCount = activeRuns.length;

  return (
    <div
      className={className}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
      }}
    >
      {/* Top-bar Badge */}
      <button
        type="button"
        data-testid="queue-tracker-badge"
        aria-label={tooltipText}
        aria-expanded={isDrawerOpen}
        title={tooltipText}
        onClick={() => setDrawerOpen(!isDrawerOpen)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          padding: "6px 12px",
          background: activeCount > 0 ? "var(--accent-soft)" : "var(--surface)",
          border: activeCount > 0 ? "1px solid var(--accent)" : "1px solid var(--border)",
          borderRadius: "var(--radius, 8px)",
          color: activeCount > 0 ? "var(--accent-text)" : "var(--muted)",
          cursor: "pointer",
          fontSize: "13px",
          fontWeight: 600,
          transition: "all 0.15s ease",
        }}
      >
        <span
          data-testid="queue-tracker-pulse"
          style={{
            display: "inline-block",
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: activeCount > 0 ? "var(--accent)" : "var(--muted)",
            boxShadow: activeCount > 0 ? "var(--bar-glow)" : "none",
          }}
        />
        <span>
          {activeCount} {activeCount === 1 ? "Active Run" : "Active Runs"}
        </span>
      </button>

      {/* Off-canvas Drawer Backdrop */}
      {isDrawerOpen && (
        <div
          data-testid="queue-tracker-backdrop"
          onClick={() => setDrawerOpen(false)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "var(--overlay-bg, var(--overlay))",
            backdropFilter: "blur(4px)",
            zIndex: 1000,
          }}
        />
      )}

      {/* Off-canvas Drawer Panel */}
      {isDrawerOpen && (
        <aside
          data-testid="queue-tracker-drawer"
          role="dialog"
          aria-label="Queue Tracker Drawer"
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            width: "480px",
            maxWidth: "100%",
            background: "var(--bg-elev)",
            borderLeft: "1px solid var(--border)",
            boxShadow: "var(--shadow-card)",
            display: "flex",
            flexDirection: "column",
            zIndex: 1001,
            color: "var(--text)",
            fontFamily: "var(--font-sans, system-ui, sans-serif)",
            overflow: "hidden",
          }}
        >
          {/* Drawer Header */}
          <div
            style={{
              padding: "16px 20px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "var(--surface)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: "16px",
                  fontWeight: 600,
                  color: "var(--text)",
                }}
              >
                Assessment Queue
              </h2>
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: "999px",
                  fontSize: "12px",
                  fontWeight: 600,
                  background: activeCount > 0 ? "var(--accent-soft)" : "var(--surface)",
                  color: activeCount > 0 ? "var(--accent-text)" : "var(--muted)",
                  border: activeCount > 0 ? "1px solid var(--accent)" : "1px solid var(--border)",
                }}
              >
                {activeCount} active
              </span>
            </div>
            <button
              type="button"
              data-testid="queue-tracker-close"
              aria-label="Close drawer"
              onClick={() => setDrawerOpen(false)}
              style={{
                background: "transparent",
                border: "none",
                fontSize: "20px",
                color: "var(--muted)",
                cursor: "pointer",
                padding: "4px 8px",
                borderRadius: "var(--radius, 6px)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ×
            </button>
          </div>

          {/* Multi-queue Aggregate Banner */}
          {isMultiVariant && activeRuns.length > 0 && (
            <div
              data-testid="queue-tracker-aggregate-banner"
              style={{
                padding: "10px 20px",
                background: "var(--accent-soft)",
                borderBottom: "1px solid var(--border)",
                fontSize: "13px",
                color: "var(--accent-text)",
                fontWeight: 500,
              }}
            >
              {tooltipText}
            </div>
          )}

          {/* Drawer Scrollable Content */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "16px 20px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            {activeRuns.length === 0 ? (
              <div
                data-testid="queue-tracker-empty"
                style={{
                  padding: "36px 16px",
                  textAlign: "center",
                  color: "var(--muted)",
                  fontSize: "14px",
                }}
              >
                No active runs in queue.
              </div>
            ) : (
              activeRuns.map((run) => {
                const pct = calculateRunProgressPercentage(run);
                const isCancelling = cancellingRunIds.has(run.id);

                return (
                  <div
                    key={run.id}
                    data-testid={`queue-run-${run.id}`}
                    style={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius, 8px)",
                      padding: "16px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "12px",
                    }}
                  >
                    {/* Run Header: Tenant & Run Details */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: "12px",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: "15px",
                            color: "var(--text)",
                          }}
                        >
                          {run.tenantDisplayName || run.tenantId}
                        </div>
                        <div
                          style={{
                            fontSize: "12px",
                            color: "var(--muted)",
                            fontFamily: "var(--font-mono, monospace)",
                            marginTop: "2px",
                          }}
                        >
                          Run ID: {run.id}
                        </div>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        {/* Status Badge */}
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "2px 8px",
                            borderRadius: "999px",
                            fontSize: "11px",
                            fontWeight: 600,
                            textTransform: "capitalize",
                            background:
                              run.status === "running"
                                ? "var(--accent-soft)"
                                : run.status === "succeeded"
                                  ? "var(--success-soft)"
                                  : run.status === "failed"
                                    ? "var(--danger-soft)"
                                    : "var(--surface)",
                            color:
                              run.status === "running"
                                ? "var(--accent-text)"
                                : run.status === "succeeded"
                                  ? "var(--success-text)"
                                  : run.status === "failed"
                                    ? "var(--danger-text)"
                                    : "var(--text-soft)",
                            border:
                              run.status === "running"
                                ? "1px solid var(--accent)"
                                : run.status === "succeeded"
                                  ? "1px solid var(--success)"
                                  : run.status === "failed"
                                    ? "1px solid var(--danger)"
                                    : "1px solid var(--border)",
                          }}
                        >
                          {run.status}
                        </span>

                        {/* Cancel Action Button */}
                        {onCancel && (
                          <button
                            type="button"
                            data-testid={`cancel-run-${run.id}`}
                            aria-label={`Cancel run ${run.id}`}
                            disabled={isCancelling || run.status === "cancelled"}
                            onClick={() => handleCancelClick(run.id)}
                            style={{
                              padding: "4px 10px",
                              fontSize: "12px",
                              fontWeight: 600,
                              background: "var(--danger-soft)",
                              color: "var(--danger-text)",
                              border: "1px solid var(--danger)",
                              borderRadius: "var(--radius, 6px)",
                              cursor: isCancelling ? "not-allowed" : "pointer",
                              opacity: isCancelling ? 0.6 : 1,
                            }}
                          >
                            {isCancelling ? "Cancelling..." : "Cancel"}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Overall Progress Bar */}
                    <div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: "12px",
                          color: "var(--muted)",
                          marginBottom: "4px",
                        }}
                      >
                        <span>Overall Progress</span>
                        <span>{pct}%</span>
                      </div>
                      <div
                        style={{
                          height: "6px",
                          background: "var(--track)",
                          borderRadius: "999px",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${pct}%`,
                            background: "var(--accent)",
                            boxShadow: "var(--bar-glow)",
                            transition: "width 0.3s ease",
                          }}
                        />
                      </div>
                    </div>

                    {/* Section-level Progress rows */}
                    {run.sections && run.sections.length > 0 && (
                      <div
                        style={{
                          marginTop: "8px",
                          borderTop: "1px solid var(--border)",
                          paddingTop: "10px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "8px",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "var(--text-soft)",
                          }}
                        >
                          Sections ({run.sections.length})
                        </div>

                        {run.sections.map((section) => {
                          const sectionKey = `${run.id}:${section.name}`;
                          const isExpanded = !!expandedSections[sectionKey];
                          const hasChecks =
                            section.checks && section.checks.length > 0;

                          return (
                            <div
                              key={section.name}
                              data-testid={`section-${run.id}-${section.name}`}
                              style={{
                                background: "var(--bg-elev)",
                                border: "1px solid var(--border)",
                                borderRadius: "var(--radius, 6px)",
                                padding: "8px 12px",
                                fontSize: "13px",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                }}
                              >
                                <span
                                  style={{
                                    fontWeight: 500,
                                    color: "var(--text)",
                                  }}
                                >
                                  {section.name}
                                </span>

                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                  }}
                                >
                                  {/* Section Status */}
                                  <span
                                    style={{
                                      padding: "1px 6px",
                                      borderRadius: "999px",
                                      fontSize: "11px",
                                      fontWeight: 600,
                                      textTransform: "capitalize",
                                      background:
                                        section.state === "succeeded"
                                          ? "var(--success-soft)"
                                          : section.state === "failed"
                                            ? "var(--danger-soft)"
                                            : section.state === "running"
                                              ? "var(--accent-soft)"
                                              : "var(--surface)",
                                      color:
                                        section.state === "succeeded"
                                          ? "var(--success-text)"
                                          : section.state === "failed"
                                            ? "var(--danger-text)"
                                            : section.state === "running"
                                              ? "var(--accent-text)"
                                              : "var(--muted)",
                                      border:
                                        section.state === "succeeded"
                                          ? "1px solid var(--success)"
                                          : section.state === "failed"
                                            ? "1px solid var(--danger)"
                                            : section.state === "running"
                                              ? "1px solid var(--accent)"
                                              : "1px solid var(--border)",
                                    }}
                                  >
                                    {section.state}
                                  </span>

                                  {/* Expandable Check-level Detail Toggle */}
                                  {hasChecks && (
                                    <button
                                      type="button"
                                      data-testid={`toggle-checks-${run.id}-${section.name}`}
                                      aria-expanded={isExpanded}
                                      onClick={() =>
                                        toggleSection(run.id, section.name)
                                      }
                                      style={{
                                        background: "transparent",
                                        border: "none",
                                        color: "var(--accent-text)",
                                        fontSize: "11px",
                                        fontWeight: 600,
                                        cursor: "pointer",
                                        padding: "2px 4px",
                                      }}
                                    >
                                      {isExpanded
                                        ? "Hide checks"
                                        : `Checks (${section.checks!.length})`}
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Progress within section if available */}
                              {section.completed !== undefined &&
                                section.total !== undefined && (
                                  <div
                                    style={{
                                      marginTop: "4px",
                                      fontSize: "11px",
                                      color: "var(--muted)",
                                    }}
                                  >
                                    {section.completed} / {section.total} tasks
                                  </div>
                                )}

                              {/* Expandable Check-Level Detail */}
                              {isExpanded && hasChecks && (
                                <ul
                                  data-testid={`checks-list-${run.id}-${section.name}`}
                                  style={{
                                    marginTop: "8px",
                                    paddingTop: "6px",
                                    borderTop: "1px dashed var(--border)",
                                    listStyle: "none",
                                    paddingLeft: 0,
                                    margin: "8px 0 0 0",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "4px",
                                  }}
                                >
                                  {section.checks!.map((check) => (
                                    <li
                                      key={check.id}
                                      style={{
                                        fontSize: "11px",
                                        color: "var(--text-soft)",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "6px",
                                      }}
                                    >
                                      <span
                                        style={{
                                          color: "var(--accent)",
                                          fontSize: "8px",
                                        }}
                                      >
                                        ●
                                      </span>
                                      <span>{check.message}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
