/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { MfaReportTable } from "./MfaReportTable";
import { MfaKpiStrip } from "./MfaKpiStrip";
import { fetchMfaReport, type MfaReport, type MfaReportKpis, type MfaUserRow } from "../../lib/mfaApi";

afterEach(() => {
  cleanup();
});

const SAMPLE_KPIS: MfaReportKpis = {
  total: 3,
  registered: 2,
  notRegistered: 1,
  phishingResistant: 1,
  perMethod: {
    fido2: 1,
    microsoftAuthenticator: 2,
    sms: 1,
  },
};

const SAMPLE_ROWS: MfaUserRow[] = [
  {
    userId: "user-1",
    displayName: "Alice Admin",
    userPrincipalName: "alice@example.invalid",
    methods: ["fido2", "microsoftAuthenticator"],
    defaultMethod: "fido2",
    phishingResistant: "phishing-resistant",
    lastAuthDateTime: "2026-09-20T12:00:00Z",
    state: "registered",
    licenses: ["SPE_E5"],
    isAdmin: true,
  },
  {
    userId: "user-2",
    displayName: "Bob User",
    userPrincipalName: "bob@example.invalid",
    methods: ["microsoftAuthenticator", "sms"],
    defaultMethod: "microsoftAuthenticator",
    phishingResistant: "not-phishing-resistant",
    lastAuthDateTime: "2026-09-25T08:30:00Z",
    state: "registered",
    licenses: ["ENTERPRISEPACK"],
    isAdmin: false,
  },
  {
    userId: "user-3",
    displayName: null,
    userPrincipalName: "charlie@example.invalid",
    methods: [],
    defaultMethod: null,
    phishingResistant: "not-phishing-resistant",
    lastAuthDateTime: null,
    state: "notRegistered",
    licenses: [],
    isAdmin: false,
  },
];

describe("MfaKpiStrip (T-0228)", () => {
  it("renders aggregate metrics and per-method chips", () => {
    render(<MfaKpiStrip kpis={SAMPLE_KPIS} />);

    expect(screen.getByTestId("kpi-total").textContent).toContain("3");
    expect(screen.getByTestId("kpi-registered").textContent).toContain("2");
    expect(screen.getByTestId("kpi-not-registered").textContent).toContain("1");
    expect(screen.getByTestId("kpi-phishing-resistant").textContent).toContain("1");
    expect(screen.getByTestId("method-count-fido2").textContent).toContain("fido2: 1");
    expect(screen.getByTestId("method-count-microsoftAuthenticator").textContent).toContain("microsoftAuthenticator: 2");
    expect(screen.getByTestId("method-count-sms").textContent).toContain("sms: 1");
  });

  it("renders loading placeholder when kpis is null or loading is true", () => {
    render(<MfaKpiStrip loading={true} />);
    expect(screen.getByTestId("mfa-kpi-strip-loading")).toBeTruthy();
  });
});

