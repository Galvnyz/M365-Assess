// T-0112 — Remediation plan page + RemediationPlanTable.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RemediationPlanTable } from "./RemediationPlanTable.js";
import RemediationPage from "../../app/remediation/page.js";
import {
  computeKpis,
  exportPlan,
  isActionEligible,
  type RemediationActionItem,
  type RemediationPlanResponse,
  waitForRemediationPlan,
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
    severity: "High",
    collector: "ENTRA",
    license: "E3",
    finding: "Security defaults disabled",
    before: { enabled: false },
    after: null,
    ...overrides,
  };
}

function plan(actions: RemediationActionItem[]): RemediationPlanResponse {
  return {
    plan: {
      id: "plan-1",
      tenantId: "t1",
      runId: "run-1",
      findingIds: actions.map((a) => a.id),
      mode: "mixed",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "user-1",
    },
    actions,
  };
}

describe("RemediationPlanTable", () => {
  const sample = plan([
    action({ id: "auto-1", mode: "auto", state: "planned", severity: "High", collector: "ENTRA" }),
    action({ id: "manual-1", check: "CA-REPORTONLY-001.2", mode: "manual", classification: "manual", state: "skipped", severity: "Medium", collector: "CA", target: "entra/conditional-access", command: "" }),
  ]);

  it("renders the KPI strip and the full table from a plan", () => {
    render(<RemediationPlanTable plan={sample} canApply />);

    expect(screen.getByTestId("kpi-total").textContent).toBe("2");
    expect(screen.getByTestId("kpi-automated").textContent).toBe("1");
    expect(screen.getByTestId("kpi-manual").textContent).toBe("1");
    expect(screen.getByTestId("kpi-gated").textContent).toBe("1");

    expect(screen.getByTestId("plan-row-auto-1")).toBeTruthy();
    expect(screen.getByTestId("plan-row-manual-1")).toBeTruthy();
    expect(screen.getByTestId("check-auto-1").textContent).toBe("ENTRA-SECDEFAULT-001.1");
  });

  it("narrows rows with the mode, state, and eligible-only filters", () => {
    render(<RemediationPlanTable plan={sample} canApply />);

    fireEvent.change(screen.getByTestId("filter-mode"), { target: { value: "manual" } });
    expect(screen.queryByTestId("plan-row-auto-1")).toBeNull();
    expect(screen.getByTestId("plan-row-manual-1")).toBeTruthy();

    fireEvent.change(screen.getByTestId("filter-mode"), { target: { value: "all" } });
    fireEvent.change(screen.getByTestId("filter-state"), { target: { value: "planned" } });
    expect(screen.getByTestId("plan-row-auto-1")).toBeTruthy();
    expect(screen.queryByTestId("plan-row-manual-1")).toBeNull();

    fireEvent.change(screen.getByTestId("filter-state"), { target: { value: "all" } });
    fireEvent.click(screen.getByTestId("filter-eligible-only"));
    expect(screen.getByTestId("plan-row-auto-1")).toBeTruthy();
    expect(screen.queryByTestId("plan-row-manual-1")).toBeNull();
  });

  it("enables Apply only for planned actions when the caller holds remediation.apply", () => {
    const onApply = vi.fn();
    const { rerender } = render(
      <RemediationPlanTable plan={sample} canApply onApply={onApply} />,
    );
    // Planned auto action: enabled. Skipped manual action: disabled.
    expect((screen.getByTestId("action-apply-auto-1") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("action-apply-manual-1") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId("action-apply-auto-1"));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ id: "auto-1" }));

    // Without the permission, every Apply is disabled.
    rerender(<RemediationPlanTable plan={sample} canApply={false} onApply={onApply} />);
    expect((screen.getByTestId("action-apply-auto-1") as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens the detail drawer with command and before/after", () => {
    render(<RemediationPlanTable plan={sample} canApply />);
    fireEvent.click(screen.getByTestId("action-view-auto-1"));
    const drawer = screen.getByTestId("plan-detail-drawer");
    expect(drawer.textContent).toContain("Set-EntraSecurityDefaultsState");
    expect(drawer.textContent).toContain("enabled");
  });

  it("uses CSS custom properties (zero hex literals)", () => {
    const { container } = render(<RemediationPlanTable plan={sample} canApply />);
    const hexPattern = /#[0-9a-fA-F]{3,6}\b/;
    const inlineStyles = container.innerHTML.match(/style="[^"]*"/g) ?? [];
    for (const styleAttr of inlineStyles) {
      expect(hexPattern.test(styleAttr), `Hex literal found in: ${styleAttr}`).toBe(false);
    }
  });
});

