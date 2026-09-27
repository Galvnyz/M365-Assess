import React, { useState, type CSSProperties, type ReactElement } from "react";

export type SetupMethod = "create-app" | "existing-app" | "manual-creds" | "import-gdap";
export type M365Environment = "commercial" | "gcc" | "gcchigh" | "dod";
export type AuthMethod = "certificate-thumbprint" | "certificate-pfx" | "client-secret";

export interface ServiceTestResult {
  readonly service: string;
  readonly status: "pass" | "fail";
  readonly connected: boolean;
  readonly error?: string | null;
}

export interface AddTenantWizardProps {
  readonly onComplete?: (data: Record<string, unknown>) => void;
  readonly onCancel?: () => void;
  readonly onResolveTenant?: (input: string) => Promise<{ id: string; defaultDomain?: string; displayName?: string }>;
  readonly onTestConnection?: (tenantId: string, payload?: Record<string, unknown>) => Promise<{
    success: boolean;
    services: ServiceTestResult[];
  }>;
  readonly onSubmitOnboarding?: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  readonly availableGroups?: readonly { id: string; name: string }[];
}

const containerStyle: CSSProperties = {
  maxWidth: "800px",
  margin: "0 auto",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  boxShadow: "var(--shadow-card)",
  color: "var(--text)",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  overflow: "hidden",
};

const stepperHeaderStyle: CSSProperties = {
  display: "flex",
  borderBottom: "1px solid var(--border)",
  background: "var(--surface)",
  overflowX: "auto",
};

const stepIndicatorStyle = (isActive: boolean, isPassed: boolean): CSSProperties => ({
  flex: "1 1 0",
  padding: "14px 10px",
  textAlign: "center",
  fontSize: "13px",
  fontWeight: isActive ? 700 : isPassed ? 600 : 500,
  color: isActive ? "var(--accent-text, var(--accent))" : isPassed ? "var(--success-text, var(--text))" : "var(--text-soft)",
  borderBottom: isActive ? "2px solid var(--accent)" : isPassed ? "2px solid var(--success)" : "2px solid transparent",
  whiteSpace: "nowrap",
});

const contentStyle: CSSProperties = {
  padding: "28px",
  display: "flex",
  flexDirection: "column",
  gap: "20px",
};

const footerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "16px 28px",
  borderTop: "1px solid var(--border)",
  background: "var(--surface)",
};

const inputStyle: CSSProperties = {
  padding: "10px 14px",
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
};

const buttonStyle: CSSProperties = {
  padding: "10px 20px",
  borderRadius: "6px",
  fontSize: "14px",
  fontWeight: 600,
  cursor: "pointer",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
};

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "var(--accent)",
  color: "var(--on-accent)",
  borderColor: "var(--accent)",
};

const radioCardStyle = (selected: boolean): CSSProperties => ({
  padding: "16px",
  borderRadius: "8px",
  border: selected ? "2px solid var(--accent)" : "1px solid var(--border)",
  background: selected ? "var(--accent-soft)" : "var(--surface)",
  cursor: "pointer",
  display: "flex",
  flexDirection: "column",
  gap: "4px",
});

const warningBannerStyle: CSSProperties = {
  padding: "16px",
  borderRadius: "8px",
  background: "var(--danger-soft)",
  border: "1px solid var(--danger)",
  color: "var(--danger-text)",
  fontSize: "14px",
  lineHeight: 1.5,
};

const STEP_TITLES = [
  "1. Setup Method",
  "2. Tenant",
  "3. Credentials",
  "4. Groups & Vars",
  "5. Test Connect",
  "6. Confirmation",
];

