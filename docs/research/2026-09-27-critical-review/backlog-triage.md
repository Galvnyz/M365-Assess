# Backlog disposition — 27 September 2026

> Historical recommendations from before v2.13.0. See [RESOLUTION.md](RESOLUTION.md)
> for subsequent delivery and issue dispositions. Counts and next steps below are
> preserved as review evidence, not a current work queue.

Snapshot: 31 open GitHub issues, 5 open PRs, 8 open milestones. Recommendations only; nothing was closed, relabeled, assigned, posted, or merged.

P1 means correctness or release/integration prerequisite. P2 means the next useful increment after those prerequisites. Parked work stays visible without implying an implementation commitment.

## New work identified by this review

| Proposed issue | Priority | Reviewable acceptance criteria |
|---|---|---|
| Correct readiness and framework reporting semantics | P1 | Unverified Review never becomes confirmed readiness; remove automatic Audit-ready verdict; distinguish finding counts from control counts; publish denominators; preserve incomplete/not-assessed visibility; test HTML and export agreement. |
| Evaluate effective CA protection in Security Defaults gap analysis | P1 | OR grants cannot imply mandatory MFA; handle authentication strengths, exclusions, resource scope, role scope, report-only and session-only fixtures; emit Review when equivalence cannot be established. |
| Preserve a finding for every attempted check on collection failure | P1 | UAL/DLP/label and other error paths emit an explicit unknown/not-assessed outcome with source/reason; no score improvement caused by failed collection; expected-check accounting distinguishes selected, inapplicable, and uncollected checks. |
| Repair CI schedule and build dependency coverage | P1 | Scheduled run executes substantive suites; package/lock/Babel/script changes trigger relevant checks; portal gets its own build/typecheck/test lanes before integration; required-result aggregator includes promised platform lanes. |
| Reconcile published package with validated main | P1 | Owner-approved version, matching tag/manifest/docs, Gallery install verification, independent clean-session smoke and commercial/GCC High evidence. No automatic version bump. |
| Review portal as a separate product integration | P1 prerequisite for merge | Map inherited diff; define read-only versus write-capable surfaces and permissions; finish real identity and tenant isolation; production build passes; dedicated CI; one end-to-end workflow; reconcile branch tickets with GitHub. |
| Refresh check authority and coverage metadata | P2 | Dated API/cloud/license/source records; investigate CheckID v3.4.1 delta and closed #989; validate SCuBA product catalog; distinguish 292 registered from 290 automated; improve learn-more links. |

Extend #952 for structured incomplete-query results rather than creating a duplicate pagination epic. Keep #1015 as the specific UAL endpoint fix with the generic failure-accounting issue linked to it.

## All open GitHub issues

