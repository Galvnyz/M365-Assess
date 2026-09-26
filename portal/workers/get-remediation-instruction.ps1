# get-remediation-instruction.ps1 — worker entrypoint for EPIC-006 manual
# instruction rendering (T-0106).
#
# Reads a `remediation` job envelope carrying { check, checkId }, resolves the
# manual instruction through Get-ManualInstruction (doc overrides registry), and
# writes `manual-instruction.json` plus the standard result envelope.
#
# Read-only: this entrypoint never writes to a tenant or to storage.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string] $JobFile,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string] $OutputFolder,

    [Parameter()]
    [string] $ManualRoot = ''
)

$ErrorActionPreference = 'Stop'

Import-Module (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/M365Portal.Workers.psd1') -Force
. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Get-ManualInstruction.ps1')

function Get-InstructionJob {
    param([Parameter(Mandatory = $true)][string] $Path)

    $raw = Get-Content -LiteralPath $Path -Raw
    $job = $raw | ConvertFrom-Json -AsHashtable

    if ($job['schemaVersion'] -ne 'v1') {
        throw "get-remediation-instruction.invalid_envelope: unsupported schemaVersion '$($job['schemaVersion'])'"
    }
    if ($job['jobType'] -ne 'remediation') {
        throw "get-remediation-instruction.invalid_envelope: expected jobType 'remediation', got '$($job['jobType'])'"
    }
    foreach ($required in @('jobId', 'tenantId', 'runId', 'requestId', 'correlationId')) {
        if ([string]::IsNullOrWhiteSpace([string]$job[$required])) {
            throw "get-remediation-instruction.invalid_envelope: missing '$required'"
        }
    }
    return $job
}

function Get-InstructionPayloadValue {
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
$job = Get-InstructionJob -Path $JobFile

$tenantId = [string]$job['tenantId']
$checkId = [string](Get-InstructionPayloadValue -Job $job -Name 'check' -Default '')
if (-not $checkId) {
    $checkId = [string](Get-InstructionPayloadValue -Job $job -Name 'checkId' -Default '')
}

try {
    if (-not $checkId) {
        throw 'get-remediation-instruction.missing_check: job payload has no check id'
    }

    $instruction = Get-ManualInstruction -CheckId $checkId -ManualRoot $ManualRoot

    New-Item -Path $OutputFolder -ItemType Directory -Force | Out-Null
    $instruction | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path -Path $OutputFolder -ChildPath 'manual-instruction.json') -Encoding UTF8

    $finishedAt = [DateTime]::UtcNow.ToString('o')
    $null = Write-WorkerResult `
        -OutputFolder $OutputFolder `
        -JobId ([string]$job['jobId']) `
        -JobType 'remediation' `
        -TenantId $tenantId `
        -RunId ([string]$job['runId']) `
        -RequestId ([string]$job['requestId']) `
        -CorrelationId ([string]$job['correlationId']) `
        -Status 'succeeded' `
        -ExitCode 0 `
        -ArtifactRefs @('manual-instruction.json') `
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
        -RunId ([string]$job['runId']) `
        -RequestId ([string]$job['requestId']) `
        -CorrelationId ([string]$job['correlationId']) `
        -Status 'failed' `
        -ExitCode 1 `
        -StartedAt $startedAt `
        -FinishedAt $finishedAt `
        -ErrorCode 'remediation.instruction_failed' `
        -ErrorMessage $_.Exception.Message
    throw
}
