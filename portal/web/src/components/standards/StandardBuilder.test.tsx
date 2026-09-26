// T-0147 — standards template builder: timeline, accordion, picker, guard.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StandardAccordion } from "./StandardAccordion.js";
import { StandardPicker } from "./StandardPicker.js";
import StandardBuilderPage from "../../app/standards/[id]/edit/page.js";
import {
  isLicenseMissing,
  standardImpact,
  type CatalogStandard,
} from "../../lib/standardsApi.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function catalogItem(overrides: Partial<CatalogStandard> = {}): CatalogStandard {
  return {
    id: "ENTRA-SECDEFAULT-001",
    check: "ENTRA-SECDEFAULT-001",
    name: "Security defaults",
    category: "SECDEFAULT",
    licensePreset: "E3",
    licenseState: "eligible",
    licenseReason: null,
    ...overrides,
  };
}

const CATALOG: CatalogStandard[] = [
  catalogItem({ id: "a", check: "ENTRA-SECDEFAULT-001", name: "Security defaults", category: "SECDEFAULT", licensePreset: "E3" }),
  catalogItem({ id: "b", check: "ENTRA-PIM-001", name: "PIM", category: "PIM", licensePreset: "E5", licenseState: "license-missing", licenseReason: "missing AAD_PREMIUM_P2" }),
  catalogItem({ id: "c", check: "CA-REPORTONLY-001", name: "CA report-only", category: "CA", licensePreset: "E5" }),
];

describe("StandardAccordion", () => {
  it("toggles action flags and implies remediate+report for autoRemediate", () => {
    const onChange = vi.fn();
    render(
      <StandardAccordion
        standard={{ key: "k", check: "ENTRA-SECDEFAULT-001", name: "Security defaults" }}
        actions={{ report: true, alert: true, remediate: false }}
        autoRemediate={false}
        expanded
        onChange={onChange}
      />,
    );

    // Turning autoRemediate on implies remediate + report.
    fireEvent.click(screen.getByTestId("auto-remediate-k"));
    expect(onChange).toHaveBeenCalledWith({
      actions: { report: true, alert: true, remediate: true },
      autoRemediate: true,
    });

    // Toggling Alert alone keeps the others.
    fireEvent.click(screen.getByTestId("action-alert-k"));
    expect(onChange).toHaveBeenLastCalledWith({
      actions: { report: true, alert: false, remediate: false },
      autoRemediate: false,
    });
  });

  it("flags a licence-missing standard", () => {
    render(
      <StandardAccordion
        standard={{ key: "k", check: "ENTRA-PIM-001", name: "PIM", licenseState: "license-missing" }}
        actions={{ report: true, alert: true, remediate: false }}
        autoRemediate={false}
        expanded
      />,
    );
    expect(screen.getByTestId("license-k").textContent).toBe("license missing");
  });
});

describe("StandardPicker", () => {
  it("filters by search, category, and impact, and marks licence-missing items", () => {
    render(<StandardPicker items={CATALOG} />);
    // Licence-missing item is flagged.
    expect(screen.getByTestId("picker-license-ENTRA-PIM-001")).toBeTruthy();

    // Search.
    fireEvent.change(screen.getByTestId("picker-search"), { target: { value: "pim" } });
    expect(screen.getByTestId("picker-item-ENTRA-PIM-001")).toBeTruthy();
    expect(screen.queryByTestId("picker-item-ENTRA-SECDEFAULT-001")).toBeNull();
    fireEvent.change(screen.getByTestId("picker-search"), { target: { value: "" } });

    // Category.
    fireEvent.change(screen.getByTestId("picker-category"), { target: { value: "CA" } });
    expect(screen.getByTestId("picker-item-CA-REPORTONLY-001")).toBeTruthy();
    expect(screen.queryByTestId("picker-item-ENTRA-PIM-001")).toBeNull();
    fireEvent.change(screen.getByTestId("picker-category"), { target: { value: "all" } });

    // Impact: high == E5.
    fireEvent.change(screen.getByTestId("picker-impact"), { target: { value: "high" } });
    expect(screen.getByTestId("picker-item-ENTRA-PIM-001")).toBeTruthy();
    expect(screen.queryByTestId("picker-item-ENTRA-SECDEFAULT-001")).toBeNull();
  });

  it("toggles card/list view and adds the selected items", () => {
    const onAdd = vi.fn();
    render(<StandardPicker items={CATALOG} onAdd={onAdd} />);

    expect(screen.getByTestId("picker-results-list")).toBeTruthy();
    fireEvent.click(screen.getByTestId("picker-view-toggle"));
    expect(screen.getByTestId("picker-results-card")).toBeTruthy();

    fireEvent.click(screen.getByTestId("picker-item-ENTRA-SECDEFAULT-001"));
    fireEvent.click(screen.getByTestId("picker-add"));
    expect(onAdd).toHaveBeenCalledWith([expect.objectContaining({ check: "ENTRA-SECDEFAULT-001" })]);
  });
});

