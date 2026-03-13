# v0.8.0 CIS Gap Closure Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close 51 of 61 CIS-Automated gaps, bringing coverage from 68/129 (53%) to 108/129 (84%).

**Architecture:** 3 new collectors (CA evaluator, DNS security, Intune security) + extensions to 5 existing collectors. Phased across 4 PRs on branch `feature/v080-cis-gap-closure`. Each PR is independently testable.

**Tech Stack:** PowerShell 7.x, Microsoft Graph REST API (v1.0 + beta), Exchange Online Management cmdlets, Pester 5.x, PSScriptAnalyzer.

**Spec:** `docs/superpowers/specs/2026-03-13-v080-cis-gap-closure-design.md`

---

## Chunk 1: Version Bump + PR 1 (CA Policy Evaluator)

### Task 1: Version Bump 0.7.0 to 0.8.0

**Files:**
- Modify: `Invoke-M365Assessment.ps1` (`.NOTES` block + `$script:AssessmentVersion` ~line 134)
- Modify: `Common/Export-AssessmentReport.ps1` (`.NOTES` block + `$assessmentVersion` ~line 156)
- Modify: `Entra/Get-EntraSecurityConfig.ps1` (`.NOTES` block)
- Modify: `Exchange-Online/Get-ExoSecurityConfig.ps1` (`.NOTES` block)
- Modify: `Security/Get-DefenderSecurityConfig.ps1` (`.NOTES` block)
- Modify: `Collaboration/Get-SharePointSecurityConfig.ps1` (`.NOTES` block)
- Modify: `Collaboration/Get-TeamsSecurityConfig.ps1` (`.NOTES` block)
- Modify: `Security/Get-ComplianceSecurityConfig.ps1` (`.NOTES` block)
- Modify: `M365-Assess.psd1` (`ModuleVersion` + `ReleaseNotes`)
- Modify: `README.md` (version badge)
- Modify: `.claude/rules/versions.md` (current version + add 3 new collector rows)

- [ ] **Step 1: Replace `0.7.0` with `0.8.0` in all 11 locations listed in `.claude/rules/versions.md`**

  Use `Select-String` to find all version locations, then update each. The version checklist in `.claude/rules/versions.md` lists every file and line.

- [ ] **Step 2: Update `M365-Assess.psd1`**

  - `ModuleVersion = '0.8.0'`
  - `ReleaseNotes = 'v0.8.0 - CIS gap closure: 51 new checks (CA evaluator, DNS security, Intune, PIM, org settings), 3 new collectors'`

- [ ] **Step 3: Update `.claude/rules/versions.md`**

  - Change `Current: **0.7.0**` to `Current: **0.8.0**`
  - Add 3 new rows to the version bump table:

  ```
  | 12 | `Entra/Get-CASecurityConfig.ps1` | `.NOTES` block -> `Version:` | Comment |
  | 13 | `Exchange-Online/Get-DnsSecurityConfig.ps1` | `.NOTES` block -> `Version:` | Comment |
  | 14 | `Intune/Get-IntuneSecurityConfig.ps1` | `.NOTES` block -> `Version:` | Comment |
  ```

- [ ] **Step 4: Update `README.md`**

  - Version badge: `version-0.8.0-blue`
  - Automated count: update to final number after all PRs (placeholder for now: "82 automated" stays until PR 4 updates it)

- [ ] **Step 5: Verify version consistency**

  Run: `pwsh -NoProfile -Command "Select-String -Path *.ps1,**/*.ps1,README.md -Pattern 'Version:\s+\d+\.\d+\.\d+|AssessmentVersion\s*=|version-\d+\.\d+\.\d+' | Sort-Object Path"`

  Expected: All locations show `0.8.0`.

### Task 2: Create CA Policy Evaluator Collector

**Files:**
- Create: `Entra/Get-CASecurityConfig.ps1`
- Modify: `Invoke-M365Assessment.ps1` (~line 940, Identity section of collectorMap)
- Modify: `M365-Assess.psd1` (FileList array)
- Modify: `Common/Show-CheckProgress.ps1` (3 maps + CollectorOrder)
- Modify: `Entra/Get-EntraSecurityConfig.ps1` (~lines 456-471, remove ENTRA-CA-001 legacy auth check)

