<#
.SYNOPSIS
    Worker entrypoint for EPIC-014 GAL and delivery management via EXO.
.DESCRIPTION
    Reads a T-0007 job envelope from -JobFile (or parameters directly),
    applies GAL or delivery management changes via Invoke-SetGroupGalDelivery,
    and emits JSON envelope on stdout.
#>
[CmdletBinding(DefaultParameterSetName = 'ByJobFile')]
param(
    [Parameter(Mandatory, ParameterSetName = 'ByJobFile')]
    [ValidateNotNullOrEmpty()]
    [string]$JobFile,

    [Parameter(Mandatory, ParameterSetName = 'ByDirect')]
    [ValidateNotNullOrEmpty()]
    [string]$TenantId,

    [Parameter(Mandatory, ParameterSetName = 'ByDirect')]
    [ValidateNotNullOrEmpty()]
    [string]$GroupId,

    [Parameter(Mandatory, ParameterSetName = 'ByDirect')]
    [ValidateSet('gal', 'delivery')]
    [string]$Target,

    [Parameter()]
    [bool]$HiddenFromAddressListsEnabled = $false,

    [Parameter()]
    [bool]$RequireSenderAuthenticationEnabled = $false,

    [Parameter()]
    [array]$GrantSendOnBehalfTo = @(),

    [Parameter()]
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

. (Join-Path -Path $PSScriptRoot -ChildPath 'M365Portal.Workers/Set-GroupGalDelivery.ps1')

if ($PSCmdlet.ParameterSetName -eq 'ByJobFile') {
    $job = Read-SetGroupGalDeliveryJob -Path $JobFile
    $TenantId                           = $job['TenantId']
    $GroupId                            = $job['GroupId']
    $Target                             = $job['Target']
    $HiddenFromAddressListsEnabled      = [bool]$job['HiddenFromAddressListsEnabled']
    $RequireSenderAuthenticationEnabled = [bool]$job['RequireSenderAuthenticationEnabled']
    $GrantSendOnBehalfTo                = $job['GrantSendOnBehalfTo']
    $DryRun                             = [bool]$job['DryRun']
}

$invokeParams = @{
    TenantId                           = $TenantId
    GroupId                            = $GroupId
    Target                             = $Target
    HiddenFromAddressListsEnabled      = $HiddenFromAddressListsEnabled
    RequireSenderAuthenticationEnabled = $RequireSenderAuthenticationEnabled
    GrantSendOnBehalfTo                = $GrantSendOnBehalfTo
    DryRun                             = [bool]$DryRun
}

$result = Invoke-SetGroupGalDelivery @invokeParams
$result | ConvertTo-Json -Depth 6 -Compress
