<#
.SYNOPSIS
    Worker entrypoint for EPIC-013 PIM role settings apply with plan preview.
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile (or direct parameters),
    applies or previews PIM role settings via Set-PimRoleSettings, and
    emits the result envelope as JSON on stdout.
#>
[CmdletBinding(DefaultParameterSetName = 'ByJobFile')]
param(
    [Parameter(Mandatory, ParameterSetName = 'ByJobFile')]
    [ValidateNotNullOrEmpty()]
    [string]$JobFile,

    [Parameter(Mandatory, ParameterSetName = 'ByTenant')]
    [ValidateNotNullOrEmpty()]
    [string]$TenantId,

    [Parameter(Mandatory, ParameterSetName = 'ByTenant')]
    [ValidateNotNullOrEmpty()]
    [string]$RoleId,

    [Parameter(ParameterSetName = 'ByTenant')]
    [hashtable]$Settings = @{},

    [Parameter(ParameterSetName = 'ByTenant')]
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Set-PimRoleSettings.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Connect-WorkerTenant.ps1')

# Sign in to the job's tenant (T-0826). Direct-parameter runs manage their own session.
$tenantSession = $null
if ($JobFile) {
    $tenantSession = Connect-WorkerTenant -JobFile $JobFile -Service Graph
}
try {
    if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
        $job = Read-SetPimRoleSettingsJob -Path $JobFile
        $TenantId = $job['TenantId']
        $RoleId = $job['RoleId']
        # action 'get' reads the role's live settings without changing them.
        if ($job['Action'] -eq 'get') {
            Get-PimRoleCurrentSettings -TenantId $TenantId -RoleId $RoleId | ConvertTo-Json -Depth 6 -Compress
            return
        }
        $Settings = $job['Settings']
        $DryRun = [bool]$job['DryRun']
    }

    $invokeParams = @{
        TenantId = $TenantId
        RoleId   = $RoleId
        Settings = $Settings
        DryRun   = $DryRun
    }

    $result = Set-PimRoleSettings @invokeParams
    $result | ConvertTo-Json -Depth 6 -Compress
}
finally {
    Disconnect-WorkerTenant -Session $tenantSession
}
