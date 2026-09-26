---
id: "EPIC-015"
source: "docs/portal-specs/01-feature-epics/EPIC-015-conditional-access/SPEC.md"
section: "Portal skeleton (Session 1)"
severity: "high"
status: "closed"
original_status: "declared"
parent: ""
scope: []
tests: []
related: []
depends_on:
  - EPIC-002
needs_scope_review: true
children:
  - T-0281
  - T-0282
  - T-0283
  - T-0284
  - T-0285
  - T-0286
  - T-0287
  - T-0288
  - T-0289
  - T-0290
scope_kind: "epic"
scope_note: "Rollup for Conditional Access. Children are authored in ISSUES/ against the layout fixed in SPEC.md §1; scope: is empty by design (rollups are never dispatched)."
---

# EPIC-015 — Conditional Access

## Report

CA policy CRUD, templates, named locations, report-only evaluation, and coverage reporting.

Full functional specification: `docs/portal-specs/01-feature-epics/EPIC-015-conditional-access/SPEC.md`.

Cluster: Identity. CIPP provenance: cipp-features.md #11.

This is an epic rollup. It is **never dispatched** by the fleet tool; its children carry the
code. Children are authored directly into `ISSUES/` with `parent: "EPIC-015"`; the `children:`
list above names them in dependency order.

## Acceptance

- [x] SPEC.md sections 2-9 complete and approved.
- [x] Child tickets authored in `tickets/` with non-empty `scope:`.
- [x] All children closed before this epic is considered done.
