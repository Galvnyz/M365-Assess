# Report internals

How the M365-Assess HTML report is built (frontend) and structured (data schema). This doc is for implementers — end users wanting to USE the report should read [`../user/REPORT-USER-GUIDE.md`](../user/REPORT-USER-GUIDE.md).

---

# Part 1 — Frontend build

How the M365-Assess HTML report's React app is sourced, built, and shipped.

---

## What ships in every report

The HTML report is **self-contained** — a single `.html` file that runs in any modern browser with no network dependencies. Every dependency is inlined at report-generation time.

| Asset | Source | License | Rendered at runtime? |
|---|---|---|---|
| React 18 (production build) | [react.production.min.js](https://unpkg.com/react@18.3.1/umd/react.production.min.js) | MIT | ✅ inlined |
| ReactDOM 18 (production build) | [react-dom.production.min.js](https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js) | MIT | ✅ inlined |
| `report-app.js` (compiled) | Babel-transpiled from `report-app.jsx` | MIT (own code) | ✅ inlined |
| `report-shell.css` + `report-themes.css` | Hand-authored | MIT (own code) | ✅ inlined |

Pinned versions live at `src/M365-Assess/assets/react.production.min.js` and `react-dom.production.min.js`. They're committed to the repo so the build is reproducible without npm at report-generation time.

---

## Build pipeline

```
report-app.jsx  ── babel ──>  report-app.js  ── inlined ──>  _Assessment-Report_<tenant>.html
                  (transpile)                 (Get-ReportTemplate.ps1)
```

Babel runs only at developer time:

```powershell
npm install        # installs @babel/cli + @babel/core + @babel/preset-react
npm run build      # transpiles JSX -> ES5-compatible JS
```

`report-app.js` is **committed** to the repo. CI's quality-gates job runs `npm run build` and `git diff` to verify the committed `.js` matches a fresh transpile of the `.jsx`. Any drift fails the PR with an explicit error pointing at the regen command.

### Why React via plain `<script>` and not bundled

`report-app.js` is concatenated into the HTML inside a plain `<script>` tag — no Webpack, no Rollup, no module bundler. Two reasons:

1. **No JSX at runtime.** Babel transpiles JSX → `React.createElement(...)` calls. The browser parser doesn't need a JSX runtime.
2. **Reproducible build minimum.** Adding a bundler would mean reproducible builds depend on bundler config, not just Babel + React versions. Keeping the runtime to "react production min + transpiled JSX" is the smallest defensible footprint.

The cost: every component must use `React.createElement` semantics. JSX edited into `report-app.jsx` survives Babel transpile; raw JSX accidentally pasted into `report-app.js` causes a SyntaxError that blanks the entire report. CI's `node --check` step catches this. See `.claude/rules/` for the project-internal contributor rule.

---

## Pinning + reproducibility

Production React/ReactDOM are committed at known SHA-pinned versions:

```bash
$ shasum -a 256 src/M365-Assess/assets/react.production.min.js
$ shasum -a 256 src/M365-Assess/assets/react-dom.production.min.js
```

Update procedure when bumping React:

1. Download the new pinned version from `unpkg.com/react@<version>/umd/react.production.min.js`
2. Verify the SHA against the [npm package's published shasum](https://www.npmjs.com/package/react)
3. Replace the file in `src/M365-Assess/assets/`
4. Update this doc's table with the new version
5. Test the report renders against `docs/sample-report/` per `.claude/rules/`'s "live test before merging" rule
6. Update `THIRD-PARTY-LICENSES.md`'s React entry if anything material changed

Babel deps (`devDependencies` in `package.json`) are pinned via `package-lock.json`. Update via `npm install <package>@<version> --save-dev` and commit the lock file change.

---

## Supply chain monitoring

CI runs `npm audit --audit-level=high` as an **advisory** step (non-blocking) on every PR that modifies `package.json` or `package-lock.json`. Findings surface in the workflow log; a HIGH-or-above advisory is a signal to investigate but does not auto-fail the build.

Why advisory rather than blocking: Babel devDependencies don't ship to end users. A vulnerability in `@babel/cli` is a developer-machine concern, not a runtime concern for the assessment report. Blocking PRs on advisories that don't affect runtime safety adds friction without commensurate security value.

For genuine runtime concerns (e.g., a CVE in React itself), the bump procedure above applies and the PR description should call out the security driver in CHANGELOG.

### Quarterly cadence

Per the lockfile-hygiene rule (folded in from #678):

- Quarterly: `npm install && npm audit`; review findings; commit any lockfile drift
- Annually: revisit whether Dependabot + manual audit suffices, or whether a dedicated `npm-audit` workflow that opens issues on advisories would add value

---

## License attribution

[`THIRD-PARTY-LICENSES.md`](../THIRD-PARTY-LICENSES.md) at the repo root lists every third-party license shipping in the HTML report or developer build chain. Maintained by hand today (the dep list is small); regenerate from `node_modules/` via `license-checker` if/when the surface grows:

```powershell
npm install -g license-checker
license-checker --production --json | ConvertFrom-Json | Format-Table
```

The licenses doc updates in lockstep with the React/ReactDOM/Babel pinning above. Per `RELEASE-PROCESS.md`, regenerate on every minor or major version bump that changes the dep tree.

---

## Files

| Path | Purpose |
|---|---|
| `src/M365-Assess/assets/react.production.min.js` | Pinned React 18 production build (committed) |
| `src/M365-Assess/assets/react-dom.production.min.js` | Pinned ReactDOM 18 production build (committed) |
| `src/M365-Assess/assets/report-app.jsx` | **Editable source** for the report's React app |
| `src/M365-Assess/assets/report-app.js` | Babel-transpiled output of `.jsx`; committed; CI verifies sync |
| `src/M365-Assess/assets/report-shell.css` | Base CSS (chip styles, layout, status badges) |
| `src/M365-Assess/assets/report-themes.css` | Theme overrides (Neon, Vibe, Console, HighContrast) |
| `src/M365-Assess/Common/Get-ReportTemplate.ps1` | PowerShell function that inlines all assets into the final HTML |
| `package.json` | Babel devDependencies + `npm run build` script |
| `package-lock.json` | Dependency lockfile; committed for reproducible builds |
| `THIRD-PARTY-LICENSES.md` | License attribution (MIT for React/ReactDOM/Babel) |

---

## Related

- See **Part 2 — Data schema** below in this document for the data shape the React app consumes
- [`TESTING.md`](TESTING.md) — local report swap-in test pattern
- [`RELEASE-PROCESS.md`](RELEASE-PROCESS.md) — when to regenerate THIRD-PARTY-LICENSES.md
- `.claude/rules/` (internal) — JSX→JS sync rule, live-test-before-merge rule

---

# Part 2 — Data schema

> **Schema version:** 1.0 (2026-04-26) — when `window.REPORT_DATA.schemaVersion` lands on the runtime, this doc and the code rev together. Until then, this doc tracks the de facto contract.

The HTML report is driven by a single inlined JavaScript blob: `window.REPORT_DATA = {...};`. It's produced by `Common/Build-ReportData.ps1` (function `Build-ReportDataJson`) and consumed by `assets/report-app.jsx`. This document is the contract between them and any downstream tooling that wants to ingest the report data — for example, the M365-Remediate import path, custom dashboards, or external compliance tooling.

The schema is **best-effort stable**. Additive changes (new keys, new finding fields) are non-breaking; removals or type changes require a major-version bump in `M365-Assess.psd1`'s `ModuleVersion`.

---

## Top-level shape

```jsonc
{
  // Tenant identity (#733: DefaultDomain is authoritative for trend matching)
  "tenant": [
    {
      "OrgDisplayName":  "Contoso Ltd",
      "TenantId":        "11111111-2222-3333-4444-555555555555",
      "DefaultDomain":   "contoso.com",
      "CreatedDateTime": "2018-03-15",            // ISO yyyy-MM-dd; #692 normalises locale strings
      "tenantAgeYears":  6.5
    }
  ],

  // User counts (one row)
  "users": [
    {
      "TotalUsers":       2400,
      "Licensed":         2350,
      "GuestUsers":       12,
      "SyncedFromOnPrem": 2380,
      "DisabledUsers":    18,
      "NeverSignedIn":    34,
      "StaleMember":      9
    }
  ],

  // Microsoft Secure Score snapshot (zero rows if SecurityEvents.Read.All unavailable)
  "score": [
    {
      "Percentage":              68,
      "AverageComparativeScore": 52,
      "CurrentScore":            340,
      "MaxScore":                500,
      "CreatedDateTime":         "2026-04-25T00:00:00Z",
      "MicrosoftScore":          0,
      "CustomerScore":           340
    }
  ],

  // Per-MFA-strength counts (drives the MFA distribution KPI)
  "mfaStats": {
    "phishResistant": 0,
    "standard":       1820,
    "weak":           80,
    "none":           450,
    "total":          2350
  },

  "findings":      [ /* see below */ ],
  "domainStats":   { /* see below */ },
  "frameworks":    [ /* see below */ ],

  "licenses": [ { "License": "Microsoft 365 E5", "Assigned": 2350, "Total": 2400 } ],

  "dns": [
    {
      "Domain":      "contoso.com",
      "SPF":         "v=spf1 include:spf.protection.outlook.com -all",
      "DMARC":       "v=DMARC1; p=reject; ...",
      "DMARCPolicy": "reject",
      "DKIM":        "Configured",
      "DKIMStatus":  "OK"
    }
  ],

  "ca": [ { "DisplayName": "Block legacy auth", "State": "enabled" } ],

  "admin-roles": [ { "RoleName": "Global Administrator", "MemberDisplayName": "Alice Wong" } ],

  // Findings grouped by Section, with counts
  "summary": [ { "Section": "Identity", "Items": 64 } ],

  "whiteLabel":   false,                // -WhiteLabel switch on Invoke
  "xlsxFileName": "_Compliance-Matrix_contoso.xlsx",

  // Optional sections (null when not collected or not in scope)
  "mailboxSummary":   { /* hashtable; null if no mailbox data */ },
  "mailflowStats":    { /* hashtable; null if no mail flow */ },
  "sharepointConfig": { "SharingLevel": "ExternalUserSharingOnly", "OneDriveSharingLevel": "..." },
  "adHybrid":         { /* AD/Hybrid panel data; null if section not run */ },
  "deviceStats":      { /* Intune device summary */ },

  // Trend chart (#642): list of saved baselines, ordered chronologically
  "trendData": [
    { "Label": "auto-...", "SavedAt": "2026-04-23T...", "Version": "2.6.0",
      "Pass": 90, "Warn": 41, "Fail": 64, "Review": 42, "Info": 9, "Skipped": 0, "Total": 246 }
  ],
  "trendOptIn": false,                  // gate: -IncludeTrend on Invoke

  // CMMC handoff posture (#594): EZ-CMMC out-of-scope / partial / coverable / inherent
  "cmmcHandoff":  { /* see Get-CmmcHandoff helper */ },
  "cmmcCoverage": { /* per-level coverage metrics */ }
}
```

## Finding object

Every entry in `findings[]` follows this shape:

```jsonc
{
  "checkId":         "ENTRA-MFA-001.1",       // sub-numbered; base via .replace(/\.\d+$/, '')
  "status":          "Pass",                  // see CHECK-STATUS-MODEL.md for the 9 valid values
  "severity":        "high",                  // critical | high | medium | low | none | info
  "domain":          "Entra ID",              // human-readable; from Get-CheckDomain
  "section":         "Identity",              // matches AssessmentMaps.SectionScopeMap key
  "category":        "MFA",
  "setting":         "MFA required for all users",
  "current":         "Disabled",
  "recommended":     "Enabled via CA policy",
  "remediation":     "Configure CA policy ...",
  "effort":          "small",                 // small | medium | large
  "lane":            "now",                   // now | soon | later (drives Roadmap)
  "frameworks":      ["cis-controls-v8", "cmmc", "nist-800-53-r5"],
  "fwMeta": {
    "cmmc":   { "controlId": "IA.L2-3.5.3", "profiles": ["L2"] },
    "nist-800-53-r5": { "controlId": "IA-2", "profiles": [] }
  },
  "references":      [ /* learn-more links from registry */ ],
  "evidence":        { /* optional; D1 #785 -- see Evidence object below */ }
}
```

**Sub-numbering**: a single registry CheckId (`ENTRA-MFA-001`) emits multiple finding rows when the collector inspects the same control in multiple ways. The React app strips trailing `.\d+` to find registry metadata: `baseCheckId = checkId.replace(/\.\d+$/, '')`.

## Evidence object (optional, D1 #785)

When a collector populates any of the structured evidence fields on `Add-SecuritySetting`, `findings[].evidence` is a structured object. When no evidence field is populated, it is `null` (or omitted entirely from the JSON). Consumers should branch on the property's truthiness, not its type.

```jsonc
{
  "observedValue":      "false",                                    // machine-readable
  "expectedValue":      "true",
  "evidenceSource":     "Get-OrganizationConfig",                   // API/cmdlet/endpoint
  "evidenceTimestamp":  "2026-04-26T10:00:00Z",                     // UTC ISO-8601 (optional)
  "collectionMethod":   "Direct",                                   // Direct | Derived | Inferred
  "permissionRequired": "Exchange Online: View-Only Configuration", // scope or RBAC role
  "confidence":         1.0,                                        // 0.0-1.0
  "limitations":        "Org-level audit ≠ active UAL flow",        // free-text caveat
  "raw":                "{...}"                                     // legacy free-form blob (JSON string)
}
```

Empty fields are omitted (so a finding that only sets `EvidenceSource` and `PermissionRequired` produces an object with just those two keys). The `raw` subfield carries the legacy `Add-SecuritySetting -Evidence` blob from collectors that haven't migrated to the structured schema; new collectors should prefer the typed fields. See [`EVIDENCE-MODEL.md`](EVIDENCE-MODEL.md) for the field reference and migration cookbook.

## Status semantics

The `status` field is the canonical taxonomy; see [`CHECK-STATUS-MODEL.md`](../reference/CHECK-STATUS-MODEL.md) for the full decision tree and denominator rules. Valid values:

| Status | Counts toward Pass% denominator? |
|---|---|
| `Pass`, `Fail`, `Warning` | ✅ Yes |
| `Review`, `Info`, `Skipped`, `Unknown`, `NotApplicable`, `NotLicensed` | ❌ No |

Per #802, `Pass% = Pass / (Pass + Fail + Warning)` everywhere — KPI tiles, section bucket scores, framework totals, XLSX `Pass Rate %`. Any consumer of this data should follow the same rule.

## Domain stats

`domainStats` is a hashtable keyed by domain name, with per-domain Pass/Fail/Warn/Review/Info/Skipped counts plus a `total`. Used by the Domain Posture rollup. Example:

```jsonc
{
  "Entra ID":        { "pass": 24, "warn": 3, "fail": 7, "review": 11, "info": 2, "skipped": 0, "total": 47 },
  "Exchange Online": { "pass": 18, "warn": 5, "fail": 4, "review": 6,  "info": 1, "skipped": 0, "total": 34 }
}
```

## Frameworks list

`frameworks` is an array of framework definitions used by the Framework Quilt component. Each entry:

```jsonc
{
  "id":   "cmmc",
  "full": "CMMC v2.0",
  "desc": "DoD supply chain cybersecurity standard...",
  "url":  "https://dodcio.defense.gov/CMMC/"
}
```

Falls back to a hardcoded list inside `report-app.jsx` when this array is empty.

## Versioning

Schema version is currently 1.0 and not yet exposed at runtime as `window.REPORT_DATA.schemaVersion`. **Future**: when M365-Assess hits a major version bump that changes the report shape, the new build will set `schemaVersion` so consumers can detect the shape they're dealing with.

Until then:
- **Additive changes** (new top-level keys, new finding fields) are safe — older consumers ignore them.
- **Type changes or removals** require a major-version bump in `M365-Assess.psd1` `ModuleVersion` AND a CHANGELOG entry.

## Embedding rules

The data is embedded as `<script>window.REPORT_DATA = {...};</script>` inline in the HTML. To prevent HTML injection from string values:

- All occurrences of `</script>` in JSON string values are replaced with `<\/script>`.
- The data is JSON-encoded with depth ≥ 5 (some nested hashtables go that deep).
- The blob ends with a trailing `;` for JS parser tolerance.

A consumer reading the HTML can extract the data with:

```javascript
const m = html.match(/window\.REPORT_DATA = (\{[\s\S]*?\n\});\s*\n<\/script>/);
const data = JSON.parse(m[1].replace(/<\\\/script>/g, '</script>'));
```

(The replace is the inverse of the escape Build-ReportData applies.)

## Related

- [`CHECK-STATUS-MODEL.md`](../reference/CHECK-STATUS-MODEL.md) — status taxonomy + denominator rules
- [`PERMISSIONS.md`](../reference/PERMISSIONS.md) — per-section permissions referenced by `findings[].section`
- `src/M365-Assess/Common/Build-ReportData.ps1` — the producer (function `Build-ReportDataJson`)
- `src/M365-Assess/assets/report-app.jsx` — the consumer (`const D = window.REPORT_DATA`)
- `tests/Common/Build-ReportData.Tests.ps1` — current contract tests
