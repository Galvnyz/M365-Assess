/** @vitest-environment jsdom */
// Tests for AssignmentFilterTable (T-0309).
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AssignmentFilterTable, type AssignmentFilter, type AssignmentFilterTemplate } from "./AssignmentFilterTable";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const RULE = '(device.deviceOwnership -eq "Corporate")';

const FILTERS: AssignmentFilter[] = [
  { id: "f-1", displayName: "Corporate laptops", description: "HR", platform: "windows", graphPlatform: "windows10AndLater", rule: RULE },
];
const TEMPLATES: AssignmentFilterTemplate[] = [{ id: "tpl-1", name: "iPads", platform: "ios", rule: '(device.model -startsWith "iPad")' }];
const TENANTS = [
  { id: "t-a", displayName: "Contoso" },
  { id: "t-b", displayName: "Fabrikam" },
];

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Handler = (url: string, init?: RequestInit) => Response | undefined;

/** Routes fetches to handlers; list endpoints answer by default. */
function mockApi(...handlers: Handler[]) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    for (const h of handlers) {
      const res = h(url, init);
      if (res) return res;
    }
    if (url === "/v1/tenants/t-a/intune/assignment-filters" && !init?.method) return json(200, { items: FILTERS });
    if (url === "/v1/intune-assignment-filter-templates" && !init?.method) return json(200, { items: TEMPLATES });
    throw new Error(`unexpected ${init?.method ?? "GET"} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const bodyOf = (init?: RequestInit) => JSON.parse(String(init?.body));

describe("AssignmentFilterTable — filters (T-0309)", () => {
  it("lists live filters with platform and rule", async () => {
    mockApi();
    render(<AssignmentFilterTable tenantId="t-a" tenants={TENANTS} />);
    const row = await screen.findByTestId("filter-f-1");
    expect(within(row).getByText("Windows 10 and later")).toBeDefined();
    expect(within(row).getByText(RULE)).toBeDefined();
  });

  it("creates a filter and shows structured rule errors from the server", async () => {
    const fetchMock = mockApi((url, init) => {
      if (init?.method !== "POST") return undefined;
      const body = bodyOf(init);
      if (body.rule === "bad") {
        return json(400, {
          code: "assignment_filter.invalid",
          message: "Invalid assignment filter",
          details: [{ field: "rule", reason: "expected a property such as device.deviceName", position: 0 }],
        });
      }
      return json(201, { filter: null, auditEvent: {} });
    });
    render(<AssignmentFilterTable tenantId="t-a" tenants={TENANTS} />);
    await screen.findByTestId("filter-f-1");
    fireEvent.click(screen.getByText("New filter"));
    const dialog = screen.getByRole("dialog", { name: "New assignment filter" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Surfaces" } });
    fireEvent.change(within(dialog).getByLabelText("Platform"), { target: { value: "ios" } });
    fireEvent.change(within(dialog).getByLabelText("Rule"), { target: { value: "bad" } });
    fireEvent.click(within(dialog).getByText("Save"));
    expect(await within(dialog).findByText("expected a property such as device.deviceName (at character 1)")).toBeDefined();

    fireEvent.change(within(dialog).getByLabelText("Rule"), { target: { value: RULE } });
    fireEvent.click(within(dialog).getByText("Save"));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(bodyOf(posts[1]![1])).toEqual({ displayName: "Surfaces", description: "", platform: "ios", rule: RULE });
  });

  it("edits only the changed fields with the platform locked", async () => {
    const fetchMock = mockApi((url, init) =>
      init?.method === "PATCH" ? json(200, { filter: null, auditEvent: {} }) : undefined,
    );
    render(<AssignmentFilterTable tenantId="t-a" tenants={TENANTS} />);
    await screen.findByTestId("filter-f-1");
    fireEvent.click(screen.getByLabelText("Edit Corporate laptops"));
    const dialog = screen.getByRole("dialog");
    expect((within(dialog).getByLabelText("Platform") as HTMLSelectElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Rule"), { target: { value: '(device.model -eq "X")' } });
    fireEvent.click(within(dialog).getByText("Save"));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(patch[0]).toBe("/v1/tenants/t-a/intune/assignment-filters/f-1");
    expect(bodyOf(patch[1])).toEqual({ rule: '(device.model -eq "X")' });
  });

  it("deletes with the typed confirmation name", async () => {
    const fetchMock = mockApi((url, init) => (init?.method === "DELETE" ? json(200, { filter: null, auditEvent: {} }) : undefined));
    vi.spyOn(window, "prompt").mockReturnValue("Corporate laptops");
    render(<AssignmentFilterTable tenantId="t-a" tenants={TENANTS} />);
    await screen.findByTestId("filter-f-1");
    fireEvent.click(screen.getByLabelText("Delete Corporate laptops"));
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true));
    const del = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE")!;
    expect(bodyOf(del[1])).toEqual({ confirmName: "Corporate laptops" });
  });

  it("saves a live filter as a template", async () => {
    const fetchMock = mockApi((url, init) =>
      url === "/v1/intune-assignment-filter-templates" && init?.method === "POST" ? json(201, {}) : undefined,
    );
    render(<AssignmentFilterTable tenantId="t-a" tenants={TENANTS} />);
    await screen.findByTestId("filter-f-1");
    fireEvent.click(screen.getByLabelText("Save Corporate laptops as template"));
    fireEvent.click(within(screen.getByRole("dialog")).getByText("Save"));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(bodyOf(post[1])).toEqual({ name: "Corporate laptops", platform: "windows", rule: RULE });
    expect(screen.getByRole("tab", { name: "Templates" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("AssignmentFilterTable — template deploy wizard (T-0309)", () => {
  it("previews per-target plans, then deploys with the confirmed target count", async () => {
    const fetchMock = mockApi((url, init) => {
      if (url !== "/v1/intune-assignment-filter-templates/tpl-1/deploy") return undefined;
      const body = bodyOf(init);
      if (body.preview) {
        return json(200, {
          preview: true,
          targetCount: 2,
          plans: [
            { tenantId: "t-a", action: "create", diff: ['+ rule: (device.model -startsWith "iPad")'], valid: true },
            { tenantId: "t-b", action: "update", diff: ["~ rule: 'x' -> 'y'"], valid: true },
          ],
        });
      }
      return json(207, {
        results: [
          { tenantId: "t-a", state: "succeeded" },
          { tenantId: "t-b", state: "failed", error: "Graph 403" },
        ],
      });
    });
    render(<AssignmentFilterTable tenantId="t-a" tenants={TENANTS} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Templates" }));
    fireEvent.click(await screen.findByLabelText("Deploy iPads"));
    const wizard = screen.getByRole("dialog", { name: "Deploy filter template" });
    const deploy = () => within(wizard).getByText(/^Deploy to/) as HTMLButtonElement;

    fireEvent.click(within(wizard).getByLabelText("Contoso"));
    fireEvent.click(within(wizard).getByLabelText("Fabrikam"));
    expect(within(wizard).getByTestId("deploy-target-count").textContent).toBe("Deploying to 2 tenants");
    expect(deploy().disabled).toBe(true);

    fireEvent.click(within(wizard).getByText("Preview plan"));
    expect(await within(wizard).findByText("~ rule: 'x' -> 'y'")).toBeDefined();
    expect(deploy().disabled).toBe(false);

    fireEvent.click(deploy());
    const results = await within(wizard).findByRole("region", { name: "Deploy results" });
    expect(within(results).getByTestId("filter-result-t-b").textContent).toContain("failed — Graph 403");
    const applied = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/deploy"))[1]!;
    expect(bodyOf(applied[1])).toEqual({ targets: ["t-a", "t-b"], preview: false, confirmTargetCount: 2 });
  });

  it("blocks deploy when a target plan is invalid", async () => {
    mockApi((url) =>
      url.endsWith("/deploy")
        ? json(200, { plans: [{ tenantId: "t-a", action: "none", diff: [], valid: false, issue: "platform cannot be changed" }] })
        : undefined,
    );
    render(<AssignmentFilterTable tenantId="t-a" tenants={TENANTS} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Templates" }));
    fireEvent.click(await screen.findByLabelText("Deploy iPads"));
    const wizard = screen.getByRole("dialog");
    fireEvent.click(within(wizard).getByLabelText("Contoso"));
    fireEvent.click(within(wizard).getByText("Preview plan"));
    expect(await within(wizard).findByText("platform cannot be changed")).toBeDefined();
    expect((within(wizard).getByText(/^Deploy to/) as HTMLButtonElement).disabled).toBe(true);
  });
});
