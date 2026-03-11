# Collector Output Standardization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize all collector output to match EXO's clear pass/fail + PowerShell command remediation pattern, introduce Info status, and assign CheckIds to all unmapped checks.

**Architecture:** Each collector is a standalone .ps1 script with an internal `Add-Setting` helper. Changes are per-collector: severity upgrades + remediation rewrites. The Info status requires CSS/badge additions in the report generator and XLSX formatter. New CheckIds require registry.json entries.

**Tech Stack:** PowerShell 7.x, ImportExcel module, Pester 5.x for testing

**Spec:** `docs/superpowers/specs/2026-03-11-collector-output-standardization-design.md`

---

## Chunk 1: Infrastructure (Info Status + Registry Entries)

### Task 1: Add Info status support to Export-AssessmentReport.ps1

**Files:**
- Modify: `Common/Export-AssessmentReport.ps1`

- [ ] **Step 1: Add Info CSS variables (light theme)**

In the `:root` CSS block (~line 1878-1900), add after the existing `--m365a-info-bg` line:

```css
--m365a-neutral: #6b7280;
--m365a-neutral-bg: #f3f4f6;
```

- [ ] **Step 2: Add Info CSS variables (dark theme)**

In the `body.dark-theme` CSS block (~line 1902-1924), add:

```css
--m365a-neutral: #9ca3af;
--m365a-neutral-bg: #374151;
```

- [ ] **Step 3: Add Info badge CSS class**

After the existing `.badge-info` class (~line 2970), add:

```css
.badge-neutral { background-color: var(--m365a-neutral-bg); color: var(--m365a-neutral); }
```

- [ ] **Step 4: Add Info row CSS class**

After `.cis-row-unknown` (~line 3130), add:

```css
.cis-row-info { border-left: 3px solid var(--m365a-neutral); background-color: var(--m365a-neutral-bg); }
```

- [ ] **Step 5: Add Info dot legend CSS**

After existing `.chart-legend-dot.dot-info` (~line 2365), add using the same compound selector pattern:

```css
.chart-legend-dot.dot-neutral { background-color: var(--m365a-neutral); }
```

- [ ] **Step 5b: Add dark-theme badge override**

After existing dark-theme `.badge-warning` override (~line 3211), add:

```css
body.dark-theme .badge-neutral { background-color: var(--m365a-neutral-bg); color: var(--m365a-neutral); }
```

- [ ] **Step 6: Update BOTH status-to-badge switch blocks**

There are two separate switch blocks that map Status to badge CSS classes:

1. **Security config table builder** (~line 1503): `switch ($val)` — add:
```powershell
'Info' { 'badge-neutral' }
```

2. **Compliance matrix builder** (~line 1762): `switch ($finding.Status)` — add:
```powershell
'Info' { 'badge-neutral' }
```

Both must be updated or Info checks will render without badge styling in that context.

- [ ] **Step 7: Update donut chart scoring — exclude Info from totals**

At each collector's count block (Entra ~702, EXO ~799, Defender ~1260, SharePoint, Teams), change the total to exclude Info:

```powershell
$entraInfo   = @($entraData | Where-Object { $_.Status -eq 'Info' }).Count
$entraTotal  = $entraData.Count - $entraInfo
```

Add an Info legend row after Review in the score detail block:

```powershell
if ($entraInfo -gt 0) {
    $null = $sectionHtml.AppendLine("<div class='score-detail-row'><span class='score-detail-label'><span class='chart-legend-dot dot-neutral'></span> Info</span><span class='score-detail-value' style='color: var(--m365a-neutral);'>$entraInfo</span></div>")
}
```

Repeat for all 5 collectors using their variable prefixes:
- Entra: `$entraInfo`, `$entraTotal` (~line 702)
- EXO: `$exoInfo`, `$exoTotal` (~line 799)
- Defender: `$defInfo`, `$defTotal` (~line 1260)
- SharePoint: `$spoSecInfo`, `$spoSecTotal` (search for `$spoSecData`)
- Teams: `$teamSecInfo`, `$teamSecTotal` (search for `$teamSecData`)

- [ ] **Step 8: Update CIS compliance scoring — exclude Info**

At lines ~1646-1651, add `'Info'` to `$knownStatuses` and add Info count:

```powershell
$cisInfo = @($allCisFindings | Where-Object { $_.Status -eq 'Info' }).Count
$knownStatuses = @('Pass', 'Fail', 'Warning', 'Review', 'Info')
```

