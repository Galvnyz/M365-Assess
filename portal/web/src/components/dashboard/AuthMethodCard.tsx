"use client";

// AuthMethodCard widget (EPIC-004 SPEC.md §3.1, §4.1, T-0065).
// Displays authentication methods mix: phishing-resistant, Authenticator app, SMS/voice, and password-only.
// Renders empty-state affordance prompting an assessment run when no data exists.
// Strictly uses report theme tokens with zero colour literals.

import React, { type CSSProperties, type ReactElement } from "react";
import { WidgetCard } from "./WidgetCard";

export interface AuthMethodWidget {
  readonly phishingResistant: number;
  readonly authenticatorApp: number;
  readonly smsOrVoice: number;
  readonly passwordOnly: number;
  readonly totalUsers: number;
}

export interface AuthMethodCardProps {
  readonly authMethods?: AuthMethodWidget | null;
  readonly isEmpty?: boolean;
  readonly onDrillDown?: (method?: string) => void;
  readonly onRunAssessment?: () => void;
  readonly className?: string;
  readonly style?: CSSProperties;
}

interface MethodItemConfig {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly tokenColor: string;
  readonly tokenSoft: string;
  readonly tokenText: string;
  readonly testId: string;
}

export function AuthMethodCard(props: AuthMethodCardProps): ReactElement {
  const { authMethods, isEmpty = false, onDrillDown, onRunAssessment, className, style } = props;

  const total = authMethods?.totalUsers ?? 0;

  const methods: MethodItemConfig[] = [
    {
      key: "phishing-resistant",
      label: "Phishing-Resistant (FIDO2 / CBA)",
      count: authMethods?.phishingResistant ?? 0,
      tokenColor: "var(--success)",
      tokenSoft: "var(--success-soft)",
      tokenText: "var(--success-text)",
      testId: "auth-method-phishing-resistant",
    },
    {
      key: "authenticator",
      label: "Authenticator App (Push / TOTP)",
      count: authMethods?.authenticatorApp ?? 0,
      tokenColor: "var(--accent)",
      tokenSoft: "var(--accent-soft)",
      tokenText: "var(--accent-text)",
      testId: "auth-method-authenticator",
    },
    {
      key: "sms-voice",
      label: "SMS / Voice",
      count: authMethods?.smsOrVoice ?? 0,
      tokenColor: "var(--warn)",
      tokenSoft: "var(--warn-soft)",
      tokenText: "var(--warn-text)",
      testId: "auth-method-sms-voice",
    },
    {
      key: "password-only",
      label: "Password Only (No MFA)",
      count: authMethods?.passwordOnly ?? 0,
      tokenColor: "var(--danger)",
      tokenSoft: "var(--danger-soft)",
      tokenText: "var(--danger-text)",
      testId: "auth-method-password-only",
    },
  ];

  return (
    <WidgetCard
      title="Authentication Methods"
      subtitle="Auth method distribution & strength"
      isEmpty={isEmpty || !authMethods}
      emptyMessage="No auth method distribution data available. Run an assessment to analyze credentials."
      onRunAssessment={onRunAssessment}
      onDrillDown={() => onDrillDown?.()}
      drillDownLabel="View auth methods →"
      testId="widget-auth-method-card"
      className={className}
      style={style}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {/* Total Users Eyebrow */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "12px",
            color: "var(--muted)",
          }}
        >
          <span>Method Distribution</span>
          <span
            data-testid="auth-method-total-users"
            style={{ fontWeight: 600, color: "var(--text)" }}
          >
            {total} users
          </span>
        </div>

        {/* Stacked Distribution Bar */}
        <div
          data-testid="auth-method-distribution-bar"
          style={{
            display: "flex",
            width: "100%",
            height: "8px",
            borderRadius: "999px",
            overflow: "hidden",
            background: "var(--track)",
          }}
        >
          {methods.map((m) => {
            const pct = total > 0 ? (m.count / total) * 100 : 0;
            if (pct <= 0) return null;
            return (
              <div
                key={m.key}
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  background: m.tokenColor,
                }}
                title={`${m.label}: ${m.count} (${Math.round(pct)}%)`}
              />
            );
          })}
        </div>

        {/* Breakdown List */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {methods.map((m) => {
            const pct = total > 0 ? Math.round((m.count / total) * 100) : 0;
            return (
              <div
                key={m.key}
                data-testid={m.testId}
                onClick={() => onDrillDown?.(m.key)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "6px 8px",
                  borderRadius: "var(--radius, 6px)",
                  background: "var(--subtle)",
                  cursor: onDrillDown ? "pointer" : "default",
                  fontSize: "12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: m.tokenColor,
                      display: "inline-block",
                    }}
                  />
                  <span style={{ color: "var(--text)" }}>{m.label}</span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontWeight: 600, color: "var(--text)" }}>{m.count}</span>
                  <span
                    style={{
                      fontSize: "11px",
                      padding: "1px 6px",
                      borderRadius: "999px",
                      background: m.tokenSoft,
                      color: m.tokenText,
                      fontWeight: 600,
                    }}
                  >
                    {pct}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </WidgetCard>
  );
}
