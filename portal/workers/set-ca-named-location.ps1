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

if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
    $job = Read-SetCaNamedLocationJob -Path $JobFile
    $TenantId                          = $job['TenantId']
    $Action                            = $job['Action']
    $LocationId                        = $job['LocationId']
    $DisplayName                       = $job['DisplayName']
    $LocationType                      = $job['LocationType']
    $IpRanges                          = $job['IpRanges']
    $IsTrusted                         = [bool]$job['IsTrusted']
    $CountriesAndRegions               = $job['CountriesAndRegions']
    $IncludeUnknownCountriesAndRegions = [bool]$job['IncludeUnknownCountriesAndRegions']
    $CountryLookupMethod               = $job['CountryLookupMethod']
    $ConfirmName                       = $job['ConfirmName']
    $DryRun                            = [bool]$job['DryRun']
}

$invokeParams = @{
    TenantId                          = $TenantId
    Action                            = $Action
    LocationId                        = $LocationId
    DisplayName                       = $DisplayName
    LocationType                      = $LocationType
    IpRanges                          = $IpRanges
    IsTrusted                         = [bool]$IsTrusted
    CountriesAndRegions               = $CountriesAndRegions
    IncludeUnknownCountriesAndRegions = [bool]$IncludeUnknownCountriesAndRegions
    CountryLookupMethod               = $CountryLookupMethod
    ConfirmName                       = $ConfirmName
    DryRun                            = [bool]$DryRun
}

$result = Invoke-SetCaNamedLocation @invokeParams
$result | ConvertTo-Json -Depth 10 -Compress
