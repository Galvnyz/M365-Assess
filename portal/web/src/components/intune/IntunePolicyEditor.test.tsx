/** @vitest-environment jsdom */
// Tests for IntunePolicyEditor, SettingsEditor, and JsonSettingsEditor (T-0304).
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { IntunePolicyEditor } from "./IntunePolicyEditor";
import { settingsSchemaFor, validateStructuredSettings } from "./SettingsEditor";
import { validatePolicyJson } from "./JsonSettingsEditor";
import type { IntunePlan, IntunePolicyItem } from "../../lib/intuneApi";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const EXISTING: IntunePolicyItem = {
  id: "pol-1",
  name: "Win Compliance",
  displayName: "Win Compliance",
  platform: "windows",
  policyType: "Compliance Policy",
  assignedToCount: 1,
  assignments: [{ id: "grp-1", target: "IT Group", targetType: "groupAssignmentTarget" }],
  lastModifiedDateTime: "2026-09-20T10:00:00Z",
  modifiedBy: "admin@contoso.com",
  settingsSummary: { passwordRequired: true, passwordMinimumLength: 8, customFlag: "keep-me" },
};

const PLAN: IntunePlan = {
  action: "create",
  kind: "compliance",
  targetName: "Baseline",
  after: {},
  beforeAssignments: [],
  afterAssignments: [{ id: "IT Group", target: "IT Group", targetType: "groupAssignmentTarget" }],
  diff: ["+ Policy created: Baseline", "+ Platform: windows"],
  valid: true,
  dryRun: true,
  requiresConfirmation: false,
};

function listPage(items: IntunePolicyItem[]) {
  return jsonResponse(200, {
    tenantId: "t-1",
    kind: "compliance",
    totalCount: items.length,
    items,
    nextCursor: null,
  });
}

describe("settings validation (T-0304)", () => {
  it("has structured schemas only for Windows configuration and compliance", () => {
    expect(settingsSchemaFor("compliance", "windows")).toBeDefined();
    expect(settingsSchemaFor("configuration", "Windows")).toBeDefined();
    expect(settingsSchemaFor("compliance", "ios")).toBeUndefined();
    expect(settingsSchemaFor("app-protection", "android")).toBeUndefined();
  });

  it("rejects out-of-range numbers, unlisted choices, and malformed versions", () => {
    const schema = settingsSchemaFor("compliance", "windows")!;
    const errors = validateStructuredSettings(schema, {
      passwordMinimumLength: 40,
      passwordRequiredType: "emoji",
      osMinimumVersion: "ten",
      passwordRequired: true,
    });
    expect(Object.keys(errors).sort()).toEqual([
      "osMinimumVersion",
      "passwordMinimumLength",
      "passwordRequiredType",
    ]);
  });

  it("validates JSON shape and @odata.type against the registry", () => {
    expect(validatePolicyJson("{", "compliance", "windows").ok).toBe(false);
    expect(validatePolicyJson("[]", "compliance", "windows").ok).toBe(false);
    expect(
      validatePolicyJson(
        '{"@odata.type":"#microsoft.graph.iosCompliancePolicy"}',
        "compliance",
        "windows",
      ).ok,
    ).toBe(false);
    expect(
      validatePolicyJson(
        '{"@odata.type":"#microsoft.graph.windows10CompliancePolicy","x":1}',
        "compliance",
        "windows",
      ),
    ).toEqual({
      ok: true,
      value: { "@odata.type": "#microsoft.graph.windows10CompliancePolicy", x: 1 },
    });
  });
});

