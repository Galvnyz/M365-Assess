# get-intune-policies.ps1 - entrypoint for Get-IntunePolicies worker (T-0301).
# Dot-sources the worker module and dispatches to Get-IntunePolicies.

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$JobFile
)

$ErrorActionPreference = 'Stop'

$workerPath = Join-Path $PSScriptRoot 'M365Portal.Workers/Get-IntunePolicies.ps1'
. $workerPath
. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Connect-WorkerTenant.ps1')

# Sign in to the job's tenant (T-0826). Direct-parameter runs manage their own session.
$tenantSession = $null
if ($JobFile) {
    $tenantSession = Connect-WorkerTenant -JobFile $JobFile -Service Graph
}
try {
    $job    = Read-IntunePoliciesJob -Path $JobFile
    $listParams = @{
        TenantId     = $job.TenantId
        Kind         = $job.Kind
        Top          = $job.Top
        Cursor       = $job.SkipToken
        Search       = $job.Search
        Platform     = $job.Platform
        PolicyType   = $job.PolicyType
        Assigned     = $job.Assigned
        ModifiedDate = $job.ModifiedDate
    }
    $result = Get-IntunePolicies @listParams

    $result | ConvertTo-Json -Depth 10 -Compress
}
finally {
    Disconnect-WorkerTenant -Session $tenantSession
}