describe("MfaReportTable (T-0228)", () => {
  it("renders §3.1 columns and table rows with mono UPN", () => {
    render(<MfaReportTable rows={SAMPLE_ROWS} />);

    for (const header of [
      "User",
      "UPN",
      "Methods registered",
      "Default method",
      "Phishing-resistant?",
      "Last auth",
      "State",
      "Actions",
    ]) {
      expect(screen.getByText(header)).toBeTruthy();
    }

    const row1 = screen.getByTestId("mfa-row-user-1");
    expect(within(row1).getByText("Alice Admin")).toBeTruthy();
    expect(within(row1).getByText("alice@example.invalid")).toBeTruthy();
    expect(within(row1).getByText("Phishing-resistant")).toBeTruthy();
    expect(within(row1).getByText("Registered")).toBeTruthy();

    const row3 = screen.getByTestId("mfa-row-user-3");
    expect(within(row3).getAllByText("—")).toHaveLength(2);
    expect(within(row3).getByText("charlie@example.invalid")).toBeTruthy();
    expect(within(row3).getByText("Never")).toBeTruthy();
    expect(within(row3).getByText("Not registered")).toBeTruthy();
  });

  it("narrows rows through every filter", () => {
    render(<MfaReportTable rows={SAMPLE_ROWS} />);

    // Search filter
    fireEvent.change(screen.getByTestId("filter-search"), { target: { value: "bob" } });
    expect(screen.queryByTestId("mfa-row-user-1")).toBeNull();
    expect(screen.getByTestId("mfa-row-user-2")).toBeTruthy();
    expect(screen.queryByTestId("mfa-row-user-3")).toBeNull();
    fireEvent.change(screen.getByTestId("filter-search"), { target: { value: "" } });

    // Registered filter
    fireEvent.change(screen.getByTestId("filter-registered"), { target: { value: "notRegistered" } });
    expect(screen.queryByTestId("mfa-row-user-1")).toBeNull();
    expect(screen.queryByTestId("mfa-row-user-2")).toBeNull();
    expect(screen.getByTestId("mfa-row-user-3")).toBeTruthy();
    fireEvent.change(screen.getByTestId("filter-registered"), { target: { value: "all" } });

    // Method filter
    fireEvent.change(screen.getByTestId("filter-method"), { target: { value: "fido2" } });
    expect(screen.getByTestId("mfa-row-user-1")).toBeTruthy();
    expect(screen.queryByTestId("mfa-row-user-2")).toBeNull();
    expect(screen.queryByTestId("mfa-row-user-3")).toBeNull();
    fireEvent.change(screen.getByTestId("filter-method"), { target: { value: "all" } });

    // Phishing resistant filter
    fireEvent.change(screen.getByTestId("filter-phishing-resistant"), { target: { value: "yes" } });
    expect(screen.getByTestId("mfa-row-user-1")).toBeTruthy();
    expect(screen.queryByTestId("mfa-row-user-2")).toBeNull();
    expect(screen.queryByTestId("mfa-row-user-3")).toBeNull();
    fireEvent.change(screen.getByTestId("filter-phishing-resistant"), { target: { value: "no" } });
    expect(screen.queryByTestId("mfa-row-user-1")).toBeNull();
    expect(screen.getByTestId("mfa-row-user-2")).toBeTruthy();
    expect(screen.getByTestId("mfa-row-user-3")).toBeTruthy();
    fireEvent.change(screen.getByTestId("filter-phishing-resistant"), { target: { value: "all" } });

    // License filter
    fireEvent.change(screen.getByTestId("filter-license"), { target: { value: "unlicensed" } });
    expect(screen.queryByTestId("mfa-row-user-1")).toBeNull();
    expect(screen.queryByTestId("mfa-row-user-2")).toBeNull();
    expect(screen.getByTestId("mfa-row-user-3")).toBeTruthy();
    fireEvent.change(screen.getByTestId("filter-license"), { target: { value: "all" } });

    // Admin role filter
    fireEvent.change(screen.getByTestId("filter-admin"), { target: { value: "admin" } });
    expect(screen.getByTestId("mfa-row-user-1")).toBeTruthy();
    expect(screen.queryByTestId("mfa-row-user-2")).toBeNull();
    expect(screen.queryByTestId("mfa-row-user-3")).toBeNull();
    fireEvent.change(screen.getByTestId("filter-admin"), { target: { value: "all" } });
    expect(screen.getByTestId("mfa-row-user-1")).toBeTruthy();
    expect(screen.getByTestId("mfa-row-user-2")).toBeTruthy();
    expect(screen.getByTestId("mfa-row-user-3")).toBeTruthy();
  });

  it("handles selection and bulk actions with selection count", () => {
    const onBulkReset = vi.fn();
    const onBulkPush = vi.fn();

    render(<MfaReportTable rows={SAMPLE_ROWS} onBulkReset={onBulkReset} onBulkPush={onBulkPush} />);

    const resetBtn = screen.getByTestId("bulk-require-reregistration") as HTMLButtonElement;
    const pushBtn = screen.getByTestId("bulk-send-push") as HTMLButtonElement;
    const count = screen.getByTestId("selection-count");

    expect(count.textContent).toContain("0 selected");
    expect(resetBtn.disabled).toBe(true);
    expect(pushBtn.disabled).toBe(true);

    // Select single row
    fireEvent.click(screen.getByTestId("select-user-user-1"));
    expect(count.textContent).toContain("1 selected");
    expect(resetBtn.disabled).toBe(false);
    expect(pushBtn.disabled).toBe(false);

    // Click bulk actions
    fireEvent.click(resetBtn);
    expect(onBulkReset).toHaveBeenCalledWith([SAMPLE_ROWS[0]]);

    fireEvent.click(pushBtn);
    expect(onBulkPush).toHaveBeenCalledWith([SAMPLE_ROWS[0]]);

    // Select all
    fireEvent.click(screen.getByTestId("select-all-mfa"));
    expect(count.textContent).toContain("3 selected");

    // Deselect all
    fireEvent.click(screen.getByTestId("select-all-mfa"));
    expect(count.textContent).toContain("0 selected");
    expect(resetBtn.disabled).toBe(true);
  });

  it("invokes row actions when wired", () => {
    const onAction = vi.fn();
    const onViewUser = vi.fn();

    render(<MfaReportTable rows={SAMPLE_ROWS} onAction={onAction} onViewUser={onViewUser} />);

    fireEvent.click(screen.getByTestId("action-view-user-1"));
    expect(onViewUser).toHaveBeenCalledWith(SAMPLE_ROWS[0]);

    fireEvent.click(screen.getByTestId("action-reset-user-1"));
    expect(onAction).toHaveBeenCalledWith("resetMfa", SAMPLE_ROWS[0]);

    fireEvent.click(screen.getByTestId("action-require-reregistration-user-1"));
    expect(onAction).toHaveBeenCalledWith("requireReregistration", SAMPLE_ROWS[0]);

    fireEvent.click(screen.getByTestId("action-tap-user-1"));
    expect(onAction).toHaveBeenCalledWith("createTap", SAMPLE_ROWS[0]);

    fireEvent.click(screen.getByTestId("action-push-user-1"));
    expect(onAction).toHaveBeenCalledWith("sendPush", SAMPLE_ROWS[0]);

    fireEvent.click(screen.getByTestId("action-default-user-1"));
    expect(onAction).toHaveBeenCalledWith("setDefaultMethod", SAMPLE_ROWS[0]);
  });

  it("renders actions disabled with a reason when configured", () => {
    const reasons = {
      resetMfa: "Requires T-0229 dialog",
      sendPush: "Requires T-0229 dialog",
      setDefaultMethod: "Requires T-0229 dialog",
      bulkReset: "Requires T-0229 dialog",
    };

    render(<MfaReportTable rows={SAMPLE_ROWS} disabledReasons={reasons} />);

    const resetBtn = screen.getByTestId("action-reset-user-1") as HTMLButtonElement;
    expect(resetBtn.disabled).toBe(true);
    expect(resetBtn.title).toContain("Requires T-0229 dialog");

    const pushBtn = screen.getByTestId("action-push-user-1") as HTMLButtonElement;
    expect(pushBtn.disabled).toBe(true);
    expect(pushBtn.title).toContain("Requires T-0229 dialog");

    const defaultBtn = screen.getByTestId("action-default-user-1") as HTMLButtonElement;
    expect(defaultBtn.disabled).toBe(true);
    expect(defaultBtn.title).toContain("Requires T-0229 dialog");

    // Select row and check bulk reset is disabled with reason
    fireEvent.click(screen.getByTestId("select-user-user-1"));
    const bulkReset = screen.getByTestId("bulk-require-reregistration") as HTMLButtonElement;
    expect(bulkReset.disabled).toBe(true);
    expect(bulkReset.title).toContain("Requires T-0229 dialog");
  });
});