- [ ] **Step 1: Create `Entra/Get-CASecurityConfig.ps1` scaffold**

  Follow the exact pattern from `Security/Get-ComplianceSecurityConfig.ps1`:
  - Comment-based help (`.SYNOPSIS`, `.DESCRIPTION`, `.PARAMETER OutputPath`, `.EXAMPLE`, `.NOTES`)
  - `[CmdletBinding()] param([string]$OutputPath)`
  - `$settings = [System.Collections.Generic.List[PSCustomObject]]::new()`
  - `$checkIdCounter = @{}`
  - `Add-Setting` function (identical to other collectors)
  - Output section at bottom: `$report = @($settings)` + optional CSV export + `Write-Output $report`

- [ ] **Step 2: Add Graph API call to fetch CA policies**

  ```powershell
  # ------------------------------------------------------------------
  # Fetch Conditional Access policies
  # ------------------------------------------------------------------
  try {
      Write-Verbose "Fetching Conditional Access policies..."
      $caPolicies = Invoke-MgGraphRequest -Method GET `
          -Uri '/v1.0/identity/conditionalAccess/policies' -ErrorAction Stop
      $allPolicies = @($caPolicies['value'])
      $enabledPolicies = @($allPolicies | Where-Object { $_['state'] -eq 'enabled' })
  }
  catch {
      Write-Warning "Could not retrieve CA policies: $_"
      $allPolicies = @()
      $enabledPolicies = @()
  }
  ```

- [ ] **Step 3: Implement CA-LEGACYAUTH-001 (CIS 5.2.2.3) -- migrated from ENTRA-CA-001**

  Filter enabled policies for `clientAppTypes` containing `exchangeActiveSync` or `other` with `block` grant control. This is the existing logic from `Get-EntraSecurityConfig.ps1:457-471`, moved here.

- [ ] **Step 4: Implement CA-MFA-ADMIN-001 (CIS 5.2.2.1)**

  Filter enabled policies for:
  - `conditions.users.includeRoles` is non-empty (targets admin role template IDs)
  - `grantControls.builtInControls` contains `mfa`
  - Report matching policy names in CurrentValue

- [ ] **Step 5: Implement CA-MFA-ALL-001 (CIS 5.2.2.2)**

  Filter enabled policies for:
  - `conditions.users.includeUsers` contains `All`
  - `grantControls.builtInControls` contains `mfa`

- [ ] **Step 6: Implement CA-SIGNIN-FREQ-001 (CIS 5.2.2.4)**

  Filter enabled policies targeting admin roles with:
  - `sessionControls.signInFrequency` is configured
  - `sessionControls.persistentBrowser.mode` equals `never`

- [ ] **Step 7: Implement CA-PHISHRES-001 (CIS 5.2.2.5)**

  Filter enabled policies targeting admin roles with:
  - `grantControls.authenticationStrength` referencing phishing-resistant preset
  - Note: This uses the `authenticationStrength` property (may be null on older tenants)

- [ ] **Step 8: Implement CA-USERRISK-001 (CIS 5.2.2.6) and CA-SIGNINRISK-001/002 (CIS 5.2.2.7, 5.2.2.8)**

  Three related checks using risk-level conditions:
  - `conditions.userRiskLevels` populated + appropriate grant control
  - `conditions.signInRiskLevels` populated + appropriate grant control
  - `conditions.signInRiskLevels` contains both `medium` and `high` + `block`

- [ ] **Step 9: Implement CA-DEVICE-001 (CIS 5.2.2.9) and CA-DEVICE-002 (CIS 5.2.2.10)**

  - DEVICE-001: `grantControls.builtInControls` contains `compliantDevice` or `domainJoinedDevice`
  - DEVICE-002: Same + `conditions.users.includeUserActions` contains `urn:user:registerSecurityInfo`

- [ ] **Step 10: Implement CA-INTUNE-001 (CIS 5.2.2.11)**

  Filter for policies targeting Intune enrollment app ID (`d4ebce55-015a-49b5-a083-c84d1797ae8c`) with `signInFrequency` set to every time.

- [ ] **Step 11: Implement CA-DEVICECODE-001 (CIS 5.2.2.12)**

  Filter for policies where `conditions.authenticationFlows.transferMethods` contains `deviceCodeFlow` with `block` grant.
  Note: This is a newer CA feature. If the property doesn't exist in the API response, emit `Review` status.

- [ ] **Step 12: Remove ENTRA-CA-001 from Get-EntraSecurityConfig.ps1**

  Remove lines 456-471 (the legacy auth block check). Keep ENTRA-CA-002 and ENTRA-CA-003 (info counts).

- [ ] **Step 13: Wire collector into orchestrator**

  Add to `$collectorMap['Identity']` array after `07b-Entra-Security-Config`:

  ```powershell
  @{ Name = '07c-CA-Security-Config'; Script = 'Entra\Get-CASecurityConfig.ps1'; Label = 'CA Policy Evaluation' }
  ```

- [ ] **Step 14: Wire into Show-CheckProgress.ps1**

  Add to the 3 maps and CollectorOrder:

  ```powershell
  # CollectorSectionMap
  'CAEvaluator' = 'Identity'

  # CollectorLabelMap
  'CAEvaluator' = 'CA Policy Evaluation'

  # CollectorOrder -- insert after 'Entra'
  @('Entra', 'CAEvaluator', 'ExchangeOnline', 'Defender', 'Compliance', 'SharePoint', 'Teams')
  ```

- [ ] **Step 15: Add `Entra\Get-CASecurityConfig.ps1` to `M365-Assess.psd1` FileList**

- [ ] **Step 16: Update registry.json -- add 12 new entries + supersededBy**

  For each of the 12 CA checks:
  1. Add new entry with `hasAutomatedCheck: true`, `collector: "CAEvaluator"`, category, and full framework mappings (copy from corresponding MANUAL entry)
  2. Add `"supersededBy": "<CA-checkId>"` to the corresponding `MANUAL-CIS-*` entry

  Special case: ENTRA-CA-001 -- set `hasAutomatedCheck: false` and add `"supersededBy": "CA-LEGACYAUTH-001"`.

  Framework mappings for each CIS control: copy from the existing MANUAL entries (they have complete NIST, ISO, PCI, CMMC, HIPAA, SOC2 mappings).

- [ ] **Step 17: Validate PR 1**

  Run all 4 validation checks:

  ```powershell
  # Parse check
  [scriptblock]::Create((Get-Content 'Entra/Get-CASecurityConfig.ps1' -Raw))

  # JSON validation
  Get-Content 'controls/registry.json' -Raw | ConvertFrom-Json

  # PSScriptAnalyzer
  Invoke-ScriptAnalyzer -Path 'Entra/Get-CASecurityConfig.ps1' -Severity Warning,Error

  # Pester
  Invoke-Pester tests/ -Output Detailed
  ```

  Expected: Parse OK, JSON OK, Lint clean (except BOM), all Pester tests pass.

- [ ] **Step 18: Commit PR 1**

  ```bash
  git add Entra/Get-CASecurityConfig.ps1 Entra/Get-EntraSecurityConfig.ps1 \
    Invoke-M365Assessment.ps1 M365-Assess.psd1 Common/Show-CheckProgress.ps1 \
    Common/Export-AssessmentReport.ps1 Exchange-Online/Get-ExoSecurityConfig.ps1 \
    Security/Get-DefenderSecurityConfig.ps1 Security/Get-ComplianceSecurityConfig.ps1 \
    Collaboration/Get-SharePointSecurityConfig.ps1 Collaboration/Get-TeamsSecurityConfig.ps1 \
    controls/registry.json README.md .claude/rules/versions.md
  git commit -m "feat: add CA policy evaluator collector with 12 CIS 5.2.2.x checks"
  ```

---

## Chunk 2: PR 2 (Entra Expansion + PIM)

### Task 3: Entra Identity Extensions (9 checks)

**Files:**
- Modify: `Entra/Get-EntraSecurityConfig.ps1`
- Modify: `controls/registry.json`

- [ ] **Step 1: Implement ENTRA-PERUSER-001 (CIS 5.1.2.1) -- Per-user MFA disabled**

  New section after existing auth method checks. Use Graph beta to check per-user MFA state:
  ```
  Invoke-MgGraphRequest -Uri '/beta/reports/authenticationMethods/userRegistrationDetails'
  ```
  Check that no users have `perUserMfaState` set to `enforced` or `enabled` (should use CA policies instead).

- [ ] **Step 2: Implement ENTRA-APPS-001 (CIS 5.1.2.2) -- Third-party apps blocked**

  From existing `$authPolicy` (authorizationPolicy already fetched ~line 138):
  - Check `defaultUserRolePermissions.allowedToCreateApps -eq $false`
  - Or check app consent settings restrict third-party integrated apps

- [ ] **Step 3: Implement ENTRA-GUEST-004 (CIS 5.1.6.1) -- Invitation domains restricted**

  From existing `$authPolicy` or new call to `/v1.0/policies/crossTenantAccessPolicy/default`:
  - Check that `allowInvitesFrom` is not `everyone`
  - Check allowed domain list is configured

- [ ] **Step 4: Implement ENTRA-GROUP-002 (CIS 5.1.3.1) -- Dynamic guest group exists**

  New Graph call:
  ```
  Invoke-MgGraphRequest -Uri "/v1.0/groups?\$filter=groupTypes/any(g:g eq 'DynamicMembership')&\$select=displayName,membershipRule"
  ```
  Check at least 1 group has `membershipRule` containing `user.userType -eq "Guest"`.

- [ ] **Step 5: Implement ENTRA-DEVICE-004/005/006 (CIS 5.1.4.4, 5.1.4.5, 5.1.4.6)**

  Extend existing device registration section (already fetches `/v1.0/policies/deviceRegistrationPolicy`):
  - DEVICE-004: Check `localAdmins` configuration restricts who becomes local admin on join
  - DEVICE-005: Check `localAdminPassword.isEnabled -eq $true` (LAPS)
  - DEVICE-006: New Graph call for BitLocker recovery key restrictions:
    ```
    Invoke-MgGraphRequest -Uri '/beta/policies/deviceRegistrationPolicy'
    ```
    Check that BitLocker recovery key visibility is restricted.

- [ ] **Step 6: Implement ENTRA-AUTHMETHOD-003 (CIS 5.2.3.1) -- Authenticator fatigue protection**

  From existing `$sspr` (authenticationMethodsPolicy already fetched):
  - Find Microsoft Authenticator in `authenticationMethodConfigurations`
  - Check `featureSettings.numberMatchingRequiredState.state -eq 'enabled'`
  - Check `featureSettings.displayAppInformationRequiredState.state -eq 'enabled'`

- [ ] **Step 7: Implement ENTRA-AUTHMETHOD-004 (CIS 5.2.3.6) -- System-preferred MFA**

  From existing `$sspr`:
  - Check `systemCredentialPreferences.state -eq 'enabled'`

- [ ] **Step 8: Update registry.json for 9 new entries + supersededBy on MANUAL entries**

- [ ] **Step 9: Validate -- parse, lint, JSON, Pester**

### Task 4: PIM Checks (5 checks, license-gated)

**Files:**
- Modify: `Entra/Get-EntraSecurityConfig.ps1`
- Modify: `controls/registry.json`

- [ ] **Step 1: Implement license-gated PIM section**

  Add new section with try/catch pattern for 403 handling:

  ```powershell
  # ------------------------------------------------------------------
  # 22. Privileged Identity Management (CIS 5.3.x) -- requires Entra ID P2
  # ------------------------------------------------------------------
  $pimAvailable = $true
  try {
      $roleAssignments = Invoke-MgGraphRequest -Method GET `
          -Uri '/beta/roleManagement/directory/roleAssignmentScheduleInstances' -ErrorAction Stop
  }
  catch {
      if ($_.Exception.Message -match '403|Forbidden|Authorization') {
          $pimAvailable = $false
      } else {
          Write-Warning "Could not check PIM: $_"
          $pimAvailable = $false
      }
  }
  ```

- [ ] **Step 2: Implement ENTRA-PIM-001 (CIS 5.3.1) -- PIM manages roles**

  If `$pimAvailable`:
  - Check that Global Administrator role has no permanent active assignments (all should be eligible/time-bound via PIM)
  - Pass: 0 permanent GA assignments. Fail: any permanent assignments exist.

  If not available:
  ```powershell
  Add-Setting -Category 'Privileged Identity Management' -Setting 'PIM Manages Roles' `
      -CurrentValue 'Requires Entra ID P2 license' `
      -RecommendedValue 'PIM enabled for all privileged roles' `
      -Status 'Review' -CheckId 'ENTRA-PIM-001' `
      -Remediation 'This check requires Entra ID P2 (included in M365 E5). Enable PIM at Entra admin center > Identity Governance > Privileged Identity Management.'
  ```

- [ ] **Step 3: Implement ENTRA-PIM-002/003 (CIS 5.3.2, 5.3.3) -- Access reviews**

  New Graph call (inside pimAvailable guard):
  ```
  Invoke-MgGraphRequest -Uri '/beta/identityGovernance/accessReviews/definitions'
  ```
  - PIM-002: Check at least 1 access review targets guest users
  - PIM-003: Check at least 1 access review targets admin roles

- [ ] **Step 4: Implement ENTRA-PIM-004/005 (CIS 5.3.4, 5.3.5) -- Activation approval**

  New Graph call:
  ```
  Invoke-MgGraphRequest -Uri '/beta/policies/roleManagementPolicies'
  ```
  - PIM-004: Check Global Administrator role policy has `isApprovalRequired -eq $true`
  - PIM-005: Check Privileged Role Administrator policy has `isApprovalRequired -eq $true`

- [ ] **Step 5: Update registry.json for 5 new entries + supersededBy**

- [ ] **Step 6: Validate -- parse, lint, JSON, Pester**

- [ ] **Step 7: Commit PR 2**

  ```bash
  git add Entra/Get-EntraSecurityConfig.ps1 controls/registry.json
  git commit -m "feat: add 14 Entra/PIM automated CIS checks (9 identity + 5 PIM license-gated)"
  ```

---

## Chunk 3: PR 3 (DNS + Defender + EXO Email)

### Task 5: Create DNS Security Config Collector

**Files:**
- Create: `Exchange-Online/Get-DnsSecurityConfig.ps1`
- Modify: `Invoke-M365Assessment.ps1` (Email section of collectorMap)
- Modify: `M365-Assess.psd1` (FileList)
- Modify: `Common/Show-CheckProgress.ps1` (3 maps + CollectorOrder)

- [ ] **Step 1: Create `Exchange-Online/Get-DnsSecurityConfig.ps1` scaffold**

  Same pattern as other collectors. `.NOTES Version: 0.8.0`.

- [ ] **Step 2: Implement DNS-SPF-001 (CIS 2.1.8) -- SPF for all domains**

  ```powershell
  $domains = Get-AcceptedDomain | Where-Object { $_.DomainType -eq 'Authoritative' }
  $spfResults = @()
  foreach ($domain in $domains) {
      $txt = Resolve-DnsName -Name $domain.DomainName -Type TXT -ErrorAction SilentlyContinue
      $spf = $txt | Where-Object { $_.Strings -match '^v=spf1' }
      $spfResults += [PSCustomObject]@{ Domain = $domain.DomainName; HasSPF = ($null -ne $spf) }
  }
  $missing = @($spfResults | Where-Object { -not $_.HasSPF })
  ```
  Pass if 0 missing. Fail if any missing, listing domain names in CurrentValue.

- [ ] **Step 3: Implement DNS-DKIM-001 (CIS 2.1.9) -- DKIM for all domains**

  ```powershell
  $dkimConfigs = Get-DkimSigningConfig -ErrorAction SilentlyContinue
  ```
  Check each authoritative domain has `Enabled -eq $true` in DKIM config.

- [ ] **Step 4: Implement DNS-DMARC-001 (CIS 2.1.10) -- DMARC for all domains**

  For each authoritative domain, resolve `_dmarc.<domain>` TXT record.
  Pass requires `p=quarantine` or `p=reject` (not `p=none`).

- [ ] **Step 5: Wire into orchestrator, Show-CheckProgress, M365-Assess.psd1**

  CollectorMap entry in Email section:
  ```powershell
  @{ Name = '12b-DNS-Security-Config'; Script = 'Exchange-Online\Get-DnsSecurityConfig.ps1'; Label = 'DNS Security Config'; RequiredServices = @('ExchangeOnline') }
  ```

  Show-CheckProgress:
  ```powershell
  'DNS' = 'Email'           # CollectorSectionMap
  'DNS' = 'DNS Security Config'  # CollectorLabelMap
  # CollectorOrder: insert after 'ExchangeOnline'
  ```

### Task 6: Defender Collector Extensions (5 checks)

**Files:**
- Modify: `Security/Get-DefenderSecurityConfig.ps1`
- Modify: `controls/registry.json`

- [ ] **Step 1: Implement DEFENDER-MALWARE-002 (CIS 2.1.11) -- Comprehensive attachment filter**

  After existing malware filter section. Reuse `$malwareFilterPolicy`:
  - Check `EnableFileFilter -eq $true`
  - Optionally verify the file types list covers common dangerous extensions

- [ ] **Step 2: Implement DEFENDER-ANTISPAM-002 (CIS 2.1.14) -- No allowed domains**

  After existing anti-spam section. Reuse `$contentFilterPolicy`:
  - Check `AllowedSenderDomains.Count -eq 0`
  - If Fail, list the allowed domains in CurrentValue

- [ ] **Step 3: Implement DEFENDER-PRIORITY-001/002 (CIS 2.4.1, 2.4.2) -- Priority accounts**

  New cmdlet call, gated:
  ```powershell
  $priorityAvailable = Get-Command -Name Get-EOPProtectionPolicyRule -ErrorAction SilentlyContinue
  ```
  - PRIORITY-001: Check priority account tag/protection is configured
  - PRIORITY-002: Check strict preset policy applies to priority-tagged users
  - If cmdlet unavailable, emit Review

- [ ] **Step 4: Implement DEFENDER-ZAP-001 (CIS 2.4.4) -- ZAP for Teams**

  Check if Teams ZAP is available via `Get-AtpPolicyForO365` or newer cmdlet.
  License-gated: emit Review if not available.

### Task 7: EXO Extension (1 check)

**Files:**
- Modify: `Exchange-Online/Get-ExoSecurityConfig.ps1`

- [ ] **Step 1: Implement EXO-DIRECTSEND-001 (CIS 6.5.5) -- Direct Send rejected**

  New section using `Get-InboundConnector`:
  - Check no inbound connector allows unauthenticated relay
  - If cmdlet not available, emit Review

- [ ] **Step 2: Update registry.json for all 9 PR 3 entries + supersededBy**

- [ ] **Step 3: Validate -- parse all modified files, lint, JSON, Pester**

- [ ] **Step 4: Commit PR 3**

  ```bash
  git add Exchange-Online/Get-DnsSecurityConfig.ps1 Security/Get-DefenderSecurityConfig.ps1 \
    Exchange-Online/Get-ExoSecurityConfig.ps1 Invoke-M365Assessment.ps1 M365-Assess.psd1 \
    Common/Show-CheckProgress.ps1 controls/registry.json
  git commit -m "feat: add DNS security collector + 6 Defender/EXO email checks"
  ```

---

## Chunk 4: PR 4 (Org Settings + Intune + SPO + Teams)

### Task 8: Entra Org Settings (5 automated + 3 Review)

**Files:**
- Modify: `Entra/Get-EntraSecurityConfig.ps1`
- Modify: `controls/registry.json`

- [ ] **Step 1: Implement ENTRA-CLOUDADMIN-001 (CIS 1.1.1) -- Cloud-only admins**

  Query admin role members and check `onPremisesSyncEnabled`:
  ```powershell
  $gaMembers = Invoke-MgGraphRequest -Uri '/v1.0/directoryRoles/roleTemplateId=62e90394-69f5-4237-9190-012177145e10/members?$select=displayName,onPremisesSyncEnabled'
  ```
  Pass if all admin accounts have `onPremisesSyncEnabled -ne $true`.

- [ ] **Step 2: Implement ENTRA-CLOUDADMIN-002 (CIS 1.1.4) -- Admin license footprint**

  Query admin users' assigned licenses. Check they don't have full E3/E5 productivity suites.
  This is subjective -- Flag as Warning if admins have E3/E5 with all service plans enabled.

- [ ] **Step 3: Implement ENTRA-GROUP-002 (CIS 1.2.1) -- Public groups managed**

  Query groups with `visibility eq 'Public'`. Check all have assigned owners.
  Note: This CheckId is used for both 1.2.1 and 5.1.3.1 in the spec -- verify these are distinct checks that need different IDs if both are needed. If 5.1.3.1 (dynamic guest group) also needs ENTRA-GROUP-002, use ENTRA-GROUP-003 for the public groups check.

- [ ] **Step 4: Implement ENTRA-ORGSETTING-001 (CIS 1.3.4) -- User owned apps restricted**

  Query `/beta/settings` for directory settings. Check user app consent is restricted.

- [ ] **Step 5: Implement ENTRA-PASSWORD-005 (CIS 5.2.3.3) -- Password protection on-prem**

  Check `enableBannedPasswordCheckOnPremises` from existing password protection settings.

- [ ] **Step 6: Implement 3 Review-only checks**

  ENTRA-ORGSETTING-002 (1.3.5), ENTRA-ORGSETTING-003 (1.3.7), ENTRA-ORGSETTING-004 (1.3.9):

  ```powershell
  Add-Setting -Category 'Organization Settings' -Setting 'Forms Internal Phishing Protection' `
      -CurrentValue 'Cannot be checked via API -- verify in M365 admin center > Settings > Org settings > Microsoft Forms' `
      -RecommendedValue 'Enabled' -Status 'Review' -CheckId 'ENTRA-ORGSETTING-002' `
      -Remediation 'M365 admin center > Settings > Org settings > Microsoft Forms > ensure internal phishing protection is enabled.'
  ```

  Same pattern for the other 2 Review checks with appropriate admin portal paths.

### Task 9: EXO Shared Mailbox Check

**Files:**
- Modify: `Exchange-Online/Get-ExoSecurityConfig.ps1`

- [ ] **Step 1: Implement EXO-SHAREDMBX-001 (CIS 1.2.2) -- Shared mailbox sign-in blocked**

  ```powershell
  $sharedMailboxes = Get-Mailbox -RecipientTypeDetails SharedMailbox -ResultSize 100 -ErrorAction Stop
  ```
  For each, check the corresponding Entra user account has `accountEnabled -eq $false`:
  ```powershell
  $mgUser = Invoke-MgGraphRequest -Uri "/v1.0/users/$($mbx.UserPrincipalName)?\$select=accountEnabled"
  ```
  Pass if all shared mailbox accounts are disabled.

### Task 10: Create Intune Security Config Collector

**Files:**
- Create: `Intune/Get-IntuneSecurityConfig.ps1`
- Modify: `Invoke-M365Assessment.ps1` (Intune section of collectorMap)
- Modify: `M365-Assess.psd1` (FileList)
- Modify: `Common/Show-CheckProgress.ps1` (3 maps + CollectorOrder)

- [ ] **Step 1: Create `Intune/Get-IntuneSecurityConfig.ps1` scaffold**

  Same collector pattern. `.NOTES Version: 0.8.0`.

- [ ] **Step 2: Implement INTUNE-COMPLIANCE-001 (CIS 4.1)**

  ```powershell
  $complianceSettings = Invoke-MgGraphRequest -Uri '/beta/deviceManagement/settings' -ErrorAction Stop
  ```
  Check `deviceComplianceCheckinThresholdDays` or that the default compliance policy marks non-compliant.

- [ ] **Step 3: Implement INTUNE-ENROLL-001 (CIS 4.2)**

  ```powershell
  $enrollConfigs = Invoke-MgGraphRequest -Uri '/beta/deviceManagement/deviceEnrollmentConfigurations' -ErrorAction Stop
  ```
  Check platform restriction configurations block personal device enrollment by default.

- [ ] **Step 4: Wire into orchestrator, Show-CheckProgress, M365-Assess.psd1**

  CollectorMap entry:
  ```powershell
  @{ Name = '14b-Intune-Security-Config'; Script = 'Intune\Get-IntuneSecurityConfig.ps1'; Label = 'Intune Security Config'; RequiredServices = @('Graph') }
  ```

### Task 11: SharePoint + Teams Extensions

**Files:**
- Modify: `Collaboration/Get-SharePointSecurityConfig.ps1`
- Modify: `Collaboration/Get-TeamsSecurityConfig.ps1`
- Modify: `controls/registry.json`

- [ ] **Step 1: Implement SPO-B2B-001 (CIS 7.2.2) -- B2B integration**

  From existing `$spoSettings`:
  - Check `EnableAzureADB2BIntegration -eq $true` (or equivalent Graph property)

- [ ] **Step 2: Implement SPO-OD-001 (CIS 7.2.4) -- OneDrive sharing restricted**

  From existing `$spoSettings`:
  - Check `OneDriveSharingCapability` is restricted (not `ExternalUserAndGuestSharing`)

- [ ] **Step 3: Implement SPO-MALWARE-002 (CIS 7.3.1) -- Infected file download blocked**

  From existing `$spoSettings`:
  - Check `DisallowInfectedFileDownload -eq $true`

- [ ] **Step 4: Implement TEAMS-APPS-001 (CIS 8.4.1) + TEAMS-REPORTING-001 (CIS 8.6.1)**

  Both emit Review status with admin portal navigation instructions:
  - TEAMS-APPS-001: "Verify in Teams admin center > Teams apps > Permission policies"
  - TEAMS-REPORTING-001: "Verify in Teams admin center > Messaging policies > Report a security concern"

- [ ] **Step 5: Update registry.json for all 16 PR 4 entries + supersededBy**

- [ ] **Step 6: Update README.md with final automated count**

  After all checks are added, run the count script:
  ```powershell
  $reg = Get-Content 'controls/registry.json' -Raw | ConvertFrom-Json
  $automated = ($reg.checks | Where-Object { $_.hasAutomatedCheck -eq $true }).Count
  ```
  Update README with final numbers.

- [ ] **Step 7: Validate -- parse all modified/new files, lint, JSON, Pester**

- [ ] **Step 8: Commit PR 4**

  ```bash
  git add Entra/Get-EntraSecurityConfig.ps1 Exchange-Online/Get-ExoSecurityConfig.ps1 \
    Intune/Get-IntuneSecurityConfig.ps1 Collaboration/Get-SharePointSecurityConfig.ps1 \
    Collaboration/Get-TeamsSecurityConfig.ps1 Invoke-M365Assessment.ps1 M365-Assess.psd1 \
    Common/Show-CheckProgress.ps1 controls/registry.json README.md
  git commit -m "feat: add org settings, Intune, SPO, Teams checks (16 CIS controls)"
  ```

---

## Post-Implementation

### Task 12: Final Validation

- [ ] **Step 1: Run full Pester suite**

  ```bash
  pwsh -NoProfile -Command "Invoke-Pester tests/ -Output Detailed"
  ```

- [ ] **Step 2: Run PSScriptAnalyzer on all modified files**

  ```powershell
  $files = @(
      'Entra/Get-CASecurityConfig.ps1',
      'Exchange-Online/Get-DnsSecurityConfig.ps1',
      'Intune/Get-IntuneSecurityConfig.ps1',
      'Entra/Get-EntraSecurityConfig.ps1',
      'Exchange-Online/Get-ExoSecurityConfig.ps1',
      'Security/Get-DefenderSecurityConfig.ps1',
      'Collaboration/Get-SharePointSecurityConfig.ps1',
      'Collaboration/Get-TeamsSecurityConfig.ps1'
  )
  $files | ForEach-Object { Invoke-ScriptAnalyzer -Path $_ -Severity Warning,Error }
  ```

- [ ] **Step 3: Verify registry counts**

  ```powershell
  $reg = Get-Content 'controls/registry.json' -Raw | ConvertFrom-Json
  $total = $reg.checks.Count
  $automated = ($reg.checks | Where-Object { $_.hasAutomatedCheck -eq $true }).Count
  $superseded = ($reg.checks | Where-Object { $_.supersededBy }).Count
  Write-Output "Registry: $total entries, $automated automated, $superseded superseded"
  ```

  Expected: ~227 entries, ~133 automated, ~76 superseded.

- [ ] **Step 4: Live tenant test against dzmlab.onmicrosoft.com**

  Run: `.\Invoke-M365Assessment.ps1 -Section Identity,Email,Security,Collaboration,Intune`

  Verify:
  - New collectors appear in console streaming (CA Policy Evaluation, DNS Security Config, Intune Security Config)
  - Check counts match expected totals
  - No unexpected errors in assessment log
  - HTML report donut charts include new collectors
  - CIS compliance matrix shows new checks with framework mappings

- [ ] **Step 5: Push and create PR**

  ```bash
  git push -u origin feature/v080-cis-gap-closure
  gh pr create --title "feat: v0.8.0 CIS gap closure -- 51 new checks, 84% coverage"
  ```
