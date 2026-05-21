# 0010 — Baseline diff keys on the sub-numbered CheckId; cross-version comparisons use intersect-only mode

- **Status:** Accepted
- **Date:** 2026-05-06

## Context

Baseline comparison is the "did anything regress?" feature: a saved baseline from a previous run is compared against the current run, and each check is classified as `Regressed` / `Improved` / `Modified` / `New` / `Removed` (or `Unchanged`, which is dropped from the output). For the feature to be useful, a check in run A must be matched up to its counterpart in run B.

The matching is harder than it looks because of two properties of M365-Assess:

1. **CheckIds are sub-numbered per-setting at the helper level.** [ADR-0002](0002-sub-numbered-check-ids.md) describes this: a single upstream `CA-REPORTONLY-001` becomes `CA-REPORTONLY-001.1`, `.2`, `.3` ... — one row per CA policy evaluated. The sub-number is *order-dependent* within a run. If Graph happens to return CA policies in a different order tomorrow than it did today, `CA-REPORTONLY-001.1` refers to a different policy on each run, and a naïve diff would scream "everything changed."
2. **The control registry is upstream-synced** ([ADR-0001](0001-checkid-sync-vs-fork.md)). When CheckID ships a new version, checks get added, renamed, retired. A run from before the sync compared to a run from after the sync sees those upstream changes as "drift" — but they're not posture changes, they're schema changes.

We needed a join key that:

- Is stable across runs against the same tenant (so the diff matches on real changes).
- Survives upstream registry version bumps without producing pages of bogus drift entries.
- Doesn't require the user to manually align check IDs after each upstream sync.

## Decision

Two pieces:

**1. Diff keys on `row.CheckId` directly — the sub-numbered form.**

`Compare-AssessmentBaseline` builds two lookup tables (`baselineMap` and `currentMap`), both keyed on the CheckId field as it appears in the saved JSON / current CSV. That field is always the sub-numbered string (`CA-REPORTONLY-001.1`).

The pragmatic justification: *Microsoft Graph is order-stable in practice*. Repeated calls to the same endpoint with the same parameters return objects in the same order, run after run, against the same tenant. The sub-numbering is therefore stable in observed behaviour even though it's not stable in theory. We accept the brittleness in exchange for not having to compute a per-collector "natural identifier" (policy name, role definition ID, sharing-link target, etc.) for every check.

**2. Cross-version comparisons switch to intersect-only mode.**

The baseline manifest stores `RegistryVersion` (the `dataVersion` from `controls/registry.json` at the time the baseline was captured). At diff time, `Compare-AssessmentBaseline` compares this against the current registry version. If they differ:

