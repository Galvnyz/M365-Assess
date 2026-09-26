---
id: "EPIC-014"
source: "docs/portal-specs/01-feature-epics/EPIC-014-groups/SPEC.md"
section: "Portal skeleton (Session 1)"
severity: "medium"
status: "closed"
original_status: "declared"
parent: ""
scope: []
tests: []
related: []
depends_on:
  - EPIC-011
needs_scope_review: true
children:
  - T-0261
  - T-0262
  - T-0263
  - T-0264
  - T-0265
  - T-0266
  - T-0267
  - T-0268
  - T-0269
  - T-0270
scope_kind: "epic"
scope_note: "Rollup for Groups. Children are authored in ISSUES/ against the layout fixed in SPEC.md §1; scope: is empty by design (rollups are never dispatched)."
---

# EPIC-014 — Groups

## Report

Group lifecycle, templates, bulk membership, licensing, hide-from-GAL, delivery management.

Full functional specification: `docs/portal-specs/01-feature-epics/EPIC-014-groups/SPEC.md`.

Cluster: Identity. CIPP provenance: cipp-features.md #26.

This is an epic rollup. It is **never dispatched** by the fleet tool; its children carry the
code. Children are authored directly into `ISSUES/` with `parent: "EPIC-014"`; the `children:`
list above names them in dependency order.

## Acceptance

- [x] SPEC.md sections 2-9 complete and approved.
- [x] Child tickets authored in `tickets/` with non-empty `scope:`.
- [x] All children closed before this epic is considered done.
