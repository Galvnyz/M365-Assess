<#
.SYNOPSIS
    Worker entrypoint for EPIC-014 group usage report (T-0270).
.DESCRIPTION
    Reads a job envelope from -JobFile (or parameters directly), queries
    group metrics live via Get-GroupUsage, and outputs the report JSON to stdout.
    The worker is strictly read-only.
.PARAMETER JobFile
    Path to the job envelope JSON written by the supervisor.
.PARAMETER TenantId
    Direct tenant id.
.PARAMETER InactiveDaysThreshold
    Configurable window in days to consider a group inactive (default 90).
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
    [int]$InactiveDaysThreshold = 90
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Get-GroupUsage.ps1')

if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
    $job = Read-GroupUsageJob -Path $JobFile
    $TenantId = $job['TenantId']
    if ($job.ContainsKey('InactiveDaysThreshold') -and -not $PSBoundParameters.ContainsKey('InactiveDaysThreshold')) {
        $InactiveDaysThreshold = $job['InactiveDaysThreshold']
    }
}

$report = Get-GroupUsage -TenantId $TenantId -InactiveDaysThreshold $InactiveDaysThreshold
$report | ConvertTo-Json -Depth 6 -Compress
