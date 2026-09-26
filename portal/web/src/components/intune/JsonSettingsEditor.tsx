"use client";

// JsonSettingsEditor — validated raw JSON editor for advanced Intune policy types
// (EPIC-016 SPEC.md §11.2; T-0304). Validation mirrors the T-0301 registry: the
// document must be a JSON object, and any @odata.type must match the registry
// type for the policy's kind/platform.
import React, { type CSSProperties } from "react";
import { policyTypeInfo } from "../../lib/intuneApi";

export type JsonValidation =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly error: string };

export function validatePolicyJson(text: string, kind: string, platform: string): JsonValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err: unknown) {
    return { ok: false, error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Policy JSON must be an object." };
  }
  const value = parsed as Record<string, unknown>;
  const odataType = value["@odata.type"];
  if (odataType !== undefined) {
    const expected = policyTypeInfo(kind, platform)?.odataType;
    if (typeof odataType !== "string" || (expected !== undefined && odataType !== expected)) {
      return {
        ok: false,
        error: `@odata.type must be ${expected ?? "a string"} for ${kind} policies on ${platform}.`,
      };
    }
  }
  return { ok: true, value };
}

export interface JsonSettingsEditorProps {
  readonly value: string;
  readonly error?: string | null;
  readonly onChange: (text: string) => void;
}

const textareaStyle: CSSProperties = {
  width: "100%",
  minHeight: "320px",
  boxSizing: "border-box",
  padding: "12px",
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: "12px",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "6px",
  background: "var(--bg-elev, #f9fafb)",
  color: "var(--text, #111827)",
};

export function JsonSettingsEditor({ value, error, onChange }: JsonSettingsEditorProps) {
  return (
    <div>
      <textarea
        style={{ ...textareaStyle, borderColor: error ? "var(--danger, #dc2626)" : undefined }}
        value={value}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Policy JSON"
        aria-invalid={error ? true : undefined}
      />
      {error && (
        <div role="alert" style={{ marginTop: "6px", fontSize: "12px", color: "var(--danger, #dc2626)" }}>
          {error}
        </div>
      )}
    </div>
  );
}
