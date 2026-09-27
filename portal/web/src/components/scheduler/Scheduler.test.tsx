// T-0129 — Scheduler UI: ScheduledTasksTable, SystemTimersCard, list page, task detail.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  ScheduledTasksTable,
  describeCronExpression,
  formatTarget,
  type ScheduledTaskItem,
} from "./ScheduledTasksTable";
import { SystemTimersCard } from "./SystemTimersCard";
import SchedulerPage from "../../app/scheduler/page";
import TaskDetailPage from "../../app/scheduler/[id]/page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function task(overrides: Partial<ScheduledTaskItem> = {}): ScheduledTaskItem {
  return {
    id: "s1",
    name: "Nightly assessment",
    type: "assessment",
    cron: "0 0 3 * * *",
    timezone: "UTC",
    targetScope: { type: "tenant", id: "contoso" },
    command: "Invoke-M365Assessment",
    parameters: { sections: ["Entra"] },
    enabled: true,
    isSystem: false,
    lastRunAt: "2026-01-01T03:00:00.000Z",
    nextRunAt: "2026-01-02T03:00:00.000Z",
    ...overrides,
  };
}

// ─── Cron description ────────────────────────────────────────────────────────

describe("describeCronExpression", () => {
  it("describes the portal's 6-field schedules", () => {
    expect(describeCronExpression("0 0 */12 * * *")).toBe("Every 12 hours");
    expect(describeCronExpression("0 15 */12 * * *")).toBe("Every 12 hours at :15");
    expect(describeCronExpression("0 */15 * * * *")).toBe("Every 15 minutes");
    expect(describeCronExpression("0 0 3 * * *")).toBe("Daily at 03:00");
    expect(describeCronExpression("0 0 * * * *")).toBe("Hourly");
  });

  it("falls back to the raw expression for unrecognised shapes", () => {
    expect(describeCronExpression("not a cron")).toBe("not a cron");
    expect(describeCronExpression("")).toBe("—");
  });
});

// ─── ScheduledTasksTable ─────────────────────────────────────────────────────

describe("ScheduledTasksTable", () => {
  it("renders all specified columns", () => {
    render(<ScheduledTasksTable tasks={[task()]} />);
    const row = screen.getByTestId("task-row-s1");
    expect(row.textContent).toContain("Nightly assessment");
    expect(row.textContent).toContain("Tenant: contoso");
    expect(row.textContent).toContain("Invoke-M365Assessment");
    expect(row.textContent).toContain("Daily at 03:00");
    expect(row.textContent).toContain("Completed");
    expect(row.textContent).toContain("Yes");
  });

  it("narrows rows with the presets, type, tenant, and enabled filters", () => {
    const tasks = [
      task({ id: "s1", name: "A", state: "Running", enabled: true }),
      task({ id: "s2", name: "B", state: "Failed", enabled: false, targetScope: { type: "tenant", id: "fabrikam" }, type: "drift" }),
    ];
    render(<ScheduledTasksTable tasks={tasks} />);

    fireEvent.click(screen.getByTestId("preset-running"));
    expect(screen.getByTestId("task-row-s1")).toBeTruthy();
    expect(screen.queryByTestId("task-row-s2")).toBeNull();

    fireEvent.click(screen.getByTestId("preset-all"));
    fireEvent.change(screen.getByTestId("filter-type"), { target: { value: "drift" } });
    expect(screen.queryByTestId("task-row-s1")).toBeNull();
    expect(screen.getByTestId("task-row-s2")).toBeTruthy();

    fireEvent.change(screen.getByTestId("filter-type"), { target: { value: "all" } });
    fireEvent.change(screen.getByTestId("filter-enabled"), { target: { value: "enabled" } });
    expect(screen.getByTestId("task-row-s1")).toBeTruthy();
    expect(screen.queryByTestId("task-row-s2")).toBeNull();

    fireEvent.change(screen.getByTestId("filter-enabled"), { target: { value: "all" } });
    fireEvent.change(screen.getByTestId("filter-tenant"), { target: { value: "fab" } });
    expect(screen.queryByTestId("task-row-s1")).toBeNull();
    expect(screen.getByTestId("task-row-s2")).toBeTruthy();
  });

  it("wires the row actions, with Run now gated behind a confirmation", () => {
    const onViewTask = vi.fn();
    const onEdit = vi.fn();
    const onRunNow = vi.fn();
    const onToggleEnabled = vi.fn();
    const onClone = vi.fn();
    const onDelete = vi.fn();
    const onAddTask = vi.fn();

    render(
      <ScheduledTasksTable
        tasks={[task()]}
        onViewTask={onViewTask}
        onEdit={onEdit}
        onRunNow={onRunNow}
        onToggleEnabled={onToggleEnabled}
        onClone={onClone}
        onDelete={onDelete}
        onAddTask={onAddTask}
      />,
    );

    fireEvent.click(screen.getByTestId("view-s1"));
    expect(onViewTask).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("edit-s1"));
    expect(onEdit).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("toggle-s1"));
    expect(onToggleEnabled).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("clone-s1"));
    expect(onClone).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("delete-s1"));
    expect(onDelete).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("add-task-button"));
    expect(onAddTask).toHaveBeenCalled();

    // Run now requires confirmation.
    fireEvent.click(screen.getByTestId("run-now-s1"));
    expect(onRunNow).not.toHaveBeenCalled();
    expect(screen.getByTestId("run-now-confirm")).toBeTruthy();
    fireEvent.click(screen.getByTestId("run-now-confirm-button"));
    expect(onRunNow).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }));
  });

  it("disables Run now for a running task", () => {
    render(<ScheduledTasksTable tasks={[task({ state: "Running" })]} onRunNow={vi.fn()} />);
    expect((screen.getByTestId("run-now-s1") as HTMLButtonElement).disabled).toBe(true);
  });
});

