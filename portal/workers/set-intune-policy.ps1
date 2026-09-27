# set-intune-policy.ps1 — entrypoint for Set-IntunePolicy worker (T-0302).
# Dot-sources the worker module and dispatches to Invoke-SetIntunePolicy.

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$JobFile
)

$ErrorActionPreference = 'Stop'

$workerPath = Join-Path $PSScriptRoot 'M365Portal.Workers/Set-IntunePolicy.ps1'
. $workerPath

$job    = Read-IntunePolicyCrudJob -Path $JobFile
$result = Invoke-SetIntunePolicy `
    -TenantId       $job.TenantId `
    -Kind           $job.Kind `
    -Action         $job.Action `
    -PolicyId       $job.PolicyId `
    -DisplayName    $job.DisplayName `
    -Platform       $job.Platform `
    -SettingsJson   $job.SettingsJson `
    -PolicyJson     $job.PolicyJson `
    -AssignmentsJson $job.AssignmentsJson `
    -ConfirmName    $job.ConfirmName `
    -DryRun         $job.DryRun

$result | ConvertTo-Json -Depth 10 -Compress
