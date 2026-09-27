import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setCurrentTenantId } from "../../lib/tenant-preference";
import { resolveTenantId, useCurrentTenantId } from "../../lib/useCurrentTenant";
import { MODE_KEY, THEME_BOOT_SCRIPT, THEME_KEY, getStoredTheme } from "../../lib/theme";
import { NAV_GROUPS, activeHref } from "./AppNav";
import { RequireTenant } from "./RequireTenant";
import { ThemeSwitcher } from "./ThemeSwitcher";

afterEach(() => {
  cleanup();
  setCurrentTenantId(null);
});

describe("AppNav", () => {
  it("marks the longest matching item active", () => {
    expect(activeHref("/standards")).toBe("/standards");
    expect(activeHref("/standards/alignment")).toBe("/standards/alignment");
    expect(activeHref("/standards/tpl-1/edit")).toBe("/standards");
    expect(activeHref("/runs/new")).toBe("/runs");
    expect(activeHref("/runsx")).toBeNull();
  });

  it("links each page once", () => {
    const hrefs = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("tenant selection", () => {
  function Probe(): React.ReactElement {
    return <span data-testid="tenant">{useCurrentTenantId() ?? "none"}</span>;
  }

  it("follows the tenant chosen in the shell", () => {
    render(<Probe />);
    expect(screen.getByTestId("tenant").textContent).toBe("none");
    act(() => setCurrentTenantId("t-a"));
    expect(screen.getByTestId("tenant").textContent).toBe("t-a");
  });

  it("prefers ?tenantId= over the shell selection", () => {
    expect(resolveTenantId("t-query", "t-shell")).toBe("t-query");
    expect(resolveTenantId(null, "t-shell")).toBe("t-shell");
    expect(resolveTenantId("  ", null)).toBe("");
  });

  it("gates tenant content until a tenant is chosen", () => {
    const { rerender } = render(
      <RequireTenant tenantId="">
        <span data-testid="content" />
      </RequireTenant>,
    );
    expect(screen.getByTestId("require-tenant")).toBeDefined();
    expect(screen.queryByTestId("content")).toBeNull();
    rerender(
      <RequireTenant tenantId="t-a">
        <span data-testid="content" />
      </RequireTenant>,
    );
    expect(screen.getByTestId("content")).toBeDefined();
  });
});

describe("theme", () => {
  afterEach(() => {
    window.localStorage.removeItem(THEME_KEY);
    window.localStorage.removeItem(MODE_KEY);
  });

  it("defaults to the blue Console theme in dark mode", () => {
    expect(getStoredTheme()).toEqual({ theme: "console", mode: "dark" });
    window.localStorage.setItem(THEME_KEY, "not-a-theme");
    expect(getStoredTheme().theme).toBe("console");
  });

  it("applies and remembers the chosen theme and mode", () => {
    render(<ThemeSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "Neon" }));
    expect(document.documentElement.dataset["theme"]).toBe("neon");
    fireEvent.click(screen.getByRole("button", { name: "Switch to light mode" }));
    expect(document.documentElement.dataset["mode"]).toBe("light");
    expect(getStoredTheme()).toEqual({ theme: "neon", mode: "light" });
  });

  it("boot script applies a stored theme and ignores unknown values", () => {
    window.localStorage.setItem(THEME_KEY, "saas");
    window.localStorage.setItem(MODE_KEY, "light");
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.dataset["theme"]).toBe("saas");
    expect(document.documentElement.dataset["mode"]).toBe("light");
    window.localStorage.setItem(THEME_KEY, "bogus");
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.dataset["theme"]).toBe("saas");
  });
});