| Issue | Disposition | Concrete next step |
|---|---|---|
| [#1015 — UAL false result via Purview](https://github.com/Galvnyz/M365-Assess/issues/1015) | P1 / first maintenance increment | Use authoritative EXO endpoint; test command resolution and missing/failed queries; persist source evidence. |
| [#952 — Graph pagination/retry](https://github.com/Galvnyz/M365-Assess/issues/952) | P1 / split | Helper completeness contract, list-call inventory, per-domain migrations, scale fixtures; batching follows. |
| [#959 — Frontend hardening](https://github.com/Galvnyz/M365-Assess/issues/959) | P1 for scoring tests; P2 for decomposition | Add behavioral tests to dangerous scoring/serialization paths first; then extract modules incrementally with browser smoke fixtures. |
| [#960 — Schema and OSCAL](https://github.com/Galvnyz/M365-Assess/issues/960) | Split | Existing bridge already has schemaVersion 1.0. Inventory and formalize contracts first; defer OSCAL until a concrete consumer and validation criteria exist. |
| [#953 — Persistent waivers](https://github.com/Galvnyz/M365-Assess/issues/953) | P2 / coordinate with #1008 | Model accepted risk separately from observation; require justification, owner, scope and expiry; carry it through all exports and reruns. |
| [#1008 — Assessment evidence file](https://github.com/Galvnyz/M365-Assess/issues/1008) | P2 / prioritize assessor demand | Share a versioned decision envelope with #953, but distinguish manual attestation from accepted risk; validate eligible controls, evidence and timestamps. |
| [#875 — Interactive attestation spike](https://github.com/Galvnyz/M365-Assess/issues/875) | Consolidate decision work | Make an evidence file the repeatable base; an interactive helper can generate it later. Close only after its requirements are explicitly absorbed. |
| [#954 — Gate mode and monitoring](https://github.com/Galvnyz/M365-Assess/issues/954) | P2 / dependent | Different exit outcomes for incomplete execution and posture failure; respect scoped decisions; one tested scheduled example first. |
| [#957 — Breach-pattern pack](https://github.com/Galvnyz/M365-Assess/issues/957) | P2 / split into five increments | Audit bypass, forwarding rules, app credentials, cross-tenant access, GDAP. Specify data source, paging, permissions, cloud support and false-positive cases per increment. |
| [#955 — SCuBA completion](https://github.com/Galvnyz/M365-Assess/issues/955) | P2 / correct scope then split | Reconcile with CISA's authoritative product list. Separate mapping existing observations from genuinely new collectors; include Power BI explicitly. |
| [#961 — Roadmap tracking](https://github.com/Galvnyz/M365-Assess/issues/961) | Refresh after direction decision | Update competitor claims, completed child checkboxes, actual delivery sequence, portal scope and published-versus-merged state. |
| [#914 — Taxonomy preservation](https://github.com/Galvnyz/M365-Assess/issues/914) | Keep upstream dependency; make local protection explicit | Upstream CheckID #407 remains open. Preserve local rendering metadata with a regression test for the chosen sync path rather than relying on manual repair. |
| [#871 — ISO divergence regression](https://github.com/Galvnyz/M365-Assess/issues/871) | Keep external dependency visible | Verify upstream mapping changes before un-skipping; disclose mapping limitations. No fabricated distinction to make a test pass. |
| [#231 — EXO compatibility ceiling](https://github.com/Galvnyz/M365-Assess/issues/231) | Re-test; retain constraint until evidence | Upstream MSAL issue remains open. Test precise version/OS/auth combinations and process isolation; document a known-good matrix. |
| [#971 — Not-assessed breakdown](https://github.com/Galvnyz/M365-Assess/issues/971) | Promote to collection-trust work | Separate permission failure, partial collection, license absence and inapplicability; aggregate counts from one data model. This helps users interpret uncertainty. |
| [#976 — License-adjusted scoring](https://github.com/Galvnyz/M365-Assess/issues/976) | Park pending score semantics | Do not treat buying a license as passing a control. Prefer a concrete license/gap explanation over another headline percentage. |
| [#902 — Intrusion-detection spike](https://github.com/Galvnyz/M365-Assess/issues/902) | Consolidate overlap with #957 | Identify specific evidence sources; distinguish suspicious configuration from a confirmed incident; avoid implying SIEM/EDR equivalence. |
| [#714 — Configuration accuracy surface](https://github.com/Galvnyz/M365-Assess/issues/714) | Park broad feature; retain useful examples | Pilot one effective-scope/completeness check within the existing result contract. Avoid adding a third aggregate score or parallel pipeline first. |
| [#849 — Baseline parameter consolidation](https://github.com/Galvnyz/M365-Assess/issues/849) | Defer to intentional breaking release | Specify migration path and backwards compatibility before removing either parameter. No urgency ahead of correctness. |
| [#986 — Report interactivity diagram](https://github.com/Galvnyz/M365-Assess/issues/986) | Small documentation follow-up | Document observable behavior after schema/decision changes; avoid diagrams of unimplemented workflows. |
| [#970 — Sample-report splice docs](https://github.com/Galvnyz/M365-Assess/issues/970) | Small maintenance task | Replace line-number slicing with a supported reproducible generation command; note generated artifacts. |
| [#969 — Horizon/Sequence wording](https://github.com/Galvnyz/M365-Assess/issues/969) | Small maintenance task | Align remediation export wording with the other outputs; verify one sample export. |
| [#760 — Webapp topology](https://github.com/Galvnyz/M365-Assess/issues/760) | Reconcile with implemented experiment | Compare the actual portal architecture against customer-deployed/MSP requirements; record the decision before promising a production service. |
| [#761 — Webapp hosting](https://github.com/Galvnyz/M365-Assess/issues/761) | Sequence after topology/security boundary | Avoid cloud deployment work while authentication/build are incomplete; assess actual runtime/storage needs. |
| [#762 — Webapp auth/permissions](https://github.com/Galvnyz/M365-Assess/issues/762) | P1 prerequisite for portal release | Real token validation, per-tenant authorization, least-privilege worker credentials, consent/revocation and test evidence. Tie to branch-local identity tickets. |
| [#763 — Webapp data plane](https://github.com/Galvnyz/M365-Assess/issues/763) | Reconcile with SQLite/BFF/worker implementation | Define source of truth, freshness, retention and tenant isolation; align with the assessment contract. |
| [#764 — MSP fleet UX](https://github.com/Galvnyz/M365-Assess/issues/764) | Revalidate demand | Compare a simple file-based assessment rollup with Maester's existing merged reports and with the proposed full portal. |
| [#765 — Webapp distribution](https://github.com/Galvnyz/M365-Assess/issues/765) | Defer until one complete supported flow | Clean install, real auth, safe update and rollback, durable storage, operator docs and observable failure recovery. |
| [#717 — Cohort telemetry](https://github.com/Galvnyz/M365-Assess/issues/717) | Keep explicitly blocked/parked | Existing owner/privacy approval requirement stands. No telemetry is needed to repair current assessment accuracy. |
| [#718 — Cohort percentiles](https://github.com/Galvnyz/M365-Assess/issues/718) | Park | No synthetic peer baselines. Requires a defensible comparable sample and published methodology. |
| [#577 — Spectre progress dashboard](https://github.com/Galvnyz/M365-Assess/issues/577) | Keep iceboxed | Do not spend reliability capacity on terminal presentation. |

## Open pull requests

| PR | Review disposition |
|---|---|
| [#1017 — Standards/drift/baselines storage](https://github.com/Galvnyz/M365-Assess/pull/1017) | Hold broad integration. 1,467 files / 240,057 additions is not a route-storage-sized review. Inventory inherited scope, production prerequisites and module-side remediation changes; establish CI and split the review. This is a recommendation, not a posted GitHub review. |
| [#1018 — Portal dev launcher](https://github.com/Galvnyz/M365-Assess/pull/1018) | Treat as experimental and stacked on #1017. Author discloses failed production build and placeholder-tenant flows; source confirms development-only identity. Do not confuse a successful local page load with a deployable authenticated product. |
| [#1016 — Babel dependency updates](https://github.com/Galvnyz/M365-Assess/pull/1016) | Candidate after actual clean dependency install, report compilation, syntax/behavior checks, and generated-asset verification. Its green CI skipped the build/quality/test lane. |
| [#1013 — browserslist update](https://github.com/Galvnyz/M365-Assess/pull/1013) | Same build verification requirement. Rebuild using the lockfile and inspect output changes before merge. No dependency incompatibility was demonstrated by this review. |
| [#1012 — paths-filter update](https://github.com/Galvnyz/M365-Assess/pull/1012) | Inspect pinned action change and verify path-filter behavior, including the new schedule/build-input cases. Do not treat an action bump as fixing the underlying workflow logic. |

## Milestone cleanup proposal

- Use one active maintenance milestone for correctness, CI, and a validated release; assign #1015 and the new findings there.
- Keep Trust at Scale focused on collection correctness. Its two remaining issues conceal very different work: #952 is foundational; #957 is feature expansion.
- Sequence Auditor Workflow behind result integrity, then Continuous Compliance behind stable decisions and explicit collection completeness.
- Keep Coverage Completion tied to authoritative source catalogs and practical new evidence, not check-count growth.
- Reconcile Webapp — Tenant Research with the substantial branch implementation and its branch-local tickets. Research status should not imply that no implementation exists.
- Keep external blockers and low-value presentation work out of active release promises.

The prior July review's recommendation to review community PRs #1009 and #1010 is obsolete: both merged in July and current main includes their tests. Their production value remains constrained by the unpublished-package gap.
