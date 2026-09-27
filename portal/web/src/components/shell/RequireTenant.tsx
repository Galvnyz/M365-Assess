"use client";

// Renders its children only once a tenant is chosen; otherwise asks for one. Pages that
// read or change a single tenant wrap their content in it rather than calling the BFF
// with no tenant (or a made-up one).

import type { ReactElement, ReactNode } from "react";

export interface RequireTenantProps {
  readonly tenantId: string;
  readonly children: ReactNode;
}

export function RequireTenant({ tenantId, children }: RequireTenantProps): ReactElement {
  if (tenantId) return <>{children}</>;
  return (
    <div
      data-testid="require-tenant"
      style={{
        margin: "48px auto",
        maxWidth: "520px",
        padding: "24px",
        textAlign: "center",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius, 10px)",
        background: "var(--surface)",
        color: "var(--text-soft)",
      }}
    >
      <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: "6px" }}>Select a tenant</div>
      Choose a tenant in the selector at the top of the page to see this view.
    </div>
  );
}
