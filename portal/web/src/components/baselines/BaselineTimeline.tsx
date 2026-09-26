"use client";

// Baseline builder timeline (EPIC-010 SPEC.md §3.3; T-0183).
// The three setup steps — Set a baseline name → Assign tenants or groups →
// Add standards to at least one stage — with done/current/todo states. The
// page derives each step's state from the draft and disables save until all
// three are done. Zero colour literals: report theme tokens only.

import React, { type CSSProperties, type ReactElement } from "react";

export type TimelineStepState = "done" | "current" | "todo";

export interface BaselineTimelineStep {
  readonly id: "name" | "assign" | "standards";
  readonly label: string;
  readonly state: TimelineStepState;
}

export interface BaselineTimelineProps {
  readonly steps: readonly BaselineTimelineStep[];
  readonly onSelect?: (step: BaselineTimelineStep["id"]) => void;
}

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  margin: 0,
  padding: 0,
  listStyle: "none",
};

const stepStyle = (state: TimelineStepState): CSSProperties => ({
  display: "flex",
  gap: "10px",
  alignItems: "center",
  padding: "8px 10px",
  borderRadius: "6px",
  background: state === "current" ? "var(--accent-soft)" : "transparent",
  color: state === "todo" ? "var(--text-soft)" : "var(--text)",
  fontWeight: state === "current" ? 600 : 500,
  fontSize: "14px",
  cursor: "pointer",
  border: "none",
  width: "100%",
  textAlign: "left",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
});

const markerStyle = (state: TimelineStepState): CSSProperties => ({
  width: "22px",
  height: "22px",
  borderRadius: "50%",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "12px",
  fontWeight: 700,
  flexShrink: 0,
  background:
    state === "done" ? "var(--success-soft)" : state === "current" ? "var(--accent)" : "var(--surface)",
  color:
    state === "done"
      ? "var(--success-text)"
      : state === "current"
        ? "var(--accent-text)"
        : "var(--text-soft)",
  border: "1px solid var(--border)",
});

export const BASELINE_TIMELINE_STEPS: readonly { id: BaselineTimelineStep["id"]; label: string }[] = [
  { id: "name", label: "Set a baseline name" },
  { id: "assign", label: "Assign tenants or groups" },
  { id: "standards", label: "Add standards to at least one stage" },
];

export function BaselineTimeline({ steps, onSelect }: BaselineTimelineProps): ReactElement {
  return (
    <ol style={listStyle} data-testid="baseline-timeline">
      {steps.map((step, index) => (
        <li key={step.id}>
          <button
            type="button"
            style={stepStyle(step.state)}
            data-testid={`timeline-step-${step.id}`}
            data-state={step.state}
            onClick={() => onSelect?.(step.id)}
          >
            <span style={markerStyle(step.state)} data-testid={`timeline-marker-${step.id}`}>
              {step.state === "done" ? "✓" : index + 1}
            </span>
            {step.label}
          </button>
        </li>
      ))}
    </ol>
  );
}
