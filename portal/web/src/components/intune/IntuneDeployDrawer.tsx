"use client";

// IntuneDeployDrawer — Intune policy template deploy drawer (EPIC-016 SPEC.md §3.2, §4.2, §8; T-0307).
// CIPP CippPolicyDeployDrawer parity: template pick · assignment mode · policy state · overwrite
// switch · create-groups toggle. Targets are tenants and tenant groups (expanded to their
// member tenants); the drawer shows the target count, previews the per-target plan through the
// T-0306 route, and only then allows apply. Any change to the inputs discards the plan.
import React, { useMemo, useState, type CSSProperties } from "react";
import {
  applyIntuneTemplateDeploy,
  previewIntuneTemplateDeploy,
  type DeployTenantGroupOption,
  type DeployTenantOption,
  type IntuneAssignmentMode,
  type IntuneDeployOutcome,
  type IntuneDeployPolicyState,
  type IntuneDeployPreview,
  type IntuneDeployRequest,
  type IntuneTemplate,
} from "../../lib/intuneApi";

export interface IntuneDeployDrawerProps {
  readonly templates: readonly IntuneTemplate[];
  readonly initialTemplateId?: string | null;
  readonly tenants: readonly DeployTenantOption[];
  readonly tenantGroups?: readonly DeployTenantGroupOption[];
  readonly onClose: () => void;
  /** Called after an apply completes (with any outcome). */
  readonly onDeployed?: (outcome: IntuneDeployOutcome) => void;
}

const ASSIGNMENT_MODES: readonly { readonly value: IntuneAssignmentMode; readonly label: string }[] = [
  { value: "template", label: "Use the template's assignments" },
  { value: "none", label: "Do not assign" },
  { value: "allDevices", label: "All devices" },
  { value: "allUsers", label: "All users" },
  { value: "allUsersAndDevices", label: "All users and all devices" },
  { value: "groups", label: "Specific groups" },
];

/** Union of the selected tenants and the members of the selected tenant groups, in stable order. */
export function resolveDeployTargets(
  tenantIds: readonly string[],
  groupIds: readonly string[],
  groups: readonly DeployTenantGroupOption[],
): string[] {
  const out = new Set(tenantIds);
  for (const g of groups) {
    if (groupIds.includes(g.id)) g.memberTenantIds.forEach((t) => out.add(t));
  }
  return [...out];
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  zIndex: 200,
  display: "flex",
  justifyContent: "flex-end",
};

const drawerStyle: CSSProperties = {
  width: "560px",
  maxWidth: "100vw",
  height: "100%",
  background: "var(--bg, #ffffff)",
  color: "var(--text, #111827)",
  boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
  display: "flex",
  flexDirection: "column",
};

const bodyStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "20px 24px",
  display: "flex",
  flexDirection: "column",
  gap: "16px",
};

const fieldStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" };

const inputStyle: CSSProperties = {
  padding: "6px 10px",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "6px",
  fontSize: "13px",
  background: "var(--bg, #ffffff)",
  color: "var(--text, #111827)",
};

const listBoxStyle: CSSProperties = {
  maxHeight: "140px",
  overflowY: "auto",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "6px",
  padding: "6px 10px",
  display: "flex",
  flexDirection: "column",
  gap: "4px",
};

const buttonStyle: CSSProperties = {
  padding: "8px 14px",
  fontSize: "13px",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "6px",
  background: "var(--bg, #ffffff)",
  color: "var(--text, #111827)",
  cursor: "pointer",
};

const primaryStyle: CSSProperties = {
  ...buttonStyle,
  background: "var(--accent, #2563eb)",
  color: "#ffffff",
  border: "none",
  fontWeight: 600,
};

const alertStyle: CSSProperties = {
  padding: "10px 14px",
  background: "#fef2f2",
  border: "1px solid #fca5a5",
  borderRadius: "8px",
  color: "#b91c1c",
  fontSize: "13px",
};

const STATE_COLORS: Record<string, string> = {
  succeeded: "var(--success, #15803d)",
  partial: "var(--warning, #b45309)",
  failed: "var(--danger, #dc2626)",
};

