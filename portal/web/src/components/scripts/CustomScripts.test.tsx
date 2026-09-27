// T-0130 — Custom Scripts UI: ScriptEditor, ScriptVersionsDrawer, page.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  ScriptEditor,
  describeDataStructure,
  renderScriptOutput,
} from "./ScriptEditor";
import { ScriptVersionsDrawer } from "./ScriptVersionsDrawer";
import CustomScriptsPage, { parseScriptOutput } from "../../app/scripts/page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const scriptRow = {
  id: "scr-1",
  name: "Inventory",
  author: "user-1",
  enabled: true,
  alertsEnabled: false,
  currentVersionId: "ver-2",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

// ─── Template rendering (mirrors T-0128) ─────────────────────────────────────

describe("renderScriptOutput", () => {
  it("renders tokens and an explicit placeholder for a missing field", () => {
    const output = { Name: "Contoso", Count: 3 };
    expect(renderScriptOutput("# {{ Name }} ({{ Count }})", output)).toBe("# Contoso (3)");
    expect(renderScriptOutput("{{ Missing }}", output)).toBe("_(missing: Missing)_");
  });

  it("repeats an {{#each}} block over a collection", () => {
    const output = { Items: [{ Name: "one" }, { Name: "two" }] };
    expect(renderScriptOutput("{{#each Items}}- {{ Name }}\n{{/each}}", output)).toBe("- one\n- two\n");
  });
});

describe("describeDataStructure", () => {
  it("lists flattened field paths and types", () => {
    const fields = describeDataStructure({ Tenant: { Id: "t1" }, Count: 2, Items: [{ Name: "x" }] });
    expect(fields).toEqual(
      expect.arrayContaining([
        { path: "Tenant.Id", type: "string" },
        { path: "Count", type: "number" },
        { path: "Items[].Name", type: "string" },
      ]),
    );
  });
});

// ─── ScriptEditor ────────────────────────────────────────────────────────────

describe("ScriptEditor", () => {
  it("creates a script, posting content and template", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ script: { id: "scr-9" }, version: { id: "ver-1" } }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const onSave = vi.fn();

    render(<ScriptEditor mode="create" fetcher={fetcher as unknown as typeof fetch} onSave={onSave} />);

    fireEvent.change(screen.getByTestId("script-name"), { target: { value: "Inventory" } });
    fireEvent.change(screen.getByTestId("script-content"), { target: { value: "Get-Thing" } });
    fireEvent.change(screen.getByTestId("script-template"), { target: { value: "# {{ Name }}" } });
    fireEvent.click(screen.getByTestId("editor-save"));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ scriptId: "scr-9", versionId: "ver-1" }));
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("/v1/scripts");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      name: "Inventory",
      content: "Get-Thing",
      markdownTemplate: "# {{ Name }}",
    });
  });

  it("appends a version when editing (never overwrites)", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: { id: "ver-3" } }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(
      <ScriptEditor
        mode="edit"
        script={{ id: "scr-1", name: "Inventory", content: "Get-Thing" }}
        fetcher={fetcher as unknown as typeof fetch}
      />,
    );
    fireEvent.click(screen.getByTestId("editor-save"));

    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        "/v1/scripts/scr-1/versions",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("shows the structure helper for valid test parameters and blocks invalid JSON", () => {
    render(<ScriptEditor mode="create" fetcher={vi.fn() as unknown as typeof fetch} />);

    fireEvent.change(screen.getByTestId("script-parameters"), {
      target: { value: JSON.stringify({ Tenant: { Id: "t1" }, Count: 2 }) },
    });
    fireEvent.click(screen.getByTestId("explore-structure"));
    const helper = screen.getByTestId("structure-helper").textContent ?? "";
    expect(helper).toContain("Tenant.Id: string");
    expect(helper).toContain("Count: number");

    fireEvent.change(screen.getByTestId("script-parameters"), { target: { value: "{not json" } });
    expect(screen.getByTestId("parameters-invalid")).toBeTruthy();
  });
});

// ─── ScriptVersionsDrawer ────────────────────────────────────────────────────

describe("ScriptVersionsDrawer", () => {
  const versions = [
    { id: "ver-2", content: "second content", createdAt: "2026-01-02T00:00:00.000Z", createdBy: "user-1", markdownTemplate: "# t" },
    { id: "ver-1", content: "first content", createdAt: "2026-01-01T00:00:00.000Z", createdBy: "user-1" },
  ];

  it("lists versions and views a past version read-only", () => {
    const { rerender } = render(
      <ScriptVersionsDrawer versions={versions} selectedVersionId={null} />,
    );
    expect(screen.getByTestId("version-ver-1")).toBeTruthy();
    expect(screen.getByTestId("version-ver-2")).toBeTruthy();

    rerender(<ScriptVersionsDrawer versions={versions} selectedVersionId="ver-1" />);
    expect(screen.getByTestId("version-content").textContent).toContain("first content");
    // No edit affordance for a historical version.
    expect(screen.queryByText(/^edit$/i)).toBeNull();
  });

  it("selects a version through the callback", () => {
    const onSelect = vi.fn();
    render(<ScriptVersionsDrawer versions={versions} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("version-ver-1"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "ver-1" }));
  });
});

