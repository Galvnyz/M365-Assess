# Evidence Model (D1 #785)

## What this is

Every M365-Assess finding answers two questions: **what was checked** (the `Setting` and `CheckId`) and **what was found** (`Status`, `CurrentValue`). The evidence model adds a structured layer for the auditor's question: **how do you know?**

Eight optional fields capture the provenance and confidence of each finding so a consultant can defend a result without re-running the assessment.

---

## The schema

| Field | Type | Purpose |
|---|---|---|
| `ObservedValue` | `string` | Machine-readable representation of what the tenant returned. `CurrentValue` is the human-readable summary (e.g. `"Disabled"`); `ObservedValue` is the raw value (`"false"`, a GUID, a count). |
| `ExpectedValue` | `string` | Machine-readable representation of what the benchmark expects. Companion to `ObservedValue`. |
| `EvidenceSource` | `string` | The Graph endpoint, EXO cmdlet, or DNS query that produced the data (e.g. `Get-AdminAuditLogConfig`, `/identity/conditionalAccess/policies`, `_dmarc.contoso.com TXT`). |
| `EvidenceTimestamp` | `string` | UTC ISO-8601 timestamp of when the upstream data was collected. **Leave empty** if the collector does not have a precise collection time -- do not synthesize one. |
| `CollectionMethod` | `Direct` \| `Derived` \| `Inferred` \| `''` | How the value was determined. `Direct` = read straight from the API. `Derived` = computed from API output. `Inferred` = best-effort based on partial data. |
| `PermissionRequired` | `string` | The Graph scope or RBAC role used to produce this finding (e.g. `Policy.Read.All`, `Exchange Online: View-Only Configuration`). Lets auditors verify the access path. |
| `Confidence` | `double` (`0.0`-`1.0`, nullable) | Confidence in the finding. `null` = unspecified. Distinguishes "this is definitely Pass" (`1.0`) from "best-effort given missing scopes" (e.g. `0.6`). |
| `Limitations` | `string` | Free-text note explaining caveats (e.g. *"Required Reports.Read.All which was not granted; counted user signins from /auditLogs/signIns instead"*). |

All eight fields are **optional**. Existing collectors keep working without changes. New code can populate one, several, or all.

---

## How it flows

```
Collector
  └─ calls Add-Setting / Add-SecuritySetting with evidence params
        └─ helper builds PSCustomObject { Status, CheckId, ..., 8 evidence fields }
              └─ Export-SecurityConfigReport writes per-collector CSV (one column per field)
                    ├─ Build-ReportData reads the row, emits structured `evidence` object
                    │     on window.REPORT_DATA.findings[].evidence (only non-empty fields)
                    │       └─ React Appendix EvidenceBlock renders a per-field table
                    └─ Export-ComplianceMatrix reads the row, populates Sheet 7 "Evidence Details"
```

Empty fields are dropped at every stage:

- The CSV column is empty
- `window.REPORT_DATA.findings[].evidence` omits the field from its object (or sets `evidence` itself to `null` if no field is populated)
- The "Evidence Details" XLSX sheet only includes rows where at least one evidence field is populated

This keeps the output lean for collectors that haven't migrated yet.

---

## When to populate which fields

**Always populate when you have it:**

- `EvidenceSource` -- if you called a specific Graph endpoint or EXO cmdlet, name it. Auditors trace claims back to APIs.
- `PermissionRequired` -- the scope you needed. If you don't know offhand, leave empty rather than guess.

**Populate when meaningful:**

- `ObservedValue` / `ExpectedValue` -- when the comparison is the finding (most rule-based checks). Skip for narrative findings (`Info` rows that summarize multiple values).
- `CollectionMethod` -- when the answer isn't obvious from `EvidenceSource`. A direct GET is usually `Direct`; if you're computing percentages or classifications, use `Derived`.

**Populate only when relevant:**

