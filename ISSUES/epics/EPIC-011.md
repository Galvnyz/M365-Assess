---
id: "EPIC-011"
source: "docs/portal-specs/01-feature-epics/EPIC-011-users-offboarding/SPEC.md"
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
  - T-0201
  - T-0202
  - T-0203
  - T-0204
  - T-0205
  - T-0206
  - T-0207
  - T-0208
  - T-0209
  - T-0210
scope_kind: "epic"
scope_note: "Rollup for Users & Offboarding. Children are authored in ISSUES/ against the layout fixed in SPEC.md §1; scope: is empty by design (rollups are never dispatched)."
---

# EPIC-011 — Users & Offboarding

## Report

User lifecycle: create/edit/bulk/patch, templates, disable, BEC remediation, and the offboarding wizard.

Full functional specification: `docs/portal-specs/01-feature-epics/EPIC-011-users-offboarding/SPEC.md`.

Cluster: Identity. CIPP provenance: cipp-features.md #22,#25,#28,#54.

This is an epic rollup. It is **never dispatched** by the fleet tool; its children carry the
code. Children are authored into `ISSUES/` and name real `scope:` paths from SPEC.md §3-§8.

## Acceptance

- [x] SPEC.md sections 2-9 complete and approved.
- [x] Child tickets authored in `tickets/` with non-empty `scope:`.
- [x] All children closed before this epic is considered done.
