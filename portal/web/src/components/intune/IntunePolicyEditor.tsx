"use client";

// IntunePolicyEditor — create/edit an Intune policy (EPIC-016 SPEC.md §4.1, §11.2; T-0304).
// Flow: settings editor → plan preview (settings diff + assignment changes) → apply.
// Structured controls for types with a schema (SettingsEditor), validated raw JSON for the
// rest (JsonSettingsEditor). Both submit through the T-0302 plan-preview route.
import React, { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  getIntunePolicy,
  INTUNE_POLICY_TYPES,
  saveIntunePolicy,
  type IntunePlan,
  type IntunePolicyAssignment,
  type IntunePolicyKind,
  type IntunePolicySaveInput,
} from "../../lib/intuneApi";
import { SettingsEditor, settingsSchemaFor, validateStructuredSettings } from "./SettingsEditor";
import { JsonSettingsEditor, validatePolicyJson } from "./JsonSettingsEditor";

export interface IntunePolicyEditorProps {
  readonly kind: IntunePolicyKind;
  readonly tenantId: string;
  /** Existing policy id to edit; null to create. */
  readonly policyId: string | null;
  /** When creating, prefill from this policy (the list page's Clone action). */
  readonly cloneFromId?: string | null;
  /** "assignments" scrolls to and focuses the assignments section (the Assign action). */
  readonly focusSection?: string | null;
  /** Called after a successful apply, or on cancel. */
  readonly onDone: () => void;
}

type Mode = "structured" | "json";

const TARGET_TYPES: readonly { readonly value: string; readonly label: string }[] = [
  { value: "groupAssignmentTarget", label: "Group" },
  { value: "allDevicesAssignmentTarget", label: "All devices" },
  { value: "allLicensedUsersAssignmentTarget", label: "All users" },
];

const KIND_LABELS: Record<IntunePolicyKind, string> = {
  configuration: "configuration policy",
  compliance: "compliance policy",
  "app-protection": "app protection policy",
};

const sectionStyle: CSSProperties = {
  padding: "16px",
  background: "var(--bg, #ffffff)",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "8px",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};

const sectionTitleStyle: CSSProperties = { margin: 0, fontSize: "14px", fontWeight: 700 };

const inputStyle: CSSProperties = {
  padding: "6px 10px",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "6px",
  fontSize: "13px",
  background: "var(--bg, #ffffff)",
  color: "var(--text, #111827)",
};

const buttonStyle: CSSProperties = {
  padding: "6px 12px",
  fontSize: "13px",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "6px",
  background: "var(--bg, #ffffff)",
  cursor: "pointer",
  color: "var(--text, #111827)",
};

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "var(--accent, #2563eb)",
  border: "none",
  color: "#ffffff",
  fontWeight: 600,
};

const alertStyle: CSSProperties = {
  padding: "12px 16px",
  background: "#fef2f2",
  border: "1px solid #fca5a5",
  borderRadius: "8px",
  color: "#b91c1c",
};

function assignmentLabel(a: IntunePolicyAssignment): string {
  if (a.targetType === "allDevicesAssignmentTarget") return "All devices";
  if (a.targetType === "allLicensedUsersAssignmentTarget") return "All users";
  return a.target;
}

