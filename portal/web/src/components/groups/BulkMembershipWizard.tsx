"use client";

// BulkMembershipWizard — Wizard for bulk add/remove members and owners with CSV upload, preview diff, and per-row results
// (EPIC-014 SPEC.md §3.3, §4.3; T-0268).
import React, { useState, type CSSProperties } from "react";
import {
  invokeBulkMembership,
  type BulkMembershipExecutionResult,
  type BulkMembershipPlanResult,
} from "../../lib/groupsApi";

export interface BulkMembershipWizardProps {
  readonly tenantId: string;
  readonly groupId: string;
  readonly groupName?: string;
  readonly initialRole?: "members" | "owners";
  readonly onDone?: () => void;
  readonly onApplied?: (result: BulkMembershipExecutionResult) => void;
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "20px",
  maxWidth: "700px",
  width: "100%",
  background: "var(--bg-elev, #ffffff)",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "var(--radius, 10px)",
  padding: "24px",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text, #111827)",
};

const stepNavStyle: CSSProperties = {
  display: "flex",
  gap: "12px",
  fontSize: "13px",
  fontWeight: 600,
  borderBottom: "1px solid var(--border, #e5e7eb)",
  paddingBottom: "12px",
};

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
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
  color: "var(--text, #111827)",
  fontSize: "14px",
};

const primaryButtonStyle: CSSProperties = {
  padding: "8px 16px",
  background: "var(--primary, #2563eb)",
  color: "var(--primary-contrast, #ffffff)",
  border: "none",
  borderRadius: "6px",
  fontWeight: 600,
  fontSize: "14px",
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  padding: "8px 16px",
  background: "var(--surface, #f3f4f6)",
  border: "1px solid var(--border, #d1d5db)",
  borderRadius: "6px",
  fontWeight: 500,
  fontSize: "14px",
  cursor: "pointer",
  color: "var(--text, #111827)",
};

