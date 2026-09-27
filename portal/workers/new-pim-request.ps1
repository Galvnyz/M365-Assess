<#
.SYNOPSIS
    Worker entrypoint for EPIC-013 PIM role change requests.
.DESCRIPTION
    Reads a job envelope from -JobFile (or direct parameters), submits the
    role schedule request via New-PimRequest, and emits the request record
    as JSON on stdout.
.PARAMETER JobFile
    Path to the job envelope JSON written by the supervisor.
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
    [string]$PrincipalId,

    [Parameter(Mandatory, ParameterSetName = 'ByTenant')]
    [ValidateNotNullOrEmpty()]
    [string]$RoleId,

    [Parameter(ParameterSetName = 'ByTenant')]
    [ValidateSet('activate', 'extend', 'assign', 'deactivate')]
    [string]$Action = 'activate',

    [Parameter(ParameterSetName = 'ByTenant')]
    [string]$Justification = '',

    [Parameter(ParameterSetName = 'ByTenant')]
    [ValidateRange(1, 24)]
    [int]$DurationHours = 8,

    [Parameter(ParameterSetName = 'ByTenant')]
    [switch]$ApprovalRequired,

    [Parameter(ParameterSetName = 'ByTenant')]
    [string]$TicketNumber = ''
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/New-PimRequest.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Connect-WorkerTenant.ps1')

# Sign in to the job's tenant (T-0826). Direct-parameter runs manage their own session.
$tenantSession = $null
if ($JobFile) {
    $tenantSession = Connect-WorkerTenant -JobFile $JobFile -Service Graph
}
try {
    if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
        $job = Read-PimRequestJob -Path $JobFile
        $TenantId = $job['TenantId']
        $PrincipalId = $job['PrincipalId']
        $RoleId = $job['RoleId']
        $Action = $job['Action']
        $Justification = $job['Justification']
        $DurationHours = $job['DurationHours']
        $ApprovalRequired = [switch]$job['ApprovalRequired']
        $TicketNumber = [string]$job['TicketNumber']
    }

    $invokeParams = @{
        TenantId         = $TenantId
        PrincipalId      = $PrincipalId
        RoleId           = $RoleId
        Action           = $Action
        Justification    = $Justification
        DurationHours    = $DurationHours
        ApprovalRequired = $ApprovalRequired
        TicketNumber     = $TicketNumber
    }

    $result = New-PimRequest @invokeParams
    $result | ConvertTo-Json -Depth 6 -Compress
}
finally {
    Disconnect-WorkerTenant -Session $tenantSession
}
