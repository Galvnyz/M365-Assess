# v0.9.1 Hardening & Polish -- Design Spec

**Goal:** Fix 13 issues spanning error handling, auth, SOC2 dependency, documentation, and test coverage in a single PR.

**Branch:** `chore/v091-hardening`

---

## Section 1: Error Handling & Graceful Degradation

**Issues:** #106, #114, #115, #116, #117

### Pattern

Standardize error handling across collectors with HTTP status parsing:

- **401/403** -- "Access denied" with specific permission or license requirement
- **404** -- "Not available" (endpoint doesn't exist for this tenant/plan)
- **Other** -- generic warning with original exception message

All degraded checks get status `Review` (not `Error`) with actionable `CurrentValue` text.

### #106 PowerBI 404 Handling

**File:** `PowerBI/Get-PowerBISecurityConfig.ps1`

When `admin/tenantSettings` returns 404, set all checks to "Error" with "Power BI admin API not available -- ensure the calling account has Power BI Service Administrator role." Current behavior silently sets `$allSettings = @()` which produces "Review" on every check with no explanation.

Parse the exception in the catch block to distinguish 404 from other errors.

### #114 Null Array Errors

**Files:** All collectors that call `Invoke-MgGraphRequest` and access `$response['value']`

Wrap array access with null guards:
```powershell
$items = if ($result -and $result['value']) { @($result['value']) } else { @() }
```

Audit all collectors for unsafe `$response['value']` access patterns. Primary targets:
- `Entra/Get-EntraSecurityConfig.ps1` (lines 138, 354, 393)
- Other collectors as found during implementation

### #115 Teams Beta Endpoints

**File:** `Collaboration/Get-TeamsSecurityConfig.ps1`

Replace `-ErrorAction SilentlyContinue` on beta endpoint calls (`/beta/teamwork/teamsClientConfiguration`, `/beta/teamwork/teamsMeetingPolicy`) with explicit try/catch blocks. Log which endpoint failed and why. Set affected checks to "Review" with a message indicating the beta endpoint was unavailable.

### #116 SharePoint 401

**File:** `Collaboration/Get-SharePointSecurityConfig.ps1`

Parse the exception from `/v1.0/admin/sharepoint/settings` to detect 401/403 and provide specific remediation: "Missing SharePointTenantSettings.Read.All permission. Add this scope when connecting to Graph."

### #117 PIM Without Configuration

**File:** `Entra/Get-EntraSecurityConfig.ps1`

The current catch block assumes 403 means "no P2 license." E5 tenants that haven't configured PIM also get 403. Update the messaging to distinguish:
- If tenant has E5/P2 SKU but PIM API returns 403: "PIM is available but not configured in this tenant"
- If no P2/E5 SKU detected: "Requires Entra ID P2 license (included in M365 E5)"

Both cases degrade to "Review" status. Detection: check `Get-MgSubscribedSku` for known P2/E5 SKU IDs before making PIM API calls.

---

## Section 2: Auth Fixes

**Issues:** #111, #112

### #112 EXO ClientSecret -- Explicit Rejection

**File:** `Common/Connect-Service.ps1`

Exchange Online Management module does not support client secret authentication. Add an explicit `elseif` branch that throws a clear error instead of silently falling through to interactive auth:

```powershell
elseif ($ClientId -and $ClientSecret) {
    throw "Exchange Online does not support client secret authentication. Use -CertificateThumbprint for app-only auth."
}
```

Apply the same pattern to the Purview case.

### #111 SecureString for ClientSecret

**Files:** `Invoke-M365Assessment.ps1`, `Common/Connect-Service.ps1`, `AUTHENTICATION.md`

Change `$ClientSecret` parameter type from `[string]` to `[SecureString]` on both the orchestrator and Connect-Service. Update internal conversion logic to use the SecureString directly (no more `ConvertTo-SecureString` from plain text). Update AUTHENTICATION.md with the new calling pattern.

This is a minor breaking change. Document in CHANGELOG.

---

## Section 3: SOC2 SPO Dependency

**Issue:** #110

**File:** `SOC2/Get-SOC2ConfidentialityControls.ps1`

Guard SPO-dependent checks with module and connection availability:

1. Check if `Get-SPOTenant` command exists (module installed)
2. If command exists, try calling it in a try/catch (connection established)
3. If either fails, set affected checks to "Review" with appropriate message:
   - Module missing: "Requires Microsoft.Online.SharePoint.PowerShell module"
   - Not connected: "SharePoint Online connection required -- run Connect-SPOService first"
4. Let remaining SOC2 confidentiality checks run normally

---

## Section 4: Documentation & Tests

**Issues:** #99, #100, #101, #102, #113

### #100 Framework Count

**File:** `Common/Export-AssessmentReport.ps1`

Replace hardcoded `12` in exec summary hero metric with `$($allFrameworkKeys.Count)`.

### #99 COMPLIANCE.md

**File:** `COMPLIANCE.md`

- Update automated check count from 57 to 149
- Verify CIS profile counts against current registry
- Update framework count from 12 to 13

### #101 CONTRIBUTING.md + PR Template

**Files:** `CONTRIBUTING.md`, `.github/pull_request_template.md`

- Add testing subsection to CONTRIBUTING.md explaining CI runs PSScriptAnalyzer and Pester
- Note that contributors should run `Invoke-Pester` when modifying collectors or Common/ helpers
- Add Pester checkbox to PR template

### #102 Registry Source-of-Truth

**File:** `controls/README.md` (new)

Document the CSV-to-JSON build pipeline:
- `Common/framework-mappings.csv` + `controls/check-id-mapping.csv` are source of truth
- `registry.json` is generated -- never edit directly
- Workflow for adding new controls
- SOC 2 mapping derivation logic

### #113 PowerBI Test Coverage

**File:** `tests/PowerBI/Get-PowerBISecurityConfig.Tests.ps1`

Add test contexts for:
- `Get-PowerBIAccessToken` throws (disconnected state)
- `Invoke-PowerBIRestMethod` throws 403 (insufficient permissions)
- `Invoke-PowerBIRestMethod` throws 404 (admin API unavailable, ties into #106 fix)
- Verify error/warning output in each failure case

---

## Out of Scope

- No version bump in this PR (separate approval per releases.md)
- No changes to report HTML layout or compliance UX (v0.9.2 milestone)
- No new framework JSON files (v1.0.0 milestone)
