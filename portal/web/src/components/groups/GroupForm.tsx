"use client";

// GroupForm — Group create and edit form with plan preview and raw dynamic-rule editor (EPIC-014 SPEC.md §4.1, §11.4; T-0264).
import React, { useState, type CSSProperties } from "react";
import {
  createGroup,
  editGroup,
  type GroupItem,
  type GroupPlan,
  type GroupType,
} from "../../lib/groupsApi";
import { DynamicRuleEditor } from "./DynamicRuleEditor";

export interface GroupFormProps {
  readonly tenantId: string;
  readonly mode?: "create" | "edit";
  readonly initialGroup?: GroupItem;
  readonly onSuccess?: (result: any) => void;
  readonly onCancel?: () => void;
}

const formContainerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "20px",
  maxWidth: "680px",
  width: "100%",
  background: "var(--bg-elev, #ffffff)",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "var(--radius, 10px)",
  padding: "24px",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text, #111827)",
};

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
};

const labelStyle: CSSProperties = {
  fontSize: "14px",
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

const checkboxRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  cursor: "pointer",
};

const planBoxStyle: CSSProperties = {
  background: "var(--surface, #f9fafb)",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "6px",
  padding: "16px",
  display: "flex",
  flexDirection: "column",
  gap: "10px",
};

const primaryButtonStyle: CSSProperties = {
  padding: "10px 16px",
  background: "var(--primary, #2563eb)",
  color: "var(--primary-contrast, #ffffff)",
  border: "none",
  borderRadius: "6px",
  fontWeight: 600,
  fontSize: "14px",
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  padding: "10px 16px",
  background: "var(--surface, #f3f4f6)",
  border: "1px solid var(--border, #d1d5db)",
  borderRadius: "6px",
  fontWeight: 500,
  fontSize: "14px",
  cursor: "pointer",
  color: "var(--text, #111827)",
};