describe("IntunePolicyEditor — create (T-0304)", () => {
  it("renders structured controls for a common type", () => {
    render(<IntunePolicyEditor kind="compliance" tenantId="t-1" policyId={null} onDone={vi.fn()} />);
    expect(screen.getByLabelText("Minimum password length")).toBeDefined();
    expect(screen.getByRole("button", { name: "Structured" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByLabelText("Policy JSON")).toBeNull();
  });

  it("blocks preview on structured validation errors without calling the API", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<IntunePolicyEditor kind="compliance" tenantId="t-1" policyId={null} onDone={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Baseline" } });
    fireEvent.change(screen.getByLabelText("Minimum password length"), { target: { value: "99" } });
    fireEvent.click(screen.getByText("Preview changes"));
    expect(screen.getByText("Must be between 4 and 16.")).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a name", () => {
    render(<IntunePolicyEditor kind="compliance" tenantId="t-1" policyId={null} onDone={vi.fn()} />);
    fireEvent.click(screen.getByText("Preview changes"));
    expect(screen.getByText("Policy name is required.")).toBeDefined();
  });

  it("previews the plan (settings diff + assignments) before applying", async () => {
    const onDone = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, PLAN))
      .mockResolvedValueOnce(jsonResponse(201, { success: true, plan: { ...PLAN, dryRun: false } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<IntunePolicyEditor kind="compliance" tenantId="t-1" policyId={null} onDone={onDone} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Baseline" } });
    fireEvent.change(screen.getByLabelText("Require BitLocker"), { target: { value: "true" } });
    fireEvent.change(screen.getByLabelText("Group to assign"), { target: { value: "IT Group" } });
    fireEvent.click(screen.getByText("Add assignment"));
    fireEvent.click(screen.getByText("Preview changes"));

    const diff = await screen.findByRole("region", { name: "Settings diff" });
    expect(within(diff).getByText("+ Policy created: Baseline")).toBeDefined();
    const assignments = screen.getByRole("region", { name: "Assignment changes" });
    expect(within(assignments).getByText("IT Group")).toBeDefined();
    expect(onDone).not.toHaveBeenCalled();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/v1/tenants/t-1/intune/compliance");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      preview: true,
      displayName: "Baseline",
      platform: "windows",
      settings: { bitLockerEnabled: true },
    });
    expect(body.policyJson).toBeUndefined();

    fireEvent.click(screen.getByText("Apply"));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).preview).toBe(false);
  });

  it("disables Apply when the plan is invalid", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { ...PLAN, valid: false })));
    render(<IntunePolicyEditor kind="compliance" tenantId="t-1" policyId={null} onDone={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Baseline" } });
    fireEvent.click(screen.getByText("Preview changes"));
    await screen.findByText(/plan is not valid/i);
    expect((screen.getByText("Apply") as HTMLButtonElement).disabled).toBe(true);
  });

  it("switches to JSON mode, validates it, and submits policyJson", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, PLAN));
    vi.stubGlobal("fetch", fetchMock);
    render(<IntunePolicyEditor kind="compliance" tenantId="t-1" policyId={null} onDone={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Baseline" } });
    fireEvent.click(screen.getByRole("button", { name: "JSON" }));

    const editor = screen.getByLabelText("Policy JSON");
    fireEvent.change(editor, { target: { value: "{ not json" } });
    fireEvent.click(screen.getByText("Preview changes"));
    expect(screen.getByText(/Invalid JSON/)).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();

    // Invalid JSON also blocks switching back to structured controls.
    fireEvent.click(screen.getByRole("button", { name: "Structured" }));
    expect(screen.getByText(/Fix the JSON before switching/)).toBeDefined();

    fireEvent.change(editor, { target: { value: '{"advancedSetting": 3}' } });
    fireEvent.click(screen.getByText("Preview changes"));
    await screen.findByRole("region", { name: "Settings diff" });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.policyJson).toBe('{"advancedSetting": 3}');
    expect(body.settings).toBeUndefined();
  });
});

describe("IntunePolicyEditor — existing policies (T-0304)", () => {
  it("loads the policy, keeps unknown settings, and PATCHes the edit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(listPage([EXISTING]))
      .mockResolvedValueOnce(jsonResponse(200, { ...PLAN, action: "edit" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<IntunePolicyEditor kind="compliance" tenantId="t-1" policyId="pol-1" onDone={vi.fn()} />);

    const name = (await screen.findByLabelText("Name")) as HTMLInputElement;
    expect(name.value).toBe("Win Compliance");
    expect((screen.getByLabelText("Minimum password length") as HTMLInputElement).value).toBe("8");
    expect(screen.getByText(/1 other setting\(s\) are kept as-is/)).toBeDefined();
    expect(screen.getByText("IT Group")).toBeDefined();

    fireEvent.change(screen.getByLabelText("Minimum password length"), { target: { value: "12" } });
    fireEvent.click(screen.getByText("Preview changes"));
    await screen.findByRole("region", { name: "Settings diff" });

    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe("/v1/tenants/t-1/intune/compliance/pol-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body).settings).toEqual({
      passwordRequired: true,
      passwordMinimumLength: 12,
      customFlag: "keep-me",
    });
  });

  it("uses JSON mode for a type with no structured schema", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(listPage([{ ...EXISTING, platform: "ios" }])),
    );
    render(<IntunePolicyEditor kind="compliance" tenantId="t-1" policyId="pol-1" onDone={vi.fn()} />);
    const editor = (await screen.findByLabelText("Policy JSON")) as HTMLTextAreaElement;
    expect(JSON.parse(editor.value)).toEqual(EXISTING.settingsSummary);
    expect(screen.queryByRole("button", { name: "Structured" })).toBeNull();
    expect(screen.getByText(/No structured editor for this type/)).toBeDefined();
  });

  it("prefills a clone as a new policy without assignments", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(listPage([EXISTING])));
    render(
      <IntunePolicyEditor
        kind="compliance"
        tenantId="t-1"
        policyId={null}
        cloneFromId="pol-1"
        onDone={vi.fn()}
      />,
    );
    const name = (await screen.findByLabelText("Name")) as HTMLInputElement;
    expect(name.value).toBe("Copy of Win Compliance");
    expect(screen.getByText("New compliance policy")).toBeDefined();
    expect(screen.getByText("Not assigned.")).toBeDefined();
  });

  it("reports a policy that cannot be found", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(listPage([])));
    render(<IntunePolicyEditor kind="compliance" tenantId="t-1" policyId="nope" onDone={vi.fn()} />);
    expect(await screen.findByText("Policy 'nope' was not found.")).toBeDefined();
  });
});
