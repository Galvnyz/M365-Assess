<#
.SYNOPSIS
    Worker entrypoint for EPIC-015 Conditional Access Coverage evaluation.
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile (or parameters directly),
    evaluates user and app coverage gaps, and emits JSON on stdout.
.PARAMETER JobFile
    Path to the job envelope JSON written by the supervisor.
#>
[CmdletBinding(DefaultParameterSetName = 'ByJobFile')]
param(
    [Parameter(Mandatory, ParameterSetName = 'ByJobFile')]
    [ValidateNotNullOrEmpty()]
    [string]$JobFile,

    [Parameter(Mandatory, ParameterSetName = 'ByParams')]
    [ValidateNotNullOrEmpty()]
    [string]$TenantId
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Get-CaCoverage.ps1')

if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
    $job = Read-CaCoverageJob -Path $JobFile
    $TenantId = $job['TenantId']
}

$result = Get-CaCoverage -TenantId $TenantId
$result | ConvertTo-Json -Depth 10 -Compress
