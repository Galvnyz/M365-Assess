# Check status model

**Schema version:** 1.0 (2026-04-25)
**Source of truth:** `src/M365-Assess/Common/SecurityConfigHelper.ps1` `Add-SecuritySetting` `ValidateSet`

This document defines every status value M365-Assess can emit for a security check, when collectors should use each one, and how each status flows through report math (denominators, framework totals, summary counters).

---

## Why this matters

For a security assessment tool, **false confidence is worse than missing data**. A check that reports `Pass` when the underlying setting could not actually be verified is misleading; a check that reports `Fail` because the tenant doesn't license the feature is unfair. The status model exists so collectors can communicate the *quality* of an assertion alongside the assertion itself.

The taxonomy is intentionally larger than `Pass`/`Fail` so collectors don't have to lie when reality is more nuanced.

---

## The nine statuses

| Status | Meaning | Counts toward Pass% denominator? | Color in report |
|---|---|---|---|
| `Pass` | Secure setting verified against tenant data | ✅ Yes (numerator) | green |
| `Fail` | Insecure setting verified against tenant data | ✅ Yes | red |
| `Warning` | Configured but contextually concerning | ✅ Yes | amber |
| `Review` | Manual validation required to determine pass/fail | ❌ No | blue |
| `Info` | Informational signal; not a posture assertion | ❌ No | gray |
| `Skipped` | Section/check intentionally not run (user-driven) | ❌ No | dark gray |
| `Unknown` | Could not collect — permissions, transient error, API failure | ❌ No | yellow |
| `NotApplicable` | Tenant does not run the relevant service | ❌ No | gray |
| `NotLicensed` | Tenant lacks the license tier the check requires | ❌ No | dark gray |

**Hard rule:** any status other than `Pass`, `Fail`, `Warning` is **excluded from Pass% denominator math**. Not-collected results never inflate or deflate the score.

---

## When to use each

### `Pass` — secure setting verified

Use when the collector observed tenant data and the data matches the recommended setting.

> Example: CA policy `Block legacy authentication` exists, is `Enabled`, and applies to `All users`.

Don't use for partial conditions — those are `Warning`.

### `Fail` — insecure setting verified

Use when the collector observed tenant data and the data is insecure (or missing where it should exist).

> Example: No CA policy blocks legacy authentication.

Don't use when you couldn't verify — that's `Unknown`.

### `Warning` — concerning but contextual

Use when the configuration exists, is technically valid, but raises a posture concern that depends on the tenant's other settings or business context.

> Example: MFA is enforced via Security Defaults rather than CA — works, but blocks finer-grained CA controls.

### `Review` — manual validation required

Use when the collector has all the data but a human judgment is required to determine pass/fail.

> Example: Privileged role assignments — listing them is mechanical; deciding whether each is appropriate is judgment.

### `Info` — informational signal

Use for context that helps interpret other findings but isn't itself a posture statement.

> Example: "Tenant has 142 admin role assignments across 17 distinct roles."

If the data leads to a specific posture conclusion, it should be a `Pass`/`Fail`/`Warning` instead.

### `Skipped` — intentionally not run

Use when the user told the tool not to run this check or section.

> Example: User passed `-Section Identity,Email` — Defender section emits `Skipped` for every Defender check.

This is **user-driven absence**. Differentiate from `Unknown` (tool-driven absence).

### `Unknown` — could not collect

Use when the collector tried to gather data and the attempt failed.

> Examples:
> - Graph returned 403: missing permission scope
> - Graph returned 429: throttling exhausted retry budget
> - Network error: API endpoint unreachable
> - Cmdlet returned `$null` where data was expected

Always include a `Remediation` value pointing to the likely cause (permissions list, retry guidance).

### `NotApplicable` — service not in use

Use when the tenant doesn't run the service the check governs.

> Example: A SharePoint sharing check on a tenant where SharePoint is disabled or has zero sites.

