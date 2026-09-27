"use client";

// Baseline builder (EPIC-010 SPEC.md §3.3; T-0183).
// Add/Edit Baseline with sidebar cards Baseline Details, Alerting, Setup
// Progress, and Baseline Summary. Timeline steps — Set a baseline name →
// Assign tenants or groups → Add standards to at least one stage — gate the
// save button: save stays disabled until all three are done (mirroring the
// T-0182 server gate). Stages and conditions edit through StageEditor;
// alerting config ties into EPIC-029 (stored, delivered later).
// Zero colour literals: report theme tokens only.

import React, { use, useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react";
import { BaselineTimeline, type BaselineTimelineStep } from "../../../../components/baselines/BaselineTimeline";
import { StageEditor } from "../../../../components/baselines/StageEditor";
import {
  createBaseline,
  fetchBaseline,
  updateBaseline,
  type BaselineAssignmentInput,
  type BaselineStageInput,
  type BaselineTargetType,
} from "../../../../lib/baselinesApi";

const pageStyle: CSSProperties = {
  padding: "32px",
  maxWidth: "1200px",
  margin: "0 auto",
  display: "grid",
  gridTemplateColumns: "260px 1fr",
  gap: "24px",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
};

const sidebarStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  alignSelf: "start",
};

const cardStyle: CSSProperties = {
  padding: "16px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  boxShadow: "var(--shadow-card)",
  display: "flex",
  flexDirection: "column",
  gap: "10px",
};

const cardTitleStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 700,
  margin: 0,
};

const cardTextStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--text-soft)",
  margin: 0,
};

const mainStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
};

const titleStyle: CSSProperties = {
  fontSize: "24px",
  fontWeight: 700,
  margin: 0,
  fontFamily: "var(--font-display, var(--font-sans))",
};

const inputStyle: CSSProperties = {
  padding: "8px 12px",
  background: "var(--input-bg, var(--bg))",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "14px",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
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

const disabledButtonStyle: CSSProperties = {
  opacity: 0.5,
  cursor: "not-allowed",
};

const rowStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  alignItems: "center",
  flexWrap: "wrap",
};

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  fontSize: "13px",
  fontWeight: 600,
};

export interface BaselineBuilderPageProps {
  readonly params: Promise<{ id: string }> | { id: string };
  readonly fetcher?: typeof fetch;
}

