<#
.SYNOPSIS
    Worker entrypoint for the EPIC-012 registration campaign toggle.
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile (or direct parameters),
    configures the registration campaign via Invoke-RegistrationCampaignSet,
    and emits the JSON result on stdout.
.PARAMETER JobFile
    Path to the job envelope JSON.
.PARAMETER TenantId
    Direct tenant id.
.PARAMETER State
    'enabled' or 'disabled'.
.PARAMETER SnoozeDurationInDays
    Integer between 1 and 14.
.PARAMETER IncludeTargets
    Array of group IDs to include.
.PARAMETER ExcludeTargets
    Array of group IDs to exclude.
.PARAMETER Confirmed
    Explicit confirmation for applying campaign changes.
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
    [ValidateSet('enabled', 'disabled')]
    [string]$State,

    [Parameter(ParameterSetName = 'ByTenant')]
    [ValidateRange(1, 14)]
    [int]$SnoozeDurationInDays = 1,

    [Parameter(ParameterSetName = 'ByTenant')]
    [string[]]$IncludeTargets = @(),

    [Parameter(ParameterSetName = 'ByTenant')]
    [string[]]$ExcludeTargets = @(),

    [Parameter()]
    [switch]$Confirmed
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Set-RegistrationCampaign.ps1')

if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
    $job = Read-RegistrationCampaignJob -Path $JobFile
    $TenantId = $job['TenantId']
    $State = $job['State']
    $SnoozeDurationInDays = $job['SnoozeDurationInDays']
    $IncludeTargets = $job['IncludeTargets']
    $ExcludeTargets = $job['ExcludeTargets']
    if (-not $PSBoundParameters.ContainsKey('Confirmed') -and $job['Confirmed']) {
        $Confirmed = [switch]$true
    }
}

$invokeParams = @{
    TenantId             = $TenantId
    State                = $State
    SnoozeDurationInDays = $SnoozeDurationInDays
    IncludeTargets       = $IncludeTargets
    ExcludeTargets       = $ExcludeTargets
}
if ($Confirmed) {
    $invokeParams['Confirmed'] = $true
}

$result = Invoke-RegistrationCampaignSet @invokeParams
$result | ConvertTo-Json -Depth 6 -Compress
