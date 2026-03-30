<#
.SYNOPSIS
    Lists all Intune managed devices with key properties.
.DESCRIPTION
    Queries Microsoft Graph for all Intune managed devices and returns a summary
    of each device including hardware details, compliance state, enrollment info,
    and management agent. Useful for inventory audits, onboarding reviews, and
    generating device fleet reports for clients.

    Requires Microsoft.Graph.DeviceManagement module and
    DeviceManagementManagedDevices.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph -Scopes 'DeviceManagementManagedDevices.Read.All'
    PS> .\Intune\Get-DeviceSummary.ps1

    Lists all managed devices with key properties including compliance state and hardware info.
.EXAMPLE
    PS> .\Intune\Get-DeviceSummary.ps1 -OutputPath '.\device-summary.csv'

    Exports the full device inventory to CSV for client reporting.
.EXAMPLE
    PS> .\Intune\Get-DeviceSummary.ps1 -Verbose

    Lists all managed devices with verbose progress messages.
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

Write-Verbose "Retrieving all Intune managed devices..."

try {
    $devices = Get-MgDeviceManagementManagedDevice -All -ErrorAction Stop
}
catch {
    Write-Warning "Could not retrieve Intune managed devices. Ensure Intune is licensed and permissions are granted: $($_.Exception.Message)"
    return
}

if (-not $devices -or $devices.Count -eq 0) {
    Write-Warning "No managed devices found. Intune may not be configured or no devices are enrolled."
    Write-Output @()
    return
}

Write-Verbose "Processing $($devices.Count) managed devices..."

$results = foreach ($device in $devices) {
    [PSCustomObject]@{
        DeviceName        = $device.DeviceName
        UserDisplayName   = $device.UserDisplayName
        UserPrincipalName = $device.UserPrincipalName
        OperatingSystem   = $device.OperatingSystem
        OsVersion         = $device.OsVersion
        ComplianceState   = $device.ComplianceState
        ManagementAgent   = $device.ManagementAgent
        EnrolledDateTime  = $device.EnrolledDateTime
        LastSyncDateTime  = $device.LastSyncDateTime
        Model             = $device.Model
        Manufacturer      = $device.Manufacturer
        SerialNumber      = $device.SerialNumber
    }
}

$results = @($results) | Sort-Object -Property DeviceName

Write-Verbose "Total devices: $($results.Count)"

if ($OutputPath) {
    $results | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported $($results.Count) devices to $OutputPath"
}
else {
    Write-Output $results
}