// ─── SystemTimersCard ────────────────────────────────────────────────────────

describe("SystemTimersCard", () => {
  it("renders timers read-only with no edit or delete controls", () => {
    render(
      <SystemTimersCard
        timers={[{ name: "standards", cron: "0 0 */12 * * *", type: "standards", command: "Invoke-StandardsRun", nextRunAt: "2026-01-02T00:00:00.000Z" }]}
      />,
    );
    const card = screen.getByTestId("system-timers-card");
    expect(within(card).getByTestId("system-timer-standards").textContent).toContain("Every 12 hours");

    // No interactive affordances anywhere in the card: read-only by construction.
    expect(within(card).queryByRole("button")).toBeNull();
    expect(within(card).queryByRole("link")).toBeNull();
    expect(within(card).queryAllByRole("textbox")).toHaveLength(0);
  });
});

// ─── Scheduler page ──────────────────────────────────────────────────────────

describe("SchedulerPage", () => {
  const apiSchedule = {
    id: "s1",
    name: "Nightly",
    type: "assessment",
    cron: "0 0 3 * * *",
    timezone: "UTC",
    targetScope: { type: "tenant", id: "contoso" },
    command: "Invoke-M365Assessment",
    parameters: {},
    enabled: true,
    isSystem: false,
    lastRunAt: null,
    nextRunAt: "2026-01-02T03:00:00.000Z",
  };

  function mockApi() {
    return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url === "/v1/schedules" && method === "GET") {
        return new Response(JSON.stringify({ items: [apiSchedule] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url === "/v1/schedules/system") {
        return new Response(JSON.stringify({ items: [{ ...apiSchedule, id: "sys", name: "standards", isSystem: true, command: "Invoke-StandardsRun" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
    });
  }

  it("loads tasks and system timers", async () => {
    render(<SchedulerPage fetcher={mockApi() as unknown as typeof fetch} />);
    await waitFor(() => expect(screen.getByTestId("task-row-s1")).toBeTruthy());
    expect(screen.getByTestId("system-timers-card")).toBeTruthy();
    expect(screen.getByTestId("scheduler-page")).toBeTruthy();
  });

  it("calls run-now, toggle, clone, and delete against the API", async () => {
    const fetcher = mockApi();
    render(<SchedulerPage fetcher={fetcher as unknown as typeof fetch} />);
    await waitFor(() => expect(screen.getByTestId("task-row-s1")).toBeTruthy());

    // Run now (with confirmation).
    fireEvent.click(screen.getByTestId("run-now-s1"));
    fireEvent.click(screen.getByTestId("run-now-confirm-button"));
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith("/v1/schedules/s1/run-now", { method: "POST" }),
    );

    fireEvent.click(screen.getByTestId("toggle-s1"));
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        "/v1/schedules/s1",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );

    fireEvent.click(screen.getByTestId("clone-s1"));
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        "/v1/schedules",
        expect.objectContaining({ method: "POST" }),
      ),
    );

    fireEvent.click(screen.getByTestId("delete-s1"));
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith("/v1/schedules/s1", { method: "DELETE" }),
    );
  });
});

// ─── Task detail page ────────────────────────────────────────────────────────

describe("TaskDetailPage", () => {
  const detail = {
    id: "s1",
    name: "Nightly",
    type: "assessment",
    cron: "0 0 3 * * *",
    timezone: "UTC",
    targetScope: { type: "tenant", id: "contoso" },
    command: "Invoke-M365Assessment",
    parameters: { sections: ["Entra"], quickScan: false },
    enabled: true,
    lastRunAt: null,
    nextRunAt: "2026-01-02T03:00:00.000Z",
  };
  const history = {
    scheduleId: "s1",
    runs: [
      { runId: "run-1", jobId: "job-1", startedAt: "2026-01-01T03:00:00.000Z", finishedAt: "2026-01-01T03:02:30.000Z", outcome: "succeeded", error: null },
    ],
  };

  function mockFetcher() {
    return vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/history")) {
        return new Response(JSON.stringify(history), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify(detail), { status: 200, headers: { "Content-Type": "application/json" } });
    });
  }

  it("renders the Definition / History / Parameters tabs", async () => {
    render(<TaskDetailPage params={{ id: "s1" }} fetcher={mockFetcher() as unknown as typeof fetch} />);
    await waitFor(() => expect(screen.getByTestId("definition-panel")).toBeTruthy());
    expect(screen.getByTestId("definition-panel").textContent).toContain("Invoke-M365Assessment");
    expect(screen.getByTestId("definition-panel").textContent).toContain("Daily at 03:00");

    fireEvent.click(screen.getByTestId("tab-history"));
    expect(screen.getByTestId("history-run-run-1").textContent).toContain("succeeded");
    expect(screen.getByTestId("history-run-run-1").textContent).toContain("2m 30s");

    fireEvent.click(screen.getByTestId("tab-parameters"));
    expect(screen.getByTestId("parameters-json").textContent).toContain("Entra");
  });
});

// ─── helpers ─────────────────────────────────────────────────────────────────

describe("formatTarget", () => {
  it("renders all/group/tenant targets", () => {
    expect(formatTarget({ type: "all" })).toBe("All tenants");
    expect(formatTarget({ type: "group", id: "g1" })).toBe("Group: g1");
    expect(formatTarget({ type: "tenant", id: "t1" })).toBe("Tenant: t1");
    expect(formatTarget(undefined)).toBe("—");
  });
});
