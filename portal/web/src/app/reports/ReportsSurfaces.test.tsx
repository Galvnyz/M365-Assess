// T-0089 — Report surfaces: ExecutiveReportButton, PdfPreviewDialog, /reports page
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ExecutiveReportButton from "../../components/reports/ExecutiveReportButton";
import PdfPreviewDialog from "../../components/reports/PdfPreviewDialog";
import ReportsPage from "./page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── ExecutiveReportButton ────────────────────────────────────────────────────

describe("ExecutiveReportButton", () => {
  it("renders the button", () => {
    render(<ExecutiveReportButton tenantId="t1" fetcher={() => Promise.resolve(new Response())} />);
    expect(screen.getByTestId("executive-report-btn")).toBeTruthy();
  });

  it("opens the preview dialog after requesting and polling a succeeded report", async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      callCount += 1;
      if (typeof url === "string" && url.includes("/v1/reports/executive")) {
        return new Response(JSON.stringify({ id: "rpt-1", status: "queued", artifactRef: null }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        });
      }
      // Poll — return succeeded on second call
      if (callCount >= 3) {
        return new Response(
          JSON.stringify({ items: [{ id: "rpt-1", status: "succeeded", artifactRef: "/art/report.pdf" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ items: [{ id: "rpt-1", status: "running", artifactRef: null }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    render(
      <ExecutiveReportButton
        tenantId="t1"
        fetcher={mockFetch as unknown as typeof fetch}
      />,
    );

    fireEvent.click(screen.getByTestId("executive-report-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("pdf-preview-dialog")).toBeTruthy();
    }, { timeout: 5000 });
  });

  it("uses CSS custom properties (zero hex literals in styles)", () => {
    const { container } = render(
      <ExecutiveReportButton tenantId="t1" fetcher={() => Promise.resolve(new Response())} />,
    );
    const hexPattern = /#[0-9a-fA-F]{3,6}\b/;
    const inlineStyles = container.innerHTML.match(/style="[^"]*"/g) ?? [];
    for (const styleAttr of inlineStyles) {
      expect(hexPattern.test(styleAttr), `Hex literal found in: ${styleAttr}`).toBe(false);
    }
  });
});

// ─── PdfPreviewDialog ─────────────────────────────────────────────────────────

describe("PdfPreviewDialog", () => {
  it("shows loading state when artifactRef is null and no error", () => {
    render(
      <PdfPreviewDialog
        reportId="rpt-1"
        artifactRef={null}
        error=""
        tenantId="t1"
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId("pdf-loading")).toBeTruthy();
  });

  it("shows the iframe and download link when artifactRef is present", () => {
    render(
      <PdfPreviewDialog
        reportId="rpt-1"
        artifactRef="/art/report.pdf"
        error=""
        tenantId="t1"
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId("pdf-frame")).toBeTruthy();
    expect(screen.getByTestId("pdf-download")).toBeTruthy();
    expect((screen.getByTestId("pdf-download") as HTMLAnchorElement).href).toContain("/v1/reports/rpt-1/download");
  });

  it("shows an error message when error is non-empty", () => {
    render(
      <PdfPreviewDialog
        reportId="rpt-1"
        artifactRef={null}
        error="Generation failed."
        tenantId="t1"
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId("pdf-error").textContent).toBe("Generation failed.");
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <PdfPreviewDialog
        reportId="rpt-1"
        artifactRef={null}
        error=""
        tenantId="t1"
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId("pdf-close"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ─── ReportsPage ──────────────────────────────────────────────────────────────

describe("ReportsPage", () => {
  function makeFetch(
    reportsItems: unknown[] = [],
    templatesItems: unknown[] = [],
  ) {
    return vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/v1/reports")) {
        return new Response(JSON.stringify({ items: reportsItems }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (typeof url === "string" && url.includes("/v1/report-templates")) {
        return new Response(JSON.stringify({ items: templatesItems }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
  }

  it("renders the Generated Reports tab by default", async () => {
    vi.stubGlobal("fetch", makeFetch());
    render(<ReportsPage />);
    expect(screen.getByTestId("tab-generated")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId("generated-empty")).toBeTruthy();
    });
  });

  it("lists generated reports with download links for succeeded reports", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch([
        {
          id: "rpt-1",
          templateId: "tmpl-1",
          tenantId: "t1",
          status: "succeeded",
          artifactRef: "/art/r.pdf",
          createdAt: "2026-01-01T00:00:00.000Z",
          createdBy: "user-1",
        },
      ]),
    );
    render(<ReportsPage />);
    await waitFor(() => {
      expect(screen.getByTestId("generated-row-rpt-1")).toBeTruthy();
    });
    expect(screen.getByTestId("download-rpt-1")).toBeTruthy();
  });

  it("switches to the Templates tab and lists templates with row actions", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch(
        [],
        [
          {
            id: "tmpl-1",
            name: "Monthly Security",
            tenantId: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-02-01T00:00:00.000Z",
          },
        ],
      ),
    );
    render(<ReportsPage />);

    fireEvent.click(screen.getByTestId("tab-templates"));

    await waitFor(() => {
      expect(screen.getByTestId("template-row-tmpl-1")).toBeTruthy();
    });
    expect(screen.getByTestId("edit-tmpl-1")).toBeTruthy();
    expect(screen.getByTestId("clone-tmpl-1")).toBeTruthy();
    expect(screen.getByTestId("delete-tmpl-1")).toBeTruthy();
    expect(screen.getByTestId("generate-tmpl-1")).toBeTruthy();
  });

  it("uses CSS custom properties (zero hex literals in inline styles)", async () => {
    vi.stubGlobal("fetch", makeFetch());
    const { container } = render(<ReportsPage />);
    await waitFor(() => { expect(screen.getByTestId("reports-page")).toBeTruthy(); });
    const hexPattern = /#[0-9a-fA-F]{3,6}\b/;
    const inlineStyles = container.innerHTML.match(/style="[^"]*"/g) ?? [];
    for (const styleAttr of inlineStyles) {
      // Only fail on hex colours used directly — ignore URL fragments
      if (!/href|src/.test(styleAttr)) {
        expect(hexPattern.test(styleAttr), `Hex literal found in: ${styleAttr}`).toBe(false);
      }
    }
  });
});
