<#
.SYNOPSIS
    Worker entrypoint for EPIC-016 assignment filters (T-0309).
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile and runs one assignment filter action
    (list, create, edit, delete, plan, deploy) against the connected tenant, emitting
    JSON on stdout.
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

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Set-AssignmentFilter.ps1')

$job = Read-SetAssignmentFilterJob -Path $JobFile
$filterParams = @{
    TenantId    = $job['TenantId']
    Action      = $job['Action']
    FilterId    = $job['FilterId']
    FilterJson  = $job['FilterJson']
    ConfirmName = $job['ConfirmName']
    Actor       = $job['Actor']
}
Invoke-SetAssignmentFilter @filterParams | ConvertTo-Json -Depth 10 -Compress
