"use client";

// DynamicRuleEditor — raw membership rule editor with syntax validation (EPIC-014 SPEC.md §4.1, §11.4; T-0264).
import React, { useEffect, useState, type CSSProperties } from "react";
import { validateDynamicRule } from "../../lib/groupsApi";

export interface DynamicRuleEditorProps {
  readonly value: string;
  readonly onChange: (rule: string, isValid: boolean) => void;
  readonly disabled?: boolean;
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  width: "100%",
};

const textareaStyle: CSSProperties = {
  width: "100%",
  minHeight: "80px",
  padding: "10px 12px",
  fontFamily: "monospace",
  fontSize: "13px",
  background: "var(--input-bg, var(--bg))",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  resize: "vertical",
};

const errorStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--danger, #dc2626)",
  fontWeight: 500,
};

const hintStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--text-muted, #6b7280)",
};

export function DynamicRuleEditor({
  value,
  onChange,
  disabled = false,
}: DynamicRuleEditorProps): React.ReactElement {
  const [ruleText, setRuleText] = useState(value);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRuleText(value);
    if (value) {
      const res = validateDynamicRule(value);
      setError(res.valid ? null : (res.error ?? "Invalid rule"));
    } else {
      setError(null);
    }
  }, [value]);

  const handleChange = (newVal: string) => {
    setRuleText(newVal);
    const res = validateDynamicRule(newVal);
    if (!res.valid) {
      setError(res.error ?? "Invalid rule");
      onChange(newVal, false);
    } else {
      setError(null);
      onChange(newVal, true);
    }
  };

  return (
    <div style={containerStyle} data-testid="dynamic-rule-editor">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)" }}>
          Dynamic Membership Rule
        </label>
        <span style={hintStyle}>e.g. (user.department -eq &quot;Sales&quot;)</span>
      </div>

      <textarea
        value={ruleText}
        onChange={(e) => handleChange(e.target.value)}
        disabled={disabled}
        placeholder='(user.department -eq "Sales") -and (user.country -eq "US")'
        style={{
          ...textareaStyle,
          borderColor: error ? "var(--danger, #dc2626)" : "var(--border)",
        }}
        data-testid="dynamic-rule-input"
      />

      {error && (
        <div style={errorStyle} data-testid="dynamic-rule-error">
          {error}
        </div>
      )}

      <div style={hintStyle}>
        Supported operators: <code>-eq</code>, <code>-ne</code>, <code>-contains</code>, <code>-startsWith</code>, <code>-in</code>, <code>-and</code>, <code>-or</code>. Must be wrapped in parentheses.
      </div>
    </div>
  );
}