Subtract Info from the total used for percentage calculation.

- [ ] **Step 9: Update row CSS class assignment**

There are two locations that assign row CSS classes:

1. **Security config table** (~line 1475): explicit switch with cases for Fail, Warning, Review, Unknown. Add:
```powershell
'Info' { " class='cis-row-info'" }
```

2. **Compliance matrix** (~line 1773): uses `cis-row-$($finding.Status.ToLower())` which auto-generates the class name — this works automatically since `.cis-row-info` CSS was added in Step 4. No code change needed here.

- [ ] **Step 9b: Add Info filter to JavaScript status filter**

At ~line 3639, the JavaScript filter logic has an array of status filter buttons. Add an "Info" filter toggle and include `'info'` in the filter status array so users can show/hide Info rows in the compliance matrix.

- [ ] **Step 10: Commit**

```bash
git add Common/Export-AssessmentReport.ps1
git commit -m "feat: add Info status support to HTML report"
```

---

### Task 2: Add Info status support to Export-ComplianceMatrix.ps1

**Files:**
- Modify: `Common/Export-ComplianceMatrix.ps1`

- [ ] **Step 1: Add Info conditional formatting**

In the `switch ($val)` block (~line 258), add after the Review case:

```powershell
'Info' { $matrixSheet.Cells[$r, $statusCol].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(107, 114, 128)); $matrixSheet.Cells[$r, $statusCol].Style.Fill.PatternType = 'Solid'; $matrixSheet.Cells[$r, $statusCol].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(243, 244, 246)) }
```

- [ ] **Step 2: Exclude Info from pass rate calculation**

In the summary loop (~line 181), change the mapped filter to exclude Info:

```powershell
$mapped = @($sortedFindings | Where-Object { $_.$colProp -and $_.$colProp -ne '' -and $_.Status -ne 'Info' })
```

- [ ] **Step 3: Commit**

```bash
git add Common/Export-ComplianceMatrix.ps1
git commit -m "feat: add Info status support to XLSX export"
```

---

### Task 3: Add new CheckId entries to registry.json

**Files:**
- Modify: `controls/registry.json`

- [ ] **Step 1: Add 12 new registry entries**

Add entries for each new CheckId. Each entry needs: `checkId`, `title`, `description`, `automated`, `collector` (for automated checks), and `frameworks` object with appropriate mappings.

New entries:
1. `ENTRA-SECDEFAULT-001` — Security Defaults Enabled
2. `ENTRA-APPREG-001` — Users Can Register Applications
3. `ENTRA-PASSWORD-003` — Smart Lockout Threshold
4. `ENTRA-PASSWORD-004` — Custom Banned Password Count
5. `ENTRA-CA-002` — Total CA Policies (Info)
6. `ENTRA-CA-003` — Enabled CA Policies
7. `ENTRA-GUEST-003` — Guest User Count (Info)
8. `SPO-SYNC-002` — Mac Sync App Enabled (Info)
9. `SPO-LOOP-001` — Loop Components Enabled (Info)
10. `SPO-LOOP-002` — OneDrive Loop Sharing (Info)
11. `TEAMS-APPS-001` — Chat Resource-Specific Consent
12. `TEAMS-INFO-001` — Teams Workload Active (Info)

For Info-status entries, set `"automated": true` and use the appropriate collector name. Framework mappings should reference the relevant NIST/ISO/CIS controls where applicable. Info checks may have fewer framework mappings since they are informational.

- [ ] **Step 2: Split ENTRA-PASSWORD-002**

Find the existing `ENTRA-PASSWORD-002` entry. It currently covers both "Custom Banned Password List Enforced" and "Custom Banned Password Count". Keep PASSWORD-002 for the enforcement toggle. The new PASSWORD-004 entry (step 1) covers the count check.

Update the PASSWORD-002 `title` and `description` to clarify it covers enforcement only (e.g., title: "Custom Banned Password List Enforced").

**IMPORTANT**: This task (registry entries) MUST complete before Task 4 (Entra collector), since the collector will reference these new CheckIds. In Task 4 Step 1, change the CheckId on the banned password count check from `ENTRA-PASSWORD-002` to `ENTRA-PASSWORD-004`.

- [ ] **Step 3: Run registry integrity tests**

Run: `pwsh -NoProfile -Command "Invoke-Pester -Path './tests/controls/registry-integrity.Tests.ps1' -Output Detailed"`

Expected: All tests pass. If the "at least 139 entries" test needs updating (now 151), update the threshold.

