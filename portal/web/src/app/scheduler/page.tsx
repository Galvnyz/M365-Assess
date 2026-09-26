"use client";

// Scheduler page (EPIC-007 SPEC.md §3.1, T-0129).
// Tabs: Scheduled Tasks / Task / Job. Renders the ScheduledTasksTable (T-0124 API)
// and the read-only SystemTimersCard. Row actions call the schedule API.
// Zero colour literals: report theme tokens only.

import React, { useCallback, useEffect, useState, type CSSProperties, type ReactElement } from "react";
import {
  ScheduledTasksTable,
  type ScheduledTaskItem,
} from "../../components/scheduler/ScheduledTasksTable.js";
import {
  SystemTimersCard,
  type SystemTimerItem,
} from "../../components/scheduler/SystemTimersCard.js";

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

const tabsStyle: CSSProperties = {
  display: "flex",
  gap: "4px",
};

const tabStyle = (active: boolean): CSSProperties => ({
  padding: "8px 14px",
  border: "none",
  borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
  background: "transparent",
  color: active ? "var(--accent)" : "var(--text-soft)",
  fontWeight: 600,
  fontSize: "14px",
  cursor: "pointer",
  textDecoration: "none",
});

interface ApiSchedule {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly cron: string;
  readonly timezone: string;
  readonly targetScope: { readonly type: "tenant" | "group" | "all"; readonly id?: string };
  readonly command: string;
  readonly parameters: Record<string, unknown>;
  readonly enabled: boolean;
  readonly isSystem: boolean;
  readonly lastRunAt: string | null;
  readonly nextRunAt: string | null;
}

export interface SchedulerPageProps {
  readonly fetcher?: typeof fetch;
}

function toTask(item: ApiSchedule): ScheduledTaskItem {
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    cron: item.cron,
    timezone: item.timezone,
    targetScope: item.targetScope,
    command: item.command,
    parameters: item.parameters,
    enabled: item.enabled,
    isSystem: item.isSystem,
    lastRunAt: item.lastRunAt,
    nextRunAt: item.nextRunAt,
    tenantId: item.targetScope?.type === "tenant" ? (item.targetScope.id ?? null) : null,
  };
}

function toSystemTimer(item: ApiSchedule): SystemTimerItem {
  return {
    name: item.name,
    cron: item.cron,
    type: item.type,
    timezone: item.timezone,
    command: item.command,
    nextRunAt: item.nextRunAt,
  };
}

export default function SchedulerPage({ fetcher }: SchedulerPageProps): ReactElement {
  const doFetch = fetcher ?? fetch;
  const [tasks, setTasks] = useState<ScheduledTaskItem[]>([]);
  const [timers, setTimers] = useState<SystemTimerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [tasksRes, timersRes] = await Promise.all([
        doFetch("/v1/schedules"),
        doFetch("/v1/schedules/system"),
      ]);
      if (!tasksRes.ok) throw new Error(`Failed to load scheduled tasks: ${tasksRes.statusText}`);
      if (!timersRes.ok) throw new Error(`Failed to load system timers: ${timersRes.statusText}`);
      const tasksBody = (await tasksRes.json()) as { items?: ApiSchedule[] };
      const timersBody = (await timersRes.json()) as { items?: ApiSchedule[] };
      setTasks((tasksBody.items ?? []).map(toTask));
      setTimers((timersBody.items ?? []).map(toSystemTimer));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setTasks([]);
      setTimers([]);
    } finally {
      setLoading(false);
    }
  }, [doFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRunNow = async (task: ScheduledTaskItem): Promise<void> => {
    try {
      const res = await doFetch(`/v1/schedules/${task.id}/run-now`, { method: "POST" });
      if (!res.ok) throw new Error(`Run now failed: ${res.statusText}`);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggleEnabled = async (task: ScheduledTaskItem): Promise<void> => {
    try {
      const res = await doFetch(`/v1/schedules/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !task.enabled }),
      });
      if (!res.ok) throw new Error(`Toggle failed: ${res.statusText}`);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleClone = async (task: ScheduledTaskItem): Promise<void> => {
    try {
      const res = await doFetch("/v1/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${task.name} (copy)`,
          type: task.type,
          cron: task.cron,
          timezone: task.timezone,
          targetScope: task.targetScope,
          command: task.command,
          parameters: task.parameters ?? {},
          enabled: false,
        }),
      });
      if (!res.ok) throw new Error(`Clone failed: ${res.statusText}`);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (task: ScheduledTaskItem): Promise<void> => {
    try {
      const res = await doFetch(`/v1/schedules/${task.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed: ${res.statusText}`);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div style={pageStyle} data-testid="scheduler-page">
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>Scheduler</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-soft)", fontSize: "14px" }}>
            Schedule recurring runs and maintenance tasks across tenants and groups.
          </p>
        </div>
        <nav style={tabsStyle} aria-label="Scheduler sections">
          <button type="button" style={tabStyle(true)} data-testid="tab-scheduled-tasks">
            Scheduled Tasks
          </button>
          <a href="/runs" style={tabStyle(false)} data-testid="tab-job">
            Job
          </a>
        </nav>
      </div>

      <ScheduledTasksTable
        tasks={tasks}
        loading={loading}
        error={error}
        onViewTask={(task) => {
          window.location.href = `/scheduler/${task.id}`;
        }}
        onEdit={(task) => {
          window.location.href = `/scheduler/${task.id}?tab=definition`;
        }}
        onRunNow={handleRunNow}
        onToggleEnabled={handleToggleEnabled}
        onClone={handleClone}
        onDelete={handleDelete}
        onAddTask={() => {
          window.location.href = "/scheduler/new";
        }}
      />

      <SystemTimersCard timers={timers} loading={loading} />
    </div>
  );
}
