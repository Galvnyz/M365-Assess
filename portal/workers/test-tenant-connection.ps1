<#
.SYNOPSIS
    Worker entrypoint for the EPIC-002 tenant connection test (T-0822).
.DESCRIPTION
    Reads a job envelope from -JobFile (tenantId, the credential block, optional services)
    and runs Test-TenantConnection, which resolves the credential in this process and
    probes each service read-only. Emits the per-service result as JSON on stdout.
.PARAMETER JobFile
    Path to the job envelope JSON written by the BFF.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$JobFile
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Test-TenantConnection.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Connect-WorkerTenant.ps1')

$block = Read-WorkerCredentialBlock -JobFile $JobFile
$job = Get-Content -LiteralPath $JobFile -Raw | ConvertFrom-Json
$testParams = @{
    TenantId         = $block.TenantId
    CredentialRef    = $block.CredentialRef
    CredentialRecord = $block.Record
}
if ($job.services) { $testParams['Services'] = @($job.services | ForEach-Object { [string]$_ }) }

Test-TenantConnection @testParams | ConvertTo-Json -Depth 6 -Compress