describe("StandardBuilderPage", () => {
  function mockApi() {
    return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url.startsWith("/v1/standards/catalog")) {
        return new Response(JSON.stringify({ items: CATALOG }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url === "/v1/standards/templates" && method === "POST") {
        return new Response(
          JSON.stringify({ template: { id: "tpl-new", name: "New", kind: "standards", actions: { report: true, alert: true, remediate: false }, autoRemediate: false, settings: [], scheduleId: null } }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ template: { id: "tpl-1", name: "Baseline", kind: "standards", actions: { report: true, alert: true, remediate: false }, autoRemediate: false, settings: [], scheduleId: null } }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
  }

  it("renders the timeline and auto-completes steps as the builder is filled", async () => {
    render(<StandardBuilderPage params={{ id: "new" }} fetcher={mockApi() as unknown as typeof fetch} navigate={() => {}} />);

    // Step 1 is current, later steps todo.
    expect(screen.getByTestId("timeline-step-0").textContent).toContain("1");

    fireEvent.change(screen.getByTestId("builder-name"), { target: { value: "Baseline" } });
    fireEvent.change(screen.getByTestId("builder-assign"), { target: { value: "contoso" } });

    // Step 0 and 1 now done (check marks).
    await waitFor(() => expect(screen.getByTestId("timeline-step-0").textContent).toContain("✓"));
    expect(screen.getByTestId("timeline-step-1").textContent).toContain("✓");

    // Add a standard from the picker -> step 3 complete, accordion appears.
    fireEvent.click(screen.getByTestId("builder-add-standards"));
    await waitFor(() => expect(screen.getByTestId("standard-picker")).toBeTruthy());
    fireEvent.click(screen.getByTestId("picker-item-ENTRA-SECDEFAULT-001"));
    fireEvent.click(screen.getByTestId("picker-add"));

    expect(screen.getByTestId("accordion-ENTRA-SECDEFAULT-001")).toBeTruthy();
    fireEvent.click(screen.getByTestId("accordion-header-ENTRA-SECDEFAULT-001"));
    fireEvent.click(screen.getByTestId("action-remediate-ENTRA-SECDEFAULT-001"));
  });

  it("blocks navigation with an unsaved-changes guard and saves when confirmed", async () => {
    const navigate = vi.fn();
    const fetcher = mockApi();
    render(<StandardBuilderPage params={{ id: "new" }} fetcher={fetcher as unknown as typeof fetch} navigate={navigate} />);

    fireEvent.change(screen.getByTestId("builder-name"), { target: { value: "Baseline" } });

    // Cancel while dirty -> guard appears, navigation blocked.
    fireEvent.click(screen.getByTestId("builder-cancel"));
    expect(screen.getByTestId("unsaved-guard")).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();

    // Stay keeps the user in place.
    fireEvent.click(screen.getByTestId("guard-stay"));
    expect(screen.queryByTestId("unsaved-guard")).toBeNull();

    // Leave proceeds.
    fireEvent.click(screen.getByTestId("builder-cancel"));
    fireEvent.click(screen.getByTestId("guard-leave"));
    expect(navigate).toHaveBeenCalledWith("/standards");

    // Save persists through the API.
    fireEvent.click(screen.getByTestId("builder-save"));
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith("/v1/standards/templates", expect.objectContaining({ method: "POST" })),
    );
  });

  it("uses CSS custom properties (zero hex literals)", () => {
    const { container } = render(<StandardBuilderPage params={{ id: "new" }} fetcher={mockApi() as unknown as typeof fetch} navigate={() => {}} />);
    const hexPattern = /#[0-9a-fA-F]{3,6}\b/;
    const inlineStyles = container.innerHTML.match(/style="[^"]*"/g) ?? [];
    for (const styleAttr of inlineStyles) {
      expect(hexPattern.test(styleAttr), `Hex literal found in: ${styleAttr}`).toBe(false);
    }
  });
});

describe("catalog helpers", () => {
  it("derives impact and licence-missing", () => {
    expect(standardImpact({ licensePreset: "E5" })).toBe("high");
    expect(standardImpact({ licensePreset: "E3" })).toBe("standard");
    expect(standardImpact({ licensePreset: null })).toBe("unknown");
    expect(isLicenseMissing({ licenseState: "license-missing" })).toBe(true);
    expect(isLicenseMissing({ licenseState: "eligible" })).toBe(false);
  });
});
