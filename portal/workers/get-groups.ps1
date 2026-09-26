<#
.SYNOPSIS
    Worker entrypoint for EPIC-014 groups read.
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile (or parameters directly),
    queries groups live from Graph via Get-Groups, and emits the filtered
    cursor page as JSON on stdout. The worker is read-only.
.PARAMETER JobFile
    Path to the job envelope JSON written by the supervisor.
.PARAMETER TenantId
    Direct tenant id.
#>
[CmdletBinding(DefaultParameterSetName = 'ByJobFile')]
param(
    [Parameter(Mandatory, ParameterSetName = 'ByJobFile')]
    [ValidateNotNullOrEmpty()]
    [string]$JobFile,

    [Parameter(Mandatory, ParameterSetName = 'ByTenant')]
    [ValidateNotNullOrEmpty()]
    [string]$TenantId,

    [Parameter()]
    [ValidateSet('', 'm365', 'security', 'mailEnabledSecurity', 'distribution', 'dynamic')]
    [string]$Type = '',

    [Parameter()]
    [string]$Hidden = '',

    [Parameter()]
    [string]$Dynamic = '',

    [Parameter()]
    [string]$MembershipSize = '',

    [Parameter()]
    [string]$Search = '',

    [Parameter()]
    [ValidateRange(1, 1000)]
    [int]$Top = 100,

    [Parameter()]
    [string]$Cursor = ''
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Get-Groups.ps1')

if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
    $job = Read-GroupsJob -Path $JobFile
    $TenantId = $job['TenantId']
    foreach ($name in @('Type', 'Hidden', 'Dynamic', 'MembershipSize', 'Search', 'Top', 'Cursor')) {
        if (-not $PSBoundParameters.ContainsKey($name) -and $job.ContainsKey($name)) {
            Set-Variable -Name $name -Value $job[$name]
        }
    }
}

$invokeParams = @{
    TenantId       = $TenantId
    Type           = $Type
    Hidden         = $Hidden
    Dynamic        = $Dynamic
    MembershipSize = $MembershipSize
    Search         = $Search
    Top            = $Top
    Cursor         = $Cursor
}

$result = Get-Groups @invokeParams
$result | ConvertTo-Json -Depth 6 -Compress
