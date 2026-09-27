/** @vitest-environment jsdom */
// Tests for PolicyCompareView (T-0310).
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PolicyCompareView, formatValue, type PolicyCompareResult } from "./PolicyCompareView";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const RESULT: PolicyCompareResult = {
  left: { ref: "policy:compliance:p1", label: "Win Compliance", source: "policy", platform: "windows" },
  right: { ref: "template:tpl-1", label: "Baseline", source: "template", platform: "windows10" },
  kind: "compliance",
  settings: [
    { path: "bitLockerEnabled", kind: "added", right: true },
    { path: "osMinimumVersion", kind: "removed", left: "10.0.19045" },
    { path: "passwordMinimumLength", kind: "changed", left: 8, right: 14 },
  ],
  assignments: [
    { kind: "removed", assignment: { key: "groupAssignmentTarget:g1", targetType: "groupAssignmentTarget", label: "Pilot" } },
    {
      kind: "added",
      assignment: { key: "exclusionGroupAssignmentTarget:g2", targetType: "exclusionGroupAssignmentTarget", label: "Kiosks" },
    },
  ],
  summary: { added: 1, removed: 1, changed: 1, assignmentsAdded: 1, assignmentsRemoved: 1 },
  identical: false,
};

const OPTIONS = [
  { ref: "policy:compliance:p1", label: "Win Compliance" },
  { ref: "policy:compliance:p2", label: "Win Compliance (strict)" },
  { ref: "template:tpl-1", label: "Baseline" },
];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderView(initialRightRef: string | null = "template:tpl-1") {
  render(
    <PolicyCompareView
      tenantId="t-a"
      leftRef="policy:compliance:p1"
      rightOptions={OPTIONS}
      initialRightRef={initialRightRef}
    />,
  );
}

describe("PolicyCompareView (T-0310)", () => {
  it("offers the other policies and templates, excluding the policy itself", () => {
    vi.stubGlobal("fetch", vi.fn());
    renderView(null);
    const select = screen.getByLabelText("Compare with");
    const labels = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(labels).toEqual(["Choose a policy or template…", "Win Compliance (strict)", "Template: Baseline"]);
  });

  it("fetches the compare route and renders a unified diff with added/removed/changed paths", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, RESULT));
    vi.stubGlobal("fetch", fetchMock);
    renderView();
    const settings = await screen.findByRole("region", { name: "Settings differences" });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "/v1/tenants/t-a/intune/compare?left=policy%3Acompliance%3Ap1&right=template%3Atpl-1",
    );
    const items = within(settings).getAllByRole("listitem");
    expect(items.map((li) => [li.getAttribute("data-kind"), li.textContent])).toEqual([
      ["added", "+ bitLockerEnabled: true"],
      ["removed", "- osMinimumVersion: 10.0.19045"],
      ["changed", "~ passwordMinimumLength: 8 → 14"],
    ]);
    expect(screen.getByTestId("compare-summary").textContent).toContain(
      "1 added · 1 removed · 1 changed · 2 assignment difference(s)",
    );
  });

  it("renders assignment differences including exclusions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, RESULT)));
    renderView();
    const assignments = await screen.findByRole("region", { name: "Assignment differences" });
    expect(within(assignments).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "- Pilot — only on Win Compliance",
      "+ Kiosks (excluded) — only on Baseline",
    ]);
  });

  it("switches to a side-by-side table", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, RESULT)));
    renderView();
    await screen.findByRole("region", { name: "Settings differences" });
    fireEvent.click(screen.getByRole("button", { name: "Side by side" }));
    const table = screen.getByRole("table", { name: "Side-by-side settings diff" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell").map((c) => c.textContent))).toEqual([
      ["bitLockerEnabled", "—", "true"],
      ["osMinimumVersion", "10.0.19045", "—"],
      ["passwordMinimumLength", "8", "14"],
    ]);
  });

  it("reports identical objects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json(200, {
          ...RESULT,
          settings: [],
          assignments: [],
          identical: true,
          summary: { added: 0, removed: 0, changed: 0, assignmentsAdded: 0, assignmentsRemoved: 0 },
        }),
      ),
    );
    renderView();
    expect(await screen.findByText("Settings match.")).toBeDefined();
    expect(screen.getByText("Assignments match.")).toBeDefined();
    expect(screen.getByTestId("compare-summary").textContent).toContain("No differences");
  });

  it("shows the server's message, e.g. the deferred cross-tenant compare", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json(501, { code: "intune.compare.cross_tenant_deferred", message: "Cross-tenant compare is not supported in v1" }),
      ),
    );
    renderView();
    expect((await screen.findByRole("alert")).textContent).toBe("Cross-tenant compare is not supported in v1");
  });

  it("is read-only: its only controls are the comparison picker and the layout toggle", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, RESULT)));
    renderView();
    await screen.findByRole("region", { name: "Settings differences" });
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Unified", "Side by side"]);
  });

  it("formats values compactly", () => {
    expect(formatValue("x")).toBe("x");
    expect(formatValue({ a: [1] })).toBe('{"a":[1]}');
    expect(formatValue(undefined)).toBe("");
  });
});
