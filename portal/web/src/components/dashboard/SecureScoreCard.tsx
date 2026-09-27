"use client";

// SecureScoreCard widget (EPIC-004 SPEC.md §3.1, §4.1, T-0065).
// Displays Microsoft Secure Score percentage, points, evaluated controls count, and progress bar.
// Renders empty-state affordance prompting an assessment run when no data exists.
// Strictly uses report theme tokens with zero colour literals.

import React, { type CSSProperties, type ReactElement } from "react";
import { WidgetCard } from "./WidgetCard";

export interface SecureScoreWidget {
  readonly current: number;
  readonly max: number;
  readonly percentage: number;
  readonly evaluatedCount: number;
}

export interface SecureScoreCardProps {
  readonly score?: SecureScoreWidget | null;
  readonly isEmpty?: boolean;
  readonly onDrillDown?: () => void;
  readonly onRunAssessment?: () => void;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export function SecureScoreCard(props: SecureScoreCardProps): ReactElement {
  const { score, isEmpty = false, onDrillDown, onRunAssessment, className, style } = props;

  const percentage = score ? Math.round(score.percentage) : 0;
  const current = score?.current ?? 0;
  const max = score?.max ?? 0;
  const evaluated = score?.evaluatedCount ?? 0;

  return (
    <WidgetCard
      title="Secure Score"
      subtitle="Microsoft Secure Score posture"
      isEmpty={isEmpty || !score}
      emptyMessage="No Secure Score data available. Run an assessment to evaluate controls."
      onRunAssessment={onRunAssessment}
      onDrillDown={onDrillDown}
      drillDownLabel="View controls →"
      testId="widget-secure-score-card"
      className={className}
      style={style}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        {/* Headline Score Numeral */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div
            data-testid="secure-score-percentage"
            style={{
              fontSize: "44px",
              fontWeight: 800,
              lineHeight: 1,
              background: "var(--accent-grad, var(--accent))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              color: "var(--accent)",
              fontFamily: "var(--font-display, var(--font-sans))",
            }}
          >
            {percentage}%
          </div>
          <div
            data-testid="secure-score-points"
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: "var(--text-soft)",
              marginTop: "6px",
            }}
          >
            {current} / {max} pts
          </div>
        </div>

        {/* Progress Bar */}
        <div
          style={{
            width: "100%",
            height: "8px",
            background: "var(--track)",
            borderRadius: "999px",
            overflow: "hidden",
          }}
        >
          <div
            data-testid="secure-score-progress-bar"
            style={{
              width: `${Math.min(100, Math.max(0, percentage))}%`,
              height: "100%",
              background: "var(--accent)",
              borderRadius: "999px",
              transition: "width 0.3s ease",
            }}
          />
        </div>

        {/* Evaluated Controls Pill */}
        <div
          data-testid="secure-score-evaluated"
          style={{
            fontSize: "12px",
            color: "var(--muted)",
            background: "var(--subtle)",
            border: "1px solid var(--border)",
            borderRadius: "999px",
            padding: "4px 12px",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          {evaluated} controls evaluated
        </div>
      </div>
    </WidgetCard>
  );
}
