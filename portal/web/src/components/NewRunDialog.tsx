"use client";

// New run dialog / multi-tenant wizard (EPIC-003 SPEC.md §3.2, T-0050).
// Four steps:
// 1. Tenants (TenantMultiSelect respecting RBAC scope)
// 2. Sections (13 sections with All toggle, defaulting to CLI default set, PowerBI isolated note)
// 3. Options (Quick scan, Skip Purview, Redact, Evidence, trigger)
// 4. Review & start (estimated scope: tenant count × sections)
// Strictly uses report theme tokens with zero colour literals.

import React, { useState, useMemo, type CSSProperties, type ReactElement } from "react";
import {
  TenantMultiSelect,
  type TenantOption,
  type TenantGroupOption,
} from "./TenantMultiSelect";

// 13 assessment sections defined in SPEC.md §3.2 & Invoke-M365Assessment
export const ALL_SECTIONS: readonly string[] = Object.freeze([
  "Tenant",
  "Identity",
  "Licensing",
  "Email",
  "Intune",
  "Security",
  "Collaboration",
  "PowerBI",
  "Hybrid",
  "Inventory",
  "ActiveDirectory",
  "SOC2",
  "ValueOpportunity",
]);

// 9 CLI default sections defined in SPEC.md §11.4
export const CLI_DEFAULT_SECTIONS: readonly string[] = Object.freeze([
  "Tenant",
  "Identity",
  "Licensing",
  "Email",
  "Intune",
  "Security",
  "Collaboration",
  "PowerBI",
  "Hybrid",
]);

export interface NewRunFormData {
  readonly tenantIds: readonly string[];
  readonly groupIds: readonly string[];
  readonly sections: readonly string[];
  readonly trigger: "manual" | "schedule" | "api";
  readonly options: {
    readonly quickScan?: boolean;
    readonly skipPurview?: boolean;
    readonly redact?: boolean;
    readonly evidence?: boolean;
  };
}

export interface NewRunDialogProps {
  readonly open?: boolean;
  readonly onClose?: () => void;
  readonly onSubmit?: (data: NewRunFormData) => void | Promise<void>;
  readonly initialTenantId?: string;
  readonly tenants?: readonly TenantOption[];
  readonly groups?: readonly TenantGroupOption[];
  readonly allowedTenantIds?: readonly string[];
  readonly loading?: boolean;
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: "var(--overlay-bg, var(--overlay))",
  backdropFilter: "blur(4px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  padding: "16px",
};

const dialogStyle: CSSProperties = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 12px)",
  boxShadow: "var(--shadow-lg, var(--shadow-card))",
  width: "100%",
  maxWidth: "680px",
  maxHeight: "90vh",
  display: "flex",
  flexDirection: "column",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
  overflow: "hidden",
};

const headerStyle: CSSProperties = {
  padding: "20px 24px",
  borderBottom: "1px solid var(--border)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const bodyStyle: CSSProperties = {
  padding: "24px",
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: "20px",
  flex: 1,
};

const footerStyle: CSSProperties = {
  padding: "16px 24px",
  borderTop: "1px solid var(--border)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  background: "var(--surface)",
};

const buttonStyle: CSSProperties = {
  padding: "8px 16px",
  borderRadius: "6px",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  fontSize: "14px",
  fontWeight: 500,
  cursor: "pointer",
  transition: "background 0.2s ease",
};

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "var(--accent)",
  color: "var(--on-accent)",
  borderColor: "var(--accent)",
};

const stepIndicatorStyle = (active: boolean, completed: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: "8px",
  fontSize: "13px",
  fontWeight: active ? 600 : 500,
  color: active ? "var(--accent)" : completed ? "var(--text)" : "var(--text-soft)",
});

const sectionGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
  gap: "10px",
};

const checkboxCardStyle = (checked: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "flex-start",
  gap: "10px",
  padding: "10px 12px",
  borderRadius: "6px",
  background: checked ? "var(--accent-soft)" : "var(--surface)",
  border: checked ? "1px solid var(--accent)" : "1px solid var(--border)",
  cursor: "pointer",
  transition: "background 0.15s ease",
});

const optionItemStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: "12px",
  padding: "12px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
};

export function NewRunDialog({
  open = true,
  onClose,
  onSubmit,
  initialTenantId,
  tenants = [],
  groups = [],
  allowedTenantIds,
  loading = false,
}: NewRunDialogProps): ReactElement | null {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Form State
  const [selectedTenantIds, setSelectedTenantIds] = useState<string[]>(
    initialTenantId ? [initialTenantId] : [],
  );
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [selectedSections, setSelectedSections] = useState<string[]>([...CLI_DEFAULT_SECTIONS]);
  const [quickScan, setQuickScan] = useState(false);
  const [skipPurview, setSkipPurview] = useState(false);
  const [redact, setRedact] = useState(false);
  const [evidence, setEvidence] = useState(false);
  const [trigger, setTrigger] = useState<"manual" | "schedule" | "api">("manual");
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  // Toggle single section
  const handleToggleSection = (section: string): void => {
    if (selectedSections.includes(section)) {
      setSelectedSections(selectedSections.filter((s) => s !== section));
    } else {
      setSelectedSections([...selectedSections, section]);
    }
  };

  // Toggle All sections
  const allSelected = selectedSections.length === ALL_SECTIONS.length;
  const handleToggleAllSections = (): void => {
    if (allSelected) {
      setSelectedSections([...CLI_DEFAULT_SECTIONS]);
    } else {
      setSelectedSections([...ALL_SECTIONS]);
    }
  };

  // Estimate total unique tenant count
  const estimatedTenantCount = useMemo(() => {
    const unique = new Set<string>(selectedTenantIds);
    for (const gid of selectedGroupIds) {
      const g = groups.find((grp) => grp.id === gid);
      if (g?.memberTenantIds) {
        for (const tid of g.memberTenantIds) {
          unique.add(tid);
        }
      } else {
        // Fallback: count group as at least 1 tenant target
        unique.add(gid);
      }
    }
    return unique.size;
  }, [selectedTenantIds, selectedGroupIds, groups]);

  const estimatedScopeUnits = estimatedTenantCount * selectedSections.length;

  const canProceedStep1 = selectedTenantIds.length > 0 || selectedGroupIds.length > 0;
  const canProceedStep2 = selectedSections.length > 0;

  const handleSubmit = async (): Promise<void> => {
    if (!onSubmit || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({
        tenantIds: selectedTenantIds,
        groupIds: selectedGroupIds,
        sections: selectedSections,
        trigger,
        options: {
          quickScan,
          skipPurview,
          redact,
          evidence,
        },
      });
      onClose?.();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={overlayStyle} data-testid="new-run-dialog-overlay" role="dialog" aria-modal="true">
      <div style={dialogStyle} data-testid="new-run-dialog">
        {/* Header */}
        <div style={headerStyle}>
          <div>
            <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>New Assessment Run</h2>
            <div style={{ display: "flex", gap: "16px", marginTop: "8px" }}>
              <span style={stepIndicatorStyle(step === 1, step > 1)} data-testid="step-indicator-1">
                1. Tenants
              </span>
              <span style={stepIndicatorStyle(step === 2, step > 2)} data-testid="step-indicator-2">
                2. Sections
              </span>
              <span style={stepIndicatorStyle(step === 3, step > 3)} data-testid="step-indicator-3">
                3. Options
              </span>
              <span style={stepIndicatorStyle(step === 4, false)} data-testid="step-indicator-4">
                4. Review
              </span>
            </div>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              style={{ ...buttonStyle, border: "none", fontSize: "20px", padding: "4px 8px" }}
              aria-label="Close dialog"
            >
              ×
            </button>
          )}
        </div>

        {/* Body content based on step */}
        <div style={bodyStyle}>
          {/* STEP 1: Tenants */}
          {step === 1 && (
            <div data-testid="step-1-content">
              <h3 style={{ margin: "0 0 8px 0", fontSize: "15px", fontWeight: 600 }}>
                Select target tenants or tenant groups
              </h3>
              <p style={{ margin: "0 0 16px 0", color: "var(--text-soft)", fontSize: "13px" }}>
                Select one or more tenants, or whole tenant groups. Multi-tenant runs execute
                concurrently in isolated per-tenant child processes.
              </p>

              <TenantMultiSelect
                selectedTenantIds={selectedTenantIds}
                selectedGroupIds={selectedGroupIds}
                onSelectionChange={(tids, gids) => {
                  setSelectedTenantIds(tids);
                  setSelectedGroupIds(gids);
                }}
                tenants={tenants}
                groups={groups}
                allowedTenantIds={allowedTenantIds}
                loading={loading}
              />
            </div>
          )}

          {/* STEP 2: Sections */}
          {step === 2 && (
            <div data-testid="step-2-content">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600 }}>Select assessment sections</h3>
                  <p style={{ margin: "4px 0 0 0", color: "var(--text-soft)", fontSize: "13px" }}>
                    Defaults match the standard CLI set ({CLI_DEFAULT_SECTIONS.length} sections).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleToggleAllSections}
                  style={buttonStyle}
                  data-testid="toggle-all-sections-btn"
                >
                  {allSelected ? "Reset to Defaults" : "Select All (13)"}
                </button>
              </div>

              <div style={sectionGridStyle}>
                {ALL_SECTIONS.map((sec) => {
                  const isChecked = selectedSections.includes(sec);
                  const isPowerBI = sec === "PowerBI";

                  return (
                    <label
                      key={sec}
                      style={checkboxCardStyle(isChecked)}
                      data-testid={`section-checkbox-${sec}`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleSection(sec)}
                        style={{ marginTop: "3px", cursor: "pointer" }}
                      />
                      <div style={{ fontSize: "13px" }}>
                        <div style={{ fontWeight: 500 }}>{sec}</div>
                        {isPowerBI && (
                          <div style={{ fontSize: "11px", color: "var(--text-soft)", marginTop: "2px" }}>
                            Runs in an isolated child process for memory management.
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 3: Options */}
          {step === 3 && (
            <div data-testid="step-3-content" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600 }}>Execution options</h3>

              <label style={optionItemStyle}>
                <input
                  type="checkbox"
                  checked={quickScan}
                  onChange={(e) => setQuickScan(e.target.checked)}
                  data-testid="option-quick-scan"
                />
                <div>
                  <div style={{ fontWeight: 500, fontSize: "14px" }}>Quick scan</div>
                  <div style={{ fontSize: "12px", color: "var(--text-soft)", marginTop: "2px" }}>
                    Run Critical and High severity checks only for rapid triage.
                  </div>
                </div>
              </label>

              <label style={optionItemStyle}>
                <input
                  type="checkbox"
                  checked={skipPurview}
                  onChange={(e) => setSkipPurview(e.target.checked)}
                  data-testid="option-skip-purview"
                />
                <div>
                  <div style={{ fontWeight: 500, fontSize: "14px" }}>Skip Purview</div>
                  <div style={{ fontSize: "12px", color: "var(--text-soft)", marginTop: "2px" }}>
                    Skip Microsoft Purview compliance checks to avoid connection overhead.
                  </div>
                </div>
              </label>

              <label style={optionItemStyle}>
                <input
                  type="checkbox"
                  checked={redact}
                  onChange={(e) => setRedact(e.target.checked)}
                  data-testid="option-redact"
                />
                <div>
                  <div style={{ fontWeight: 500, fontSize: "14px" }}>Redact sensitive values</div>
                  <div style={{ fontSize: "12px", color: "var(--text-soft)", marginTop: "2px" }}>
                    Redact sensitive credentials, keys, and PII in report artifacts.
                  </div>
                </div>
              </label>

              <label style={optionItemStyle}>
                <input
                  type="checkbox"
                  checked={evidence}
                  onChange={(e) => setEvidence(e.target.checked)}
                  data-testid="option-evidence"
                />
                <div>
                  <div style={{ fontWeight: 500, fontSize: "14px" }}>Evidence collection</div>
                  <div style={{ fontSize: "12px", color: "var(--text-soft)", marginTop: "2px" }}>
                    Save raw configuration JSON snapshots for audit and proof.
                  </div>
                </div>
              </label>

              <div style={{ marginTop: "8px" }}>
                <label style={{ fontSize: "13px", fontWeight: 500, display: "block", marginBottom: "6px" }}>
                  Run trigger
                </label>
                <select
                  value={trigger}
                  onChange={(e) => setTrigger(e.target.value as any)}
                  style={{ ...buttonStyle, width: "100%", textAlign: "left" }}
                  data-testid="select-trigger"
                >
                  <option value="manual">Manual (Operator started)</option>
                  <option value="schedule">Schedule</option>
                  <option value="api">API</option>
                </select>
              </div>
            </div>
          )}

          {/* STEP 4: Review & Start */}
          {step === 4 && (
            <div data-testid="step-4-content" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600 }}>Review & start assessment</h3>

              {/* Estimated scope banner */}
              <div
                style={{
                  padding: "16px",
                  background: "var(--accent-soft)",
                  border: "1px solid var(--accent)",
                  borderRadius: "8px",
                  color: "var(--accent-text, var(--text))",
                }}
                data-testid="estimated-scope-banner"
              >
                <div style={{ fontSize: "13px", fontWeight: 500, marginBottom: "4px" }}>
                  Estimated Scope
                </div>
                <div style={{ fontSize: "20px", fontWeight: 700 }} data-testid="estimated-scope-text">
                  {estimatedTenantCount} {estimatedTenantCount === 1 ? "tenant" : "tenants"} × {selectedSections.length} {selectedSections.length === 1 ? "section" : "sections"}
                </div>
                <div style={{ fontSize: "12px", color: "var(--text-soft)", marginTop: "4px" }}>
                  Total {estimatedScopeUnits} per-tenant section tasks will be queued.
                </div>
              </div>

              {/* Details Summary */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border)", paddingBottom: "6px" }}>
                  <span style={{ color: "var(--text-soft)" }}>Tenants / Groups:</span>
                  <span style={{ fontWeight: 500 }}>
                    {selectedTenantIds.length} tenants, {selectedGroupIds.length} groups
                  </span>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border)", paddingBottom: "6px" }}>
                  <span style={{ color: "var(--text-soft)" }}>Sections ({selectedSections.length}):</span>
                  <span style={{ fontWeight: 500, textAlign: "right", maxWidth: "60%" }}>
                    {selectedSections.join(", ")}
                  </span>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--border)", paddingBottom: "6px" }}>
                  <span style={{ color: "var(--text-soft)" }}>Options:</span>
                  <span style={{ fontWeight: 500 }}>
                    {[
                      quickScan ? "QuickScan" : null,
                      skipPurview ? "SkipPurview" : null,
                      redact ? "Redact" : null,
                      evidence ? "Evidence" : null,
                    ]
                      .filter(Boolean)
                      .join(", ") || "Standard"}
                  </span>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-soft)" }}>Trigger:</span>
                  <span style={{ fontWeight: 500, textTransform: "capitalize" }}>{trigger}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer controls */}
        <div style={footerStyle}>
          <div>
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((s) => (s - 1) as any)}
                style={buttonStyle}
                data-testid="prev-step-button"
              >
                Previous
              </button>
            )}
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                style={buttonStyle}
                data-testid="cancel-dialog-button"
              >
                Cancel
              </button>
            )}

            {step < 4 && (
              <button
                type="button"
                onClick={() => setStep((s) => (s + 1) as any)}
                disabled={step === 1 ? !canProceedStep1 : !canProceedStep2}
                style={{
                  ...primaryButtonStyle,
                  opacity: (step === 1 ? canProceedStep1 : canProceedStep2) ? 1 : 0.5,
                  cursor: (step === 1 ? canProceedStep1 : canProceedStep2) ? "pointer" : "not-allowed",
                }}
                data-testid="next-step-button"
              >
                Next
              </button>
            )}

            {step === 4 && (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                style={primaryButtonStyle}
                data-testid="start-run-button"
              >
                {submitting ? "Starting..." : "Start assessment"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
