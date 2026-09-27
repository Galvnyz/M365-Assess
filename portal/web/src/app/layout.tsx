// Root layout: the report's app shell (02-ui-design.md §5) — a sticky sidebar with the
// portal navigation and a main column — styled by the report theme and shell CSS.
import type { ReactElement, ReactNode } from "react";
import "../../../../src/M365-Assess/assets/report-themes.css";
import "../../../../src/M365-Assess/assets/report-shell.css";
import "./portal.css";
import { AppNav } from "../components/shell/AppNav";
import { TenantBar } from "../components/shell/TenantBar";
import { DEFAULT_MODE, DEFAULT_THEME, THEME_BOOT_SCRIPT } from "../lib/theme";

export const metadata = {
  title: "M365-Assess Portal",
};

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    // The boot script may change data-theme/data-mode before hydration, hence the warning opt-out.
    <html lang="en" data-theme={DEFAULT_THEME} data-mode={DEFAULT_MODE} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <div className="app">
          <AppNav />
          <div className="main">
            <TenantBar />
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
