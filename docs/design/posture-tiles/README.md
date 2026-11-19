# Posture tiles redesign — design mockup

Mockup for **issue #1060**. The decisions, tile set, state rules and open questions are in the spec: [`docs/specs/2026-11-19-posture-tiles-design.md`](../../specs/2026-11-19-posture-tiles-design.md).

## What's in here

| File | Purpose |
|---|---|
| `posture-tiles.js` | **The implementation reference.** `TILE_DEFS`, `deriveTile()` and `deriveRow()` are plain JavaScript with no DOM or React, meant to be ported into the report. The renderer below them is mockup-only. |
| `mock-data.js` | Three synthetic scenarios: a full run with mixed results, a Compromise-only run, and a partial run with sections missing, one collector incomplete and an unlicensed area. Contoso placeholders only. |
| `posture-tiles.css` | New `.pt-*` classes. Uses the report's theme tokens, so it follows every theme and light/dark mode. The "mockup page chrome only" block is not for the report. |
| `index.html` | Shows today's row next to the proposed row for each scenario. Clicking a proposed tile shows which findings it would open. |

## How to view

The page links the live report stylesheets in place (`src/M365-Assess/assets/report-themes.css` and `report-shell.css`), so it never drifts from them. Serve the repository root and open the page:

```powershell
npx http-server . -p 8080
```

Then browse to `http://localhost:8080/docs/design/posture-tiles/index.html`. No build step and no CDN scripts.

## Checked

Rendered in Neon dark and light at 1440px and 375px: no console errors, no horizontal scroll at 375px.
