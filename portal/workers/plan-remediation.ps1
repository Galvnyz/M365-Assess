# plan-remediation.ps1 — worker entrypoint for EPIC-006 plan generation (T-0105).
#
# Reads a `remediation` job envelope, loads the run's findings artifact, builds a
# RemediationPlan + RemediationAction rows via New-RemediationPlan, writes the
# plan to `<OutputFolder>/remediation-plan.json`, and emits the standard result
# envelope (`result.json`) through Write-WorkerResult.
#
# This is plan-only: it makes no tenant writes. Apply is T-0107/T-0108.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string] $JobFile,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string] $OutputFolder,

    [Parameter()]
    [string] $FindingsFile = ''
)

$ErrorActionPreference = 'Stop'

Import-Module (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/M365Portal.Workers.psd1') -Force
. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Plan-Remediation.ps1')

function Get-PlanRemediationJob {
    param([Parameter(Mandatory = $true)][string] $Path)

    $raw = Get-Content -LiteralPath $Path -Raw
    $job = $raw | ConvertFrom-Json -AsHashtable

    if ($job['schemaVersion'] -ne 'v1') {
        throw "plan-remediation.invalid_envelope: unsupported schemaVersion '$($job['schemaVersion'])'"
    }
    if ($job['jobType'] -ne 'remediation') {
        throw "plan-remediation.invalid_envelope: expected jobType 'remediation', got '$($job['jobType'])'"
    }
    foreach ($required in @('jobId', 'tenantId', 'runId', 'requestId', 'correlationId')) {
        if ([string]::IsNullOrWhiteSpace([string]$job[$required])) {
            throw "plan-remediation.invalid_envelope: missing '$required'"
        }
    }
    return $job
}

$startedAt = [DateTime]::UtcNow.ToString('o')
$job = Get-PlanRemediationJob -Path $JobFile

$tenantId = [string]$job['tenantId']
$runId = [string]$job['runId']
$planId = ''
$createdBy = ''
$callerContext = $null
if ($job['payload'] -is [System.Collections.IDictionary]) {
    if ($job['payload'].Contains('planId')) { $planId = [string]$job['payload']['planId'] }
    if ($job['payload'].Contains('createdBy')) { $createdBy = [string]$job['payload']['createdBy'] }
    # The portal sends whether the caller may apply, and their tenant scope; without it
    # the gate rejects every action (rbac-denied).
    # Rebuilt in the gate's documented shape: -AsHashtable keys are case-sensitive and
    # the gate reads Permissions / TenantScope.All / TenantScope.TenantIds.
    $caller = $job['payload']['caller']
    if ($caller -is [System.Collections.IDictionary]) {
        $scope = $caller['tenantScope']
        $callerContext = @{
            # The gate's permission name for apply (Test-RemediationGate -RequiredPermission).
            Permissions = if ([bool]$caller['canApply']) { @('remediation.apply') } else { @() }
            TenantScope = @{
                All       = ($scope -is [System.Collections.IDictionary]) -and [bool]$scope['all']
                TenantIds = if ($scope -is [System.Collections.IDictionary]) { @($scope['tenantIds'] | Where-Object { $_ } | ForEach-Object { [string]$_ }) } else { @() }
            }
        }
    }
}

$resolvedFindingsPath = if ($FindingsFile) {
    $FindingsFile
}
else {
    Join-Path -Path $OutputFolder -ChildPath 'findings.json'
}

try {
    $findings = @(Get-Content -LiteralPath $resolvedFindingsPath -Raw | ConvertFrom-Json)

    $planParams = @{
        Findings      = $findings
        TenantId      = $tenantId
        RunId         = $runId
        PlanId        = $planId
        CreatedBy     = $createdBy
        CorrelationId = [string]$job['correlationId']
    }
    if ($null -ne $callerContext) { $planParams['CallerContext'] = $callerContext }
    $plan = New-RemediationPlan @planParams

    New-Item -Path $OutputFolder -ItemType Directory -Force | Out-Null
    $plan | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path -Path $OutputFolder -ChildPath 'remediation-plan.json') -Encoding UTF8

    $finishedAt = [DateTime]::UtcNow.ToString('o')
    $null = Write-WorkerResult `
        -OutputFolder $OutputFolder `
        -JobId ([string]$job['jobId']) `
        -JobType 'remediation' `
        -TenantId $tenantId `
        -RunId $runId `
        -RequestId ([string]$job['requestId']) `
        -CorrelationId ([string]$job['correlationId']) `
        -Status 'succeeded' `
        -ExitCode 0 `
        -ArtifactRefs @('remediation-plan.json') `
        -StartedAt $startedAt `
        -FinishedAt $finishedAt
}
catch {
    $finishedAt = [DateTime]::UtcNow.ToString('o')
    $null = Write-WorkerResult `
        -OutputFolder $OutputFolder `
        -JobId ([string]$job['jobId']) `
        -JobType 'remediation' `
        -TenantId $tenantId `
        -RunId $runId `
        -RequestId ([string]$job['requestId']) `
        -CorrelationId ([string]$job['correlationId']) `
        -Status 'failed' `
        -ExitCode 1 `
        -StartedAt $startedAt `
        -FinishedAt $finishedAt `
        -ErrorCode 'remediation.plan_failed' `
        -ErrorMessage $_.Exception.Message
    throw
}
