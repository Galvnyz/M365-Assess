---
id: "EPIC-004"
source: "docs/portal-specs/01-feature-epics/EPIC-004-dashboard-widgets/SPEC.md"
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
needs_scope_review: true
children:
  - T-0061
  - T-0062
  - T-0063
  - T-0064
  - T-0065
  - T-0066
  - T-0067
  - T-0068
  - T-0069
  - T-0070
scope_kind: "epic"
scope_note: "Rollup for Dashboard & Widgets. Children are authored in ISSUES/ against the layout fixed in SPEC.md §1; scope: is empty by design (rollups are never dispatched)."
---

# EPIC-004 — Dashboard & Widgets

## Report

Per-tenant and all-tenant dashboards with configurable widgets (score, MFA, licenses, alerts).

Full functional specification: `docs/portal-specs/01-feature-epics/EPIC-004-dashboard-widgets/SPEC.md`.

Cluster: Platform. CIPP provenance: cipp-features.md #47; cipp-ui-patterns §6.

This is an epic rollup. It is **never dispatched** by the fleet tool; its children carry the
code. Children are authored into `ISSUES/` (`T-NNNN.md`) once SPEC.md §3-§6 fix the file layout
and real `scope:` paths can be named.

## Acceptance

- [x] SPEC.md sections 2-9 complete and approved.
- [x] Child tickets authored in `tickets/` with non-empty `scope:`.
- [x] All children closed before this epic is considered done.
