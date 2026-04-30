# Using the M365-Assess HTML report

A walkthrough of the interactive features in the assessment HTML output. If you've just generated your first report and want to know what you can DO with it, this is the doc.

For setting up + running the assessment itself, see [`QUICKSTART.md`](QUICKSTART.md). For the data shape behind the report, see [`REPORT-SCHEMA.md`](../dev/REPORT-INTERNALS.md). For front-end internals (build, components), see [`REPORT-FRONTEND.md`](../dev/REPORT-INTERNALS.md).

---

## What is interactive?

The report is a single self-contained HTML file. It looks static, but it's a real React app — most of the surface is interactive:

| Surface | Interaction |
|---|---|
| Section headers | Click to collapse / expand |
| FilterBar (top of findings table) | Multi-select chips: Status / Severity / Framework / Domain / Level |
| Findings table columns | Click headers to sort; drag right edges to resize |
| Findings table rows | Click any row to expand into the detail panel |
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
| Sort | Click a header (Status / Finding / Domain / CheckID / Severity) to cycle: none → ascending → descending → none |
| Resize | Drag the right edge of any header (8px hot zone). Min width 60px |

Sort + resize persist per-tenant in localStorage.

### FilterBar

Multi-select chips above the findings table. Filters apply across the table, KPI tiles, and framework rollups.

| Group | Chips |
|---|---|
| **Status** | Pass · Fail · Warning · Review · Info · Skipped |
| **Severity** | Critical · High · Medium · Low |
| **Framework** | Per-framework chips (CIS · NIST · ISO · CMMC · ...) |
| **Domain** | Per-domain chips (Identity · Defender · Exchange · ...) |
| **Level** | E3-L1 · E3-L2 · E5-L1 · E5-L2 (when a CIS framework is selected) |

Click a chip to add it to the filter; click again to remove. Multiple chips in the same group are OR-combined; chips across groups are AND-combined.

Filter state persists per-tenant; reset via the FilterBar's Clear-all action.

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
- [`REPORT-SCHEMA.md`](../dev/REPORT-INTERNALS.md) — the data shape behind the report
- [`REPORT-FRONTEND.md`](../dev/REPORT-INTERNALS.md) — front-end internals (React, build, components)
- [`SCORING.md`](SCORING.md) — how the headline score is computed and why
- [`CHECK-STATUS-MODEL.md`](../reference/CHECK-STATUS-MODEL.md) — the status taxonomy
