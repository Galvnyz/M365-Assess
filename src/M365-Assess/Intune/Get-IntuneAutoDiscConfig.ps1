<#
.SYNOPSIS
    Evaluates whether automatic device enrollment and discovery is configured
    in Intune for automated inventory management.
.DESCRIPTION
    Checks whether MDM auto-enrollment configurations and Windows Autopilot
    deployment profiles exist. Emits one row per deviceEnrollmentWindowsAutoEnrollment
    configuration and one row per Autopilot deployment profile. If neither is found,
    a Warning row is emitted indicating manual enrollment or alternate MDM scope.

    Requires an active Microsoft Graph connection with
    DeviceManagementConfiguration.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> .\Intune\Get-IntuneAutoDiscConfig.ps1

    Displays per-configuration automatic discovery evaluation results.
.EXAMPLE
    PS> .\Intune\Get-IntuneAutoDiscConfig.ps1 -OutputPath '.\intune-autodisc.csv'

    Exports the per-configuration evaluation to CSV.
.NOTES
    Author:  Daren9m
    CMMC:    CM.L3-3.4.3E — Employ Automated Discovery and Management Tools
#>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

$_scriptDir = if ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { $PSScriptRoot }
. (Join-Path -Path $_scriptDir -ChildPath '..\Common\SecurityConfigHelper.ps1')

$ctx = Initialize-SecurityConfig
$settings = $ctx.Settings


$remediationText = 'Configure Intune automatic enrollment: Entra admin center > Mobility (MDM and WIP) > Microsoft Intune > MDM user scope: All or Some. Consider configuring Windows Autopilot for zero-touch provisioning.'

# ------------------------------------------------------------------
# 1. Emit one row per enrollment config + one row per Autopilot profile
# ------------------------------------------------------------------
try {
    Write-Verbose 'Checking Intune device enrollment configurations for auto-enrollment...'
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/beta/deviceManagement/deviceEnrollmentConfigurations'
        ErrorAction = 'Stop'
    }
    $enrollConfigs = Invoke-MgGraphRequest @graphParams

    $configList = @()
    if ($enrollConfigs -and $enrollConfigs['value']) {
        $configList = @($enrollConfigs['value'])
    }

    $matchCount = 0

    foreach ($config in $configList) {
        $odataType   = $config['@odata.type']
        $displayName = $config['displayName']

        if ($odataType -match 'deviceEnrollmentWindowsAutoEnrollment') {
            $matchCount++
            $settingParams = @{
                Category         = 'Automated Discovery'
                Setting          = "MDM Auto-Enrollment — $displayName"
                CurrentValue     = 'MDM auto-enrollment configuration present'
                RecommendedValue = 'MDM auto-enrollment configured (scope: All or Some users)'
                Status           = 'Pass'
                CheckId          = 'INTUNE-AUTODISC-001'
                Remediation      = $remediationText
            }
            Add-Setting @settingParams
        }

        if ($odataType -match 'windowsAutopilot') {
            $matchCount++
            $settingParams = @{
                Category         = 'Automated Discovery'
                Setting          = "Autopilot Deployment Profile (enrollment) — $displayName"
                CurrentValue     = 'Autopilot profile configured via enrollment endpoint'
                RecommendedValue = 'Windows Autopilot deployment profile configured'
                Status           = 'Pass'
                CheckId          = 'INTUNE-AUTODISC-001'
                Remediation      = $remediationText
            }
            Add-Setting @settingParams
        }
    }

    # Also check dedicated Autopilot deployment profiles endpoint
    try {
        $autopilotParams = @{
            Method      = 'GET'
            Uri         = '/beta/deviceManagement/windowsAutopilotDeploymentProfiles'
            ErrorAction = 'Stop'
        }
        $autopilotProfiles = Invoke-MgGraphRequest @autopilotParams

        if ($autopilotProfiles -and $autopilotProfiles['value']) {
            foreach ($apProfile in @($autopilotProfiles['value'])) {
                $matchCount++
                $profileName = $apProfile['displayName']
                $settingParams = @{
                    Category         = 'Automated Discovery'
                    Setting          = "Autopilot Deployment Profile — $profileName"
                    CurrentValue     = 'Autopilot deployment profile configured'
                    RecommendedValue = 'Windows Autopilot deployment profile configured'
                    Status           = 'Pass'
                    CheckId          = 'INTUNE-AUTODISC-001'
                    Remediation      = $remediationText
                }
                Add-Setting @settingParams
            }
        }
    }
    catch {
        Write-Verbose "Could not query Autopilot profiles: $_"
    }

    if ($matchCount -eq 0) {
        $settingParams = @{
            Category         = 'Automated Discovery'
            Setting          = 'Automatic Device Enrollment and Discovery'
            CurrentValue     = 'No MDM auto-enrollment or Autopilot profile detected — manual enrollment or alternate MDM scope may be in use'
            RecommendedValue = 'MDM auto-enrollment configured (scope: All or Some users)'
            Status           = 'Warning'
            CheckId          = 'INTUNE-AUTODISC-001'
            Remediation      = $remediationText
        }
        Add-Setting @settingParams
    }
}
catch {
    if ($_.Exception.Message -match '403|Forbidden|Authorization') {
        $settingParams = @{
            Category         = 'Automated Discovery'
            Setting          = 'Automatic Device Enrollment and Discovery'
            CurrentValue     = 'Insufficient permissions or license (Intune required)'
            RecommendedValue = 'MDM auto-enrollment configured (scope: All or Some users)'
            Status           = 'Review'
            CheckId          = 'INTUNE-AUTODISC-001'
            Remediation      = 'Requires DeviceManagementConfiguration.Read.All permission and Intune license.'
        }
        Add-Setting @settingParams
    }
    else {
        Write-Warning "Could not check auto-enrollment configuration: $_"
    }
}

# ------------------------------------------------------------------
# Output results
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'Intune Auto Discovery'
