---
id: "EPIC-001"
source: "docs/portal-specs/01-feature-epics/EPIC-001-platform-foundation/SPEC.md"
section: "Portal skeleton (Session 1)"
severity: "critical"
status: "closed"
original_status: "declared"
parent: ""
scope: []
tests: []
related: []
depends_on: []
needs_scope_review: true
children:
  - T-0001
  - T-0002
  - T-0003
  - T-0004
  - T-0005
  - T-0006
  - T-0007
  - T-0008
  - T-0009
  - T-0010
  - T-0011
  - T-0012
  - T-0013
  - T-0014
  - T-0015
  - T-0016
  - T-0017
scope_kind: "epic"
scope_note: "Rollup for Platform Foundation. Children are authored in ISSUES/ against the layout fixed in SPEC.md §1; scope: is empty by design (rollups are never dispatched)."
---

# EPIC-001 — Platform Foundation

## Report

Make the module safe to run concurrently per tenant and stand up the service skeleton (API, storage, auth, job queue) so every later epic has a foundation.

Full functional specification: `docs/portal-specs/01-feature-epics/EPIC-001-platform-foundation/SPEC.md`.

Cluster: Platform. CIPP provenance: cipp-features.md §0 (router/auth/storage); 01-architecture.md §4.

This is an epic rollup. It is **never dispatched** by the fleet tool; its children carry the
code. Children are authored into `ISSUES/` with non-empty `scope:` paths named against the
layout in SPEC.md §1.

## Acceptance

- [x] SPEC.md sections 2-9 complete and approved.
- [x] Child tickets authored in `tickets/` with non-empty `scope:`.
- [x] All children closed before this epic is considered done.
