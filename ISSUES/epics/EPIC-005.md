---
id: "EPIC-005"
source: "docs/portal-specs/01-feature-epics/EPIC-005-executive-reports/SPEC.md"
section: "Portal skeleton (Session 1)"
severity: "high"
status: "closed"
original_status: "declared"
parent: ""
scope: []
tests: []
related: []
depends_on:
  - EPIC-003
  - EPIC-004
needs_scope_review: true
children:
  - T-0081
  - T-0082
  - T-0083
  - T-0084
  - T-0085
  - T-0086
  - T-0087
  - T-0088
  - T-0089
  - T-0090
scope_kind: "epic"
scope_note: "Rollup for Executive/PDF Reports & Report Builder. Children are authored in ISSUES/ against the layout fixed in SPEC.md §1; scope: is empty by design (rollups are never dispatched)."
---

# EPIC-005 — Executive/PDF Reports & Report Builder

## Report

Branded executive PDF/HTML reports and a drag-in-blocks report builder with templates and scheduling.

Full functional specification: `docs/portal-specs/01-feature-epics/EPIC-005-executive-reports/SPEC.md`.

Cluster: Platform. CIPP provenance: cipp-features.md #48; cipp-ui-patterns §8.

This is an epic rollup. It is **never dispatched** by the fleet tool; its children carry the
code. Children are authored into `ISSUES/` (`T-NNNN.md`) once SPEC.md §3-§6 fix the file layout
and real `scope:` paths can be named.

## Acceptance

- [x] SPEC.md sections 2-9 complete and approved.
- [x] Child tickets authored in `tickets/` with non-empty `scope:`.
- [x] All children closed before this epic is considered done.
