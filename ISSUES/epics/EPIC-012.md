---
id: "EPIC-012"
source: "docs/portal-specs/01-feature-epics/EPIC-012-mfa-auth-methods/SPEC.md"
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
  - T-0221
  - T-0222
  - T-0223
  - T-0224
  - T-0225
  - T-0226
  - T-0227
  - T-0228
  - T-0229
  - T-0230
scope_kind: "epic"
scope_note: "Rollup for MFA & Auth Methods. Children are authored in ISSUES/ against the layout fixed in SPEC.md §1; scope: is empty by design (rollups are never dispatched)."
---

# EPIC-012 — MFA & Auth Methods

## Report

MFA state reporting and management: per-user MFA, reset, TAP, push, default method, registration campaign.

Full functional specification: `docs/portal-specs/01-feature-epics/EPIC-012-mfa-auth-methods/SPEC.md`.

Cluster: Identity. CIPP provenance: cipp-features.md #23,#28.

This is an epic rollup. It is **never dispatched** by the fleet tool; its children carry the
code. Children are authored into `ISSUES/` and name real `scope:` paths from SPEC.md §3-§8.

## Acceptance

- [x] SPEC.md sections 2-9 complete and approved.
- [x] Child tickets authored in `tickets/` with non-empty `scope:`.
- [x] All children closed before this epic is considered done.
