# get-intune-policies.ps1 — entrypoint for Get-IntunePolicies worker (T-0301).
# Dot-sources the worker module and dispatches to Get-IntunePolicies.

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$JobPath
)

$ErrorActionPreference = 'Stop'

$workerPath = Join-Path $PSScriptRoot 'M365Portal.Workers/Get-IntunePolicies.ps1'
. $workerPath

$job    = Read-IntunePoliciesJob -Path $JobPath
$result = Get-IntunePolicies `
    -TenantId $job.TenantId `
    -Kind     $job.Kind `
    -Top      $job.Top `
    -Search   $job.Search

$result | ConvertTo-Json -Depth 10 -Compress
