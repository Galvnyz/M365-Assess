<#
.SYNOPSIS
    Evaluates whether application control policies (WDAC/AppLocker) are deployed
    via Intune to restrict unauthorized software.
.DESCRIPTION
    Queries Intune device configuration profiles for Windows Defender Application
    Control (WDAC) or AppLocker policy deployments. Checks endpoint protection
    profiles and custom OMA-URI policies that enforce application whitelisting.

    Requires an active Microsoft Graph connection with
    DeviceManagementConfiguration.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> .\Intune\Get-IntuneAppControlConfig.ps1

    Displays application control evaluation results.
.EXAMPLE
    PS> .\Intune\Get-IntuneAppControlConfig.ps1 -OutputPath '.\intune-appcontrol.csv'

    Exports the evaluation to CSV.
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
$checkIdCounter = $ctx.CheckIdCounter

function Add-Setting {
    param(
        [string]$Category, [string]$Setting, [string]$CurrentValue,
        [string]$RecommendedValue, [string]$Status,
        [string]$CheckId = '', [string]$Remediation = ''
    )
    $p = @{
        Settings         = $settings
        CheckIdCounter   = $checkIdCounter
        Category         = $Category
        Setting          = $Setting
        CurrentValue     = $CurrentValue
        RecommendedValue = $RecommendedValue
        Status           = $Status
        CheckId          = $CheckId
        Remediation      = $Remediation
    }
    Add-SecuritySetting @p
}

# ------------------------------------------------------------------
# 1. Check for WDAC/AppLocker policies in device configurations
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

    $appControlFound = $false
    $policyDetail = 'None found'

    foreach ($config in $configList) {
        $odataType = $config['@odata.type']
        $displayName = $config['displayName']

        # Check for Endpoint Protection profiles with WDAC
        if ($odataType -match 'windows10EndpointProtectionConfiguration') {
            $appLockerAppExe = $config['appLockerApplicationControl']
            if ($null -ne $appLockerAppExe -and $appLockerAppExe -ne 'notConfigured') {
                $appControlFound = $true
                $policyDetail = "AppLocker: $appLockerAppExe (Policy: $displayName)"
            }
        }

        # Check custom OMA-URI for WDAC policies
        if ($odataType -match 'windows10CustomConfiguration') {
            $omaSettings = $config['omaSettings']
            if ($omaSettings) {
                foreach ($setting in $omaSettings) {
                    $omaUri = $setting['omaUri']
                    if ($omaUri -match 'ApplicationControl|AppLocker|CodeIntegrity') {
                        $appControlFound = $true
                        $policyDetail = "WDAC/AppLocker OMA-URI: $omaUri (Policy: $displayName)"
                    }
                }
            }
        }
    }

    $settingParams = @{
        Category         = 'Application Control'
        Setting          = 'WDAC or AppLocker Policy Deployed'
        CurrentValue     = if ($appControlFound) { $policyDetail } else { 'No application control policies found' }
        RecommendedValue = 'WDAC or AppLocker policy deployed via Intune'
        Status           = if ($appControlFound) { 'Pass' } else { 'Fail' }
        CheckId          = 'INTUNE-APPCONTROL-001'
        Remediation      = 'Intune admin center > Devices > Configuration > Create profile > Endpoint protection > Windows Defender Application Control. Alternatively, deploy WDAC via custom OMA-URI.'
    }
    Add-Setting @settingParams
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
