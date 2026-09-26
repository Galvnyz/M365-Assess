/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { BecReviewTab } from "./BecReviewTab";
import type { BecCheck, BecFinding } from "../../lib/offboardingApi";

afterEach(() => {
  cleanup();
});

const CHECKS: BecCheck[] = [
  {
    check: "mailboxRules",
    state: "finding",
    detail: { suspiciousRuleCount: 1 },
    evidence: [{ id: "rule-1", displayName: "Forward everything" }],
    remediation: { action: "removeInboxRule", automated: true, label: "Remove the rule", steps: [] },
  },
  {
    check: "recentUsers",
    state: "review",
    detail: { newUserCount: 2 },
    evidence: [{ userPrincipalName: "new@example.invalid" }],
    remediation: { action: "manual-review", automated: false, label: "Confirm accounts", steps: ["Confirm each new account"] },
  },
  {
    check: "sentMessages",
    state: "clear",
    detail: { sentLast24h: 1 },
    evidence: [],
    remediation: null,
  },
];

const FINDINGS: BecFinding[] = [
  {
    id: "finding-1",
    tenantId: "tenant-a",
    userId: "user-1",
    check: "mailboxRules",
    detail: {},
    state: "open",
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
  },
  {
    id: "finding-2",
    tenantId: "tenant-a",
    userId: "user-1",
    check: "recentUsers",
    detail: {},
    state: "open",
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
  },
];

describe("BecReviewTab (T-0210)", () => {
  it("renders the checks with state badges and evidence", () => {
    render(<BecReviewTab checks={CHECKS} findings={FINDINGS} />);

    expect(screen.getByTestId("bec-check-mailboxRules")).toBeTruthy();
    expect(screen.getByTestId("bec-check-recentUsers")).toBeTruthy();
    expect(screen.getByTestId("bec-check-sentMessages")).toBeTruthy();
    expect(screen.getByTestId("bec-evidence-mailboxRules").textContent).toContain("rule-1");
  });

  it("shows the empty state before any review", () => {
    render(<BecReviewTab checks={[]} />);
    expect(screen.getByTestId("bec-empty-state")).toBeTruthy();
  });

  it("runs the check on demand", () => {
    const onRunCheck = vi.fn();
    render(<BecReviewTab checks={[]} onRunCheck={onRunCheck} />);

    fireEvent.click(screen.getByTestId("bec-run-check-button"));
    expect(onRunCheck).toHaveBeenCalledTimes(1);
  });

  it("requires inline confirmation before remediating an automated finding", () => {
    const onRemediate = vi.fn();
    render(<BecReviewTab checks={CHECKS} findings={FINDINGS} onRemediate={onRemediate} />);

    fireEvent.click(screen.getByTestId("bec-remediate-finding-1"));
    expect(onRemediate).not.toHaveBeenCalled();
    expect(screen.getByTestId("bec-confirm-remediate-finding-1")).toBeTruthy();

    fireEvent.click(screen.getByTestId("bec-confirm-remediate-finding-1"));
    expect(onRemediate).toHaveBeenCalledTimes(1);
    expect(onRemediate.mock.calls[0]?.[0]).toMatchObject({ id: "finding-1" });
  });

  it("cancels the inline confirmation without remediating", () => {
    const onRemediate = vi.fn();
    render(<BecReviewTab checks={CHECKS} findings={FINDINGS} onRemediate={onRemediate} />);

    fireEvent.click(screen.getByTestId("bec-remediate-finding-1"));
    fireEvent.click(screen.getByTestId("bec-cancel-remediate-finding-1"));
    expect(onRemediate).not.toHaveBeenCalled();
    expect(screen.queryByTestId("bec-confirm-remediate-finding-1")).toBeNull();
  });

  it("exposes no remediate button for manual-only findings but shows steps", () => {
    const onRemediate = vi.fn();
    render(<BecReviewTab checks={CHECKS} findings={FINDINGS} onRemediate={onRemediate} />);

    expect(screen.queryByTestId("bec-remediate-finding-2")).toBeNull();
    expect(screen.getByText("Confirm each new account")).toBeTruthy();
  });

  it("marks a remediated finding without an open remediate path", () => {
    const remediated: BecFinding[] = [{ ...FINDINGS[0]!, state: "remediated" }];
    render(<BecReviewTab checks={CHECKS} findings={remediated} onRemediate={vi.fn()} />);

    expect(screen.queryByTestId("bec-remediate-finding-1")).toBeNull();
  });
});
