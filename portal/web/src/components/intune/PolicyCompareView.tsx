"use client";

// PolicyCompareView — read-only structural diff of two Intune policies, or a policy and a
// template (EPIC-016 SPEC.md §3.4, §4.4; T-0310). Renders the T-0310 compare route as a
// unified or side-by-side diff of settings paths, plus assignment differences.
// Cross-tenant compare is deferred in v1: every option is scoped to `tenantId`.
import React, { useEffect, useState, type CSSProperties } from "react";

export interface SettingDiff {
  readonly path: string;
  readonly kind: "added" | "removed" | "changed";
  readonly left?: unknown;
  readonly right?: unknown;
}

export interface AssignmentDiff {
  readonly kind: "added" | "removed";
  readonly assignment: { readonly key: string; readonly targetType: string; readonly label: string };
}

export interface PolicyCompareResult {
  readonly left: { readonly ref: string; readonly label: string; readonly source: string; readonly platform: string };
  readonly right: { readonly ref: string; readonly label: string; readonly source: string; readonly platform: string };
  readonly kind: string;
  readonly settings: readonly SettingDiff[];
  readonly assignments: readonly AssignmentDiff[];
  readonly summary: {
    readonly added: number;
    readonly removed: number;
    readonly changed: number;
    readonly assignmentsAdded: number;
    readonly assignmentsRemoved: number;
  };
  readonly identical: boolean;
}

export interface CompareOption {
  /** policy:<kind>:<id> or template:<id> */
  readonly ref: string;
  readonly label: string;
}

export interface PolicyCompareViewProps {
  readonly tenantId: string;
  /** The policy being compared: policy:<kind>:<id>. */
  readonly leftRef: string;
  /** Policies and templates of the same kind in this tenant to compare against. */
  readonly rightOptions: readonly CompareOption[];
  readonly initialRightRef?: string | null;
}

export async function fetchPolicyCompare(
  tenantId: string,
  left: string,
  right: string,
  baseUrl = "",
): Promise<PolicyCompareResult> {
  const query = new URLSearchParams({ left, right }).toString();
  const res = await fetch(`${baseUrl}/v1/tenants/${encodeURIComponent(tenantId)}/intune/compare?${query}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Compare failed: HTTP ${res.status}`);
  }
  return res.json() as Promise<PolicyCompareResult>;
}

const MARKS: Record<SettingDiff["kind"], string> = { added: "+", removed: "-", changed: "~" };

const KIND_STYLES: Record<SettingDiff["kind"], CSSProperties> = {
  added: { background: "var(--diff-added-bg, #ecfdf5)", color: "var(--diff-added-fg, #065f46)" },
  removed: { background: "var(--diff-removed-bg, #fef2f2)", color: "var(--diff-removed-fg, #991b1b)" },
  changed: { background: "var(--diff-changed-bg, #fffbeb)", color: "var(--diff-changed-fg, #92400e)" },
};

const monoStyle: CSSProperties = { fontFamily: "var(--font-mono, monospace)", fontSize: "12px", wordBreak: "break-word" };
const cellStyle: CSSProperties = { padding: "6px 10px", borderBottom: "1px solid var(--border, #e5e7eb)", verticalAlign: "top" };
const headStyle: CSSProperties = {
  ...cellStyle,
  textAlign: "left",
  fontSize: "12px",
  fontWeight: 600,
  background: "var(--bg-elev, #f3f4f6)",
  color: "var(--text-muted, #6b7280)",
};
const inputStyle: CSSProperties = {
  padding: "6px 10px",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: "6px",
  fontSize: "13px",
  background: "var(--bg, #ffffff)",
  color: "var(--text, #111827)",
};
const toggleStyle = (active: boolean): CSSProperties => ({
  padding: "4px 10px",
  fontSize: "12px",
  borderRadius: "4px",
  cursor: "pointer",
  border: active ? "none" : "1px solid var(--border, #e5e7eb)",
  background: active ? "var(--accent, #2563eb)" : "var(--bg, #ffffff)",
  color: active ? "#ffffff" : "var(--text, #111827)",
});

