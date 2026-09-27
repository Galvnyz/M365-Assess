"use client";

import React, { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import { TenantTable, type TenantItem } from "../../components/TenantTable";

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

const primaryButtonStyle: CSSProperties = {
  padding: "10px 18px",
  background: "var(--accent)",
  color: "var(--on-accent)",
  border: "1px solid var(--accent)",
  borderRadius: "6px",
  fontWeight: 600,
  fontSize: "14px",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
};

export default function TenantsPage(): ReactElement {
  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTenants = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/v1/tenants");
      if (!res.ok) {
        throw new Error(`Failed to load tenants: ${res.statusText}`);
      }
      const data = await res.json();
      setTenants(data.items ?? data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchTenants();
  }, []);

  const handleTestCredential = async (tenant: TenantItem): Promise<void> => {
    try {
      const res = await fetch(`/v1/tenants/${tenant.id}/test-connection`, { method: "POST" });
      if (!res.ok) {
        throw new Error("Test connection failed");
      }
      await fetchTenants();
    } catch (err) {
      alert(`Test connection failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleToggleExclude = async (tenant: TenantItem): Promise<void> => {
    try {
      const excluded = tenant.status !== "excluded";
      await fetch(`/v1/tenants/${tenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excluded }),
      });
      await fetchTenants();
    } catch (err) {
      alert(`Failed to update tenant status: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleRemove = async (tenant: TenantItem): Promise<void> => {
    if (!confirm(`Are you sure you want to remove tenant ${tenant.displayName ?? tenant.id}?`)) {
      return;
    }
    try {
      await fetch(`/v1/tenants/${tenant.id}`, { method: "DELETE" });
      await fetchTenants();
    } catch (err) {
      alert(`Failed to delete tenant: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div style={pageStyle} data-testid="tenants-page">
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>Tenants</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-soft)", fontSize: "14px" }}>
            Manage registered Microsoft 365 tenants, credentials, and connectivity.
          </p>
        </div>
        <a href="/tenants/new" style={primaryButtonStyle} data-testid="add-tenant-btn">
          Add tenant
        </a>
      </div>

      <TenantTable
        tenants={tenants}
        loading={loading}
        error={error}
        onView={(t) => {
          window.location.href = `/tenants/${t.id}`;
        }}
        onTestCredential={handleTestCredential}
        onToggleExclude={handleToggleExclude}
        onRemove={handleRemove}
      />
    </div>
  );
}
