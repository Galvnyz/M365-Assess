---
id: "EPIC-007"
source: "docs/portal-specs/01-feature-epics/EPIC-007-scheduler-custom-scripts/SPEC.md"
section: "Portal skeleton (Session 1)"
severity: "high"
status: "epic"
original_status: "declared"
parent: ""
scope: []
tests: []
related: []
depends_on:
  - EPIC-003
needs_scope_review: true
children:
  - T-0121
  - T-0122
  - T-0123
  - T-0124
  - T-0125
  - T-0126
  - T-0127
  - T-0128
  - T-0129
  - T-0130
scope_kind: "epic"
scope_note: "Rollup for Scheduler & Custom Scripts. Children are authored in ISSUES/ against the layout fixed in SPEC.md §1; scope: is empty by design (rollups are never dispatched)."
---

# EPIC-007 — Scheduler & Custom Scripts

## Report

Cron scheduling for runs/standards/reports, plus sandboxed custom PowerShell scripts.

Full functional specification: `docs/portal-specs/01-feature-epics/EPIC-007-scheduler-custom-scripts/SPEC.md`.

Cluster: Platform. CIPP provenance: cipp-features.md #49-#50.

This is an epic rollup. It is **never dispatched** by the fleet tool; its children carry the
code. Children are authored into `ISSUES/` (`T-NNNN.md`) once SPEC.md §3-§6 fix the file layout
and real `scope:` paths can be named.

## Acceptance

- [x] SPEC.md sections 2-9 complete and approved.
- [x] Child tickets authored in `tickets/` with non-empty `scope:`.
- [x] All children closed before this epic is considered done.
