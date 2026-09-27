"use client";

// Standards templates table (EPIC-008 SPEC.md §3.1, T-0146).
// Columns: Name · Type (standards/drift) · Assigned to · Standards count ·
// Schedule · Last run. Filters: type, assigned target, schedule. Row actions per
// §3.1, with `Save to GitHub` shown only when the EPIC-039 integration is on and
// `Set schedule` hidden for drift templates. Zero colour literals: report tokens.

import React, { useMemo, useState, type CSSProperties, type ReactElement } from "react";
import { kindLabel, type StandardTemplateKind } from "../../lib/standardsApi";

export interface StandardsTemplateItem {
  readonly id: string;
  readonly name: string;
  readonly kind: StandardTemplateKind;
  /** Assignment labels (tenant/group names); empty when none/unavailable. */
  readonly assignedTo?: readonly string[];
  readonly standardsCount: number;
  readonly schedule: string | null;
  readonly lastRunAt: string | null;
  readonly autoRemediate?: boolean;
}

export interface TemplatesTableProps {
  readonly templates?: readonly StandardsTemplateItem[];
  readonly loading?: boolean;
  readonly error?: string | null;
  /** EPIC-039 GitHub integration; when false, Save to GitHub is hidden. */
  readonly githubEnabled?: boolean;
  readonly onViewTenantReport?: (template: StandardsTemplateItem) => void;
  readonly onEdit?: (template: StandardsTemplateItem) => void;
  readonly onCloneAndEdit?: (template: StandardsTemplateItem) => void;
  readonly onCreateDriftClone?: (template: StandardsTemplateItem) => void;
  readonly onRunTemplateNow?: (template: StandardsTemplateItem) => void;
  readonly onSetSchedule?: (template: StandardsTemplateItem) => void;
  readonly onSaveToGitHub?: (template: StandardsTemplateItem) => void;
  readonly onDelete?: (template: StandardsTemplateItem) => void;
  readonly onConvert?: (template: StandardsTemplateItem) => void;
  readonly onCreateTemplate?: () => void;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  width: "100%",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
};

const barStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 16px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
};

const inputStyle: CSSProperties = {
  padding: "8px 12px",
  background: "var(--input-bg, var(--bg))",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "14px",
};

const selectStyle: CSSProperties = { ...inputStyle, cursor: "pointer" };

const buttonStyle: CSSProperties = {
  padding: "8px 14px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "14px",
  fontWeight: 500,
  cursor: "pointer",
};

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "var(--accent)",
  color: "var(--accent-text)",
  borderColor: "var(--accent)",
};

const actionBtnStyle: CSSProperties = {
  padding: "4px 8px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "4px",
  color: "var(--text)",
  fontSize: "12px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const tableWrapperStyle: CSSProperties = {
  overflowX: "auto",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  boxShadow: "var(--shadow-card)",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "14px",
  textAlign: "left",
};

const thStyle: CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text-soft)",
  fontWeight: 600,
  fontSize: "12px",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  whiteSpace: "nowrap",
};

const tdStyle: CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid var(--border)",
  color: "var(--text)",
  verticalAlign: "middle",
};

const badgeBaseStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 600,
};

