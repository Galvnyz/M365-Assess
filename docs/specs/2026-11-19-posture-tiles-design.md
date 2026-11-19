# Posture Tiles Redesign — Design Spec

**Issue:** #1060
**Date:** 2026-11-19
**Status:** Approved 2026-11-19
**Mockup:** [`docs/design/posture-tiles/`](../design/posture-tiles/README.md)

## Problem

The summary row under the Posture block (`ExecSummaryRow` in `assets/report/01-Briefing.jsx`) shows four fixed tiles: Privileged roles, Device compliance, Email authentication, External exposure. Each tile reads one loose field from `REPORT_DATA` and turns it into a number and a colour. Live lab testing showed what that costs:

- A Compromise-only run showed a green "0 guests" because `USERS.GuestUsers` was missing and defaulted to `0`. PR #1059 removes that case, but the design has no general way to say "not collected".
- On a partial run, External exposure turned green from the guest count alone while the SharePoint and Teams sharing checks never ran.
- No tile links to the findings that produce its number.
- The four areas are chosen by which data fields exist, not by risk. Conditional Access, legacy authentication and app consent have no tile.

## Decision

**Derive every tile from the findings behind it and the collectors that ran**, never from a loose field. A tile is a named group of checks. Its state, counts, "weakest item" and click target all come from those checks' statuses, and its "not collected" state comes from `REPORT_DATA.collection.collectors`. Supporting figures (admins without MFA, DMARC enforced, devices compliant, guest accounts) are secondary lines, shown only when their data was collected.

## Tile set

Fixed order by blast radius. Membership is by check-ID prefix, so new checks in a family join their tile automatically.

| Tile | Check prefixes | Depends on sections | Supporting line |
|---|---|---|---|
| Admin protection | `CA-MFA-ADMIN-`, `CA-PHISHRES-`, `ENTRA-ADMIN-`, `ENTRA-PIM-`, `ENTRA-BREAKGLASS-`, `ENTRA-STALEADMIN-`, `ENTRA-CLOUDADMIN-`, `ENTRA-SYNCADMIN-`, `ENTRA-ROLEGROUP-`, `CA-EXCLUSION-` | Identity, Security | admins without MFA (`mfaStats`) |
| Sign-in protection | `CA-MFA-ALL-`, `CA-LEGACYAUTH-`, `CA-SIGNINRISK-`, `CA-USERRISK-`, `ENTRA-SECDEFAULT-`, `ENTRA-MFA-` | Identity | users with no MFA method (`mfaStats`) |
| Apps and consent | `ENTRA-CONSENT-`, `ENTRA-ENTAPP-`, `ENTRA-APPS-` | Identity, Security | — |
| Email security | `DNS-SPF-`, `DNS-DKIM-`, `DNS-DMARC-`, `EXO-FORWARD-`, `DEFENDER-ANTIPHISH-`, `DEFENDER-SAFELINKS-`, `DEFENDER-SAFEATTACH-` | Email, Security | domains enforcing DMARC (`dns`) |
| External access | `ENTRA-GUEST-`, `SPO-SHARING-`, `TEAMS-EXTACCESS-` | Identity, Collaboration | guest accounts (`users`) |
| Devices | `INTUNE-COMPLIANCE-`, `INTUNE-ENROLL`, `ENTRA-DEVICE-` | Intune, Identity | devices compliant (`deviceStats`) |
| Audit and investigation | `EXO-AUDIT-`, `COMPLIANCE-AUDIT-`, `PURVIEW-AUDIT-` | Email, Security | — |

## States

Evaluated in this order. Only `good` is green.

| State | Verdict | When |
|---|---|---|
| `missing` | Not collected | No checks for the tile, and none of its sections ran. Shows which section to run. |
| `na` | Nothing to check / Not licensed | No checks although a section ran; or every check is `NotLicensed`. |
| `missing` | Not measured | Checks exist but none is Pass, Fail or Warning (all skipped, unknown or awaiting a person). |
| `bad` | At risk | Any Fail with critical or high severity. |
| `warn` | Needs work | Any other Fail or Warning. |
| `partial` | Partly measured | No gaps among what was measured, but something was not: a check not measured or awaiting a person, a collector that was Partial, or one of the tile's sections not run. The bar's pass segment is dimmed. |
| `good` | No gaps found | Every check measured and passing, every dependent section ran, every collector complete. |

Each tile shows: verdict; "X of Y scored checks pass" with a segmented bar (pass, warning, fail, awaiting a person, not measured); the supporting line or "Supporting data not collected"; the weakest item (first Fail by severity, then Warnings) with "+N more"; and a footer "From N checks · 2 not measured · Collaboration not run · partial collection: …".

**Collapse rule:** if every tile is `missing` (no configuration section ran), the row is replaced by one sentence instead of seven grey tiles.

## Interaction

A tile with checks is a `<button>`. Clicking it sets a new findings filter, `filters.area = { id, label, checkIds }`, scrolls to All findings, and shows a removable chip "Area: Admin protection". `area` joins the existing `status / severity / framework / domain / profile` filters in `05-Appendix.jsx` (`setFilters`) and the persisted filter key. Tiles without checks are not interactive.

## Consistency with the briefing

- Tiles colour by Fail severity using the same `severity` values and the same `NON_REMEDIATION_STATUSES` and `scoreDenom()` helpers the briefing uses, so a tile can be "At risk" only if it contains an open critical or high Fail.
- "Scored" means Pass, Fail or Warning everywhere, matching the strict denominator (`#802`).
- Compromise indicators never appear in this row, as a tile or in any tile's counts. The briefing's indicator summary (#1059) is the one place the hunt result is shown. When the row collapses on a run where only the hunt ran, the collapse sentence points to that summary.

## Implementation notes

- Port `TILE_DEFS`, `deriveTile()` and `deriveRow()` from `docs/design/posture-tiles/posture-tiles.js` into a new source file `assets/report/06-PostureTiles.jsx`, registered in `assets/report-sources.json` before `05-Appendix.jsx`. Keeping it separate keeps `01-Briefing.jsx` under the 1000-line build limit.
- Replace `ExecSummaryRow` in `01-Briefing.jsx` with a React rendering of `deriveRow()`. Do not port the mockup's string-built HTML.
- Fold `docs/design/posture-tiles/posture-tiles.css` (the `.pt-*` rules, not the page-chrome block) into `assets/report-shell.css`.
- Tests: `node --test` unit tests for `deriveTile()` covering every state, using the three mockup scenarios as fixtures; a jsdom render test that a Compromise-only `REPORT_DATA` shows the collapse sentence and no green tile.
- Same PR, separate commit: the existing ~87px horizontal overflow at 1024px, which comes from `.filter-bar` and one `.card` (measured during #1058 live testing; unrelated to the tiles).

## Decisions

- **Compromise hunt: briefing only.** No hunt tile in this row. The briefing summary from #1059 already leads with the hunt result, and a second copy here would mix configuration and compromise in one row.
- **Tile membership: by prefix, as listed.** `ENTRA-PIM-002` (guest access reviews) stays under Admin protection with the rest of its family. Membership can be refined later without changing the state rules.
- **Seven tiles**, in the order above. Audit and investigation stays separate from Email security.
- **Supporting lines as listed:** admins without MFA, users with no MFA method, domains enforcing DMARC, guest accounts, devices compliant.

## Out of scope

- Changing which checks exist or how they are scored.
- The Microsoft Secure Score card and KPI strip in the Posture block.
- Framework quilt readiness labels for frameworks with nothing assessed (noted on #1059).
