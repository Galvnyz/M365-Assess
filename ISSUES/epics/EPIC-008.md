---
id: "EPIC-008"
source: "docs/portal-specs/01-feature-epics/EPIC-008-standards-templates/SPEC.md"
section: "Portal skeleton (Session 1)"
severity: "critical"
status: "epic"
original_status: "declared"
parent: ""
scope: []
tests: []
related: []
depends_on:
  - EPIC-006
  - EPIC-003
  - EPIC-007
needs_scope_review: true
children:
  - T-0141
  - T-0142
  - T-0143
  - T-0144
  - T-0145
  - T-0146
  - T-0147
  - T-0148
  - T-0149
  - T-0150
scope_kind: "epic"
scope_note: "Rollup for Standards Templates. Children are authored in ISSUES/ against the layout fixed in SPEC.md §1; scope: is empty by design (rollups are never dispatched)."
---

# EPIC-008 — Standards Templates

## Report

Desired-state templates with report/alert/remediate actions, 3-tier precedence, scheduled enforcement, and licence gating.

Full functional specification: `docs/portal-specs/01-feature-epics/EPIC-008-standards-templates/SPEC.md`.

Cluster: Standards. CIPP provenance: cipp-features.md #6,#9,#21; cipp-standards-ux §2-3.

This is an epic rollup. It is **never dispatched** by the fleet tool; its children carry the
code. Children are authored directly into `ISSUES/` once SPEC.md §3-§6 fix the file layout and
real `scope:` paths can be named.

## Acceptance

- [x] SPEC.md sections 2-9 complete and approved.
- [x] Child tickets authored in `tickets/` with non-empty `scope:`.
- [x] All children closed before this epic is considered done.
