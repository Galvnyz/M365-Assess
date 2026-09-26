---
id: "EPIC-009"
source: "docs/portal-specs/01-feature-epics/EPIC-009-drift-management/SPEC.md"
section: "Portal skeleton (Session 1)"
severity: "high"
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
  - T-0161
  - T-0162
  - T-0163
  - T-0164
  - T-0165
  - T-0166
  - T-0167
  - T-0168
  - T-0169
  - T-0170
scope_kind: "epic"
scope_note: "Rollup for Drift Management. Children are authored in ISSUES/ against the layout fixed in SPEC.md §1; scope: is empty by design (rollups are never dispatched)."
---

# EPIC-009 — Drift Management

## Report

Full desired-state comparison per tenant with deviation triage (accept / customer-specific / deny).

Full functional specification: `docs/portal-specs/01-feature-epics/EPIC-009-drift-management/SPEC.md`.

Cluster: Standards. CIPP provenance: cipp-features.md #7; cipp-standards-ux §4-6.

This is an epic rollup. It is **never dispatched** by the fleet tool; its children carry the
code. Children are authored directly into `ISSUES/` once SPEC.md §3-§6 fix the file layout and
real `scope:` paths can be named.

## Acceptance

- [x] SPEC.md sections 2-9 complete and approved.
- [x] Child tickets authored in `tickets/` with non-empty `scope:`.
- [x] All children closed before this epic is considered done.
