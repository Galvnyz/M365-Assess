"use client";

// TAP, Push notification, and Default method dialogs (EPIC-012 SPEC.md §3.2, T-0229).
// Provides:
// 1. TapDialog: creates Temporary Access Pass, shows pass once with copy control & warning.
// 2. SendPushDialog: triggers push notification test to registered Authenticator device.
// 3. DefaultMethodDialog: selects new default method strictly from registered methods.
// Inline success/failure feedback per action.
// Strictly uses report theme tokens with zero colour literals.

import React, { useState, type CSSProperties, type ReactElement } from "react";
import {
  createTemporaryAccessPass,
  sendPushNotification,
  setUserDefaultMethod,
  type TapCreateResult,
  type MfaPushResult,
  type MfaDefaultMethodResult,
} from "../../lib/mfaApi";

export interface MfaDialogUser {
  readonly userId: string;
  readonly userPrincipalName: string;
  readonly displayName?: string | null;
  readonly methods?: readonly string[];
  readonly defaultMethod?: string | null;
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
  width: "min(520px, 92vw)",
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
  color: "var(--on-accent)",
  borderColor: "var(--accent)",
};

// ─── 1. TapDialog ────────────────────────────────────────────────────────────

export interface TapDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly tenantId: string;
  readonly user: MfaDialogUser;
  readonly onSuccess?: (result: TapCreateResult) => void;
}

export function TapDialog({
  isOpen,
  onClose,
  tenantId,
  user,
  onSuccess,
}: TapDialogProps): ReactElement | null {
  const [lifetimeMinutes, setLifetimeMinutes] = useState(60);
  const [oneTime, setOneTime] = useState(true);
  const [startTime, setStartTime] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tapResult, setTapResult] = useState<TapCreateResult | null>(null);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCreateTap = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await createTemporaryAccessPass(tenantId, user.userId, {
        lifetimeMinutes: Number(lifetimeMinutes),
        oneTime,
        startTime: startTime ? new Date(startTime).toISOString() : null,
        reason: reason.trim() || undefined,
        confirm: true,
      });

      if (res.status === "failed") {
        setError(res.error || "TAP creation failed.");
      } else {
        setTapResult(res);
        onSuccess?.(res);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async (): Promise<void> => {
    if (tapResult?.temporaryAccessPass) {
      try {
        await navigator.clipboard.writeText(tapResult.temporaryAccessPass);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // clipboard write error
      }
    }
  };

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Create Temporary Access Pass" data-testid="tap-dialog">
      <div style={dialogStyle}>
        <h2 style={titleStyle}>Create Temporary Access Pass (TAP)</h2>

        <div style={{ fontSize: "14px", color: "var(--muted)" }}>
          Target user: <strong>{user.displayName ? `${user.displayName} (${user.userPrincipalName})` : user.userPrincipalName}</strong>
        </div>

        {error && (
          <div style={errorBannerStyle} role="alert" data-testid="tap-error-message">
            {error}
          </div>
        )}

        {tapResult?.temporaryAccessPass ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={warningBannerStyle} data-testid="tap-once-warning">
              <strong>Important:</strong> This Temporary Access Pass will not be shown again.
              Copy or securely distribute it to the user now.
            </div>

            <div
              style={{
                display: "flex",
                gap: "8px",
                alignItems: "center",
                background: "var(--surface)",
                padding: "12px",
                borderRadius: "6px",
                border: "1px solid var(--border)",
              }}
            >
              <code
                style={{
                  flex: 1,
                  fontSize: "18px",
                  fontWeight: 700,
                  fontFamily: "var(--font-mono, monospace)",
                  letterSpacing: "0.05em",
                }}
                data-testid="tap-value-display"
              >
                {tapResult.temporaryAccessPass}
              </code>
              <button
                type="button"
                style={buttonStyle}
                onClick={() => void handleCopy()}
                data-testid="tap-copy-button"
              >
                {copied ? "Copied!" : "Copy Pass"}
              </button>
            </div>

            <div style={{ fontSize: "13px", color: "var(--muted)" }}>
              <span>Expires at: {tapResult.expiresAt ? new Date(tapResult.expiresAt).toLocaleString() : "N/A"}</span>
              <br />
              <span>One-time use: {tapResult.oneTime ? "Yes" : "No"}</span>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
              <button type="button" style={buttonStyle} onClick={onClose} data-testid="tap-close-button">
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => void handleCreateTap(e)} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div>
              <label htmlFor="tap-lifetime" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
                Lifetime (minutes):
              </label>
              <input
                id="tap-lifetime"
                type="number"
                min={10}
                max={43200}
                value={lifetimeMinutes}
                onChange={(e) => setLifetimeMinutes(Number(e.target.value))}
                style={inputStyle}
                aria-label="Lifetime in minutes"
                data-testid="tap-lifetime-input"
                required
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input
                id="tap-onetime"
                type="checkbox"
                checked={oneTime}
                onChange={(e) => setOneTime(e.target.checked)}
                data-testid="tap-onetime-input"
              />
              <label htmlFor="tap-onetime" style={{ fontSize: "13px" }}>
                One-time use pass (invalidates after first sign-in)
              </label>
            </div>

            <div>
              <label htmlFor="tap-starttime" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
                Start time (optional, blank for immediate):
              </label>
              <input
                id="tap-starttime"
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                style={inputStyle}
                aria-label="Start time"
                data-testid="tap-starttime-input"
              />
            </div>

            <div>
              <label htmlFor="tap-reason" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
                Reason / Ticket reference (optional):
              </label>
              <input
                id="tap-reason"
                type="text"
                placeholder="e.g. Onboarding, password reset, helpdesk ticket"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                style={inputStyle}
                aria-label="Reason"
                data-testid="tap-reason-input"
              />
            </div>

            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "8px" }}>
              <button type="button" style={buttonStyle} onClick={onClose} data-testid="tap-cancel-button">
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                style={{
                  ...submitButtonStyle,
                  ...(loading ? { opacity: 0.6, cursor: "not-allowed" } : {}),
                }}
                data-testid="tap-submit-button"
              >
                {loading ? "Generating..." : "Generate Pass"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── 2. SendPushDialog ───────────────────────────────────────────────────────

export interface SendPushDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly tenantId: string;
  readonly user: MfaDialogUser;
  readonly onSuccess?: (result: MfaPushResult) => void;
}

