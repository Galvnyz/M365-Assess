// T-0146 — Standards templates list UI.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TemplatesTable, type StandardsTemplateItem } from "./TemplatesTable.js";
import StandardsPage from "../../app/standards/page.js";
import { standardsCount, type StandardTemplate } from "../../lib/standardsApi.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function item(overrides: Partial<StandardsTemplateItem> = {}): StandardsTemplateItem {
  return {
    id: "tpl-1",
    name: "Baseline",
    kind: "standards",
    assignedTo: ["contoso"],
    standardsCount: 3,
    schedule: null,
    lastRunAt: null,
    ...overrides,
  };
}

const noopHandlers = {
  onViewTenantReport: vi.fn(),
  onEdit: vi.fn(),
  onCloneAndEdit: vi.fn(),
  onCreateDriftClone: vi.fn(),
  onRunTemplateNow: vi.fn(),
  onSetSchedule: vi.fn(),
  onDelete: vi.fn(),
  onConvert: vi.fn(),
  onCreateTemplate: vi.fn(),
};

describe("TemplatesTable", () => {
  it("renders every §3.1 column", () => {
    render(<TemplatesTable templates={[item()]} githubEnabled={false} />);
    const row = screen.getByTestId("template-row-tpl-1");
    expect(row.textContent).toContain("Baseline");
    expect(screen.getByTestId("kind-tpl-1").textContent).toBe("Standards");
    expect(row.textContent).toContain("contoso"); // Assigned to
    expect(screen.getByTestId("count-tpl-1").textContent).toBe("3"); // Standards count
  });

  it("filters by type, assigned target, and schedule", () => {
    const templates = [
      item({ id: "a", name: "A", kind: "standards", assignedTo: ["contoso"], schedule: "0 0 3 * * *" }),
      item({ id: "b", name: "B", kind: "drift", assignedTo: ["fabrikam"], schedule: null }),
    ];
    render(<TemplatesTable templates={templates} />);

    fireEvent.change(screen.getByTestId("filter-type"), { target: { value: "drift" } });
    expect(screen.queryByTestId("template-row-a")).toBeNull();
    expect(screen.getByTestId("template-row-b")).toBeTruthy();

    fireEvent.change(screen.getByTestId("filter-type"), { target: { value: "all" } });
    fireEvent.change(screen.getByTestId("filter-assigned"), { target: { value: "contoso" } });
    expect(screen.getByTestId("template-row-a")).toBeTruthy();
    expect(screen.queryByTestId("template-row-b")).toBeNull();

    fireEvent.change(screen.getByTestId("filter-assigned"), { target: { value: "" } });
    fireEvent.change(screen.getByTestId("filter-schedule"), { target: { value: "scheduled" } });
    expect(screen.getByTestId("template-row-a")).toBeTruthy();
    expect(screen.queryByTestId("template-row-b")).toBeNull();
  });

  it("shows Save to GitHub only when the integration is enabled", () => {
    const { rerender } = render(
      <TemplatesTable templates={[item()]} githubEnabled={false} onSaveToGitHub={vi.fn()} />,
    );
    expect(screen.queryByTestId("github-tpl-1")).toBeNull();

    rerender(<TemplatesTable templates={[item()]} githubEnabled onSaveToGitHub={vi.fn()} />);
    expect(screen.getByTestId("github-tpl-1")).toBeTruthy();
  });

  it("hides Set schedule for drift templates", () => {
    const { rerender } = render(
      <TemplatesTable templates={[item({ kind: "standards" })]} onSetSchedule={vi.fn()} />,
    );
    expect(screen.getByTestId("schedule-tpl-1")).toBeTruthy();

    rerender(<TemplatesTable templates={[item({ kind: "drift" })]} onSetSchedule={vi.fn()} />);
    expect(screen.queryByTestId("schedule-tpl-1")).toBeNull();
  });

  it("hides Create drift clone for a drift template", () => {
    const { rerender } = render(
      <TemplatesTable templates={[item({ kind: "standards" })]} onCreateDriftClone={vi.fn()} />,
    );
    expect(screen.getByTestId("drift-clone-tpl-1")).toBeTruthy();

    rerender(<TemplatesTable templates={[item({ kind: "drift" })]} onCreateDriftClone={vi.fn()} />);
    expect(screen.queryByTestId("drift-clone-tpl-1")).toBeNull();
  });

  it("wires the row actions, with Run template now behind a confirm", () => {
    render(<TemplatesTable templates={[item()]} githubEnabled {...noopHandlers} />);

    fireEvent.click(screen.getByTestId("report-tpl-1"));
    expect(noopHandlers.onViewTenantReport).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("edit-tpl-1"));
    expect(noopHandlers.onEdit).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("clone-edit-tpl-1"));
    expect(noopHandlers.onCloneAndEdit).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("drift-clone-tpl-1"));
    expect(noopHandlers.onCreateDriftClone).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("schedule-tpl-1"));
    expect(noopHandlers.onSetSchedule).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("convert-tpl-1"));
    expect(noopHandlers.onConvert).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("delete-tpl-1"));
    expect(noopHandlers.onDelete).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("create-template-button"));
    expect(noopHandlers.onCreateTemplate).toHaveBeenCalled();

    // Run now confirms first.
    fireEvent.click(screen.getByTestId("run-now-tpl-1"));
    expect(noopHandlers.onRunTemplateNow).not.toHaveBeenCalled();
    expect(screen.getByTestId("run-template-confirm")).toBeTruthy();
    fireEvent.click(screen.getByTestId("run-template-confirm-button"));
    expect(noopHandlers.onRunTemplateNow).toHaveBeenCalledWith(expect.objectContaining({ id: "tpl-1" }));
  });

  it("uses CSS custom properties (zero hex literals)", () => {
    const { container } = render(<TemplatesTable templates={[item()]} githubEnabled {...noopHandlers} />);
    const hexPattern = /#[0-9a-fA-F]{3,6}\b/;
    const inlineStyles = container.innerHTML.match(/style="[^"]*"/g) ?? [];
    for (const styleAttr of inlineStyles) {
      expect(hexPattern.test(styleAttr), `Hex literal found in: ${styleAttr}`).toBe(false);
    }
  });

  it("shows an empty state with no templates", () => {
    render(<TemplatesTable templates={[]} />);
    expect(screen.getByTestId("empty-templates-state")).toBeTruthy();
  });
});