- `Confidence` -- when the assessment is best-effort. A direct API read with a Pass/Fail rule is typically `1.0`; if you're inferring from partial data because of throttling or missing permissions, use a lower value.
- `Limitations` -- when the auditor needs to know about caveats. Examples: a permission you didn't have, a query you couldn't run, a tenant-specific quirk.
- `EvidenceTimestamp` -- only if you have a true collection time from the upstream API. Don't synthesize `Get-Date` at the helper -- the timestamp would drift seconds-to-minutes for late-stage `Add-SecuritySetting` calls in long collectors.

---

## Migration cookbook

To add structured evidence to an existing collector:

### 1. Extend the local `Add-Setting` wrapper

Most collectors thin-wrap `Add-SecuritySetting` with a local function. Add the eight new optional params and forward them:

```powershell
function Add-Setting {
    param(
        [string]$Category, [string]$Setting, [string]$CurrentValue,
        [string]$RecommendedValue, [string]$Status,
        [string]$CheckId = '', [string]$Remediation = '',
        [PSCustomObject]$Evidence = $null,
        # D1 #785
        [string]$ObservedValue = '',
        [string]$ExpectedValue = '',
        [string]$EvidenceSource = '',
        [string]$EvidenceTimestamp = '',
        [ValidateSet('', 'Direct', 'Derived', 'Inferred')]
        [string]$CollectionMethod = '',
        [string]$PermissionRequired = '',
        [Nullable[double]]$Confidence = $null,
        [string]$Limitations = ''
    )
    Add-SecuritySetting -Settings $settings -CheckIdCounter $checkIdCounter `
        -Category $Category -Setting $Setting -CurrentValue $CurrentValue `
        -RecommendedValue $RecommendedValue -Status $Status `
        -CheckId $CheckId -Remediation $Remediation -Evidence $Evidence `
        -ObservedValue $ObservedValue -ExpectedValue $ExpectedValue `
        -EvidenceSource $EvidenceSource -EvidenceTimestamp $EvidenceTimestamp `
        -CollectionMethod $CollectionMethod -PermissionRequired $PermissionRequired `
        -Confidence $Confidence -Limitations $Limitations
}
```

### 2. Populate at the call sites where it matters

You don't need to migrate every call. Pick the high-signal checks (e.g. ones an auditor is likely to ask about):

```powershell
$settingParams = @{
    Category           = 'Authentication'
    Setting            = 'Modern Authentication Enabled'
    CurrentValue       = "$modernAuth"
    RecommendedValue   = 'True'
    Status             = if ($modernAuth) { 'Pass' } else { 'Fail' }
    CheckId            = 'EXO-AUTH-001'
    # D1 evidence
    ObservedValue      = [string][bool]$modernAuth
    ExpectedValue      = 'True'
    EvidenceSource     = 'Get-OrganizationConfig'
    CollectionMethod   = 'Direct'
    PermissionRequired = 'Exchange Online: View-Only Configuration'
    Confidence         = 1.0
}
Add-Setting @settingParams
```

### 3. Don't fabricate

If you don't know the `EvidenceSource`, leave it empty. Empty fields disappear from the report; fabricated fields mislead auditors. The schema rewards honesty about gaps via `Limitations`, not coverage theatre.

---

## Reference: collectors that already populate evidence

As of v2.9.0:

- `src/M365-Assess/Security/DefenderAntiPhishingChecks.ps1` -- phishing threshold check
- `src/M365-Assess/Exchange-Online/Get-ExoSecurityConfig.ps1` -- modern auth + audit config
- `src/M365-Assess/Entra/EntraConditionalAccessChecks.ps1` -- enabled CA policy count (covers MFA-via-CA scope)
- `src/M365-Assess/Intune/Get-IntuneSecurityConfig.ps1` -- non-compliant default threshold

Future minor releases will adopt the schema in remaining collectors at their own pace -- no coordinated cutover required.

---

## See also

- `docs/CHECK-STATUS-MODEL.md` -- the Pass/Fail/Warning/Review/Info/Skipped/Unknown/NotApplicable/NotLicensed taxonomy these findings live within
- `docs/REPORT-SCHEMA.md` -- the full `window.REPORT_DATA` shape, including how `evidence` slots into `findings[]`
- `docs/EVIDENCE-PACKAGE.md` -- the `-EvidencePackage` ZIP format that bundles structured evidence for auditor handoff (D4 #788)
