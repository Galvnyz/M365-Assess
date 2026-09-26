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

if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
    $job = Read-SetPimRoleSettingsJob -Path $JobFile
    $TenantId = $job['TenantId']
    $RoleId = $job['RoleId']
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
