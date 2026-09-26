"use client";

// AssignmentFilterTable — Assignment Filters list + templates with a deploy wizard
// (EPIC-016 SPEC.md §3.3; T-0309). Talks to the T-0309 routes:
//   /v1/tenants/{id}/intune/assignment-filters[/{filterId}]
//   /v1/intune-assignment-filter-templates[/{id}[/deploy]]
// Rule and platform validation is server-side; its structured field errors are shown inline.
import React, { useCallback, useEffect, useState, type CSSProperties } from "react";

export type FilterPlatform = "windows" | "android" | "ios" | "macos";

export interface AssignmentFilter {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly platform: FilterPlatform | null;
  readonly graphPlatform: string;
  readonly rule: string;
}

export interface AssignmentFilterTemplate {
  readonly id: string;
  readonly name: string;
  readonly platform: FilterPlatform;
  readonly rule: string;
}

export interface FilterDeployPlan {
  readonly tenantId: string;
  readonly action: "create" | "update" | "none";
  readonly diff: readonly string[];
  readonly valid: boolean;
  readonly issue?: string | null;
}

export interface FilterDeployResult {
  readonly tenantId: string;
  readonly state: "succeeded" | "skipped" | "failed";
  readonly error?: string | null;
}

export interface FieldError {
  readonly field: string;
  readonly reason: string;
  readonly position?: number;
}

/** API error carrying the BFF's structured field detail. */
export class FilterApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: readonly FieldError[] = [],
  ) {
    super(message);
    this.name = "FilterApiError";
  }
}

const PLATFORMS: readonly { readonly value: FilterPlatform; readonly label: string }[] = [
  { value: "windows", label: "Windows 10 and later" },
  { value: "android", label: "Android Enterprise" },
  { value: "ios", label: "iOS/iPadOS" },
  { value: "macos", label: "macOS" },
];

const platformLabel = (p: string | null) => PLATFORMS.find((x) => x.value === p)?.label ?? p ?? "Other";

async function call<T>(url: string, init?: RequestInit, allowStatuses: number[] = []): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok && !allowStatuses.includes(res.status)) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; details?: FieldError[] };
    throw new FilterApiError(body.message ?? `Request failed: HTTP ${res.status}`, res.status, body.details ?? []);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

const tenantBase = (tenantId: string) => `/v1/tenants/${encodeURIComponent(tenantId)}/intune/assignment-filters`;
const TEMPLATE_BASE = "/v1/intune-assignment-filter-templates";

// ---- styles ----

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "14px",
  background: "var(--bg, #ffffff)",
  border: "1px solid var(--border, #e5e7eb)",
};
const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "10px 14px",
  background: "var(--bg-elev, #f3f4f6)",
  fontSize: "12px",
  fontWeight: 600,
  textTransform: "uppercase",
  color: "var(--text-muted, #6b7280)",
  borderBottom: "1px solid var(--border, #e5e7eb)",
};
const tdStyle: CSSProperties = { padding: "10px 14px", borderBottom: "1px solid var(--border, #e5e7eb)", verticalAlign: "top" };
const codeStyle: CSSProperties = { fontFamily: "var(--font-mono, monospace)", fontSize: "12px", wordBreak: "break-word" };
const inputStyle: CSSProperties = {
  padding: "6px 10px",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "6px",
  fontSize: "13px",
  background: "var(--bg, #ffffff)",
  color: "var(--text, #111827)",
};
const btnStyle: CSSProperties = {
  padding: "4px 10px",
  fontSize: "12px",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "4px",
  background: "var(--bg, #ffffff)",
  color: "var(--text, #111827)",
  cursor: "pointer",
  marginRight: "4px",
};
const primaryStyle: CSSProperties = { ...btnStyle, background: "var(--accent, #2563eb)", color: "#ffffff", border: "none", fontWeight: 600 };
const errorStyle: CSSProperties = { color: "var(--danger, #dc2626)", fontSize: "12px" };
const dialogOverlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  zIndex: 200,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const dialogStyle: CSSProperties = {
  width: "600px",
  maxWidth: "calc(100vw - 32px)",
  maxHeight: "calc(100vh - 32px)",
  overflowY: "auto",
  background: "var(--bg, #ffffff)",
  color: "var(--text, #111827)",
  borderRadius: "10px",
  padding: "20px 24px",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};
const fieldStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" };

// ---- filter / template form ----

interface FilterFormValues {
  name: string;
  description: string;
  platform: FilterPlatform;
  rule: string;
}