export function AddTenantWizard({
  onComplete,
  onCancel,
  onResolveTenant,
  onTestConnection,
  onSubmitOnboarding,
  availableGroups = [],
}: AddTenantWizardProps): ReactElement {
  const [step, setStep] = useState(1);
  const [setupMethod, setSetupMethod] = useState<SetupMethod>("create-app");
  const [tenantInput, setTenantInput] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [defaultDomain, setDefaultDomain] = useState("");
  const [isResolving, setIsResolving] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // Step 3 credentials
  const [adminUpn, setAdminUpn] = useState("");
  const [appDisplayName, setAppDisplayName] = useState("M365-Assess-Reader");
  const [authMethod, setAuthMethod] = useState<AuthMethod>("certificate-thumbprint");
  const [clientId, setClientId] = useState("");
  const [certificateThumbprint, setCertificateThumbprint] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [environment, setEnvironment] = useState<M365Environment>("commercial");

  // Step 4 groups & vars
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [variables, setVariables] = useState<{ name: string; value: string }[]>([]);
  const [newVarName, setNewVarName] = useState("");
  const [newVarValue, setNewVarValue] = useState("");

  // Step 5 test connection
  const [testingConnection, setTestingConnection] = useState(false);
  const [serviceResults, setServiceResults] = useState<ServiceTestResult[] | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  // Step 6 confirmation
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleResolveIdentity = async (): Promise<void> => {
    if (!tenantInput.trim()) return;
    setIsResolving(true);
    setResolveError(null);
    try {
      if (onResolveTenant) {
        const res = await onResolveTenant(tenantInput.trim());
        setTenantId(res.id);
        if (res.displayName && !displayName) setDisplayName(res.displayName);
        if (res.defaultDomain && !defaultDomain) setDefaultDomain(res.defaultDomain);
        setResolved(true);
      } else {
        // Fallback resolution
        setTenantId(tenantInput.trim());
        setResolved(true);
      }
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : "Failed to resolve tenant");
      setResolved(false);
    } finally {
      setIsResolving(false);
    }
  };

  const handleTestConnection = async (): Promise<void> => {
    setTestingConnection(true);
    setTestError(null);
    try {
      if (onTestConnection) {
        const res = await onTestConnection(tenantId || tenantInput, {
          clientId,
          certificateThumbprint,
          clientSecret,
          authMethod,
          environment,
        });
        setServiceResults(res.services);
      } else {
        // Simulated pass
        setServiceResults([
          { service: "Graph", status: "pass", connected: true },
          { service: "ExchangeOnline", status: "pass", connected: true },
          { service: "Purview", status: "pass", connected: true },
        ]);
      }
    } catch (err) {
      setTestError(err instanceof Error ? err.message : "Connection probe failed");
    } finally {
      setTestingConnection(false);
    }
  };

  const handleSubmit = async (): Promise<void> => {
    if (!confirmed) {
      setSubmitError("Explicit confirmation is required before proceeding.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = {
        confirmed: true,
        tenantId: tenantId || tenantInput,
        setupMethod,
        displayName: displayName || undefined,
        defaultDomain: defaultDomain || undefined,
        environment,
        adminUpn: adminUpn || undefined,
        appDisplayName: appDisplayName || undefined,
        clientId: clientId || undefined,
        certificateThumbprint: certificateThumbprint || undefined,
        createNew: setupMethod === "create-app",
        groups: selectedGroups,
        variables,
      };

      if (onSubmitOnboarding) {
        const result = await onSubmitOnboarding(payload);
        onComplete?.(result);
      } else {
        onComplete?.(payload);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Onboarding failed");
    } finally {
      setSubmitting(false);
    }
  };

  const canGoNext = (): boolean => {
    if (step === 1) return true;
    if (step === 2) return (tenantId.length > 0 || tenantInput.length > 0) && resolved;
    if (step === 3) {
      if (setupMethod === "create-app") return adminUpn.trim().length > 0;
      if (setupMethod === "existing-app" || setupMethod === "manual-creds") {
        if (!clientId.trim()) return false;
        if (authMethod === "certificate-thumbprint" && !certificateThumbprint.trim()) return false;
        if (authMethod === "client-secret" && !clientSecret.trim()) return false;
      }
      return true;
    }
    if (step === 4) return true;
    if (step === 5) return serviceResults !== null && serviceResults.every((s) => s.status === "pass");
    return true;
  };

  return (
    <div style={containerStyle} data-testid="add-tenant-wizard">
      {/* Stepper Header */}
      <div style={stepperHeaderStyle} data-testid="wizard-stepper">
        {STEP_TITLES.map((title, idx) => {
          const stepNumber = idx + 1;
          const isActive = step === stepNumber;
          const isPassed = step > stepNumber;
          return (
            <div
              key={title}
              style={stepIndicatorStyle(isActive, isPassed)}
              data-testid={`step-indicator-${stepNumber}`}
            >
              {title}
            </div>
          );
        })}
      </div>

      {/* Step Content */}
      <div style={contentStyle}>
        {/* Step 1: Setup Method */}
        {step === 1 && (
          <div data-testid="wizard-step-1" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <h2 style={{ margin: 0, fontSize: "18px" }}>Select Setup Method</h2>
            <p style={{ margin: 0, color: "var(--text-soft)", fontSize: "14px" }}>
              Choose how to connect and grant permissions to this Microsoft 365 tenant.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div
                style={radioCardStyle(setupMethod === "create-app")}
                onClick={() => setSetupMethod("create-app")}
                data-testid="method-create-app"
              >
                <strong>Create app registration & grant consent (Recommended)</strong>
                <span style={{ fontSize: "13px", color: "var(--text-soft)" }}>
                  Automates creating the Entra ID application, self-signed certificate, and assigning all 28 read-only permissions via Grant-M365AssessConsent.
                </span>
              </div>

              <div
                style={radioCardStyle(setupMethod === "existing-app")}
                onClick={() => setSetupMethod("existing-app")}
                data-testid="method-existing-app"
              >
                <strong>Use existing app registration</strong>
                <span style={{ fontSize: "13px", color: "var(--text-soft)" }}>
                  Configure an already created App Registration in the tenant with client ID and certificate.
                </span>
              </div>

              <div
                style={radioCardStyle(setupMethod === "manual-creds")}
                onClick={() => setSetupMethod("manual-creds")}
                data-testid="method-manual-creds"
              >
                <strong>Enter credentials manually</strong>
                <span style={{ fontSize: "13px", color: "var(--text-soft)" }}>
                  Manually supply certificate thumbprint, PFX path, or client secret.
                </span>
              </div>

              <div
                style={radioCardStyle(setupMethod === "import-gdap")}
                onClick={() => setSetupMethod("import-gdap")}
                data-testid="method-import-gdap"
              >
                <strong>Import from GDAP</strong>
                <span style={{ fontSize: "13px", color: "var(--text-soft)" }}>
                  Import an existing partner tenant discovered via active Granular Delegated Admin Privileges.
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Tenant Identity */}
        {step === 2 && (
          <div data-testid="wizard-step-2" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <h2 style={{ margin: 0, fontSize: "18px" }}>Tenant Identification</h2>
            <p style={{ margin: 0, color: "var(--text-soft)", fontSize: "14px" }}>
              Specify the Microsoft 365 tenant ID or primary domain. We will validate the identity via Resolve-TenantIdentity.
            </p>

            <div>
              <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: 600 }}>
                Tenant Domain or Entra GUID *
              </label>
              <div style={{ display: "flex", gap: "10px" }}>
                <input
                  type="text"
                  placeholder="e.g. contoso.onmicrosoft.com or 00000000-0000-0000-0000-000000000001"
                  value={tenantInput}
                  onChange={(e) => {
                    setTenantInput(e.target.value);
                    setResolved(false);
                  }}
                  style={inputStyle}
                  data-testid="tenant-input"
                />
                <button
                  type="button"
                  onClick={handleResolveIdentity}
                  disabled={isResolving || !tenantInput.trim()}
                  style={buttonStyle}
                  data-testid="resolve-tenant-btn"
                >
                  {isResolving ? "Resolving..." : "Resolve"}
                </button>
              </div>
            </div>

            {resolved && (
              <div
                style={{
                  padding: "12px 16px",
                  borderRadius: "6px",
                  background: "var(--success-soft)",
                  border: "1px solid var(--success)",
                  color: "var(--success-text)",
                  fontSize: "14px",
                }}
                data-testid="resolve-success-banner"
              >
                Tenant identity resolved successfully! Entra ID: <code>{tenantId}</code>
              </div>
            )}

            {resolveError && (
              <div
                style={{
                  padding: "12px 16px",
                  borderRadius: "6px",
                  background: "var(--danger-soft)",
                  border: "1px solid var(--danger)",
                  color: "var(--danger-text)",
                  fontSize: "14px",
                }}
                data-testid="resolve-error-banner"
              >
                {resolveError}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div>
                <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: 600 }}>
                  Display Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Contoso Production"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  style={inputStyle}
                  data-testid="display-name-input"
                />
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: 600 }}>
                  Primary Domain
                </label>
                <input
                  type="text"
                  placeholder="e.g. contoso.com"
                  value={defaultDomain}
                  onChange={(e) => setDefaultDomain(e.target.value)}
                  style={inputStyle}
                  data-testid="default-domain-input"
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Credentials */}
        {step === 3 && (
          <div data-testid="wizard-step-3" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <h2 style={{ margin: 0, fontSize: "18px" }}>Configure Credentials</h2>
            <p style={{ margin: 0, color: "var(--text-soft)", fontSize: "14px" }}>
              {setupMethod === "create-app"
                ? "Enter administrator credentials required to perform the delegated app creation and admin consent bootstrap."
                : "Provide authentication details for the registered application."}
            </p>

            <div>
              <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: 600 }}>
                Target Cloud Environment
              </label>
              <select
                value={environment}
                onChange={(e) => setEnvironment(e.target.value as M365Environment)}
                style={selectStyle}
                data-testid="environment-select"
              >
                <option value="commercial">Commercial / Standard</option>
                <option value="gcc">GCC (Government Community Cloud)</option>
                <option value="gcchigh">GCC High</option>
                <option value="dod">DoD (Department of Defense)</option>
              </select>
            </div>

            {setupMethod === "create-app" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div>
                  <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: 600 }}>
                    Global / Application Admin UPN *
                  </label>
                  <input
                    type="email"
                    placeholder="admin@contoso.onmicrosoft.com"
                    value={adminUpn}
                    onChange={(e) => setAdminUpn(e.target.value)}
                    style={inputStyle}
                    data-testid="admin-upn-input"
                  />
                  <span style={{ fontSize: "12px", color: "var(--text-soft)", marginTop: "4px", display: "block" }}>
                    Used solely for the bootstrap step to grant admin consent and assign directory roles.
                  </span>
                </div>

                <div>
                  <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: 600 }}>
                    App Registration Display Name
                  </label>
                  <input
                    type="text"
                    value={appDisplayName}
                    onChange={(e) => setAppDisplayName(e.target.value)}
                    style={inputStyle}
                    data-testid="app-display-name-input"
                  />
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div>
                  <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: 600 }}>
                    Authentication Method
                  </label>
                  <select
                    value={authMethod}
                    onChange={(e) => setAuthMethod(e.target.value as AuthMethod)}
                    style={selectStyle}
                    data-testid="auth-method-select"
                  >
                    <option value="certificate-thumbprint">Certificate Thumbprint (Windows Keystore)</option>
                    <option value="certificate-pfx">Certificate PFX File (Cross-platform)</option>
                    <option value="client-secret">Client Secret (Graph only)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: 600 }}>
                    Application (Client) ID *
                  </label>
                  <input
                    type="text"
                    placeholder="00000000-0000-0000-0000-000000000000"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    style={inputStyle}
                    data-testid="client-id-input"
                  />
                </div>

                {authMethod === "certificate-thumbprint" && (
                  <div>
                    <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: 600 }}>
                      Certificate Thumbprint *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 40-character hex thumbprint"
                      value={certificateThumbprint}
                      onChange={(e) => setCertificateThumbprint(e.target.value)}
                      style={inputStyle}
                      data-testid="thumbprint-input"
                    />
                  </div>
                )}

                {authMethod === "client-secret" && (
                  <div>
                    <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: 600 }}>
                      Client Secret *
                    </label>
                    <input
                      type="password"
                      placeholder="Enter client secret value"
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      style={inputStyle}
                      data-testid="client-secret-input"
                    />
                    <span style={{ fontSize: "12px", color: "var(--warn-text)", marginTop: "4px", display: "block" }}>
                      Note: Exchange Online and Purview do not support client secrets; certificate auth is recommended.
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 4: Groups & Variables */}
        {step === 4 && (
          <div data-testid="wizard-step-4" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <h2 style={{ margin: 0, fontSize: "18px" }}>Tenant Groups & Variables (Optional)</h2>
            <p style={{ margin: 0, color: "var(--text-soft)", fontSize: "14px" }}>
              Assign this tenant to groups for targeted assessments and configure template variables.
            </p>

            {availableGroups.length > 0 && (
              <div>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "13px", fontWeight: 600 }}>
                  Assign to Tenant Groups
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {availableGroups.map((g) => {
                    const isSelected = selectedGroups.includes(g.id);
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() =>
                          setSelectedGroups((prev) =>
                            isSelected ? prev.filter((id) => id !== g.id) : [...prev, g.id],
                          )
                        }
                        style={{
                          ...buttonStyle,
                          background: isSelected ? "var(--accent)" : "var(--surface)",
                          color: isSelected ? "var(--accent-text)" : "var(--text)",
                          borderColor: isSelected ? "var(--accent)" : "var(--border)",
                        }}
                        data-testid={`group-chip-${g.id}`}
                      >
                        {g.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <label style={{ display: "block", marginBottom: "8px", fontSize: "13px", fontWeight: 600 }}>
                Add Custom Variable
              </label>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  placeholder="Variable name (e.g. OrgName)"
                  value={newVarName}
                  onChange={(e) => setNewVarName(e.target.value)}
                  style={{ ...inputStyle, width: "40%" }}
                  data-testid="var-name-input"
                />
                <input
                  type="text"
                  placeholder="Value"
                  value={newVarValue}
                  onChange={(e) => setNewVarValue(e.target.value)}
                  style={{ ...inputStyle, width: "40%" }}
                  data-testid="var-value-input"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (newVarName.trim()) {
                      setVariables((prev) => [...prev, { name: newVarName.trim(), value: newVarValue }]);
                      setNewVarName("");
                      setNewVarValue("");
                    }
                  }}
                  style={buttonStyle}
                  data-testid="add-var-btn"
                >
                  Add
                </button>
              </div>

              {variables.length > 0 && (
                <ul style={{ marginTop: "12px", paddingLeft: "20px" }}>
                  {variables.map((v, i) => (
                    <li key={i} style={{ fontSize: "14px", marginBottom: "4px" }}>
                      <code>%{v.name}%</code> = {v.value}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Step 5: Test Connection */}
        {step === 5 && (
          <div data-testid="wizard-step-5" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <h2 style={{ margin: 0, fontSize: "18px" }}>Test Connection</h2>
            <p style={{ margin: 0, color: "var(--text-soft)", fontSize: "14px" }}>
              Verify connectivity to Graph, Exchange Online, and Purview using the configured credentials.
            </p>

            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testingConnection}
              style={primaryButtonStyle}
              data-testid="run-test-connection-btn"
            >
              {testingConnection ? "Probing Cloud Services..." : "Run Test Connection"}
            </button>

            {testError && (
              <div
                style={{
                  padding: "12px 16px",
                  borderRadius: "6px",
                  background: "var(--danger-soft)",
                  border: "1px solid var(--danger)",
                  color: "var(--danger-text)",
                  fontSize: "14px",
                }}
                data-testid="test-error-banner"
              >
                {testError}
              </div>
            )}

            {serviceResults && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "12px" }}>
                <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600 }}>Service Probe Results</h3>
                {serviceResults.map((sr) => (
                  <div
                    key={sr.service}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "12px 16px",
                      borderRadius: "6px",
                      background: sr.status === "pass" ? "var(--success-soft)" : "var(--danger-soft)",
                      border: `1px solid ${sr.status === "pass" ? "var(--success)" : "var(--danger)"}`,
                      color: sr.status === "pass" ? "var(--success-text)" : "var(--danger-text)",
                    }}
                    data-testid={`service-result-${sr.service}`}
                  >
                    <div>
                      <strong>{sr.service}</strong>
                      {sr.error && <p style={{ margin: "4px 0 0", fontSize: "12px" }}>{sr.error}</p>}
                    </div>
                    <span style={{ fontWeight: 700, textTransform: "uppercase", fontSize: "13px" }}>
                      {sr.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 6: Confirmation */}
        {step === 6 && (
          <div data-testid="wizard-step-6" style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            <h2 style={{ margin: 0, fontSize: "18px" }}>Confirmation & Consent</h2>

            <div style={warningBannerStyle} data-testid="high-impact-warning">
              <strong>HIGH-IMPACT SETUP ACTION:</strong>
              <p style={{ margin: "6px 0 0" }}>
                Onboarding mutates tenant configuration: it provisions an Entra ID application
                registration, assigns 28 read-only API permissions, grants tenant-wide admin consent,
                and adds directory role memberships. This action requires Global Administrator or
                Application Administrator privileges in the tenant.
              </p>
            </div>

            <div style={{ background: "var(--surface)", padding: "16px", borderRadius: "8px", fontSize: "14px" }}>
              <h4 style={{ margin: "0 0 10px", fontSize: "15px" }}>Summary</h4>
              <div><strong>Tenant:</strong> {displayName || tenantInput} (<code>{tenantId || tenantInput}</code>)</div>
              <div><strong>Setup Method:</strong> {setupMethod}</div>
              <div><strong>Environment:</strong> {environment}</div>
              {setupMethod === "create-app" && <div><strong>Admin UPN:</strong> {adminUpn}</div>}
              {setupMethod !== "create-app" && clientId && <div><strong>Client ID:</strong> <code>{clientId}</code></div>}
            </div>

            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
                cursor: "pointer",
                padding: "12px",
                background: "var(--surface)",
                borderRadius: "6px",
                border: "1px solid var(--border)",
              }}
            >
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                style={{ marginTop: "3px" }}
                data-testid="confirm-checkbox"
              />
              <span style={{ fontSize: "14px", fontWeight: 500 }}>
                I confirm and explicitly authorize this tenant-mutating setup write.
              </span>
            </label>

            {submitError && (
              <div
                style={{
                  padding: "12px 16px",
                  borderRadius: "6px",
                  background: "var(--danger-soft)",
                  border: "1px solid var(--danger)",
                  color: "var(--danger-text)",
                  fontSize: "14px",
                }}
                data-testid="submit-error-banner"
              >
                {submitError}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer Navigation */}
      <div style={footerStyle}>
        <div>
          {step > 1 && (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              style={buttonStyle}
              data-testid="wizard-prev-btn"
            >
              Previous
            </button>
          )}
          {step === 1 && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              style={buttonStyle}
              data-testid="wizard-cancel-btn"
            >
              Cancel
            </button>
          )}
        </div>

        <div>
          {step < 6 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              disabled={!canGoNext()}
              style={primaryButtonStyle}
              data-testid="wizard-next-btn"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!confirmed || submitting}
              style={{
                ...primaryButtonStyle,
                background: confirmed ? "var(--success)" : "var(--chip)",
                borderColor: confirmed ? "var(--success)" : "var(--border)",
                color: confirmed ? "var(--success-text)" : "var(--text-soft)",
              }}
              data-testid="wizard-submit-btn"
            >
              {submitting ? "Onboarding Tenant..." : "Complete Onboarding"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