export function IntunePolicyEditor({
  kind,
  tenantId,
  policyId,
  cloneFromId,
  focusSection,
  onDone,
}: IntunePolicyEditorProps) {
  const sourceId = policyId ?? cloneFromId ?? null;
  const [loading, setLoading] = useState(sourceId !== null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [platform, setPlatform] = useState("windows");
  const [mode, setMode] = useState<Mode>("structured");
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [jsonText, setJsonText] = useState("{}");
  const [assignments, setAssignments] = useState<readonly IntunePolicyAssignment[]>([]);
  const [newTargetType, setNewTargetType] = useState("groupAssignmentTarget");
  const [newGroup, setNewGroup] = useState("");

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [plan, setPlan] = useState<IntunePlan | null>(null);
  const [busy, setBusy] = useState(false);

  const assignmentsRef = useRef<HTMLElement>(null);
  const groupInputRef = useRef<HTMLInputElement>(null);

  const schema = settingsSchemaFor(kind, platform);
  const effectiveMode: Mode = schema ? mode : "json";
  const platformOptions = INTUNE_POLICY_TYPES.filter((t) => t.kind === kind);

  useEffect(() => {
    if (sourceId === null) return;
    let cancelled = false;
    getIntunePolicy(tenantId, kind, sourceId)
      .then((policy) => {
        if (cancelled) return;
        if (!policy) {
          setLoadError(`Policy '${sourceId}' was not found.`);
          return;
        }
        const name = policy.displayName || policy.name;
        const loaded = { ...(policy.settingsSummary ?? {}) };
        setDisplayName(policyId ? name : `Copy of ${name}`);
        setPlatform(policy.platform.toLowerCase() || "windows");
        setSettings(loaded);
        setJsonText(JSON.stringify(loaded, null, 2));
        setAssignments(policyId ? policy.assignments : []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load policy.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, kind, sourceId, policyId]);

  useEffect(() => {
    if (loading || focusSection !== "assignments") return;
    assignmentsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    groupInputRef.current?.focus();
  }, [loading, focusSection]);

  function switchMode(next: Mode) {
    if (next === mode) return;
    if (next === "json") {
      setJsonText(JSON.stringify(settings, null, 2));
      setJsonError(null);
      setMode("json");
      return;
    }
    const parsed = validatePolicyJson(jsonText, kind, platform);
    if (!parsed.ok) {
      setJsonError(`Fix the JSON before switching to structured editing. ${parsed.error}`);
      return;
    }
    setSettings(parsed.value);
    setFieldErrors({});
    setMode("structured");
  }

  function addAssignment() {
    if (newTargetType === "groupAssignmentTarget") {
      const group = newGroup.trim();
      if (!group) return;
      if (assignments.some((a) => a.targetType === newTargetType && a.target === group)) return;
      setAssignments([...assignments, { id: group, target: group, targetType: newTargetType }]);
      setNewGroup("");
      return;
    }
    if (assignments.some((a) => a.targetType === newTargetType)) return;
    setAssignments([...assignments, { id: newTargetType, target: newTargetType, targetType: newTargetType }]);
  }

  /** Validate the form; returns the save payload or null when invalid. */
  function buildInput(): IntunePolicySaveInput | null {
    setFormError(null);
    const name = displayName.trim();
    if (!name) {
      setFormError("Policy name is required.");
      return null;
    }
    const base = { displayName: name, platform, assignments };
    if (effectiveMode === "structured" && schema) {
      const errors = validateStructuredSettings(schema, settings);
      setFieldErrors(errors);
      if (Object.keys(errors).length > 0) {
        setFormError("Fix the highlighted settings.");
        return null;
      }
      return { ...base, settings };
    }
    const parsed = validatePolicyJson(jsonText, kind, platform);
    if (!parsed.ok) {
      setJsonError(parsed.error);
      return null;
    }
    setJsonError(null);
    return { ...base, policyJson: jsonText };
  }

  async function preview() {
    const input = buildInput();
    if (!input) return;
    setBusy(true);
    try {
      const result = await saveIntunePolicy(tenantId, kind, policyId, input, true);
      setPlan(result.plan);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to preview changes.");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    const input = buildInput();
    if (!input) return;
    setBusy(true);
    try {
      await saveIntunePolicy(tenantId, kind, policyId, input, false);
      onDone();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to apply changes.");
    } finally {
      setBusy(false);
    }
  }

  const title = `${policyId ? "Edit" : "New"} ${KIND_LABELS[kind]}`;

  if (loading) {
    return <div style={{ padding: "24px", color: "var(--text-muted, #6b7280)" }}>Loading policy…</div>;
  }
  if (loadError) {
    return (
      <div role="alert" style={alertStyle}>
        {loadError}
      </div>
    );
  }

  if (plan) {
    const before = plan.beforeAssignments ?? [];
    const after = plan.afterAssignments ?? assignments;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <h2 style={{ margin: 0, fontSize: "18px" }}>Review changes — {plan.targetName || displayName}</h2>
        {!plan.valid && (
          <div role="alert" style={alertStyle}>
            The plan is not valid and cannot be applied. Go back and adjust the policy.
          </div>
        )}
        {formError && (
          <div role="alert" style={alertStyle}>
            {formError}
          </div>
        )}
        <section style={sectionStyle} aria-label="Settings diff">
          <h3 style={sectionTitleStyle}>Settings diff</h3>
          {plan.diff.length === 0 ? (
            <p style={{ margin: 0, color: "var(--text-muted, #6b7280)" }}>No setting changes.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: "18px", fontFamily: "var(--font-mono, monospace)", fontSize: "12px" }}>
              {plan.diff.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
        </section>
        <section style={sectionStyle} aria-label="Assignment changes">
          <h3 style={sectionTitleStyle}>Assignments</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", fontSize: "13px" }}>
            <div>
              <strong>Before</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: "18px" }}>
                {before.length === 0 ? <li>None</li> : before.map((a) => <li key={a.id}>{assignmentLabel(a)}</li>)}
              </ul>
            </div>
            <div>
              <strong>After</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: "18px" }}>
                {after.length === 0 ? <li>None</li> : after.map((a) => <li key={a.id}>{assignmentLabel(a)}</li>)}
              </ul>
            </div>
          </div>
        </section>
        <div style={{ display: "flex", gap: "8px" }}>
          <button style={buttonStyle} onClick={() => setPlan(null)} disabled={busy}>
            Back to edit
          </button>
          <button style={primaryButtonStyle} onClick={() => void apply()} disabled={busy || !plan.valid}>
            {busy ? "Applying…" : "Apply"}
          </button>
        </div>
      </div>
    );
  }

  const unknownKeys = schema
    ? Object.keys(settings).filter((k) => !schema.some((f) => f.key === k))
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <h2 style={{ margin: 0, fontSize: "18px" }}>{title}</h2>
      {formError && (
        <div role="alert" style={alertStyle}>
          {formError}
        </div>
      )}

      <section style={sectionStyle} aria-label="Basics">
        <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" }}>
          Name
          <input style={inputStyle} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" }}>
          Platform
          <select
            style={inputStyle}
            value={platform}
            disabled={policyId !== null}
            onChange={(e) => {
              setPlatform(e.target.value);
              setFieldErrors({});
            }}
          >
            {platformOptions.map((t) => (
              <option key={t.platform} value={t.platform} disabled={!t.supported}>
                {t.platform}
                {t.supported ? "" : " (not supported in v1)"}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section style={sectionStyle} aria-label="Settings">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={sectionTitleStyle}>Settings</h3>
          {schema ? (
            <div role="group" aria-label="Editor mode" style={{ display: "flex", gap: "4px" }}>
              <button
                style={effectiveMode === "structured" ? primaryButtonStyle : buttonStyle}
                aria-pressed={effectiveMode === "structured"}
                onClick={() => switchMode("structured")}
              >
                Structured
              </button>
              <button
                style={effectiveMode === "json" ? primaryButtonStyle : buttonStyle}
                aria-pressed={effectiveMode === "json"}
                onClick={() => switchMode("json")}
              >
                JSON
              </button>
            </div>
          ) : (
            <span style={{ fontSize: "12px", color: "var(--text-muted, #6b7280)" }}>
              No structured editor for this type — edit the JSON directly.
            </span>
          )}
        </div>
        {effectiveMode === "structured" && schema ? (
          <>
            <SettingsEditor
              schema={schema}
              settings={settings}
              errors={fieldErrors}
              onChange={setSettings}
            />
            {unknownKeys.length > 0 && (
              <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted, #6b7280)" }}>
                {unknownKeys.length} other setting(s) are kept as-is; switch to JSON to edit them.
              </p>
            )}
          </>
        ) : (
          <JsonSettingsEditor
            value={jsonText}
            error={jsonError}
            onChange={(text) => {
              setJsonText(text);
              setJsonError(null);
            }}
          />
        )}
      </section>

      <section ref={assignmentsRef} style={sectionStyle} aria-label="Assignments">
        <h3 style={sectionTitleStyle}>Assignments</h3>
        {assignments.length === 0 ? (
          <p style={{ margin: 0, fontSize: "13px", color: "var(--text-muted, #6b7280)" }}>Not assigned.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" }}>
            {assignments.map((a) => (
              <li key={`${a.targetType}:${a.id}`} style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "13px" }}>
                <span>{assignmentLabel(a)}</span>
                <button
                  style={buttonStyle}
                  aria-label={`Remove ${assignmentLabel(a)}`}
                  onClick={() => setAssignments(assignments.filter((x) => x !== a))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <select
            style={inputStyle}
            value={newTargetType}
            onChange={(e) => setNewTargetType(e.target.value)}
            aria-label="Assignment target type"
          >
            {TARGET_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {newTargetType === "groupAssignmentTarget" && (
            <input
              ref={groupInputRef}
              style={inputStyle}
              placeholder="Group name or ID"
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              aria-label="Group to assign"
            />
          )}
          <button style={buttonStyle} onClick={addAssignment}>
            Add assignment
          </button>
        </div>
      </section>

      <div style={{ display: "flex", gap: "8px" }}>
        <button style={buttonStyle} onClick={onDone} disabled={busy}>
          Cancel
        </button>
        <button style={primaryButtonStyle} onClick={() => void preview()} disabled={busy}>
          {busy ? "Preparing plan…" : "Preview changes"}
        </button>
      </div>
    </div>
  );
}
