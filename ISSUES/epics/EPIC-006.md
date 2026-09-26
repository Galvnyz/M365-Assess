---
id: "EPIC-006"
source: "docs/portal-specs/01-feature-epics/EPIC-006-remediation-engine/SPEC.md"
section: "Portal skeleton (Session 1)"
severity: "critical"
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
  - T-0101
  - T-0102
  - T-0103
  - T-0104
  - T-0105
  - T-0106
  - T-0107
  - T-0108
  - T-0109
  - T-0110
  - T-0111
  - T-0112
  - T-0113
scope_kind: "epic"
scope_note: "Rollup for Remediation Engine. Children are authored in ISSUES/ against the layout fixed in SPEC.md §1; scope: is empty by design (rollups are never dispatched)."
---

# EPIC-006 — Remediation Engine

## Report

Plan-only remediation for all checks, then gated apply with audit — the write path for the whole product.

Full functional specification: `docs/portal-specs/01-feature-epics/EPIC-006-remediation-engine/SPEC.md`.

Cluster: Platform. CIPP provenance: cipp-features.md #6 (remediate flags); 06-remediation.md; 02-controls/.

This is an epic rollup. It is **never dispatched** by the fleet tool; its children carry the
code. Children are authored directly into `ISSUES/` with `parent: "EPIC-006"`; the `children:`
list above names them in dependency order.

## Acceptance

- [x] SPEC.md sections 2-9 complete and approved.
- [x] Child tickets authored in `tickets/` with non-empty `scope:`.
- [x] All children closed before this epic is considered done.
