"use client";

// Registration Campaign Panel (EPIC-012 SPEC.md §3.4, T-0230).
// Configures Microsoft Authenticator registration campaign toggle,
// snooze days, include/exclude targets, and displays eligible user count.
// Write actions are gated by mfa.policy permission.
// Strictly uses report theme tokens with zero colour literals.

import React, { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import {
  fetchRegistrationCampaign,
  updateRegistrationCampaign,
  type CampaignState,
  type RegistrationCampaignState,
} from "../../lib/authMethodsApi";

export interface RegistrationCampaignPanelProps {
  readonly tenantId: string;
  readonly initialCampaign?: RegistrationCampaignState | null;
  readonly hasPolicyPermission?: boolean;
  readonly onUpdateSuccess?: (result: RegistrationCampaignState) => void;
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "20px",
  padding: "24px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  color: "var(--text)",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "20px",
  fontWeight: 700,
};

const inputStyle: CSSProperties = {
  padding: "8px 12px",
  background: "var(--input-bg, var(--bg))",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "14px",
  width: "100%",
  boxSizing: "border-box",
};

const buttonStyle: CSSProperties = {
  padding: "8px 16px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "14px",
  fontWeight: 500,
  cursor: "pointer",
};

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "var(--accent)",
  color: "var(--on-accent)",
  borderColor: "var(--accent)",
};

const bannerStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: "6px",
  fontSize: "13px",
  lineHeight: 1.4,
};

const errorBannerStyle: CSSProperties = {
  ...bannerStyle,
  background: "var(--danger-soft)",
  border: "1px solid var(--danger)",
  color: "var(--danger-text)",
};

const successBannerStyle: CSSProperties = {
  ...bannerStyle,
  background: "var(--success-soft)",
  border: "1px solid var(--success)",
  color: "var(--success-text)",
};

const kpiCardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  padding: "14px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  minWidth: "160px",
};

