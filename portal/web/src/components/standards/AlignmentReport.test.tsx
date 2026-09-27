// T-0148 — Alignment report + per-tenant standards report.
// Scope addition: covers acceptance item 1 (the three alignment views render)
// and item 3 (search + Standard Logs drawer). See the ticket scope_note.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AlignmentReport } from "./AlignmentReport";
import AlignmentPage from "../../app/standards/alignment/page";
import type {
  AlignmentAggregateRow,
  AlignmentByStandardRow,
  AlignmentSummaryRow,
} from "../../lib/standardsApi";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const summary: AlignmentSummaryRow[] = [
  {
    tenantId: "contoso",
    total: 3,
    compliant: 1,
    nonCompliant: 1,
    acceptedDeviation: 0,
    customerSpecific: 0,
    licenseMissing: 1,
    reportingDisabled: 0,
    compliantPct: 33.3,
  },
  {
    tenantId: "fabrikam",
    total: 1,
    compliant: 0,
    nonCompliant: 0,
    acceptedDeviation: 0,
    customerSpecific: 0,
    licenseMissing: 0,
    reportingDisabled: 1,
    compliantPct: 0,
  },
];

const byStandard: AlignmentByStandardRow[] = [
  { tenantId: "contoso", check: "ENTRA-PIM-001", current: { on: false }, expected: { on: true }, state: "license missing", lastRunAt: "2026-01-01T00:00:00.000Z" },
  { tenantId: "contoso", check: "ENTRA-SECDEFAULT-001", current: { on: true }, expected: { on: true }, state: "compliant", lastRunAt: "2026-01-01T00:00:00.000Z" },
];

const aggregate: AlignmentAggregateRow[] = [
  { check: "ENTRA-PIM-001", total: 1, compliant: 0, nonCompliant: 0, acceptedDeviation: 0, customerSpecific: 0, licenseMissing: 1, reportingDisabled: 0, compliantPct: 0 },
];

describe("AlignmentReport", () => {
  it("renders the three views from the API shapes", () => {
    const { rerender } = render(<AlignmentReport summary={summary} byStandard={byStandard} aggregate={aggregate} />);

    // Default summary view.
    expect(screen.getByTestId("alignment-summary")).toBeTruthy();
    expect(screen.getByTestId("summary-row-contoso").textContent).toContain("33.3%");
    // license missing and reporting disabled render as states.
    expect(screen.getByTestId("summary-row-contoso").textContent).toContain("1");
    expect(screen.getByTestId("summary-row-fabrikam").textContent).toContain("1");

    rerender(<AlignmentReport view="by-standard" summary={summary} byStandard={byStandard} aggregate={aggregate} />);
    expect(screen.getByTestId("alignment-by-standard")).toBeTruthy();
    expect(screen.getByTestId("standard-row-contoso-ENTRA-PIM-001").textContent).toContain("license missing");

    rerender(<AlignmentReport view="aggregate" summary={summary} byStandard={byStandard} aggregate={aggregate} />);
    expect(screen.getByTestId("alignment-aggregate")).toBeTruthy();
    expect(screen.getByTestId("aggregate-row-ENTRA-PIM-001")).toBeTruthy();
  });

  it("switches views through the switcher", () => {
    const onViewChange = vi.fn();
    render(<AlignmentReport summary={summary} byStandard={byStandard} aggregate={aggregate} onViewChange={onViewChange} />);
    fireEvent.click(screen.getByTestId("alignment-view-aggregate"));
    expect(onViewChange).toHaveBeenCalledWith("aggregate");
  });

  it("selects a tenant from the summary", () => {
    const onSelectTenant = vi.fn();
    render(<AlignmentReport summary={summary} onSelectTenant={onSelectTenant} />);
    fireEvent.click(screen.getByText("contoso"));
    expect(onSelectTenant).toHaveBeenCalledWith("contoso");
  });

  it("uses CSS custom properties (zero hex literals)", () => {
    const { container } = render(<AlignmentReport summary={summary} byStandard={byStandard} aggregate={aggregate} />);
    const hexPattern = /#[0-9a-fA-F]{3,6}\b/;
    const inlineStyles = container.innerHTML.match(/style="[^"]*"/g) ?? [];
    for (const styleAttr of inlineStyles) {
      expect(hexPattern.test(styleAttr), `Hex literal found in: ${styleAttr}`).toBe(false);
    }
  });
});

describe("AlignmentPage", () => {
  function mockApi() {
    return vi.fn().mockImplementation(async (url: string) => {
      if (url.startsWith("/v1/standards/alignment")) {
        const view = new URLSearchParams(url.split("?")[1] ?? "").get("view") ?? "summary";
        const items = view === "summary" ? summary : view === "aggregate" ? aggregate : byStandard;
        return new Response(JSON.stringify({ view, items }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.startsWith("/v1/standards/compare/")) {
        return new Response(
          JSON.stringify({ tenantId: "contoso", summary: summary[0], items: byStandard }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
    });
  }

  it("renders the per-tenant report with search and the Standard Logs drawer", async () => {
    render(<AlignmentPage fetcher={mockApi() as unknown as typeof fetch} tenantId="contoso" />);

    await waitFor(() => expect(screen.getByTestId("tenant-report")).toBeTruthy());
    expect(screen.getByTestId("report-row-ENTRA-PIM-001")).toBeTruthy();

    // Search narrows the list.
    fireEvent.change(screen.getByTestId("report-search"), { target: { value: "pim" } });
    expect(screen.getByTestId("report-row-ENTRA-PIM-001")).toBeTruthy();
    expect(screen.queryByTestId("report-row-ENTRA-SECDEFAULT-001")).toBeNull();
    fireEvent.change(screen.getByTestId("report-search"), { target: { value: "" } });

    // The Standard Logs drawer opens with current/expected.
    fireEvent.click(screen.getByTestId("logs-ENTRA-PIM-001"));
    const drawer = screen.getByTestId("standard-logs-drawer");
    expect(drawer.textContent).toContain("license missing");
    expect(drawer.textContent).toContain("\"on\"");
  });

  it("loads the three alignment views when no tenant is selected", async () => {
    const fetcher = mockApi();
    render(<AlignmentPage fetcher={fetcher as unknown as typeof fetch} />);
    await waitFor(() => expect(screen.getByTestId("alignment-summary")).toBeTruthy());
    const calls = fetcher.mock.calls.map(([url]) => url as string);
    expect(calls.some((u) => u.includes("view=summary"))).toBe(true);
    expect(calls.some((u) => u.includes("view=by-standard"))).toBe(true);
    expect(calls.some((u) => u.includes("view=aggregate"))).toBe(true);
  });
});
