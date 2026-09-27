<#
.SYNOPSIS
    Worker entrypoint for EPIC-016 reusable settings list and sync (T-0308).
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile, then either lists the tenant's reusable
    policy settings (action 'list') or previews/applies reusable setting templates
    (action 'sync'), and emits JSON on stdout. Sync previews unless dryRun is false.
.PARAMETER JobFile
    Path to the job envelope JSON written by the supervisor.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$JobFile
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Sync-ReusableSettings.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Connect-WorkerTenant.ps1')

# Sign in to the job's tenant (T-0826). Direct-parameter runs manage their own session.
$tenantSession = $null
if ($JobFile) {
    $tenantSession = Connect-WorkerTenant -JobFile $JobFile -Service Graph
}
try {
    $job = Read-SyncReusableSettingsJob -Path $JobFile

    if ($job['Action'] -eq 'list') {
        $settings = Get-TenantReusableSetting
        $result = [pscustomobject]@{
            tenantId = $job['TenantId']
            items    = @($settings | Select-Object -Property id, displayName, settingDefinitionId, type, inScope, referencingPolicyCount)
        }
    }
    else {
        $syncParams = @{
            TenantId      = $job['TenantId']
            TemplatesJson = $job['TemplatesJson']
            DryRun        = [bool]$job['DryRun']
            Actor         = $job['Actor']
        }
        $result = Sync-ReusableSettingTemplate @syncParams
    }

    $result | ConvertTo-Json -Depth 30 -Compress
}
finally {
    Disconnect-WorkerTenant -Session $tenantSession
}