Differentiate from `NotLicensed` (license tier vs. service usage). A tenant may have the license for SharePoint but not actually use it (`NotApplicable`); another tenant may use the service via a third party but lack the M365 license (`NotLicensed`).

### `NotLicensed` — license tier missing

Use when the check requires a specific license SKU (or service plan) and the tenant doesn't have it.

> Example: Defender for Office 365 P2-only check on an E3 tenant.

Source the license requirement from `controls/licensing-overlay.json` (`E3` / `E5` minimum) and resolve to specific service plans at runtime. Always include a `RecommendedValue` like `"Requires Microsoft 365 E5"` so the user knows the upgrade path.

---

## Decision tree

A collector evaluating a check should ask, in order:

```
1. Did the user tell me to skip this section?
     → Skipped
2. Does the tenant have the license tier this check requires?
   No  → NotLicensed
   Yes → continue
3. Is the underlying service in use in this tenant?
   No  → NotApplicable
   Yes → continue
4. Could I successfully collect the data?
   No (permission/error/throttle) → Unknown
   Yes → continue
5. Does the data answer the posture question outright?
   No (needs human judgment) → Review
   Yes → continue
6. Is the data informational only?
   Yes → Info
   No  → continue
7. Compare data to recommended setting:
   Matches               → Pass
   Doesn't match         → Fail
   Matches but contextual → Warning
```

This order matters: `Skipped` comes before `NotLicensed` (user intent wins over license state), and `NotLicensed` comes before `NotApplicable` (no license = no point checking service usage).

---

## Denominator rules

The "M365 posture score" displayed in the executive summary and framework dashboards is computed as:

```
Pass% = Pass / (Pass + Fail + Warning)
```

`Review`, `Info`, `Skipped`, `Unknown`, `NotApplicable`, and `NotLicensed` are **excluded from both numerator and denominator**. This keeps the score honest:

- A tenant where 30% of checks are `Unknown` because of permission gaps doesn't see an artificially-low score
- A tenant on E3 doesn't see an artificially-high failure rate because all the E5-only checks failed

Each rendering surface (HTML report, XLSX matrix, executive summary, framework totals, remediation roadmap) follows the same denominator rule. Issue B8 #779 audits each surface for compliance.

---

## License-adjusted views (forward reference)

Issue D2 #786 layers additional scoring views on top of the base statuses:

- **Security Risk Score** — uses raw statuses (`Pass`/`Fail`/`Warning`)
- **Compliance Readiness Score** — per-framework, treats `NotLicensed` as "not assessable" rather than "missing"
- **License-Adjusted Score** — explicitly excludes `NotLicensed` rows
- **Requires Licensing bucket** — surfaces all `NotLicensed` checks as upgrade candidates

The base status taxonomy is the input to those views; nothing in this doc changes when D2 ships.

---

## Schema versioning

The schema-version line at the top of this doc is the contract for downstream consumers (the React report, M365-Remediate import, custom dashboards). Bumping the version requires:

1. Adding the new value to the `Add-SecuritySetting` `ValidateSet`
2. Updating this doc
3. Updating `Build-ReportData.ps1` to surface the new state
4. Updating each rendering surface in `report-app.jsx` + the XLSX exporter
5. Bumping the `schemaVersion` field in `window.REPORT_DATA` (when REPORT-SCHEMA.md F5 #794 lands)

Removing a status is a breaking change; reserve for a major M365-Assess version bump.

---

## Related

- Issue F4 #793 (closed by this doc)
- Issue B3 #774 — adds `NotApplicable` + `NotLicensed` to the helper (this doc's foundation PR)
- Issue B8 #779 — first-class rendering of all non-`Pass`/`Fail` states across report surfaces
- Issue D2 #786 — license-adjusted scoring views
- Issue F5 #794 — `docs/REPORT-SCHEMA.md` (will reference this doc for the status enum)
- Source of truth: `src/M365-Assess/Common/SecurityConfigHelper.ps1`
