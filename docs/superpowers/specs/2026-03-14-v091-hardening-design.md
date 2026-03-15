# v0.9.1 Hardening & Polish -- Design Spec

**Goal:** Fix 13 issues spanning error handling, auth, SOC2 dependency, documentation, and test coverage in a single PR.

**Branch:** `chore/v091-hardening`

---

## Implementation Order

Issues have dependencies that dictate ordering:

1. **#111** (SecureString) -- changes parameter type that #112 references
2. **#112** (EXO/Purview rejection) -- uses the new SecureString param
3. **#114** (null arrays) -- standalone, audit all collectors
4. **#106** (PowerBI 404) -- error handling pattern
5. **#115** (Teams beta) -- error handling pattern
6. **#116** (SharePoint 401) -- error handling pattern
7. **#117** (PIM messaging) -- error handling pattern
8. **#110** (SOC2 SPO) -- standalone guard
9. **#100, #99** (framework count, COMPLIANCE.md) -- doc fixes
10. **#101, #102** (CONTRIBUTING, registry docs) -- doc additions
11. **#113** (PowerBI tests) -- must come after #106 so tests validate new behavior

---

## Section 1: Error Handling & Graceful Degradation

**Issues:** #106, #114, #115, #116, #117

### Pattern

Standardize error handling across collectors with HTTP status parsing:

