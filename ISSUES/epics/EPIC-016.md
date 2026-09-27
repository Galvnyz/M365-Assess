---
id: "EPIC-016"
source: "docs/portal-specs/01-feature-epics/EPIC-016-intune-policies/SPEC.md"
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
  - T-0301
  - T-0302
  - T-0303
  - T-0304
  - T-0305
  - T-0306
  - T-0307
  - T-0308
  - T-0309
  - T-0310
scope_kind: "epic"
scope_note: "Rollup for Intune Policies. Children are authored in ISSUES/ against the layout fixed in SPEC.md §1; scope: is empty by design (rollups are never dispatched)."
---

# EPIC-016 — Intune Policies

## Report

Intune config/compliance/app-protection policies, templates, reusable settings, assignment filters, and comparison.

Full functional specification: `docs/portal-specs/01-feature-epics/EPIC-016-intune-policies/SPEC.md`.

Cluster: Devices. CIPP provenance: cipp-features.md #12.

This is an epic rollup. It is **never dispatched** by the fleet tool; its children carry the
code. Children are authored directly into `ISSUES/` with `parent: "EPIC-016"`; the `children:`
list above names them in dependency order.

## Acceptance

- [x] SPEC.md sections 2-9 complete and approved.
- [x] Child tickets authored in `tickets/` with non-empty `scope:`.
- [x] All children closed before this epic is considered done.
