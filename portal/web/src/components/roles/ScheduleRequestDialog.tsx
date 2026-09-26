"use client";

// Schedule Request Dialog component (EPIC-013 SPEC §3.3, §4.3; T-0249).
// Submits an activation or assignment request for a bounded window.
// Requires mandatory justification; renders native 'pending' state when approval is configured.
// Strictly uses report theme tokens with zero colour literals.

import React, { useState, type CSSProperties, type ReactElement } from "react";
import { submitPimScheduleRequest, type RoleChangeRequest } from "../../lib/jitApi";

export interface ScheduleRequestDialogProps {
  readonly tenantId: string;
  readonly defaultRoleId?: string;
  readonly defaultPrincipalId?: string;
  readonly onClose: () => void;
  readonly onSubmitted?: (request: RoleChangeRequest) => void;
}

const backdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
};

const modalStyle: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  padding: "24px",
  maxWidth: "540px",
  width: "100%",
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  color: "var(--text)",
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

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  fontSize: "13px",
  fontWeight: 500,
  color: "var(--muted)",
};

const btnStyle: CSSProperties = {
  padding: "8px 16px",
  borderRadius: "6px",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  fontSize: "14px",
  fontWeight: 600,
  cursor: "pointer",
};

const submitBtnStyle: CSSProperties = {
  ...btnStyle,
  background: "var(--primary, var(--surface))",
  color: "var(--text)",
  border: "1px solid var(--border)",
};

export function ScheduleRequestDialog({
  tenantId,
  defaultRoleId = "",
  defaultPrincipalId = "",
  onClose,
  onSubmitted,
}: ScheduleRequestDialogProps): ReactElement {
  const [roleId, setRoleId] = useState(defaultRoleId);
  const [principalId, setPrincipalId] = useState(defaultPrincipalId);
  const [justification, setJustification] = useState("");
  const [durationHours, setDurationHours] = useState(8);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [ticketNumber, setTicketNumber] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedResult, setSubmittedResult] = useState<RoleChangeRequest | null>(null);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!justification.trim()) {
      setError("Justification is mandatory for PIM schedule requests.");
      return;
    }
    if (!roleId.trim() || !principalId.trim()) {
      setError("Principal ID and Role ID are required.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await submitPimScheduleRequest(tenantId, {
        principalId: principalId.trim(),
        roleId: roleId.trim(),
        action: "activate",
        justification: justification.trim(),
        durationHours,
        approvalRequired,
        ticketNumber: ticketNumber.trim() || undefined,
      });

      setSubmittedResult(res);
      if (onSubmitted) {
        onSubmitted(res);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit schedule request");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={backdropStyle} onClick={onClose} data-testid="schedule-request-dialog-backdrop">
      <div style={modalStyle} onClick={(e) => e.stopPropagation()} data-testid="schedule-request-dialog">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: "18px" }}>PIM Schedule Request</h3>
          <button type="button" style={btnStyle} onClick={onClose}>
            ✕
          </button>
        </div>

        {submittedResult ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div
              style={{
                padding: "16px",
                borderRadius: "6px",
                background:
                  submittedResult.state === "pending"
                    ? "var(--warning-soft, var(--surface))"
                    : "var(--success-soft, var(--surface))",
                border: "1px solid var(--border)",
              }}
            >
              <h4 style={{ margin: "0 0 8px 0" }}>
                Request Submitted:{" "}
                <span data-testid="request-state-badge" style={{ fontWeight: 700 }}>
                  {submittedResult.state.toUpperCase()}
                </span>
              </h4>
              <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}>
                {submittedResult.state === "pending"
                  ? "This request requires approval before the role assignment is activated."
                  : `Role assignment is active until ${new Date(submittedResult.endsAt ?? "").toLocaleString()}.`}
              </p>
            </div>
            <button type="button" style={submitBtnStyle} onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {error && (
              <p role="alert" data-testid="schedule-error" style={{ margin: 0, color: "var(--error)", fontSize: "13px" }}>
                {error}
              </p>
            )}

            <label style={labelStyle}>
              Principal ID (User UPN or ID)
              <input
                type="text"
                value={principalId}
                onChange={(e) => setPrincipalId(e.target.value)}
                placeholder="user@example.com"
                style={inputStyle}
                data-testid="input-principal"
              />
            </label>

            <label style={labelStyle}>
              Role ID (or Definition ID)
              <input
                type="text"
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
                placeholder="Global Administrator"
                style={inputStyle}
                data-testid="input-role"
              />
            </label>

            <label style={labelStyle}>
              Justification (Required)
              <textarea
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="Enter justification for privileged access…"
                rows={3}
                style={{ ...inputStyle, resize: "vertical" }}
                data-testid="input-justification"
              />
            </label>

            <div style={{ display: "flex", gap: "16px" }}>
              <label style={{ ...labelStyle, flex: 1 }}>
                Duration (hours)
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={durationHours}
                  onChange={(e) => setDurationHours(Number(e.target.value))}
                  style={inputStyle}
                  data-testid="input-duration"
                />
              </label>

              <label style={{ ...labelStyle, flex: 1 }}>
                Ticket / INC Number (Optional)
                <input
                  type="text"
                  value={ticketNumber}
                  onChange={(e) => setTicketNumber(e.target.value)}
                  placeholder="INC-12345"
                  style={inputStyle}
                  data-testid="input-ticket"
                />
              </label>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={approvalRequired}
                onChange={(e) => setApprovalRequired(e.target.checked)}
                data-testid="checkbox-approval"
              />
              Requires administrative approval (Enters Pending state)
            </label>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" }}>
              <button type="button" style={btnStyle} onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" style={submitBtnStyle} disabled={submitting} data-testid="btn-submit-schedule">
                {submitting ? "Submitting…" : "Submit Request"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
