"use client";

// Scheduled tasks table (EPIC-007 SPEC.md §3.1, T-0129).
// Columns: Name · Target · Command · Schedule (cron, human readable) · State ·
// Last run · Next run · Enabled. Filters (state/type/tenant/enabled) with the
// Running/Planned/Failed/Completed presets. Row actions: View task, Edit,
// Run now (confirm), Enable/Disable, Clone, Delete; primary Add task.
// Zero colour literals: report theme tokens only.

import React, { useMemo, useState, type CSSProperties, type ReactElement } from "react";

export type ScheduledTaskState = "Planned" | "Running" | "Completed" | "Failed";
export type ScheduleTargetType = "tenant" | "group" | "all";

export interface ScheduleTargetScope {
  readonly type: ScheduleTargetType;
  readonly id?: string;
}

// View model: the T-0124 ScheduleRecord plus the derived display state and the
// tenant label the table filters on.
export interface ScheduledTaskItem {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly cron: string;
  readonly timezone: string;
  readonly targetScope: ScheduleTargetScope;
  readonly command: string;
  readonly parameters?: Record<string, unknown>;
  readonly enabled: boolean;
  readonly isSystem?: boolean;
  readonly lastRunAt: string | null;
  readonly nextRunAt: string | null;
  readonly state?: ScheduledTaskState;
  readonly tenantId?: string | null;
}

export interface ScheduledTasksTableProps {
  readonly tasks?: readonly ScheduledTaskItem[];
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly runningIds?: readonly string[];
  readonly onViewTask?: (task: ScheduledTaskItem) => void;
  readonly onEdit?: (task: ScheduledTaskItem) => void;
  readonly onRunNow?: (task: ScheduledTaskItem) => void;
  readonly onToggleEnabled?: (task: ScheduledTaskItem) => void;
  readonly onClone?: (task: ScheduledTaskItem) => void;
  readonly onDelete?: (task: ScheduledTaskItem) => void;
  readonly onAddTask?: () => void;
}

type Preset = "All" | "Running" | "Planned" | "Failed" | "Completed";

const PRESETS: readonly Preset[] = ["All", "Running", "Planned", "Failed", "Completed"];

// ─── Cron description (web-local; the BFF describeCron is not importable here) ─

const WEEKDAYS: readonly string[] = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function everyN(value: string | undefined): number | null {
  const match = value?.match(/^\*\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

function isFixed(value: string | undefined): boolean {
  return value !== undefined && /^\d+$/.test(value);
}

/**
 * Describes the cron forms this portal schedules use (6-field with seconds, or
 * 5-field). Falls back to the raw expression when the shape is not recognised.
 */
export function describeCronExpression(cron: string): string {
  const raw = (cron ?? "").trim();
  if (!raw) return "—";
  const fields = raw.split(/\s+/);
  if (fields.length !== 6 && fields.length !== 5) return raw;

  // Normalise to [sec, min, hour, dom, month, dow].
  const [sec, min, hour, dom, month, dow] =
    fields.length === 6 ? fields : ["0", ...fields];

  const secEvery = everyN(sec);
  if (secEvery !== null) return `Every ${secEvery} seconds`;

  const minEvery = everyN(min);
  const hourEvery = everyN(hour);
  // Omit a :00 minute suffix; only show it when it disambiguates (e.g. :15).
  const minuteSuffix = minEvery !== null || min === "0" ? undefined : isFixed(min) ? `:${pad(Number(min))}` : null;

  if (hourEvery !== null) {
    return minuteSuffix ? `Every ${hourEvery} hours at ${minuteSuffix}` : `Every ${hourEvery} hours`;
  }
  if (minEvery !== null && hour === "*") return `Every ${minEvery} minutes`;

  if (min === "*" && hour === "*") return "Every minute";

  if (isFixed(hour)) {
    const time = `${pad(Number(hour))}:${pad(Number(min))}`;
    if (dom === "*" && month === "*" && dow === "*") return `Daily at ${time}`;
    if (dom !== "*" && month === "*" && dow === "*") return `Day ${dom} of every month at ${time}`;
    if (dom === "*" && month === "*" && /^\d+$/.test(dow)) {
      return `Every ${WEEKDAYS[Number(dow) % 7]} at ${time}`;
    }
    return `At ${time}`;
  }

  if (hour === "*") {
    return minEvery !== null ? `Every ${minEvery} minutes` : `Hourly${minuteSuffix ?? ""}`;
  }
  if (dom !== "*" && month === "*" && dow === "*") return `Day ${dom} of every month`;

  return raw;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  width: "100%",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
};

const barStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 16px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
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

const disabledActionBtnStyle: CSSProperties = {
  ...actionBtnStyle,
  opacity: 0.4,
  cursor: "not-allowed",
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
  whiteSpace: "nowrap",
};

const tdStyle: CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid var(--border)",
  color: "var(--text)",
  verticalAlign: "middle",
};

const monoStyle: CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  fontSize: "13px",
};

const badgeBaseStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 600,
};

export function taskStateBadgeStyle(state: string): CSSProperties {
  switch (state) {
    case "Running":
      return { ...badgeBaseStyle, background: "var(--accent-soft)", color: "var(--accent-text)", border: "1px solid var(--accent)" };
    case "Completed":
      return { ...badgeBaseStyle, background: "var(--success-soft)", color: "var(--success-text)", border: "1px solid var(--success)" };
    case "Failed":
      return { ...badgeBaseStyle, background: "var(--danger-soft)", color: "var(--danger-text)", border: "1px solid var(--danger)" };
    case "Planned":
    default:
      return { ...badgeBaseStyle, background: "var(--surface)", color: "var(--text-soft)", border: "1px solid var(--border)" };
  }
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/** Derives a display state when the record does not carry one. */
export function deriveTaskState(task: ScheduledTaskItem, running: boolean): ScheduledTaskState {
  if (task.state) return task.state;
  if (running) return "Running";
  if (!task.lastRunAt) return "Planned";
  return "Completed";
}

export function formatTarget(scope: ScheduleTargetScope | undefined): string {
  if (!scope) return "—";
  if (scope.type === "all") return "All tenants";
  if (scope.type === "group") return `Group: ${scope.id ?? "—"}`;
  return scope.id ? `Tenant: ${scope.id}` : "Tenant";
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ScheduledTasksTable({
  tasks = [],
  loading = false,
  error = null,
  runningIds = [],
  onViewTask,
  onEdit,
  onRunNow,
  onToggleEnabled,
  onClone,
  onDelete,
  onAddTask,
}: ScheduledTasksTableProps): ReactElement {
  const [preset, setPreset] = useState<Preset>("All");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [tenantFilter, setTenantFilter] = useState<string>("");
  const [enabledFilter, setEnabledFilter] = useState<string>("all");
  const [confirmRunNow, setConfirmRunNow] = useState<string | null>(null);

  const running = useMemo(() => new Set(runningIds), [runningIds]);

  const types = useMemo(() => {
    const set = new Set<string>();
    for (const task of tasks) if (task.type) set.add(task.type);
    return [...set].sort();
  }, [tasks]);

  const filtered = useMemo(() => {
    return tasks.filter((task) => {
      const state = deriveTaskState(task, running.has(task.id));
      if (preset !== "All" && state !== preset) return false;
      if (typeFilter !== "all" && task.type !== typeFilter) return false;
      if (enabledFilter === "enabled" && !task.enabled) return false;
      if (enabledFilter === "disabled" && task.enabled) return false;
      if (tenantFilter.trim()) {
        const query = tenantFilter.trim().toLowerCase();
        const target = `${task.targetScope?.id ?? ""} ${task.tenantId ?? ""}`.toLowerCase();
        if (!target.includes(query)) return false;
      }
      return true;
    });
  }, [tasks, preset, typeFilter, tenantFilter, enabledFilter, running]);

  return (
    <div style={containerStyle} data-testid="scheduled-tasks-table">
      <div style={barStyle}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
          {PRESETS.map((value) => (
            <button
              key={value}
              type="button"
              style={preset === value ? primaryButtonStyle : buttonStyle}
              onClick={() => setPreset(value)}
              data-testid={`preset-${value.toLowerCase()}`}
            >
              {value}
            </button>
          ))}
        </div>
        {onAddTask && (
          <button type="button" style={primaryButtonStyle} onClick={onAddTask} data-testid="add-task-button">
            Add task
          </button>
        )}
      </div>

      <div style={barStyle}>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          style={selectStyle}
          aria-label="Filter by type"
          data-testid="filter-type"
        >
          <option value="all">All types</option>
          {types.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Filter by tenant..."
          value={tenantFilter}
          onChange={(e) => setTenantFilter(e.target.value)}
          style={inputStyle}
          aria-label="Filter by tenant"
          data-testid="filter-tenant"
        />
        <select
          value={enabledFilter}
          onChange={(e) => setEnabledFilter(e.target.value)}
          style={selectStyle}
          aria-label="Filter by enabled"
          data-testid="filter-enabled"
        >
          <option value="all">All</option>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
        </select>
      </div>

      {loading && (
        <div style={{ padding: "32px", textAlign: "center", color: "var(--text-soft)" }}>Loading scheduled tasks...</div>
      )}

      {error && (
        <div style={{ padding: "16px", borderRadius: "6px", background: "var(--danger-soft)", border: "1px solid var(--danger)", color: "var(--danger-text)" }} role="alert">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div style={tableWrapperStyle}>
          <table style={tableStyle} aria-label="Scheduled tasks">
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Target</th>
                <th style={thStyle}>Command</th>
                <th style={thStyle}>Schedule</th>
                <th style={thStyle}>State</th>
                <th style={thStyle}>Last run</th>
                <th style={thStyle}>Next run</th>
                <th style={thStyle}>Enabled</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td style={{ ...tdStyle, textAlign: "center", color: "var(--text-soft)" }} colSpan={9} data-testid="empty-tasks-state">
                    No scheduled tasks match the current filters.
                  </td>
                </tr>
              )}
              {filtered.map((task) => {
                const state = deriveTaskState(task, running.has(task.id));
                const isRunning = state === "Running";
                return (
                  <tr key={task.id} data-testid={`task-row-${task.id}`}>
                    <td style={tdStyle}>{task.name}</td>
                    <td style={tdStyle}>{formatTarget(task.targetScope)}</td>
                    <td style={{ ...tdStyle, ...monoStyle }}>{task.command}</td>
                    <td style={tdStyle}>
                      <span title={task.cron}>{describeCronExpression(task.cron)}</span>
                      <div style={{ ...monoStyle, color: "var(--text-soft)", fontSize: "11px" }}>{task.cron}</div>
                    </td>
                    <td style={tdStyle}>
                      <span className="status-badge" style={taskStateBadgeStyle(state)} data-testid={`state-${task.id}`}>
                        {state}
                      </span>
                    </td>
                    <td style={tdStyle}>{formatDateTime(task.lastRunAt)}</td>
                    <td style={tdStyle}>{formatDateTime(task.nextRunAt)}</td>
                    <td style={tdStyle}>{task.enabled ? "Yes" : "No"}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: "6px", justifyContent: "flex-end", flexWrap: "wrap" }}>
                        {onViewTask && (
                          <button type="button" style={actionBtnStyle} onClick={() => onViewTask(task)} data-testid={`view-${task.id}`}>
                            View task
                          </button>
                        )}
                        {onEdit && (
                          <button type="button" style={actionBtnStyle} onClick={() => onEdit(task)} data-testid={`edit-${task.id}`}>
                            Edit
                          </button>
                        )}
                        {onRunNow && (
                          <button
                            type="button"
                            style={isRunning ? disabledActionBtnStyle : actionBtnStyle}
                            disabled={isRunning}
                            onClick={() => setConfirmRunNow(task.id)}
                            data-testid={`run-now-${task.id}`}
                          >
                            Run now
                          </button>
                        )}
                        {onToggleEnabled && (
                          <button type="button" style={actionBtnStyle} onClick={() => onToggleEnabled(task)} data-testid={`toggle-${task.id}`}>
                            {task.enabled ? "Disable" : "Enable"}
                          </button>
                        )}
                        {onClone && (
                          <button type="button" style={actionBtnStyle} onClick={() => onClone(task)} data-testid={`clone-${task.id}`}>
                            Clone
                          </button>
                        )}
                        {onDelete && (
                          <button type="button" style={actionBtnStyle} onClick={() => onDelete(task)} data-testid={`delete-${task.id}`}>
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {confirmRunNow && onRunNow && (
        <div
          style={{ padding: "12px 16px", background: "var(--warning-soft)", border: "1px solid var(--warning)", borderRadius: "6px", color: "var(--warning-text)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}
          role="alertdialog"
          data-testid="run-now-confirm"
        >
          <span>Run this task now?</span>
          <span style={{ display: "inline-flex", gap: "8px" }}>
            <button
              type="button"
              style={buttonStyle}
              onClick={() => setConfirmRunNow(null)}
              data-testid="run-now-cancel"
            >
              Cancel
            </button>
            <button
              type="button"
              style={primaryButtonStyle}
              onClick={() => {
                const task = tasks.find((t) => t.id === confirmRunNow);
                setConfirmRunNow(null);
                if (task) onRunNow(task);
              }}
              data-testid="run-now-confirm-button"
            >
              Run now
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
