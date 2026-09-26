"use client";

// SettingsEditor — structured controls for common Intune policy types (EPIC-016 SPEC.md §4.1,
// §11.2; T-0304). Types without a schema here are edited in JsonSettingsEditor instead.
// Keys a schema does not know are left untouched in the settings object, so structured
// editing never drops settings it cannot render.
import React, { type CSSProperties } from "react";

export type SettingFieldType = "boolean" | "number" | "select" | "text";

export interface SettingField {
  readonly key: string;
  readonly label: string;
  readonly type: SettingFieldType;
  readonly min?: number;
  readonly max?: number;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  /** Regex a text value must match. */
  readonly pattern?: string;
  readonly patternHint?: string;
}

// Windows compliance: windows10CompliancePolicy properties.
const WINDOWS_COMPLIANCE: readonly SettingField[] = [
  { key: "passwordRequired", label: "Require a password", type: "boolean" },
  { key: "passwordMinimumLength", label: "Minimum password length", type: "number", min: 4, max: 16 },
  {
    key: "passwordRequiredType",
    label: "Password type",
    type: "select",
    options: [
      { value: "deviceDefault", label: "Device default" },
      { value: "alphanumeric", label: "Alphanumeric" },
      { value: "numeric", label: "Numeric" },
    ],
  },
  { key: "passwordExpirationDays", label: "Password expiration (days)", type: "number", min: 1, max: 730 },
  {
    key: "osMinimumVersion",
    label: "Minimum OS version",
    type: "text",
    pattern: "^\\d+(\\.\\d+){1,3}$",
    patternHint: "a version such as 10.0.19045",
  },
  { key: "bitLockerEnabled", label: "Require BitLocker", type: "boolean" },
  { key: "secureBootEnabled", label: "Require Secure Boot", type: "boolean" },
  { key: "codeIntegrityEnabled", label: "Require code integrity", type: "boolean" },
  { key: "storageRequireEncryption", label: "Require storage encryption", type: "boolean" },
  { key: "activeFirewallRequired", label: "Require an active firewall", type: "boolean" },
  { key: "defenderEnabled", label: "Require Microsoft Defender Antimalware", type: "boolean" },
];

// Windows configuration: common settings-catalog definitions, keyed by settingDefinitionId.
const WINDOWS_CONFIGURATION: readonly SettingField[] = [
  {
    key: "device_vendor_msft_policy_config_defender_allowrealtimemonitoring",
    label: "Defender real-time monitoring",
    type: "boolean",
  },
  {
    key: "device_vendor_msft_policy_config_defender_allowcloudprotection",
    label: "Defender cloud protection",
    type: "boolean",
  },
  {
    key: "device_vendor_msft_policy_config_devicelock_mindevicepasswordlength",
    label: "Minimum device password length",
    type: "number",
    min: 4,
    max: 16,
  },
  {
    key: "device_vendor_msft_policy_config_devicelock_maxinactivitytimedevicelock",
    label: "Lock after inactivity (minutes)",
    type: "number",
    min: 1,
    max: 999,
  },
  {
    key: "device_vendor_msft_bitlocker_requiredeviceencryption",
    label: "Require device encryption (BitLocker)",
    type: "boolean",
  },
  {
    key: "device_vendor_msft_policy_config_update_activehoursstart",
    label: "Windows Update active hours start (hour)",
    type: "number",
    min: 0,
    max: 23,
  },
  {
    key: "device_vendor_msft_policy_config_update_activehoursend",
    label: "Windows Update active hours end (hour)",
    type: "number",
    min: 0,
    max: 23,
  },
];

const SCHEMAS: Record<string, readonly SettingField[]> = {
  "compliance:windows": WINDOWS_COMPLIANCE,
  "configuration:windows": WINDOWS_CONFIGURATION,
};

/** The structured schema for a kind/platform, or undefined when only JSON editing applies. */
export function settingsSchemaFor(kind: string, platform: string): readonly SettingField[] | undefined {
  return SCHEMAS[`${kind}:${platform.toLowerCase()}`];
}