export function GroupForm({
  tenantId,
  mode = "create",
  initialGroup,
  onSuccess,
  onCancel,
}: GroupFormProps): React.ReactElement {
  const [displayName, setDisplayName] = useState(initialGroup?.displayName ?? initialGroup?.name ?? "");
  const [description, setDescription] = useState(initialGroup?.description ?? "");
  const [groupType, setGroupType] = useState<GroupType>(initialGroup?.type ?? "security");
  const [mailNickname, setMailNickname] = useState(initialGroup?.mail ? initialGroup.mail.split("@")[0] : "");
  const [dynamicRule, setDynamicRule] = useState(initialGroup?.dynamicRule ?? "");
  const [isRuleValid, setIsRuleValid] = useState(true);
  const [hiddenFromGal, setHiddenFromGal] = useState(initialGroup?.hiddenFromAddressListsEnabled ?? false);
  const [deliveryMgmt, setDeliveryMgmt] = useState(initialGroup?.deliveryManagementEnabled ?? false);

  const [plan, setPlan] = useState<GroupPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePreview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setError("Name is required");
      return;
    }
    if ((groupType === "dynamic" || dynamicRule) && !isRuleValid) {
      setError("Please fix dynamic rule errors before generating plan preview");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      if (mode === "create") {
        const res = await createGroup(tenantId, {
          displayName,
          description,
          groupType,
          mailNickname: mailNickname || undefined,
          dynamicRule: groupType === "dynamic" ? dynamicRule : undefined,
          preview: true,
        });
        setPlan((res as any).plan ?? res);
      } else if (initialGroup) {
        const res = await editGroup(tenantId, initialGroup.id, {
          displayName,
          description,
          dynamicRule: dynamicRule || undefined,
          preview: true,
        });
        setPlan((res as any).plan ?? res);
      }
    } catch (err: any) {
      setError(err.message || "Failed to generate preview");
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    try {
      setLoading(true);
      setError(null);

      let res: any;
      if (mode === "create") {
        res = await createGroup(tenantId, {
          displayName,
          description,
          groupType,
          mailNickname: mailNickname || undefined,
          dynamicRule: groupType === "dynamic" ? dynamicRule : undefined,
          preview: false,
        });
      } else if (initialGroup) {
        res = await editGroup(tenantId, initialGroup.id, {
          displayName,
          description,
          dynamicRule: dynamicRule || undefined,
          preview: false,
        });
      }
      onSuccess?.(res);
    } catch (err: any) {
      setError(err.message || "Failed to apply changes");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form style={formContainerStyle} onSubmit={handlePreview} data-testid="group-form">
      <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>
        {mode === "create" ? "Create New Group" : `Edit Group: ${initialGroup?.name}`}
      </h2>

      {error && (
        <div style={{ color: "var(--danger, #dc2626)", fontSize: "14px" }} data-testid="form-error">
          {error}
        </div>
      )}

      {/* Group Type */}
      <div style={fieldStyle}>
        <label style={labelStyle} htmlFor="group-type-select">Group Type</label>
        <select
          id="group-type-select"
          value={groupType}
          onChange={(e) => setGroupType(e.target.value as GroupType)}
          disabled={mode === "edit"}
          style={inputStyle}
          data-testid="input-group-type"
        >
          <option value="security">Security</option>
          <option value="m365">Microsoft 365</option>
          <option value="distribution">Distribution</option>
          <option value="dynamic">Dynamic Security</option>
        </select>
      </div>

      {/* Name */}
      <div style={fieldStyle}>
        <label style={labelStyle} htmlFor="group-name-input">Group Name *</label>
        <input
          id="group-name-input"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g. Finance Team"
          required
          style={inputStyle}
          data-testid="input-group-name"
        />
      </div>

      {/* Description */}
      <div style={fieldStyle}>
        <label style={labelStyle} htmlFor="group-desc-input">Description</label>
        <textarea
          id="group-desc-input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Group purpose or scope..."
          rows={3}
          style={{ ...inputStyle, resize: "vertical" }}
          data-testid="input-group-description"
        />
      </div>

      {/* Mail Nickname (if applicable) */}
      {(groupType === "m365" || groupType === "distribution") && mode === "create" && (
        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="group-mail-nickname">Mail Nickname</label>
          <input
            id="group-mail-nickname"
            type="text"
            value={mailNickname}
            onChange={(e) => setMailNickname(e.target.value)}
            placeholder="e.g. financeteam"
            style={inputStyle}
            data-testid="input-group-nickname"
          />
        </div>
      )}

      {/* Dynamic Rule Editor */}
      {(groupType === "dynamic" || Boolean(dynamicRule)) && (
        <DynamicRuleEditor
          value={dynamicRule}
          onChange={(rule, valid) => {
            setDynamicRule(rule);
            setIsRuleValid(valid);
          }}
        />
      )}

      {/* GAL and Delivery Settings */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "4px" }}>
        <label style={checkboxRowStyle}>
          <input
            type="checkbox"
            checked={hiddenFromGal}
            onChange={(e) => setHiddenFromGal(e.target.checked)}
            data-testid="input-hidden-gal"
          />
          <span style={{ fontSize: "14px" }}>Hide group from Global Address List (GAL)</span>
        </label>

        <label style={checkboxRowStyle}>
          <input
            type="checkbox"
            checked={deliveryMgmt}
            onChange={(e) => setDeliveryMgmt(e.target.checked)}
            data-testid="input-delivery-mgmt"
          />
          <span style={{ fontSize: "14px" }}>Enable delivery management (restrict external senders)</span>
        </label>
      </div>

      {/* Plan Preview Section */}
      {plan && (
        <div style={planBoxStyle} data-testid="plan-diff-preview">
          <div style={{ fontWeight: 600, fontSize: "14px" }}>Plan Preview &amp; Diff:</div>
          <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "13px" }}>
            {plan.diff.map((item, idx) => (
              <li key={idx} data-testid={`diff-item-${idx}`}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Buttons */}
      <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end", marginTop: "12px" }}>
        {onCancel && (
          <button type="button" style={secondaryButtonStyle} onClick={onCancel} data-testid="btn-cancel">
            Cancel
          </button>
        )}

        {!plan ? (
          <button
            type="submit"
            style={primaryButtonStyle}
            disabled={loading}
            data-testid="btn-preview-plan"
          >
            {loading ? "Generating Preview..." : "Preview Changes"}
          </button>
        ) : (
          <button
            type="button"
            style={{ ...primaryButtonStyle, background: "var(--success, #16a34a)" }}
            onClick={handleApply}
            disabled={loading}
            data-testid="btn-confirm-apply"
          >
            {loading ? "Applying..." : "Confirm & Apply"}
          </button>
        )}
      </div>
    </form>
  );
}
