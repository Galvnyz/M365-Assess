---
id: "EPIC-013"
source: "docs/portal-specs/01-feature-epics/EPIC-013-roles-pim-jit/SPEC.md"
section: "Portal skeleton (Session 1)"
severity: "high"
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
  - T-0241
  - T-0242
  - T-0243
  - T-0244
  - T-0245
  - T-0246
  - T-0247
  - T-0248
  - T-0249
scope_kind: "epic"
scope_note: "Rollup for Roles, PIM & JIT. Children are authored in ISSUES/ against the layout fixed in SPEC.md §1; scope: is empty by design (rollups are never dispatched)."
---

# EPIC-013 — Roles, PIM & JIT

## Report

Role assignments, PIM settings templates and schedule requests, and JIT admin.

Full functional specification: `docs/portal-specs/01-feature-epics/EPIC-013-roles-pim-jit/SPEC.md`.

Cluster: Identity. CIPP provenance: cipp-features.md #24,#27.

This is an epic rollup. It is **never dispatched** by the fleet tool; its children carry the
code. Children are authored into `ISSUES/` and name real `scope:` paths from SPEC.md §3-§8.

## Acceptance

- [x] SPEC.md sections 2-9 complete and approved.
- [x] Child tickets authored in `tickets/` with non-empty `scope:`.
- [x] All children closed before this epic is considered done.
