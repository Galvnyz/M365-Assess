// Root layout: the report's app shell (02-ui-design.md §5) — a sticky sidebar with the
// portal navigation and a main column — styled by the report theme and shell CSS.
import type { ReactElement, ReactNode } from "react";
import "../../../../src/M365-Assess/assets/report-themes.css";
import "../../../../src/M365-Assess/assets/report-shell.css";
import { AppNav } from "../components/shell/AppNav";

export const metadata = {
  title: "M365-Assess Portal",
};

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="en" data-theme="neon" data-mode="dark">
      <body>
        <div className="app">
          <AppNav />
          <div className="main">{children}</div>
        </div>
      </body>
    </html>
  );
}
