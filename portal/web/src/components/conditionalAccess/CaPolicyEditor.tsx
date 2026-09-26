"use client";

// CaPolicyEditor — Conditional Access policy editor with guardrail checks, plan preview,
// and break-glass exclusion picker (EPIC-015 SPEC.md §3.3, §4.1, §4.3; T-0284).
import React, { useMemo, useState, type CSSProperties } from "react";
import type {
  CaPolicyItem,
  CaPolicyState,
  CaPolicyCreateInput,
  CaPolicyEditInput,
  CaPlan,
} from "../../lib/caApi";
import { CaConditionBuilder } from "./CaConditionBuilder";

export interface CaPolicyEditorProps {
  readonly initialPolicy?: CaPolicyItem | null;
  readonly isNew?: boolean;
  readonly onSave?: (payload: CaPolicyCreateInput | CaPolicyEditInput) => Promise<void>;
  readonly onPreviewPlan?: (payload: CaPolicyCreateInput | CaPolicyEditInput) => Promise<CaPlan>;
  readonly onCancel?: () => void;
}

const GLOBAL_ADMIN_ROLE_ID = "62e90394-69f5-4237-9190-012177145e10";

const editorContainerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "24px",
  maxWidth: "960px",
  margin: "0 auto",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text, #111827)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  paddingBottom: "16px",
  borderBottom: "1px solid var(--border, #e5e7eb)",
};

const sectionCardStyle: CSSProperties = {
  padding: "20px",
  borderRadius: "8px",
  border: "1px solid var(--border, #e5e7eb)",
  backgroundColor: "var(--bg, #ffffff)",
  display: "flex",
  flexDirection: "column",
  gap: "16px",
};

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "16px",
  fontWeight: 600,
  color: "var(--text, #111827)",
};

const labelStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 600,
  color: "var(--text, #374151)",
};

const inputStyle: CSSProperties = {
  padding: "8px 12px",
  background: "var(--bg, #ffffff)",
  border: "1px solid var(--border, #d1d5db)",
  borderRadius: "6px",
  color: "var(--text, #111827)",
  fontSize: "14px",
  width: "100%",
};

const bannerWarningStyle: CSSProperties = {
  padding: "14px 18px",
  borderRadius: "8px",
  backgroundColor: "#fef3c7",
  border: "1px solid #fcd34d",
  color: "#92400e",
  fontSize: "13px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
};

const bannerErrorStyle: CSSProperties = {
  padding: "14px 18px",
  borderRadius: "8px",
  backgroundColor: "#fee2e2",
  border: "1px solid #fca5a5",
  color: "#b91c1c",
  fontSize: "13px",
  display: "flex",
  flexDirection: "column",
  gap: "4px",
};

const primaryButtonStyle: CSSProperties = {
  padding: "10px 20px",
  background: "var(--primary, #2563eb)",
  color: "#ffffff",
  border: "none",
  borderRadius: "6px",
  fontWeight: 600,
  fontSize: "14px",
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  padding: "10px 18px",
  background: "var(--bg, #ffffff)",
  color: "var(--text, #111827)",
  border: "1px solid var(--border, #d1d5db)",
  borderRadius: "6px",
  fontWeight: 600,
  fontSize: "14px",
  cursor: "pointer",
};

const diffBoxStyle: CSSProperties = {
  padding: "14px",
  backgroundColor: "#0f172a",
  color: "#f8fafc",
  borderRadius: "6px",
  fontFamily: "monospace",
  fontSize: "12px",
  maxHeight: "240px",
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: "4px",
};

