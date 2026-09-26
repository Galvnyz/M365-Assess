"use client";

// Offboarding page (EPIC-011 SPEC.md §3.4, T-0210).
// Hosts the OffboardingWizard: tenant selection, multi-user selection,
// options with mailbox access, confirmation with live per-step progress and
// re-run, plus the filterable past-jobs list. Strictly uses report theme
// tokens with zero colour literals.

import React, { type CSSProperties, type ReactElement } from "react";
import { OffboardingWizard } from "../../components/offboarding/OffboardingWizard";

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
  alignItems: "center",
  borderBottom: "1px solid var(--border)",
  paddingBottom: "16px",
};

const titleStyle: CSSProperties = {
  fontSize: "24px",
  fontWeight: 700,
  margin: 0,
  fontFamily: "var(--font-display, var(--font-sans))",
};

export interface OffboardingPageProps {
  readonly searchParams?: Promise<Record<string, string>> | Record<string, string>;
}

export default function OffboardingPage(props: OffboardingPageProps): ReactElement {
  const params =
    props.searchParams && typeof (props.searchParams as Promise<Record<string, string>>).then === "function"
      ? undefined
      : (props.searchParams as Record<string, string> | undefined);
  const preselected = params?.["userId"] ? [params["userId"]] : [];

  return (
    <div style={pageStyle} data-testid="offboarding-page">
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>Offboarding wizard</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-soft)", fontSize: "14px" }}>
            Guided, resumable offboarding with per-step progress and re-run.
          </p>
        </div>
      </div>
      <OffboardingWizard initialUserIds={preselected} />
    </div>
  );
}
