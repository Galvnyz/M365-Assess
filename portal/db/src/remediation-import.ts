// Remediation plans from the plan worker's output, `remediation-plan.json` (T-0836).
//
// plan-remediation.ps1 writes New-RemediationPlan's result: { Plan, Actions,
// Instructions, Summary }. This module validates it and returns the rows to store. It
// lives here rather than in the BFF, which must not read check-level output itself.
import type {
  ManualInstructionInput,
  RemediationActionInput,
  RemediationActionState,
  RemediationPlanInput,
  RemediationPlanMode,
} from "./repository.js";

export class RemediationOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemediationOutputError";
  }
}

export interface ImportedRemediationPlan {
  readonly plan: RemediationPlanInput;
  readonly instructions: ManualInstructionInput[];
}

const PLAN_MODES: ReadonlySet<string> = new Set<RemediationPlanMode>(["manual", "automated", "mixed"]);
const ACTION_STATES: ReadonlySet<string> = new Set<RemediationActionState>(["planned", "approved", "applied", "failed", "skipped"]);

type Json = Record<string, unknown>;

function record(value: unknown): Json {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {};
}

// ConvertTo-Json writes a one-item array as the bare item, and an empty one as null.
function list(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function jsonObject(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null;
}

/**
 * Parses the plan worker's output. The plan id, tenant, run, and author come from the
 * job the portal enqueued, not the file, so a worker cannot store a plan elsewhere.
 */
export function remediationPlanFromWorkerOutput(
  json: string,
  target: { readonly planId: string; readonly tenantId: string; readonly runId: string; readonly createdBy: string },
): ImportedRemediationPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json.replace(/^﻿/, ""));
  } catch (error) {
    throw new RemediationOutputError(`remediation plan output is not valid JSON: ${(error as Error).message}`);
  }
  const output = record(parsed);
  const plan = jsonObject(output["Plan"]);
  if (!plan) throw new RemediationOutputError("remediation plan output has no Plan");

  const mode = plan["mode"];
  if (typeof mode !== "string" || !PLAN_MODES.has(mode)) {
    throw new RemediationOutputError(`remediation plan has unknown mode ${JSON.stringify(mode)}`);
  }

  const actions = list(output["Actions"]).map((raw, index): RemediationActionInput => {
    const action = record(raw);
    const id = optionalString(action["id"]);
    const check = optionalString(action["checkId"]);
    if (!id || !check) throw new RemediationOutputError(`remediation action ${index} has no id or check`);
    const state = action["state"] ?? "planned";
    if (typeof state !== "string" || !ACTION_STATES.has(state)) {
      throw new RemediationOutputError(`remediation action ${id} has unknown state ${JSON.stringify(state)}`);
    }
    return {
      id,
      checkId: check,
      command: typeof action["command"] === "string" ? action["command"] : "",
      target: optionalString(action["target"]),
      state: state as RemediationActionState,
      before: jsonObject(action["before"]),
      after: jsonObject(action["after"]),
      appliedAt: optionalString(action["appliedAt"]),
      appliedBy: optionalString(action["appliedBy"]),
      result: jsonObject(action["result"]),
      error: optionalString(action["error"]),
      correlationId: optionalString(action["correlationId"]),
    };
  });

  const instructions = list(output["Instructions"]).flatMap((raw): ManualInstructionInput[] => {
    const instruction = record(raw);
    const check = optionalString(instruction["checkId"]);
    if (!check) return [];
    return [
      {
        checkId: check,
        portalPath: typeof instruction["portalPath"] === "string" ? instruction["portalPath"] : "",
        steps: list(instruction["steps"]).filter((s): s is string => typeof s === "string"),
        notes: optionalString(instruction["notes"]),
      },
    ];
  });

  return {
    plan: {
      id: target.planId,
      tenantId: target.tenantId,
      runId: target.runId,
      findingIds: list(plan["findingIds"]).filter((f): f is string => typeof f === "string"),
      mode: mode as RemediationPlanMode,
      createdBy: target.createdBy,
      ...(typeof plan["createdAt"] === "string" ? { createdAt: plan["createdAt"] } : {}),
      actions,
    },
    instructions,
  };
}
