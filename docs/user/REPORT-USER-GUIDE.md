# Using the M365-Assess HTML report

A walkthrough of the interactive features in the assessment HTML output. If you've just generated your first report and want to know what you can DO with it, this is the doc.

For setting up + running the assessment itself, see [`QUICKSTART.md`](QUICKSTART.md). For the data shape behind the report, see [`REPORT-SCHEMA.md`](../dev/REPORT-INTERNALS.md). For front-end internals (build, components), see [`REPORT-FRONTEND.md`](../dev/REPORT-INTERNALS.md).

---

## What's in the report

The report (`_Assessment-Report.html`) is a self-contained React 18 single-file HTML application — no server, no assets folder, no external dependencies. All styles, scripts, logos, and data are embedded inline, so the file can be emailed directly to clients and opens offline.

- **Multiple themes** — Default, Neon, Blueprint, Slate, and High Contrast, each with light and dark variants. Auto-detection via `prefers-color-scheme`, `localStorage` persistence, and WCAG AAA support in high-contrast mode.
- **Posture hero** with tenant name, organization profile card (org name, primary domain, creation date, security defaults status), and live security posture KPIs.
- **Identity KPIs** — total users, licensed users, MFA adoption %, SSPR enrollment %, guest count (MFA/SSPR denominators exclude non-capable accounts).
- **Microsoft Secure Score** — stat card, progress bar with peer-average comparison, and a real Secure Score history sparkline (up to 180 days from Graph, dynamically labeled).
- **Domain donut charts** — Pass/Fail/Warning/Review/Info breakdown for each domain (Entra, EXO, Defender, SharePoint, Teams).
- **Findings table** — sortable, searchable, filterable by status, severity, domain, and framework; severity and framework badges inline.
- **Compliance Overview** — interactive framework selector, coverage cards, CIS E3/E5 sub-filters, and cross-reference matrix (see [`COMPLIANCE.md`](COMPLIANCE.md)).
- **Remediation Action Plan** — prioritized list of actionable fixes with effort estimates and impact metadata.
- **Appendix** — full section-by-section data tables with sortable headers, status/severity chip filters, column picker, and CSV export.
- **Color-coded status badges** (Pass/Fail/Warning/Review/Info) with row-level tinting on security config tables.
- **Accessibility** — semantic HTML landmarks, `scope="col"` on table headers, focus-visible outlines.
- **Print-friendly** — `window.print()` with optimized print CSS; no external PDF generator required.

---

## What is interactive?

The report is a single self-contained HTML file. It looks static, but it's a real React app — most of the surface is interactive:

