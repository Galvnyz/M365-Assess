import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RemediationOutputError, remediationPlanFromWorkerOutput } from "./remediation-import.js";

// Written by plan-remediation.ps1 for the findings in assessment-bridge.json.
const FIXTURE = readFileSync(fileURLToPath(new URL("./fixtures/remediation-plan.json", import.meta.url)), "utf8");
const target = { planId: "plan-9", tenantId: "t-a", runId: "run-1", createdBy: "user-1" };

describe("remediation plans from the plan worker (T-0836)", () => {
  it("maps the plan, its actions, and its manual instructions", () => {
    const { plan, instructions } = remediationPlanFromWorkerOutput(FIXTURE, target);
    expect(plan).toMatchObject({
      id: "plan-9",
      tenantId: "t-a",
      runId: "run-1",
      findingIds: ["run-1:0", "run-1:2", "run-1:3"],
      mode: "mixed",
      createdBy: "user-1",
      createdAt: "2026-09-27T16:35:33.6948380Z",
    });
    expect(plan.actions).toHaveLength(3);
    expect(plan.actions![1]).toEqual({
      id: "fdc28ece-4625-4e7d-988a-81aeadc17be2",
      checkId: "SPO-SHARING-001.1",
      command: "Set-SPOTenant -SharingCapability ExistingExternalUserSharingOnly",
      target: null,
      state: "skipped",
      before: null,
      after: null,
      appliedAt: null,
      appliedBy: null,
      result: { registryKey: "SPO-SHARING-001", mode: "automated", gateDecision: "skipped", gateReason: "not-allowlisted" },
      error: "not-allowlisted",
      correlationId: "corr-1",
    });
    expect(instructions).toEqual([
      expect.objectContaining({ checkId: "CA-REPORTONLY-001", steps: ["Entra admin center", "Protection", "Conditional Access"] }),
    ]);
  });

  it("takes the plan's identity from the job, not the file", () => {
    const moved = FIXTURE.replace('"tenantId": "t-a"', '"tenantId": "t-other"');
    expect(remediationPlanFromWorkerOutput(moved, target).plan.tenantId).toBe("t-a");
  });

  it("reads a plan with a single action or none", () => {
    const one = JSON.stringify({ Plan: { mode: "automated" }, Actions: { id: "a-1", checkId: "X-001.1", command: "c", state: "planned" }, Instructions: null });
    expect(remediationPlanFromWorkerOutput(one, target).plan.actions).toEqual([expect.objectContaining({ id: "a-1", state: "planned" })]);
    const none = JSON.stringify({ Plan: { mode: "manual" }, Actions: [], Instructions: [] });
    expect(remediationPlanFromWorkerOutput(none, target).plan.actions).toEqual([]);
  });

  it("refuses output that is not a complete plan", () => {
    expect(() => remediationPlanFromWorkerOutput("nope", target)).toThrow(RemediationOutputError);
    expect(() => remediationPlanFromWorkerOutput("{}", target)).toThrow(/no Plan/);
    expect(() => remediationPlanFromWorkerOutput('{"Plan": {"mode": "undetermined"}}', target)).toThrow(/unknown mode/);
    expect(() => remediationPlanFromWorkerOutput('{"Plan": {"mode": "manual"}, "Actions": [{"id": "a"}]}', target)).toThrow(/no id or check/);
    expect(() =>
      remediationPlanFromWorkerOutput('{"Plan": {"mode": "manual"}, "Actions": [{"id": "a", "checkId": "X", "state": "done"}]}', target),
    ).toThrow(/unknown state/);
  });
});