- **401/403** -- "Access denied" with specific permission or license requirement
- **404** -- "Not available" (endpoint doesn't exist for this tenant/plan)
- **Other** -- generic warning with original exception message

All degraded checks get status `Review` (not `Error`) with actionable `CurrentValue` text. `Review` is the correct status for degradation because it means "could not be automated, needs manual verification." `Error` is reserved for collector-level failures.

### #106 PowerBI 404 Handling

**File:** `PowerBI/Get-PowerBISecurityConfig.ps1`

When `admin/tenantSettings` returns 404, set all checks to `Review` with "Power BI admin API not available -- ensure the calling account has Power BI Service Administrator role." Current behavior silently sets `$allSettings = @()` which produces "Review" on every check with no explanation.

Parse the exception in the catch block to distinguish 404 from other errors. Provide distinct messages:
- **404**: "Admin API not available -- requires Power BI Service Administrator role"
- **403**: "Access denied -- insufficient permissions for tenant settings"
- **Other**: original exception message

### #114 Null Array Errors

**Files:** All collectors that call `Invoke-MgGraphRequest` and access `$response['value']`

Wrap array access with null guards:
```powershell
$items = if ($result -and $result['value']) { @($result['value']) } else { @() }
```

Collectors requiring audit (confirmed unsafe `['value']` access):
- `Entra/Get-EntraSecurityConfig.ps1` -- `$globalAdminRole['value']` (~line 127), `$passwordProtection['value']` (~line 354), `$domains['value']` (~line 393), `$caPolicies['value']` (~line 467), `$dynamicGroups['value']` (~line 656), `$pimRoleAssignments['value']` (~line 807)
- `Entra/Get-CASecurityConfig.ps1` -- at least 1 unguarded access
- `Intune/Get-IntuneSecurityConfig.ps1` -- at least 1 unguarded access
- `SOC2/Get-SOC2SecurityControls.ps1` -- approximately 10 unguarded accesses
- `SOC2/Get-SOC2AuditEvidence.ps1` -- approximately 4 unguarded accesses

Implementation should grep all `.ps1` files for `\['value'\]` to ensure complete coverage.

### #115 Teams Beta Endpoints

**File:** `Collaboration/Get-TeamsSecurityConfig.ps1`

Replace `-ErrorAction SilentlyContinue` on all three endpoint calls with explicit try/catch blocks:
- `/beta/teamwork/teamsClientConfiguration` (~line 145)
- `/beta/teamwork/teamsMeetingPolicy` (~line 221)
- `/v1.0/teamwork` (~line 314)

Log which endpoint failed and why. Set affected checks to "Review" with a message indicating the endpoint was unavailable and the specific error.

### #116 SharePoint 401

**File:** `Collaboration/Get-SharePointSecurityConfig.ps1`

Parse the exception from `/v1.0/admin/sharepoint/settings` to detect 401/403 and provide specific remediation: "Missing SharePointTenantSettings.Read.All permission. Add this scope when connecting to Graph."

### #117 PIM Without Configuration

**File:** `Entra/Get-EntraSecurityConfig.ps1`

The current catch block assumes 403 means "no P2 license." E5 tenants that haven't configured PIM also get 403. Update the messaging to distinguish:
- If tenant has E5/P2 SKU but PIM API returns 403: "PIM is available but not configured in this tenant"
- If no P2/E5 SKU detected: "Requires Entra ID P2 license (included in M365 E5)"

Both cases degrade to `Review` status.

**SKU detection:** Check `Get-MgSubscribedSku` for these known SKU IDs:
- `AAD_PREMIUM_P2`: `eec0eb4f-6444-4f95-aba0-50c24d67f998`
- `SPE_E5` (M365 E5): `06ebc4ee-1bb5-47dd-8120-11324bc54e06`
- `EMSPREMIUM` (EMS E5): `b05e124f-c7cc-45a0-a6aa-8cf78c946968`
- `SPE_E5_NOPSTNCONF`: `cd2925a3-5076-4233-8931-638a8c94f773`

If any of these SKUs are present with `capabilityStatus -eq 'Enabled'`, the tenant has P2 capability.

---

## Section 2: Auth Fixes

**Issues:** #111, #112

### #111 SecureString for ClientSecret

**Files:** `Invoke-M365Assessment.ps1`, `Common/Connect-Service.ps1`, `AUTHENTICATION.md`

Change `$ClientSecret` parameter type from `[string]` to `[SecureString]` on both the orchestrator and Connect-Service.

**Internal code changes required:**
- **Graph case** (~line 156-160 of Connect-Service.ps1): Currently calls `ConvertTo-SecureString -String $ClientSecret -AsPlainText -Force`. Change to use `$ClientSecret` directly since it's already a SecureString. The PSCredential constructor accepts SecureString natively.
- **PowerBI case** (~line 250-255): Same pattern -- remove the ConvertTo-SecureString call, use `$ClientSecret` directly in the PSCredential constructor.
- **Orchestrator passthrough**: No conversion needed; just pass the SecureString through to Connect-Service.

**Breaking change:** Callers previously passing `-ClientSecret 'plaintext'` must now use:
```powershell
-ClientSecret (ConvertTo-SecureString 'secret' -AsPlainText -Force)
# or interactively:
-ClientSecret (Read-Host -AsSecureString -Prompt 'Client Secret')
```

Document this change in AUTHENTICATION.md and CHANGELOG.md.

**Note:** Only Graph and PowerBI legitimately support client secret auth. EXO and Purview do not (see #112).

### #112 EXO and Purview ClientSecret -- Explicit Rejection

**File:** `Common/Connect-Service.ps1`

Neither Exchange Online Management (`Connect-ExchangeOnline`) nor Purview (`Connect-IPPSSession`) support client secret authentication. Both currently silently ignore `$ClientSecret` and fall through to interactive auth.

Add explicit `elseif` branches to both the ExchangeOnline and Purview switch cases:

```powershell
elseif ($ClientId -and $ClientSecret) {
    throw "Exchange Online does not support client secret authentication. Use -CertificateThumbprint for app-only auth."
}
```

```powershell
elseif ($ClientId -and $ClientSecret) {
    throw "Purview does not support client secret authentication. Use -CertificateThumbprint for app-only auth."
}
```

Place these branches after the CertificateThumbprint check and before UseDeviceCode/UPN fallbacks.

---

## Section 3: SOC2 SPO Dependency

**Issue:** #110

**File:** `SOC2/Get-SOC2ConfidentialityControls.ps1`

The script already has a `Get-Command -Name Get-SPOTenant -ErrorAction Stop` check (~line 78) and a try/catch around the `Get-SPOTenant` call (~line 114). However, the error messages are generic and don't distinguish between module-not-installed vs. not-connected scenarios.

**Work needed:**
1. Improve the existing error handling to provide specific messages:
   - Module missing (Get-Command fails): "Requires Microsoft.Online.SharePoint.PowerShell module"
   - Not connected (Get-SPOTenant throws): "SharePoint Online connection required -- run Connect-SPOService first"
2. Ensure all SPO-dependent checks in the script get `Review` status with the appropriate message when SPO is unavailable
3. Let remaining non-SPO confidentiality checks run normally

---

## Section 4: Documentation & Tests

**Issues:** #99, #100, #101, #102, #113

### #100 Framework Count

**File:** `Common/Export-AssessmentReport.ps1`

Replace hardcoded `12` in the exec summary hero metric (~line 3655, inside the HTML here-string) with `$($allFrameworkKeys.Count)`. The `$allFrameworkKeys` variable is defined at ~line 91 and is in scope when the HTML string is constructed. PowerShell expands `$()` subexpressions inside double-quoted here-strings, so this works natively.

### #99 COMPLIANCE.md

**File:** `COMPLIANCE.md`

Update stale counts. Verify current numbers by querying the registry:
```powershell
$reg = Get-Content controls/registry.json | ConvertFrom-Json
($reg.controls | Where-Object { $_.automated -eq $true }).Count  # automated count
```
- Update automated check count (currently says 57, actual is ~149 per v0.9.0 registry)
- Verify CIS profile counts against `controls/frameworks/cis-m365-v6.json`
- Update framework count from 12 to 13 if mentioned

### #101 CONTRIBUTING.md + PR Template

**Files:** `CONTRIBUTING.md`, `.github/pull_request_template.md`

- Add testing subsection to CONTRIBUTING.md explaining CI runs PSScriptAnalyzer and Pester automatically
- Note that contributors should run `Invoke-Pester` when modifying collectors or Common/ helpers
- Add Pester checkbox to PR template: `- [ ] Pester tests pass (if modifying collectors or Common/ helpers)`

### #102 Registry Source-of-Truth

**File:** `controls/README.md` (new)

Document the CSV-to-JSON build pipeline:
- `Common/framework-mappings.csv` + `controls/check-id-mapping.csv` are the source of truth
- `registry.json` is a generated artifact -- never edit directly
- Workflow for adding new controls: edit CSVs, run `.\controls\Build-Registry.ps1`, commit both CSVs and the regenerated JSON
- SOC 2 mapping derivation logic (NIST 800-53 family to Trust Services Criteria regex)

### #113 PowerBI Test Coverage

**File:** `tests/PowerBI/Get-PowerBISecurityConfig.Tests.ps1` (existing file, add new contexts)

Add test contexts that exercise the error paths introduced by #106:
- `Get-PowerBIAccessToken` throws -- verify collector exits with connection error message
- `Invoke-PowerBIRestMethod` throws 403 -- verify all checks get `Review` with permissions message
- `Invoke-PowerBIRestMethod` throws 404 -- verify all checks get `Review` with admin API message
- Verify warning/error output text in each failure case using `Should -Invoke` and output capture

---

## Out of Scope

- No version bump in this PR (separate approval per releases.md)
- No changes to report HTML layout or compliance UX (v0.9.2 milestone)
- No new framework JSON files (v1.0.0 milestone)
