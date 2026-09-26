---
id: "EPIC-010"
source: "docs/portal-specs/01-feature-epics/EPIC-010-baselines-rollouts/SPEC.md"
section: "Portal skeleton (Session 1)"
severity: "medium"
status: "closed"
original_status: "declared"
parent: ""
scope: []
tests: []
related: []
depends_on:
  - EPIC-008
needs_scope_review: true
children:
  - T-0181
  - T-0182
  - T-0183
  - T-0184
  - T-0185
  - T-0186
  - T-0187
  - T-0188
  - T-0189
  - T-0190
scope_kind: "epic"
scope_note: "Rollup for Baselines & Rollouts. Children are authored in ISSUES/ against the layout fixed in SPEC.md §1; scope: is empty by design (rollups are never dispatched)."
---

# EPIC-010 — Baselines & Rollouts

## Report

Staged rollouts of standards with fleet overview, stage progress, history, and trend.

Full functional specification: `docs/portal-specs/01-feature-epics/EPIC-010-baselines-rollouts/SPEC.md`.

Cluster: Standards. CIPP provenance: cipp-features.md #8; cipp-standards-ux §7.

This is an epic rollup. It is **never dispatched** by the fleet tool; its children carry the
code. Children are authored directly into `ISSUES/` once SPEC.md §3-§6 fix the file layout and
real `scope:` paths can be named.

## Acceptance

- [x] SPEC.md sections 2-9 complete and approved.
- [x] Child tickets authored in `tickets/` with non-empty `scope:`.
- [x] All children closed before this epic is considered done.
