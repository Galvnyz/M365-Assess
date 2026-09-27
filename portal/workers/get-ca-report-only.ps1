<#
.SYNOPSIS
    Worker entrypoint for EPIC-015 Conditional Access Report-Only evaluation.
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile (or parameters directly),
    evaluates report-only policies against live sign-in signals, and emits JSON on stdout.
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
    [string]$TenantId,

    [Parameter(ParameterSetName = 'ByParams')]
    [string]$PolicyId = '',

    [Parameter(ParameterSetName = 'ByParams')]
    [int]$Top = 100
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Get-CaReportOnly.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Connect-WorkerTenant.ps1')

# Sign in to the job's tenant (T-0826). Direct-parameter runs manage their own session.
$tenantSession = $null
if ($JobFile) {
    $tenantSession = Connect-WorkerTenant -JobFile $JobFile -Service Graph
}
try {
    if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
        $job = Read-CaReportOnlyJob -Path $JobFile
        $TenantId = $job['TenantId']
        $PolicyId = $job['PolicyId']
        $Top      = [int]$job['Top']
    }

    $invokeParams = @{
        TenantId = $TenantId
        PolicyId = $PolicyId
        Top      = $Top
    }

    $result = Get-CaReportOnly @invokeParams
    $result | ConvertTo-Json -Depth 10 -Compress
}
finally {
    Disconnect-WorkerTenant -Session $tenantSession
}