export function SendPushDialog({
  isOpen,
  onClose,
  tenantId,
  user,
  onSuccess,
}: SendPushDialogProps): ReactElement | null {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSendPush = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await sendPushNotification(tenantId, user.userId, {
        reason: reason.trim() || undefined,
        confirm: true,
      });

      if (res.status === "failed") {
        setError(res.error || "Push notification failed.");
      } else {
        setSuccessMessage(
          `Push notification successfully sent to registered device${
            res.pushTarget ? ` (${res.pushTarget})` : ""
          }.`,
        );
        onSuccess?.(res);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Send Push Notification" data-testid="push-dialog">
      <div style={dialogStyle}>
        <h2 style={titleStyle}>Send Push Notification</h2>

        <div style={{ fontSize: "14px", color: "var(--muted)" }}>
          Target user: <strong>{user.displayName ? `${user.displayName} (${user.userPrincipalName})` : user.userPrincipalName}</strong>
        </div>

        {error && (
          <div style={errorBannerStyle} role="alert" data-testid="push-error-message">
            {error}
          </div>
        )}

        {successMessage && (
          <div style={successBannerStyle} role="status" data-testid="push-success-message">
            {successMessage}
          </div>
        )}

        <form onSubmit={(e) => void handleSendPush(e)} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div>
            <label htmlFor="push-reason" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
              Reason (optional):
            </label>
            <input
              id="push-reason"
              type="text"
              placeholder="e.g. Verify Authenticator app, auth test"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={inputStyle}
              aria-label="Reason"
              data-testid="push-reason-input"
            />
          </div>

          <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "8px" }}>
            <button type="button" style={buttonStyle} onClick={onClose} data-testid="push-cancel-button">
              Close
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                ...submitButtonStyle,
                ...(loading ? { opacity: 0.6, cursor: "not-allowed" } : {}),
              }}
              data-testid="push-submit-button"
            >
              {loading ? "Sending..." : "Send Push"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── 3. DefaultMethodDialog ─────────────────────────────────────────────────

export interface DefaultMethodDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly tenantId: string;
  readonly user: MfaDialogUser;
  readonly onSuccess?: (result: MfaDefaultMethodResult) => void;
}

export function DefaultMethodDialog({
  isOpen,
  onClose,
  tenantId,
  user,
  onSuccess,
}: DefaultMethodDialogProps): ReactElement | null {
  const registeredMethods = user.methods ?? [];
  const [selectedMethod, setSelectedMethod] = useState<string>(
    user.defaultMethod && registeredMethods.includes(user.defaultMethod)
      ? user.defaultMethod
      : registeredMethods[0] ?? "",
  );
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const hasMethods = registeredMethods.length > 0;

  const handleSetDefault = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!selectedMethod) return;

    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await setUserDefaultMethod(tenantId, user.userId, {
        method: selectedMethod,
        reason: reason.trim() || undefined,
        confirm: true,
      });

      if (res.status === "failed") {
        setError(res.error || "Failed to set default method.");
      } else {
        setSuccessMessage(`Default authentication method updated to ${res.defaultMethod}.`);
        onSuccess?.(res);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Set Default Method" data-testid="default-method-dialog">
      <div style={dialogStyle}>
        <h2 style={titleStyle}>Set Default Method</h2>

        <div style={{ fontSize: "14px", color: "var(--muted)" }}>
          Target user: <strong>{user.displayName ? `${user.displayName} (${user.userPrincipalName})` : user.userPrincipalName}</strong>
        </div>

        {error && (
          <div style={errorBannerStyle} role="alert" data-testid="default-method-error-message">
            {error}
          </div>
        )}

        {successMessage && (
          <div style={successBannerStyle} role="status" data-testid="default-method-success-message">
            {successMessage}
          </div>
        )}

        {!hasMethods ? (
          <div style={warningBannerStyle} data-testid="no-methods-warning">
            This user has no registered authentication methods. Register a method before setting a default.
          </div>
        ) : (
          <form onSubmit={(e) => void handleSetDefault(e)} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div>
              <label htmlFor="default-method-select" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
                Default method (limited to user&apos;s registered methods):
              </label>
              <select
                id="default-method-select"
                value={selectedMethod}
                onChange={(e) => setSelectedMethod(e.target.value)}
                style={inputStyle}
                aria-label="Select default method"
                data-testid="default-method-select"
                required
              >
                {registeredMethods.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="default-method-reason" style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
                Reason (optional):
              </label>
              <input
                id="default-method-reason"
                type="text"
                placeholder="e.g. User preference, security alignment"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                style={inputStyle}
                aria-label="Reason"
                data-testid="default-method-reason-input"
              />
            </div>

            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "8px" }}>
              <button type="button" style={buttonStyle} onClick={onClose} data-testid="default-method-cancel-button">
                Close
              </button>
              <button
                type="submit"
                disabled={loading || !selectedMethod}
                style={{
                  ...submitButtonStyle,
                  ...(loading || !selectedMethod ? { opacity: 0.6, cursor: "not-allowed" } : {}),
                }}
                data-testid="default-method-submit-button"
              >
                {loading ? "Updating..." : "Set as Default"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
