# Baseline Findings Distribution — What Does "Normal" Look Like?

**Date:** 2026-04-23
**Status:** Research spike — initial pass; telemetry pending
**Purpose:** Help users answer *"am I in the normal range?"* when reading a
M365-Assess report.

---

## 1. The Question

A user runs M365-Assess and sees, say, **247 findings** (the number observed on
the reference tenant in issue #709). Is that a lot? A little? What is an average
M365 tenant expected to produce?

This note gathers the signals we already have, documents the confounders, and
proposes a methodology for producing a calibrated answer.

---

## 2. What Drives the Number of Findings

### 2.1 The denominator is not fixed

`controls/registry.json` currently carries **1,106 check definitions** (verified
2026-04-23; issue #594 cites 1,092 at an earlier sync). But no tenant is
evaluated against all 1,106 — the applicable pool depends on:

| Factor | Effect on denominator |
|---|---|
| Scope flags (Windows endpoint, Azure subscription) | `WIN-*` (454) and `AZ-*` (360) only fire when those scopes are included — a pure M365 run evaluates roughly **292 checks** |
| Licensing gates (`licensing-overlay.json`) | 19 E5-exclusive checks skip on E3 tenants; 257 require E3 minimum; 814 have no license gate |
| Workload presence | Power BI (26 checks), Purview (6), Forms (6), DNS (≤4 per accepted domain) only fire if collectors detect the workload |
| Collector skips / API nulls | SPO, OneDrive, beta-only properties often return `Skipped` / `Review` — counted but not actionable |

So the right comparison is **findings by status within the applicable pool**,
not a raw count against 1,106.

### 2.2 All statuses are "findings"

`Common/SecurityConfigHelper.ps1` records every `Add-Setting` call as a finding
regardless of outcome. `Common/Build-ReportData.ps1` tallies them by status:
`Pass | Fail | Warning | Review | Info | Skipped | Unknown`. A tenant with
247 findings might have, e.g., 150 Pass / 40 Fail / 30 Warning / 20 Review /
7 Info — which is very different from 247 Fails.

Any "average" number we publish must be split by status, not a total.

---

## 3. External Signals (Industry Baselines)

No vendor publishes a "checks failed per tenant" distribution directly, but
several adjacent metrics help triangulate:

| Signal | Reported value | Source |
|---|---|---|
| Average Microsoft Secure Score (all tenants) | **30–45 %** | CoreView 2025 Playbook, TrustedTech |
| Average Secure Score at first assessment | **42 / 100** | CoreView State of M365 snapshot |
| SMB / Business Premium typical range | **30–50 %** | Prosper IT, AMVIA |
| Mid-market typical range | **40–60 %** | TrustedTech |
| "Good" target | **60–80 %** | Multiple |
| Regulated industries (finance/health) target | **75 %+** | CoreView |
| Tenants with *critical* misconfigurations | **73 %** | Falconer Security |
| Configurable security settings per user in M365 | **7,500+** | CoreView |
| MFA registration (one reference tenant) | 58.82% described as "substantially higher than average" | Practical365 |
| CIS M365 Foundations Benchmark control count (v6) | 140 (up from 130) | CIS / Valence |

**Takeaway:** At first assessment the *typical* tenant is somewhere around
Secure Score 40 ± 10. On a CIS-shaped assessment with roughly 140 controls,
that points to **~55–85 fails/warnings** on a first run — in the same order of
magnitude as M365-Assess reports on real tenants, once WIN/AZ scopes are
excluded.

---

## 4. Internal Signals We Already Have

- Issue #709 reports a reference tenant at **247 total findings** (18 Now / 126
  Next / 3 Later bucketing), which suggests Fails+Warnings are a small fraction
  of the 247 — most items are Pass/Review/Info.
- Issue #594 notes **1,067 of 1,092 registry checks have CMMC mappings** — a
  useful anchor for framework coverage analysis.
- `Compare-AssessmentBaseline.ps1` and `Compare-M365Baseline.ps1` already
  implement a drift-over-time comparison (tenant vs. its own prior run). We do
  **not** yet have any cross-tenant comparison.

---

## 5. Proposed Methodology for a Calibrated Baseline

To publish defensible "normal range" numbers, we need:

### 5.1 Opt-in anonymised telemetry (strongly preferred)

An opt-in flag (e.g. `-ShareAnonymisedMetrics`) that emits:
- Per-status counts (Pass / Fail / Warning / Review / Info / Skipped)
- Applicable-pool size (which check IDs were evaluated)
- Tenant *cohort bands* only: SKU tier (E3 / E5 / Business Premium / GCC),
  user-count bucket (`<50`, `50–250`, `250–1k`, `1k–10k`, `>10k`),
  workload scope flags
- **No tenant IDs, domains, UPNs, GUIDs, counts of specific users, or any
  identifier.** Per CLAUDE.md this is a public repo.

Aggregated to a statistics JSON committed to the repo (or a GitHub Pages
endpoint). Updated monthly.

### 5.2 In-report "how you compare" card

Once we have ≥ N submissions per cohort (suggested N ≥ 30), add a card to the
HTML report that shows:

```
Your tenant: 42 Fails, 28 Warnings (E3, 250–1k users)
Typical:     35–55 Fails, 20–40 Warnings (5th–95th percentile, n=134)
```

This is the direct answer to *"am I in the normal range?"*.

### 5.3 Fallback: synthetic cohorts from reference tenants

If telemetry remains aspirational, publish a table of **reference profiles** —
anonymised hand-curated examples (`E3 / 100 users / default config` →
X Fail, Y Warning; `E5 / hardened` → ...) that users can visually compare
against. Lower fidelity but zero privacy burden.

### 5.4 Confounders to document

Any baseline number must be published with these caveats visible:
- Denominator drifts with every CheckID sync; compare *percentages*, not raws.
- License SKU changes the ceiling — an E3 tenant *cannot* produce E5 findings.
- Scope flags (WIN / AZ) multiply the denominator 4×.
- Status counts are dominated by Pass; the *signal* is Fail + Warning only.

---

## 6. Suggested Next Steps

1. Decide whether opt-in telemetry is acceptable for the project (needs user
   sign-off — privacy surface, storage, public-repo implications).
2. If yes: design the emission schema; stand up a simple aggregation endpoint
   (GitHub Pages JSON is sufficient at v1).
3. If no / not yet: publish the reference-profile table (5.3) in the next
   release and add a "typical range is not yet calibrated" disclaimer.
4. Either way: add a per-status breakdown to the exec summary tiles so the
   *raw* finding count is never shown without its Pass/Fail/Warning split
   (partially overlaps with #706).

---

## 7. References

- https://www.coreview.com/blog/secure-score-playbook
- https://www.coreview.com/resource/coreview-state-of-microsoft-365-snapshot
- https://www.trustedtechteam.com/blogs/security/microsoft-secure-score-explained
- https://falconersecurity.com/services/microsoft-365-security-assessment/
- https://practical365.com/mfa-status-user-accounts/
- https://www.valencesecurity.com/resources/blogs/cis-microsoft-365-benchmark-v6-saas-security
- https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score
- Internal: issue #709 (247-finding reference tenant), #594 (CMMC coverage),
  #642 (assessment-to-assessment trend view)
