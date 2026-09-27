"use client";

// NamedLocationEditor — Conditional Access Named Location editor (EPIC-015 SPEC §3.4, §6, §11.5; T-0288).
// Supports IP-based and country-based named locations.
// Validates CIDR notation for IP ranges and ISO 3166-1 alpha-2 codes for countries.
// Displays referencing policies and warns before deleting a location in use.
import React, { useMemo, useState, type CSSProperties } from "react";

export interface ReferencingPolicy {
  readonly id: string;
  readonly displayName: string;
}

export interface NamedLocationData {
  readonly id?: string;
  readonly displayName: string;
  readonly locationType: "ip" | "country";
  readonly isTrusted?: boolean;
  readonly ipRanges?: string[];
  readonly countriesAndRegions?: string[];
  readonly includeUnknownCountriesAndRegions?: boolean;
  readonly countryLookupMethod?: string;
  readonly referencingPolicies?: readonly ReferencingPolicy[];
}

export interface NamedLocationPlan {
  readonly action: "create" | "edit" | "delete";
  readonly locationId?: string;
  readonly targetName: string;
  readonly diff: readonly string[];
  readonly valid: boolean;
  readonly referencingPolicies?: readonly ReferencingPolicy[];
  readonly inUse?: boolean;
  readonly warning?: string;
}

export interface NamedLocationEditorProps {
  readonly initialLocation?: NamedLocationData | null;
  readonly referencingPolicies?: readonly ReferencingPolicy[];
  readonly isNew?: boolean;
  readonly onSave?: (location: NamedLocationData) => Promise<void>;
  readonly onDelete?: (locationId: string, confirmName?: string) => Promise<void>;
  readonly onPreviewPlan?: (
    location: NamedLocationData,
    action: "create" | "edit" | "delete",
  ) => Promise<NamedLocationPlan>;
  readonly onCancel?: () => void;
}

export function isValidCidr(cidr: string): boolean {
  if (typeof cidr !== "string" || cidr.trim().length === 0) return false;
  const trimmed = cidr.trim();

  // IPv4 CIDR
  const ipv4 = trimmed.match(
    /^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\/([0-9]|[12][0-9]|3[0-2])$/,
  );
  if (ipv4) return true;

  // IPv6 CIDR
  const ipv6 = trimmed.match(/^([0-9a-fA-F:]+)\/([0-9]|[1-9][0-9]|1[01][0-9]|12[0-8])$/);
  if (ipv6 && trimmed.includes(":")) {
    const parts = ipv6[1]!.split(":");
    if (parts.length >= 3 && parts.length <= 8) return true;
  }

  return false;
}

export function isValidCountryCode(code: string): boolean {
  if (typeof code !== "string") return false;
  return /^[A-Za-z]{2}$/.test(code.trim());
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "20px",
  maxWidth: "760px",
  margin: "0 auto",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text, #111827)",
};

const cardStyle: CSSProperties = {
  padding: "20px",
  borderRadius: "8px",
  border: "1px solid var(--border, #e5e7eb)",
  backgroundColor: "var(--bg, #ffffff)",
  display: "flex",
  flexDirection: "column",
  gap: "16px",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "18px",
  fontWeight: 600,
  color: "var(--text, #111827)",
};

const labelStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 500,
  color: "var(--text-secondary, #4b5563)",
  display: "flex",
  flexDirection: "column",
  gap: "6px",
};

const inputStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: "6px",
  border: "1px solid var(--border, #d1d5db)",
  fontSize: "14px",
  backgroundColor: "var(--bg, #ffffff)",
  color: "var(--text, #111827)",
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: "90px",
  fontFamily: "monospace",
};

const btnPrimary: CSSProperties = {
  padding: "8px 16px",
  backgroundColor: "var(--primary, #2563eb)",
  color: "#ffffff",
  border: "none",
  borderRadius: "6px",
  cursor: "pointer",
  fontWeight: 500,
  fontSize: "14px",
};

const btnSecondary: CSSProperties = {
  padding: "8px 16px",
  backgroundColor: "transparent",
  color: "var(--text, #374151)",
  border: "1px solid var(--border, #d1d5db)",
  borderRadius: "6px",
  cursor: "pointer",
  fontWeight: 500,
  fontSize: "14px",
};