describe("remediationApi helpers", () => {
  it("computes KPIs and eligibility", () => {
    const actions = [
      action({ id: "1", mode: "auto", state: "planned" }),
      action({ id: "2", mode: "manual", state: "skipped" }),
      action({ id: "3", mode: "manual", state: "planned", classification: "undetermined" }),
    ];
    expect(computeKpis(actions)).toEqual({ total: 3, automated: 1, manual: 2, gated: 1 });
    expect(isActionEligible(actions[0]!)).toBe(true);
    expect(isActionEligible(actions[2]!)).toBe(false);
  });

  it("exports a plan to JSON, Markdown, and CSV", () => {
    const p = plan([action({ id: "a1", finding: "Finding, with comma", severity: "High" })]);

    const json = exportPlan(p, "json");
    expect(JSON.parse(json).plan.id).toBe("plan-1");

    const md = exportPlan(p, "md");
    expect(md).toContain("# Remediation Plan — plan-1");
    expect(md).toContain("ENTRA-SECDEFAULT-001.1");

    const csv = exportPlan(p, "csv");
    expect(csv.split("\n")[0]).toBe("checkId,finding,severity,mode,state,license,target,command");
    // Comma-containing cells are quoted.
    expect(csv).toContain('"Finding, with comma"');
  });
});

describe("waitForRemediationPlan (T-0836)", () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const noSleep = async () => undefined;

  it("polls until the plan job has stored the plan", async () => {
    const responses = [json({ message: "not found" }, 404), json({ message: "not found" }, 404), json(plan([action()]))];
    const fetcher = vi.fn().mockImplementation(async () => responses.shift());
    const result = await waitForRemediationPlan("plan-1", fetcher as unknown as typeof fetch, { sleep: noSleep });
    expect(result.plan.id).toBe("plan-1");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("gives up after the attempts and surfaces other errors at once", async () => {
    const missing = vi.fn().mockImplementation(async () => json({ message: "not found" }, 404));
    await expect(
      waitForRemediationPlan("plan-1", missing as unknown as typeof fetch, { attempts: 2, sleep: noSleep }),
    ).rejects.toThrow(/still being generated/);
    expect(missing).toHaveBeenCalledTimes(2);

    const denied = vi.fn().mockImplementation(async () => json({ message: "forbidden" }, 403));
    await expect(waitForRemediationPlan("plan-1", denied as unknown as typeof fetch, { sleep: noSleep })).rejects.toThrow(/403/);
    expect(denied).toHaveBeenCalledTimes(1);
  });
});

describe("RemediationPage", () => {
  it("loads a plan and wires Generate plan + Export to the API", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/v1/remediation/plans" && init?.method === "POST") {
        return new Response(JSON.stringify({ planId: "plan-9", jobId: "job-9", status: "queued" }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/v1/remediation/plans/plan-1") {
        return new Response(JSON.stringify(plan([action()])), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(plan([action()])), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    render(
      <RemediationPage
        tenantId="t1"
        planId="plan-1"
        canApply
        fetcher={mockFetch as unknown as typeof fetch}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("plan-row-a1")).toBeTruthy();
    });
    expect(screen.getByTestId("remediation-page").textContent).toContain("Remediation Plan — t1");

    // Export buttons exist for every format.
    expect(screen.getByTestId("export-json")).toBeTruthy();
    expect(screen.getByTestId("export-md")).toBeTruthy();
    expect(screen.getByTestId("export-csv")).toBeTruthy();

    // Generate plan POSTs to the API.
    fireEvent.click(screen.getByTestId("generate-plan-button"));
    await waitFor(() => {
      const post = mockFetch.mock.calls.find(
        ([url, init]) => url === "/v1/remediation/plans" && (init as RequestInit)?.method === "POST",
      );
      expect(post).toBeTruthy();
    });
  });

  it("downloads an export without throwing", async () => {
    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(plan([action()])), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(
      <RemediationPage
        tenantId="t1"
        planId="plan-1"
        fetcher={mockFetch as unknown as typeof fetch}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("plan-row-a1")).toBeTruthy());
    fireEvent.click(screen.getByTestId("export-csv"));

    expect(createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
  });
});
