<#
.SYNOPSIS
    Evaluates whether Intune device configuration enforces WPA2-Enterprise with
    EAP-TLS on managed Windows devices and that the policy is actively assigned.
.DESCRIPTION
    Queries Intune device configuration profiles for Windows Wi-Fi enterprise
    configurations and checks whether the security type is WPA2-Enterprise and
    the EAP type is EAP-TLS (certificate-based authentication). Verifies at least
    one active assignment. Satisfies CMMC AC.L2-3.1.16 and AC.L2-3.1.17.

    Requires an active Microsoft Graph connection with
    DeviceManagementConfiguration.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> .\Intune\Get-IntuneWifiEapConfig.ps1

    Displays Wi-Fi EAP configuration evaluation results.
.EXAMPLE
    PS> .\Intune\Get-IntuneWifiEapConfig.ps1 -OutputPath '.\intune-wifieap.csv'

    Exports the evaluation to CSV.
.NOTES
    Author:  Daren9m
    CMMC:    AC.L2-3.1.16 + AC.L2-3.1.17 — Wireless access control
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
# 1. Check Wi-Fi configuration profiles for WPA2-Enterprise EAP-TLS
#    with active assignments
# ------------------------------------------------------------------
try {
    Write-Verbose 'Checking Intune Wi-Fi configurations for WPA2-Enterprise EAP-TLS...'
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/beta/deviceManagement/deviceConfigurations?$expand=assignments'
        ErrorAction = 'Stop'
    }
    $configs = Invoke-MgGraphRequest @graphParams

    $configList = @()
    if ($configs -and $configs['value']) {
        $configList = @($configs['value'])
    }

    $compliantProfile = $null

    foreach ($config in $configList) {
        if ($config['@odata.type'] -notmatch 'windowsWifiEnterpriseEAPConfiguration') { continue }
        if ($config['wifiSecurityType'] -ne 'wpa2Enterprise') { continue }
        if ($config['eapType'] -ne 'eapTls') { continue }

        $assignments = @()
        if ($config['assignments']) { $assignments = @($config['assignments']) }

        if ($assignments.Count -gt 0) {
            $compliantProfile = $config
            break
        }
    }

    if ($compliantProfile) {
        $profileName  = $compliantProfile['displayName']
        $assignCount  = @($compliantProfile['assignments']).Count
        $currentValue = "WPA2-Enterprise EAP-TLS configured (Policy: $profileName, $assignCount assignment(s))"
        $status       = 'Pass'
    }
    else {
        $hasUnassigned = $configList | Where-Object {
            $_['@odata.type'] -match 'windowsWifiEnterpriseEAPConfiguration' -and
            $_['wifiSecurityType'] -eq 'wpa2Enterprise' -and
            $_['eapType'] -eq 'eapTls'
        }
        $currentValue = if ($hasUnassigned) {
            'WPA2-Enterprise EAP-TLS Wi-Fi profile exists but has no active assignments'
        } else {
            'No windowsWifiEnterpriseEAPConfiguration profile with WPA2-Enterprise + EAP-TLS found'
        }
        $status = 'Fail'
    }

    $settingParams = @{
        Category         = 'Wi-Fi Authentication'
        Setting          = 'Wi-Fi WPA2-Enterprise with EAP-TLS (Assigned)'
        CurrentValue     = $currentValue
        RecommendedValue = 'windowsWifiEnterpriseEAPConfiguration with wifiSecurityType: wpa2Enterprise and eapType: eapTls assigned to at least one group'
        Status           = $status
        CheckId          = 'INTUNE-WIFI-001'
        Remediation      = 'Intune admin center > Devices > Configuration > Create profile > Windows 10 and later > Wi-Fi > Enterprise > set Security type to WPA2-Enterprise and EAP type to EAP-TLS. Assign the profile to device or user groups.'
    }
    Add-Setting @settingParams
}
catch {
    if ($_.Exception.Message -match '403|Forbidden|Authorization') {
        $settingParams = @{
            Category         = 'Wi-Fi Authentication'
            Setting          = 'Wi-Fi WPA2-Enterprise with EAP-TLS (Assigned)'
            CurrentValue     = 'Insufficient permissions or license (Intune required)'
            RecommendedValue = 'windowsWifiEnterpriseEAPConfiguration with wifiSecurityType: wpa2Enterprise and eapType: eapTls assigned to at least one group'
            Status           = 'Review'
            CheckId          = 'INTUNE-WIFI-001'
            Remediation      = 'Requires DeviceManagementConfiguration.Read.All permission and Intune license.'
        }
        Add-Setting @settingParams
    }
    else {
        Write-Warning "Could not check Wi-Fi EAP configuration: $_"
    }
}

# ------------------------------------------------------------------
# Output results
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'Intune Wi-Fi EAP'
