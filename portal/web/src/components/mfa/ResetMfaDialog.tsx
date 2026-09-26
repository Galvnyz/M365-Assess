"use client";

// Reset MFA action dialog (EPIC-012 SPEC.md §3.2, T-0229).
// Supports single-user reset and batch/bulk reset with gated confirmation.
// Single reset requires a non-empty reason and confirmation checkbox.
// Batch reset requires reason, confirmation checkbox, and count confirmation (EPIC-006 pattern).
// Inline success/failure feedback per action.
// Strictly uses report theme tokens with zero colour literals.

import React, { useState, type CSSProperties, type ReactElement } from "react";
import {
  resetUserMfa,
  bulkResetMfa,
  type MfaResetResult,
  type MfaBulkResetResponse,
} from "../../lib/mfaApi";

export interface ResetMfaTargetUser {
  readonly userId: string;
  readonly userPrincipalName: string;
  readonly displayName?: string | null;
}

export interface ResetMfaDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly tenantId: string;
  readonly targetUsers: readonly ResetMfaTargetUser[];
  readonly onSuccess?: (result: MfaResetResult | MfaBulkResetResponse) => void;
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--overlay)",
  zIndex: 60,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const dialogStyle: CSSProperties = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  padding: "24px",
  width: "min(560px, 92vw)",
  maxHeight: "90vh",
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  color: "var(--text)",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "20px",
  fontWeight: 700,
};

const warningBannerStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: "6px",
  background: "var(--warning-soft)",
  border: "1px solid var(--warning)",
  color: "var(--warning-text)",
  fontSize: "13px",
  lineHeight: 1.4,
};

const errorBannerStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: "6px",
  background: "var(--danger-soft)",
  border: "1px solid var(--danger)",
  color: "var(--danger-text)",
  fontSize: "13px",
};

const successBannerStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: "6px",
  background: "var(--success-soft)",
  border: "1px solid var(--success)",
  color: "var(--success-text)",
  fontSize: "13px",
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

const submitButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "var(--accent)",
  color: "var(--accent-text)",
  borderColor: "var(--accent)",
};

export function ResetMfaDialog({
  isOpen,
  onClose,
  tenantId,
  targetUsers,
  onSuccess,
}: ResetMfaDialogProps): ReactElement | null {
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [countInput, setCountInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) {
    return null;
  }

  const isBatch = targetUsers.length > 1;
  const countMatches = !isBatch || countInput.trim() === String(targetUsers.length);
  const canSubmit =
    reason.trim().length > 0 &&
    confirmed &&
    countMatches &&
    !loading &&
    targetUsers.length > 0;

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!canSubmit) return;

    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      if (isBatch) {
        const userIds = targetUsers.map((u) => u.userId);
        const res = await bulkResetMfa(tenantId, {
          userIds,
          reason: reason.trim(),
          confirmCount: targetUsers.length,
          confirm: true,
        });
        setSuccessMessage(`MFA reset applied to ${res.summary.applied} users.`);
        onSuccess?.(res);
      } else {
        const target = targetUsers[0];
        if (!target) {
          throw new Error("No user selected.");
        }
        const res = await resetUserMfa(tenantId, target.userId, {
          reason: reason.trim(),
          confirm: true,
        });
        if (res.status === "failed") {
          setError(res.error || "Reset failed without detail.");
        } else {
          setSuccessMessage(`MFA methods reset for ${target.userPrincipalName}. Re-registration required.`);
          onSuccess?.(res);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Reset MFA" data-testid="reset-mfa-dialog">
      <div style={dialogStyle}>
        <h2 style={titleStyle}>{isBatch ? "Reset MFA (Batch)" : "Reset MFA"}</h2>

        <div style={warningBannerStyle} data-testid="reset-mfa-warning">
          <strong>Warning:</strong> Resetting MFA will delete all registered authentication methods
          for the affected {isBatch ? `${targetUsers.length} users` : "user"}. They will be required
          to re-register authentication methods on their next sign-in.
        </div>

        <div style={{ fontSize: "14px", color: "var(--muted)" }}>
          {isBatch ? (
            <span>
              Target users: <strong>{targetUsers.length} users selected</strong>
            </span>
          ) : (
            <span>
              Target user:{" "}
              <strong>
                {targetUsers[0]?.displayName
                  ? `${targetUsers[0].displayName} (${targetUsers[0].userPrincipalName})`
                  : targetUsers[0]?.userPrincipalName ?? "None"}
              </strong>
            </span>
          )}
        </div>

        {error && (
          <div style={errorBannerStyle} role="alert" data-testid="reset-error-message">
            {error}
          </div>
        )}

        {successMessage && (
          <div style={successBannerStyle} role="status" data-testid="reset-success-message">
            {successMessage}
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div>
            <label htmlFor="reset-reason" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
              Reason for reset (required):
            </label>
            <input
              id="reset-reason"
              type="text"
              placeholder="e.g. Lost device, security incident, admin override"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={inputStyle}
              aria-label="Reason for reset"
              data-testid="reset-reason-input"
              required
            />
          </div>

          <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
            <input
              id="reset-confirm"
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              style={{ marginTop: "3px" }}
              data-testid="reset-confirm-checkbox"
            />
            <label htmlFor="reset-confirm" style={{ fontSize: "13px", lineHeight: 1.4 }}>
              I understand that {isBatch ? "all selected users" : "this user"} will lose current MFA
              methods and will be forced into re-registration.
            </label>
          </div>

          {isBatch && (
            <div>
              <label
                htmlFor="reset-confirm-count"
                style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}
              >
                Confirm user count (type <strong>{targetUsers.length}</strong> to confirm):
              </label>
              <input
                id="reset-confirm-count"
                type="text"
                placeholder={String(targetUsers.length)}
                value={countInput}
                onChange={(e) => setCountInput(e.target.value)}
                style={inputStyle}
                aria-label="Confirm user count"
                data-testid="reset-confirm-count-input"
              />
            </div>
          )}

          <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "8px" }}>
            <button
              type="button"
              style={buttonStyle}
              onClick={onClose}
              data-testid="reset-cancel-button"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                ...submitButtonStyle,
                ...(!canSubmit ? { opacity: 0.6, cursor: "not-allowed" } : {}),
              }}
              data-testid="reset-submit-button"
            >
              {loading ? "Resetting..." : isBatch ? `Reset ${targetUsers.length} Users` : "Reset MFA"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export { TapDialog, SendPushDialog, DefaultMethodDialog } from "./TapDialog";

