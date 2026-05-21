# 0007 — Skip individual collectors when their services are unavailable; never abort the run

- **Status:** Accepted
- **Date:** 2026-05-06

## Context

M365-Assess depends on six-plus separate Microsoft service connections: Microsoft Graph (multiple submodules), Exchange Online, SharePoint Online, Microsoft Teams, Microsoft Defender, Purview. Each is a separate OAuth flow, a separate session lifetime, a separate set of throttling rules, and a separate failure mode.

A real-world assessment can start successfully, get most of the way through, and then hit a partial-failure state:

- The user authenticated with permissions enough for Identity but not Defender.
- An EXO connection that was healthy at start-of-run timed out 30 minutes in.
- Network blip during the SharePoint connect step left SPO unreachable while everything else is fine.
- The tenant's Defender for Office isn't licensed, so the connect itself succeeds but every check returns 403.

The naïve responses both fail the user:

- **Abort the entire run on first failure.** Punishes a 90%-successful assessment because of one section. Consultants lose 25 minutes of accumulated data because Purview happened to be down.
- **Plough on regardless.** Section after section logs cryptic exceptions, the report renders with mystery blanks, and the user has no idea which findings are real vs. ghosts.

We needed a middle path: keep going wherever we can, but be **loud about what we skipped and why**.

## Decision

The orchestrator (`Invoke-M365Assessment.ps1`) maintains a `$failedServices` set populated by `Connect-RequiredService` whenever a service connection fails. Then, at two granularities:

**Section-level skip** — if **all** of a section's required services are in `$failedServices`, the entire section is skipped:

- Each collector in that section emits a `Skipped` row to the summary with `Error = "<services> not connected"`.
- Each is logged at WARN level: `Skipped: <Collector> — <services> not connected`.
- The DNS deferred phase is also skipped if the Email section's services failed (since DNS depends on Email's domain prefetch — see [ADR-0003](0003-dns-section-runs-last-with-prefetch.md)).
- The orchestrator `continue`s to the next section.

**Collector-level skip (just-in-time)** — if a collector declares `RequiredServices` (per-collector hashtable key) and any of those are in `$failedServices`:

- Just that collector emits a `Skipped` row + WARN log.
- Sibling collectors in the same section keep running.
- This handles the mixed case where, say, an Identity collector needs only Graph and another needs Graph + EXO.

Both paths produce structured `Skipped` summary rows that flow into:

- The orchestrator's run summary table (visible at console).
- The `_PermissionDeficits.json` artifact ([`Test-GraphPermissions.ps1`](../../src/M365-Assess/Orchestrator/Test-GraphPermissions.ps1)) that the HTML report's Permissions panel and the evidence package consume.
- The HTML report's Permissions panel, where each missing scope is mapped back to the section(s) it would have unlocked.

See: [`src/M365-Assess/Invoke-M365Assessment.ps1`](../../src/M365-Assess/Invoke-M365Assessment.ps1) (around the `allSectionServicesFailed` and per-collector `RequiredServices` blocks) and [`Connect-RequiredService.ps1`](../../src/M365-Assess/Orchestrator/Connect-RequiredService.ps1).

## Consequences

**Positive**

- Partial-permission tenants get a partial-but-honest report instead of either a crash or a misleading "Pass" against unverified data.
- The `Skipped` status (see [ADR-0005](0005-nine-status-taxonomy.md)) is a first-class output, not an exception. It's excluded from the Pass% denominator, so a 403-heavy run doesn't poison the score.
- The Permissions panel + `_PermissionDeficits.json` give the user a clear "you'd unlock these checks if you granted scope X" remediation path.
- The orchestrator never aborts. A 30-minute run produces *something* even if half the services failed — useful for triage.
- `Skipped` (services unavailable) is differentiated from `Skipped` (user opted out via `-Section`) by the WARN-level log + summary row. Same status value, different evidence.

**Negative**

