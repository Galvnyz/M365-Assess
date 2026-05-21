# 0005 — 9-value status taxonomy instead of binary Pass/Fail

- **Status:** Accepted
- **Date:** 2026-05-06

## Context

A security assessment tool's most-load-bearing primitive is the **status** it puts on each finding. It drives the headline score, the report colour scheme, the framework-mapping math, the baseline-diff rules, the XLSX colouring, and what shows up in the executive summary. Once that primitive's value-set is fixed, every consumer in the pipeline depends on it.

The naïve choice is `Pass`/`Fail`. It's also wrong for this domain — security assessments hit several states that are categorically not Pass and not Fail:

- *We couldn't collect the data* (permission denied, throttled, transient API failure). Reporting `Fail` here lies — we don't know.
- *The user opted this out* (`-Section Identity` excludes Defender; running Defender's checks would be wrong).
- *The tenant doesn't license the feature being checked* (E5-only check on an E3 tenant). Reporting `Fail` blames the customer for not paying for a SKU they may not need.
- *The data is collected but the answer is judgmental* (privileged role list — listing is mechanical, deciding "is this assignment appropriate?" is human).
- *The check is informational* (count of admin role assignments — context, not a posture claim).
- *The configuration is fine but contextually concerning* (Security Defaults instead of Conditional Access — works, but blocks finer controls).

For a tool consultants use to brief boards on tenant posture, **false confidence is worse than missing data**. The taxonomy needed to be wide enough that collectors don't have to lie when reality is more nuanced.

## Decision

`Add-SecuritySetting`'s `[ValidateSet]` (in `Common/SecurityConfigHelper.ps1`) accepts exactly nine values:

```
Pass, Fail, Warning, Review, Info, Skipped, Unknown, NotApplicable, NotLicensed
```

Each value has a defined meaning, a fixed colour in the report, and a fixed role in the score math. Three statuses (`Pass`, `Fail`, `Warning`) participate in the Pass% denominator; the other six (`Review`, `Info`, `Skipped`, `Unknown`, `NotApplicable`, `NotLicensed`) are excluded from both numerator and denominator so a tenant doesn't get punished for missing license tiers or permission gaps.

The full meaning, decision tree, and per-status colour mapping live in [`docs/reference/CHECK-STATUS-MODEL.md`](../reference/CHECK-STATUS-MODEL.md), which is the source-of-truth doc. This ADR captures *why* the set is nine values (not four, not twelve), not the per-status semantics.

The taxonomy is versioned (current schema version `1.0`, declared at the top of CHECK-STATUS-MODEL.md). Bumping requires updating the `ValidateSet`, every rendering surface (HTML, XLSX, executive summary, framework totals), and the `schemaVersion` field in `window.REPORT_DATA`.

## Consequences

**Positive**

- Collectors don't have to lie: a 403 from Graph emits `Unknown`, not `Fail`, so the score isn't poisoned by permission gaps.
- The Pass% denominator is honest — `Pass / (Pass + Fail + Warning)`. A tenant with 30% `Unknown` checks isn't dragged below a tenant with full permissions and 30% `Fail`s.
- `NotLicensed` enables a license-adjusted scoring view (D2 #786) without re-engineering the score path.
- Each status has a defined report colour, so users learn the visual language fast.
- `Skipped` (user-driven absence) and `Unknown` (tool-driven absence) are differentiated, which is critical for "why is this section blank?" diagnosis.

**Negative**

- Nine values is a lot of cognitive load for collectors. New contributors reach for `Fail` when they should be using `Unknown` or `Review`. CHECK-STATUS-MODEL.md has a decision tree to mitigate, but it's still drift-prone.
- Every rendering surface must handle every status, or the inconsistent paths become bugs. Issue B8 #779 audits each surface; without that audit, statuses get rendered as raw strings or fall back to a default colour.
- `Warning` and `Review` are the most-confused pair. The line — "concerning but verified" vs "data is good but human judgment needed" — is real but easy to blur. Collector authors trip on this.
- Schema bumps are expensive: `ValidateSet` + doc + 4-5 rendering surfaces + `window.REPORT_DATA.schemaVersion`. We accept that cost because the alternative (silent semantic drift) is worse.

**Failure modes and mitigations**

- *Collector emits `Fail` for a permission-denied case* → score is wrong; downstream remediation guidance points the user at a non-existent setting. Mitigation: code review + `.claude/rules/powershell.md` reminder; we've considered a runtime check that emits a WARN log when `Fail` is recorded with no `EvidenceSource`, but haven't shipped it.
- *Rendering surface forgets to handle a status* → status renders as raw string or grey. Mitigation: B8 #779 audit; React report has a fallback colour rather than crashing.
- *Status added without bumping the schema version* → downstream React/M365-Remediate consumers break silently. Mitigation: the bump-checklist in CHECK-STATUS-MODEL.md (5 steps); enforced by code review, not lint.

## Alternatives considered

- **Binary Pass/Fail.** Rejected: see Context — produces false confidence on uncollected data, false failures on unlicensed checks. Tested briefly in v0.x prototypes; abandoned within weeks.
- **Pass / Fail / Warning / Skipped (4 values).** Rejected: collapses `Unknown` into either `Fail` (poisoning the score) or `Skipped` (which means user-driven absence and confuses the WARN-level "you may need more permissions" guidance). Also can't represent `NotLicensed` honestly without a separate field.
- **Severity-based scale (Low/Medium/High/Critical).** Rejected: severity is an orthogonal dimension to status — a `Fail` is a Fail regardless of severity, and an `Unknown` doesn't have a severity. We carry severity separately in `risk-severity.json`, keyed on CheckId.
- **Free-form string status.** Rejected: every consumer would have to handle the long tail. The `ValidateSet` is the contract; the contract is the value.
- **More-than-9 values (e.g. separate `Throttled` and `PermissionDenied` for what is currently `Unknown`).** Rejected: reaching for resolution we don't actually use. The `Limitations` evidence field carries the sub-cause; `Unknown` is enough resolution at the status level.

---

## See also

- [`../reference/CHECK-STATUS-MODEL.md`](../reference/CHECK-STATUS-MODEL.md) — the per-status semantics, decision tree, and denominator rules
- [`../../src/M365-Assess/Common/SecurityConfigHelper.ps1`](../../src/M365-Assess/Common/SecurityConfigHelper.ps1) — `Add-SecuritySetting` `ValidateSet` (the contract)
- [`0006-optional-structured-evidence-fields.md`](0006-optional-structured-evidence-fields.md) — sibling decision on how findings carry their provenance
- [`README.md`](README.md) — back to the ADR index
