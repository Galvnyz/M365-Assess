// T-0183 — baseline builder interactions.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import BaselineBuilderPage from "../../app/baselines/[id]/edit/page.js";
import { StageEditor } from "./StageEditor.js";
import { BaselineTimeline } from "./BaselineTimeline.js";
import type { BaselineStageInput } from "../../lib/baselinesApi.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stages(): BaselineStageInput[] {
  return [
    { order: 0, conditions: [{ key: "CA-REPORTONLY-001", expected: 1 }], action: "report" },
  ];
}

describe("BaselineTimeline", () => {
  it("renders the three setup steps with their states", () => {
    render(
      <BaselineTimeline
        steps={[
          { id: "name", label: "Set a baseline name", state: "done" },
          { id: "assign", label: "Assign tenants or groups", state: "current" },
          { id: "standards", label: "Add standards to at least one stage", state: "todo" },
        ]}
      />,
    );
    expect(screen.getByTestId("timeline-step-name").textContent).toContain("Set a baseline name");
    expect(screen.getByTestId("timeline-step-name").dataset.state).toBe("done");
    expect(screen.getByTestId("timeline-step-standards").dataset.state).toBe("todo");
  });
});

describe("StageEditor", () => {
  it("adds/removes stages in order and removes conditions individually", () => {
    const onChange = vi.fn();
    const { rerender } = render(<StageEditor stages={stages()} onChange={onChange} />);

    // Only `and` logic is offered: a fixed badge, no selector.
    expect(screen.getByTestId("stage-logic-0").textContent).toContain("and");
    expect(screen.queryByTestId("stage-logic-select-0")).toBeNull();

    fireEvent.click(screen.getByTestId("stage-add"));
    expect(onChange).toHaveBeenCalledWith([
      ...stages(),
      { order: 1, conditions: [], action: "report" },
    ]);

    fireEvent.click(screen.getByTestId("condition-remove-0-CA-REPORTONLY-001"));
    expect(onChange).toHaveBeenCalledWith([{ order: 0, conditions: [], action: "report" }]);

    rerender(
      <StageEditor
        stages={[...stages(), { order: 1, conditions: [], action: "report" }]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("stage-remove-1"));
    expect(onChange).toHaveBeenCalledWith(stages());
  });

  it("adds a standard with a parsed expected value", () => {
    const onChange = vi.fn();
    render(<StageEditor stages={[{ order: 0, conditions: [], action: "report" }]} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("condition-key-0"), { target: { value: "EXO-SHARING-001" } });
    fireEvent.change(screen.getByTestId("condition-value-0"), { target: { value: '{"state":"x"}' } });
    fireEvent.click(screen.getByTestId("condition-add-0"));
    expect(onChange).toHaveBeenCalledWith([
      {
        order: 0,
        conditions: [{ key: "EXO-SHARING-001", expected: { state: "x" } }],
        action: "report",
      },
    ]);
  });
});

describe("BaselineBuilderPage", () => {
  function stubFetcher() {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, init });
      if (url === "/v1/baselines" && init?.method === "POST") {
        const body = JSON.parse(init.body as string) as { name: string };
        return new Response(
          JSON.stringify({ id: "bl-1", name: body.name, stages: [], assignments: [] }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`unexpected request: ${init?.method} ${url}`);
    }) as unknown as typeof fetch;
    return { fetcher, calls };
  }

  it("gates save until name, assignment, and a staged standard exist", async () => {
    const { fetcher, calls } = stubFetcher();
    render(<BaselineBuilderPage params={{ id: "new" }} fetcher={fetcher} />);

    // All three steps start incomplete; save is disabled with a hint.
    expect((screen.getByTestId("builder-save") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("builder-save-hint")).toBeTruthy();

    fireEvent.change(screen.getByTestId("builder-name"), { target: { value: "Server baseline" } });
    expect(screen.getByTestId("timeline-step-name").dataset.state).toBe("done");
    expect((screen.getByTestId("builder-save") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByTestId("assignment-target"), { target: { value: "contoso" } });
    fireEvent.click(screen.getByTestId("assignment-add"));
    expect(screen.getByTestId("timeline-step-assign").dataset.state).toBe("done");
    expect((screen.getByTestId("builder-save") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId("stage-add"));
    fireEvent.change(screen.getByTestId("condition-key-0"), { target: { value: "A" } });
    fireEvent.change(screen.getByTestId("condition-value-0"), { target: { value: "1" } });
    fireEvent.click(screen.getByTestId("condition-add-0"));
    await waitFor(() =>
      expect(screen.getByTestId("timeline-step-standards").dataset.state).toBe("done"),
    );
    expect((screen.getByTestId("builder-save") as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByTestId("builder-save"));
    await waitFor(() => expect(calls).toHaveLength(1));
    const posted = JSON.parse(calls[0]!.init!.body as string) as Record<string, unknown>;
    expect(posted["name"]).toBe("Server baseline");
    expect(screen.getByTestId("builder-notice").textContent).toContain("saved");
  });
});