// ─── Page ────────────────────────────────────────────────────────────────────

describe("CustomScriptsPage", () => {
  const detail = {
    script: scriptRow,
    currentVersion: { id: "ver-2", scriptId: "scr-1", content: "Get-Thing", markdownTemplate: "# {{ Name }}", parameters: {}, createdAt: "2026-01-02T00:00:00.000Z", createdBy: "user-1" },
  };

  function mockApi() {
    return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url === "/v1/scripts" && method === "GET") {
        return new Response(JSON.stringify({ items: [scriptRow] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url === "/v1/scripts/scr-1/versions" && method === "GET") {
        return new Response(JSON.stringify({ items: [{ id: "ver-2", content: "Get-Thing", createdAt: "2026-01-02T00:00:00.000Z", createdBy: "user-1" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url === "/v1/scripts/scr-1/run" && method === "POST") {
        return new Response(JSON.stringify({ output: '{"Name":"Contoso"}' }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url === "/v1/scripts/scr-1" && method === "GET") {
        return new Response(JSON.stringify(detail), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
    });
  }

  it("renders the table with all specified columns", async () => {
    render(<CustomScriptsPage fetcher={mockApi() as unknown as typeof fetch} tenantId="t1" />);
    await waitFor(() => expect(screen.getByTestId("script-row-scr-1")).toBeTruthy());
    const row = screen.getByTestId("script-row-scr-1");
    expect(row.textContent).toContain("Inventory");
    expect(row.textContent).toContain("PowerShell");
    expect(row.textContent).toContain("user-1");
    expect(row.textContent).toContain("Yes"); // enabled
    expect(row.textContent).toContain("No"); // alerts
  });

  it("does a dry run and renders the output via the markdown template", async () => {
    const fetcher = mockApi();
    render(<CustomScriptsPage fetcher={fetcher as unknown as typeof fetch} tenantId="t1" />);
    await waitFor(() => expect(screen.getByTestId("script-row-scr-1")).toBeTruthy());

    fireEvent.click(screen.getByTestId("run-scr-1"));

    await waitFor(() => expect(screen.getByTestId("dry-run-output")).toBeTruthy());
    expect(screen.getByTestId("dry-run-rendered").textContent).toContain("# Contoso");
    expect(fetcher).toHaveBeenCalledWith(
      "/v1/scripts/scr-1/run",
      expect.objectContaining({ method: "POST" }),
    );
    // Dry run flag is set.
    const runCall = fetcher.mock.calls.find(([url]) => url === "/v1/scripts/scr-1/run")!;
    expect(JSON.parse((runCall[1] as RequestInit).body as string)).toMatchObject({ dryRun: true, tenantId: "t1" });
  });

  it("persists enable/disable and alert toggles", async () => {
    const fetcher = mockApi();
    render(<CustomScriptsPage fetcher={fetcher as unknown as typeof fetch} tenantId="t1" />);
    await waitFor(() => expect(screen.getByTestId("script-row-scr-1")).toBeTruthy());

    fireEvent.click(screen.getByTestId("toggle-scr-1"));
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        "/v1/scripts/scr-1",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );

    fireEvent.click(screen.getByTestId("toggle-alerts-scr-1"));
    const patchCalls = fetcher.mock.calls.filter(
      ([url, init]) => url === "/v1/scripts/scr-1" && (init as RequestInit)?.method === "PATCH",
    );
    expect(patchCalls.some(([, init]) => "alertsEnabled" in JSON.parse((init as RequestInit).body as string))).toBe(true);
  });

  it("lists versions and renders Save to GitHub disabled for EPIC-039", async () => {
    const fetcher = mockApi();
    render(<CustomScriptsPage fetcher={fetcher as unknown as typeof fetch} tenantId="t1" />);
    await waitFor(() => expect(screen.getByTestId("script-row-scr-1")).toBeTruthy());

    expect((screen.getByTestId("github-scr-1") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId("versions-scr-1"));
    await waitFor(() => expect(screen.getByTestId("version-ver-2")).toBeTruthy());
  });

  it("parses sandbox output as JSON when possible", () => {
    expect(parseScriptOutput('{"a":1}')).toEqual({ a: 1 });
    expect(parseScriptOutput("plain text")).toEqual({ output: "plain text" });
    expect(parseScriptOutput("")).toEqual({});
  });
});