export function RegistrationCampaignPanel({
  tenantId,
  initialCampaign = null,
  hasPolicyPermission = true,
  onUpdateSuccess,
}: RegistrationCampaignPanelProps): ReactElement {
  const [campaign, setCampaign] = useState<RegistrationCampaignState | null>(initialCampaign);
  const [state, setState] = useState<CampaignState>(initialCampaign?.state ?? "disabled");
  const [snoozeDays, setSnoozeDays] = useState<number>(initialCampaign?.snoozeDurationInDays ?? 1);
  const [includeTargets, setIncludeTargets] = useState<string>(
    initialCampaign?.includeTargets.join(", ") ?? "all_users",
  );
  const [excludeTargets, setExcludeTargets] = useState<string>(
    initialCampaign?.excludeTargets.join(", ") ?? "",
  );
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (initialCampaign) {
      setCampaign(initialCampaign);
      setState(initialCampaign.state);
      setSnoozeDays(initialCampaign.snoozeDurationInDays);
      setIncludeTargets(initialCampaign.includeTargets.join(", "));
      setExcludeTargets(initialCampaign.excludeTargets.join(", "));
    } else if (tenantId.trim()) {
      void loadCampaign(tenantId);
    }
  }, [initialCampaign, tenantId]);

  const loadCampaign = async (tenant: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRegistrationCampaign(tenant.trim());
      setCampaign(data);
      setState(data.state);
      setSnoozeDays(data.snoozeDurationInDays);
      setIncludeTargets(data.includeTargets.join(", "));
      setExcludeTargets(data.excludeTargets.join(", "));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const parseTargetList = (input: string): string[] => {
    return input
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  };

  const handleUpdate = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!hasPolicyPermission) return;
    if (!reason.trim()) return;

    setUpdating(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await updateRegistrationCampaign(tenantId.trim(), {
        state,
        snoozeDurationInDays: Number(snoozeDays),
        includeTargets: parseTargetList(includeTargets),
        excludeTargets: parseTargetList(excludeTargets),
        reason: reason.trim(),
        confirm: true,
      });
      setCampaign(res);
      setSuccess(`Registration campaign successfully updated to '${res.state}'.`);
      onUpdateSuccess?.(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdating(false);
    }
  };

  const updateDisabled =
    !hasPolicyPermission ||
    reason.trim().length === 0 ||
    updating;

  const updateDisabledTitle = !hasPolicyPermission
    ? "Requires 'mfa.policy' permission to update registration campaign"
    : reason.trim().length === 0
      ? "A reason is required to update campaign configuration"
      : undefined;

  return (
    <div style={containerStyle} data-testid="registration-campaign-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h2 style={titleStyle}>Registration Campaign</h2>
          <p style={{ margin: "4px 0 0", fontSize: "14px", color: "var(--muted)" }}>
            Prompt users to set up the Microsoft Authenticator app during sign-in.
          </p>
        </div>

        {!hasPolicyPermission && (
          <div
            style={{
              padding: "4px 10px",
              borderRadius: "4px",
              background: "var(--warning-soft)",
              border: "1px solid var(--warning)",
              color: "var(--warning-text)",
              fontSize: "12px",
              fontWeight: 600,
            }}
            data-testid="campaign-permission-badge"
          >
            Read-only mode: missing &apos;mfa.policy&apos; permission
          </div>
        )}
      </div>

      {error && (
        <div style={errorBannerStyle} role="alert" data-testid="campaign-error-message">
          {error}
        </div>
      )}

      {success && (
        <div style={successBannerStyle} role="status" data-testid="campaign-success-message">
          {success}
        </div>
      )}

      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
        <div style={kpiCardStyle}>
          <span style={{ fontSize: "12px", color: "var(--muted)", textTransform: "uppercase" }}>Campaign State</span>
          <span style={{ fontSize: "20px", fontWeight: 700 }} data-testid="campaign-state-display">
            {loading ? "Loading..." : campaign?.state ?? "N/A"}
          </span>
        </div>

        <div style={kpiCardStyle}>
          <span style={{ fontSize: "12px", color: "var(--muted)", textTransform: "uppercase" }}>Eligible Users</span>
          <span style={{ fontSize: "20px", fontWeight: 700 }} data-testid="eligible-user-count">
            {loading ? "..." : campaign?.eligibleUserCount ?? 0}
          </span>
        </div>
      </div>

      <form onSubmit={(e) => void handleUpdate(e)} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <input
            id="campaign-toggle"
            type="checkbox"
            checked={state === "enabled"}
            onChange={(e) => setState(e.target.checked ? "enabled" : "disabled")}
            data-testid="campaign-toggle"
          />
          <label htmlFor="campaign-toggle" style={{ fontSize: "14px", fontWeight: 600 }}>
            Enable Microsoft Authenticator Registration Campaign
          </label>
        </div>

        <div>
          <label htmlFor="campaign-snooze" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
            Snooze duration (days):
          </label>
          <input
            id="campaign-snooze"
            type="number"
            min={1}
            max={14}
            value={snoozeDays}
            onChange={(e) => setSnoozeDays(Number(e.target.value))}
            style={inputStyle}
            data-testid="campaign-snooze-input"
            required
          />
          <span style={{ fontSize: "12px", color: "var(--muted)" }}>Number of days before user is reprompted (1 to 14 days).</span>
        </div>

        <div>
          <label htmlFor="campaign-include" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
            Include targets (comma-separated group IDs or &apos;all_users&apos;):
          </label>
          <input
            id="campaign-include"
            type="text"
            value={includeTargets}
            onChange={(e) => setIncludeTargets(e.target.value)}
            style={inputStyle}
            data-testid="campaign-include-targets"
            required
          />
        </div>

        <div>
          <label htmlFor="campaign-exclude" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
            Exclude targets (optional comma-separated group IDs):
          </label>
          <input
            id="campaign-exclude"
            type="text"
            placeholder="e.g. group-id-1, group-id-2"
            value={excludeTargets}
            onChange={(e) => setExcludeTargets(e.target.value)}
            style={inputStyle}
            data-testid="campaign-exclude-targets"
          />
        </div>

        <div>
          <label htmlFor="campaign-reason" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
            Reason for update (required):
          </label>
          <input
            id="campaign-reason"
            type="text"
            placeholder="e.g. Expand campaign to all employees"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={inputStyle}
            data-testid="campaign-reason-input"
            required
          />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "6px" }}>
          <button
            type="submit"
            disabled={updateDisabled}
            title={updateDisabledTitle}
            style={{
              ...primaryButtonStyle,
              ...(updateDisabled ? { opacity: 0.6, cursor: "not-allowed" } : {}),
            }}
            data-testid="campaign-submit-button"
          >
            {updating ? "Saving..." : "Save Campaign Settings"}
          </button>
        </div>
      </form>
    </div>
  );
}