export default function BaselineBuilderPage({ params, fetcher }: BaselineBuilderPageProps): ReactElement {
  const doFetch = fetcher ?? fetch;
  const resolved = (
    typeof (params as Promise<{ id: string }>).then === "function"
      ? use(params as Promise<{ id: string }>)
      : (params as { id: string })
  );
  const baselineId = resolved.id;
  const isNew = baselineId === "new";

  const [name, setName] = useState("");
  const [assignments, setAssignments] = useState<BaselineAssignmentInput[]>([]);
  const [assignType, setAssignType] = useState<BaselineTargetType>("tenant");
  const [assignTarget, setAssignTarget] = useState("");
  const [stages, setStages] = useState<BaselineStageInput[]>([]);
  const [alertingEnabled, setAlertingEnabled] = useState(false);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (isNew) return;
    setLoading(true);
    setError(null);
    try {
      const detail = await fetchBaseline(baselineId, doFetch);
      setName(detail.name);
      setAssignments(
        detail.assignments.map((assignment) => ({
          targetType: assignment.targetType,
          targetId: assignment.targetId,
          precedence: assignment.precedence,
        })),
      );
      setStages(
        detail.stages.map((stage) => ({
          order: stage.order,
          conditions: [...stage.conditions],
          action: stage.action,
        })),
      );
      setAlertingEnabled(detail.alerting.enabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [baselineId, doFetch, isNew]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasName = name.trim().length > 0;
  const hasAssignment = assignments.length > 0;
  const stagedCount = useMemo(
    () => stages.reduce((count, stage) => count + stage.conditions.length, 0),
    [stages],
  );
  const hasStandards = stagedCount > 0;
  const canSave = hasName && hasAssignment && hasStandards && !saving;

  const steps: readonly BaselineTimelineStep[] = [
    { id: "name", label: "Set a baseline name", state: hasName ? "done" : "current" },
    {
      id: "assign",
      label: "Assign tenants or groups",
      state: hasAssignment ? "done" : hasName ? "current" : "todo",
    },
    {
      id: "standards",
      label: "Add standards to at least one stage",
      state: hasStandards ? "done" : hasAssignment ? "current" : "todo",
    },
  ];

  const handleAddAssignment = (): void => {
    if (assignType !== "allTenants" && !assignTarget.trim()) return;
    setAssignments((previous) => [
      ...previous,
      {
        targetType: assignType,
        targetId: assignType === "allTenants" ? null : assignTarget.trim(),
        precedence: previous.length,
      },
    ]);
    setAssignTarget("");
  };

  const handleRemoveAssignment = (index: number): void => {
    setAssignments((previous) => previous.filter((_, position) => position !== index));
  };

  const handleSave = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        alerting: { enabled: alertingEnabled },
        stages,
        assignments,
      };
      const saved = isNew
        ? await createBaseline(payload, doFetch)
        : await updateBaseline(baselineId, payload, doFetch);
      setNotice(`Baseline “${saved.name}” saved.`);
      if (isNew) {
        window.location.href = `/baselines/${saved.id}/edit`;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={pageStyle} data-testid="baseline-builder">
      <aside style={sidebarStyle}>
        <div style={cardStyle} data-testid="builder-card-details">
          <h2 style={cardTitleStyle}>Baseline Details</h2>
          <p style={cardTextStyle}>{isNew ? "New staged rollout." : `Editing ${name || baselineId}.`}</p>
        </div>
        <div style={cardStyle} data-testid="builder-card-progress">
          <h2 style={cardTitleStyle}>Setup Progress</h2>
          <BaselineTimeline steps={steps} />
        </div>
        <div style={cardStyle} data-testid="builder-card-alerting">
          <h2 style={cardTitleStyle}>Alerting</h2>
          <label style={{ ...cardTextStyle, display: "flex", gap: "8px", alignItems: "center" }}>
            <input
              type="checkbox"
              data-testid="builder-alerting"
              checked={alertingEnabled}
              onChange={(event) => setAlertingEnabled(event.target.checked)}
            />
            Alert on stage drift (EPIC-029)
          </label>
        </div>
        <div style={cardStyle} data-testid="builder-card-summary">
          <h2 style={cardTitleStyle}>Baseline Summary</h2>
          <p style={cardTextStyle} data-testid="builder-summary">
            {stages.length} stage{stages.length === 1 ? "" : "s"} · {stagedCount} standard
            {stagedCount === 1 ? "" : "s"} · {assignments.length} assignment
            {assignments.length === 1 ? "" : "s"}
          </p>
        </div>
      </aside>

      <div style={mainStyle}>
        <h1 style={titleStyle}>{isNew ? "Add Baseline" : "Edit Baseline"}</h1>
        {loading && <div data-testid="builder-loading">Loading baseline…</div>}
        {error && (
          <div
            data-testid="builder-error"
            style={{
              padding: "10px 14px",
              background: "var(--danger-soft)",
              border: "1px solid var(--danger)",
              borderRadius: "6px",
              color: "var(--danger-text)",
              fontSize: "13px",
            }}
          >
            {error}
          </div>
        )}
        {notice && (
          <div
            data-testid="builder-notice"
            style={{
              padding: "10px 14px",
              background: "var(--accent-soft)",
              border: "1px solid var(--accent)",
              borderRadius: "6px",
              color: "var(--accent-text)",
              fontSize: "13px",
            }}
          >
            {notice}
          </div>
        )}

        <section style={cardStyle} aria-label="Baseline name">
          <label style={labelStyle}>
            Baseline name
            <input
              style={inputStyle}
              data-testid="builder-name"
              placeholder="e.g. Server baseline"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        </section>

        <section style={cardStyle} aria-label="Assignments">
          <h2 style={cardTitleStyle}>Assign tenants or groups</h2>
          {assignments.map((assignment, index) => (
            <div key={`${assignment.targetType}-${assignment.targetId ?? "all"}-${index}`} style={rowStyle} data-testid={`assignment-${index}`}>
              <span style={{ fontSize: "13px" }}>
                {assignment.targetType}: {assignment.targetId ?? "all tenants"}
              </span>
              <button
                type="button"
                style={{ ...buttonStyle, padding: "4px 8px", fontSize: "12px" }}
                data-testid={`assignment-remove-${index}`}
                onClick={() => handleRemoveAssignment(index)}
              >
                Remove
              </button>
            </div>
          ))}
          <div style={rowStyle}>
            <select
              style={selectStyle}
              aria-label="Assignment target type"
              data-testid="assignment-type"
              value={assignType}
              onChange={(event) => setAssignType(event.target.value as BaselineTargetType)}
            >
              <option value="tenant">Tenant</option>
              <option value="group">Group</option>
              <option value="allTenants">All tenants</option>
            </select>
            {assignType !== "allTenants" && (
              <input
                style={inputStyle}
                aria-label="Assignment target id"
                data-testid="assignment-target"
                placeholder="Tenant or group id…"
                value={assignTarget}
                onChange={(event) => setAssignTarget(event.target.value)}
              />
            )}
            <button type="button" style={buttonStyle} data-testid="assignment-add" onClick={handleAddAssignment}>
              Add assignment
            </button>
          </div>
        </section>

        <section style={cardStyle} aria-label="Stages">
          <h2 style={cardTitleStyle}>Stages</h2>
          <StageEditor stages={stages} onChange={setStages} />
        </section>

        <div style={rowStyle}>
          <button
            type="button"
            style={{ ...primaryButtonStyle, ...(canSave ? {} : disabledButtonStyle) }}
            data-testid="builder-save"
            disabled={!canSave}
            onClick={() => void handleSave()}
          >
            {saving ? "Saving…" : "Save baseline"}
          </button>
          {!canSave && (
            <span style={{ fontSize: "13px", color: "var(--text-soft)" }} data-testid="builder-save-hint">
              Save needs a name, an assignment, and a staged standard.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
