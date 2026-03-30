<#
.SYNOPSIS
    Lists all Intune device compliance policies with platform and configuration details.
.DESCRIPTION
    Queries Microsoft Graph for all device compliance policies configured in Intune
    and returns key metadata including display name, platform, creation and modification
    dates, and version. The platform is derived from the @odata.type property of each
    policy. Useful for compliance posture reviews, policy audits, and documenting
    tenant configurations for clients.

    Requires Microsoft.Graph.DeviceManagement module and
    DeviceManagementConfiguration.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph -Scopes 'DeviceManagementConfiguration.Read.All'
    PS> .\Intune\Get-CompliancePolicyReport.ps1

    Lists all device compliance policies with their platform and metadata.
.EXAMPLE
    PS> .\Intune\Get-CompliancePolicyReport.ps1 -OutputPath '.\compliance-policies.csv'

    Exports all compliance policies to CSV for client documentation.
.EXAMPLE
    PS> .\Intune\Get-CompliancePolicyReport.ps1 -Verbose

    Lists all compliance policies with verbose progress messages.
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
    '#microsoft.graph.windows10CompliancePolicy'           = 'Windows 10'
    '#microsoft.graph.windows81CompliancePolicy'           = 'Windows 8.1'
    '#microsoft.graph.windowsPhone81CompliancePolicy'      = 'Windows Phone 8.1'
    '#microsoft.graph.iosCompliancePolicy'                 = 'iOS'
    '#microsoft.graph.androidCompliancePolicy'             = 'Android'
    '#microsoft.graph.androidWorkProfileCompliancePolicy'  = 'Android Work Profile'
    '#microsoft.graph.androidForWorkCompliancePolicy'      = 'Android for Work'
    '#microsoft.graph.macOSCompliancePolicy'               = 'macOS'
}

Write-Verbose "Retrieving all Intune device compliance policies..."

try {
    $policies = Get-MgDeviceManagementDeviceCompliancePolicy -All -ErrorAction Stop
}
catch {
    Write-Warning "Could not retrieve Intune compliance policies. Ensure Intune is licensed and permissions are granted: $($_.Exception.Message)"
    return
}

if (-not $policies -or $policies.Count -eq 0) {
    Write-Warning "No compliance policies found. Intune may not be configured or no policies have been created."
    Write-Output @()
    return
}

Write-Verbose "Processing $($policies.Count) compliance policies..."

$results = foreach ($policy in $policies) {
    $odataType = if ($policy.AdditionalProperties) { $policy.AdditionalProperties['@odata.type'] } else { $null }
    $platform = if ($odataType) { $platformMap[$odataType] } else { $null }
    if (-not $platform) {
        $platform = if ($odataType) { $odataType } else { 'Unknown' }
    }

    [PSCustomObject]@{
        DisplayName          = $policy.DisplayName
        Id                   = $policy.Id
        CreatedDateTime      = $policy.CreatedDateTime
        LastModifiedDateTime = $policy.LastModifiedDateTime
        Platform             = $platform
        Version              = $policy.Version
        Description          = $policy.Description
    }
}

$results = @($results) | Sort-Object -Property DisplayName

Write-Verbose "Total compliance policies: $($results.Count)"

if ($OutputPath) {
    $results | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported $($results.Count) compliance policies to $OutputPath"
}
else {
    Write-Output $results
}
