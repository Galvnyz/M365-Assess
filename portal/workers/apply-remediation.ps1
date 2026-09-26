# apply-remediation.ps1 — worker entrypoint for EPIC-006 gated apply (T-0108).
#
# Reads a `remediation` job envelope carrying { planId, actionIds, dryRun,
# continueOnFailure, reason, actor }, loads the plan artifact written by
# plan-remediation.ps1, applies the selected actions through
# Invoke-RemediationApply, and writes `remediation-apply.json` plus the standard
# result envelope (`result.json`).
#
# dryRun defaults to true: an apply job that omits the flag does not write.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string] $JobFile,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string] $OutputFolder,

    [Parameter()]
    [string] $PlanFile = ''
)

$ErrorActionPreference = 'Stop'

Import-Module (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/M365Portal.Workers.psd1') -Force
. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Invoke-RemediationApply.ps1')

function Get-ApplyRemediationJob {
    param([Parameter(Mandatory = $true)][string] $Path)

    $raw = Get-Content -LiteralPath $Path -Raw
    $job = $raw | ConvertFrom-Json -AsHashtable

    if ($job['schemaVersion'] -ne 'v1') {
        throw "apply-remediation.invalid_envelope: unsupported schemaVersion '$($job['schemaVersion'])'"
    }
    if ($job['jobType'] -ne 'remediation') {
        throw "apply-remediation.invalid_envelope: expected jobType 'remediation', got '$($job['jobType'])'"
    }
    foreach ($required in @('jobId', 'tenantId', 'runId', 'requestId', 'correlationId')) {
        if ([string]::IsNullOrWhiteSpace([string]$job[$required])) {
            throw "apply-remediation.invalid_envelope: missing '$required'"
        }
    }
    return $job
}

function Get-JobPayloadValue {
    param(
        [Parameter(Mandatory = $true)] $Job,
        [Parameter(Mandatory = $true)][string] $Name,
        $Default = $null
    )
    $payload = $Job['payload']
    if ($payload -is [System.Collections.IDictionary] -and $payload.Contains($Name)) {
        return $payload[$Name]
    }
    return $Default
}

$startedAt = [DateTime]::UtcNow.ToString('o')
$job = Get-ApplyRemediationJob -Path $JobFile

$tenantId = [string]$job['tenantId']
$planId = [string](Get-JobPayloadValue -Job $job -Name 'planId' -Default '')
$dryRun = [bool](Get-JobPayloadValue -Job $job -Name 'dryRun' -Default $true)
$continueOnFailure = [bool](Get-JobPayloadValue -Job $job -Name 'continueOnFailure' -Default $false)
$actor = [string](Get-JobPayloadValue -Job $job -Name 'actor' -Default '')
$actionIds = @(Get-JobPayloadValue -Job $job -Name 'actionIds' -Default @())

$resolvedPlanFile = if ($PlanFile) {
    $PlanFile
}
else {
    Join-Path -Path $OutputFolder -ChildPath 'remediation-plan.json'
}

try {
    $plan = Get-Content -LiteralPath $resolvedPlanFile -Raw | ConvertFrom-Json
    if (-not $planId) { $planId = [string]$plan.Plan.id }

    $actions = @($plan.Actions)
    if ($actionIds.Count -gt 0) {
        $actions = @($actions | Where-Object { $actionIds -contains [string]$_.id })
    }

    $applyResult = Invoke-RemediationApply `
        -Actions $actions `
        -PlanId $planId `
        -TenantId $tenantId `
        -DryRun $dryRun `
        -ContinueOnFailure $continueOnFailure `
        -Actor $actor `
        -CorrelationId ([string]$job['correlationId'])

    New-Item -Path $OutputFolder -ItemType Directory -Force | Out-Null
    $applyResult | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path -Path $OutputFolder -ChildPath 'remediation-apply.json') -Encoding UTF8

    $finishedAt = [DateTime]::UtcNow.ToString('o')
    $status = if ($applyResult.Summary.failed -gt 0) { 'failed' } else { 'succeeded' }
    $exitCode = if ($status -eq 'succeeded') { 0 } else { 1 }
    $null = Write-WorkerResult `
        -OutputFolder $OutputFolder `
        -JobId ([string]$job['jobId']) `
        -JobType 'remediation' `
        -TenantId $tenantId `
        -RunId ([string]$job['runId']) `
        -RequestId ([string]$job['requestId']) `
        -CorrelationId ([string]$job['correlationId']) `
        -Status $status `
        -ExitCode $exitCode `
        -ArtifactRefs @('remediation-apply.json') `
        -StartedAt $startedAt `
        -FinishedAt $finishedAt `
        -ErrorCode $(if ($status -eq 'failed') { 'remediation.apply_failed' } else { '' }) `
        -ErrorMessage $(if ($status -eq 'failed') { 'one or more remediation actions failed' } else { '' })
}
catch {
    $finishedAt = [DateTime]::UtcNow.ToString('o')
    $null = Write-WorkerResult `
        -OutputFolder $OutputFolder `
        -JobId ([string]$job['jobId']) `
        -JobType 'remediation' `
        -TenantId $tenantId `
        -RunId ([string]$job['runId']) `
        -RequestId ([string]$job['requestId']) `
        -CorrelationId ([string]$job['correlationId']) `
        -Status 'failed' `
        -ExitCode 1 `
        -StartedAt $startedAt `
        -FinishedAt $finishedAt `
        -ErrorCode 'remediation.apply_failed' `
        -ErrorMessage $_.Exception.Message
    throw
}
