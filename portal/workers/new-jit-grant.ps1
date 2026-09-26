<#
.SYNOPSIS
    Worker entrypoint for EPIC-013 JIT admin grants.
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile (or parameters directly) and
    grants, revokes, or extends a bounded JIT assignment via New-JitGrant.
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
    [string]$UserId,

    [Parameter(Mandatory, ParameterSetName = 'ByTenant')]
    [ValidateNotNullOrEmpty()]
    [string]$RoleId,

    [Parameter(ParameterSetName = 'ByTenant')]
    [ValidateSet('grant', 'revoke', 'extend')]
    [string]$Action = 'grant',

    [Parameter(ParameterSetName = 'ByTenant')]
    [ValidateSet('eligible', 'active')]
    [string]$AssignmentType = 'eligible',

    [Parameter(ParameterSetName = 'ByTenant')]
    [int]$DurationHours = 8,

    [Parameter(ParameterSetName = 'ByTenant')]
    [int]$MaxDurationHours = 24,

    [Parameter(ParameterSetName = 'ByTenant')]
    [int]$AdditionalHours = 4,

    [Parameter(ParameterSetName = 'ByTenant')]
    [string]$Justification = 'JIT Admin Grant'
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/New-JitGrant.ps1')

if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
    $job = Read-NewJitGrantJob -Path $JobFile
    $TenantId = $job['TenantId']
    $UserId = $job['UserId']
    $RoleId = $job['RoleId']
    $Action = $job['Action']
    $AssignmentType = $job['AssignmentType']
    $DurationHours = $job['DurationHours']
    $MaxDurationHours = $job['MaxDurationHours']
    $Justification = $job['Justification']
}

$result = switch ($Action) {
    'revoke' {
        Revoke-JitGrant -TenantId $TenantId -UserId $UserId -RoleId $RoleId -AssignmentType $AssignmentType
    }
    'extend' {
        Extend-JitGrant -TenantId $TenantId -UserId $UserId -RoleId $RoleId -AdditionalHours $AdditionalHours -CurrentDurationHours $DurationHours -MaxDurationHours $MaxDurationHours -AssignmentType $AssignmentType
    }
    default {
        New-JitGrant -TenantId $TenantId -UserId $UserId -RoleId $RoleId -AssignmentType $AssignmentType -DurationHours $DurationHours -MaxDurationHours $MaxDurationHours -Justification $Justification
    }
}

$result | ConvertTo-Json -Depth 6 -Compress
