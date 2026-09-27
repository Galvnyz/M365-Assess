// Portal colour theme and light/dark mode: the report's theme set (report-themes.css),
// applied as data-theme / data-mode on <html> and remembered per browser. Console (navy
// blue) is the portal default.

export const THEMES = [
  { id: "console", label: "Console" },
  { id: "neon", label: "Neon" },
  { id: "saas", label: "Vibe" },
  { id: "high-contrast", label: "High Contrast" },
] as const;
export type ThemeId = (typeof THEMES)[number]["id"];
export type ThemeMode = "dark" | "light";

export const DEFAULT_THEME: ThemeId = "console";
export const DEFAULT_MODE: ThemeMode = "dark";
export const THEME_KEY = "m365_assess_theme";
export const MODE_KEY = "m365_assess_mode";

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "dark" || value === "light";
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function getStoredTheme(): { theme: ThemeId; mode: ThemeMode } {
  const theme = read(THEME_KEY);
  const mode = read(MODE_KEY);
  return {
    theme: isThemeId(theme) ? theme : DEFAULT_THEME,
    mode: isThemeMode(mode) ? mode : DEFAULT_MODE,
  };
}

/** Apply to the document and remember it. */
export function applyTheme(theme: ThemeId, mode: ThemeMode): void {
  document.documentElement.dataset["theme"] = theme;
  document.documentElement.dataset["mode"] = mode;
  try {
    window.localStorage.setItem(THEME_KEY, theme);
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Storage may be unavailable (private mode); the choice then lasts for the page.
  }
}

/**
 * Inline <head> script: applies the stored theme before first paint, so a non-default
 * choice does not flash the default. Kept dependency-free; it runs before React.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)}),m=localStorage.getItem(${JSON.stringify(MODE_KEY)}),e=document.documentElement;if(${JSON.stringify(THEMES.map((x) => x.id))}.indexOf(t)>=0)e.dataset.theme=t;if(m==="dark"||m==="light")e.dataset.mode=m;}catch(_){}})();`;