export function kindBadgeStyle(kind: StandardTemplateKind): CSSProperties {
  if (kind === "drift") {
    return { ...badgeBaseStyle, background: "var(--warning-soft)", color: "var(--warning-text)", border: "1px solid var(--warning)" };
  }
  return { ...badgeBaseStyle, background: "var(--accent-soft)", color: "var(--accent-text)", border: "1px solid var(--accent)" };
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function assignedToLabel(assignedTo: readonly string[] | undefined): string {
  if (!assignedTo || assignedTo.length === 0) return "—";
  if (assignedTo.length <= 2) return assignedTo.join(", ");
  return `${assignedTo.slice(0, 2).join(", ")} +${assignedTo.length - 2}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TemplatesTable({
  templates = [],
  loading = false,
  error = null,
  githubEnabled = false,
  onViewTenantReport,
  onEdit,
  onCloneAndEdit,
  onCreateDriftClone,
  onRunTemplateNow,
  onSetSchedule,
  onSaveToGitHub,
  onDelete,
  onConvert,
  onCreateTemplate,
}: TemplatesTableProps): ReactElement {
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [assignedFilter, setAssignedFilter] = useState<string>("");
  const [scheduleFilter, setScheduleFilter] = useState<string>("all");
  const [confirmRun, setConfirmRun] = useState<string | null>(null);

  const assignedTargets = useMemo(() => {
    const set = new Set<string>();
    for (const template of templates) for (const target of template.assignedTo ?? []) set.add(target);
    return [...set].sort();
  }, [templates]);

  const filtered = useMemo(() => {
    return templates.filter((template) => {
      if (typeFilter !== "all" && template.kind !== typeFilter) return false;
      if (scheduleFilter === "scheduled" && !template.schedule) return false;
      if (scheduleFilter === "unscheduled" && template.schedule) return false;
      if (assignedFilter.trim()) {
        const query = assignedFilter.trim().toLowerCase();
        const haystack = (template.assignedTo ?? []).join(" ").toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [templates, typeFilter, scheduleFilter, assignedFilter]);

  const runTarget = templates.find((t) => t.id === confirmRun) ?? null;

  return (
    <div style={containerStyle} data-testid="templates-table">
      <div style={barStyle}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" }}>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            style={selectStyle}
            aria-label="Filter by type"
            data-testid="filter-type"
          >
            <option value="all">All types</option>
            <option value="standards">Standards</option>
            <option value="drift">Drift</option>
          </select>

          <input
            type="text"
            placeholder="Filter by assigned target..."
            value={assignedFilter}
            onChange={(e) => setAssignedFilter(e.target.value)}
            style={inputStyle}
            aria-label="Filter by assigned target"
            data-testid="filter-assigned"
            list="assigned-target-options"
          />
          <datalist id="assigned-target-options">
            {assignedTargets.map((target) => (
              <option key={target} value={target} />
            ))}
          </datalist>

          <select
            value={scheduleFilter}
            onChange={(e) => setScheduleFilter(e.target.value)}
            style={selectStyle}
            aria-label="Filter by schedule"
            data-testid="filter-schedule"
          >
            <option value="all">Any schedule</option>
            <option value="scheduled">Scheduled</option>
            <option value="unscheduled">Not scheduled</option>
          </select>
        </div>

        {onCreateTemplate && (
          <button type="button" style={primaryButtonStyle} onClick={onCreateTemplate} data-testid="create-template-button">
            Create template
          </button>
        )}
      </div>

      {loading && <div style={{ padding: "32px", textAlign: "center", color: "var(--text-soft)" }}>Loading templates...</div>}

      {error && (
        <div style={{ padding: "16px", background: "var(--danger-soft)", border: "1px solid var(--danger)", borderRadius: "6px", color: "var(--danger-text)" }} role="alert">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div style={tableWrapperStyle}>
          <table style={tableStyle} aria-label="Standards templates">
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Assigned to</th>
                <th style={thStyle}>Standards</th>
                <th style={thStyle}>Schedule</th>
                <th style={thStyle}>Last run</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td style={{ ...tdStyle, textAlign: "center", color: "var(--text-soft)" }} colSpan={7} data-testid="empty-templates-state">
                    No standards templates match the current filters.
                  </td>
                </tr>
              )}
              {filtered.map((template) => (
                <tr key={template.id} data-testid={`template-row-${template.id}`}>
                  <td style={tdStyle}>{template.name}</td>
                  <td style={tdStyle}>
                    <span className="status-badge" style={kindBadgeStyle(template.kind)} data-testid={`kind-${template.id}`}>
                      {kindLabel(template.kind)}
                    </span>
                  </td>
                  <td style={tdStyle}>{assignedToLabel(template.assignedTo)}</td>
                  <td style={tdStyle} data-testid={`count-${template.id}`}>{template.standardsCount}</td>
                  <td style={tdStyle}>{template.schedule ?? "—"}</td>
                  <td style={tdStyle}>{formatDateTime(template.lastRunAt)}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <div style={{ display: "inline-flex", gap: "6px", justifyContent: "flex-end", flexWrap: "wrap" }}>
                      {onViewTenantReport && (
                        <button type="button" style={actionBtnStyle} onClick={() => onViewTenantReport(template)} data-testid={`report-${template.id}`}>
                          View tenant report
                        </button>
                      )}
                      {onEdit && (
                        <button type="button" style={actionBtnStyle} onClick={() => onEdit(template)} data-testid={`edit-${template.id}`}>
                          Edit
                        </button>
                      )}
                      {onCloneAndEdit && (
                        <button type="button" style={actionBtnStyle} onClick={() => onCloneAndEdit(template)} data-testid={`clone-edit-${template.id}`}>
                          Clone &amp; edit
                        </button>
                      )}
                      {onCreateDriftClone && template.kind === "standards" && (
                        <button type="button" style={actionBtnStyle} onClick={() => onCreateDriftClone(template)} data-testid={`drift-clone-${template.id}`}>
                          Create drift clone
                        </button>
                      )}
                      {onRunTemplateNow && (
                        <button type="button" style={actionBtnStyle} onClick={() => setConfirmRun(template.id)} data-testid={`run-now-${template.id}`}>
                          Run template now
                        </button>
                      )}
                      {onSetSchedule && template.kind !== "drift" && (
                        <button type="button" style={actionBtnStyle} onClick={() => onSetSchedule(template)} data-testid={`schedule-${template.id}`}>
                          {template.schedule ? "Disable schedule" : "Enable schedule"}
                        </button>
                      )}
                      {onSaveToGitHub && githubEnabled && (
                        <button type="button" style={actionBtnStyle} onClick={() => onSaveToGitHub(template)} data-testid={`github-${template.id}`}>
                          Save to GitHub
                        </button>
                      )}
                      {onConvert && (
                        <button type="button" style={actionBtnStyle} onClick={() => onConvert(template)} data-testid={`convert-${template.id}`}>
                          Convert
                        </button>
                      )}
                      {onDelete && (
                        <button type="button" style={actionBtnStyle} onClick={() => onDelete(template)} data-testid={`delete-${template.id}`}>
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {runTarget && onRunTemplateNow && (
        <div
          style={{ padding: "12px 16px", background: "var(--warning-soft)", border: "1px solid var(--warning)", borderRadius: "6px", color: "var(--warning-text)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}
          role="alertdialog"
          data-testid="run-template-confirm"
        >
          <span>Run “{runTarget.name}” now?</span>
          <span style={{ display: "inline-flex", gap: "8px" }}>
            <button type="button" style={buttonStyle} onClick={() => setConfirmRun(null)} data-testid="run-template-cancel">
              Cancel
            </button>
            <button
              type="button"
              style={primaryButtonStyle}
              onClick={() => {
                const target = runTarget;
                setConfirmRun(null);
                onRunTemplateNow(target);
              }}
              data-testid="run-template-confirm-button"
            >
              Run now
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
