"use client";

// Authentication Methods Policy Editor (EPIC-012 SPEC.md §3.3, T-0230).
// Offers preset selection, plan preview with current-vs-proposed diff,
// and confirmation-gated apply restricted by mfa.policy permission.
// Strictly uses report theme tokens with zero colour literals.

import React, { useState, type CSSProperties, type ReactElement } from "react";
import {
  previewAuthMethodsPolicy,
  applyAuthMethodsPolicy,
  type AuthMethodPresetId,
  type AuthMethodsPolicyPreview,
  type AuthMethodPolicyShape,
} from "../../lib/authMethodsApi";

export interface AuthMethodsPolicyEditorProps {
  readonly tenantId: string;
  readonly hasPolicyPermission?: boolean;
  readonly currentPolicy?: AuthMethodPolicyShape | null;
  readonly onApplySuccess?: (result: AuthMethodsPolicyPreview) => void;
}

const PRESET_OPTIONS: { id: AuthMethodPresetId; label: string; description: string }[] = [
  {
    id: "standard",
    label: "Standard (Enterprise Balanced)",
    description: "Enables Authenticator, FIDO2, passkey, Windows Hello, phone, OATH, and TAP; disables CBA and email.",
  },
  {
    id: "phishingResistantRequired",
    label: "Phishing-Resistant Required",
    description: "Enables FIDO2, passkey, Windows Hello, CBA, Authenticator, and TAP; disables phone, email, and software OATH.",
  },
  {
    id: "mfaRequired",
    label: "MFA Required",
    description: "Enables all MFA methods across the directory.",
  },
];

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

const selectStyle: CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
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
  color: "var(--accent-text)",
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

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "13px",
  textAlign: "left",
  marginTop: "8px",
};

const thStyle: CSSProperties = {
  padding: "10px 12px",
  background: "var(--surface)",
  borderBottom: "1px solid var(--border)",
  color: "var(--muted)",
  fontWeight: 600,
};

const tdStyle: CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--border)",
};

const badgeStyle: CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: "10px",
  fontSize: "11px",
  fontWeight: 600,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
};

export function AuthMethodsPolicyEditor({
  tenantId,
  hasPolicyPermission = true,
  currentPolicy: _currentPolicy,
  onApplySuccess,
}: AuthMethodsPolicyEditorProps): ReactElement {
  const [preset, setPreset] = useState<AuthMethodPresetId>("standard");
  const [preview, setPreview] = useState<AuthMethodsPolicyPreview | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handlePreview = async (): Promise<void> => {
    if (!tenantId.trim()) {
      setError("Please specify a tenant ID.");
      return;
    }
    setPreviewing(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await previewAuthMethodsPolicy(tenantId.trim(), { preset });
      setPreview(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewing(false);
    }
  };

  const handleApply = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!hasPolicyPermission) return;
    if (!reason.trim() || !confirmed) return;

    setApplying(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await applyAuthMethodsPolicy(tenantId.trim(), {
        preset,
        reason: reason.trim(),
        confirm: true,
      });
      setSuccess("Authentication methods policy successfully applied.");
      setPreview(res);
      onApplySuccess?.(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  };

  const applyDisabled =
    !hasPolicyPermission ||
    !preview ||
    !confirmed ||
    reason.trim().length === 0 ||
    applying;

  const applyDisabledTitle = !hasPolicyPermission
    ? "Requires 'mfa.policy' permission to apply policy changes"
    : !preview
      ? "Preview policy changes before applying"
      : !confirmed
        ? "Confirm the policy change to proceed"
        : reason.trim().length === 0
          ? "A reason is required to apply policy changes"
          : undefined;

  const selectedPresetInfo = PRESET_OPTIONS.find((p) => p.id === preset);

  return (
    <div style={containerStyle} data-testid="auth-methods-policy-editor">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h2 style={titleStyle}>Authentication Methods Policy</h2>
          <p style={{ margin: "4px 0 0", fontSize: "14px", color: "var(--muted)" }}>
            Select a target policy preset, review the current-vs-proposed diff, and apply changes.
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
            data-testid="permission-warning-badge"
          >
            Read-only mode: missing &apos;mfa.policy&apos; permission
          </div>
        )}
      </div>

      {error && (
        <div style={errorBannerStyle} role="alert" data-testid="policy-error-message">
          {error}
        </div>
      )}

      {success && (
        <div style={successBannerStyle} role="status" data-testid="policy-success-message">
          {success}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <label htmlFor="preset-select" style={{ fontSize: "13px", fontWeight: 600 }}>
          Target Policy Preset:
        </label>
        <select
          id="preset-select"
          value={preset}
          onChange={(e) => {
            setPreset(e.target.value as AuthMethodPresetId);
            setPreview(null);
            setSuccess(null);
          }}
          style={selectStyle}
          data-testid="preset-select"
        >
          {PRESET_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>

        {selectedPresetInfo && (
          <div style={{ fontSize: "13px", color: "var(--muted)" }} data-testid="preset-description">
            {selectedPresetInfo.description}
          </div>
        )}

        <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
          <button
            type="button"
            style={buttonStyle}
            onClick={() => void handlePreview()}
            disabled={previewing}
            data-testid="preview-policy-button"
          >
            {previewing ? "Previewing diff..." : "Preview Changes"}
          </button>
        </div>
      </div>

      {preview && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "12px" }}>
          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>Proposed Changes (Diff)</h3>

          {preview.diff.length === 0 ? (
            <div style={{ fontSize: "13px", color: "var(--muted)" }} data-testid="no-diff-message">
              No configuration changes detected between current tenant policy and selected preset.
            </div>
          ) : (
            <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: "6px" }}>
              <table style={tableStyle} data-testid="policy-diff-table">
                <thead>
                  <tr>
                    <th style={thStyle}>Authentication Method</th>
                    <th style={thStyle}>Current State</th>
                    <th style={thStyle}>Proposed State</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.diff.map((item) => (
                    <tr key={item.id} data-testid={`diff-row-${item.id}`}>
                      <td style={{ ...tdStyle, fontFamily: "var(--font-mono, monospace)" }}>{item.id}</td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            ...badgeStyle,
                            borderColor: item.before === "enabled" ? "var(--accent)" : "var(--border)",
                          }}
                        >
                          {item.before}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            ...badgeStyle,
                            borderColor: item.after === "enabled" ? "var(--accent)" : "var(--border)",
                          }}
                        >
                          {item.after}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <form onSubmit={(e) => void handleApply(e)} style={{ display: "flex", flexDirection: "column", gap: "14px", marginTop: "8px" }}>
            <div>
              <label htmlFor="policy-reason" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
                Reason for change (required):
              </label>
              <input
                id="policy-reason"
                type="text"
                placeholder="e.g. Align with CIS benchmark, baseline policy rollout"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                style={inputStyle}
                data-testid="policy-reason-input"
                required
              />
            </div>

            <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
              <input
                id="policy-confirm"
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                style={{ marginTop: "3px" }}
                data-testid="policy-confirm-checkbox"
              />
              <label htmlFor="policy-confirm" style={{ fontSize: "13px", lineHeight: 1.4 }}>
                I confirm applying this authentication methods policy to tenant {tenantId}.
              </label>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="submit"
                disabled={applyDisabled}
                title={applyDisabledTitle}
                style={{
                  ...primaryButtonStyle,
                  ...(applyDisabled ? { opacity: 0.6, cursor: "not-allowed" } : {}),
                }}
                data-testid="apply-policy-button"
              >
                {applying ? "Applying Policy..." : "Apply Policy"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
