"use client";

// Shell top bar holding the global tenant selector. The chosen tenant is stored by
// tenant-preference.ts and read by pages through useCurrentTenantId().

import { useEffect, useState, type ReactElement } from "react";
import { TenantSelector, type TenantItem } from "../TenantSelector";

export function TenantBar(): ReactElement {
  const [tenants, setTenants] = useState<TenantItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/v1/tenants?limit=200")
      .then(async (res) => {
        if (!res.ok) throw new Error(`tenants request failed (${res.status})`);
        const body = (await res.json()) as { items?: TenantItem[] };
        if (!cancelled) setTenants(body.items ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      data-testid="tenant-bar"
      style={{
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        gap: "12px",
        padding: "12px 0",
        borderBottom: "1px solid var(--border)",
        minHeight: "58px",
      }}
    >
      {error && <span style={{ color: "var(--muted)", fontSize: "13px" }}>Tenants unavailable: {error}</span>}
      {/* Rendered after the tenant list loads, which is also after hydration: the selector
          reads the stored tenant from localStorage when it mounts. */}
      {tenants && (
        <TenantSelector tenants={tenants} showFleetOption fleetOptionLabel="All tenants" />
      )}
    </div>
  );
}