interface FilterFormProps {
  readonly title: string;
  readonly initial: FilterFormValues;
  /** Platform is fixed once a filter exists in Intune. */
  readonly platformLocked?: boolean;
  readonly showDescription?: boolean;
  /** The field name the server uses for the name ("displayName" for filters, "name" for templates). */
  readonly nameField: "displayName" | "name";
  readonly onSubmit: (values: FilterFormValues) => Promise<void>;
  readonly onClose: () => void;
}

function FilterForm({ title, initial, platformLocked, showDescription = true, nameField, onSubmit, onClose }: FilterFormProps) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<readonly FieldError[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorFor = (field: string) => errors.filter((e) => e.field === field);

  async function submit() {
    setBusy(true);
    setErrors([]);
    setMessage(null);
    try {
      await onSubmit(values);
      onClose();
    } catch (err: unknown) {
      if (err instanceof FilterApiError && err.details.length > 0) setErrors(err.details);
      else setMessage(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  const fieldErrors = (field: string) =>
    errorFor(field).map((e, i) => (
      <span key={i} role="alert" style={errorStyle}>
        {e.reason}
        {e.position !== undefined ? ` (at character ${e.position + 1})` : ""}
      </span>
    ));

  return (
    <div style={dialogOverlay} role="dialog" aria-modal="true" aria-label={title}>
      <div style={dialogStyle}>
        <h2 style={{ margin: 0, fontSize: "18px" }}>{title}</h2>
        {message && (
          <div role="alert" style={errorStyle}>
            {message}
          </div>
        )}
        <div style={fieldStyle}>
          <label style={fieldStyle}>
            Name
            <input style={inputStyle} value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} />
          </label>
          {fieldErrors(nameField)}
        </div>
        {showDescription && (
          <label style={fieldStyle}>
            Description
            <input
              style={inputStyle}
              value={values.description}
              onChange={(e) => setValues({ ...values, description: e.target.value })}
            />
          </label>
        )}
        <div style={fieldStyle}>
          <label style={fieldStyle}>
            Platform
            <select
              style={inputStyle}
              value={values.platform}
              disabled={platformLocked}
              onChange={(e) => setValues({ ...values, platform: e.target.value as FilterPlatform })}
            >
              {PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {fieldErrors("platform")}
        </div>
        <div style={fieldStyle}>
          <label style={fieldStyle}>
            Rule
            <textarea
              style={{ ...inputStyle, ...codeStyle, minHeight: "96px" }}
              value={values.rule}
              placeholder='(device.deviceOwnership -eq "Corporate") and (device.model -startsWith "Surface")'
              onChange={(e) => setValues({ ...values, rule: e.target.value })}
            />
          </label>
          {fieldErrors("rule")}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button style={btnStyle} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button style={primaryStyle} onClick={() => void submit()} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- deploy wizard ----

export interface DeployTenant {
  readonly id: string;
  readonly displayName?: string | null;
}

function DeployWizard({
  template,
  tenants,
  onClose,
}: {
  readonly template: AssignmentFilterTemplate;
  readonly tenants: readonly DeployTenant[];
  readonly onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [plans, setPlans] = useState<readonly FilterDeployPlan[] | null>(null);
  const [results, setResults] = useState<readonly FilterDeployResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const url = `${TEMPLATE_BASE}/${encodeURIComponent(template.id)}/deploy`;
  const name = (id: string) => tenants.find((t) => t.id === id)?.displayName ?? id;

  function toggle(id: string) {
    setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    setPlans(null);
  }

  async function run(preview: boolean) {
    setBusy(true);
    setError(null);
    try {
      if (preview) {
        const body = await call<{ plans: FilterDeployPlan[] }>(url, jsonInit("POST", { targets: selected, preview: true }));
        setPlans(body.plans);
      } else {
        const body = await call<{ results: FilterDeployResult[] }>(
          url,
          jsonInit("POST", { targets: selected, preview: false, confirmTargetCount: selected.length }),
          [422],
        );
        setResults(body.results);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Deploy failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={dialogOverlay} role="dialog" aria-modal="true" aria-label="Deploy filter template">
      <div style={dialogStyle}>
        <h2 style={{ margin: 0, fontSize: "18px" }}>Deploy “{template.name}”</h2>
        <div style={{ fontSize: "12px", ...codeStyle }}>{template.rule}</div>
        {!results && (
          <fieldset style={{ border: "1px solid var(--border, #e5e7eb)", borderRadius: "6px", padding: "8px 12px" }}>
            <legend style={{ fontSize: "13px" }}>Target tenants</legend>
            {tenants.map((t) => (
              <label key={t.id} style={{ display: "flex", gap: "6px", fontSize: "13px" }}>
                <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggle(t.id)} />
                {t.displayName ?? t.id}
              </label>
            ))}
          </fieldset>
        )}
        <div data-testid="deploy-target-count" style={{ fontSize: "13px" }}>
          Deploying to <strong>{selected.length}</strong> tenant{selected.length === 1 ? "" : "s"}
        </div>
        {error && (
          <div role="alert" style={errorStyle}>
            {error}
          </div>
        )}
        {plans && !results && (
          <section aria-label="Deploy plan" style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px" }}>
            {plans.map((p) => (
              <div key={p.tenantId} data-testid={`filter-plan-${p.tenantId}`}>
                <strong>{name(p.tenantId)}</strong>: {p.valid ? p.action : "blocked"}
                {p.issue && <div style={errorStyle}>{p.issue}</div>}
                {p.diff.length > 0 && (
                  <ul style={{ margin: "4px 0 0", paddingLeft: "18px", ...codeStyle }}>
                    {p.diff.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </section>
        )}
        {results && (
          <section aria-label="Deploy results" style={{ fontSize: "13px" }}>
            {results.map((r) => (
              <div key={r.tenantId} data-testid={`filter-result-${r.tenantId}`}>
                <strong>{name(r.tenantId)}</strong>: {r.state}
                {r.error && <span style={errorStyle}> — {r.error}</span>}
              </div>
            ))}
          </section>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button style={btnStyle} onClick={onClose}>
            {results ? "Close" : "Cancel"}
          </button>
          {!results && (
            <>
              <button style={btnStyle} onClick={() => void run(true)} disabled={busy || selected.length === 0}>
                Preview plan
              </button>
              <button
                style={primaryStyle}
                onClick={() => void run(false)}
                disabled={busy || !plans || !plans.every((p) => p.valid)}
              >
                Deploy to {selected.length} tenant{selected.length === 1 ? "" : "s"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- main component ----

export interface AssignmentFilterTableProps {
  readonly tenantId: string;
  /** Tenants offered as deploy targets. */
  readonly tenants: readonly DeployTenant[];
}

type Dialog =
  | { kind: "createFilter" }
  | { kind: "editFilter"; filter: AssignmentFilter }
  | { kind: "createTemplate"; from?: AssignmentFilter }
  | { kind: "deploy"; template: AssignmentFilterTemplate };

export function AssignmentFilterTable({ tenantId, tenants }: AssignmentFilterTableProps) {
  const [tab, setTab] = useState<"filters" | "templates">("filters");
  const [filters, setFilters] = useState<readonly AssignmentFilter[]>([]);
  const [templates, setTemplates] = useState<readonly AssignmentFilterTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [f, t] = await Promise.all([
        call<{ items: AssignmentFilter[] }>(tenantBase(tenantId)),
        call<{ items: AssignmentFilterTemplate[] }>(TEMPLATE_BASE),
      ]);
      setFilters(f.items);
      setTemplates(t.items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load assignment filters.");
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function deleteFilter(filter: AssignmentFilter) {
    const confirmName = window.prompt(`Type the filter name '${filter.displayName}' to delete it:`);
    if (!confirmName) return;
    try {
      await call(`${tenantBase(tenantId)}/${encodeURIComponent(filter.id)}`, jsonInit("DELETE", { confirmName }));
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    }
  }

  async function deleteTemplate(template: AssignmentFilterTemplate) {
    if (!window.confirm(`Delete the template '${template.name}'?`)) return;
    try {
      await call(`${TEMPLATE_BASE}/${encodeURIComponent(template.id)}`, { method: "DELETE" });
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    }
  }

  const tabButton = (value: "filters" | "templates", label: string) => (
    <button
      role="tab"
      aria-selected={tab === value}
      style={tab === value ? primaryStyle : btnStyle}
      onClick={() => setTab(value)}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", color: "var(--text, #111827)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
        <h2 style={{ margin: 0, fontSize: "18px" }}>Assignment Filters</h2>
        <div role="tablist" style={{ display: "flex", gap: "4px" }}>
          {tabButton("filters", "Filters")}
          {tabButton("templates", "Templates")}
        </div>
      </div>
      {error && (
        <div role="alert" style={{ ...errorStyle, fontSize: "13px" }}>
          {error}
        </div>
      )}

      {tab === "filters" ? (
        <>
          <div>
            <button style={primaryStyle} onClick={() => setDialog({ kind: "createFilter" })}>
              New filter
            </button>
          </div>
          <table style={tableStyle} aria-label="Assignment filters">
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Platform</th>
                <th style={thStyle}>Rule</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filters.length === 0 ? (
                <tr>
                  <td style={tdStyle} colSpan={4}>
                    No assignment filters.
                  </td>
                </tr>
              ) : (
                filters.map((f) => (
                  <tr key={f.id} data-testid={`filter-${f.id}`}>
                    <td style={tdStyle}>{f.displayName}</td>
                    <td style={tdStyle}>{platformLabel(f.platform)}</td>
                    <td style={{ ...tdStyle, ...codeStyle }}>{f.rule}</td>
                    <td style={tdStyle}>
                      <button style={btnStyle} aria-label={`Edit ${f.displayName}`} onClick={() => setDialog({ kind: "editFilter", filter: f })}>
                        Edit
                      </button>
                      <button
                        style={btnStyle}
                        aria-label={`Save ${f.displayName} as template`}
                        disabled={f.platform === null}
                        onClick={() => setDialog({ kind: "createTemplate", from: f })}
                      >
                        Save as template
                      </button>
                      <button
                        style={{ ...btnStyle, color: "var(--danger, #dc2626)" }}
                        aria-label={`Delete ${f.displayName}`}
                        onClick={() => void deleteFilter(f)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </>
      ) : (
        <>
          <div>
            <button style={primaryStyle} onClick={() => setDialog({ kind: "createTemplate" })}>
              New template
            </button>
          </div>
          <table style={tableStyle} aria-label="Assignment filter templates">
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Platform</th>
                <th style={thStyle}>Rule</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.length === 0 ? (
                <tr>
                  <td style={tdStyle} colSpan={4}>
                    No filter templates.
                  </td>
                </tr>
              ) : (
                templates.map((t) => (
                  <tr key={t.id} data-testid={`filter-template-${t.id}`}>
                    <td style={tdStyle}>{t.name}</td>
                    <td style={tdStyle}>{platformLabel(t.platform)}</td>
                    <td style={{ ...tdStyle, ...codeStyle }}>{t.rule}</td>
                    <td style={tdStyle}>
                      <button style={primaryStyle} aria-label={`Deploy ${t.name}`} onClick={() => setDialog({ kind: "deploy", template: t })}>
                        Deploy
                      </button>
                      <button
                        style={{ ...btnStyle, color: "var(--danger, #dc2626)" }}
                        aria-label={`Delete ${t.name}`}
                        onClick={() => void deleteTemplate(t)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </>
      )}

      {dialog?.kind === "createFilter" && (
        <FilterForm
          title="New assignment filter"
          nameField="displayName"
          initial={{ name: "", description: "", platform: "windows", rule: "" }}
          onClose={() => setDialog(null)}
          onSubmit={async (v) => {
            await call(
              tenantBase(tenantId),
              jsonInit("POST", { displayName: v.name, description: v.description, platform: v.platform, rule: v.rule }),
            );
            await load();
          }}
        />
      )}
      {dialog?.kind === "editFilter" && (
        <FilterForm
          title={`Edit ${dialog.filter.displayName}`}
          nameField="displayName"
          platformLocked
          initial={{
            name: dialog.filter.displayName,
            description: dialog.filter.description,
            platform: dialog.filter.platform ?? "windows",
            rule: dialog.filter.rule,
          }}
          onClose={() => setDialog(null)}
          onSubmit={async (v) => {
            const f = dialog.filter;
            const patch: Record<string, string> = {};
            if (v.name !== f.displayName) patch.displayName = v.name;
            if (v.description !== f.description) patch.description = v.description;
            if (v.rule !== f.rule) patch.rule = v.rule;
            if (Object.keys(patch).length === 0) return;
            await call(`${tenantBase(tenantId)}/${encodeURIComponent(f.id)}`, jsonInit("PATCH", patch));
            await load();
          }}
        />
      )}
      {dialog?.kind === "createTemplate" && (
        <FilterForm
          title="New filter template"
          nameField="name"
          showDescription={false}
          initial={{
            name: dialog.from?.displayName ?? "",
            description: "",
            platform: dialog.from?.platform ?? "windows",
            rule: dialog.from?.rule ?? "",
          }}
          onClose={() => setDialog(null)}
          onSubmit={async (v) => {
            await call(TEMPLATE_BASE, jsonInit("POST", { name: v.name, platform: v.platform, rule: v.rule }));
            await load();
            setTab("templates");
          }}
        />
      )}
      {dialog?.kind === "deploy" && (
        <DeployWizard template={dialog.template} tenants={tenants} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
