"use client";

// Theme picker and light/dark toggle for the shell top bar, matching the report's own
// switcher (.palette-switch, .icon-btn in report-shell.css).

import { useEffect, useState, type ReactElement } from "react";
import { THEMES, applyTheme, getStoredTheme, type ThemeId, type ThemeMode } from "../../lib/theme";

function SunIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="8" cy="8" r="3.2" />
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none">
        <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M12.4 3.6l-1.3 1.3M4.9 11.1l-1.3 1.3" />
      </g>
    </svg>
  );
}

function MoonIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M13.5 10.2A5.5 5.5 0 0 1 5.8 2.5a5.5 5.5 0 1 0 7.7 7.7Z" />
    </svg>
  );
}

export function ThemeSwitcher(): ReactElement | null {
  // Null until mounted: the stored choice exists only in the browser.
  const [state, setState] = useState<{ theme: ThemeId; mode: ThemeMode } | null>(null);

  useEffect(() => {
    setState(getStoredTheme());
  }, []);

  if (!state) return null;

  const choose = (theme: ThemeId, mode: ThemeMode): void => {
    applyTheme(theme, mode);
    setState({ theme, mode });
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }} data-testid="theme-switcher">
      <div className="palette-switch" role="group" aria-label="Colour theme">
        {THEMES.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={state.theme === id ? "active" : ""}
            aria-pressed={state.theme === id}
            onClick={() => choose(id, state.mode)}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="icon-btn"
        title={state.mode === "dark" ? "Light mode" : "Dark mode"}
        aria-label={state.mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        onClick={() => choose(state.theme, state.mode === "dark" ? "light" : "dark")}
      >
        {state.mode === "dark" ? <SunIcon /> : <MoonIcon />}
      </button>
    </div>
  );
}