- [ ] **Step 4: Commit**

```bash
git add controls/registry.json tests/controls/registry-integrity.Tests.ps1
git commit -m "feat: add 12 new CheckId entries to control registry"
```

---

## Chunk 2: Entra Collector Standardization

### Task 4: Update Entra collector — CheckIds + severity

**Files:**
- Modify: `Entra/Get-EntraSecurityConfig.ps1`

- [ ] **Step 1: Add CheckIds to unmapped checks**

Add `-CheckId` parameter to each currently unmapped `Add-Setting` call:

| Setting | Add CheckId |
|---------|-------------|
| Security Defaults Enabled (~line 86) | `ENTRA-SECDEFAULT-001` |
| Security Defaults (error path, ~line 93) | `ENTRA-SECDEFAULT-001` |
| Users Can Register Applications (~line 169) | `ENTRA-APPREG-001` |
| Smart Lockout Threshold (~line 272) | `ENTRA-PASSWORD-003` |
| Custom Banned Password Count (~line 266) | `ENTRA-PASSWORD-004` (was PASSWORD-002) |
| Total CA Policies (~line 364) | `ENTRA-CA-002` |
| Enabled CA Policies (~line 369) | `ENTRA-CA-003` |
| Guest User Count (~line 403) | `ENTRA-GUEST-003` |

- [ ] **Step 2: Apply severity changes**

Update these Status values per the spec:

| Line | Setting | Change |
|------|---------|--------|
| ~88 | Security Defaults | `'Review'` → `'Fail'` |
| ~157 | User Consent | `Warning` logic → `Fail` |
| ~171 | App Registration | `'Warning'` → `'Fail'` |
| ~183 | Security Groups | `'Review'` → `'Warning'` |
| ~235 | Registration Campaign | `'Review'` → `'Warning'` |
| ~268 | Banned Password Count | `'Review'` → `'Warning'` |
| ~296 | Password Expiration | `'Review'` → `'Fail'` |
| ~345 | Guest Access Restriction | `'Review'` → `'Warning'` |

- [ ] **Step 3: Apply Info status**

| Line | Setting | Change |
|------|---------|--------|
| ~364 | Total CA Policies | Status → `'Info'` |
| ~403 | Guest User Count | Status → `'Info'` |

- [ ] **Step 4: Parse check**

Run: `pwsh -NoProfile -Command "$null = [System.Management.Automation.Language.Parser]::ParseFile('C:\git\M365-Assess\Entra\Get-EntraSecurityConfig.ps1', [ref]$null, [ref]$e); if ($e.Count -eq 0) { 'Parse OK' } else { $e | ForEach-Object { $_.Message } }"`

Expected: Parse OK

- [ ] **Step 5: Commit**

```bash
git add Entra/Get-EntraSecurityConfig.ps1
git commit -m "feat(entra): add CheckIds and update severity levels"
```

---

### Task 5: Update Entra collector — remediation commands

**Files:**
- Modify: `Entra/Get-EntraSecurityConfig.ps1`

- [ ] **Step 1: Rewrite all 19 remediation strings**

Apply the "command first, UI second" format to every `Add-Setting` call. Use Microsoft Graph PowerShell SDK cmdlets. **Note**: Some `Update-MgPolicy*` cmdlets require the `Microsoft.Graph.Beta.*` module — verify each cmdlet exists in GA or use Beta variants where GA is not available. The rewrite rule: every remediation that starts with a UI path must be rewritten to command-first format.

All 19 checks by Add-Setting call order:

