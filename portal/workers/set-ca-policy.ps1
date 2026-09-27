<#
.SYNOPSIS
    Worker entrypoint for EPIC-015 Conditional Access CRUD operations.
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile (or parameters directly),
    executes or previews policy create/edit/delete, and emits JSON on stdout.
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

    [Parameter(Mandatory, ParameterSetName = 'ByParams')]
    [ValidateSet('create', 'edit', 'delete')]
    [string]$Action,

    [Parameter(ParameterSetName = 'ByParams')]
    [string]$PolicyId = '',

    [Parameter(ParameterSetName = 'ByParams')]
    [string]$DisplayName = '',

    [Parameter(ParameterSetName = 'ByParams')]
    [string]$State = '',

    [Parameter(ParameterSetName = 'ByParams')]
    [string]$PolicyJson = '',

    [Parameter(ParameterSetName = 'ByParams')]
    [string]$ConditionsJson = '',

    [Parameter(ParameterSetName = 'ByParams')]
    [string]$GrantControlsJson = '',

    [Parameter(ParameterSetName = 'ByParams')]
    [string]$SessionControlsJson = '',

    [Parameter(ParameterSetName = 'ByParams')]
    [string]$ConfirmName = '',

    [Parameter(ParameterSetName = 'ByParams')]
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Set-CaPolicy.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Connect-WorkerTenant.ps1')

# Sign in to the job's tenant (T-0826). Direct-parameter runs manage their own session.
$tenantSession = $null
if ($JobFile) {
    $tenantSession = Connect-WorkerTenant -JobFile $JobFile -Service Graph
}
try {
    if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
        $job = Read-SetCaPolicyJob -Path $JobFile
        $TenantId            = $job['TenantId']
        $Action              = $job['Action']
        $PolicyId            = $job['PolicyId']
        $DisplayName         = $job['DisplayName']
        $State               = $job['State']
        $PolicyJson          = $job['PolicyJson']
        $ConditionsJson      = $job['ConditionsJson']
        $GrantControlsJson   = $job['GrantControlsJson']
        $SessionControlsJson = $job['SessionControlsJson']
        $ConfirmName         = $job['ConfirmName']
        $DryRun              = [bool]$job['DryRun']
    }

    $invokeParams = @{
        TenantId            = $TenantId
        Action              = $Action
        PolicyId            = $PolicyId
        DisplayName         = $DisplayName
        State               = $State
        PolicyJson          = $PolicyJson
        ConditionsJson      = $ConditionsJson
        GrantControlsJson   = $GrantControlsJson
        SessionControlsJson = $SessionControlsJson
        ConfirmName         = $ConfirmName
        DryRun              = [bool]$DryRun
    }

    $result = Invoke-SetCaPolicy @invokeParams
    $result | ConvertTo-Json -Depth 10 -Compress
}
finally {
    Disconnect-WorkerTenant -Session $tenantSession
}
