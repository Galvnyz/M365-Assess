"use client";

// ActionDialogs for hide-from-GAL and delivery management using EXO (EPIC-014 SPEC.md §3.4, §4.4; T-0269).
import React, { useState, type CSSProperties, type ReactElement } from "react";

export interface GalDeliveryDialogProps {
  readonly isOpen: boolean;
  readonly mode: "gal" | "delivery";
  readonly tenantId: string;
  readonly groupId: string;
  readonly groupName?: string;
  readonly initialHiddenFromAddressListsEnabled?: boolean;
  readonly initialRequireSenderAuthenticationEnabled?: boolean;
  readonly initialGrantSendOnBehalfTo?: readonly string[];
  readonly onClose: () => void;
  readonly onSuccess?: (result: any) => void;
  readonly fetcher?: typeof fetch;
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--overlay, rgba(0, 0, 0, 0.5))",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px",
  zIndex: 1000,
};

const dialogStyle: CSSProperties = {
  width: "100%",
  maxWidth: "560px",
  maxHeight: "90vh",
  overflowY: "auto",
  background: "var(--bg-elev, #ffffff)",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "var(--radius, 10px)",
  padding: "24px",
  display: "flex",
  flexDirection: "column",
  gap: "20px",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text, #111827)",
  boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
};

const titleStyle: CSSProperties = {
  fontSize: "18px",
  fontWeight: 700,
  margin: 0,
};

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
};

const labelStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 600,
  color: "var(--text, #111827)",
};

const inputStyle: CSSProperties = {
  padding: "8px 12px",
  background: "var(--input-bg, var(--bg, #ffffff))",
  border: "1px solid var(--border, #d1d5db)",
  borderRadius: "6px",
  fontSize: "14px",
  color: "inherit",
};

const btnStyle: CSSProperties = {
  padding: "8px 16px",
  borderRadius: "6px",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
  border: "none",
};

const primaryBtnStyle: CSSProperties = {
  ...btnStyle,
  background: "var(--primary, #2563eb)",
  color: "#ffffff",
};

const secondaryBtnStyle: CSSProperties = {
  ...btnStyle,
  background: "var(--bg-muted, #f3f4f6)",
  border: "1px solid var(--border, #d1d5db)",
  color: "var(--text, #111827)",
};

const badgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "4px 8px",
  background: "var(--bg-muted, #f3f4f6)",
  border: "1px solid var(--border, #d1d5db)",
  borderRadius: "4px",
  fontSize: "12px",
};

