<#
.SYNOPSIS
    Reports Intune managed device compliance status across the tenant.
.DESCRIPTION
    Queries Microsoft Graph for all Intune managed devices and reports their
    compliance state, platform, and key details. Useful for reviewing device
    posture, identifying noncompliant devices, and generating compliance
    reports for clients.

    Requires Microsoft.Graph.DeviceManagement module and DeviceManagementManagedDevices.Read.All permission.
.PARAMETER ComplianceState
    Filter results by compliance state. Valid values: All, Compliant, NonCompliant, Unknown.
    Defaults to All.
.PARAMETER Platform
    Filter results by device platform. Valid values: All, Windows, iOS, Android, macOS.
    Defaults to All.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph -Scopes 'DeviceManagementManagedDevices.Read.All'
    PS> .\Intune\Get-DeviceComplianceReport.ps1

    Lists all managed devices with their compliance status.
.EXAMPLE
    PS> .\Intune\Get-DeviceComplianceReport.ps1 -ComplianceState NonCompliant -Platform Windows

    Shows only noncompliant Windows devices.
.EXAMPLE
    PS> .\Intune\Get-DeviceComplianceReport.ps1 -OutputPath '.\compliance-report.csv'

    Exports full compliance report to CSV.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateSet('All', 'Compliant', 'NonCompliant', 'Unknown')]
    [string]$ComplianceState = 'All',

    [Parameter()]
    [ValidateSet('All', 'Windows', 'iOS', 'Android', 'macOS')]
    [string]$Platform = 'All',

    [Parameter()]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

# Verify Graph connection
if (-not (Assert-GraphConnection)) { return }

# Map platform filter to Graph operatingSystem values
$platformMap = @{
    'Windows' = 'Windows'
    'iOS'     = 'iOS'
    'Android' = 'Android'
    'macOS'   = 'macOS'
}

Write-Verbose "Retrieving managed devices..."

try {
    $devices = Get-MgDeviceManagementManagedDevice -All
}
catch {
    Write-Error "Failed to retrieve managed devices: $_"
    return
}

# Apply platform filter
if ($Platform -ne 'All') {
    $targetOS = $platformMap[$Platform]
    $devices = $devices | Where-Object { $_.OperatingSystem -eq $targetOS }
    Write-Verbose "Filtered to platform: $Platform ($($devices.Count) devices)"
}

# Apply compliance state filter
if ($ComplianceState -ne 'All') {
    $stateFilter = switch ($ComplianceState) {
        'Compliant'    { 'compliant' }
        'NonCompliant' { 'noncompliant' }
        'Unknown'      { 'unknown' }
    }
    $devices = $devices | Where-Object { $_.ComplianceState -eq $stateFilter }
    Write-Verbose "Filtered to compliance state: $ComplianceState ($($devices.Count) devices)"
}

$results = foreach ($device in $devices) {
    [PSCustomObject]@{
        DeviceName        = $device.DeviceName
        UserDisplayName   = $device.UserDisplayName
        UserPrincipalName = $device.UserPrincipalName
        OperatingSystem   = $device.OperatingSystem
        OSVersion         = $device.OsVersion
        ComplianceState   = $device.ComplianceState
        IsEncrypted       = $device.IsEncrypted
        LastSyncDateTime  = $device.LastSyncDateTime
        EnrolledDateTime  = $device.EnrolledDateTime
        Model             = $device.Model
        Manufacturer      = $device.Manufacturer
        SerialNumber      = $device.SerialNumber
        ManagementAgent   = $device.ManagementAgent
    }
}

$results = @($results) | Sort-Object -Property ComplianceState, DeviceName

# Summary output
$total = $results.Count
$compliant = ($results | Where-Object { $_.ComplianceState -eq 'compliant' }).Count
$nonCompliant = ($results | Where-Object { $_.ComplianceState -eq 'noncompliant' }).Count
Write-Verbose "Total: $total | Compliant: $compliant | NonCompliant: $nonCompliant | Other: $($total - $compliant - $nonCompliant)"

if ($OutputPath) {
    $results | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported $($results.Count) devices to $OutputPath"
}
else {
    Write-Output $results
}
