"use client";

// Drift triage dialogs (EPIC-009 SPEC.md §3.2; T-0168).
// Accept (reason + expiry + auto-remediate-on-expiry switch), tenant override
// (explanatory copy + pre-filled template value), deny (destructive warning
// shown verbatim with explicit confirmation), and the bulk triage dialog used
// by the T-0167 endpoint. The deny dialog blocks on cancel: closing it never
// submits. Zero colour literals: report theme tokens only.

import React, { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import {
  DRIFT_DENY_WARNING,
  type AcceptDeviationInput,
  type BulkTriageInput,
  type DenyDeviationInput,
  type DriftBulkAction,
  type DriftDeviation,
  type OverrideDeviationInput,
} from "../../lib/driftApi";

// ─── Styles ─────────────────────────────────────────────────────────────────

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
  padding: "16px",
};

const dialogStyle: CSSProperties = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  boxShadow: "var(--shadow-card)",
  padding: "24px",
  width: "100%",
  maxWidth: "520px",
  display: "flex",
  flexDirection: "column",
  gap: "14px",
  color: "var(--text)",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
};

const titleStyle: CSSProperties = {
  fontSize: "18px",
  fontWeight: 700,
  margin: 0,
  fontFamily: "var(--font-display, var(--font-sans))",
};

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  fontSize: "13px",
  fontWeight: 600,
};

const inputStyle: CSSProperties = {
  padding: "8px 12px",
  background: "var(--input-bg, var(--bg))",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "14px",
  fontWeight: 400,
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  minHeight: "96px",
  resize: "vertical",
};

const hintStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 400,
  color: "var(--text-soft)",
  margin: 0,
};

const warningStyle: CSSProperties = {
  padding: "12px 14px",
  background: "var(--danger-soft)",
  border: "1px solid var(--danger)",
  borderRadius: "6px",
  color: "var(--danger-text)",
  fontSize: "13px",
  fontWeight: 600,
  margin: 0,
};

const rowStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  justifyContent: "flex-end",
  flexWrap: "wrap",
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

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "var(--accent)",
  color: "var(--accent-text)",
  borderColor: "var(--accent)",
};

const dangerButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "var(--danger)",
  color: "var(--danger-text, #fff)",
  borderColor: "var(--danger)",
};

const disabledButtonStyle: CSSProperties = {
  opacity: 0.5,
  cursor: "not-allowed",
};

const checkRowStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  alignItems: "flex-start",
  fontSize: "13px",
  fontWeight: 400,
};