| Surface | Interaction |
|---|---|
| Section headers | Click to collapse / expand |
| FilterBar (top of findings table) | Multi-select chips: Status / Sequence / Severity / Framework / Domain / Level |
| Findings table columns | Click headers to sort; drag right edges to resize; drag the ⋮⋮ grip on any header to reorder |
| Findings table rows | Click any row to expand into the [detail panel](#the-finding-detail-panel) |
| Roadmap section | Drag tasks between Now / Next / Later lanes (or use the menu on each card) |
| Topbar | Theme toggle (4 themes) · density toggle · text-size A− / A+ · Edit mode toggle · Finalize |

Everything except Finalize is non-destructive — you can click around freely without affecting the on-disk file.

---

## Edit mode

The Edit mode toggle in the topbar is the entry point to consultant-side enrichment of the report. You can:

1. **Hide any card or section** that's not useful for the current customer
2. **Hide individual findings** (the "this isn't relevant for this engagement" case)
3. **Reassign roadmap lanes** (move a finding from Later → Now if the customer wants it prioritised)
4. **Reset all** of the above to defaults

When edit mode is on:
- An **EDIT MODE banner** appears at the top of the page (visual signal that you're in edit mode)
- Hover-over actions appear on cards and rows (✕ icons)
- Toolbar shows a **Reset all** button

Click the toggle again to exit edit mode (your edits stay applied; they aren't discarded by exiting).

### Hiding a card or section

In edit mode, hover over any card / section / framework cell / appendix sub-card / roadmap lane. A small ✕ overlay appears in the top-right corner. Click it.

The element stays visible in edit mode but at 40% opacity, with a ↩ Restore button. Outside edit mode, the element is fully hidden.

To restore:
- In edit mode: click the ↩ button on the faded element
- Or: click **Reset all** in the toolbar to restore everything

### Hiding a finding

Same flow — hover the finding row in edit mode, click ✕. The row disappears from the visible findings table (and from KPI tile counts, framework rollups, etc.) until restored.

### Reassigning a roadmap lane

The Roadmap section shows tasks in three lanes — Do Now, Do Next, Later — based on each finding's severity + effort. The lane assignment is computed automatically by `Get-RemediationLane.ps1`.

In edit mode, you can override the lane:
- Click a roadmap card → the menu shows "Move to Do Now / Do Next / Later"
- Or drag the card to a different lane

A `custom` badge appears on overridden cards. Click **Reset** on the card to revert to the auto-computed lane.

### What gets persisted

Edit-mode changes live only in browser memory until you Finalize (next section). Closing the browser without Finalizing loses all edits.

---

## Finalize → fresh HTML

The **Finalize** button in the topbar writes a NEW HTML file with your current overrides baked in. This is the customer-facing version of the report.

**File location:** your browser's default download folder. Filename: `<TenantName>-M365-Report.html` (spaces stripped).

**What gets baked in:**
- Hidden findings (won't appear in the new file at all)
- Hidden cards / sections (same)
- Roadmap lane overrides (the new file shows your manual lanes as the default)

**What's NOT baked in:**
- Theme / density / text-size choices (those are per-viewer preferences, not part of the report state)
- The original file on disk is unchanged — Finalize creates a NEW download, doesn't modify the source

**Re-opening a finalized file:** edits persist. You can Finalize-of-a-finalized to bake in further edits (effectively "save" multiple times).

**Regenerating the assessment:** the next `Invoke-M365Assessment` run produces a fresh HTML with no overrides applied (default state). The finalized file you produced is independent of future assessments.

### Power-user note: `REPORT_OVERRIDES`

Inside the finalized HTML, the overrides live in a global JS variable:

```js
window.REPORT_OVERRIDES = {
  hiddenFindings:   ['ENTRA-MFA-001', ...],
  hiddenElements:   ['kpi-secure-score', 'appendix-licenses', ...],
  roadmapOverrides: { 'EXO-FORWARD-001': 'now', ... }
};
```

You can hand-edit this if you want to programmatically share an override set across multiple reports. Stable keys:
- Finding `checkId` (without sub-numbering — `ENTRA-MFA-001` not `ENTRA-MFA-001.1`)
- Card `data-hide-key` attributes (visible in browser DevTools — e.g., `kpi-fails`, `appendix-licenses`, `framework-cell-cis-m365`)

---

## Other interactive controls

### Theme toggle

Topbar shows the current theme; click to cycle through:

| Theme | Use case |
|---|---|
| **Neon** (dark, default) | Default — high contrast, accent-heavy |
| **Console** (dark) | Quieter dark theme; closer to standard terminal palette |
| **Saas** (light) | Light theme for printing / projecting |
| **High-Contrast** | WCAG AAA-leaning; for accessibility or low-bandwidth visual conditions |

Theme persists per-tenant in localStorage.

### Density toggle

Compact mode reduces vertical padding throughout. Useful when you want more findings on screen at once. Toggle in the topbar; persists per-tenant.

### Text size A− / A+

Two adjacent buttons step the base font size one position each direction. Disable at boundaries. Persists in `m365-text-scale` localStorage.

### Findings table columns

| Action | How |
|---|---|
| Sort | Click any sortable header (Status / Finding / Domain / CheckID / Sequence / Severity) to cycle: none → ascending → descending → none |
| Resize | Drag the right edge of any header (8px hot zone). Min width 60px |
| Reorder | Drag the ⋮⋮ grip at the left of any header onto another column to reposition |
| Show / hide columns | Click the **Columns** button above the table; toggle individual columns on / off |

Sort, resize, order, and column visibility all persist per-tenant in localStorage.

**Adaptive widths.** Columns shrink on narrow viewports (the table uses CSS Grid `minmax()` so it doesn't overflow horizontally on smaller screens). The Finding column absorbs leftover space on wide displays.

**Default order:** Status · Finding · Domain · Control # · CheckID · Sequence · Severity. The Sequence column shows the workflow lane (Now / Next / Later / Done) as a colour-coded pill.

### FilterBar

Multi-select chips above the findings table. Filters apply across the table, KPI tiles, and framework rollups.

| Group | Chips |
|---|---|
| **Status** | Pass · Fail · Warning · Review · Info · Skipped |
| **Sequence** | Now · Next · Later · Done — slices to one workflow lane |
| **Severity** | Critical · High · Medium · Low |
| **Framework** | Per-framework chips (CIS · NIST · ISO · CMMC · ...) |
| **Domain** | Per-domain chips (Identity · Defender · Exchange · ...) |
| **Level** | E3-L1 · E3-L2 · E5-L1 · E5-L2 (when a CIS framework is selected) |

Click a chip to add it to the filter; click again to remove. Multiple chips in the same group are OR-combined; chips across groups are AND-combined.

Filter state persists per-tenant; reset via the FilterBar's Clear-all action.

---

## The finding detail panel

Click any row in the findings table to expand it. The panel is structured top-to-bottom as:

### 1. Copy button (top-right floating)

A `Copy` button at the top-right corner of the panel. Click it to put a markdown summary of the finding (title · status · current value · recommended value · remediation) on your clipboard. Designed for fast paste into a ticket, change record, or stakeholder email.

### 2. Intent-by-design callout (when applicable)

If the finding's `IntentDesign` flag is set, the panel opens with a blue-tinted "Intentional by design" callout explaining why the otherwise-Fail-shaped configuration is deliberate. Most findings don't have this; it appears for known-trade-off cases (e.g., admin accounts deliberately excluded from a CA policy with a documented rationale).

### 3. State strip — five workflow cells

The state strip is the headline summary of the finding's workflow state:

| Cell | What it shows |
|---|---|
| **Sequence** | Coloured pill: `Now` (red) / `Next` (amber) / `Later` (blue) for actionable Fail findings, `Done` (green) for Pass findings, `—` for Info / Skipped / Unknown |
| **Effort** | Estimated remediation effort: `<15 min` / `1 hour` / `1 day` / `multi-day`. Drives the lane computation. |
| **Affected** | Best-effort count derived from the observed value (e.g., `3 admins`). Shown in red if Severity is Critical, amber if High. `—` when not derivable. |
| **Owner** | Currently `Unassigned` placeholder. Editable in Phase 5 of the redesign — see [#863](https://github.com/Galvnyz/M365-Assess/issues/863). |
| **Ticket** | Currently `—` placeholder. Same Phase 5 dependency. |

The Sequence cell uses the same pill colours as the Sequence column in the table itself, so a finding's lane reads identically in both places.

### 4. Risk callout

A red-tinted block with a `!` icon. Replaces the legacy "Why it matters" muted strip. Contains:

- The risk narrative — explains *why* this finding matters (account compromise paths, data exfiltration risk, audit failure, etc.). Sourced from per-prefix narrative content (see issue #854).
- **MITRE ATT&CK meta column** — when the finding maps to ATT&CK techniques, the technique IDs render as inline `code` chips on the right side of the callout.

The visual prominence of this block is intentional — it's the "so what?" answer for stakeholders who don't speak the technical detail.

### 5. Legacy content rows (transitional)

Below the risk callout, the panel still renders the pre-redesign content blocks:

- **Current value** — the observed tenant configuration. Coloured by status tier (red border for Fail, green for Pass, etc.).
- **Recommended value** — what good looks like.
- **Remediation** — the breadcrumb path or PowerShell snippet (caveat: admin-center paths rot when Microsoft reorgs the UI; see #879).
- **Learn more** — links to canonical Microsoft Learn documentation, sourced from the registry's `references` field.

These blocks will be replaced in Phases 3–5 of the [#863 finding-detail redesign](https://github.com/Galvnyz/M365-Assess/issues/863) (typed observed / expected fields, tabbed remediation actions, inline edit affordances). Until those phases ship, both the new state strip / risk callout AND these legacy blocks render together.

### 6. Provenance footer (collapsible)

A summary line at the bottom of the panel showing condensed provenance keys (Source · Collected · Method). Click to expand a full grid covering:

- **Source** — which Graph endpoint / cmdlet produced this data
- **Collected** — UTC timestamp of the API call
- **Method** — `graph-api` / `exo-cmdlet` / `manual-validation` / etc.
- **Permission** — the Graph scope or RBAC role used
- **Confidence** — 0–100% (when the collector reports a confidence score)
- **Observed value** — the raw observed value, useful when the higher-level "Current value" was summarised
- **Limitations** — known caveats about the data (e.g., "only counts active sign-ins from the last 30 days")

When `evidence.raw` is present, an additional collapsible block exposes the raw API response. Useful for incident-response evidence packs.

The provenance footer replaces the previously-buried `<details>` block — every finding now has a one-click expand to show its data lineage.

### Truncated check-ID (hover for full)

Long `controlId` values (CIS / CMMC / NIST framework references) ellipsis-truncate within their row to keep the table tight. Hover a truncated value for the browser title-attribute tooltip showing the full ID.

---

## Standalone report generation

Re-generate the HTML report from existing CSV data without re-running the full assessment:

```powershell
.\Common\Export-AssessmentReport.ps1 -AssessmentFolder '.\M365-Assessment\Assessment_YYYYMMDD_HHMMSS'
```

Useful for:

- Regenerating the report after a branding change
- Testing report layout changes against existing data
- Generating reports from CSV data collected on another system

---

## White label

Use `-WhiteLabel` to generate a report without the M365 Assess GitHub link and Galvnyz attribution in the footer:

```powershell
Invoke-M365Assessment -TenantId 'contoso.onmicrosoft.com' -WhiteLabel
```

Produces a clean report with your tenant name and data but no open-source attribution. Ideal for client delivery.

---

## Edge cases

**Hidden finding referenced by a check that no longer exists.** When the registry syncs and a check is removed (rare but possible), an existing override for that `checkId` is silently ignored. No error.

**Re-running the assessment after editing.** A new `Invoke-M365Assessment` run produces a fresh HTML with no overrides. To carry edits forward, either:
1. Hand-copy the `REPORT_OVERRIDES` block from your finalized HTML into the new one
2. Or Finalize once at the end of each assessment cycle and store the finalized version separately

**Re-opening a finalized file in a different browser.** Edits persist (they're embedded in the file's JS). Theme / density / text-size are per-browser localStorage and don't transfer.

**Sharing the report via email.** The finalized HTML is a single self-contained file. It runs offline (no CDN dependencies for the data; React + Babel are inlined).

---

## See also

- [`QUICKSTART.md`](QUICKSTART.md) — running the assessment
- [`RUN.md`](RUN.md) — orchestration details
- [`FIRST-REMEDIATION.md`](FIRST-REMEDIATION.md) — worked example: take one Fail finding from initial state through fix through re-verification
- [`UNDERSTANDING-RESULTS.md`](UNDERSTANDING-RESULTS.md) — what each status means and what to do
- [`REPORT-SCHEMA.md`](../dev/REPORT-INTERNALS.md) — the data shape behind the report
- [`REPORT-FRONTEND.md`](../dev/REPORT-INTERNALS.md) — front-end internals (React, build, components)
- [`SCORING.md`](SCORING.md) — how the headline score is computed and why
- [`CHECK-STATUS-MODEL.md`](../reference/CHECK-STATUS-MODEL.md) — the status taxonomy
