<#
.SYNOPSIS
    Evaluates whether application control policies (WDAC/AppLocker) are deployed
    via Intune to restrict unauthorized software.
.DESCRIPTION
    Queries Intune device configuration profiles and emits one result row per
    profile that contains WDAC/AppLocker settings — either via
    appLockerApplicationControl on endpoint protection profiles, or via matching
    OMA-URI on custom configuration profiles. If no application control policies
    are found, a Fail row is emitted.

    Requires an active Microsoft Graph connection with
    DeviceManagementConfiguration.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> .\Intune\Get-IntuneAppControlConfig.ps1

    Displays per-profile application control evaluation results.
.EXAMPLE
    PS> .\Intune\Get-IntuneAppControlConfig.ps1 -OutputPath '.\intune-appcontrol.csv'

    Exports the per-profile evaluation to CSV.
.NOTES
    Author:  Daren9m
    CMMC:    CM.L2-3.4.7 — Restrict, Disable, or Prevent the Use of Nonessential Programs
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


$remediationText = 'Intune admin center > Devices > Configuration > Create profile > Endpoint protection > Windows Defender Application Control. Alternatively, deploy WDAC via custom OMA-URI.'

# ------------------------------------------------------------------
# 1. Emit one row per profile with WDAC/AppLocker settings
# ------------------------------------------------------------------
try {
    Write-Verbose 'Checking Intune device configurations for application control policies...'
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/beta/deviceManagement/deviceConfigurations'
        ErrorAction = 'Stop'
    }
    $configs = Invoke-MgGraphRequest @graphParams

    $configList = @()
    if ($configs -and $configs['value']) {
        $configList = @($configs['value'])
    }

    $matchCount = 0

    foreach ($config in $configList) {
        $odataType   = $config['@odata.type']
        $displayName = $config['displayName']

        if ($odataType -match 'windows10EndpointProtectionConfiguration') {
            $appLocker = $config['appLockerApplicationControl']
            if ($null -ne $appLocker -and $appLocker -ne 'notConfigured') {
                $matchCount++
                $settingParams = @{
                    Category         = 'Application Control'
                    Setting          = "WDAC/AppLocker Policy — $displayName"
                    CurrentValue     = "AppLocker mode: $appLocker"
                    RecommendedValue = 'appLockerApplicationControl configured (not notConfigured)'
                    Status           = 'Pass'
                    CheckId          = 'INTUNE-APPCONTROL-001'
                    Remediation      = $remediationText
                }
                Add-Setting @settingParams
            }
        }

        if ($odataType -match 'windows10CustomConfiguration') {
            $omaSettings = $config['omaSettings']
            if ($omaSettings) {
                foreach ($setting in @($omaSettings)) {
                    $omaUri = $setting['omaUri']
                    if ($omaUri -match 'ApplicationControl|AppLocker|CodeIntegrity') {
                        $matchCount++
                        $settingParams = @{
                            Category         = 'Application Control'
                            Setting          = "WDAC/AppLocker OMA-URI — $displayName"
                            CurrentValue     = "OMA-URI: $omaUri"
                            RecommendedValue = 'OMA-URI matching ApplicationControl, AppLocker, or CodeIntegrity'
                            Status           = 'Pass'
                            CheckId          = 'INTUNE-APPCONTROL-001'
                            Remediation      = $remediationText
                        }
                        Add-Setting @settingParams
                        break
                    }
                }
            }
        }
    }

    if ($matchCount -eq 0) {
        $settingParams = @{
            Category         = 'Application Control'
            Setting          = 'WDAC or AppLocker Policy Deployed'
            CurrentValue     = 'No application control policies found'
            RecommendedValue = 'WDAC or AppLocker policy deployed via Intune'
            Status           = 'Fail'
            CheckId          = 'INTUNE-APPCONTROL-001'
            Remediation      = $remediationText
        }
        Add-Setting @settingParams
    }
}
catch {
    if ($_.Exception.Message -match '403|Forbidden|Authorization') {
        $settingParams = @{
            Category         = 'Application Control'
            Setting          = 'WDAC or AppLocker Policy Deployed'
            CurrentValue     = 'Insufficient permissions or license (Intune required)'
            RecommendedValue = 'WDAC or AppLocker policy deployed via Intune'
            Status           = 'Review'
            CheckId          = 'INTUNE-APPCONTROL-001'
            Remediation      = 'Requires DeviceManagementConfiguration.Read.All permission and Intune license.'
        }
        Add-Setting @settingParams
    }
    else {
        Write-Warning "Could not check application control policies: $_"
    }
}

# ------------------------------------------------------------------
# Output results
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'Intune App Control'