| # | Setting | PowerShell Command |
|---|---------|-------------------|
| 1 | Security Defaults Enabled | `Run: Update-MgPolicyIdentitySecurityDefaultsEnforcementPolicy -IsEnabled $true.` |
| 2 | Security Defaults (error) | No remediation (error state) |
| 3 | Global Admin Count | `Run: Get-MgDirectoryRole -Filter "displayName eq 'Global Administrator'" \| Get-MgDirectoryRoleMember. Maintain 2-4 global admins.` |
| 4 | User Consent | `Run: Update-MgPolicyAuthorizationPolicy -DefaultUserRolePermissions @{PermissionGrantPoliciesAssigned = @()}.` |
| 5 | App Registration | `Run: Update-MgPolicyAuthorizationPolicy -DefaultUserRolePermissions @{AllowedToCreateApps = $false}.` |
| 6 | Security Groups | `Run: Update-MgPolicyAuthorizationPolicy -DefaultUserRolePermissions @{AllowedToCreateSecurityGroups = $false}.` |
| 7 | Tenant Creation | `Run: Update-MgPolicyAuthorizationPolicy -DefaultUserRolePermissions @{AllowedToCreateTenants = $false}.` |
| 8 | Admin Consent Workflow | `Run: Update-MgPolicyAdminConsentRequestPolicy -IsEnabled $true.` |
| 9 | Registration Campaign | `Run: Update-MgBetaPolicyAuthenticationMethodPolicy (registration campaign settings require Beta module).` |
| 10 | Custom Banned Passwords Enforced | `Run: Update-MgBetaDirectorySettingPasswordRule (Password Protection settings require Beta module).` |
| 11 | Custom Banned Password Count | `Run: Update-MgBetaDirectorySettingPasswordRule -BannedPasswordList @('term1','term2').` |
| 12 | Smart Lockout Threshold | `Run: Update-MgBetaDirectorySettingPasswordRule -LockoutThreshold 10.` |
| 13 | Password Expiration | `Run: Update-MgDomain -DomainId {domain} -PasswordValidityPeriodInDays 2147483647.` |
| 14 | Guest Invitation Policy | `Run: Update-MgPolicyAuthorizationPolicy -AllowInvitesFrom 'adminsAndGuestInviters'.` |
| 15 | Guest User Access Restriction | `Run: Update-MgPolicyAuthorizationPolicy -GuestUserRoleId '2af84b1e-32c8-42b7-82bc-daa82404023b'.` |
| 16 | Total CA Policies | Informational — `Review Conditional Access policy coverage.` |
| 17 | Enabled CA Policies | `Run: Get-MgIdentityConditionalAccessPolicy \| Where-Object State -eq 'enabled'. Ensure policies are On, not Report-only.` |
| 18 | Legacy Auth Block | `Run: New-MgIdentityConditionalAccessPolicy with conditions targeting legacy client apps and grant control Block.` |
| 19 | Guest User Count | Informational — `Review and remove stale guest accounts periodically.` |

Each remediation follows the format: `"Run: <command>. <UI path>."`
Info checks use: `"Informational — <descriptive context>."`

- [ ] **Step 2: Parse check**

Run: same parse command as Task 4 Step 4.

Expected: Parse OK

- [ ] **Step 3: Commit**

```bash
git add Entra/Get-EntraSecurityConfig.ps1
git commit -m "feat(entra): standardize remediation to command-first format"
```

---

## Chunk 3: Defender Collector Standardization

### Task 6: Update Defender collector — severity changes

**Files:**
- Modify: `Security/Get-DefenderSecurityConfig.ps1`

- [ ] **Step 1: Apply 15 severity changes**

Per the spec's Defender severity table:

| Setting | Change |
|---------|--------|
| Phishing Threshold | `'Warning'` → `'Fail'` |
| Targeted User Protection | `'Review'` → `'Warning'` |
| Targeted Domain Protection | `'Review'` → `'Warning'` |
| Honor DMARC Policy | `'Warning'` → `'Fail'` |
| First Contact Safety Tips | `'Review'` → `'Warning'` |
| Spam Action | `'Review'` → `'Warning'` |
| Spam ZAP | `'Warning'` → `'Fail'` |
| Common Attachment Filter | `'Warning'` → `'Fail'` |
| Internal Sender Admin Notifications | `'Review'` → `'Warning'` |
| Track User Clicks | `'Review'` → `'Warning'` |
| Enable for Internal Senders | `'Review'` → `'Warning'` |
| Wait for URL Scan | `'Review'` → `'Warning'` |
| Redirect to Admin | `'Review'` → `'Warning'` |
| BCC on Suspicious Outbound | `'Review'` → `'Warning'` |
| Notify Admins of Outbound Spam | `'Review'` → `'Warning'` |

- [ ] **Step 2: Parse check**

Expected: Parse OK

- [ ] **Step 3: Commit**

```bash
git add Security/Get-DefenderSecurityConfig.ps1
git commit -m "feat(defender): update severity levels per standardization spec"
```

---

### Task 7: Update Defender collector — remediation commands

**Files:**
- Modify: `Security/Get-DefenderSecurityConfig.ps1`

- [ ] **Step 1: Rewrite all 31 remediation strings**

Use EXO management cmdlets in command-first format. No hardcoded `-Identity`. All 31 checks grouped by policy type:

