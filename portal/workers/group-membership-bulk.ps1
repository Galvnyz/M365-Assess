<#
.SYNOPSIS
    Worker entrypoint for EPIC-014 bulk group membership.
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile (or parameters directly),
    executes or previews bulk member/owner changes via Invoke-GroupMembershipBulk,
    and emits JSON envelope on stdout.
#>
[CmdletBinding(DefaultParameterSetName = 'ByJobFile')]
param(
    [Parameter(Mandatory, ParameterSetName = 'ByJobFile')]
    [ValidateNotNullOrEmpty()]
    [string]$JobFile,

    [Parameter(Mandatory, ParameterSetName = 'ByDirect')]
    [ValidateNotNullOrEmpty()]
    [string]$TenantId,

    [Parameter(Mandatory, ParameterSetName = 'ByDirect')]
    [ValidateNotNullOrEmpty()]
    [string]$GroupId,

    [Parameter()]
    [ValidateSet('members', 'owners')]
    [string]$Role = 'members',

    [Parameter(Mandatory, ParameterSetName = 'ByDirect')]
    [ValidateSet('add', 'remove')]
    [string]$Operation,

    [Parameter(Mandatory, ParameterSetName = 'ByDirect')]
    [array]$Users,

    [Parameter()]
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Invoke-GroupMembershipBulk.ps1')

if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
    $job = Read-GroupMembershipBulkJob -Path $JobFile
    $TenantId  = $job['TenantId']
    $GroupId   = $job['GroupId']
    $Role      = $job['Role']
    $Operation = $job['Operation']
    $Users     = $job['Users']
    $DryRun    = [bool]$job['DryRun']
}

$invokeParams = @{
    TenantId  = $TenantId
    GroupId   = $GroupId
    Role      = $Role
    Operation = $Operation
    Users     = $Users
    DryRun    = [bool]$DryRun
}

$result = Invoke-GroupMembershipBulk @invokeParams
$result | ConvertTo-Json -Depth 6 -Compress