export function BulkMembershipWizard({
  tenantId,
  groupId,
  groupName,
  initialRole = "members",
  onDone,
  onApplied,
}: BulkMembershipWizardProps): React.ReactElement {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [role, setRole] = useState<"members" | "owners">(initialRole);
  const [operation, setOperation] = useState<"add" | "remove">("add");
  const [usersInput, setUsersInput] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [planResult, setPlanResult] = useState<BulkMembershipPlanResult | null>(null);
  const [execResult, setExecResult] = useState<BulkMembershipExecutionResult | null>(null);

  const parseUsers = (): string[] => {
    return usersInput
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = String(event.target?.result || "");
      // Split by lines and commas
      const extracted = content
        .split(/[\r\n]+/)
        .map((line) => {
          const parts = line.split(",");
          return parts[0]?.trim();
        })
        .filter((val) => val && !val.toLowerCase().startsWith("user") && !val.toLowerCase().startsWith("upn"));
      setUsersInput((prev) => (prev ? `${prev}\n${extracted.join("\n")}` : extracted.join("\n")));
    };
    reader.readAsText(file);
  };

  const handlePreview = async () => {
    const users = parseUsers();
    if (users.length === 0) {
      setError("Please provide at least one user identifier or upload a CSV.");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const res = (await invokeBulkMembership(tenantId, groupId, role, {
        operation,
        users,
        preview: true,
      })) as BulkMembershipPlanResult;
      setPlanResult(res);
      setStep(2);
    } catch (err: any) {
      setError(err.message || "Failed to generate preview diff");
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    const users = parseUsers();
    try {
      setLoading(true);
      setError(null);
      const res = (await invokeBulkMembership(tenantId, groupId, role, {
        operation,
        users,
        preview: false,
      })) as BulkMembershipExecutionResult;
      setExecResult(res);
      setStep(3);
      onApplied?.(res);
    } catch (err: any) {
      setError(err.message || "Failed to apply bulk membership changes");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={containerStyle} data-testid="bulk-membership-wizard">
      <div>
        <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 700 }}>
          Bulk {role === "members" ? "Membership" : "Owners"} Management
        </h2>
        {groupName && (
          <div style={{ fontSize: "14px", color: "var(--text-muted, #6b7280)", marginTop: "4px" }}>
            Target Group: <strong>{groupName}</strong> ({groupId})
          </div>
        )}
      </div>

      <div style={stepNavStyle}>
        <span style={{ color: step === 1 ? "var(--primary)" : "var(--text-muted)" }}>1. Select &amp; Upload</span>
        <span>&gt;</span>
        <span style={{ color: step === 2 ? "var(--primary)" : "var(--text-muted)" }}>2. Preview Diff</span>
        <span>&gt;</span>
        <span style={{ color: step === 3 ? "var(--primary)" : "var(--text-muted)" }}>3. Results</span>
      </div>

      {error && (
        <div style={{ color: "var(--danger, #dc2626)", fontSize: "14px" }} data-testid="bulk-wizard-error">
          {error}
        </div>
      )}

      {/* Step 1 */}
      {step === 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }} data-testid="bulk-step-1">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div style={fieldStyle}>
              <label style={labelStyle} htmlFor="bulk-role-select">Target Role</label>
              <select
                id="bulk-role-select"
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
                style={inputStyle}
                data-testid="select-bulk-role"
              >
                <option value="members">Members</option>
                <option value="owners">Owners</option>
              </select>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle} htmlFor="bulk-operation-select">Action</label>
              <select
                id="bulk-operation-select"
                value={operation}
                onChange={(e) => setOperation(e.target.value as any)}
                style={inputStyle}
                data-testid="select-bulk-operation"
              >
                <option value="add">Add</option>
                <option value="remove">Remove</option>
              </select>
            </div>
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle} htmlFor="bulk-users-input">
              Enter User Identifiers (one per line or comma-separated UPNs / IDs):
            </label>
            <textarea
              id="bulk-users-input"
              value={usersInput}
              onChange={(e) => setUsersInput(e.target.value)}
              placeholder="user1@example.com&#10;user2@example.com"
              rows={6}
              style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace" }}
              data-testid="input-bulk-users"
            />
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle} htmlFor="bulk-csv-upload">Or Upload CSV:</label>
            <input
              id="bulk-csv-upload"
              type="file"
              accept=".csv,.txt"
              onChange={handleCsvUpload}
              data-testid="input-bulk-csv"
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
            <button
              type="button"
              style={primaryButtonStyle}
              disabled={loading}
              onClick={handlePreview}
              data-testid="btn-bulk-preview"
            >
              {loading ? "Calculating..." : "Preview Diff"}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Preview Diff */}
      {step === 2 && planResult && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }} data-testid="bulk-step-2">
          <div
            style={{
              padding: "16px",
              background: "var(--surface, #f9fafb)",
              border: "1px solid var(--border, #e5e7eb)",
              borderRadius: "8px",
            }}
          >
            <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "8px" }}>Diff Summary:</div>
            <div style={{ display: "flex", gap: "20px", fontSize: "14px" }}>
              <div>Total requested: <strong>{planResult.total}</strong></div>
              <div style={{ color: "var(--success, #16a34a)" }}>
                {operation === "add" ? "To add" : "To remove"}: <strong>{operation === "add" ? planResult.toAdd : planResult.toRemove}</strong>
              </div>
              <div style={{ color: "var(--text-muted, #6b7280)" }}>
                To skip: <strong>{planResult.toSkip}</strong>
              </div>
            </div>
          </div>

          <div style={{ fontSize: "14px", fontWeight: 600 }}>Planned Changes:</div>
          <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "13px" }} data-testid="bulk-diff-list">
            {planResult.diff.length === 0 ? (
              <li>No changes needed (all items skipped).</li>
            ) : (
              planResult.diff.map((item, idx) => <li key={idx}>{item}</li>)
            )}
          </ul>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "12px" }}>
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={() => setStep(1)}
              data-testid="btn-bulk-back"
            >
              Back
            </button>
            <button
              type="button"
              style={{ ...primaryButtonStyle, background: "var(--success, #16a34a)" }}
              disabled={loading}
              onClick={handleApply}
              data-testid="btn-bulk-confirm"
            >
              {loading ? "Applying..." : "Confirm & Apply"}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Results */}
      {step === 3 && execResult && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }} data-testid="bulk-step-3">
          <div style={{ fontWeight: 600, fontSize: "15px" }}>Per-Row Results:</div>
          <div
            style={{
              maxHeight: "300px",
              overflowY: "auto",
              border: "1px solid var(--border)",
              borderRadius: "6px",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "8px 12px", textAlign: "left" }}>User</th>
                  <th style={{ padding: "8px 12px", textAlign: "left" }}>Status</th>
                  <th style={{ padding: "8px 12px", textAlign: "left" }}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {execResult.results.map((row, idx) => (
                  <tr
                    key={idx}
                    style={{ borderBottom: "1px solid var(--border)" }}
                    data-testid={`row-result-${row.user}`}
                  >
                    <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>{row.user}</td>
                    <td style={{ padding: "8px 12px", fontWeight: 600, textTransform: "capitalize" }}>
                      <span
                        style={{
                          color:
                            row.status === "added" || row.status === "removed"
                              ? "var(--success, #16a34a)"
                              : row.status === "skipped"
                              ? "var(--text-muted, #6b7280)"
                              : "var(--danger, #dc2626)",
                        }}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td style={{ padding: "8px 12px", color: "var(--text-muted)" }}>
                      {row.error || row.reason || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
            <button
              type="button"
              style={primaryButtonStyle}
              onClick={onDone}
              data-testid="btn-bulk-done"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