- The diff is computed only over the **intersection** of CheckIds present in both snapshots.
- New CheckIds in the current run (that didn't exist in the baseline) are *not* reported as `New`.
- Removed CheckIds (that existed in the baseline but not the current run) are *not* reported as `Removed`.

The reasoning: when registry versions differ, `New`/`Removed` are dominated by upstream schema churn, not policy drift. Reporting them is noise. A user comparing v3.2 against v3.4 of the registry doesn't want to see "37 new findings" if 35 of those are checks the upstream just added.

See: [`src/M365-Assess/Orchestrator/Compare-AssessmentBaseline.ps1`](../../src/M365-Assess/Orchestrator/Compare-AssessmentBaseline.ps1).

## Consequences

**Positive**

- Implementation is cheap: dictionary lookup by CheckId, no per-collector identifier extraction logic.
- Cross-version mode keeps the diff signal-to-noise ratio sane after every CheckID sync. A registry bump adds 5-10 checks routinely; without intersect mode, every drift report after a sync would be unreadable.
- The baseline manifest carrying `RegistryVersion` makes the cross-version detection automatic — the user doesn't have to opt in.
- Same-version comparisons (the common case) get the full `New` / `Removed` classification, which is genuinely useful for "we expanded coverage in this section" narratives.

**Negative**

- *Theoretical* bug: if Graph ever returns CA policies in a different order between runs, `CA-REPORTONLY-001.1` would point at a different policy and the diff would lie. We have not seen this in practice, but we don't have a regression test for it either. [ADR-0002](0002-sub-numbered-check-ids.md) flags the risk; [ADR-0010](0010-baseline-diff-key-strategy.md) (this one) accepts it as the tradeoff for implementation simplicity.
- Cross-version intersect mode hides a real signal: "you upgraded and now have 35 new checks" is information a consultant might want. The current report doesn't surface this — it just quietly drops them. We accept that this is the right default for the diff-as-drift-detection use case but acknowledge it might want a separate "schema-change report" mode.
- The choice is collector-class-dependent without surfacing the dependency. Collectors that emit one row per registry CheckId (no sub-numbering — e.g. tenant-wide settings) are fine. Collectors that emit many sub-numbered rows are exposed to the order-stability assumption. The line between the two isn't visible in the diff output.
- A registry-version field error (e.g. baseline manifest written without the field) silently falls back to same-version mode, which can produce noisy diffs after a sync. The fallback is "if either version is empty, treat as same-version" — that's the wrong default for safety, but right for backward compatibility with old baselines.

**Failure modes and mitigations**

- *Graph response order shuffles between two runs against the same tenant* → diff reports phantom Regressed/Improved entries. No current mitigation. Would surface as "drift entries that don't make sense when the user spot-checks the named policies." If we ever see this in the wild, the fix is per-collector natural-key derivation.
- *Baseline file lacks `RegistryVersion` (saved by an old M365-Assess)* → cross-version detection silently disables; old baselines compared against new runs report all upstream-added checks as `New`. Mitigation: documented in `Compare-AssessmentBaseline` synopsis; users see the noise and ask, at which point the answer is "save a fresh baseline post-upgrade."
- *Sub-numbered CheckIds collide between two collectors* (would require both collectors to use the same upstream CheckId base — currently impossible by registry shape, but not enforced) → mitigation: the registry has unique `checkId` per check at v2.0.0 schema, so this can't happen unless the registry itself breaks invariants.

## Alternatives considered

- **Key on `(Setting, Category)` tuple instead of CheckId.** Considered. Rejected because `Setting` is a free-text human-readable string set by the collector author; renaming a setting in the source code would break every existing baseline overnight. CheckId is more durable.
- **Compute a "natural key" per collector (e.g. policy displayName for CA, role definition ID for PIM).** Rejected for now: would require every collector to emit a stable identifier alongside its findings, which is 250+ touchpoints. The pragmatic choice is to live with the sub-numbered key until we have evidence the order-stability assumption is breaking.
- **Treat schema changes as drift in cross-version mode.** Rejected: see Consequences. The `New`/`Removed` from a registry sync would dominate the report. The user wants drift-as-policy-change, not drift-as-tool-version.
- **Refuse to compare across versions; force the user to save a fresh baseline post-upgrade.** Rejected: most upgrades are minor (a handful of new checks) and the user wants to see continuity. Forcing a fresh baseline throws away weeks of trend data.
- **Surface the schema-change set as a separate panel in the report ("12 new checks were added since your last baseline").** Worth doing eventually. Currently not implemented; cross-version intersect just silently drops them. Would be a non-breaking enhancement.

---

## See also

- [`../../src/M365-Assess/Orchestrator/Compare-AssessmentBaseline.ps1`](../../src/M365-Assess/Orchestrator/Compare-AssessmentBaseline.ps1) — the diff implementation
- [`../../src/M365-Assess/Common/Get-BaselineTrend.ps1`](../../src/M365-Assess/Common/Get-BaselineTrend.ps1) — sibling code, aggregates per-status counts across snapshots (uses tenant-folder matching, not CheckId join)
- [`0002-sub-numbered-check-ids.md`](0002-sub-numbered-check-ids.md) — the sub-numbering scheme this diff strategy depends on
- [`0001-checkid-sync-vs-fork.md`](0001-checkid-sync-vs-fork.md) — the upstream-sync model that motivates cross-version mode
- [`README.md`](README.md) — back to the ADR index
