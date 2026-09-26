<#
.SYNOPSIS
    Worker entrypoint for EPIC-015 Conditional Access policies read.
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile (or parameters directly),
    queries policies live from Graph via Get-CaPolicies, and emits the filtered
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
    [string]$State = '',

    [Parameter()]
    [string]$Target = '',

    [Parameter()]
    [string]$Control = '',

    [Parameter()]
    [string]$Condition = '',

    [Parameter()]
    [string]$ModifiedDate = '',

    [Parameter()]
    [string]$Search = '',

    [Parameter()]
    [ValidateRange(1, 1000)]
    [int]$Top = 100,

    [Parameter()]
    [string]$Cursor = ''
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Get-CaPolicies.ps1')

if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
    $job = Read-CaPoliciesJob -Path $JobFile
    $TenantId = $job['TenantId']
    foreach ($name in @('State', 'Target', 'Control', 'Condition', 'ModifiedDate', 'Search', 'Top', 'Cursor')) {
        if (-not $PSBoundParameters.ContainsKey($name) -and $job.ContainsKey($name)) {
            Set-Variable -Name $name -Value $job[$name]
        }
    }
}

$invokeParams = @{
    TenantId     = $TenantId
    State        = $State
    Target       = $Target
    Control      = $Control
    Condition    = $Condition
    ModifiedDate = $ModifiedDate
    Search       = $Search
    Top          = $Top
    Cursor       = $Cursor
}

$result = Get-CaPolicies @invokeParams
$result | ConvertTo-Json -Depth 6 -Compress
