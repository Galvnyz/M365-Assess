# M365-Assess: Phase 1 — Quick Wins Implementation Plan

> **Date**: March 2026
> **Scope**: 4 new collectors, 2 existing collector enhancements, orchestrator wiring
> **Prerequisite**: Familiarity with [M365-Expert-Review.md](./M365-Expert-Review.md) gap analysis
> **Version**: No version bump — deferred to Phase 4 release

---

## Table of Contents

1. [Overview](#1-overview)
2. [New Collector: Identity Protection](#2-new-collector-identity-protection)
3. [New Collector: Guest Access](#3-new-collector-guest-access)
4. [New Collector: Service Health](#4-new-collector-service-health)
5. [New Collector: Forwarding Rule Report](#5-new-collector-forwarding-rule-report)
6. [Enhancement: Entra Security Config](#6-enhancement-entra-security-config)
7. [Enhancement: EXO Security Config](#7-enhancement-exo-security-config)
8. [Orchestrator Wiring](#8-orchestrator-wiring)
9. [Implementation Order](#9-implementation-order)
10. [Testing Strategy](#10-testing-strategy)

---

## 1. Overview

### What's In Scope

| # | Work Item | Type | Section | Effort |
|---|-----------|------|---------|--------|
| 1 | `Entra/Get-IdentityProtectionReport.ps1` | New collector | Identity | Medium |
| 2 | `Entra/Get-GuestAccessReport.ps1` | New collector | Identity | Low |
| 3 | `Tenant/Get-ServiceHealthReport.ps1` | New collector + directory | Tenant | Low |
| 4 | `Exchange-Online/Get-ForwardingRuleReport.ps1` | New collector | Email | Medium |
| 5 | `Entra/Get-EntraSecurityConfig.ps1` — 4 new checks | Enhancement | Identity | Medium |
| 6 | `Exchange-Online/Get-ExoSecurityConfig.ps1` — UAL check | Enhancement | Email | Low |
| 7 | `Invoke-M365Assessment.ps1` — wire everything | Orchestrator | — | Low |

### What's NOT In Scope

- Version bump (Phase 4)
- HTML report dashboard changes (Phase 4)
- Framework mappings CSV updates (Phase 2)
- New wizard menu sections — Governance, DataProtection, PowerPlatform (Phase 2-3)
- Remaining 5 Entra Security Config checks (Phase 2)

### Shared Patterns

Every new collector follows the established conventions:

```powershell
<# .SYNOPSIS / .DESCRIPTION / .PARAMETER / .EXAMPLE #>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

# Verify Graph connection
try {
    $context = Get-MgContext
    if (-not $context) {
        Write-Error "Not connected to Microsoft Graph. Run Connect-Service -Service Graph first."
        return
    }
} catch {
    Write-Error "Not connected to Microsoft Graph. Run Connect-Service -Service Graph first."
    return
}

# ... collector logic ...

if ($OutputPath) {
    $results | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported $($results.Count) items to $OutputPath"
} else {
    Write-Output $results
}
```

### License Detection Pattern

Collectors that require premium licenses (Entra ID P2, E5) must detect licensing before attempting API calls:

```powershell
# Check for required license via subscribedSkus
$skus = Invoke-MgGraphRequest -Method GET -Uri 'https://graph.microsoft.com/v1.0/subscribedSkus' -ErrorAction Stop
$hasP2 = $skus.value | Where-Object {
    $_.servicePlans | Where-Object {
        $_.servicePlanName -match 'AAD_PREMIUM_P2|IDENTITY_THREAT_PROTECTION' -and
        $_.provisioningStatus -eq 'Success'
    }
}
if (-not $hasP2) {
    Write-Warning "Entra ID P2 license not detected. <Feature> requires P2 — skipping."
    # Return informational finding instead of data
    $results = @([PSCustomObject]@{
        Category = '<Feature>'
        Setting  = 'License Check'
        CurrentValue = 'Not Licensed'
        RecommendedValue = 'Entra ID P2 or E5'
        Status   = 'Info'
        CisControl = '—'
        Remediation = 'Consider upgrading for <feature> visibility.'
    })
    # ... export and return ...
}
```

Affected collectors: Identity Protection (item 1).

---

## 2. New Collector: Identity Protection

### File: `Entra/Get-IdentityProtectionReport.ps1`

**Purpose**: Assess Entra ID Protection threat posture — risky users, risk detections, risk-based CA policy configuration.

**License requirement**: Entra ID P2, E5, or E5 Security. Must detect and skip gracefully if unlicensed.

### Graph API Endpoints

| Endpoint | Purpose | Notes |
|----------|---------|-------|
| `GET /subscribedSkus` | License detection | Check for P2/E5 before proceeding |
| `GET /identityProtection/riskyUsers` | Risky user list | Filter `$select=id,userDisplayName,userPrincipalName,riskLevel,riskState,riskLastUpdatedDateTime,riskDetail` |
| `GET /identityProtection/riskDetections?$top=200&$orderby=activityDateTime desc` | Recent risk detections | Last 200 detections for aggregate analysis |
| `GET /identityProtection/riskyServicePrincipals` | Risky service principals | May return 403 if not licensed — catch gracefully |
| `GET /identity/conditionalAccess/policies` | CA policies | Filter client-side for policies with `signInRiskLevels` or `userRiskLevels` in conditions |

### Graph Scopes Required

- `IdentityRiskyUser.Read.All`
- `IdentityRiskEvent.Read.All`
- `IdentityRiskyServicePrincipal.Read.All`
- `Policy.Read.All` (already in Identity scope set)

### Output CSV Columns

```
Category, Setting, CurrentValue, Detail, Status, CisControl, Remediation
```

### Output Rows

| Row | Category | Setting | CurrentValue (example) | Status Logic |
|-----|----------|---------|----------------------|-------------|
| 1 | License | Identity Protection License | Licensed / Not Licensed | Info |
| 2 | Risky Users | High Risk User Count | 3 | Fail if > 0 |
| 3 | Risky Users | Medium Risk User Count | 7 | Warning if > 0 |
| 4 | Risky Users | Low Risk User Count | 12 | Info |
| 5 | Risky Users | Unresolved Risky Users | 5 | Fail if > 0 |
| 6 | Risk Detections | Detections (Last 30 Days) | 23 | Info |
| 7 | Risk Detections | Top Detection Type | unfamiliarFeatures (8) | Info |
| 8 | CA Policies | Sign-in Risk Policy Configured | Yes / No | Fail if No |
| 9 | CA Policies | User Risk Policy Configured | Yes / No | Fail if No |
| 10 | Service Principals | Risky Service Principals | 0 | Fail if > 0 |

### Error Handling

- 403 on `riskyServicePrincipals` → catch, set row to "Not Available (insufficient license)", status = Info
- Empty `riskDetections` → normal, report "0 detections in last 30 days"
- Graph throttling (429) → let the orchestrator's existing error handling catch this as a collector failure

### CIS/Framework Mapping

- Sign-in risk CA policy → CIS 1.1.x, NIST SI-4
- User risk CA policy → CIS 1.1.x, NIST SI-4
- Unresolved risky users → ISO A.8.16

### Smoke Test

```powershell
$null = [System.Management.Automation.Language.Parser]::ParseFile(
    'Entra/Get-IdentityProtectionReport.ps1', [ref]$null, [ref]$null)
Get-Command -Name '.\Entra\Get-IdentityProtectionReport.ps1' | Select-Object Name, Parameters
Get-Help .\Entra\Get-IdentityProtectionReport.ps1
```

---

## 3. New Collector: Guest Access

### File: `Entra/Get-GuestAccessReport.ps1`

**Purpose**: Audit guest/external user governance — stale guests, over-permissioned guests, B2B collaboration settings, cross-tenant access defaults.

**License requirement**: None (works with any M365 tier).

### Graph API Endpoints

| Endpoint | Purpose | Notes |
|----------|---------|-------|
| `GET /users?$filter=userType eq 'Guest'&$select=id,displayName,mail,userPrincipalName,createdDateTime,signInActivity,accountEnabled&$top=999` | Guest user list | `signInActivity` requires `AuditLog.Read.All`; page through all results |
| `GET /policies/authorizationPolicy` | Guest restrictions + invitation settings | `guestUserRoleId`, `allowInvitesFrom`, `allowedToSignUpEmailBasedSubscriptions` |
| `GET /policies/crossTenantAccessPolicy/default` | Default cross-tenant trust | Inbound/outbound trust settings |
| `GET /policies/crossTenantAccessPolicy/partners` | Per-org overrides | Count of partner-specific policies |

### Graph Scopes Required

- `User.Read.All` (already in Identity scope set)
- `Policy.Read.All` (already in Identity scope set)
- `AuditLog.Read.All` (already in Identity scope set)
- `CrossTenantInformation.ReadBasic.All` (**NEW** — must add to scope set)

### Output CSV Columns

```
Category, Setting, CurrentValue, Detail, Status, Remediation
```

### Output Rows

| Row | Category | Setting | CurrentValue (example) | Status Logic |
|-----|----------|---------|----------------------|-------------|
| 1 | Guest Inventory | Total Guest Users | 45 | Info |
| 2 | Guest Inventory | Stale Guests (>90 days no sign-in) | 12 | Warning if > 0 |
| 3 | Guest Inventory | Guests Never Signed In | 8 | Warning if > 0 |
| 4 | Guest Inventory | Disabled Guest Accounts | 3 | Info |
| 5 | Invitation Settings | Who Can Invite Guests | Everyone / Members / Admins / None | Fail if "Everyone" |
| 6 | Invitation Settings | Guest User Role | Restricted / Limited / Same as Members | Fail if "Same as Members" |
| 7 | Cross-Tenant Access | Default Inbound Trust | Trust MFA: Yes/No, Trust Compliant Device: Yes/No | Info |
| 8 | Cross-Tenant Access | Default Outbound Trust | Allow B2B: Yes/No | Info |
| 9 | Cross-Tenant Access | Partner-Specific Policies | 3 | Info |

### Stale Guest Detection Logic

```powershell
$staleThreshold = (Get-Date).AddDays(-90)
$staleGuests = $guests | Where-Object {
    $lastSignIn = $_.signInActivity.lastSignInDateTime
    (-not $lastSignIn) -or ([datetime]$lastSignIn -lt $staleThreshold)
}
```

**Note**: `signInActivity` is only populated for users who have signed in at least once. Guests with no `signInActivity` at all are "never signed in" — categorize separately.

### Guest User Role ID Mapping

```powershell
$guestRoleMap = @{
    'a0b1b346-4d3e-4e8b-98f8-753987be4970' = 'Same as Members'      # Fail
    '10dae51f-b6af-4016-8d66-8c2a99b929b6' = 'Limited'              # Pass
    '2af84b1e-32c8-42b7-82bc-daa82404023b' = 'Restricted'           # Pass (most restrictive)
}
```

### Error Handling

- `signInActivity` may be empty for tenants without P1+ → still works, but stale detection falls back to `createdDateTime` comparison
- `crossTenantAccessPolicy/partners` may return empty array → report "0 partner policies"
- Large guest populations (>5000) → use paging with `$top=999` and `@odata.nextLink`

### Smoke Test

```powershell
$null = [System.Management.Automation.Language.Parser]::ParseFile(
    'Entra/Get-GuestAccessReport.ps1', [ref]$null, [ref]$null)
Get-Help .\Entra\Get-GuestAccessReport.ps1
```

---

## 4. New Collector: Service Health

### File: `Tenant/Get-ServiceHealthReport.ps1`

**Purpose**: Capture current M365 service health status, active incidents/advisories, and recent message center items to provide context for assessment findings.

**New directory**: Create `Tenant/` for this and future tenant-scoped collectors. Do NOT move existing `Entra/Get-TenantInfo.ps1` — the orchestrator references its current path.

**License requirement**: None (Service Communications API is available to all M365 tenants).

### Graph API Endpoints

| Endpoint | Purpose | Notes |
|----------|---------|-------|
| `GET /admin/serviceAnnouncement/healthOverviews` | Service health status | All M365 services with current status |
| `GET /admin/serviceAnnouncement/issues?$filter=isResolved eq false&$top=50` | Active incidents | Unresolved issues only |
| `GET /admin/serviceAnnouncement/messages?$top=30&$orderby=startDateTime desc` | Message center | Recent 30 items for context |

### Graph Scopes Required

- `ServiceHealth.Read.All` (**NEW** — must add to Tenant scope set)
- `ServiceMessage.Read.All` (**NEW** — must add to Tenant scope set)

### Output: Two CSV Files

**File 1: `<Name>-Service-Health.csv`** — one row per M365 service

```
Service, Status, ActiveIssues, ActiveAdvisories
```

Example rows:
```
Exchange Online, serviceDegradation, 1, 0
Microsoft Teams, serviceOperational, 0, 0
SharePoint Online, serviceOperational, 0, 2
```

**File 2: `<Name>-Message-Center.csv`** — one row per message center item

```
Id, Title, Category, Severity, StartDateTime, ActionRequiredByDateTime, Services
```

### Status Mapping

```powershell
$statusMap = @{
    'serviceOperational'          = 'Operational'
    'investigating'               = 'Investigating'
    'restoringService'            = 'Restoring'
    'verifyingService'            = 'Verifying'
    'serviceRestored'             = 'Restored'
    'postIncidentReviewPublished' = 'PIR Published'
    'serviceDegradation'          = 'Degraded'
    'serviceInterruption'         = 'Interrupted'
    'extendedRecovery'            = 'Extended Recovery'
    'falsePositive'               = 'False Positive'
    'investigationSuspended'      = 'Suspended'
}
```

### Special Considerations

- This collector produces **two CSVs** (health + messages). The orchestrator currently handles one CSV per collector via `$OutputPath`. Options:
  - **A**: Use the existing `HasSecondary` pattern from Secure Score (collector 16/17). The orchestrator already supports this.
  - **B**: Export both as properties of the primary CSV with a `Type` column.
  - **Recommendation**: Option A — use `HasSecondary = $true` with `SecondaryName = '<N>-Message-Center'` in the collector map, matching the Secure Score pattern.

### Error Handling

- 403 on service health APIs → likely missing admin role. Report "Service Health data unavailable — ensure Service Support Administrator or Global Reader role."
- Empty message center → normal, report as empty CSV

### Smoke Test

```powershell
$null = [System.Management.Automation.Language.Parser]::ParseFile(
    'Tenant/Get-ServiceHealthReport.ps1', [ref]$null, [ref]$null)
Get-Help .\Tenant\Get-ServiceHealthReport.ps1
```

---

## 5. New Collector: Forwarding Rule Report

### File: `Exchange-Online/Get-ForwardingRuleReport.ps1`

**Purpose**: Detect inbox rules that forward, redirect, or copy email to external recipients. This is a critical BEC indicator and data exfiltration detection check.

**License requirement**: None (Exchange Online standard feature).

**Connection**: Exchange Online PowerShell (`Connect-ExchangeOnline`), NOT Graph.

### EXO Cmdlets

| Cmdlet | Purpose | Notes |
|--------|---------|-------|
| `Get-Mailbox -ResultSize Unlimited -RecipientTypeDetails UserMailbox` | All user mailboxes | Get list of mailboxes to scan |
| `Get-InboxRule -Mailbox $upn` | Per-mailbox inbox rules | Check `ForwardTo`, `ForwardAsAttachmentTo`, `RedirectTo` |
| `Get-Mailbox -ResultSize Unlimited` → `ForwardingSmtpAddress`, `ForwardingAddress` | Mailbox-level forwarding | Set via admin, not inbox rules |

### Output CSV Columns

```
UserPrincipalName, DisplayName, RuleType, RuleName, ForwardTo, IsExternal, RuleEnabled, CreatedDate
```

Where `RuleType` is one of:
- `InboxRule-Forward` — `ForwardTo` set on an inbox rule
- `InboxRule-ForwardAsAttachment` — `ForwardAsAttachmentTo` set
- `InboxRule-Redirect` — `RedirectTo` set
- `Mailbox-ForwardingSmtp` — `ForwardingSmtpAddress` set on the mailbox
- `Mailbox-ForwardingAddress` — `ForwardingAddress` set on the mailbox

### External Detection Logic

```powershell
function Test-IsExternalRecipient {
    param([string]$Address, [string[]]$AcceptedDomains)
    if (-not $Address) { return $false }
    # Strip SMTP: prefix if present
    $email = $Address -replace '^smtp:', ''
    $domain = ($email -split '@')[-1]
    return ($domain -and $domain -notin $AcceptedDomains)
}

# Get accepted domains once at the start
$acceptedDomains = (Get-AcceptedDomain).DomainName
```

### Performance Considerations

- **Large tenants (500+ mailboxes)**: `Get-InboxRule` runs per-mailbox — this is an N+1 query pattern. For 500 mailboxes, expect ~2-5 minutes.
- **Progress reporting**: Write verbose progress every 50 mailboxes:
  ```powershell
  if ($i % 50 -eq 0) { Write-Verbose "Scanned $i of $total mailboxes..." }
  ```
- **Error handling per mailbox**: Some mailboxes may have restricted inbox rule access. Wrap per-mailbox `Get-InboxRule` in try/catch — log warning and continue to next mailbox.

### Output Behavior

- If **zero forwarding rules** found → return empty array (this is the good outcome)
- All rules (internal AND external) are exported, with `IsExternal` column for filtering
- The HTML report can highlight external-only rules in red

### Smoke Test

```powershell
$null = [System.Management.Automation.Language.Parser]::ParseFile(
    'Exchange-Online/Get-ForwardingRuleReport.ps1', [ref]$null, [ref]$null)
Get-Help .\Exchange-Online\Get-ForwardingRuleReport.ps1
```

---

## 6. Enhancement: Entra Security Config

### File: `Entra/Get-EntraSecurityConfig.ps1` (modify existing)

**Purpose**: Add 4 high-impact CIS checks to the existing security config collector.

### New Checks to Add

#### Check 1: MFA Enforcement Gap Detection

**The #1 finding in SMB assessments.** Detects when Security Defaults are OFF and no Conditional Access policy enforces MFA for all users.

```
Graph endpoints:
  GET /policies/identitySecurityDefaultsEnforcementPolicy    # Already fetched
  GET /identity/conditionalAccess/policies                   # Already fetched for CA report
```

**Logic:**
```powershell
$secDefaultsEnabled = $securityDefaults.isEnabled
$caPolicies = Invoke-MgGraphRequest -Uri 'https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies'
$mfaEnforcingPolicies = $caPolicies.value | Where-Object {
    $_.state -eq 'enabled' -and
    $_.grantControls.builtInControls -contains 'mfa' -and
    $_.conditions.users.includeUsers -contains 'All'
}

$status = if ($secDefaultsEnabled) { 'Pass' }
          elseif ($mfaEnforcingPolicies.Count -gt 0) { 'Pass' }
          else { 'Fail' }
```

**Output row:**
```
Category: MFA Enforcement
Setting: MFA Coverage
CurrentValue: "Security Defaults: Off, CA MFA Policies: 0"  (or "Security Defaults: On")
RecommendedValue: "Security Defaults enabled OR CA policy enforcing MFA for all users"
Status: Pass / Fail
CisControl: 1.1.1
Severity: Critical
Remediation: "Enable Security Defaults or create a Conditional Access policy requiring MFA for all users."
```

#### Check 2: Authentication Methods Policy

```
Graph endpoint:
  GET /policies/authenticationMethodsPolicy
```

**New scope required**: `AuthenticationMethod.Read.All` — add to Identity `$sectionScopeMap`.

**Logic**: Check which methods are enabled/disabled. Key findings:
- SMS enabled as an auth method → Warning (phishable)
- FIDO2/Passkeys disabled → Info (recommend enabling for phishing-resistant MFA)
- Email OTP enabled for all → Warning (weak factor)

**Output rows** (one per key method):
```
Category: Authentication Methods
Setting: <MethodName> (<fido2/microsoftAuthenticator/sms/email/temporaryAccessPass>)
CurrentValue: Enabled for: All Users / Specific Groups / Disabled
RecommendedValue: (varies by method)
Status: Pass / Warning / Info
CisControl: 1.1.x
```

#### Check 3: Cross-Tenant Access Policy

```
Graph endpoint:
  GET /policies/crossTenantAccessPolicy/default
```

**New scope required**: `CrossTenantInformation.ReadBasic.All` — add to Identity `$sectionScopeMap`.

**Logic**: Check default inbound/outbound trust settings:
- `b2bCollaborationInbound.usersAndGroups.accessType` — who can be invited inbound
- `inboundTrust.isMfaAccepted` — whether external MFA is trusted (dangerous if true without per-org policies)

**Output rows:**
```
Category: Cross-Tenant Access
Setting: Default Inbound MFA Trust
CurrentValue: Trusted / Not Trusted
RecommendedValue: Not Trusted (unless per-org policies override)
Status: Warning if trusted globally
CisControl: —
```

#### Check 4: External Collaboration Settings

```
Graph endpoint:
  GET /policies/authorizationPolicy    # Already fetched for other checks
```

**Logic**: Check `allowInvitesFrom` value:
- `everyone` → Fail (any user can invite guests)
- `adminsAndGuestInviters` → Pass
- `adminsGuestInvitersAndAllMembers` → Warning
- `none` → Pass (most restrictive)

**Output row:**
```
Category: External Collaboration
Setting: Guest Invitation Permissions
CurrentValue: Everyone / Admins and Guest Inviters / Members / None
RecommendedValue: Admins and Guest Inviters only
Status: Pass / Warning / Fail
CisControl: 1.x
```

### Implementation Notes

- These 4 checks add to the **end** of the existing check list in `Get-EntraSecurityConfig.ps1`
- Follow the existing pattern: each check appends a `[PSCustomObject]` to the `$results` array
- The `authorizationPolicy` is likely already fetched for SSPR checks — reuse the cached response rather than making a duplicate API call
- Wrap each new check in its own try/catch so a failure in one doesn't block the others

---

## 7. Enhancement: EXO Security Config

### File: `Exchange-Online/Get-ExoSecurityConfig.ps1` (modify existing)

**Purpose**: Add Unified Audit Log status check — the #1 Exchange finding.

### New Check: Unified Audit Log Status

```
EXO Cmdlet:
  Get-AdminAuditLogConfig → UnifiedAuditLogIngestionEnabled
```

**Logic:**
```powershell
$auditConfig = Get-AdminAuditLogConfig
$ualEnabled = $auditConfig.UnifiedAuditLogIngestionEnabled

$status = if ($ualEnabled) { 'Pass' } else { 'Fail' }
```

**Output row:**
```
Category: Audit & Logging
Setting: Unified Audit Log
CurrentValue: Enabled / Disabled
RecommendedValue: Enabled
Status: Pass / Fail
CisControl: 6.1.1
Severity: Critical
Remediation: "Enable Unified Audit Log: Set-AdminAuditLogConfig -UnifiedAuditLogIngestionEnabled $true"
```

### Implementation Notes

- This is a single check added to the end of the existing EXO security config output
- `Get-AdminAuditLogConfig` is available to all Exchange Online tenants — no license gating
- The cmdlet requires Exchange Online connection (already established by this point in the assessment)

---

## 8. Orchestrator Wiring

### File: `Invoke-M365Assessment.ps1` (modify existing)

### Changes Required

#### 8a. New Directory

Create `Tenant/` directory at the project root. No existing files are moved.

#### 8b. Add Collectors to `$collectorMap`

**Identity section** (~line 900, after `07b-Entra-Security-Config`):
```powershell
@{ Name = '07c-Identity-Protection'; Script = 'Entra\Get-IdentityProtectionReport.ps1';  Label = 'Identity Protection' }
@{ Name = '07d-Guest-Access';        Script = 'Entra\Get-GuestAccessReport.ps1';          Label = 'Guest Access' }
```

**Tenant section** (~line 897, after `01-Tenant-Info`):
```powershell
@{ Name = '01b-Service-Health'; Script = 'Tenant\Get-ServiceHealthReport.ps1'; Label = 'Service Health'; HasSecondary = $true; SecondaryName = '01c-Message-Center' }
```

**Email section** (~line 912, after `11b-EXO-Security-Config`):
```powershell
@{ Name = '12-Forwarding-Rules'; Script = 'Exchange-Online\Get-ForwardingRuleReport.ps1'; Label = 'Forwarding Rules'; RequiredServices = @('ExchangeOnline') }
```

#### 8c. Update `$sectionScopeMap`

**Identity** (~line 864) — add 3 new scopes:
```powershell
'Identity' = @(
    # ... existing scopes ...
    'IdentityRiskyUser.Read.All',
    'IdentityRiskEvent.Read.All',
    'IdentityRiskyServicePrincipal.Read.All',
    'CrossTenantInformation.ReadBasic.All',
    'AuthenticationMethod.Read.All'
)
```

**Tenant** (~line 863) — add 2 new scopes:
```powershell
'Tenant' = @(
    # ... existing scopes ...
    'ServiceHealth.Read.All',
    'ServiceMessage.Read.All'
)
```

#### 8d. Update `$sectionModuleMap`

No new Graph submodules needed — all new endpoints use `Invoke-MgGraphRequest` direct REST calls rather than typed cmdlets.

#### 8e. No Wizard Changes

The new collectors are added to **existing sections** (Identity, Tenant, Email). No new section menu entries needed.

---

## 9. Implementation Order

Tasks should be implemented in this order due to dependencies:

```
 1. Create Tenant/ directory
 2. Entra Security Config enhancements (item 6)     ← no orchestrator dependency
 3. EXO Security Config UAL check (item 7)           ← no orchestrator dependency
 4. Get-IdentityProtectionReport.ps1 (item 1)        ← independent
 5. Get-GuestAccessReport.ps1 (item 2)               ← independent
 6. Get-ServiceHealthReport.ps1 (item 3)             ← needs Tenant/ dir from step 1
 7. Get-ForwardingRuleReport.ps1 (item 4)            ← independent
 8. Orchestrator wiring (item 8)                     ← depends on all above
 9. Lint all changed/new files with PSScriptAnalyzer
10. Parse check all new files
```

Steps 2-7 are **parallelizable** — they can be developed in any order or concurrently since they're independent scripts. Steps 4 and 5 can share research on Graph identity protection endpoints. Step 8 must be last.

### Estimated Collector Numbering (Post Phase 1)

| Name | Label | Section |
|------|-------|---------|
| `01-Tenant-Info` | Tenant Information | Tenant |
| `01b-Service-Health` | Service Health | Tenant |
| `01c-Message-Center` | *(secondary of 01b)* | Tenant |
| `02` through `07b` | *(unchanged)* | Identity |
| `07c-Identity-Protection` | Identity Protection | Identity |
| `07d-Guest-Access` | Guest Access | Identity |
| `08` through `11b` | *(unchanged)* | Licensing / Email |
| `12-Forwarding-Rules` | Forwarding Rules | Email |
| `13` through `27` | *(unchanged)* | Intune / Security / Collab / Hybrid / etc. |

---

## 10. Testing Strategy

### Per-Collector Smoke Tests

Run after each new/modified collector:

```powershell
# 1. Parse check (no syntax errors)
$errors = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$errors)
if ($errors) { throw "Parse errors in $path" }

# 2. Help check (comment-based help exists)
Get-Help $path | Select-Object Synopsis, Description, Parameters

# 3. Parameter check (CmdletBinding, OutputPath param)
Get-Command $path | Select-Object -ExpandProperty Parameters

# 4. PSScriptAnalyzer lint
Invoke-ScriptAnalyzer -Path $path -Severity Warning, Error
```

### Integration Test (after orchestrator wiring)

Run a full assessment against a test tenant and verify:

1. All new collectors appear in the wizard section summary
2. New collectors execute without errors (Complete status)
3. CSVs are generated with expected columns
4. HTML report renders new collector data in the correct sections
5. Identity Protection gracefully skips on tenants without P2
6. Guest Access handles tenants with zero guests
7. Service Health handles tenants with no active incidents
8. Forwarding Rules handles tenants with zero forwarding rules
9. New Entra Security Config checks appear in the CIS benchmark table
10. UAL check appears in the EXO Security Config section

### Live Tenant Validation

The primary validation method is running against a live M365 tenant. Test across:
- **E3 tenant** — verify Identity Protection skips gracefully (no P2)
- **E5 tenant** — verify all collectors run with full data
- **Tenant with guests** — verify Guest Access report shows stale/active breakdown
- **Tenant with forwarding rules** — verify external detection works correctly
