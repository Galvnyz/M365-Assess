# M365-Assess critical review — 27 September 2026

> **Historical snapshot.** This review describes commit `4daebfa` before the
> subsequent fixes and release. Read the [resolution update](RESOLUTION.md) first.
> Statements about "current" code, releases, issues, Microsoft timelines,
> competitors, and portal branches refer to the original inspection.

**Recommendation: prioritize a trustworthy, current, repeatable assessment product. Resolve result correctness and release delivery before expanding the portal.** The project still serves a useful purpose: a consultant can collect tenant configuration, explain findings, map supporting evidence to multiple frameworks, and hand over portable HTML/XLSX/JSON artifacts without deploying a service. Its biggest weakness is confidence in what a result means, rather than the number of checks available.

The original review was read-only. Its recommendations were subsequently acted on;
the resolution update distinguishes completed work from remaining scope.

## Scope and evidence

Reproduction prerequisites: PowerShell 7, Git, Node.js on PATH, and local Git history
containing commit `4daebfa91520b5998a5dd8184ce1aaedd4a3ef8d`. Shallow clones may
need history fetched first. The script reproduces old behavior regardless of the
checked-out branch and rewrites the adjacent `verification-results.json`. It is
historical evidence, not a current-main regression test or a tenant assessment.

| Surface | Verified snapshot |
|---|---|
| Local checkout | `c52821d`, 13 June; existing uncommitted July research and other changes |
| Current main | `4daebfa91520b5998a5dd8184ce1aaedd4a3ef8d`, 27 September; fetched and inspected without switching the checkout |
| Main manifest | 2.13.0 |
| Published distribution | Latest GitHub release and [PowerShell Gallery package](https://www.powershellgallery.com/packages/M365-Assess/2.12.0) are 2.12.0, published 12 June |
| GitHub portfolio | 31 open issues, 5 open PRs, 8 open milestones at inspection |
| Portal | PR #1017 head `79db3f48a9979f9beccb9c47c8f19ccb2f0f9624`; PR #1018 inspected head `046c9618e50d9b1f3bea3f34090bc5b5849216ef` |
| Registry | schemaVersion 3.4.0, dataVersion 2026-04-30; 292 checks, 290 flagged automated, 15 report frameworks |
| Verification | Six offline synthetic reproductions against exact current-main source; live GitHub job metadata; official Microsoft and community project documentation |

[Verification script](verify-findings.ps1) and [recorded results](verification-results.json) preserve the concrete reproductions. They execute selected unchanged source blocks with synthetic API responses; they do not assess a tenant. Run from the repository root with `pwsh -NoProfile -File docs/research/2026-09-27-critical-review/verify-findings.ps1`.

This was a targeted architecture, correctness, portfolio, and product review, not an exhaustive security audit. No full local Pester run was claimed: the installed Pester is 3.4.0, while the project uses 5.x. No live tenant, portal deployment, or independent portal test-suite execution was performed. Portal test counts below are author-reported. Microsoft tenant-specific Message Center notices were not accessed.

## Findings in priority order

### 1. P1 — Report scores can imply assurance that was never established

The current React report's `computeComplianceReadinessScore` treats every `Review` as Pass-equivalent. Two unverified Review findings produce **100% Compliance Readiness** in the reproduction. Manual verification has not occurred merely because a finding requests it.

Separately, `buildFrameworkData` increments counts per finding, while the briefing describes those counts as framework controls being in place. `fwCoveragePct` uses `(pass + info * 0.5) / total`; at 90%, `fwReadinessLabel` emits **Audit-ready**. Nine passing findings and one failing finding receive that label, regardless of failure severity or full-framework coverage. The framework scoring formula also differs from the strict Pass% documented as applying to framework totals.

**Action:** stop treating unverified Review as ready; replace audit-readiness verdicts with measured configuration posture; distinguish findings, distinct mapped controls, and the full framework denominator. Keep collection completeness visible beside posture. An accepted risk should preserve the observed failure, and an attestation should carry identity, evidence, scope, date, and expiry. Do not imply that a configuration snapshot establishes organizational compliance.

Evidence: [scoring code, lines 516–548](https://github.com/Galvnyz/M365-Assess/blob/4daebfa91520b5998a5dd8184ce1aaedd4a3ef8d/src/M365-Assess/assets/report-app.jsx#L516), [framework aggregation, line 1688](https://github.com/Galvnyz/M365-Assess/blob/4daebfa91520b5998a5dd8184ce1aaedd4a3ef8d/src/M365-Assess/assets/report-app.jsx#L1688), [readiness labels, line 1748](https://github.com/Galvnyz/M365-Assess/blob/4daebfa91520b5998a5dd8184ce1aaedd4a3ef8d/src/M365-Assess/assets/report-app.jsx#L1748). This deserves a separate correctness issue ahead of cosmetic scoring work in #976.

### 2. P1 — Conditional Access presence is mistaken for effective protection

The Security Defaults gap analysis searches for `mfa` in `builtInControls` without evaluating `operator`. A policy allowing **MFA OR compliantDevice** passes the MFA predicates. With the synthetic policies in the reproduction, the collector reports **Pass: All 4 areas covered by Conditional Access**. Microsoft documents AND/OR as the relationship between grant controls, so the presence of `mfa` alone is insufficient.

The same block does not establish complete exclusion, application, condition, or role coverage and does not account for the `authenticationStrength` relationship. These are additional review targets; the OR case is reproduced. Keep this finding scoped to `ENTRA-SECDEFAULT-002`, rather than claiming every CA evaluator is wrong.

**Action:** evaluate effective requirements or return Review when equivalence cannot be proven. Build fixture cases for OR/AND, authentication strengths, exclusions, app scope, role coverage, report-only, and session-only policies. July's merged null-`grantControls` fix is useful, but it does not solve these semantic questions.

Evidence: [EntraPasswordAuthChecks, lines 110–160](https://github.com/Galvnyz/M365-Assess/blob/4daebfa91520b5998a5dd8184ce1aaedd4a3ef8d/src/M365-Assess/Entra/EntraPasswordAuthChecks.ps1#L110), [Microsoft grant-control semantics](https://learn.microsoft.com/en-us/graph/api/resources/conditionalaccessgrantcontrols?view=graph-rest-1.0).

### 3. P1 — The community's audit-logging false failure is supported by code and Microsoft documentation

[Issue #1015](https://github.com/Galvnyz/M365-Assess/issues/1015), opened 11 September, is unmilestoned. The Purview collector invokes unqualified `Get-AdminAuditLogConfig` and converts a false property to Fail. Microsoft explicitly documents that Security & Compliance PowerShell returns this property as false even when auditing is enabled; the authoritative query must use Exchange Online PowerShell. The synthetic false response reproduces Fail.

**Action:** bind the observation to the Exchange endpoint, retain evidence of the source, and emit a not-assessed result when it cannot be queried. Test simultaneous EXO/Purview connections, true, false, missing command, and access failure. Merely opening another session is insufficient if command resolution still selects the wrong endpoint.

Evidence: [collector, line 50](https://github.com/Galvnyz/M365-Assess/blob/4daebfa91520b5998a5dd8184ce1aaedd4a3ef8d/src/M365-Assess/Security/Get-ComplianceSecurityConfig.ps1#L50), [Microsoft verification instructions](https://learn.microsoft.com/purview/audit-log-enable-disable).

### 4. P1 — Missing and partial collection is not a reliable part of the result contract

Throwing from the UAL query produces **zero findings** for that check because its catch only writes a warning. Several other blocks in that collector use the same pattern. That makes API failure indistinguishable from an absent check in downstream scoring.

The shared Graph helper is a good foundation, but at its page cap it warns, removes `@odata.nextLink`, and returns a normal-looking partial collection with no structured completeness flag. The reproduction returns `keys=value` after intentionally stopping before the second page. Remaining raw list queries include the CA security evaluator, PIM assignments, and access reviews. A raw call is not automatically wrong, but list endpoints need a complete pagination/retry audit.

**Action:** make completion state explicit from collection through HTML, XLSX, JSON, and future gate mode. A missing expected check must not disappear; an incomplete query must not support a Pass conclusion. Split #952 into helper semantics, caller inventory, migrations, and scale fixtures. Treat batching as optimization after correctness.

Evidence: [UAL catch, line 80](https://github.com/Galvnyz/M365-Assess/blob/4daebfa91520b5998a5dd8184ce1aaedd4a3ef8d/src/M365-Assess/Security/Get-ComplianceSecurityConfig.ps1#L80), [Graph page cap](https://github.com/Galvnyz/M365-Assess/blob/4daebfa91520b5998a5dd8184ce1aaedd4a3ef8d/src/M365-Assess/Common/Invoke-SafeGraphRequest.ps1#L65), [#952](https://github.com/Galvnyz/M365-Assess/issues/952). Microsoft considers introducing pagination a backward-compatible API change, which strengthens the need for universal collection handling: [Graph support policy](https://learn.microsoft.com/en-us/graph/versioning-and-support).

### 5. P1 — Green CI overstates current verification

The weekly workflow skips `changes`, and test/quality jobs depend on `changes.outputs.code`. The final CI aggregator accepts skipped jobs. The [21 September scheduled run](https://github.com/Galvnyz/M365-Assess/actions/runs/35593567393) therefore passed with the actual tests and quality gates skipped.

`package.json` and `package-lock.json` are classified as docs. Consequently the [27 September main run](https://github.com/Galvnyz/M365-Assess/actions/runs/36353598292) passed after a dependency change without running the report build, Pester, or platform smoke tests. `babel.config.json` and `scripts/**` are also missing from the code filter. The existing workflow has no portal npm build/test lane. Cross-platform smoke jobs are omitted from the required-result aggregator.

There is positive evidence: the [14 July main run](https://github.com/Galvnyz/M365-Assess/actions/runs/29338615474) passed quality gates, Pester on PS 7.4 and 7.6, and Linux/macOS smoke jobs. The problem is coverage of triggers and paths, not evidence that those tests fail.

**Action:** make scheduled validation run explicitly; test build-tool changes; include relevant scripts and configuration; add portal CI before portal integration; require the platform lanes if cross-platform support is a release promise. Gate the checks that actually ran, not merely the aggregate green badge.

Evidence: [workflow](https://github.com/Galvnyz/M365-Assess/blob/4daebfa91520b5998a5dd8184ce1aaedd4a3ef8d/.github/workflows/ci.yml).

### 6. P1 — Fixes in main are not reaching ordinary installers

Main advertises 2.13.0, but Gallery and GitHub Releases still offer 2.12.0. June sovereign-cloud fixes and July CA/MFA/certificate fixes therefore are not delivered by the normal `Install-Module` path. A completed milestone or merged PR is not a shipped correction.

**Action:** prepare a narrowly scoped maintenance release after correcting the high-priority result defects and validating commercial/GCC High plus supported authentication modes. Reconcile manifest, changelog, tag, package, and clean-machine install. The version and publication remain owner decisions; this review changes neither.

### 7. P1 integration risk — The portal is a second product hidden inside two enormous PRs

[PR #1017](https://github.com/Galvnyz/M365-Assess/pull/1017) is **1,467 changed files and 240,057 additions** against main. [PR #1018](https://github.com/Galvnyz/M365-Assess/pull/1018) is stacked on it and totals **1,477 files and 241,432 additions**; do not add those numbers together. Their short titles describe only the latest portion of a much larger integration.

The inspected branch includes tenant administration, credential handling, PowerShell workers, remediation, standards/drift/baselines, and a SQLite-backed BFF. It also adds `src/M365-Assess/Remediate`, so the scope is not confined to a separate UI directory. This is a substantial expansion of the published read-only product promise.

The authors report 190 db tests, 1,459 BFF tests, and 451 web tests across the two PRs. These are useful signals, not independent verification. At inspection neither PR exposed checks. #1018 explicitly says production `next build` is not passing, several pages use placeholder tenant IDs, and navigation does not yet reflect RBAC/feature flags. Source confirms normal portal identity validation is unfinished; the development launcher uses a local admin identity across all tenants. The BFF defaults to loopback and rejects that identity when NODE_ENV is production, which are useful safeguards but do not implement real sign-in.

**Action:** keep this experimental until there is a defined product boundary, production authentication, tenant isolation verification, secret-handling review, green production build, dedicated CI, and at least one complete supported user journey. Rebase/restructure the integration into reviewable foundations and vertical slices. A separate package/release track is the minimum; a separate repository is an option, not a requirement.

The branch-local `TICKETS.md` advertises 258 open and 215 closed tickets, but its displayed status table includes closed epics under the open section. Those counts are not directly comparable to the 31 GitHub issues. Reconcile the two tracking systems before using either to forecast completion.

### 8. P2 — Coverage freshness and documentation need tighter ownership

The registry remains at April's data version. Latest upstream release is [CheckID v3.4.1](https://github.com/Galvnyz/CheckID/releases/tag/v3.4.1), but [sync PR #989](https://github.com/Galvnyz/M365-Assess/pull/989) was closed without merging. There is no explanatory comment on that PR. Investigate the delta and record a decision; a newer upstream tag is not automatically safe to import.

The dedicated sync workflow is release-dispatch/manual, not the weekly cron described in AGENTS.md. Weekly CI's fallback downloads and warns but does not persist a corrected registry. Maintain tagged releases, M365 partitioning, local extensions, taxonomy, severity, and licensing overlays as explicit sync invariants.

The generated coverage page reports only **31/292 learn-more links** and **290 automated checks**, while the README generator labels all 292 automated. The SCuBA pillar table lacks Power BI, which CISA lists as a baseline product. An internally consistent generated table can still use the wrong source taxonomy. Verify mappings and denominators against the authoritative catalog, not just against the registry itself.

Correct another stale assumption in the July review: the bridge JSON already has `schemaVersion = '1.0'` and wraps `findings` in an array. #960 should inventory existing contracts and add explicit JSON Schemas, compatibility/consumer tests, and versioning for REPORT_DATA where missing; it should not start by adding a field that already exists. Treat OSCAL as a separate consumer-driven deliverable.

## Keeping up with Microsoft

These are the immediate maintenance tracks, not claims that every listed capability is currently broken.

| Track | Implication for M365-Assess |
|---|---|
| Endpoint correctness and cloud support | Fix UAL now. Maintain a per-check record of API/cmdlet, cloud, auth mode, permission, license, API stability, and last validated date. |
| Authentication policy evolution | Audit authentication strengths, passkeys, method-policy states, and effective CA enforcement. Microsoft retired management through the legacy MFA/SSPR methods policies beginning September 2025; do not confuse that with elimination of every per-user MFA concept. [Microsoft policy guidance](https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-methods-manage). |
| EWS retirement | Microsoft Learn still points to October 2026 disablement and its current Exchange-team timeline. Consider an evidence-based migration-readiness check using supported usage reporting. Do not claim the assessment module itself depends on EWS without finding such a dependency. [Microsoft EWS guidance](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/deprecation-of-ews-exchange-online). |
| SMTP AUTH | Use the revised January 2026 timeline rather than obsolete March/April 2026 removal dates. Differentiate SMTP AUTH availability, Basic authentication, OAuth, and mailbox exceptions in findings. [Exchange-team timeline update](https://techcommunity.microsoft.com/blog/exchange/updated-exchange-online-smtp-auth-basic-authentication-deprecation-timeline/4489835). |
| Graph beta exposure | Forms/Teams and several Entra queries still use beta. Prefer supported v1.0 equivalents where verified; otherwise identify limitations and cloud support in evidence. Microsoft does not support beta APIs for production applications. [Graph support policy](https://learn.microsoft.com/en-us/graph/versioning-and-support). |
| EXO/Graph compatibility | [Upstream #3576](https://github.com/microsoftgraph/msgraph-sdk-powershell/issues/3576) remains open and was updated 23 September. Do not simply remove #231's ceiling. Re-test exact module versions, both import orders, authentication modes, and OSes; evaluate process isolation as an architectural alternative. |
| Copilot and data exposure | After reliability work, investigate a small assessment pack for SharePoint oversharing, sensitive data protections, and app/agent access. Validate available APIs and license requirements before claiming automated coverage. [Microsoft governance training](https://learn.microsoft.com/en-us/training/modules/govern-sharepoint-onedrive-copilot/). |

A monthly compatibility/authority review, with an owner and dated evidence, is more valuable than periodically expanding the check count. Tenant Message Center notices should supplement public sources when an authorized test tenant is available.

## Community position and useful differentiation

The competitive thesis in #961 needs a refresh. Avoid absolute claims about capabilities other projects lack.

| Alternative | Current verified strength | Recommended response |
|---|---|---|
| [Maester 2.2](https://maester.dev/blog/maester-2-2/) and [multi-tenant reports](https://maester.dev/docs/multi-tenant/overview/) | Continuous testing, broad Microsoft checks, and merged multi-tenant HTML reports using separate read-only service connections | Remove the old claim that Maester has no multi-tenant reporting. Differentiate through evidence quality, engagement deliverables, and useful crosswalks. |
| [CISA ScubaGear](https://github.com/cisagov/ScubaGear) | Authoritative SCuBA baseline implementation; HTML/JSON/CSV, risk-acceptance configuration, and NIST/MITRE mappings | Use as a reference and comparison oracle for overlapping controls. Do not equate partial mapped coverage with ScubaGear parity. |
| [CIPP Standards & Drift](https://docs.cipp.app/user-documentation/tenant/standards) | Scheduled multi-tenant reporting, alerts, enforcement, and drift decisions | A management portal competes directly here and requires a compelling reason to exist. Integration/export may yield more value than rebuilding administration. |
| [Monkey365](https://github.com/silverhack/monkey365) | Assessment across Microsoft 365, Entra, and Azure | Breadth of checks is already competitive territory. Avoid expanding beyond the M365 scope without a concrete user need. |
| [Microsoft Secure Score](https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score) and [Exposure Management recommendations](https://learn.microsoft.com/en-us/security-exposure-management/security-recommendations) | Native posture recommendations and prioritization | Explain evidence, scope, licensing, and next actions in a portable client deliverable rather than reproducing another score dashboard. |

The most defensible positioning is **an evidence-backed M365 assessment and handoff tool for consultants and administrators**, with explicit collection limitations, commercial/sovereign support, transparent licensing, reusable assessment decisions, and consistent exports. The 15-framework crosswalk is useful as supporting evidence navigation; the framework count alone is not evidence of completeness.

Community feedback is already specific: July contributors supplied CA/null-handling and cross-platform certificate fixes; September's #1015 supplied a reproducible false failure; #1008 asks for manual evidence that survives repeatable execution. These point toward reliability and the assessor workflow. Stars/forks indicate interest, not active usage or satisfaction. Validate priorities through a few real engagements and contributor conversations before assuming demand for the portal.

## Recommended delivery order

1. **Restore trust and delivery.** Correct scoring semantics, CA equivalence, UAL endpoint/error handling, and CI trigger/path gaps. Audit expected-check accounting and page-cap behavior. Validate the release candidate on a clean install and representative commercial/GCC High sessions. Release only after the owner approves a version and publication.
2. **Finish collection correctness.** Inventory every list query for pagination/retry; cover multi-page, empty, permission-denied, throttled, null, unlicensed, and unavailable-cloud cases. Preserve complete evidence and incomplete-state signals across every output. Finish #952 in independently testable slices.
3. **Deliver the assessor workflow.** Define compatible schemas and runtime validation; add JS behavior and rendering tests under #959; combine #953/#1008 with the useful decision work from #875. Preserve raw observations beside accepted risk and manual attestations. Prove that repeat runs and finalized reports retain decisions correctly.
4. **Add a reliable automated gate.** #954 must distinguish execution failure/incomplete assessment from actual posture failure and apply scoped, expiring accepted risks without rewriting observed truth. Deliver one tested scheduled example before multiple pipeline variants.
5. **Expand where evidence supports value.** Split #957 by attack pattern, then #955 by product and mapping versus collector work. Prioritize audit bypass, forwarding, app credentials, and external trust exposure. Evaluate a small Copilot/oversharing pack against real engagements. Defer broad OSCAL, new scores, telemetry, and management surfaces until consumers justify them.

Run portal development as a separate experimental track with its own acceptance gates and capacity allocation. Do not make assessment maintenance wait for that integration.

Proposed operating targets: acknowledge external correctness reports within two working days; review Microsoft/API/dependency changes monthly; record per-check validation age; require all selected checks to have an outcome or explicit exclusion; track time-to-first-successful-assessment and false-finding reports; verify identical result semantics across HTML/XLSX/JSON. These are proposed service goals, not claims about current performance.

See [the complete open-issue and PR triage](backlog-triage.md) for the disposition of every open GitHub issue and all five PRs. No external backlog changes have been made.