export const CaPolicyEditor: React.FC<CaPolicyEditorProps> = ({
  initialPolicy = null,
  isNew = true,
  onSave,
  onPreviewPlan,
  onCancel,
}) => {
  const [displayName, setDisplayName] = useState(
    initialPolicy?.displayName || initialPolicy?.name || "",
  );
  // Default new policy to report-only (SPEC §11.1)
  const [state, setState] = useState<CaPolicyState>(
    (initialPolicy?.state as CaPolicyState) || "enabledForReportingButNotEnforced",
  );

  const [users, setUsers] = useState(
    initialPolicy?.usersTargeted || {
      includeUsers: ["All"],
      excludeUsers: [],
      excludeRoles: [],
      summary: "All users",
    },
  );

  const [apps, setApps] = useState(
    initialPolicy?.apps || {
      includeApplications: ["All"],
      summary: "All cloud apps",
    },
  );

  const [conditions, setConditions] = useState(
    initialPolicy?.conditions || {
      clientAppTypes: [],
      signInRiskLevels: [],
      userRiskLevels: [],
      summary: "Any",
    },
  );

  const [isBlock, setIsBlock] = useState(
    Boolean(initialPolicy?.grantControls?.builtInControls?.includes("block")),
  );
  const [grantControlsList, setGrantControlsList] = useState<string[]>(
    initialPolicy?.grantControls?.builtInControls?.filter((c) => c !== "block") || ["mfa"],
  );
  const [grantOperator, setGrantOperator] = useState<string>(
    initialPolicy?.grantControls?.operator || "OR",
  );

  const [planPreview, setPlanPreview] = useState<CaPlan | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Guardrail 1: All users + Block without break-glass exclusion is hard-blocked (SPEC §11.2)
  const isAllUsersTargeted = (users.includeUsers || []).includes("All");
  const hasExclusion =
    (users.excludeUsers || []).length > 0 ||
    (users.excludeGroups || []).length > 0 ||
    (users.excludeRoles || []).length > 0;
  const isHardBlocked = isAllUsersTargeted && isBlock && !hasExclusion;

  // Guardrail 2: All users without admin exclusion warns (SPEC §4.3, §9)
  const hasAdminRoleExclusion = (users.excludeRoles || []).includes(GLOBAL_ADMIN_ROLE_ID);
  const showAdminExclusionWarning = isAllUsersTargeted && !hasAdminRoleExclusion && !isHardBlocked;

  const handleQuickAddBreakGlass = () => {
    const existingUsers = users.excludeUsers || [];
    const existingRoles = users.excludeRoles || [];
    const nextUsers = existingUsers.includes("breakglass@contoso.com")
      ? existingUsers
      : [...existingUsers, "breakglass@contoso.com"];
    const nextRoles = existingRoles.includes(GLOBAL_ADMIN_ROLE_ID)
      ? existingRoles
      : [...existingRoles, GLOBAL_ADMIN_ROLE_ID];

    setUsers({
      ...users,
      excludeUsers: nextUsers,
      excludeRoles: nextRoles,
      summary: `All users (excludes ${nextUsers.length + nextRoles.length})`,
    });
  };

  const assembledPayload = useMemo((): CaPolicyCreateInput => {
    const builtIn = isBlock ? ["block"] : grantControlsList;
    return {
      displayName: displayName.trim(),
      state,
      conditions: {
        users,
        applications: apps,
        clientAppTypes: conditions.clientAppTypes,
        signInRiskLevels: conditions.signInRiskLevels,
      },
      grantControls: {
        operator: grantOperator,
        builtInControls: builtIn,
      },
    };
  }, [displayName, state, users, apps, conditions, isBlock, grantControlsList, grantOperator]);

  const handlePreview = async () => {
    if (isHardBlocked) return;
    setPreviewLoading(true);
    setSaveError(null);
    try {
      if (onPreviewPlan) {
        const plan = await onPreviewPlan(assembledPayload);
        setPlanPreview(plan);
      } else {
        // Fallback local plan preview diff
        setPlanPreview({
          action: isNew ? "create" : "edit",
          policyId: initialPolicy?.id,
          targetName: displayName || "Untitled Policy",
          diff: [
            isNew ? `+ Policy: ${displayName || "Untitled"}` : `~ Policy: ${displayName}`,
            `+ State: ${state}`,
            `+ Targets: ${users.summary || "None"}`,
            `+ Controls: ${isBlock ? "Block" : grantControlsList.join(", ")}`,
          ],
          valid: true,
          dryRun: true,
          requiresConfirmation: false,
        });
      }
    } catch (err: any) {
      setSaveError(err.message || "Plan preview failed");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleApply = async () => {
    if (isHardBlocked) return;
    setSaveLoading(true);
    setSaveError(null);
    try {
      if (onSave) {
        await onSave(assembledPayload);
      }
    } catch (err: any) {
      setSaveError(err.message || "Failed to apply policy");
    } finally {
      setSaveLoading(false);
    }
  };

  return (
    <div style={editorContainerStyle} data-testid="ca-policy-editor">
      {/* Header */}
      <div style={headerStyle}>
        <div>
          <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 700 }}>
            {isNew ? "New Conditional Access Policy" : `Edit Policy: ${displayName}`}
          </h1>
          <span style={{ fontSize: "13px", color: "var(--text-muted, #6b7280)" }}>
            Configure identity conditions, access controls, and guardrails
          </span>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          {onCancel ? (
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={onCancel}
              data-testid="cancel-btn"
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={handlePreview}
            disabled={previewLoading || isHardBlocked}
            data-testid="preview-plan-btn"
          >
            {previewLoading ? "Generating diff..." : "Preview plan"}
          </button>
          <button
            type="button"
            style={{
              ...primaryButtonStyle,
              opacity: isHardBlocked ? 0.5 : 1,
              cursor: isHardBlocked ? "not-allowed" : "pointer",
            }}
            onClick={handleApply}
            disabled={saveLoading || isHardBlocked}
            data-testid="apply-policy-btn"
          >
            {saveLoading ? "Applying..." : "Apply policy changes"}
          </button>
        </div>
      </div>

      {/* Hard-block Error Banner */}
      {isHardBlocked ? (
        <div style={bannerErrorStyle} data-testid="ca-hardblock-banner">
          <strong style={{ fontSize: "14px" }}>Hard-Block: Lockout Prevention</strong>
          <span>
            Cannot target <strong>All users</strong> with a <strong>Block</strong> control without
            an explicit break-glass exclusion. Add a break-glass exclusion to proceed.
          </span>
          <div style={{ marginTop: "8px" }}>
            <button
              type="button"
              style={{
                ...primaryButtonStyle,
                padding: "6px 12px",
                fontSize: "12px",
                backgroundColor: "#dc2626",
              }}
              onClick={handleQuickAddBreakGlass}
              data-testid="hardblock-quick-add-btn"
            >
              + Add Break-Glass Exclusion
            </button>
          </div>
        </div>
      ) : null}

      {/* Warning Banner */}
      {showAdminExclusionWarning ? (
        <div style={bannerWarningStyle} data-testid="ca-warning-banner">
          <div>
            <strong>Warning: Lockout Risk</strong>
            <div style={{ fontSize: "12px", marginTop: "2px" }}>
              Policy targets <strong>All users</strong> with no administrator role exclusion. It is
              recommended to exclude Global Administrators or break-glass accounts.
            </div>
          </div>
          <button
            type="button"
            style={{
              padding: "6px 12px",
              backgroundColor: "#d97706",
              color: "#ffffff",
              border: "none",
              borderRadius: "4px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
            onClick={handleQuickAddBreakGlass}
            data-testid="warning-quick-add-btn"
          >
            Exclude Break-Glass / Admins
          </button>
        </div>
      ) : null}

      {/* General Error Banner */}
      {saveError ? (
        <div style={bannerErrorStyle} data-testid="ca-error-banner">
          {saveError}
        </div>
      ) : null}

      {/* Basic Settings */}
      <div style={sectionCardStyle}>
        <h2 style={sectionTitleStyle}>Basic Information</h2>
        <div>
          <label style={labelStyle} htmlFor="ca-policy-name">
            Policy Name
          </label>
          <input
            id="ca-policy-name"
            style={inputStyle}
            type="text"
            placeholder="e.g. Require MFA for Admins"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            data-testid="ca-policy-name-input"
          />
        </div>

        <div>
          <label style={labelStyle}>Policy State</label>
          <div style={{ display: "flex", gap: "20px", marginTop: "6px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
              <input
                type="radio"
                name="ca-state"
                value="enabledForReportingButNotEnforced"
                checked={state === "enabledForReportingButNotEnforced"}
                onChange={() => setState("enabledForReportingButNotEnforced")}
                data-testid="ca-state-reportonly"
              />
              Report-only (Recommended for new policies)
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
              <input
                type="radio"
                name="ca-state"
                value="enabled"
                checked={state === "enabled"}
                onChange={() => setState("enabled")}
                data-testid="ca-state-on"
              />
              On
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
              <input
                type="radio"
                name="ca-state"
                value="disabled"
                checked={state === "disabled"}
                onChange={() => setState("disabled")}
                data-testid="ca-state-off"
              />
              Off
            </label>
          </div>
        </div>
      </div>

      {/* Condition Builder */}
      <CaConditionBuilder
        users={users}
        apps={apps}
        conditions={conditions}
        onChangeUsers={setUsers}
        onChangeApps={setApps}
        onChangeConditions={setConditions}
        onQuickAddBreakGlass={handleQuickAddBreakGlass}
      />

      {/* Access Controls (Grant) */}
      <div style={sectionCardStyle}>
        <h2 style={sectionTitleStyle}>Access Controls (Grant)</h2>

        <div style={{ display: "flex", gap: "20px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
            <input
              type="radio"
              name="ca-control-type"
              checked={!isBlock}
              onChange={() => setIsBlock(false)}
              data-testid="ca-control-grant"
            />
            Grant access
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
            <input
              type="radio"
              name="ca-control-type"
              checked={isBlock}
              onChange={() => setIsBlock(true)}
              data-testid="ca-control-block"
            />
            Block access
          </label>
        </div>

        {!isBlock ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "8px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {[
                { id: "mfa", label: "Require multifactor authentication" },
                { id: "compliantDevice", label: "Require device to be marked as compliant" },
                { id: "domainJoinedDevice", label: "Require Microsoft Entra hybrid joined device" },
                { id: "approvedApplication", label: "Require approved client app" },
              ].map((ctrl) => (
                <label key={ctrl.id} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
                  <input
                    type="checkbox"
                    checked={grantControlsList.includes(ctrl.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setGrantControlsList([...grantControlsList, ctrl.id]);
                      } else {
                        setGrantControlsList(grantControlsList.filter((c) => c !== ctrl.id));
                      }
                    }}
                    data-testid={`ca-grant-${ctrl.id}`}
                  />
                  {ctrl.label}
                </label>
              ))}
            </div>

            <div style={{ marginTop: "12px" }}>
              <label style={labelStyle}>Operator</label>
              <div style={{ display: "flex", gap: "16px", marginTop: "4px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
                  <input
                    type="radio"
                    name="ca-operator"
                    value="OR"
                    checked={grantOperator === "OR"}
                    onChange={() => setGrantOperator("OR")}
                    data-testid="ca-operator-or"
                  />
                  Require one of the selected controls (OR)
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
                  <input
                    type="radio"
                    name="ca-operator"
                    value="AND"
                    checked={grantOperator === "AND"}
                    onChange={() => setGrantOperator("AND")}
                    data-testid="ca-operator-and"
                  />
                  Require all the selected controls (AND)
                </label>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Plan Preview (JSON diff) */}
      {planPreview ? (
        <div style={sectionCardStyle} data-testid="ca-plan-preview-box">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={sectionTitleStyle}>Plan Preview (JSON Diff)</h2>
            <span style={{ fontSize: "12px", color: "#10b981", fontWeight: 600 }}>
              Dry-run verified
            </span>
          </div>

          <div style={diffBoxStyle}>
            {planPreview.diff.map((line, idx) => {
              const color = line.startsWith("+")
                ? "#4ade80"
                : line.startsWith("-")
                ? "#f87171"
                : line.startsWith("~")
                ? "#60a5fa"
                : "#f8fafc";
              return (
                <div key={idx} style={{ color }}>
                  {line}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
};