function toDisplay(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function Shell({
  testId,
  title,
  onClose,
  children,
}: {
  readonly testId: string;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
}): ReactElement {
  return (
    <div style={overlayStyle} data-testid={`${testId}-overlay`} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={dialogStyle}
        data-testid={testId}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 style={titleStyle}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

// ─── Accept ─────────────────────────────────────────────────────────────────

export interface AcceptDeviationDialogProps {
  readonly deviation: DriftDeviation | null;
  readonly onClose: () => void;
  readonly onSubmit: (deviation: DriftDeviation, input: AcceptDeviationInput) => void | Promise<void>;
}

export function AcceptDeviationDialog({ deviation, onClose, onSubmit }: AcceptDeviationDialogProps): ReactElement | null {
  const [reason, setReason] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [autoRemediate, setAutoRemediate] = useState(false);

  useEffect(() => {
    setReason("");
    setExpiresOn("");
    setAutoRemediate(false);
  }, [deviation?.id]);

  if (!deviation) return null;
  const valid = reason.trim().length > 0 && expiresOn.trim().length > 0;

  return (
    <Shell testId="accept-dialog" title="Accept deviation" onClose={onClose}>
      <p style={hintStyle} data-testid="accept-dialog-target">
        Accept <code>{deviation.standardKey}</code> on <code>{deviation.resourceId || "—"}</code>. No
        action is taken until the acceptance expires.
      </p>
      <label style={labelStyle}>
        Reason
        <input
          style={inputStyle}
          data-testid="accept-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why is this deviation accepted?"
        />
      </label>
      <label style={labelStyle}>
        Expires
        <input
          style={inputStyle}
          data-testid="accept-expires"
          type="date"
          value={expiresOn}
          onChange={(event) => setExpiresOn(event.target.value)}
        />
      </label>
      <label style={checkRowStyle}>
        <input
          type="checkbox"
          data-testid="accept-auto-remediate"
          checked={autoRemediate}
          onChange={(event) => setAutoRemediate(event.target.checked)}
        />
        Remediate automatically when the acceptance expires
      </label>
      <div style={rowStyle}>
        <button type="button" style={buttonStyle} data-testid="accept-cancel" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          style={{ ...primaryButtonStyle, ...(valid ? {} : disabledButtonStyle) }}
          data-testid="accept-submit"
          disabled={!valid}
          onClick={() => {
            if (!valid) return;
            void onSubmit(deviation, {
              reason: reason.trim(),
              expiresOn: expiresOn.trim(),
              autoRemediateOnExpiry: autoRemediate,
            });
          }}
        >
          Accept deviation
        </button>
      </div>
    </Shell>
  );
}

// ─── Tenant override ────────────────────────────────────────────────────────

export interface OverrideDeviationDialogProps {
  readonly deviation: DriftDeviation | null;
  readonly onClose: () => void;
  readonly onSubmit: (deviation: DriftDeviation, input: OverrideDeviationInput) => void | Promise<void>;
}

export function OverrideDeviationDialog({ deviation, onClose, onSubmit }: OverrideDeviationDialogProps): ReactElement | null {
  const [valueText, setValueText] = useState("");
  const [reason, setReason] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    setValueText(toDisplay(deviation?.expected));
    setReason("");
    setParseError(null);
  }, [deviation?.id]);

  if (!deviation) return null;

  const handleSubmit = (): void => {
    let parsed: unknown = valueText;
    const trimmed = valueText.trim();
    if (trimmed.length > 0 && trimmed !== toDisplay(deviation.expected)) {
      try {
        parsed = JSON.parse(trimmed) as unknown;
        setParseError(null);
      } catch {
        // Not JSON: keep the raw string as the tenant-specific value.
        parsed = valueText;
      }
    } else if (trimmed.length === 0) {
      setParseError("Enter the tenant-specific expected value.");
      return;
    }
    void onSubmit(deviation, {
      overrideValue: parsed,
      reason: reason.trim().length > 0 ? reason.trim() : null,
    });
  };

  return (
    <Shell testId="override-dialog" title="Create tenant override" onClose={onClose}>
      <p style={hintStyle} data-testid="override-dialog-copy">
        This tenant keeps its own expected value for <code>{deviation.standardKey}</code> instead of
        the template value. Future drift runs treat the override as compliant for this tenant only.
      </p>
      <label style={labelStyle}>
        Tenant expected value (pre-filled from the template)
        <textarea
          style={textareaStyle}
          data-testid="override-value"
          value={valueText}
          onChange={(event) => setValueText(event.target.value)}
        />
      </label>
      {parseError && (
        <p style={warningStyle} data-testid="override-error">
          {parseError}
        </p>
      )}
      <label style={labelStyle}>
        Reason (optional)
        <input
          style={inputStyle}
          data-testid="override-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why does this tenant differ?"
        />
      </label>
      <div style={rowStyle}>
        <button type="button" style={buttonStyle} data-testid="override-cancel" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          style={primaryButtonStyle}
          data-testid="override-submit"
          onClick={handleSubmit}
        >
          Save override
        </button>
      </div>
    </Shell>
  );
}

// ─── Deny (destructive) ─────────────────────────────────────────────────────

export interface DenyDeviationDialogProps {
  readonly deviation: DriftDeviation | null;
  readonly onClose: () => void;
  readonly onSubmit: (deviation: DriftDeviation, input: DenyDeviationInput) => void | Promise<void>;
}

export function DenyDeviationDialog({ deviation, onClose, onSubmit }: DenyDeviationDialogProps): ReactElement | null {
  const [reason, setReason] = useState("");
  const [delayDays, setDelayDays] = useState("0");
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    setReason("");
    setDelayDays("0");
    setConfirmed(false);
  }, [deviation?.id]);

  if (!deviation) return null;
  const valid = reason.trim().length > 0 && confirmed;

  return (
    <Shell testId="deny-dialog" title="Deny deviation — queue deletion" onClose={onClose}>
      <p style={warningStyle} data-testid="deny-warning">
        {DRIFT_DENY_WARNING}.
      </p>
      <p style={hintStyle}>
        <code>{deviation.standardKey}</code> on <code>{deviation.resourceId || "—"}</code> will be
        marked denied and queued for deletion.
      </p>
      <label style={labelStyle}>
        Reason
        <input
          style={inputStyle}
          data-testid="deny-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why is this deviation denied?"
        />
      </label>
      <label style={labelStyle}>
        Grace delay (days)
        <input
          style={inputStyle}
          data-testid="deny-delay"
          type="number"
          min="0"
          value={delayDays}
          onChange={(event) => setDelayDays(event.target.value)}
        />
      </label>
      <label style={checkRowStyle}>
        <input
          type="checkbox"
          data-testid="deny-confirm"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        I understand this deviation will be {DRIFT_DENY_WARNING.toLowerCase()}.
      </label>
      <div style={rowStyle}>
        <button type="button" style={buttonStyle} data-testid="deny-cancel" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          style={{ ...dangerButtonStyle, ...(valid ? {} : disabledButtonStyle) }}
          data-testid="deny-submit"
          disabled={!valid}
          onClick={() => {
            if (!valid) return;
            const parsed = Number.parseInt(delayDays, 10);
            void onSubmit(deviation, {
              reason: reason.trim(),
              confirm: true,
              delayDays: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
            });
          }}
        >
          Deny and queue deletion
        </button>
      </div>
    </Shell>
  );
}

