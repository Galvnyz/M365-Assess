<#
.SYNOPSIS
    Worker entrypoint for EPIC-015 Conditional Access Named Locations CRUD operations.
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile (or parameters directly),
    executes or previews named location create/edit/delete/list, and emits JSON on stdout.
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
    [ValidateSet('list', 'create', 'edit', 'delete')]
    [string]$Action,

    [Parameter(ParameterSetName = 'ByParams')]
    [string]$LocationId = '',

    [Parameter(ParameterSetName = 'ByParams')]
    [string]$DisplayName = '',

    [Parameter(ParameterSetName = 'ByParams')]
    [string]$LocationType = '',

    [Parameter(ParameterSetName = 'ByParams')]
    [string[]]$IpRanges = @(),

    [Parameter(ParameterSetName = 'ByParams')]
    [bool]$IsTrusted = $false,

    [Parameter(ParameterSetName = 'ByParams')]
    [string[]]$CountriesAndRegions = @(),

    [Parameter(ParameterSetName = 'ByParams')]
    [bool]$IncludeUnknownCountriesAndRegions = $false,

    [Parameter(ParameterSetName = 'ByParams')]
    [string]$CountryLookupMethod = 'clientIpAddress',

    [Parameter(ParameterSetName = 'ByParams')]
    [string]$ConfirmName = '',

    [Parameter(ParameterSetName = 'ByParams')]
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Set-CaNamedLocation.ps1')
. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Connect-WorkerTenant.ps1')

# Sign in to the job's tenant (T-0826). Direct-parameter runs manage their own session.
$tenantSession = $null
if ($JobFile) {
    $tenantSession = Connect-WorkerTenant -JobFile $JobFile -Service Graph
}
try {
    # isTrusted, includeUnknownCountriesAndRegions and countryLookupMethod are forwarded
    # only when given, so an edit that leaves them out keeps the location's values.
    $optional = @{}
    if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
        $job = Read-SetCaNamedLocationJob -Path $JobFile
        $TenantId            = $job['TenantId']
        $Action              = $job['Action']
        $LocationId          = $job['LocationId']
        $DisplayName         = $job['DisplayName']
        $LocationType        = $job['LocationType']
        $IpRanges            = $job['IpRanges']
        $CountriesAndRegions = $job['CountriesAndRegions']
        $ConfirmName         = $job['ConfirmName']
        $DryRun              = [bool]$job['DryRun']
        foreach ($name in @('IsTrusted', 'IncludeUnknownCountriesAndRegions', 'CountryLookupMethod')) {
            if ($job.ContainsKey($name)) {
                $optional[$name] = $job[$name]
            }
        }
    }
    else {
        foreach ($name in @('IsTrusted', 'IncludeUnknownCountriesAndRegions', 'CountryLookupMethod')) {
            if ($PSBoundParameters.ContainsKey($name)) {
                $optional[$name] = $PSBoundParameters[$name]
            }
        }
    }

    $invokeParams = @{
        TenantId            = $TenantId
        Action              = $Action
        LocationId          = $LocationId
        DisplayName         = $DisplayName
        LocationType        = $LocationType
        IpRanges            = $IpRanges
        CountriesAndRegions = $CountriesAndRegions
        ConfirmName         = $ConfirmName
        DryRun              = [bool]$DryRun
    }
    $invokeParams += $optional

    $result = Invoke-SetCaNamedLocation @invokeParams
    $result | ConvertTo-Json -Depth 10 -Compress
}
finally {
    Disconnect-WorkerTenant -Session $tenantSession
}
