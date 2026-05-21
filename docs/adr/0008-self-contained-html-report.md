# 0008 — HTML report is a single self-contained file with no external runtime dependencies

- **Status:** Accepted
- **Date:** 2026-05-06

## Context

The HTML report is the artifact most M365-Assess users actually look at. Consultants email it to clients, auditors archive it as evidence, customers attach it to ticket trails. The audience matters because it dictates the runtime environment we cannot control:

- **Air-gapped tenants.** Government / classified / regulated environments that physically cannot reach a CDN.
- **Stale archives.** A report opened in 2030 that referenced `cdn.example.com/react@18` would fail to render the moment the CDN URL changed, was repurposed, or stopped serving the right version.
- **Email attachments.** Outlook strips link previews, blocks external image fetches by default, and corporate proxies often block CDN traffic outright.
- **USB / file-share handoffs.** Field engineers run the assessment from a laptop, copy the report to a USB stick, walk it to a customer site, and open it on a machine that has never seen the internet.

Any external runtime dependency (CDN-hosted React, Google Fonts, telemetry beacons, sidecar JSON files) breaks at least one of those paths. We also wanted the report to be *one file* — not a folder of HTML + JS + CSS + JSON the user has to keep together. Folders get unzipped wrong, get individual files lost, and lose all relative-path resolution when emailed.

This is uncommon for "modern" web reports. The default React/Vite pipeline ships a `dist/` folder with hashed asset filenames and an `index.html` that references them. That output is excellent for a hosted SPA and useless as a portable artifact.

## Decision

The report is a single HTML file with **everything inlined**:

- `react.production.min.js` — bundled into a `<script>` tag
- `react-dom.production.min.js` — bundled into a `<script>` tag
- `report-app.js` (Babel-compiled from `report-app.jsx`) — bundled into a `<script>` tag
- `report-themes.css` and `report-shell.css` — bundled into `<style>` tags
- The findings + framework + section + permissions data — emitted as `window.REPORT_DATA = { ... }` in a `<script>` block
- An anti-FOUC bootstrap script that reads `localStorage` for theme/mode/density preferences synchronously before first paint

`Get-ReportTemplate.ps1` is the assembler. It reads each asset file from `assets/` and `Append`s into a `[StringBuilder]::new(2097152)` (2 MB initial capacity, since reports routinely cross 1.5 MB). Asset content is read with `Get-Content -Raw` and never PowerShell-interpolated — only `.NET` string append — so `$` and backtick characters in the JS pass through unmolested. All `</script>` and `</style>` substrings inside the inlined JS/CSS are pre-escaped to `<\/script>` / `<\/style>` so they don't terminate the surrounding tag.

The build pipeline is two-stage: Babel transpiles `report-app.jsx` → `report-app.js` once at build time (committed to repo), then `Get-ReportTemplate` does the inlining at run time per assessment.

See: [`src/M365-Assess/Common/Get-ReportTemplate.ps1`](../../src/M365-Assess/Common/Get-ReportTemplate.ps1) and [`src/M365-Assess/Common/Export-AssessmentReport.ps1`](../../src/M365-Assess/Common/Export-AssessmentReport.ps1).

## Consequences

**Positive**

- Report opens and renders identically in 2030 as it did in 2026. No CDN drift, no version pinning bugs, no external service dependency.
- Air-gapped, USB-handoff, and email-attachment workflows all work first-try.
- One file = one mental model. Users don't lose pieces.
- The report can be rebuilt offline from the assessment folder's CSVs alone (the data input pipeline is fully local). This unlocks "rerun with a different theme without re-collecting" workflows.
- Asset content is never PowerShell-interpolated → no risk of `$variable` lookalikes in minified JS being silently corrupted.

**Negative**

- Reports are **big**. Typical output is 2-3 MB; large tenants with thousands of findings push 5 MB+. Email attachment limits (10 MB Outlook default, 25 MB Gmail) sometimes catch people out.
- React 18 + react-dom is ~140 KB even minified, and we ship that bundled into every report. A consultant who runs 50 assessments a year accumulates 100+ MB of reports that all contain the same React.
- The two-stage build (Babel offline → PowerShell at runtime) means JSX changes require a manual rebuild step. We've shipped JSX-and-not-rebuilt-JS bugs more than once.
- We can't lazy-load. The whole React tree, all sections, all findings, all framework data parse on first open. A 100 MB report (which we've seen on enterprise tenants) takes 5+ seconds to render and pegs the browser tab's memory.
- The "data inlined as `window.REPORT_DATA`" contract makes the report read-only by default — there's no easy "fetch updates from a server" path. Edit Mode and Finalize features had to be implemented client-side with localStorage, which has its own constraints.

**Failure modes and mitigations**

- *`</script>` substring inside inlined JS terminates the wrapping `<script>` tag* → mitigation: pre-escape `</script>`/`</style>` before append. Tested in `Get-ReportTemplate.Tests.ps1`.
- *PowerShell interpolation corrupts the JS at template-assembly time* → mitigation: `[StringBuilder].Append`, never `"$jsContent"`. Bug class fixed by structural choice, not a runtime check.
- *Anti-FOUC script runs synchronously and blocks first paint* → accepted: it's microseconds; preventing the white-flash-on-load is worth it for reports opened against a dark theme.
- *Large reports (50+ MB) crash older browsers* → no current mitigation. Long-term we may pre-aggregate non-rendered data into a separate sidecar that's loaded on demand, but that breaks the "one file" property and we've avoided it.

## Alternatives considered

- **Reference React from a CDN (`unpkg.com/react@18` etc.).** Rejected: breaks every offline / air-gapped / archived-report case. Saves ~140 KB per report at the cost of reliability we depend on.
- **Sidecar JSON with `<script src="report-data.json">` (or fetch on load).** Rejected: requires a web server (browsers block `file://` cross-origin fetches by default), which kills the email/USB workflow.
- **Multi-file output: `report.html` + `report.js` + `report.css` + `data.json` in a folder.** Rejected: users lose pieces, lose relative-path resolution when emailed, and lose the "send my client one file" property.
- **Server-side rendered static HTML with no JS.** Rejected: kills interactivity (filters, sortable tables, drill-downs, edit mode, theme switcher). Most of the report's value is the interactive UI, not the static content.
- **Single-page-app served from a separate hosting service.** Rejected: requires us to operate infrastructure, run a backend, and pay forever. Customers also can't share assessment data with non-authenticated viewers without rolling token-protected URLs. The on-disk file is a much simpler distribution model.
- **PDF as primary output.** Rejected for the same interactivity reasons. We do support a print stylesheet and PDF export from-the-browser as a secondary distribution channel.

---

## See also

- [`../../src/M365-Assess/Common/Get-ReportTemplate.ps1`](../../src/M365-Assess/Common/Get-ReportTemplate.ps1) — the assembler
- [`../../src/M365-Assess/Common/Export-AssessmentReport.ps1`](../../src/M365-Assess/Common/Export-AssessmentReport.ps1) — the orchestrator that calls it
- [`../../src/M365-Assess/assets/`](../../src/M365-Assess/assets/) — the inlined assets (React build, CSS, compiled `report-app.js`)
- [`../dev/REPORT-INTERNALS.md`](../dev/REPORT-INTERNALS.md) — frontend build pipeline + `window.REPORT_DATA` schema
- [`README.md`](README.md) — back to the ADR index
