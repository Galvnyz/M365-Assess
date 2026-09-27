// T-0168 — Manage Drift UI and triage dialogs.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import DriftPage from "../../app/drift/page";
import { DriftTable } from "./DriftTable";
import { DRIFT_DENY_WARNING, type DriftDeviation } from "../../lib/driftApi";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function deviation(overrides: Partial<DriftDeviation> = {}): DriftDeviation {
  return {
    id: "d1",
    tenantId: "contoso",
    standardKey: "CA-REPORTONLY-001",
    resourceId: "policy-1",
    kind: "mismatch",
    current: { state: "enabledForReportingButNotEnforced" },
    expected: { state: "enabled" },
    state: "open",
    reason: null,
    expiresOn: null,
    autoRemediateOnExpiry: false,
    overrideValue: null,
    lastSeenAt: "2026-09-26T00:00:00Z",
    ...overrides,
  };
}

const driftPayload = {
  tenantId: "contoso",
  breakdown: {
    open: 1,
    accepted: 0,
    customerSpecific: 0,
    denied: 0,
    deletePending: 0,
    resolved: 0,
    total: 1,
  },
  items: [deviation()],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Stub fetcher recording every call; serves the drift read plus triage/bulk writes. */
function stubFetcher() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    if (url.startsWith("/v1/drift/contoso") && (!init || !init.method || init.method === "GET")) {
      return jsonResponse(driftPayload);
    }
    if (url === "/v1/drift/bulk") {
      return jsonResponse({ tenantId: "contoso", action: "deny-delete", applied: [], skipped: [] });
    }
    if (url.includes("/deny")) {
      return jsonResponse({ deviation: deviation({ state: "denied" }), deletionQueued: false }, 202);
    }
    return jsonResponse({ deviation: deviation({ state: "accepted" }) });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

function postedBody(calls: Array<{ url: string; init?: RequestInit }>, url: string): Record<string, unknown> {
  const call = calls.find((entry) => entry.url === url);
  expect(call, `expected a call to ${url}`).toBeTruthy();
  return JSON.parse(call!.init!.body as string) as Record<string, unknown>;
}

describe("DriftTable", () => {
  it("renders the breakdown, filters, table, and row drawer", () => {
    render(
      <DriftTable
        deviations={[deviation(), deviation({ id: "d2", state: "accepted", standardKey: "EXO-SHARING-001" })]}
        breakdown={driftPayload.breakdown}
        onAccept={vi.fn()}
        onOverride={vi.fn()}
        onDeny={vi.fn()}
        onBulk={vi.fn()}
      />,
    );

    // Breakdown KPI strip by state.
    expect(screen.getByTestId("drift-kpi-strip").textContent).toContain("Open");
    expect(screen.getByTestId("drift-kpi-open").textContent).toContain("1");

    // Filters card.
    expect(screen.getByTestId("drift-filter-state")).toBeTruthy();
    expect(screen.getByTestId("drift-filter-standard")).toBeTruthy();
    expect(screen.getByTestId("drift-filter-kind")).toBeTruthy();

    // Table columns.
    expect(screen.getByTestId("drift-row-d1").textContent).toContain("CA-REPORTONLY-001");
    expect(screen.getByTestId("drift-state-d1").textContent).toBe("Open");

    // State filter hides the accepted row.
    fireEvent.change(screen.getByTestId("drift-filter-state"), { target: { value: "open" } });
    expect(screen.getByTestId("drift-row-d1")).toBeTruthy();
    expect(screen.queryByTestId("drift-row-d2")).toBeNull();

    // Row detail drawer with history fields and triage actions.
    fireEvent.click(screen.getByTestId("drift-view-d1"));
    expect(screen.getByTestId("drift-drawer").textContent).toContain("CA-REPORTONLY-001");
    expect(screen.getByTestId("drift-drawer-current").textContent).toContain("enabledForReportingButNotEnforced");
    expect(screen.getByTestId("drift-drawer-expected").textContent).toContain("enabled");
    expect(screen.getByTestId("drift-drawer-accept")).toBeTruthy();
    expect(screen.getByTestId("drift-drawer-override")).toBeTruthy();
    expect(screen.getByTestId("drift-drawer-deny")).toBeTruthy();
  });

  it("filters by standard text and resource type", () => {
    render(
      <DriftTable
        deviations={[
          deviation(),
          deviation({ id: "d2", kind: "extra", standardKey: "extra:intune", resourceId: "app-9" }),
        ]}
      />,
    );
    fireEvent.change(screen.getByTestId("drift-filter-kind"), { target: { value: "extra" } });
    expect(screen.queryByTestId("drift-row-d1")).toBeNull();
    expect(screen.getByTestId("drift-row-d2")).toBeTruthy();

    fireEvent.change(screen.getByTestId("drift-filter-kind"), { target: { value: "all" } });
    fireEvent.change(screen.getByTestId("drift-filter-standard"), { target: { value: "app-9" } });
    expect(screen.queryByTestId("drift-row-d1")).toBeNull();
    expect(screen.getByTestId("drift-row-d2")).toBeTruthy();
  });
});

describe("DriftPage triage dialogs", () => {
  it("accept dialog posts to the T-0165 accept endpoint", async () => {
    const { fetcher, calls } = stubFetcher();
    render(<DriftPage tenantId="contoso" fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByTestId("drift-row-d1")).toBeTruthy());

    fireEvent.click(screen.getByTestId("drift-accept-d1"));
    expect(screen.getByTestId("accept-dialog")).toBeTruthy();

    // Submit is blocked until reason and expiry are set.
    expect((screen.getByTestId("accept-submit") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("accept-reason"), { target: { value: "business need" } });
    fireEvent.change(screen.getByTestId("accept-expires"), { target: { value: "2026-12-31" } });
    fireEvent.click(screen.getByTestId("accept-auto-remediate"));
    fireEvent.click(screen.getByTestId("accept-submit"));

    await waitFor(() =>
      expect(calls.some((entry) => entry.url === "/v1/drift/deviations/d1/accept")).toBe(true),
    );
    expect(postedBody(calls, "/v1/drift/deviations/d1/accept")).toEqual({
      reason: "business need",
      expiresOn: "2026-12-31",
      autoRemediateOnExpiry: true,
    });
  });

  it("deny dialog shows the verbatim warning and blocks on cancel", async () => {
    const { fetcher, calls } = stubFetcher();
    render(<DriftPage tenantId="contoso" fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByTestId("drift-row-d1")).toBeTruthy());

    fireEvent.click(screen.getByTestId("drift-deny-d1"));
    expect(screen.getByTestId("deny-warning").textContent).toContain(DRIFT_DENY_WARNING);
    expect(DRIFT_DENY_WARNING).toBe(
      "DELETED from the tenant on the next remediation run; cannot be undone",
    );

    // Cancelling never submits.
    fireEvent.click(screen.getByTestId("deny-cancel"));
    expect(screen.queryByTestId("deny-dialog")).toBeNull();
    expect(calls.some((entry) => entry.url.includes("/deny"))).toBe(false);

    // Submit stays disabled until reason + explicit confirmation.
    fireEvent.click(screen.getByTestId("drift-deny-d1"));
    expect((screen.getByTestId("deny-submit") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("deny-reason"), { target: { value: "rogue policy" } });
    expect((screen.getByTestId("deny-submit") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("deny-confirm"));
    fireEvent.click(screen.getByTestId("deny-submit"));

    await waitFor(() =>
      expect(calls.some((entry) => entry.url === "/v1/drift/deviations/d1/deny")).toBe(true),
    );
    expect(postedBody(calls, "/v1/drift/deviations/d1/deny")).toEqual({
      reason: "rogue policy",
      confirm: true,
      delayDays: 0,
    });
  });

  it("override dialog pre-fills the template value", async () => {
    const { fetcher, calls } = stubFetcher();
    render(<DriftPage tenantId="contoso" fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByTestId("drift-row-d1")).toBeTruthy());

    fireEvent.click(screen.getByTestId("drift-override-d1"));
    expect(screen.getByTestId("override-dialog-copy").textContent).toContain("its own expected value");
    expect((screen.getByTestId("override-value") as HTMLTextAreaElement).value).toContain("enabled");
    fireEvent.click(screen.getByTestId("override-submit"));

    await waitFor(() =>
      expect(calls.some((entry) => entry.url === "/v1/drift/deviations/d1/override")).toBe(true),
    );
  });

  it("bulk actions submit through the T-0167 endpoint", async () => {
    const { fetcher, calls } = stubFetcher();
    render(<DriftPage tenantId="contoso" fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByTestId("drift-row-d1")).toBeTruthy());

    fireEvent.click(screen.getByTestId("drift-select-d1"));
    fireEvent.click(screen.getByTestId("drift-bulk-deny-delete"));
    expect(screen.getByTestId("bulk-warning").textContent).toContain(DRIFT_DENY_WARNING);

    fireEvent.change(screen.getByTestId("bulk-reason"), { target: { value: "cleanup" } });
    fireEvent.click(screen.getByTestId("bulk-confirm"));
    fireEvent.click(screen.getByTestId("bulk-submit"));

    await waitFor(() => expect(calls.some((entry) => entry.url === "/v1/drift/bulk")).toBe(true));
    const body = postedBody(calls, "/v1/drift/bulk");
    expect(body).toMatchObject({
      tenantId: "contoso",
      action: "deny-delete",
      deviationIds: ["d1"],
      reason: "cleanup",
      confirm: true,
    });
  });
});
