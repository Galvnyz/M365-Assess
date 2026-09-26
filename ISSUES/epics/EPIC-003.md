---
id: "EPIC-003"
source: "docs/portal-specs/01-feature-epics/EPIC-003-assessment-runs/SPEC.md"
section: "Portal skeleton (Session 1)"
severity: "high"
status: "closed"
original_status: "declared"
parent: ""
scope: []
tests: []
related: []
depends_on:
  - EPIC-001
  - EPIC-002
needs_scope_review: true
children:
  - T-0041
  - T-0042
  - T-0043
  - T-0044
  - T-0045
  - T-0046
  - T-0047
  - T-0048
  - T-0049
  - T-0050
  - T-0051
  - T-0052
scope_kind: "epic"
scope_note: "Rollup for Assessment Runs & Queue. Children are authored in ISSUES/ against the layout fixed in SPEC.md §1; scope: is empty by design (rollups are never dispatched)."
---

# EPIC-003 — Assessment Runs & Queue

## Report

Trigger, queue, execute, and track assessment runs across many tenants, surfacing progress.

Full functional specification: `docs/portal-specs/01-feature-epics/EPIC-003-assessment-runs/SPEC.md`.

Cluster: Platform. CIPP provenance: cipp-features.md #49; 01-architecture §3.

This is an epic rollup. It is **never dispatched** by the fleet tool; its children carry the
code. Children are authored into `ISSUES/` with `parent: "EPIC-003"` once SPEC.md §3-§6 fix the
file layout and real `scope:` paths can be named.

## Acceptance

- [x] SPEC.md sections 2-9 complete and approved.
- [x] Child tickets authored in `tickets/` with non-empty `scope:`.
- [x] All children closed before this epic is considered done.