export function GalDeliveryDialog({
  isOpen,
  mode,
  tenantId,
  groupId,
  groupName,
  initialHiddenFromAddressListsEnabled = false,
  initialRequireSenderAuthenticationEnabled = false,
  initialGrantSendOnBehalfTo = [],
  onClose,
  onSuccess,
  fetcher = fetch,
}: GalDeliveryDialogProps): ReactElement | null {
  const [hiddenFromGal, setHiddenFromGal] = useState<boolean>(initialHiddenFromAddressListsEnabled);
  const [requireSenderAuth, setRequireSenderAuth] = useState<boolean>(initialRequireSenderAuthenticationEnabled);
  const [sendOnBehalfList, setSendOnBehalfList] = useState<string[]>([...initialGrantSendOnBehalfTo]);
  const [sendOnBehalfInput, setSendOnBehalfInput] = useState<string>("");

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [previewPlan, setPreviewPlan] = useState<any | null>(null);
  const [applyResult, setApplyResult] = useState<any | null>(null);

  if (!isOpen) {
    return null;
  }

  const handleAddSendOnBehalf = () => {
    const trimmed = sendOnBehalfInput.trim();
    if (!trimmed) return;
    if (sendOnBehalfList.includes(trimmed)) {
      setError(`"${trimmed}" is already in the list.`);
      return;
    }
    setError(null);
    setSendOnBehalfList([...sendOnBehalfList, trimmed]);
    setSendOnBehalfInput("");
    setPreviewPlan(null);
  };

  const handleRemoveSendOnBehalf = (entry: string) => {
    setSendOnBehalfList(sendOnBehalfList.filter((s) => s !== entry));
    setPreviewPlan(null);
  };

  const runRequest = async (preview: boolean) => {
    setLoading(true);
    setError(null);

    try {
      const endpoint = mode === "gal"
        ? `/v1/tenants/${encodeURIComponent(tenantId)}/groups/${encodeURIComponent(groupId)}/gal${preview ? "?preview=true" : ""}`
        : `/v1/tenants/${encodeURIComponent(tenantId)}/groups/${encodeURIComponent(groupId)}/delivery${preview ? "?preview=true" : ""}`;

      const payload = mode === "gal"
        ? { hiddenFromAddressListsEnabled: hiddenFromGal, preview }
        : {
            requireSenderAuthenticationEnabled: requireSenderAuth,
            grantSendOnBehalfTo: sendOnBehalfList,
            preview,
          };

      const res = await fetcher(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || `Request failed with HTTP ${res.status}`);
      }

      const data = await res.json();
      if (preview) {
        setPreviewPlan(data);
      } else {
        setApplyResult(data);
        onSuccess?.(data);
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={overlayStyle} data-testid="gal-delivery-dialog-overlay">
      <div style={dialogStyle} data-testid="gal-delivery-dialog" role="dialog" aria-modal="true">
        <div>
          <h2 style={titleStyle}>
            {mode === "gal" ? "Hide from GAL" : "Delivery Management"}
          </h2>
          <div style={{ fontSize: "12px", color: "var(--text-muted, #6b7280)", marginTop: "4px" }}>
            Target: <strong>{groupName || groupId}</strong>
          </div>
        </div>

        <div style={{ fontSize: "13px", color: "var(--text-muted, #4b5563)", background: "var(--bg-muted, #f9fafb)", padding: "10px", borderRadius: "6px" }}>
          Changes are applied using an isolated Exchange Online session inside the per-tenant child process.
        </div>

        {error && (
          <div
            data-testid="error-message"
            style={{
              padding: "10px 12px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "6px",
              color: "#991b1b",
              fontSize: "13px",
            }}
          >
            {error}
          </div>
        )}

        {applyResult ? (
          <div data-testid="apply-result" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div
              style={{
                padding: "12px",
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: "6px",
                color: "#166534",
                fontSize: "13px",
                fontWeight: 600,
              }}
            >
              Changes successfully applied!
            </div>
            {applyResult.auditEvent && (
              <div style={{ fontSize: "12px", color: "var(--text-muted, #4b5563)" }}>
                Audited action: <code>{applyResult.auditEvent.action}</code>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                style={primaryBtnStyle}
                onClick={onClose}
                data-testid="btn-done"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <>
            {mode === "gal" ? (
              <div style={fieldStyle}>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={hiddenFromGal}
                    onChange={(e) => {
                      setHiddenFromGal(e.target.checked);
                      setPreviewPlan(null);
                    }}
                    data-testid="input-hide-gal"
                  />
                  <span>Hide from Global Address List (GAL)</span>
                </label>
                <span style={{ fontSize: "12px", color: "var(--text-muted, #6b7280)", marginLeft: "24px" }}>
                  When enabled, this group will not appear in Outlook address lists.
                </span>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={fieldStyle}>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={requireSenderAuth}
                      onChange={(e) => {
                        setRequireSenderAuth(e.target.checked);
                        setPreviewPlan(null);
                      }}
                      data-testid="input-require-sender-auth"
                    />
                    <span>Require sender authentication (internal senders only)</span>
                  </label>
                </div>

                <div style={fieldStyle}>
                  <label style={labelStyle}>Grant Send-On-Behalf Permissions</label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      type="text"
                      placeholder="user@example.com"
                      value={sendOnBehalfInput}
                      onChange={(e) => setSendOnBehalfInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddSendOnBehalf();
                        }
                      }}
                      style={{ ...inputStyle, flex: 1 }}
                      data-testid="input-send-on-behalf"
                    />
                    <button
                      type="button"
                      style={secondaryBtnStyle}
                      onClick={handleAddSendOnBehalf}
                      data-testid="btn-add-send-on-behalf"
                    >
                      Add
                    </button>
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px" }} data-testid="send-on-behalf-list">
                    {sendOnBehalfList.length === 0 ? (
                      <span style={{ fontSize: "12px", color: "var(--text-muted, #6b7280)" }}>
                        No users granted send-on-behalf.
                      </span>
                    ) : (
                      sendOnBehalfList.map((email) => (
                        <span key={email} style={badgeStyle} data-testid={`tag-send-on-behalf-${email}`}>
                          <span>{email}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveSendOnBehalf(email)}
                            style={{
                              background: "transparent",
                              border: "none",
                              cursor: "pointer",
                              padding: 0,
                              fontWeight: "bold",
                            }}
                            data-testid={`btn-remove-${email}`}
                            aria-label={`Remove ${email}`}
                          >
                            ×
                          </button>
                        </span>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {previewPlan && (
              <div
                data-testid="preview-diff"
                style={{
                  padding: "12px",
                  background: "var(--bg-muted, #f9fafb)",
                  border: "1px dashed var(--border, #d1d5db)",
                  borderRadius: "6px",
                  fontSize: "13px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                }}
              >
                <div style={{ fontWeight: 600 }}>Preview Plan (Dry Run)</div>
                {previewPlan.diff && previewPlan.diff.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: "18px" }}>
                    {previewPlan.diff.map((line: string, i: number) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                ) : (
                  <div>No changes detected.</div>
                )}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", marginTop: "8px" }}>
              <button
                type="button"
                style={secondaryBtnStyle}
                onClick={onClose}
                data-testid="btn-cancel"
                disabled={loading}
              >
                Cancel
              </button>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  style={secondaryBtnStyle}
                  onClick={() => runRequest(true)}
                  data-testid="btn-preview"
                  disabled={loading}
                >
                  {loading ? "Loading..." : "Preview"}
                </button>
                <button
                  type="button"
                  style={primaryBtnStyle}
                  onClick={() => runRequest(false)}
                  data-testid="btn-apply"
                  disabled={loading}
                >
                  {loading ? "Applying..." : "Apply changes"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function GalDialog(props: Omit<GalDeliveryDialogProps, "mode">): ReactElement | null {
  return <GalDeliveryDialog {...props} mode="gal" />;
}

export function DeliveryManagementDialog(props: Omit<GalDeliveryDialogProps, "mode">): ReactElement | null {
  return <GalDeliveryDialog {...props} mode="delivery" />;
}