const btnDanger: CSSProperties = {
  padding: "8px 16px",
  backgroundColor: "#dc2626",
  color: "#ffffff",
  border: "none",
  borderRadius: "6px",
  cursor: "pointer",
  fontWeight: 500,
  fontSize: "14px",
};

const warningBoxStyle: CSSProperties = {
  padding: "12px 16px",
  borderRadius: "6px",
  backgroundColor: "#fffbeb",
  border: "1px solid #fde68a",
  color: "#92400e",
  fontSize: "13px",
  display: "flex",
  flexDirection: "column",
  gap: "6px",
};

const diffBoxStyle: CSSProperties = {
  padding: "12px",
  borderRadius: "6px",
  backgroundColor: "#f9fafb",
  border: "1px solid #e5e7eb",
  fontFamily: "monospace",
  fontSize: "12px",
  whiteSpace: "pre-wrap",
};

export function NamedLocationEditor({
  initialLocation,
  referencingPolicies: externalReferencing,
  isNew = false,
  onSave,
  onDelete,
  onPreviewPlan,
  onCancel,
}: NamedLocationEditorProps) {
  const [displayName, setDisplayName] = useState<string>(initialLocation?.displayName ?? "");
  const [locationType, setLocationType] = useState<"ip" | "country">(
    initialLocation?.locationType ?? "ip",
  );
  const [isTrusted, setIsTrusted] = useState<boolean>(initialLocation?.isTrusted ?? false);
  const [ipRangesText, setIpRangesText] = useState<string>(
    initialLocation?.ipRanges?.join("\n") ?? "",
  );
  const [countriesText, setCountriesText] = useState<string>(
    initialLocation?.countriesAndRegions?.join(", ") ?? "",
  );
  const [includeUnknownCountries, setIncludeUnknownCountries] = useState<boolean>(
    initialLocation?.includeUnknownCountriesAndRegions ?? false,
  );

  // Deletion and confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [confirmNameInput, setConfirmNameInput] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  // Plan preview state
  const [planPreview, setPlanPreview] = useState<NamedLocationPlan | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const referencingPolicies = useMemo(() => {
    return externalReferencing ?? initialLocation?.referencingPolicies ?? [];
  }, [externalReferencing, initialLocation]);

  const inUse = referencingPolicies.length > 0;

  // Parse and validate items
  const parsedIpRanges = useMemo(() => {
    return ipRangesText
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }, [ipRangesText]);

  const parsedCountries = useMemo(() => {
    return countriesText
      .split(/[\n,]/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0);
  }, [countriesText]);

  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    if (!displayName.trim()) {
      errors.push("Display name is required.");
    }
    if (locationType === "ip") {
      if (parsedIpRanges.length === 0) {
        errors.push("At least one CIDR IP range is required.");
      } else {
        for (const range of parsedIpRanges) {
          if (!isValidCidr(range)) {
            errors.push(`Invalid CIDR range: '${range}'. Example: 192.168.1.0/24 or 2001:db8::/32.`);
          }
        }
      }
    } else {
      if (parsedCountries.length === 0) {
        errors.push("At least one country code is required.");
      } else {
        for (const code of parsedCountries) {
          if (!isValidCountryCode(code)) {
            errors.push(`Invalid country code: '${code}'. Must be a 2-letter ISO 3166-1 alpha-2 code (e.g. US, CA, GB).`);
          }
        }
      }
    }
    return errors;
  }, [displayName, locationType, parsedIpRanges, parsedCountries]);

  const isValid = validationErrors.length === 0;

  const currentLocationData = useMemo<NamedLocationData>(() => {
    return {
      id: initialLocation?.id,
      displayName: displayName.trim(),
      locationType,
      isTrusted: locationType === "ip" ? isTrusted : false,
      ipRanges: locationType === "ip" ? parsedIpRanges : undefined,
      countriesAndRegions: locationType === "country" ? parsedCountries : undefined,
      includeUnknownCountriesAndRegions:
        locationType === "country" ? includeUnknownCountries : false,
      referencingPolicies,
    };
  }, [
    initialLocation?.id,
    displayName,
    locationType,
    isTrusted,
    parsedIpRanges,
    parsedCountries,
    includeUnknownCountries,
    referencingPolicies,
  ]);

  const handlePreview = async () => {
    if (!onPreviewPlan || !isValid) return;
    setIsPreviewing(true);
    setErrorMsg(null);
    try {
      const plan = await onPreviewPlan(
        currentLocationData,
        isNew ? "create" : "edit",
      );
      setPlanPreview(plan);
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Failed to generate plan preview.");
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleSave = async () => {
    if (!onSave || !isValid) return;
    setIsSaving(true);
    setErrorMsg(null);
    try {
      await onSave(currentLocationData);
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Failed to save named location.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete || !initialLocation?.id) return;
    if (inUse && confirmNameInput.trim() !== initialLocation.displayName.trim()) {
      setErrorMsg(
        `Confirmation required: Please type the exact location name '${initialLocation.displayName}' to confirm deletion.`,
      );
      return;
    }
    setIsDeleting(true);
    setErrorMsg(null);
    try {
      await onDelete(initialLocation.id, confirmNameInput.trim());
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Failed to delete named location.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div style={containerStyle} data-testid="named-location-editor">
      <div style={cardStyle}>
        <h2 style={titleStyle}>
          {isNew ? "Create Named Location" : `Edit Named Location: ${initialLocation?.displayName ?? ""}`}
        </h2>

        {/* Location Type Selector */}
        <label style={labelStyle}>
          <span>Location Type</span>
          <div style={{ display: "flex", gap: "16px", marginTop: "4px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
              <input
                type="radio"
                name="locationType"
                value="ip"
                checked={locationType === "ip"}
                onChange={() => setLocationType("ip")}
                data-testid="location-type-ip"
              />
              <span>IP ranges</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
              <input
                type="radio"
                name="locationType"
                value="country"
                checked={locationType === "country"}
                onChange={() => setLocationType("country")}
                data-testid="location-type-country"
              />
              <span>Countries / Regions</span>
            </label>
          </div>
        </label>

        {/* Display Name */}
        <label style={labelStyle}>
          <span>Display Name *</span>
          <input
            type="text"
            style={inputStyle}
            placeholder="e.g. Corporate Headquarters or Approved Countries"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            data-testid="location-name-input"
          />
        </label>

        {/* IP Location Controls */}
        {locationType === "ip" && (
          <>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "14px" }}>
              <input
                type="checkbox"
                checked={isTrusted}
                onChange={(e) => setIsTrusted(e.target.checked)}
                data-testid="is-trusted-checkbox"
              />
              <span>Mark as trusted location</span>
            </label>

            <label style={labelStyle}>
              <span>IP CIDR Ranges * (one per line or comma-separated)</span>
              <textarea
                style={textareaStyle}
                placeholder="192.168.1.0/24&#10;10.0.0.0/8&#10;2001:db8::/32"
                value={ipRangesText}
                onChange={(e) => setIpRangesText(e.target.value)}
                data-testid="ip-ranges-input"
              />
            </label>
          </>
        )}

        {/* Country Location Controls */}
        {locationType === "country" && (
          <>
            <label style={labelStyle}>
              <span>Country / Region Codes * (ISO 3166-1 alpha-2, e.g. US, CA, GB)</span>
              <input
                type="text"
                style={inputStyle}
                placeholder="US, CA, GB"
                value={countriesText}
                onChange={(e) => setCountriesText(e.target.value)}
                data-testid="countries-input"
              />
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "14px" }}>
              <input
                type="checkbox"
                checked={includeUnknownCountries}
                onChange={(e) => setIncludeUnknownCountries(e.target.checked)}
                data-testid="include-unknown-countries-checkbox"
              />
              <span>Include unknown countries / regions</span>
            </label>
          </>
        )}

        {/* Referencing Policies Display */}
        <div style={{ marginTop: "8px", paddingTop: "12px", borderTop: "1px solid var(--border, #e5e7eb)" }}>
          <h4 style={{ margin: "0 0 6px 0", fontSize: "14px", fontWeight: 600 }}>
            Policy References
          </h4>
          {inUse ? (
            <div data-testid="referencing-policies-list">
              <span style={{ fontSize: "13px", color: "var(--text-secondary, #4b5563)" }}>
                Referenced by {referencingPolicies.length} policy/policies:
              </span>
              <ul style={{ margin: "6px 0 0 0", paddingLeft: "20px", fontSize: "13px" }}>
                {referencingPolicies.map((p) => (
                  <li key={p.id}>
                    <strong>{p.displayName}</strong> ({p.id})
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: "13px", color: "var(--text-muted, #6b7280)" }} data-testid="no-referencing-policies">
              Not currently referenced by any Conditional Access policies.
            </p>
          )}
        </div>

        {/* Validation Errors */}
        {validationErrors.length > 0 && displayName.trim().length > 0 && (
          <div style={{ color: "#dc2626", fontSize: "13px" }} data-testid="validation-errors">
            {validationErrors.map((err, idx) => (
              <div key={idx}>{err}</div>
            ))}
          </div>
        )}

        {/* Error Message */}
        {errorMsg && (
          <div style={{ color: "#dc2626", fontSize: "13px" }} data-testid="general-error-message">
            {errorMsg}
          </div>
        )}

        {/* Plan Diff Box */}
        {planPreview && (
          <div style={{ marginTop: "12px" }} data-testid="plan-preview-box">
            <h4 style={{ margin: "0 0 6px 0", fontSize: "13px", fontWeight: 600 }}>
              Plan Preview ({planPreview.action})
            </h4>
            <div style={diffBoxStyle}>
              {planPreview.diff.join("\n")}
            </div>
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px" }}>
          <div>
            {!isNew && initialLocation?.id && !showDeleteConfirm && (
              <button
                type="button"
                style={btnDanger}
                onClick={() => setShowDeleteConfirm(true)}
                data-testid="delete-btn"
              >
                Delete Location
              </button>
            )}
          </div>

          <div style={{ display: "flex", gap: "12px" }}>
            {onCancel && (
              <button type="button" style={btnSecondary} onClick={onCancel} data-testid="cancel-btn">
                Cancel
              </button>
            )}
            {onPreviewPlan && (
              <button
                type="button"
                style={btnSecondary}
                disabled={!isValid || isPreviewing}
                onClick={handlePreview}
                data-testid="preview-plan-btn"
              >
                {isPreviewing ? "Previewing..." : "Preview Plan"}
              </button>
            )}
            {onSave && (
              <button
                type="button"
                style={btnPrimary}
                disabled={!isValid || isSaving}
                onClick={handleSave}
                data-testid="save-btn"
              >
                {isSaving ? "Saving..." : isNew ? "Create Location" : "Save Changes"}
              </button>
            )}
          </div>
        </div>

        {/* In-Use Deletion Warning & Confirmation */}
        {showDeleteConfirm && (
          <div style={{ ...warningBoxStyle, marginTop: "12px" }} data-testid="delete-warning-box">
            {inUse ? (
              <>
                <strong style={{ color: "#b45309" }}>
                  Warning: This named location is referenced by {referencingPolicies.length} Conditional Access policy/policies!
                </strong>
                <span>
                  Deleting it will remove location enforcement and may result in unexpected access or lockout risks.
                </span>
                <label style={{ ...labelStyle, marginTop: "8px" }}>
                  <span>
                    To confirm deletion, type <strong>{initialLocation?.displayName}</strong>:
                  </span>
                  <input
                    type="text"
                    style={inputStyle}
                    value={confirmNameInput}
                    onChange={(e) => setConfirmNameInput(e.target.value)}
                    placeholder={initialLocation?.displayName}
                    data-testid="confirm-delete-input"
                  />
                </label>
              </>
            ) : (
              <span>Are you sure you want to delete this named location? This action cannot be undone.</span>
            )}

            <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
              <button
                type="button"
                style={btnDanger}
                disabled={isDeleting || (inUse && confirmNameInput.trim() !== initialLocation?.displayName.trim())}
                onClick={handleDelete}
                data-testid="confirm-delete-btn"
              >
                {isDeleting ? "Deleting..." : "Confirm Delete"}
              </button>
              <button
                type="button"
                style={btnSecondary}
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setConfirmNameInput("");
                }}
                data-testid="cancel-delete-btn"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