**Anti-Phishing (7 checks) — `Set-AntiPhishPolicy`:**
1. Phishing Threshold: `-PhishThresholdLevel 2`
2. Mailbox Intelligence Protection: `-EnableMailboxIntelligenceProtection $true`
3. Targeted User Protection: `-EnableTargetedUserProtection $true`
4. Targeted Domain Protection: `-EnableTargetedDomainsProtection $true`
5. Honor DMARC Policy: `-HonorDmarcPolicy $true`
6. Spoof Intelligence: `-EnableSpoofIntelligence $true`
7. First Contact Safety Tips: `-EnableFirstContactSafetyTips $true`

**Anti-Spam (8 checks) — `Set-HostedContentFilterPolicy`:**
8. Bulk Complaint Level: `-BulkThreshold 6`
9. Spam Action: `-SpamAction MoveToJmf` or `Quarantine`
10. High Confidence Spam Action: `-HighConfidenceSpamAction Quarantine`
11. High Confidence Phish Action: `-HighConfidencePhishAction Quarantine`
12. Phishing Action: `-PhishSpamAction Quarantine`
13. Zero-Hour Auto Purge: `-ZapEnabled $true`
14. Spam ZAP: `-SpamZapEnabled $true`
15. Phishing ZAP: `-PhishZapEnabled $true`

**Anti-Malware (3 checks) — `Set-MalwareFilterPolicy`:**
16. Common Attachment Filter: `-EnableFileFilter $true`
17. Malware ZAP: `-ZapEnabled $true`
18. Internal Sender Admin Notifications: `-EnableInternalSenderAdminNotifications $true`

**Safe Links (6 checks) — `Set-SafeLinksPolicy` / `New-SafeLinksPolicy`:**
19. No policy configured: `New-SafeLinksPolicy -Name "Safe Links" -IsEnabled $true`
20. Real-time URL Scanning: `-ScanUrls $true`
21. Track User Clicks: `-DoNotTrackUserClicks $false`
22. Enable for Internal Senders: `-EnableForInternalSenders $true`
23. Wait for URL Scan: `-DeliverMessageAfterScan $true`
24. Not licensed: No command — licensing note only

**Safe Attachments (4 checks) — `Set-SafeAttachmentPolicy` / `New-SafeAttachmentPolicy`:**
25. No policy configured: `New-SafeAttachmentPolicy -Name "Safe Attachments" -Enable $true -Action Block`
26. Policy Enabled: `-Enable $true`
27. Action: `-Action Block` or `DynamicDelivery`
28. Redirect to Admin: `-Redirect $true -RedirectAddress admin@domain.com`

**Outbound Spam (3 checks) — `Set-HostedOutboundSpamFilterPolicy`:**
29. Auto-Forwarding Mode: `-AutoForwardingMode Off`
30. BCC on Suspicious Outbound: `-BccSuspiciousOutboundMail $true -BccSuspiciousOutboundAdditionalRecipients admin@domain.com`
31. Notify Admins: `-NotifyOutboundSpam $true -NotifyOutboundSpamRecipients admin@domain.com`

Example format:
```
"Run: Set-AntiPhishPolicy -PhishThresholdLevel 2. Security admin center > Anti-phishing > Edit policy."
```

- [ ] **Step 2: Parse check**

Expected: Parse OK

- [ ] **Step 3: Commit**

```bash
git add Security/Get-DefenderSecurityConfig.ps1
git commit -m "feat(defender): standardize remediation to command-first format"
```

---

## Chunk 4: SharePoint + Teams Collector Standardization

### Task 8: Update SharePoint collector

**Files:**
- Modify: `Collaboration/Get-SharePointSecurityConfig.ps1`

- [ ] **Step 1: Add CheckIds to unmapped checks**

| Setting | Add CheckId |
|---------|-------------|
| Mac Sync App Enabled | `SPO-SYNC-002` |
| Loop Components Enabled | `SPO-LOOP-001` |
| OneDrive Loop Sharing | `SPO-LOOP-002` |

- [ ] **Step 2: Apply severity change**

| Setting | Change |
|---------|--------|
| Idle Session Timeout (SPO-SESSION-001) | `'Review'` → `'Warning'` |

- [ ] **Step 3: Apply Info status**

| Setting | Change |
|---------|--------|
| Mac Sync App Enabled (SPO-SYNC-002) | Status → `'Info'` |
| Loop Components Enabled (SPO-LOOP-001) | Status → `'Info'` |
| OneDrive Loop Sharing (SPO-LOOP-002) | Status → `'Info'` |

- [ ] **Step 4: Add remediation commands to checks missing them**

