// T-0113 — ApplyActionDialog + RemediationHistoryTable + history page.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApplyActionDialog } from "./ApplyActionDialog.js";
import { RemediationHistoryTable } from "./RemediationHistoryTable.js";
import RemediationHistoryPage from "../../app/remediation/history/page.js";
import {
  formatTransition,
  type RemediationActionItem,
  type RemediationHistoryRow,
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
    ...overrides,
  };
}

describe("ApplyActionDialog", () => {
  it("lists the selected checks and target tenant", () => {
    render(
      <ApplyActionDialog
        planId="plan-1"
        tenantId="t1"
        actions={[action()]}
        fetcher={() => Promise.resolve(new Response())}
      />,
    );
    expect(screen.getByTestId("apply-check-a1").textContent).toContain("ENTRA-SECDEFAULT-001.1");
    expect(screen.getByTestId("apply-target-tenants").textContent).toContain("t1");
  });

  it("defaults dry run on and requires a reason before confirming", () => {
    render(
      <ApplyActionDialog
        planId="plan-1"
        tenantId="t1"
        actions={[action()]}
        fetcher={() => Promise.resolve(new Response())}
      />,
    );
    expect((screen.getByTestId("apply-dry-run") as HTMLInputElement).checked).toBe(true);
    // No reason yet → confirm disabled.
    expect((screen.getByTestId("apply-confirm") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("apply-reason"), { target: { value: "because" } });
    expect((screen.getByTestId("apply-confirm") as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a second count confirmation for a batch apply", () => {
    render(
      <ApplyActionDialog
        planId="plan-1"
        tenantId="t1"
        actions={[action({ id: "a1" }), action({ id: "a2", check: "CA-REPORTONLY-001" })]}
        fetcher={() => Promise.resolve(new Response())}
      />,
    );
    fireEvent.change(screen.getByTestId("apply-reason"), { target: { value: "batch" } });
    // First confirm advances to the batch step rather than submitting.
    fireEvent.click(screen.getByTestId("apply-confirm"));
    expect(screen.getByTestId("batch-confirmation").textContent).toContain("2");
    expect(screen.getByTestId("apply-confirm").textContent).toContain("Confirm batch (2)");
  });

  it("posts with an Idempotency-Key and dryRun, then renders inline results with a View audit link", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ planId: "plan-1", jobId: "job-1", dryRun: false, status: "queued" }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const onApplied = vi.fn();

    render(
      <ApplyActionDialog
        planId="plan-1"
        tenantId="t1"
        actions={[action()]}
        fetcher={fetcher as unknown as typeof fetch}
        idempotencyKeyFactory={() => "key-123"}
        onApplied={onApplied}
      />,
    );

    fireEvent.change(screen.getByTestId("apply-reason"), { target: { value: "ticket-9" } });
    fireEvent.click(screen.getByTestId("apply-dry-run")); // turn dry run off
    fireEvent.click(screen.getByTestId("apply-confirm"));

    await waitFor(() => expect(screen.getByTestId("apply-results")).toBeTruthy());

    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("/v1/remediation/plans/plan-1/apply");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("key-123");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      dryRun: false,
      reason: "ticket-9",
      actionIds: ["a1"],
    });

    expect(screen.getByTestId("apply-result-a1")).toBeTruthy();
    expect(screen.getByTestId("view-audit-a1").getAttribute("href")).toContain("/remediation/history");
    expect(onApplied).toHaveBeenCalledWith(expect.objectContaining({ jobId: "job-1" }));
  });
});

describe("RemediationHistoryTable", () => {
  const rows: RemediationHistoryRow[] = [
    {
      id: "h1",
      planId: "plan-1",
      check: "ENTRA-SECDEFAULT-001.1",
      command: "Set-EntraSecurityDefaultsState",
      target: null,
      state: "applied",
      before: { enabled: false },
      after: { enabled: true },
      timestamp: "2026-01-02T00:00:00.000Z",
      actor: "user-1",
      result: { ok: true },
      error: null,
      correlationId: "corr-1",
    },
  ];

  it("renders the append-only columns from the history endpoint", () => {
    render(<RemediationHistoryTable rows={rows} tenantId="t1" />);
    const row = screen.getByTestId("history-row-h1");
    expect(row.textContent).toContain("user-1");
    expect(row.textContent).toContain("t1");
    expect(row.textContent).toContain("ENTRA-SECDEFAULT-001.1");
    expect(row.textContent).toContain("Set-EntraSecurityDefaultsState");
    expect(row.textContent).toContain("corr-1");
  });

  it("shows an empty state with no rows", () => {
    render(<RemediationHistoryTable rows={[]} />);
    expect(screen.getByTestId("empty-history-state")).toBeTruthy();
  });

  it("formats before -> after transitions", () => {
    expect(formatTransition({ a: 1 }, { a: 2 })).toBe('a: 1 → a: 2');
    expect(formatTransition(null, null)).toBe("— → —");
  });
});

describe("RemediationHistoryPage", () => {
  it("loads history for the tenant", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "h1",
              planId: "plan-1",
              check: "ENTRA-SECDEFAULT-001",
              command: "cmd",
              target: null,
              state: "applied",
              before: null,
              after: null,
              timestamp: "2026-01-02T00:00:00.000Z",
              actor: "user-1",
              result: null,
              error: null,
              correlationId: "corr-1",
            },
          ],
          nextCursor: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(
      <RemediationHistoryPage tenantId="t1" fetcher={fetcher as unknown as typeof fetch} />,
    );

    await waitFor(() => expect(screen.getByTestId("history-row-h1")).toBeTruthy());
    expect(fetcher.mock.calls[0]![0]).toBe("/v1/remediation/history?tenantId=t1");
  });
});