export function IntuneDeployDrawer({
  templates,
  initialTemplateId,
  tenants,
  tenantGroups = [],
  onClose,
  onDeployed,
}: IntuneDeployDrawerProps) {
  const [templateId, setTemplateId] = useState(initialTemplateId ?? templates[0]?.id ?? "");
  const [tenantIds, setTenantIds] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [policyName, setPolicyName] = useState("");
  const [assignmentMode, setAssignmentMode] = useState<IntuneAssignmentMode>("template");
  const [assignGroups, setAssignGroups] = useState("");
  const [policyState, setPolicyState] = useState<IntuneDeployPolicyState>("enabled");
  const [overwrite, setOverwrite] = useState(false);
  const [createGroups, setCreateGroups] = useState(false);

  const [preview, setPreview] = useState<IntuneDeployPreview | null>(null);
  const [outcome, setOutcome] = useState<IntuneDeployOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targets = useMemo(
    () => resolveDeployTargets(tenantIds, groupIds, tenantGroups),
    [tenantIds, groupIds, tenantGroups],
  );
  const groupList = assignGroups.split(",").map((g) => g.trim()).filter(Boolean);
  const tenantName = (id: string) => tenants.find((t) => t.id === id)?.displayName ?? id;

  // Every input change invalidates the plan: apply must match what was previewed.
  function edit<T>(setter: (v: T) => void) {
    return (value: T) => {
      setter(value);
      setPreview(null);
      setOutcome(null);
      setError(null);
    };
  }

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  function buildRequest(): IntuneDeployRequest | null {
    if (!templateId) {
      setError("Choose a template.");
      return null;
    }
    if (targets.length === 0) {
      setError("Choose at least one target tenant or tenant group.");
      return null;
    }
    if (assignmentMode === "groups" && groupList.length === 0) {
      setError("Enter at least one group to assign.");
      return null;
    }
    return {
      targets,
      ...(policyName.trim() ? { policyName: policyName.trim() } : {}),
      assignmentMode,
      groups: assignmentMode === "groups" ? groupList : [],
      policyState,
      overwrite,
      createGroups: assignmentMode === "groups" && createGroups,
    };
  }

  async function runPreview() {
    setError(null);
    const request = buildRequest();
    if (!request) return;
    setBusy(true);
    try {
      setPreview(await previewIntuneTemplateDeploy(templateId, request));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to preview deploy.");
    } finally {
      setBusy(false);
    }
  }

  async function runApply() {
    const request = buildRequest();
    if (!request || !preview) return;
    setBusy(true);
    try {
      const result = await applyIntuneTemplateDeploy(templateId, request);
      setOutcome(result);
      onDeployed?.(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to deploy template.");
    } finally {
      setBusy(false);
    }
  }

  const assignmentCount =
    policyState === "disabled" || assignmentMode === "none"
      ? 0
      : assignmentMode === "groups"
        ? groupList.length
        : null;

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Deploy Intune template">
      <div style={drawerStyle}>
        <div
          style={{
            padding: "20px 24px 16px",
            borderBottom: "1px solid var(--border, #e5e7eb)",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "18px" }}>Deploy policy template</h2>
          <button style={{ ...buttonStyle, border: "none" }} onClick={onClose} aria-label="Close deploy drawer">
            ×
          </button>
        </div>

        <div style={bodyStyle}>
          <label style={fieldStyle}>
            Template
            <select
              style={inputStyle}
              value={templateId}
              onChange={(e) => edit(setTemplateId)(e.target.value)}
            >
              {templates.length === 0 && <option value="">No templates</option>}
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.policyType})
                </option>
              ))}
            </select>
          </label>

          <fieldset style={{ ...fieldStyle, border: "none", padding: 0, margin: 0 }}>
            <legend style={{ fontSize: "13px", marginBottom: "4px" }}>Target tenants</legend>
            <div style={listBoxStyle}>
              {tenants.length === 0 && <span style={{ color: "var(--text-muted, #6b7280)" }}>No tenants.</span>}
              {tenants.map((t) => (
                <label key={t.id} style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={tenantIds.includes(t.id)}
                    onChange={() => edit(setTenantIds)(toggle(tenantIds, t.id))}
                  />
                  {t.displayName ?? t.id}
                </label>
              ))}
            </div>
          </fieldset>

          {tenantGroups.length > 0 && (
            <fieldset style={{ ...fieldStyle, border: "none", padding: 0, margin: 0 }}>
              <legend style={{ fontSize: "13px", marginBottom: "4px" }}>Tenant groups</legend>
              <div style={listBoxStyle}>
                {tenantGroups.map((g) => (
                  <label key={g.id} style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={groupIds.includes(g.id)}
                      onChange={() => edit(setGroupIds)(toggle(groupIds, g.id))}
                    />
                    {g.name} ({g.memberTenantIds.length})
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <label style={fieldStyle}>
            Policy name (optional)
            <input
              style={inputStyle}
              value={policyName}
              placeholder="Defaults to the template's policy name"
              onChange={(e) => edit(setPolicyName)(e.target.value)}
            />
          </label>

          <label style={fieldStyle}>
            Assignment mode
            <select
              style={inputStyle}
              value={assignmentMode}
              onChange={(e) => edit(setAssignmentMode)(e.target.value as IntuneAssignmentMode)}
            >
              {ASSIGNMENT_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          {assignmentMode === "groups" && (
            <label style={fieldStyle}>
              Groups to assign (comma-separated names or IDs)
              <input
                style={inputStyle}
                value={assignGroups}
                onChange={(e) => edit(setAssignGroups)(e.target.value)}
              />
            </label>
          )}

          <label style={fieldStyle}>
            Policy state
            <select
              style={inputStyle}
              value={policyState}
              onChange={(e) => edit(setPolicyState)(e.target.value as IntuneDeployPolicyState)}
            >
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled (deploy without assignments)</option>
            </select>
          </label>

          <label style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "13px" }}>
            <input
              type="checkbox"
              role="switch"
              aria-checked={overwrite}
              checked={overwrite}
              onChange={(e) => edit(setOverwrite)(e.target.checked)}
            />
            Overwrite a policy with the same name
          </label>

          <label style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "13px" }}>
            <input
              type="checkbox"
              role="switch"
              aria-checked={createGroups && assignmentMode === "groups"}
              checked={createGroups && assignmentMode === "groups"}
              disabled={assignmentMode !== "groups"}
              onChange={(e) => edit(setCreateGroups)(e.target.checked)}
            />
            Create groups that do not exist
          </label>

          <div
            data-testid="target-count"
            style={{
              padding: "10px 14px",
              background: "var(--bg-elev, #f9fafb)",
              border: "1px solid var(--border, #e5e7eb)",
              borderRadius: "8px",
              fontSize: "13px",
            }}
          >
            Deploying to <strong>{targets.length}</strong> tenant{targets.length === 1 ? "" : "s"}
            {assignmentCount !== null && (
              <>
                {" "}· <strong>{assignmentCount}</strong> assignment group{assignmentCount === 1 ? "" : "s"}
              </>
            )}
          </div>

          {error && (
            <div role="alert" style={alertStyle}>
              {error}
            </div>
          )}

          {preview && !outcome && (
            <section aria-label="Deploy plan" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <h3 style={{ margin: 0, fontSize: "14px" }}>Plan for {preview.targetCount} tenant(s)</h3>
              {!preview.allValid && (
                <div role="alert" style={alertStyle}>
                  Some targets cannot be deployed. Resolve or deselect them before applying.
                </div>
              )}
              {preview.plans.map((plan) => (
                <div
                  key={plan.tenantId}
                  data-testid={`plan-${plan.tenantId}`}
                  style={{ border: "1px solid var(--border, #e5e7eb)", borderRadius: "8px", padding: "10px 12px" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                    <strong>{tenantName(plan.tenantId)}</strong>
                    <span style={{ color: plan.valid ? "var(--text-muted, #6b7280)" : "var(--danger, #dc2626)" }}>
                      {plan.valid ? `${plan.action} '${plan.policyName}'` : "blocked"}
                    </span>
                  </div>
                  {plan.conflictMessage && <p style={{ margin: "6px 0 0", fontSize: "12px" }}>{plan.conflictMessage}</p>}
                  {plan.issues.map((issue) => (
                    <p key={issue} style={{ margin: "6px 0 0", fontSize: "12px" }}>
                      {issue}
                    </p>
                  ))}
                  {plan.diff.length > 0 && (
                    <ul style={{ margin: "6px 0 0", paddingLeft: "18px", fontFamily: "var(--font-mono, monospace)", fontSize: "12px" }}>
                      {plan.diff.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </section>
          )}

          {outcome && (
            <section aria-label="Deploy results" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <h3 style={{ margin: 0, fontSize: "14px" }}>
                {outcome.summary.succeeded} succeeded · {outcome.summary.partial} partial · {outcome.summary.failed} failed
              </h3>
              {outcome.results.map((r) => (
                <div
                  key={r.tenantId}
                  data-testid={`result-${r.tenantId}`}
                  style={{ border: "1px solid var(--border, #e5e7eb)", borderRadius: "8px", padding: "10px 12px", fontSize: "13px" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <strong>{tenantName(r.tenantId)}</strong>
                    <span style={{ color: STATE_COLORS[r.state] }}>{r.state}</span>
                  </div>
                  {r.error && <p style={{ margin: "6px 0 0", fontSize: "12px" }}>{r.error}</p>}
                  {r.steps
                    .filter((s) => s.status === "failed")
                    .map((s, i) => (
                      <p key={i} style={{ margin: "6px 0 0", fontSize: "12px" }}>
                        {s.step}
                        {s.target ? ` (${s.target})` : ""} failed{s.error ? `: ${s.error}` : ""}
                      </p>
                    ))}
                </div>
              ))}
            </section>
          )}
        </div>

        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid var(--border, #e5e7eb)",
            display: "flex",
            gap: "8px",
            justifyContent: "flex-end",
          }}
        >
          <button style={buttonStyle} onClick={onClose}>
            {outcome ? "Close" : "Cancel"}
          </button>
          {!outcome && (
            <button style={buttonStyle} onClick={() => void runPreview()} disabled={busy}>
              {busy && !preview ? "Planning…" : "Preview plan"}
            </button>
          )}
          {!outcome && (
            <button
              style={primaryStyle}
              onClick={() => void runApply()}
              disabled={busy || !preview || !preview.allValid}
            >
              Apply to {targets.length} tenant{targets.length === 1 ? "" : "s"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
