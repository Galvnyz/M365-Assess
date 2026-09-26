// T-0170 — Executive drift report rendering.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ExecutiveDriftReport, type ExecutiveDriftReportData } from "./ExecutiveDriftReport.js";
import DriftReportPage from "../../app/drift/report/page.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function report(overrides: Partial<ExecutiveDriftReportData> = {}): ExecutiveDriftReportData {
  return {
    tenantId: "contoso",
    generatedAt: "2026-09-26T00:00:00.000Z",
    countsByState: {
      open: 4,
      accepted: 2,
      customerSpecific: 1,
      denied: 1,
      deletePending: 1,
      resolved: 3,
      total: 12,
    },
    topCategories: [
      { standardKey: "CA-REPORTONLY-001", count: 5, open: 3 },
      { standardKey: "EXO-SHARING-001", count: 4, open: 1 },
    ],
    remediation: {
      accepted: 2,
      customerSpecific: 1,
      pendingDeletion: 1,
      resolved: 3,
    },
    trend: null,
    ...overrides,
  };
}

describe("ExecutiveDriftReport", () => {
  it("renders counts by deviation state", () => {
    render(<ExecutiveDriftReport report={report()} />);
    expect(screen.getByTestId("drift-report-meta").textContent).toContain("contoso");
    expect(screen.getByTestId("drift-report-state-open").textContent).toContain("4");
    expect(screen.getByTestId("drift-report-state-accepted").textContent).toContain("2");
    expect(screen.getByTestId("drift-report-state-total").textContent).toContain("12");
  });

  it("renders top deviation categories", () => {
    render(<ExecutiveDriftReport report={report()} />);
    expect(
      screen.getByTestId("drift-report-category-CA-REPORTONLY-001").textContent,
    ).toContain("CA-REPORTONLY-001");
    expect(screen.getByTestId("drift-report-category-count-CA-REPORTONLY-001").textContent).toBe("5");
    expect(
      screen.getByTestId("drift-report-category-EXO-SHARING-001").textContent,
    ).toContain("EXO-SHARING-001");
  });

  it("renders accepted items and remediation status, and marks the trend as a follow-on", () => {
    render(<ExecutiveDriftReport report={report()} />);
    expect(screen.getByTestId("drift-report-accepted").textContent).toContain("2");
    expect(screen.getByTestId("drift-report-pending").textContent).toContain("1");
    expect(screen.getByTestId("drift-report-resolved").textContent).toContain("3");
    // The EPIC-010 trend is documented, not invented.
    expect(screen.getByTestId("drift-report-trend").textContent).toContain("EPIC-010");
  });

  it("renders loading, error, and empty states", () => {
    const { unmount } = render(<ExecutiveDriftReport report={null} loading />);
    expect(screen.getByTestId("drift-report-loading")).toBeTruthy();
    unmount();

    render(<ExecutiveDriftReport report={null} error="boom" />);
    expect(screen.getByTestId("drift-report-error").textContent).toContain("boom");
  });
});

describe("DriftReportPage", () => {
  it("loads the report route and queues the PDF through the EPIC-005 pipeline", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, init });
      if (url === "/v1/drift/contoso/report") {
        return new Response(JSON.stringify(report()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/v1/reports/render") {
        return new Response(JSON.stringify({ id: "rep-1", status: "queued" }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    }) as unknown as typeof fetch;

    render(<DriftReportPage tenantId="contoso" fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByTestId("drift-report")).toBeTruthy());
    expect(screen.getByTestId("drift-report-state-total").textContent).toContain("12");

    fireEvent.click(screen.getByTestId("drift-report-pdf"));
    await waitFor(() =>
      expect(calls.some((entry) => entry.url === "/v1/reports/render")).toBe(true),
    );
    const renderCall = calls.find((entry) => entry.url === "/v1/reports/render")!;
    const body = JSON.parse(renderCall.init!.body as string) as {
      tenantId: string;
      document: { type: string };
    };
    expect(body.tenantId).toBe("contoso");
    expect(body.document.type).toBe("drift-executive");
    expect(screen.getByTestId("drift-report-notice").textContent).toContain("rep-1");
  });
});