// ─── Bulk triage ────────────────────────────────────────────────────────────

export interface BulkTriageDialogProps {
  readonly action: DriftBulkAction | null;
  readonly tenantId: string;
  readonly deviationIds: readonly string[];
  readonly onClose: () => void;
  readonly onSubmit: (input: BulkTriageInput) => void | Promise<void>;
}

const BULK_TITLES: Record<DriftBulkAction, string> = {
  accept: "Bulk accept",
  "deny-delete": "Bulk deny — queue deletion",
  "deny-remediate": "Bulk deny — remediate on expiry",
};

export function BulkTriageDialog({
  action,
  tenantId,
  deviationIds,
  onClose,
  onSubmit,
}: BulkTriageDialogProps): ReactElement | null {
  const [reason, setReason] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    setReason("");
    setExpiresOn("");
    setConfirmed(false);
  }, [action]);

  if (!action) return null;
  const destructive = action === "deny-delete";
  const valid =
    reason.trim().length > 0 &&
    (action !== "accept" || expiresOn.trim().length > 0) &&
    (!destructive || confirmed);

  return (
    <Shell testId="bulk-dialog" title={`${BULK_TITLES[action]} (${deviationIds.length} selected)`} onClose={onClose}>
      {destructive && (
        <p style={warningStyle} data-testid="bulk-warning">
          {DRIFT_DENY_WARNING}.
        </p>
      )}
      <label style={labelStyle}>
        Reason
        <input
          style={inputStyle}
          data-testid="bulk-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why is this selection triaged?"
        />
      </label>
      {action === "accept" && (
        <label style={labelStyle}>
          Expires
          <input
            style={inputStyle}
            data-testid="bulk-expires"
            type="date"
            value={expiresOn}
            onChange={(event) => setExpiresOn(event.target.value)}
          />
        </label>
      )}
      {destructive && (
        <label style={checkRowStyle}>
          <input
            type="checkbox"
            data-testid="bulk-confirm"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          I understand the selected deviations will be {DRIFT_DENY_WARNING.toLowerCase()}.
        </label>
      )}
      <div style={rowStyle}>
        <button type="button" style={buttonStyle} data-testid="bulk-cancel" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          style={{
            ...(destructive ? dangerButtonStyle : primaryButtonStyle),
            ...(valid ? {} : disabledButtonStyle),
          }}
          data-testid="bulk-submit"
          disabled={!valid}
          onClick={() => {
            if (!valid) return;
            void onSubmit({
              tenantId,
              action,
              deviationIds,
              reason: reason.trim(),
              confirm: destructive ? true : undefined,
              expiresOn: action === "accept" ? expiresOn.trim() : null,
            });
          }}
        >
          Apply {action}
        </button>
      </div>
    </Shell>
  );
}