describe("standardsApi helpers", () => {
  it("posts a clone and returns the new template", async () => {
    const cloned = {
      id: "tpl-2",
      name: "Baseline (copy)",
      kind: "standards",
      actions: { report: true, alert: true, remediate: false },
      autoRemediate: false,
      settings: [],
      scheduleId: null,
    };
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ template: cloned }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { cloneStandardTemplate } = await import("../../lib/standardsApi.js");
    const clone = await cloneStandardTemplate("tpl-1", { includeAssignments: true }, fetcher as unknown as typeof fetch);
    expect(clone.id).toBe("tpl-2");
    expect(fetcher).toHaveBeenCalledWith(
      "/v1/standards/templates/tpl-1/clone",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("counts standards from settings", () => {
    const template: StandardTemplate = {
      id: "t",
      name: "T",
      kind: "standards",
      actions: { report: true, alert: true, remediate: false },
      autoRemediate: false,
      settings: [{ key: "a", value: 1 }, { key: "b", value: 2 }],
      scheduleId: null,
    };
    expect(standardsCount(template)).toBe(2);
  });
});

describe("StandardsPage", () => {
  const apiTemplate = {
    id: "tpl-1",
    name: "Baseline",
    kind: "standards",
    actions: { report: true, alert: true, remediate: false },
    autoRemediate: false,
    settings: [{ key: "ENTRA-SECDEFAULT-001", value: "enabled" }],
    scheduleId: null,
  };

  function mockApi() {
    return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url.startsWith("/v1/standards/templates") && method === "GET") {
        return new Response(JSON.stringify({ items: [apiTemplate] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ template: apiTemplate }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
  }

  it("loads and renders templates", async () => {
    render(<StandardsPage fetcher={mockApi() as unknown as typeof fetch} />);
    await waitFor(() => expect(screen.getByTestId("template-row-tpl-1")).toBeTruthy());
    expect(screen.getByTestId("standards-page")).toBeTruthy();
    expect(screen.getByTestId("count-tpl-1").textContent).toBe("1");
  });

  it("converts and deletes against the API", async () => {
    const fetcher = mockApi();
    render(<StandardsPage fetcher={fetcher as unknown as typeof fetch} />);
    await waitFor(() => expect(screen.getByTestId("template-row-tpl-1")).toBeTruthy());

    // Clone & edit navigates (jsdom cannot), so its endpoint is covered by the
    // cloneStandardTemplate client test below.
    fireEvent.click(screen.getByTestId("convert-tpl-1"));
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        "/v1/standards/templates/tpl-1",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );

    fireEvent.click(screen.getByTestId("delete-tpl-1"));
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        "/v1/standards/templates/tpl-1",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });

  it("runs a template now against the SPEC §6 run path", async () => {
    const fetcher = mockApi();
    render(<StandardsPage fetcher={fetcher as unknown as typeof fetch} tenantId="contoso" />);
    await waitFor(() => expect(screen.getByTestId("template-row-tpl-1")).toBeTruthy());

    fireEvent.click(screen.getByTestId("run-now-tpl-1"));
    fireEvent.click(screen.getByTestId("run-template-confirm-button"));

    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        "/v1/standards/templates/tpl-1/run",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});