describe("fetchMfaReport client (T-0228)", () => {
  it("queries the GET /v1/tenants/:tenantId/mfa-report endpoint with params", async () => {
    const mockReport: MfaReport = {
      tenantId: "tenant-123",
      rows: SAMPLE_ROWS,
      kpis: SAMPLE_KPIS,
      nextCursor: null,
      retrievedAt: "2026-09-26T12:00:00Z",
    };

    const mockFetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockReport,
    });

    const result = await fetchMfaReport(
      "tenant-123",
      {
        search: "Alice",
        registered: "registered",
        phishingResistant: true,
        limit: 50,
      },
      mockFetcher as unknown as typeof fetch,
    );

    expect(mockFetcher).toHaveBeenCalledTimes(1);
    const calledUrl = mockFetcher.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("/v1/tenants/tenant-123/mfa-report?");
    expect(calledUrl).toContain("search=Alice");
    expect(calledUrl).toContain("registered=registered");
    expect(calledUrl).toContain("phishingResistant=true");
    expect(calledUrl).toContain("limit=50");
    expect(result).toEqual(mockReport);
  });

  it("throws on error response", async () => {
    const mockFetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal server error",
    });

    await expect(
      fetchMfaReport("tenant-123", {}, mockFetcher as unknown as typeof fetch),
    ).rejects.toThrow("Failed to load MFA report (500): Internal server error");
  });
});

describe("Report theme token enforcement (T-0228)", () => {
  it("uses report theme tokens and zero colour literals", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = (await import("node:path")).default;
    const currentDir = path.dirname(fileURLToPath(import.meta.url));

    const files = [
      path.join(currentDir, "MfaReportTable.tsx"),
      path.join(currentDir, "MfaKpiStrip.tsx"),
      path.join(currentDir, "../../app/mfa-report/page.tsx"),
    ];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} contains hex color literal`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(source, `${file} contains rgb color literal`).not.toMatch(/\brgba?\s*\(/i);
      expect(source, `${file} contains hsl color literal`).not.toMatch(/\bhsla?\s*\(/i);
      expect(source, `${file} missing theme token var(--`).toContain("var(--");
    }
  });
});
