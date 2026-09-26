"use client";

// User detail page (EPIC-011 SPEC.md §3.2, T-0210).
// Loads the user live from the directory read and renders UserDetailTabs
// (View · Edit · Exchange · OneDrive shortcuts · BEC · Conditional Access).
// The BEC tab runs the 11-check review with per-finding remediate actions.
// Strictly uses report theme tokens with zero colour literals.

import React, { use, useCallback, useEffect, useState, type CSSProperties, type ReactElement } from "react";
import { UserDetailTabs, type UserDetailTabId } from "../../../components/users/UserDetailTabs";
import { listTenantUsers, type TenantUser } from "../../../lib/usersApi";
import {
  listBecFindings,
  remediateBecFinding,
  runBecCheck,
  type BecCheck,
  type BecFinding,
} from "../../../lib/offboardingApi";

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

const titleStyle: CSSProperties = {
  fontSize: "24px",
  fontWeight: 700,
  margin: 0,
  fontFamily: "var(--font-display, var(--font-sans))",
};

const inputStyle: CSSProperties = {
  padding: "8px 12px",
  background: "var(--input-bg, var(--bg))",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "14px",
};

const buttonStyle: CSSProperties = {
  padding: "8px 14px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "14px",
  fontWeight: 500,
  cursor: "pointer",
};

export interface UserDetailPageProps {
  readonly params: Promise<{ id: string }> | { id: string };
  readonly searchParams?: Promise<Record<string, string>> | Record<string, string>;
}

export default function UserDetailPage(props: UserDetailPageProps): ReactElement {
  const resolvedParams =
    typeof (props.params as Promise<{ id: string }>).then === "function"
      ? use(props.params as Promise<{ id: string }>)
      : (props.params as { id: string });
  const userId = decodeURIComponent(resolvedParams.id);

  const [tenantId, setTenantId] = useState("");
  const [user, setUser] = useState<TenantUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<UserDetailTabId>("view");
  const [becChecks, setBecChecks] = useState<BecCheck[]>([]);
  const [becFindings, setBecFindings] = useState<BecFinding[]>([]);
  const [becLoading, setBecLoading] = useState(false);
  const [becError, setBecError] = useState<string | null>(null);
  const [becRemediatingId, setBecRemediatingId] = useState<string | null>(null);

  const fetchUser = useCallback(
    async (tenant: string): Promise<void> => {
      if (!tenant.trim()) {
        setError("Enter a tenant id to load the user.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const page = await listTenantUsers(tenant.trim(), { search: userId, limit: 100 });
        const match =
          page.items.find((item) => item.id === userId || item.userPrincipalName.toLowerCase() === userId.toLowerCase()) ??
          page.items[0] ??
          null;
        if (!match) {
          setError(`User ${userId} was not found in tenant ${tenant.trim()}.`);
          setUser(null);
          return;
        }
        setUser(match);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [userId],
  );

  const handleRunBecCheck = useCallback(async (): Promise<void> => {
    const tenant = tenantId.trim();
    if (!tenant || !user) return;
    setBecLoading(true);
    setBecError(null);
    try {
      const outcome = await runBecCheck(tenant, user.id);
      setBecChecks([...outcome.checks]);
      setBecFindings([...outcome.findings]);
    } catch (err) {
      setBecError(err instanceof Error ? err.message : String(err));
    } finally {
      setBecLoading(false);
    }
  }, [tenantId, user]);

  const handleRemediate = useCallback(
    async (finding: BecFinding): Promise<void> => {
      const tenant = tenantId.trim();
      if (!tenant || !user) return;
      setBecRemediatingId(finding.id);
      try {
        await remediateBecFinding(tenant, user.id, finding.id);
        const refreshed = await listBecFindings(tenant, user.id);
        setBecFindings([...refreshed.findings]);
      } catch (err) {
        setBecError(err instanceof Error ? err.message : String(err));
      } finally {
        setBecRemediatingId(null);
      }
    },
    [tenantId, user],
  );

  useEffect(() => {
    const params = props.searchParams;
    if (!params) return;
    const read = (record: Record<string, string>): string | null => record["tab"] ?? null;
    if (typeof (params as Promise<Record<string, string>>).then === "function") {
      void (params as Promise<Record<string, string>>).then((record) => {
        if (read(record) === "bec") setTab("bec");
      });
    } else if (read(params as Record<string, string>) === "bec") {
      setTab("bec");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={pageStyle} data-testid="user-detail-page">
      <div>
        <a href="/users" style={{ ...buttonStyle, textDecoration: "none" }}>
          ← Users
        </a>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <h1 style={titleStyle}>{user ? (user.displayName ?? user.userPrincipalName) : "User detail"}</h1>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <input
            type="text"
            placeholder="Tenant id..."
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            style={inputStyle}
            aria-label="Tenant id"
            data-testid="user-detail-tenant-input"
          />
          <button type="button" style={buttonStyle} onClick={() => void fetchUser(tenantId)} data-testid="user-detail-load-button">
            Load
          </button>
        </div>
      </div>

      {loading && <div style={{ color: "var(--text-soft)" }}>Loading user...</div>}
      {error && (
        <div
          style={{
            padding: "16px",
            borderRadius: "6px",
            background: "var(--danger-soft)",
            border: "1px solid var(--danger)",
            color: "var(--danger-text)",
          }}
          role="alert"
        >
          {error}
        </div>
      )}

      {user && (
        <UserDetailTabs
          user={user}
          activeTab={tab}
          onTabChange={setTab}
          becChecks={becChecks}
          becFindings={becFindings}
          becLoading={becLoading}
          becError={becError}
          onRunBecCheck={() => void handleRunBecCheck()}
          onRemediateBecFinding={(finding) => void handleRemediate(finding)}
          becRemediatingId={becRemediatingId}
        />
      )}
    </div>
  );
}