Fill in PowerShell commands for checks that currently lack them (SPO-SESSION-001, SPO-SHARING-002). SharePoint checks already using `Set-SPOTenant` commands keep them.

Info checks get: `"Informational — review based on organizational requirements."`

- [ ] **Step 5: Parse check**

Expected: Parse OK

- [ ] **Step 6: Commit**

```bash
git add Collaboration/Get-SharePointSecurityConfig.ps1
git commit -m "feat(sharepoint): add CheckIds, update severity, standardize remediation"
```

---

### Task 9: Update Teams collector

**Files:**
- Modify: `Collaboration/Get-TeamsSecurityConfig.ps1`

- [ ] **Step 1: Add CheckIds to unmapped checks**

| Setting | Add CheckId |
|---------|-------------|
| Chat Resource-Specific Consent | `TEAMS-APPS-001` |
| Teams Workload Active | `TEAMS-INFO-001` |

- [ ] **Step 2: Apply severity change**

| Setting | Change |
|---------|--------|
| Anonymous Users Can Join Meeting (TEAMS-MEETING-001) | `'Warning'` → `'Fail'` |

- [ ] **Step 3: Apply Info status**

| Setting | Change |
|---------|--------|
| Teams Workload Active (TEAMS-INFO-001) | Status → `'Info'` |

- [ ] **Step 4: Add remediation commands**

| Setting | Command |
|---------|---------|
| Chat RSC (TEAMS-APPS-001) | `Run: Set-CsTeamsAppPermissionPolicy -DefaultCatalogAppsType AllowedAppList. Teams admin center > Permission policies.` |
| Teams Workload Active (TEAMS-INFO-001) | `Informational — confirms Teams service connectivity.` |

- [ ] **Step 5: Parse check**

Expected: Parse OK

- [ ] **Step 6: Commit**

```bash
git add Collaboration/Get-TeamsSecurityConfig.ps1
git commit -m "feat(teams): add CheckIds, update severity, standardize remediation"
```

---

## Chunk 5: Version Bump + README + Final Validation

### Task 10: Version bump 0.5.0 → 0.6.0

**Files:**
- Modify: `Invoke-M365Assessment.ps1` (2 locations: .NOTES + $script:AssessmentVersion)
- Modify: `Common/Export-AssessmentReport.ps1` (2 locations: .NOTES + $assessmentVersion)
- Modify: `Entra/Get-EntraSecurityConfig.ps1` (.NOTES)
- Modify: `Exchange-Online/Get-ExoSecurityConfig.ps1` (.NOTES)
- Modify: `Security/Get-DefenderSecurityConfig.ps1` (.NOTES)
- Modify: `Collaboration/Get-SharePointSecurityConfig.ps1` (.NOTES)
- Modify: `Collaboration/Get-TeamsSecurityConfig.ps1` (.NOTES)
- Modify: `README.md` (badge URL)
- Modify: `.claude/rules/versions.md` (current version)

- [ ] **Step 1: Update all 10 version locations**

See `.claude/rules/versions.md` for the full list. Change `0.5.0` → `0.6.0` in all locations.

- [ ] **Step 2: Update README**

Add Info status to the status descriptions section. Document the standardized remediation format (PowerShell command-first).

- [ ] **Step 3: Commit**

```bash
git add Invoke-M365Assessment.ps1 Common/Export-AssessmentReport.ps1 Entra/Get-EntraSecurityConfig.ps1 Exchange-Online/Get-ExoSecurityConfig.ps1 Security/Get-DefenderSecurityConfig.ps1 Collaboration/Get-SharePointSecurityConfig.ps1 Collaboration/Get-TeamsSecurityConfig.ps1 README.md
git commit -m "chore: bump version 0.5.0 → 0.6.0"
```

---

### Task 11: Run full test suite + parse checks

**Files:**
- All modified .ps1 files

- [ ] **Step 1: Parse check all 7 scripts**

Run parse check against each collector and both Common scripts. All must return "Parse OK".

- [ ] **Step 2: Run Pester tests**

Run: `pwsh -NoProfile -Command "Invoke-Pester -Path './tests' -Output Detailed"`

Expected: All tests pass (update test thresholds if needed for new registry entries).

- [ ] **Step 3: Smoke test**

Run `Get-Help` and `Get-Command` against each modified collector to confirm parameters are valid.

- [ ] **Step 4: Commit any test fixes**

```bash
git add tests/
git commit -m "test: update thresholds for new registry entries"
```
