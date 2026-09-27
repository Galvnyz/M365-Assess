<#
.SYNOPSIS
    Worker entrypoint for EPIC-002 GDAP tenant discovery (T-0822).
.DESCRIPTION
    Reads a job envelope from -JobFile whose tenantId and credential block are the
    partner (MSP) tenant's, signs in as the partner, and runs Sync-GdapTenants to list
    delegated admin relationships. Emits the discovery result as JSON on stdout.
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

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Sync-GdapTenants.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Connect-WorkerTenant.ps1')

# Sign in to the partner tenant (T-0826).
$tenantSession = Connect-WorkerTenant -JobFile $JobFile -Service Graph
try {
    $job = Get-Content -LiteralPath $JobFile -Raw | ConvertFrom-Json
    Sync-GdapTenants -PartnerTenantId ([string]$job.tenantId) | ConvertTo-Json -Depth 8 -Compress
}
finally {
    Disconnect-WorkerTenant -Session $tenantSession
}
