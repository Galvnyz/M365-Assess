"use client";

// MFACard widget (EPIC-004 SPEC.md §3.1, §4.1, T-0065).
// Displays MFA adoption, registration percentage, total users, and admin MFA enforcement.
// Renders empty-state affordance prompting an assessment run when no data exists.
// Strictly uses report theme tokens with zero colour literals.

import React, { type CSSProperties, type ReactElement } from "react";
import { WidgetCard } from "./WidgetCard";

export interface MFAWidget {
  readonly enforcedPercentage: number;
  readonly registeredCount: number;
  readonly totalUsers: number;
  readonly adminMfaPercentage?: number;
}

export interface MFACardProps {
  readonly mfa?: MFAWidget | null;
  readonly isEmpty?: boolean;
  readonly onDrillDown?: () => void;
  readonly onRunAssessment?: () => void;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export function MFACard(props: MFACardProps): ReactElement {
  const { mfa, isEmpty = false, onDrillDown, onRunAssessment, className, style } = props;

  const enforcedPercentage = mfa ? Math.round(mfa.enforcedPercentage) : 0;
  const registeredCount = mfa?.registeredCount ?? 0;
  const totalUsers = mfa?.totalUsers ?? 0;
  const adminPercentage = mfa?.adminMfaPercentage !== undefined ? Math.round(mfa.adminMfaPercentage) : null;

  return (
    <WidgetCard
      title="MFA Adoption"
      subtitle="MFA registration & enforcement"
      isEmpty={isEmpty || !mfa}
      emptyMessage="No MFA telemetry available. Run an assessment to evaluate user posture."
      onRunAssessment={onRunAssessment}
      onDrillDown={onDrillDown}
      drillDownLabel="View MFA details →"
      testId="widget-mfa-card"
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
        {/* Headline Enforced Percentage */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div
            data-testid="mfa-enforced-percentage"
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
            {enforcedPercentage}%
          </div>
          <div
            data-testid="mfa-registered-users"
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: "var(--text-soft)",
              marginTop: "6px",
            }}
          >
            {registeredCount} of {totalUsers} users registered
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
            data-testid="mfa-progress-bar"
            style={{
              width: `${Math.min(100, Math.max(0, enforcedPercentage))}%`,
              height: "100%",
              background: "var(--accent)",
              borderRadius: "999px",
              transition: "width 0.3s ease",
            }}
          />
        </div>

        {/* Admin MFA stat pill or overall status */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
            justifyContent: "center",
            width: "100%",
          }}
        >
          {adminPercentage !== null && (
            <span
              data-testid="mfa-admin-percentage"
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: adminPercentage >= 100 ? "var(--success-text)" : "var(--warn-text)",
                background: adminPercentage >= 100 ? "var(--success-soft)" : "var(--warn-soft)",
                border: adminPercentage >= 100 ? "1px solid var(--success)" : "1px solid var(--warn)",
                borderRadius: "999px",
                padding: "3px 10px",
              }}
            >
              {adminPercentage}% admin MFA
            </span>
          )}
          <span
            data-testid="mfa-status-pill"
            style={{
              fontSize: "12px",
              color: "var(--muted)",
              background: "var(--subtle)",
              border: "1px solid var(--border)",
              borderRadius: "999px",
              padding: "3px 10px",
            }}
          >
            {totalUsers} total accounts
          </span>
        </div>
      </div>
    </WidgetCard>
  );
}
