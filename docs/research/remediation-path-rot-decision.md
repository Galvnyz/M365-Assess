# Remediation-path rot — structural decision

Decision artifact for issue #879. The remediation `portal.path` strings shipped in `controls/registry.json` and inline in collector `Add-Setting` calls are silently rotting whenever Microsoft reorganizes an admin-center hub. Two examples surfaced in one v2.10 / v2.11 sprint (#878 ENTRA-SSPR-001 + a CA path during the 2026-04-29 lab session). With ~250 checks and Microsoft's roughly 18-month admin-center reorg cadence, the long-term cost of inline UI breadcrumbs is structural, not incidental.

## The shape of the problem

A remediation string today looks like:

> `Entra admin center > Protection > Authentication methods > Registration campaign > Enable and target All Users.`

The user opens the Entra admin center, looks for "Protection", and finds it doesn't exist (or has been renamed, or its child has moved one hub level up). Two predictable failure modes:

1. **Loss of trust.** A consultant clicking through and not finding the named menu item assumes the report is stale across the board. Hard to recover from.
2. **Silent skip.** The consultant gives up on remediating the finding because re-discovering the path is more effort than the finding feels worth.

For a tool whose value proposition is hands-off auditor handoff, this is a credibility bug — independent of whether the underlying check is correct.

## Three options on the table (per #879)

| Option | What it changes | Pro | Con |
|---|---|---|---|
| **A** Drop verbose paths, link Microsoft Learn instead | Replace breadcrumb strings with MS Learn deep-links Microsoft maintains as canonical | Microsoft owns the rot; URLs are stable across UI reorgs; one source of truth | Loses inline "where to click next" hint; user has to context-switch into a docs page |
| **B** Render path as "likely-stale, see Learn for canonical" | Keep inline path with "as of v2.X.0" stamp + Learn link as primary fix source | Quick reference preserved; canonical link present; familiar pattern (Wikipedia "[citation needed]") | Still rots; visual chrome added; "as of" stamp ages too |
| **C** CI step that diff-checks paths against scraped MS Learn deep-links | Automated drift detection on every PR | Catches new rot at PR-time; objective signal | Scraping MS Learn is fragile; MS markup changes; ongoing maintenance cost; doesn't fix the existing rot |

## Decision: Option A

**Replace `remediation.portal.path` rendering with a Microsoft Learn deep-link as the primary remediation surface.** Inline UI breadcrumbs become best-effort secondary content, displayed only when no Learn URL is available.

### Why A wins

- **Microsoft owns the rot.** Learn URLs survive admin-center reorgs because Microsoft updates them in lockstep with the UI changes. We piggyback on Microsoft's documentation pipeline rather than running our own.
- **Single source of truth.** The Learn page links into the relevant portal config experience anyway. The user gets both the conceptual context and the deep-link in one place.
- **Already partially populated.** The registry's `remediation.references[].url` field already carries Microsoft Learn URLs for many checks. We're not introducing a new schema concept — we're promoting an existing field to the primary remediation surface.
- **Low blast radius.** Render-side change, no new collector contract, no breaking change to `Add-Setting`. The breadcrumb path remains in the data; only the visual treatment changes.

### Why not B

The "as-of" stamp still ages, just slower. It adds visual noise (more text per finding, second-class link styling, version stamp) without fixing the underlying issue. We'd be admitting the problem in the UI rather than solving it.

### Why not C

Scraping Microsoft Learn is a fragile maintenance burden — when Microsoft updates the Learn site's markup we're hand-fixing the scraper, which is the same class of problem as the original UI rot. Worse: a CI gate that breaks unrelated PRs because Microsoft renamed an h2 tag is corrosive to development velocity. Defer indefinitely.

## Schema proposal — minimal addition

Existing registry shape (already populated):

```jsonc
{
  "remediation": {
    "portal": {
      "path": "Microsoft Entra admin center > Protection > ..."
    },
    "references": [
      { "url": "https://learn.microsoft.com/...", "title": "Microsoft Learn — ..." }
    ]
  }
}
```

No schema change required — the data is already there. The change is in `report-app.jsx` rendering:

1. **Primary surface:** if `remediation.references[]` contains an MS Learn URL (matches `learn.microsoft.com`), render that as the headline remediation link with the title as link text.
2. **Secondary surface:** display `remediation.portal.path` as fine-print "Approximate menu path (may have moved):" below the link. Visually de-emphasized.
3. **Fallback:** if no Learn URL exists, render the path as the primary text (current behavior). This handles Group Policy paths (GPMC), PowerShell-only remediations, and other non-portal cases where there's no URL to point at.

Collector-side: `Add-Setting`'s explicit `Remediation` parameter remains a string fallback — no new collector parameter needed. When the registry has a Learn URL the report prefers it; the collector string is only rendered if the registry has no `references`.

## Phased plan

**Phase 1 (this PR is the decision artifact only — implementation is a separate PR):** Render-side change in `report-app.jsx` to prefer `references[].url` over `portal.path`. No data touched. Ship behind no flag — this is purely a visual improvement.

**Phase 2 (data sweep, separate sprint):** Walk the top-30 most-rendered checks (#854's set). For each, verify a `references[].url` entry exists pointing at the canonical Microsoft Learn page. File CheckID upstream issues for any check missing a Learn URL.

**Phase 3 (deferred):** Collector inline `Remediation` strings get a similar audit — promote URL-bearing remediations to use a `learn:` prefix convention or similar (TBD when phase 2 ships and we know what gaps exist).

## Track 3 — upstream coordination

The `remediation.portal.path` field is upstream-controlled (CheckID/SCF data). Local edits get clobbered on next sync. So:

- **Phase 1 (render-side)** lands in M365-Assess only. No upstream coordination required — we're changing how we render existing fields.
- **Phase 2 (data sweep)** files upstream issues against CheckID for missing Learn URLs. Follows the existing pattern from `feedback_no_local_renames_of_upstream_artifacts.md` — never edit upstream data locally.
- **The sync workflow** does not need an override layer. Path strings stay upstream-authoritative; we just stop relying on them as the primary user-facing remediation hint.

## Out of scope (deliberately)

- **The Track 1 sweep** (verifying all ~250 paths against current admin-centers) — that's Phase 2, separate sprint. This issue's acceptance criteria explicitly punt the sweep.
- **Per-cmdlet remediation strings** — PowerShell cmdlet names rot less than admin-center UIs. Lower priority; address opportunistically if a Phase 2 audit surfaces broken cmdlet names.
- **Replacing `portal.path` in the registry schema** — keep the field; just deprioritize its rendering. Other CheckID consumers may still rely on it.
- **Rendering a "verified as of vX.Y.Z" stamp on remediation** — Option B's fallback. We rejected it; don't bring it back as a sub-feature.

## Sources

- Issue #879 (this spike resolves)
- Issue #878 (concrete instance — ENTRA-SSPR-001 stale path)
- Issue #854 (top-30 most-rendered checks set — used by Phase 2 scope)
- `feedback_no_local_renames_of_upstream_artifacts.md` (upstream coordination rule)
- `src/M365-Assess/controls/registry.json` — `remediation.references[].url` field already populated for many checks
