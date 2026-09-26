"use client";

// Baseline stage editor (EPIC-010 SPEC.md §3.3; T-0183).
// Stages are added/removed in order; each stage holds standards with
// `logic: 'and'` and conditions, each condition individually removable.
// Only `and` logic is offered: the logic is rendered as a fixed label, never
// a selector, so a non-`and` value cannot be produced. Zero colour literals:
// report theme tokens only.

import React, { useState, type CSSProperties, type ReactElement } from "react";
import type { BaselineConditionInput, BaselineStageAction, BaselineStageInput } from "../../lib/baselinesApi.js";

export interface StageEditorProps {
  readonly stages: readonly BaselineStageInput[];
  readonly onChange: (stages: BaselineStageInput[]) => void;
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};

const stageCardStyle: CSSProperties = {
  padding: "14px 16px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 10px)",
  display: "flex",
  flexDirection: "column",
  gap: "10px",
};

const stageHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "10px",
  flexWrap: "wrap",
};

const stageTitleStyle: CSSProperties = {
  fontSize: "15px",
  fontWeight: 700,
  margin: 0,
};

const logicBadgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 600,
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  background: "var(--accent-soft)",
  color: "var(--accent-text)",
  border: "1px solid var(--accent)",
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

const smallButtonStyle: CSSProperties = {
  ...buttonStyle,
  padding: "4px 8px",
  fontSize: "12px",
};

const conditionRowStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  alignItems: "center",
  flexWrap: "wrap",
};

const monoStyle: CSSProperties = {
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: "12px",
};

function emptyStage(order: number): BaselineStageInput {
  return { order, conditions: [], action: "report" };
}

export function StageEditor({ stages, onChange }: StageEditorProps): ReactElement {
  const [draftKey, setDraftKey] = useState<Record<number, string>>({});
  const [draftValue, setDraftValue] = useState<Record<number, string>>({});

  const ordered = [...stages].sort((left, right) => left.order - right.order);

  const renumber = (list: BaselineStageInput[]): BaselineStageInput[] =>
    list.map((stage, index) => ({ ...stage, order: index }));

  const handleAddStage = (): void => {
    onChange([...ordered, emptyStage(ordered.length)]);
  };

  const handleRemoveStage = (order: number): void => {
    onChange(renumber(ordered.filter((stage) => stage.order !== order)));
  };

  const handleAction = (order: number, action: BaselineStageAction): void => {
    onChange(ordered.map((stage) => (stage.order === order ? { ...stage, action } : stage)));
  };

  const handleAddCondition = (order: number): void => {
    const key = (draftKey[order] ?? "").trim();
    if (!key) return;
    const rawValue = (draftValue[order] ?? "").trim();
    let expected: unknown = rawValue;
    if (rawValue) {
      try {
        expected = JSON.parse(rawValue) as unknown;
      } catch {
        expected = rawValue;
      }
    }
    const next: BaselineConditionInput = { key, expected };
    onChange(
      ordered.map((stage) =>
        stage.order === order ? { ...stage, conditions: [...stage.conditions, next] } : stage,
      ),
    );
    setDraftKey((previous) => ({ ...previous, [order]: "" }));
    setDraftValue((previous) => ({ ...previous, [order]: "" }));
  };

  const handleRemoveCondition = (order: number, key: string): void => {
    onChange(
      ordered.map((stage) =>
        stage.order === order
          ? { ...stage, conditions: stage.conditions.filter((condition) => condition.key !== key) }
          : stage,
      ),
    );
  };

  return (
    <div style={containerStyle} data-testid="stage-editor">
      {ordered.map((stage) => (
        <div key={stage.order} style={stageCardStyle} data-testid={`stage-${stage.order}`}>
          <div style={stageHeaderStyle}>
            <h3 style={stageTitleStyle}>Stage {stage.order + 1}</h3>
            <span style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
              {/* v1 offers `and`-only logic (§9): a fixed badge, never a selector. */}
              <span style={logicBadgeStyle} data-testid={`stage-logic-${stage.order}`}>
                logic: and
              </span>
              <select
                style={selectStyle}
                aria-label={`Stage ${stage.order + 1} action`}
                data-testid={`stage-action-${stage.order}`}
                value={stage.action}
                onChange={(event) => handleAction(stage.order, event.target.value as BaselineStageAction)}
              >
                <option value="report">Report</option>
                <option value="remediate">Remediate</option>
              </select>
              <button
                type="button"
                style={smallButtonStyle}
                data-testid={`stage-remove-${stage.order}`}
                onClick={() => handleRemoveStage(stage.order)}
              >
                Remove stage
              </button>
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {stage.conditions.map((condition) => (
              <div key={condition.key} style={conditionRowStyle} data-testid={`condition-${stage.order}-${condition.key}`}>
                <code style={monoStyle}>{condition.key}</code>
                <button
                  type="button"
                  style={smallButtonStyle}
                  data-testid={`condition-remove-${stage.order}-${condition.key}`}
                  onClick={() => handleRemoveCondition(stage.order, condition.key)}
                >
                  Remove
                </button>
              </div>
            ))}
            {stage.conditions.length === 0 && (
              <span style={{ fontSize: "13px", color: "var(--text-soft)" }}>No standards staged yet.</span>
            )}
          </div>

          <div style={conditionRowStyle}>
            <input
              style={{ ...inputStyle, ...monoStyle }}
              aria-label={`Stage ${stage.order + 1} standard key`}
              data-testid={`condition-key-${stage.order}`}
              placeholder="Standard key…"
              value={draftKey[stage.order] ?? ""}
              onChange={(event) => setDraftKey((previous) => ({ ...previous, [stage.order]: event.target.value }))}
            />
            <input
              style={{ ...inputStyle, ...monoStyle }}
              aria-label={`Stage ${stage.order + 1} expected value`}
              data-testid={`condition-value-${stage.order}`}
              placeholder='Expected (JSON)…'
              value={draftValue[stage.order] ?? ""}
              onChange={(event) => setDraftValue((previous) => ({ ...previous, [stage.order]: event.target.value }))}
            />
            <button
              type="button"
              style={smallButtonStyle}
              data-testid={`condition-add-${stage.order}`}
              onClick={() => handleAddCondition(stage.order)}
            >
              Add standard
            </button>
          </div>
        </div>
      ))}

      <div>
        <button type="button" style={buttonStyle} data-testid="stage-add" onClick={handleAddStage}>
          Add stage
        </button>
      </div>
    </div>
  );
}
