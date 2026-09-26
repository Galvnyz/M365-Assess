"use client";

// System timers card (EPIC-007 SPEC.md §3.1 US-4, T-0129).
// Read-only list of the code-deployed built-in timers (T-0123 registry) with
// cron + next run. There are deliberately no edit or delete affordances: these
// timers ship with the app and are not operator-owned.
// Zero colour literals: report theme tokens only.

import React, { type CSSProperties, type ReactElement } from "react";
import { describeCronExpression } from "./ScheduledTasksTable.js";

export interface SystemTimerItem {
  readonly name: string;
  readonly cron: string;
  readonly type: string;
  readonly timezone?: string;
  readonly command?: string;
  readonly nextRunAt?: string | null;
}

export interface SystemTimersCardProps {
  readonly timers?: readonly SystemTimerItem[];
  readonly loading?: boolean;
  readonly error?: string | null;
}

const cardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  padding: "16px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  boxShadow: "var(--shadow-card)",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "16px",
  fontWeight: 600,
};

const hintStyle: CSSProperties = {
  margin: 0,
  fontSize: "12px",
  color: "var(--text-soft)",
};

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  margin: 0,
  padding: 0,
  listStyle: "none",
};

const rowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr auto auto",
  gap: "12px",
  alignItems: "center",
  padding: "10px 12px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
};

const monoStyle: CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  fontSize: "12px",
  color: "var(--text-soft)",
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function SystemTimersCard({
  timers = [],
  loading = false,
  error = null,
}: SystemTimersCardProps): ReactElement {
  return (
    <section style={cardStyle} data-testid="system-timers-card" aria-label="System timers">
      <div>
        <h2 style={titleStyle}>System timers</h2>
        <p style={hintStyle}>
          Built-in timers that ship with the portal. These are read-only and cannot be
          edited or deleted.
        </p>
      </div>

      {loading && <div style={{ color: "var(--text-soft)" }}>Loading system timers...</div>}

      {error && (
        <div style={{ padding: "12px", background: "var(--danger-soft)", border: "1px solid var(--danger)", borderRadius: "6px", color: "var(--danger-text)" }} role="alert">
          {error}
        </div>
      )}

      {!loading && !error && (
        <ul style={listStyle}>
          {timers.map((timer) => (
            <li key={timer.name} style={rowStyle} data-testid={`system-timer-${timer.name}`}>
              <span>
                <strong>{timer.name}</strong>
                <span style={{ ...monoStyle, marginLeft: "8px" }}>{timer.type}</span>
                {timer.command ? <span style={{ ...monoStyle, marginLeft: "8px" }}>{timer.command}</span> : null}
              </span>
              <span title={timer.cron}>
                {describeCronExpression(timer.cron)}
                <span style={{ ...monoStyle, display: "block" }}>{timer.cron}</span>
              </span>
              <span style={{ fontSize: "12px", color: "var(--text-soft)" }}>
                Next: {formatDateTime(timer.nextRunAt)}
              </span>
            </li>
          ))}
          {timers.length === 0 && (
            <li style={{ color: "var(--text-soft)" }} data-testid="empty-system-timers">
              No system timers registered.
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
