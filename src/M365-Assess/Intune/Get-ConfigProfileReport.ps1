<#
.SYNOPSIS
    Lists all Intune device configuration profiles with platform and metadata.
.DESCRIPTION
    Queries Microsoft Graph for all device configuration profiles in Intune and
    returns key details including display name, platform, creation and modification
    dates, and version. The platform is derived from the @odata.type property of
    each profile. Useful for configuration drift reviews, tenant documentation,
    and security baseline audits for clients.

    Requires Microsoft.Graph.DeviceManagement module and
    DeviceManagementConfiguration.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph -Scopes 'DeviceManagementConfiguration.Read.All'
    PS> .\Intune\Get-ConfigProfileReport.ps1

    Lists all device configuration profiles with their platform and metadata.
.EXAMPLE
    PS> .\Intune\Get-ConfigProfileReport.ps1 -OutputPath '.\config-profiles.csv'

    Exports all configuration profiles to CSV for client documentation.
.EXAMPLE
    PS> .\Intune\Get-ConfigProfileReport.ps1 -Verbose

    Lists all configuration profiles with verbose progress messages.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

# Verify Graph connection
if (-not (Assert-GraphConnection)) { return }

# Ensure required Graph submodule is loaded (PS 7.x does not auto-import)
Import-Module -Name Microsoft.Graph.DeviceManagement -ErrorAction Stop

# Map @odata.type to friendly platform names
$platformMap = @{
    '#microsoft.graph.windows10GeneralConfiguration'         = 'Windows 10'
    '#microsoft.graph.windows10CustomConfiguration'          = 'Windows 10 (Custom)'
    '#microsoft.graph.windows10EndpointProtectionConfiguration' = 'Windows 10 (Endpoint Protection)'
    '#microsoft.graph.windowsUpdateForBusinessConfiguration' = 'Windows Update for Business'
    '#microsoft.graph.windows81GeneralConfiguration'         = 'Windows 8.1'
    '#microsoft.graph.windowsPhone81GeneralConfiguration'    = 'Windows Phone 8.1'
    '#microsoft.graph.iosGeneralDeviceConfiguration'         = 'iOS'
    '#microsoft.graph.iosCustomConfiguration'                = 'iOS (Custom)'
    '#microsoft.graph.androidGeneralDeviceConfiguration'     = 'Android'
    '#microsoft.graph.androidCustomConfiguration'            = 'Android (Custom)'
    '#microsoft.graph.androidWorkProfileGeneralDeviceConfiguration' = 'Android Work Profile'
    '#microsoft.graph.macOSGeneralDeviceConfiguration'       = 'macOS'
    '#microsoft.graph.macOSCustomConfiguration'              = 'macOS (Custom)'
    '#microsoft.graph.editionUpgradeConfiguration'           = 'Windows Edition Upgrade'
    '#microsoft.graph.sharedPCConfiguration'                 = 'Windows Shared PC'
    '#microsoft.graph.windowsDefenderAdvancedThreatProtectionConfiguration' = 'Windows Defender ATP'
}

Write-Verbose "Retrieving all Intune device configuration profiles..."

try {
    $profiles = Get-MgDeviceManagementDeviceConfiguration -All -ErrorAction Stop
}
catch {
    Write-Warning "Could not retrieve Intune configuration profiles. Ensure Intune is licensed and permissions are granted: $($_.Exception.Message)"
    return
}

if (-not $profiles -or $profiles.Count -eq 0) {
    Write-Warning "No configuration profiles found. Intune may not be configured or no profiles have been created."
    Write-Output @()
    return
}

Write-Verbose "Processing $($profiles.Count) configuration profiles..."

$results = foreach ($configProfile in $profiles) {
    $odataType = $configProfile.AdditionalProperties.'@odata.type'
    $platform = $platformMap[$odataType]
    if (-not $platform) {
        $platform = $odataType
    }

    [PSCustomObject]@{
        DisplayName          = $configProfile.DisplayName
        Id                   = $configProfile.Id
        CreatedDateTime      = $configProfile.CreatedDateTime
        LastModifiedDateTime = $configProfile.LastModifiedDateTime
        Platform             = $platform
        Version              = $configProfile.Version
        Description          = $configProfile.Description
    }
}

$results = @($results) | Sort-Object -Property DisplayName

Write-Verbose "Total configuration profiles: $($results.Count)"

if ($OutputPath) {
    $results | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported $($results.Count) configuration profiles to $OutputPath"
}
else {
    Write-Output $results
}
