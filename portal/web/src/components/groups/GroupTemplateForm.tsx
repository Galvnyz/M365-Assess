"use client";

// GroupTemplateForm — Create / edit form with template-driven naming policy and conflict handling
// (EPIC-014 SPEC.md §3.2, §11.2; T-0267).
import React, { useState, type CSSProperties } from "react";
import type { GroupTemplate, GroupType } from "../../lib/groupsApi";

export interface GroupTemplateFormProps {
  readonly initialTemplate?: GroupTemplate | null;
  readonly onSave: (templateData: Partial<GroupTemplate>) => Promise<void> | void;
  readonly onCancel: () => void;
}

const formContainerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "18px",
  maxWidth: "600px",
  width: "100%",
  background: "var(--bg-elev, #ffffff)",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "var(--radius, 10px)",
  padding: "24px",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text, #111827)",
};

const sectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  padding: "16px",
  background: "var(--surface, #f9fafb)",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "8px",
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

export function GroupTemplateForm({
  initialTemplate,
  onSave,
  onCancel,
}: GroupTemplateFormProps): React.ReactElement {
  const [name, setName] = useState(initialTemplate?.name ?? "");
  const [groupType, setGroupType] = useState<GroupType>(initialTemplate?.groupType ?? "security");

  // Naming Policy
  const [prefix, setPrefix] = useState(initialTemplate?.naming?.prefix ?? "");
  const [suffix, setSuffix] = useState(initialTemplate?.naming?.suffix ?? "");
  const [pattern, setPattern] = useState(initialTemplate?.naming?.pattern ?? "");
  const [conflictBehavior, setConflictBehavior] = useState<"block" | "appendSuffix">(
    initialTemplate?.naming?.conflictBehavior ?? "block",
  );

  // Members & Owners & Licensing (comma separated for simple entry)
  const [ownersStr, setOwnersStr] = useState((initialTemplate?.owners ?? []).join(", "));
  const [membersStr, setMembersStr] = useState((initialTemplate?.members ?? []).join(", "));
  const [licensingStr, setLicensingStr] = useState((initialTemplate?.licensing ?? []).join(", "));

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Template name is required");
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const owners = ownersStr.split(",").map((s) => s.trim()).filter(Boolean);
      const members = membersStr.split(",").map((s) => s.trim()).filter(Boolean);
      const licensing = licensingStr.split(",").map((s) => s.trim()).filter(Boolean);

      const payload: Partial<GroupTemplate> = {
        name: name.trim(),
        groupType,
        naming: {
          prefix: prefix.trim() || undefined,
          suffix: suffix.trim() || undefined,
          pattern: pattern.trim() || undefined,
          conflictBehavior,
        },
        owners,
        members,
        licensing,
      };

      await onSave(payload);
    } catch (err: any) {
      setError(err.message || "Failed to save template");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form style={formContainerStyle} onSubmit={handleSubmit} data-testid="group-template-form">
      <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>
        {initialTemplate ? `Edit Template: ${initialTemplate.name}` : "Create Group Template"}
      </h3>

      {error && (
        <div style={{ color: "var(--danger, #dc2626)", fontSize: "14px" }} data-testid="template-form-error">
          {error}
        </div>
      )}

      <div style={fieldStyle}>
        <label style={labelStyle} htmlFor="template-name-input">Template Name *</label>
        <input
          id="template-name-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Standard Department Team"
          required
          style={inputStyle}
          data-testid="input-template-name"
        />
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle} htmlFor="template-type-select">Group Type</label>
        <select
          id="template-type-select"
          value={groupType}
          onChange={(e) => setGroupType(e.target.value as GroupType)}
          style={inputStyle}
          data-testid="input-template-group-type"
        >
          <option value="security">Security</option>
          <option value="m365">Microsoft 365</option>
          <option value="distribution">Distribution</option>
          <option value="dynamic">Dynamic</option>
        </select>
      </div>

      {/* Naming Policy Section */}
      <div style={sectionStyle} data-testid="naming-policy-section">
        <div style={{ fontWeight: 600, fontSize: "14px" }}>Naming Policy &amp; Conflict Handling</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          <div style={fieldStyle}>
            <label style={labelStyle} htmlFor="naming-prefix-input">Prefix</label>
            <input
              id="naming-prefix-input"
              type="text"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="e.g. GRP-"
              style={inputStyle}
              data-testid="input-naming-prefix"
            />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle} htmlFor="naming-suffix-input">Suffix</label>
            <input
              id="naming-suffix-input"
              type="text"
              value={suffix}
              onChange={(e) => setSuffix(e.target.value)}
              placeholder="e.g. -Team"
              style={inputStyle}
              data-testid="input-naming-suffix"
            />
          </div>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="naming-pattern-input">Token Pattern (optional)</label>
          <input
            id="naming-pattern-input"
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="{prefix}{name}-{department}{suffix}"
            style={inputStyle}
            data-testid="input-naming-pattern"
          />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="naming-conflict-select">Conflict Behavior</label>
          <select
            id="naming-conflict-select"
            value={conflictBehavior}
            onChange={(e) => setConflictBehavior(e.target.value as any)}
            style={inputStyle}
            data-testid="input-naming-conflict"
          >
            <option value="block">Block deployment on conflict</option>
            <option value="appendSuffix">Append suffix on conflict</option>
          </select>
        </div>
      </div>

      {/* Owners, Members, Licensing */}
      <div style={fieldStyle}>
        <label style={labelStyle} htmlFor="template-owners-input">Initial Owners (comma-separated UPNs or IDs)</label>
        <input
          id="template-owners-input"
          type="text"
          value={ownersStr}
          onChange={(e) => setOwnersStr(e.target.value)}
          placeholder="admin@contoso.com, lead@contoso.com"
          style={inputStyle}
          data-testid="input-template-owners"
        />
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle} htmlFor="template-members-input">Initial Members (comma-separated UPNs or IDs)</label>
        <input
          id="template-members-input"
          type="text"
          value={membersStr}
          onChange={(e) => setMembersStr(e.target.value)}
          placeholder="member1@contoso.com, member2@contoso.com"
          style={inputStyle}
          data-testid="input-template-members"
        />
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle} htmlFor="template-licensing-input">Licensing SKUs (comma-separated)</label>
        <input
          id="template-licensing-input"
          type="text"
          value={licensingStr}
          onChange={(e) => setLicensingStr(e.target.value)}
          placeholder="SPE_E5, EMS"
          style={inputStyle}
          data-testid="input-template-licensing"
        />
      </div>

      <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "10px" }}>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel} data-testid="btn-cancel-template">
          Cancel
        </button>
        <button type="submit" style={primaryButtonStyle} disabled={saving} data-testid="btn-save-template">
          {saving ? "Saving..." : "Save Template"}
        </button>
      </div>
    </form>
  );
}
