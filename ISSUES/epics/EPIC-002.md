---
id: "EPIC-002"
source: "docs/portal-specs/01-feature-epics/EPIC-002-tenants-onboarding/SPEC.md"
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
needs_scope_review: true
children:
  - T-0021
  - T-0022
  - T-0023
  - T-0024
  - T-0025
  - T-0026
  - T-0027
  - T-0028
  - T-0029
  - T-0030
  - T-0031
  - T-0032
scope_kind: "epic"
scope_note: "Rollup for Tenants & Onboarding. Children are authored in ISSUES/ against the layout fixed in SPEC.md §1; scope: is empty by design (rollups are never dispatched)."
---

# EPIC-002 — Tenants & Onboarding

## Report

Manage the tenant list, credentials, groups, variables, and both direct and GDAP onboarding paths.

Full functional specification: `docs/portal-specs/01-feature-epics/EPIC-002-tenants-onboarding/SPEC.md`.

Cluster: Platform. CIPP provenance: cipp-features.md #1-#5; 03-database §3-4.

This is an epic rollup. It is **never dispatched** by the fleet tool; its children carry the
code. Children are authored into `ISSUES/` with `parent: "EPIC-002"` once SPEC.md §3-§6 fix the
file layout and real `scope:` paths can be named.

## Acceptance

- [x] SPEC.md sections 2-9 complete and approved.
- [x] Child tickets authored in `tickets/` with non-empty `scope:`.
- [x] All children closed before this epic is considered done.
