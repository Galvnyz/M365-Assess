# Report data schema

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

The `status` field is the canonical taxonomy; see [`CHECK-STATUS-MODEL.md`](CHECK-STATUS-MODEL.md) for the full decision tree and denominator rules. Valid values:

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

- [`CHECK-STATUS-MODEL.md`](CHECK-STATUS-MODEL.md) — status taxonomy + denominator rules
- [`PERMISSIONS.md`](PERMISSIONS.md) — per-section permissions referenced by `findings[].section`
- `src/M365-Assess/Common/Build-ReportData.ps1` — the producer (function `Build-ReportDataJson`)
- `src/M365-Assess/assets/report-app.jsx` — the consumer (`const D = window.REPORT_DATA`)
- `tests/Common/Build-ReportData.Tests.ps1` — current contract tests