/** Render a leaf value compactly: strings unquoted, everything else as JSON. */
export function formatValue(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function PolicyCompareView({ tenantId, leftRef, rightOptions, initialRightRef }: PolicyCompareViewProps) {
  const [rightRef, setRightRef] = useState(initialRightRef ?? "");
  const [mode, setMode] = useState<"unified" | "side-by-side">("unified");
  const [result, setResult] = useState<PolicyCompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!rightRef) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPolicyCompare(tenantId, leftRef, rightRef)
      .then((r) => !cancelled && setResult(r))
      .catch((err: unknown) => {
        if (!cancelled) {
          setResult(null);
          setError(err instanceof Error ? err.message : "Compare failed.");
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tenantId, leftRef, rightRef]);

  const options = rightOptions.filter((o) => o.ref !== leftRef);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", color: "var(--text, #111827)" }}>
      <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: "18px" }}>Compare policy</h2>
        <label style={{ display: "flex", gap: "6px", alignItems: "center", fontSize: "13px" }}>
          Compare with
          <select style={inputStyle} value={rightRef} onChange={(e) => setRightRef(e.target.value)}>
            <option value="">Choose a policy or template…</option>
            {options.map((o) => (
              <option key={o.ref} value={o.ref}>
                {o.ref.startsWith("template:") ? `Template: ${o.label}` : o.label}
              </option>
            ))}
          </select>
        </label>
        <div role="group" aria-label="Diff layout" style={{ display: "flex", gap: "4px", marginLeft: "auto" }}>
          <button style={toggleStyle(mode === "unified")} aria-pressed={mode === "unified"} onClick={() => setMode("unified")}>
            Unified
          </button>
          <button
            style={toggleStyle(mode === "side-by-side")}
            aria-pressed={mode === "side-by-side"}
            onClick={() => setMode("side-by-side")}
          >
            Side by side
          </button>
        </div>
      </div>

      {loading && <div style={{ color: "var(--text-muted, #6b7280)" }}>Comparing…</div>}
      {error && (
        <div role="alert" style={{ color: "var(--danger, #dc2626)", fontSize: "13px" }}>
          {error}
        </div>
      )}

      {result && !loading && (
        <>
          <div data-testid="compare-summary" style={{ fontSize: "13px" }}>
            <strong>{result.left.label}</strong> ↔ <strong>{result.right.label}</strong>
            {result.right.source === "template" ? " (template)" : ""} ·{" "}
            {result.identical
              ? "No differences"
              : `${result.summary.added} added · ${result.summary.removed} removed · ${result.summary.changed} changed · ` +
                `${result.summary.assignmentsAdded + result.summary.assignmentsRemoved} assignment difference(s)`}
          </div>

          <section aria-label="Settings differences">
            <h3 style={{ margin: "0 0 8px", fontSize: "14px" }}>Settings</h3>
            {result.settings.length === 0 ? (
              <p style={{ margin: 0, fontSize: "13px", color: "var(--text-muted, #6b7280)" }}>Settings match.</p>
            ) : mode === "unified" ? (
              <ul style={{ margin: 0, padding: 0, listStyle: "none", ...monoStyle }}>
                {result.settings.map((d) => (
                  <li key={d.path} data-kind={d.kind} style={{ ...KIND_STYLES[d.kind], padding: "3px 8px" }}>
                    {MARKS[d.kind]} {d.path}
                    {d.kind === "changed" && `: ${formatValue(d.left)} → ${formatValue(d.right)}`}
                    {d.kind === "added" && `: ${formatValue(d.right)}`}
                    {d.kind === "removed" && `: ${formatValue(d.left)}`}
                  </li>
                ))}
              </ul>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }} aria-label="Side-by-side settings diff">
                <thead>
                  <tr>
                    <th style={headStyle}>Setting</th>
                    <th style={headStyle}>{result.left.label}</th>
                    <th style={headStyle}>{result.right.label}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.settings.map((d) => (
                    <tr key={d.path} data-kind={d.kind} style={KIND_STYLES[d.kind]}>
                      <td style={{ ...cellStyle, ...monoStyle }}>{d.path}</td>
                      <td style={{ ...cellStyle, ...monoStyle }}>{d.kind === "added" ? "—" : formatValue(d.left)}</td>
                      <td style={{ ...cellStyle, ...monoStyle }}>{d.kind === "removed" ? "—" : formatValue(d.right)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section aria-label="Assignment differences">
            <h3 style={{ margin: "0 0 8px", fontSize: "14px" }}>Assignments</h3>
            {result.assignments.length === 0 ? (
              <p style={{ margin: 0, fontSize: "13px", color: "var(--text-muted, #6b7280)" }}>Assignments match.</p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: "13px" }}>
                {result.assignments.map((a) => (
                  <li key={`${a.kind}:${a.assignment.key}`} data-kind={a.kind} style={{ ...KIND_STYLES[a.kind], padding: "3px 8px" }}>
                    {MARKS[a.kind]} {a.assignment.label}
                    {a.assignment.targetType.startsWith("exclusion") ? " (excluded)" : ""} —{" "}
                    {a.kind === "added" ? `only on ${result.right.label}` : `only on ${result.left.label}`}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