- Reports from partial runs *look* like full runs to a casual viewer. A consultant skimming the HTML can miss the "30% of sections were Skipped" reality unless they read the Permissions panel. We've added warnings to the executive summary for this reason, but it's still possible to misread the headline.
- The Pass% denominator excludes `Skipped`, which is right (don't punish for missing data) but creates a perverse incentive: a tenant with poor permissions sees a high Pass% because only the easy checks ran. The CHECK-STATUS-MODEL.md doc and the report's per-section coverage indicators address this, but it's a real gotcha.
- Per-collector `RequiredServices` is opt-in metadata. Collectors that don't declare it inherit section-level skip behaviour, which can be too coarse: an Identity collector that only needs Graph won't skip when only EXO failed, but if some sibling Identity collectors also need EXO, the orchestrator currently runs the section anyway and the EXO-needing collectors fail individually.
- Mixed sections (some collectors with `RequiredServices`, some without) trigger an explicit "connect section-level services upfront so un-annotated collectors are never dispatched without a connection" path. Adds branch complexity to the orchestrator.

**Failure modes and mitigations**

- *Service connect appears to succeed but the actual data calls 403* → connect-time check passes, individual collector calls fail. Each collector catches and emits `Unknown` per-finding (not `Skipped`), so the report still distinguishes "could not connect at all" from "connected but no data". `Test-GraphPermissions` runs the per-section scope deficit warning before any collector executes, so most of these are surfaced at start-of-run.
- *`$failedServices` is mutated mid-section by a per-collector connect attempt* → subsequent collectors in the same section observe the new failure and skip. Behaviour is correct but order-dependent; collectors are dispatched in registry order.
- *Network flake: service fails on first attempt, would have worked on retry* → currently we don't retry. Connect failures are sticky for the run. Considered worth adding bounded retry to `Connect-RequiredService`, but no concrete issue yet.

## Alternatives considered

- **Abort the assessment on first connect failure.** Rejected: see Context — fail-fast is hostile to partial-permission tenants and wastes accumulated data.
- **Continue silently; let collectors throw exceptions per-call.** Rejected: report quality collapses (the "mystery blanks" problem). Also makes baseline diff useless because each run has a different shape of "checks present".
- **Mark all checks in the failed section as `Unknown` instead of `Skipped`.** Considered. Rejected because `Unknown` implies "we tried to collect and the attempt failed at the data layer", whereas `Skipped` means "we didn't attempt this collector at all". The distinction matters for re-run guidance: `Unknown` says "fix permissions and rerun"; `Skipped` says "the connect itself failed, fix that first".
- **Auto-retry the failed connection N times before giving up.** Deferred. Worth doing for transient flakes but adds complexity (per-service retry policies, session-token refresh, throttling-aware backoff). Not blocking the current decision.
- **Per-check `RequiredServices` (finer-grained than per-collector).** Rejected. Per-collector is the right abstraction — a collector that needs Graph + EXO needs both for *every* check it emits; splitting per-check would be over-engineered.

---

## See also

- [`../../src/M365-Assess/Invoke-M365Assessment.ps1`](../../src/M365-Assess/Invoke-M365Assessment.ps1) — section + collector skip logic
- [`../../src/M365-Assess/Orchestrator/Connect-RequiredService.ps1`](../../src/M365-Assess/Orchestrator/Connect-RequiredService.ps1) — populates `$failedServices`
- [`../../src/M365-Assess/Orchestrator/Test-GraphPermissions.ps1`](../../src/M365-Assess/Orchestrator/Test-GraphPermissions.ps1) — pre-flight scope deficit warnings + `_PermissionDeficits.json`
- [`0003-dns-section-runs-last-with-prefetch.md`](0003-dns-section-runs-last-with-prefetch.md) — DNS-deferred logic that interacts with section skip
- [`0005-nine-status-taxonomy.md`](0005-nine-status-taxonomy.md) — `Skipped` vs `Unknown` semantics that this decision relies on
- [`README.md`](README.md) — back to the ADR index