/** Validate structured values against the schema; returns field key → message. */
export function validateStructuredSettings(
  schema: readonly SettingField[],
  settings: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of schema) {
    const value = settings[field.key];
    if (value === undefined || value === "") continue;
    switch (field.type) {
      case "boolean":
        if (typeof value !== "boolean") errors[field.key] = "Must be on or off.";
        break;
      case "number":
        if (typeof value !== "number" || !Number.isInteger(value)) {
          errors[field.key] = "Must be a whole number.";
        } else if (
          (field.min !== undefined && value < field.min) ||
          (field.max !== undefined && value > field.max)
        ) {
          errors[field.key] = `Must be between ${field.min} and ${field.max}.`;
        }
        break;
      case "select":
        if (!field.options?.some((o) => o.value === value)) errors[field.key] = "Choose a listed value.";
        break;
      case "text":
        if (typeof value !== "string") errors[field.key] = "Must be text.";
        else if (field.pattern && !new RegExp(field.pattern).test(value)) {
          errors[field.key] = `Must be ${field.patternHint ?? "in the expected format"}.`;
        }
        break;
    }
  }
  return errors;
}

export interface SettingsEditorProps {
  readonly schema: readonly SettingField[];
  readonly settings: Record<string, unknown>;
  readonly errors?: Record<string, string>;
  readonly onChange: (settings: Record<string, unknown>) => void;
}

const rowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(200px, 1fr) minmax(160px, 1fr)",
  gap: "12px",
  alignItems: "center",
  padding: "8px 0",
  borderBottom: "1px solid var(--border, #e5e7eb)",
};

const inputStyle: CSSProperties = {
  padding: "6px 10px",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "6px",
  fontSize: "13px",
  background: "var(--bg, #ffffff)",
  color: "var(--text, #111827)",
};

const errorStyle: CSSProperties = {
  gridColumn: "2",
  fontSize: "12px",
  color: "var(--danger, #dc2626)",
};

export function SettingsEditor({ schema, settings, errors = {}, onChange }: SettingsEditorProps) {
  function set(key: string, value: unknown) {
    const next = { ...settings };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange(next);
  }

  return (
    <div role="group" aria-label="Policy settings">
      {schema.map((field) => {
        const id = `setting-${field.key}`;
        const value = settings[field.key];
        let control: React.ReactNode;
        switch (field.type) {
          case "boolean":
            control = (
              <select
                id={id}
                style={inputStyle}
                value={value === true ? "true" : value === false ? "false" : ""}
                onChange={(e) =>
                  set(field.key, e.target.value === "" ? undefined : e.target.value === "true")
                }
              >
                <option value="">Not configured</option>
                <option value="true">On</option>
                <option value="false">Off</option>
              </select>
            );
            break;
          case "number":
            control = (
              <input
                id={id}
                style={inputStyle}
                type="number"
                min={field.min}
                max={field.max}
                value={typeof value === "number" ? String(value) : ""}
                onChange={(e) =>
                  set(field.key, e.target.value === "" ? undefined : Number(e.target.value))
                }
              />
            );
            break;
          case "select":
            control = (
              <select
                id={id}
                style={inputStyle}
                value={typeof value === "string" ? value : ""}
                onChange={(e) => set(field.key, e.target.value || undefined)}
              >
                <option value="">Not configured</option>
                {field.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            );
            break;
          case "text":
            control = (
              <input
                id={id}
                style={inputStyle}
                type="text"
                value={typeof value === "string" ? value : ""}
                onChange={(e) => set(field.key, e.target.value || undefined)}
              />
            );
            break;
        }
        return (
          <div key={field.key} style={rowStyle}>
            <label htmlFor={id} style={{ fontSize: "13px" }}>
              {field.label}
            </label>
            {control}
            {errors[field.key] && (
              <span role="alert" style={errorStyle}>
                {errors[field.key]}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
