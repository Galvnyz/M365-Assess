// T-0111 — FindingRemediationPanel + ManualSteps.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  FindingRemediationPanel,
  automatedPlanToText,
  derivePreconditions,
} from "./FindingRemediationPanel.js";
import { ManualSteps, manualStepsToText, splitPortalPath } from "./ManualSteps.js";
import type {
  RemediationActionItem,
  RemediationInstruction,
} from "../../lib/remediationApi.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function action(overrides: Partial<RemediationActionItem> = {}): RemediationActionItem {
  return {
    id: "a1",
    check: "ENTRA-SECDEFAULT-001.1",
    command: "Set-EntraSecurityDefaultsState",
    target: null,
    mode: "auto",
    classification: "automated",
    state: "planned",
    license: "E3",
    finding: "Security defaults disabled",
    ...overrides,
  };
}

const instruction: RemediationInstruction = {
  check: "ENTRA-SECDEFAULT-001.1",
  found: true,
  portalPath: "Entra admin center > Properties > Manage security defaults",
  steps: ["Open the admin center", "Set Security defaults to Enabled", "Save"],
  notes: "Do not enable with CA in use.",
};

describe("FindingRemediationPanel — Automated tab", () => {
  it("renders the mono command, a status badge per precondition, and Copy plan", () => {
    const onCopyPlan = vi.fn();
    render(
      <FindingRemediationPanel
        check="ENTRA-SECDEFAULT-001.1"
        action={action()}
        instruction={instruction}
        onCopyPlan={onCopyPlan}
      />,
    );

    expect(screen.getByTestId("automated-command").textContent).toContain("Set-EntraSecurityDefaultsState");
    // One badge per precondition (License / Service / RBAC / Allowlist).
    expect(screen.getByTestId("precondition-license")).toBeTruthy();
    expect(screen.getByTestId("precondition-service")).toBeTruthy();
    expect(screen.getByTestId("precondition-rbac")).toBeTruthy();
    expect(screen.getByTestId("precondition-allowlist")).toBeTruthy();

    fireEvent.click(screen.getByTestId("copy-plan"));
    expect(onCopyPlan).toHaveBeenCalledWith(expect.stringContaining("Set-EntraSecurityDefaultsState"));
  });

  it("marks an unmet gate precondition", () => {
    const preconditions = derivePreconditions(
      action({ result: { gateReason: "not-allowlisted" } }),
    );
    const allowlist = preconditions.find((p) => p.label === "Allowlist");
    expect(allowlist?.state).toBe("unmet");
  });

  it("defaults to the Manual tab for a manual action", () => {
    render(
      <FindingRemediationPanel
        check="CA-REPORTONLY-001.2"
        action={action({ mode: "manual", classification: "manual", command: "" })}
        instruction={{ ...instruction, portalPath: "Entra > Conditional Access", steps: ["Toggle"] }}
      />,
    );
    expect(screen.getByTestId("manual-tab")).toBeTruthy();
  });
});

describe("FindingRemediationPanel — Manual tab", () => {
  it("renders the portal path breadcrumb and numbered steps", () => {
    render(
      <FindingRemediationPanel
        check="ENTRA-SECDEFAULT-001.1"
        action={action({ mode: "manual", classification: "manual" })}
        instruction={instruction}
      />,
    );

    expect(screen.getByTestId("tab-manual").getAttribute("aria-selected")).toBe("true");
    const breadcrumb = screen.getByTestId("manual-breadcrumb");
    expect(breadcrumb.textContent).toContain("Entra admin center");
    expect(screen.getByTestId("manual-step-0").textContent).toContain("Open the admin center");
    expect(screen.getByTestId("manual-step-2").textContent).toContain("Save");
  });

  it("fetches the instruction when not supplied", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(instruction), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    render(
      <FindingRemediationPanel
        check="ENTRA-SECDEFAULT-001.1"
        action={action({ mode: "manual", classification: "manual" })}
        fetcher={fetcher as unknown as typeof fetch}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("manual-step-0")).toBeTruthy());
    expect(fetcher.mock.calls[0]![0]).toBe("/v1/remediation/instructions/ENTRA-SECDEFAULT-001.1");
  });
});

describe("FindingRemediationPanel — undetermined", () => {
  it("renders the triage empty state", () => {
    render(
      <FindingRemediationPanel
        check="UNKNOWN-001"
        action={action({ classification: "undetermined", command: "", mode: "manual" })}
        instruction={{ check: "UNKNOWN-001", found: false, portalPath: null, steps: [], notes: null }}
      />,
    );
    expect(screen.getByTestId("remediation-empty-state").textContent).toContain(
      "No remediation defined — triage required.",
    );
  });
});

describe("ManualSteps", () => {
  it("renders steps and copies them as numbered text", () => {
    const onCopy = vi.fn();
    render(
      <ManualSteps
        portalPath="Entra > Properties"
        steps={["First", "Second"]}
        onCopy={onCopy}
      />,
    );
    expect(screen.getByTestId("manual-step-1").textContent).toContain("Second");
    fireEvent.click(screen.getByTestId("copy-steps"));
    expect(onCopy).toHaveBeenCalledWith("Entra > Properties\n1. First\n2. Second");
  });

  it("splits a portal path on > and arrow separators", () => {
    expect(splitPortalPath("A > B → C")).toEqual(["A", "B", "C"]);
    expect(manualStepsToText("A", ["one"])).toBe("A\n1. one");
  });
});

describe("panel text helpers", () => {
  it("renders the automated plan as text", () => {
    expect(automatedPlanToText(action())).toBe(
      "ENTRA-SECDEFAULT-001.1 (auto)\nSet-EntraSecurityDefaultsState",
    );
  });
});
