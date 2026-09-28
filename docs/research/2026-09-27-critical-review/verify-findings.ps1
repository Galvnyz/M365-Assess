# Offline, synthetic reproductions against the exact main revision reviewed.
# No tenant connection, network request, module import, or tenant data is used.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$revision = '4daebfa91520b5998a5dd8184ce1aaedd4a3ef8d'
function Read-ReviewSource([string]$Path) {
    $source = git show "${revision}:$Path"
    if ($LASTEXITCODE -ne 0) { throw "Cannot read $Path at $revision" }
    $source -join "`n"
}
$results = [System.Collections.Generic.List[object]]::new()

# Execute the unchanged UAL block, with only the external cmdlet and output sink mocked.
$compliance = Read-ReviewSource 'src/M365-Assess/Security/Get-ComplianceSecurityConfig.ps1'
$ual = [scriptblock]::Create($compliance.Substring($compliance.IndexOf('try {'), $compliance.IndexOf('# 2. DLP Policies') - $compliance.IndexOf('try {')))
function Add-Setting {
    param($Category, $Setting, $CurrentValue, $RecommendedValue, $Status, $CheckId, $Remediation, $Evidence)
    $script:rows.Add([pscustomobject]@{ Setting = $Setting; Status = $Status; CurrentValue = $CurrentValue })
}
function Get-AdminAuditLogConfig {
    [CmdletBinding()] param()
    if ($script:simulateFailure) { throw 'Synthetic access failure' }
    [pscustomobject]@{ UnifiedAuditLogIngestionEnabled = $false }
}
$script:rows = [System.Collections.Generic.List[object]]::new()
$script:simulateFailure = $false
& $ual
$results.Add([pscustomobject]@{ Case = 'UAL Purview-shaped False'; Actual = $script:rows[0].Status; Expected = 'Reject non-authoritative endpoint; assess via EXO' })
$script:rows.Clear()
$script:simulateFailure = $true
& $ual -WarningAction SilentlyContinue
$results.Add([pscustomobject]@{ Case = 'UAL cmdlet throws'; Actual = "$($script:rows.Count) findings"; Expected = 'One explicit not-assessed finding' })

# The helper returns partial data at the page cap without a completeness property.
$helper = [scriptblock]::Create((Read-ReviewSource 'src/M365-Assess/Common/Invoke-SafeGraphRequest.ps1'))
. $helper
function Invoke-MgGraphRequest {
    [CmdletBinding()] param($Uri, $Method)
    @{ value = @(@{ id = 'synthetic-first-page-item' }); '@odata.nextLink' = '/synthetic-next-page' }
}
$partial = Invoke-SafeGraphRequest -Uri '/synthetic-first-page' -MaxPages 1 -WarningAction SilentlyContinue
$results.Add([pscustomobject]@{ Case = 'Graph cap before next page'; Actual = "items=$($partial.value.Count); keys=$($partial.Keys -join ',')"; Expected = 'Structured incomplete state or terminating error' })

# Run unchanged Security Defaults logic with MFA optional under an OR grant.
$auth = Read-ReviewSource 'src/M365-Assess/Entra/EntraPasswordAuthChecks.ps1'
$authBlock = [scriptblock]::Create($auth.Substring(0, $auth.IndexOf('# 7. Self-Service Password Reset')))
function Invoke-MgGraphRequest {
    [CmdletBinding()] param($Uri, $Method)
    if ($Uri -like '*identitySecurityDefaultsEnforcementPolicy*') { return @{ isEnabled = $false } }
    @{ value = @(
        @{ state = 'enabled'; grantControls = @{ operator = 'OR'; builtInControls = @('mfa', 'compliantDevice') }; conditions = @{ users = @{ includeUsers = @('All'); includeRoles = @('62e90394-69f5-4237-9190-012177145e10') }; clientAppTypes = @('all'); applications = @{ includeApplications = @('All') } } },
        @{ state = 'enabled'; grantControls = @{ operator = 'OR'; builtInControls = @('block') }; conditions = @{ users = @{ includeUsers = @('All') }; clientAppTypes = @('other'); applications = @{ includeApplications = @('All') } } }
    ) }
}
$script:rows.Clear()
& $authBlock
$gap = $script:rows | Where-Object Setting -EQ 'Security Defaults Gap Analysis'
$results.Add([pscustomobject]@{ Case = 'CA MFA optional via OR compliantDevice'; Actual = "$($gap.Status): $($gap.CurrentValue)"; Expected = 'Cannot assert equivalent MFA protection' })

# Invoke the actual pure JavaScript scoring helpers without rendering a report.
$jsx = Read-ReviewSource 'src/M365-Assess/assets/report-app.jsx'
$start = $jsx.IndexOf('function fwCoveragePct(')
$end = $jsx.IndexOf('function useFwCountUp(', $start)
$js = $jsx.Substring($start, $end - $start) + @'

const counts = {pass: 9, info: 0, fail: 1, warn: 0, review: 0, na: 0, total: 10};
console.log(JSON.stringify({percent: fwCoveragePct(counts), label: fwReadinessLabel(fwCoveragePct(counts)).label}));
'@
$score = ($js | node -) | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'JavaScript reproduction failed' }
$results.Add([pscustomobject]@{ Case = 'Nine passing mapped findings, one failing'; Actual = "$($score.percent)% / $($score.label)"; Expected = 'Measured finding posture, not an audit-readiness claim' })
$start = $jsx.IndexOf('const computeComplianceReadinessScore =')
$end = $jsx.IndexOf('// 3 list views', $start)
$readinessJs = $jsx.Substring($start, $end - $start) + "`nconsole.log(computeComplianceReadinessScore([{status:'Review'},{status:'Review'}]));"
$readiness = $readinessJs | node -
if ($LASTEXITCODE -ne 0) { throw 'Readiness reproduction failed' }
$results.Add([pscustomobject]@{ Case = 'Only unverified Review findings'; Actual = "Compliance Readiness = $readiness%"; Expected = 'Unverified work cannot count as confirmed readiness' })
$output = [pscustomobject]@{ Revision = $revision; Method = 'Unchanged source blocks with synthetic external responses'; Results = $results }
$output | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'verification-results.json') -Encoding utf8
$results | Format-Table -Wrap
