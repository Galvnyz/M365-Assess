# Framework Coverage redesign — design handoff

Frozen snapshot of the design package exported from [Claude Design](https://claude.ai/design) on 2026-04-27. This is the source-of-truth spec for **issue #855** (FrameworkQuilt redesign).

## What's in here

| File | Purpose |
|---|---|
| `index.html` | Canvas host that renders all 4 directions side by side. Designed to load standalone in a browser (see "How to view" below). |
| **`direction-merged.jsx`** | **The implementation reference.** The user landed here after iterating across 3 alternates. Adaptive layout: 1 framework → focus view, 2+ → comparison table + chart + drilldown. |
| `direction-a.jsx` | Alternate considered: toolbar + single-framework focus. Kept for context. |
| `direction-b.jsx` | Alternate considered: pinned chips + side-by-side compare. Kept for context. |
| `direction-c.jsx` | Alternate considered: comparison table + drilldown. Kept for context. |
| `design-canvas.jsx` | Canvas chrome (artboard + section + focus-mode container). Not implementation-relevant — it's the surrounding harness. |
| `redesign.css` | All new CSS classes used by the merged direction (`.fw-*` namespace). The implementer should fold these into `src/M365-Assess/assets/report-shell.css`. |
| `mock-data.js` | Representative data shape the component expects. Aligns with the existing `REPORT_DATA.frameworks` plus the per-framework family taxonomy that #751 / #845 already shipped. |
| `screenshots/canvas-overview.png` | Snapshot of the four directions in the canvas as designed. |

## Not included (deliberately)

The original design bundle contained `report-shell.css` and `report-themes.css` so the canvas could load standalone. **Those are not duplicated here** — they live at `src/M365-Assess/assets/report-shell.css` and `report-themes.css` and may evolve over time. The design intent is captured in `redesign.css` only; the existing report styles are referenced from the live source.

## How to view the canvas

Two options:

1. **Live styles (recommended)** — symlink or copy the live CSS files alongside `index.html`, then open in a browser:
   ```bash
   cd docs/design/framework-redesign
   cp ../../../src/M365-Assess/assets/report-shell.css .
   cp ../../../src/M365-Assess/assets/report-themes.css .
   start index.html   # Windows
   open index.html    # macOS
   xdg-open index.html # Linux
   ```
   (Don't commit those copies — they would drift from the live source.)

2. **Inline view in Claude Design** — re-import the bundle to claude.ai/design and view it there. Useful if you want to iterate further on the design itself.

You don't need to render the canvas to implement — per the bundle's original README ("Don't render these in a browser unless asked; everything you need is in the source"), the JSX/CSS source is the spec. The screenshot in `screenshots/canvas-overview.png` is enough for a sanity reference.

## Implementation guidance

See **issue #855** for the full implementation plan, including:
- Component breakdown with line-number citations into `direction-merged.jsx`
- Files to modify in the live codebase
- Acceptance criteria
- Out-of-scope items

The polished JSX in `direction-merged.jsx` should be adapted (not copied verbatim) into `src/M365-Assess/assets/report-app.jsx` — the data sources, hook names, and helper utilities will need to align with the live codebase conventions (e.g., the live code uses `STATUS_COLORS`, `matchProfileToken`, `coveragePct`, `readinessLabel`, etc., which the design references but defines locally).

## Why these files live in the repo

Two reasons:
1. **Single source of truth** — the design intent shouldn't live in an Anthropic-hosted bundle that may be deleted or move; committing it here means the spec is versioned alongside the code that implements it.
2. **Reviewer context** — when issue #855 ships in a PR, the reviewer can compare the live implementation against this snapshot directly without having to re-import a bundle.

If the design is iterated further and re-exported, replace these files in a new commit and update issue #855 with a note about what changed.
