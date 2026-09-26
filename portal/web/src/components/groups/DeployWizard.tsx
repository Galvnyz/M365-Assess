"use client";

// DeployWizard — Group template deploy wizard across target tenants with variables and plan preview
// (EPIC-014 SPEC.md §3.2, §4.2; T-0267).
import React, { useState, type CSSProperties } from "react";
import {
  deployGroupTemplate,
  type DeployExecutionResponse,
  type DeployPlanResponse,
  type GroupTemplate,
} from "../../lib/groupsApi";

export interface DeployWizardProps {
  readonly template: GroupTemplate;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onDeployed?: (res: DeployExecutionResponse) => void;
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: "rgba(0, 0, 0, 0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const modalStyle: CSSProperties = {
  background: "var(--bg-elev, #ffffff)",
  borderRadius: "var(--radius, 10px)",
  padding: "24px",
  maxWidth: "650px",
  width: "90%",
  maxHeight: "90vh",
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: "20px",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text, #111827)",
  boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
};

const stepIndicatorStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  borderBottom: "1px solid var(--border, #e5e7eb)",
  paddingBottom: "12px",
  fontSize: "13px",
  fontWeight: 600,
};

const inputStyle: CSSProperties = {
  padding: "8px 12px",
  background: "var(--input-bg, var(--bg, #ffffff))",
  border: "1px solid var(--border, #d1d5db)",
  borderRadius: "6px",
  color: "var(--text, #111827)",
  fontSize: "14px",
  width: "100%",
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

export function DeployWizard({
  template,
  open,
  onClose,
  onDeployed,
}: DeployWizardProps): React.ReactElement | null {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [targetsInput, setTargetsInput] = useState<string>("tenant-prod-1, tenant-prod-2");
  const [variablesInput, setVariablesInput] = useState<string>("department=Finance, region=US");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planResponse, setPlanResponse] = useState<DeployPlanResponse | null>(null);
  const [execResponse, setExecResponse] = useState<DeployExecutionResponse | null>(null);

  if (!open) return null;

  const parseTargets = (): string[] => {
    return targetsInput.split(",").map((s) => s.trim()).filter(Boolean);
  };

  const parseVariables = (): Record<string, string> => {
    const vars: Record<string, string> = {};
    const pairs = variablesInput.split(",").map((s) => s.trim()).filter(Boolean);
    for (const pair of pairs) {
      const [k, v] = pair.split("=");
      if (k && v) {
        vars[k.trim()] = v.trim();
      }
    }
    return vars;
  };

  const handleGeneratePlan = async () => {
    const targets = parseTargets();
    if (targets.length === 0) {
      setError("Please specify at least one target tenant.");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const res = (await deployGroupTemplate(template.id, {
        targets,
        variables: parseVariables(),
        preview: true,
      })) as DeployPlanResponse;
      setPlanResponse(res);
      setStep(3);
    } catch (err: any) {
      setError(err.message || "Failed to generate plan");
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteDeploy = async () => {
    const targets = parseTargets();
    try {
      setLoading(true);
      setError(null);
      const res = (await deployGroupTemplate(template.id, {
        targets,
        variables: parseVariables(),
        preview: false,
      })) as DeployExecutionResponse;
      setExecResponse(res);
      setStep(4);
      onDeployed?.(res);
    } catch (err: any) {
      setError(err.message || "Deployment failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={overlayStyle} onClick={onClose} data-testid="deploy-wizard-overlay">
      <div style={modalStyle} onClick={(e) => e.stopPropagation()} data-testid="deploy-wizard">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>
            Deploy Group Template: {template.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer" }}
            data-testid="wizard-close-btn"
          >
            ×
          </button>
        </div>

        {/* Step indicator */}
        <div style={stepIndicatorStyle}>
          <span style={{ color: step === 1 ? "var(--primary)" : "var(--text-muted)" }}>1. Targets</span>
          <span>&gt;</span>
          <span style={{ color: step === 2 ? "var(--primary)" : "var(--text-muted)" }}>2. Variables</span>
          <span>&gt;</span>
          <span style={{ color: step === 3 ? "var(--primary)" : "var(--text-muted)" }}>3. Plan Preview</span>
          <span>&gt;</span>
          <span style={{ color: step === 4 ? "var(--primary)" : "var(--text-muted)" }}>4. Results</span>
        </div>

        {error && (
          <div style={{ color: "var(--danger, #dc2626)", fontSize: "14px" }} data-testid="wizard-error">
            {error}
          </div>
        )}

        {/* Step 1: Targets */}
        {step === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }} data-testid="wizard-step-1">
            <label style={{ fontSize: "14px", fontWeight: 600 }} htmlFor="target-tenants-input">
              Target Tenant IDs (comma-separated):
            </label>
            <input
              id="target-tenants-input"
              type="text"
              value={targetsInput}
              onChange={(e) => setTargetsInput(e.target.value)}
              placeholder="tenant-a, tenant-b"
              style={inputStyle}
              data-testid="input-wizard-targets"
            />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={() => setStep(2)}
                data-testid="btn-wizard-next-1"
              >
                Next: Variables
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Variables */}
        {step === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }} data-testid="wizard-step-2">
            <label style={{ fontSize: "14px", fontWeight: 600 }} htmlFor="template-variables-input">
              Template Variables (key=value, comma-separated):
            </label>
            <input
              id="template-variables-input"
              type="text"
              value={variablesInput}
              onChange={(e) => setVariablesInput(e.target.value)}
              placeholder="department=Finance, region=US"
              style={inputStyle}
              data-testid="input-wizard-variables"
            />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "10px" }}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => setStep(1)}
                data-testid="btn-wizard-back-2"
              >
                Back
              </button>
              <button
                type="button"
                style={primaryButtonStyle}
                disabled={loading}
                onClick={handleGeneratePlan}
                data-testid="btn-wizard-preview"
              >
                {loading ? "Generating Plan..." : "Generate Plan Preview"}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Plan Preview */}
        {step === 3 && planResponse && (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }} data-testid="wizard-step-3">
            <div style={{ fontSize: "14px", fontWeight: 600 }}>Deployment Plan:</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {planResponse.plans.map((p) => (
                <div
                  key={p.tenantId}
                  style={{
                    padding: "12px",
                    border: "1px solid var(--border, #e5e7eb)",
                    borderRadius: "6px",
                    background: p.conflict ? "rgba(220, 38, 38, 0.05)" : "var(--surface)",
                  }}
                  data-testid={`plan-target-${p.tenantId}`}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                    <span>Target: {p.tenantId}</span>
                    <span style={{ color: p.valid ? "var(--success, #16a34a)" : "var(--danger, #dc2626)" }}>
                      {p.valid ? "Ready" : "Blocked"}
                    </span>
                  </div>
                  <div style={{ fontSize: "13px", marginTop: "4px" }}>
                    Group to create: <strong>{p.targetName}</strong>
                  </div>
                  {p.conflictError && (
                    <div style={{ color: "var(--danger, #dc2626)", fontSize: "13px", marginTop: "4px" }}>
                      ⚠️ {p.conflictError}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "10px" }}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => setStep(2)}
                data-testid="btn-wizard-back-3"
              >
                Back
              </button>
              <button
                type="button"
                style={{
                  ...primaryButtonStyle,
                  background: planResponse.allValid ? "var(--success, #16a34a)" : "var(--primary)",
                }}
                disabled={loading || !planResponse.allValid}
                onClick={handleExecuteDeploy}
                data-testid="btn-wizard-confirm"
              >
                {loading ? "Deploying..." : "Confirm & Deploy"}
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Per-target Results */}
        {step === 4 && execResponse && (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }} data-testid="wizard-step-4">
            <div style={{ fontSize: "14px", fontWeight: 600 }}>Deployment Results:</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {execResponse.deployments.map((d) => (
                <div
                  key={d.id}
                  style={{
                    padding: "12px",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    background: "var(--surface)",
                  }}
                  data-testid={`result-target-${d.tenantId}`}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                    <span>Tenant: {d.tenantId}</span>
                    <span
                      style={{
                        textTransform: "capitalize",
                        color:
                          d.state === "succeeded"
                            ? "var(--success, #16a34a)"
                            : d.state === "partial"
                            ? "var(--warning, #d97706)"
                            : "var(--danger, #dc2626)",
                      }}
                      data-testid={`state-target-${d.tenantId}`}
                    >
                      {d.state}
                    </span>
                  </div>
                  <ul style={{ margin: "6px 0 0 0", paddingLeft: "18px", fontSize: "13px" }}>
                    {d.results.map((r: any, idx: number) => (
                      <li key={idx}>
                        {r.step}: {r.status} {r.error ? `(${r.error})` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={onClose}
                data-testid="btn-wizard-done"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
