"use client";

// Task detail page (EPIC-007 SPEC.md §3.2, T-0129).
// Tabs: Definition (target, command, schedule, parameters), History (per-run:
// started, duration, outcome, link to the run/queue), Parameters (dynamic
// inputs). Reads GET /v1/schedules/{id} and /v1/schedules/{id}/history.
// Zero colour literals: report theme tokens only.

import React, { useCallback, useEffect, useState, use, type CSSProperties, type ReactElement } from "react";
import {
  describeCronExpression,
  formatTarget,
  type ScheduledTaskItem,
} from "../../../components/scheduler/ScheduledTasksTable.js";

const pageStyle: CSSProperties = {
  padding: "32px",
  maxWidth: "1100px",
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
});

const panelStyle: CSSProperties = {
  padding: "16px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  boxShadow: "var(--shadow-card)",
};

const fieldLabelStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--text-soft)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const monoStyle: CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  fontSize: "13px",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  margin: 0,
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "14px",
  textAlign: "left",
};

const thStyle: CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--border)",
  color: "var(--text-soft)",
  fontSize: "12px",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const tdStyle: CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--border)",
};

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
  readonly lastRunAt: string | null;
  readonly nextRunAt: string | null;
}

interface ApiScheduleRun {
  readonly runId: string;
  readonly jobId: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly outcome: string;
  readonly error: string | null;
}

type Tab = "definition" | "history" | "parameters";

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function formatDuration(startedAt: string, finishedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "—";
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export interface TaskDetailPageProps {
  readonly params: Promise<{ id: string }> | { id: string };
  readonly fetcher?: typeof fetch;
}

export default function TaskDetailPage(props: TaskDetailPageProps): ReactElement {
  const resolvedParams =
    typeof (props.params as Promise<{ id: string }>).then === "function"
      ? use(props.params as Promise<{ id: string }>)
      : (props.params as { id: string });
  const scheduleId = resolvedParams.id;
  const doFetch = props.fetcher ?? fetch;

  const [tab, setTab] = useState<Tab>("definition");
  const [schedule, setSchedule] = useState<ApiSchedule | null>(null);
  const [runs, setRuns] = useState<ApiScheduleRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!scheduleId) return;
    setLoading(true);
    setError(null);
    try {
      const [scheduleRes, historyRes] = await Promise.all([
        doFetch(`/v1/schedules/${scheduleId}`),
        doFetch(`/v1/schedules/${scheduleId}/history`),
      ]);
      if (!scheduleRes.ok) throw new Error(`Failed to load task: ${scheduleRes.statusText}`);
      if (!historyRes.ok) throw new Error(`Failed to load history: ${historyRes.statusText}`);
      setSchedule((await scheduleRes.json()) as ApiSchedule);
      const historyBody = (await historyRes.json()) as { runs?: ApiScheduleRun[] };
      setRuns(historyBody.runs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [scheduleId, doFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const task: ScheduledTaskItem | null = schedule
    ? {
        id: schedule.id,
        name: schedule.name,
        type: schedule.type,
        cron: schedule.cron,
        timezone: schedule.timezone,
        targetScope: schedule.targetScope,
        command: schedule.command,
        parameters: schedule.parameters,
        enabled: schedule.enabled,
        lastRunAt: schedule.lastRunAt,
        nextRunAt: schedule.nextRunAt,
      }
    : null;

  return (
    <div style={pageStyle} data-testid="task-detail-page">
      <div style={headerStyle}>
        <a href="/scheduler" style={{ color: "var(--accent-text)", fontSize: "14px", textDecoration: "none" }}>
          ← Scheduler
        </a>
        <h1 style={{ ...titleStyle, marginTop: "8px" }}>{task?.name ?? "Task"}</h1>
      </div>

      <nav style={tabsStyle} aria-label="Task detail sections">
        <button type="button" style={tabStyle(tab === "definition")} onClick={() => setTab("definition")} data-testid="tab-definition">
          Definition
        </button>
        <button type="button" style={tabStyle(tab === "history")} onClick={() => setTab("history")} data-testid="tab-history">
          History
        </button>
        <button type="button" style={tabStyle(tab === "parameters")} onClick={() => setTab("parameters")} data-testid="tab-parameters">
          Parameters
        </button>
      </nav>

      {loading && <div style={{ color: "var(--text-soft)" }}>Loading task...</div>}
      {error && (
        <div style={{ padding: "12px", background: "var(--danger-soft)", border: "1px solid var(--danger)", borderRadius: "6px", color: "var(--danger-text)" }} role="alert">
          {error}
        </div>
      )}

      {!loading && !error && task && tab === "definition" && (
        <div style={panelStyle} data-testid="definition-panel">
          <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", margin: 0 }}>
            <div>
              <div style={fieldLabelStyle}>Target</div>
              <div>{formatTarget(task.targetScope)}</div>
            </div>
            <div>
              <div style={fieldLabelStyle}>Command</div>
              <pre style={monoStyle}>{task.command}</pre>
            </div>
            <div>
              <div style={fieldLabelStyle}>Schedule</div>
              <div>
                {describeCronExpression(task.cron)}
                <div style={{ ...monoStyle, color: "var(--text-soft)" }}>{task.cron} ({task.timezone})</div>
              </div>
            </div>
            <div>
              <div style={fieldLabelStyle}>Enabled</div>
              <div>{task.enabled ? "Yes" : "No"}</div>
            </div>
            <div>
              <div style={fieldLabelStyle}>Next run</div>
              <div>{formatDateTime(task.nextRunAt)}</div>
            </div>
          </dl>
        </div>
      )}

      {!loading && !error && tab === "history" && (
        <div style={panelStyle} data-testid="history-panel">
          <table style={tableStyle} aria-label="Task run history">
            <thead>
              <tr>
                <th style={thStyle}>Started</th>
                <th style={thStyle}>Duration</th>
                <th style={thStyle}>Outcome</th>
                <th style={thStyle}>Run</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr>
                  <td style={{ ...tdStyle, color: "var(--text-soft)" }} colSpan={4} data-testid="empty-history">
                    No runs recorded yet.
                  </td>
                </tr>
              )}
              {runs.map((run) => (
                <tr key={run.runId} data-testid={`history-run-${run.runId}`}>
                  <td style={tdStyle}>{formatDateTime(run.startedAt)}</td>
                  <td style={tdStyle}>{formatDuration(run.startedAt, run.finishedAt)}</td>
                  <td style={tdStyle}>{run.outcome}</td>
                  <td style={tdStyle}>
                    <a href={`/runs/${run.runId}`} style={{ color: "var(--accent-text)" }}>
                      {run.runId}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && tab === "parameters" && (
        <div style={panelStyle} data-testid="parameters-panel">
          <div style={fieldLabelStyle}>Dynamic inputs</div>
          <pre style={monoStyle} data-testid="parameters-json">
            {JSON.stringify(task?.parameters ?? {}, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
