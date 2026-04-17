<#
.SYNOPSIS
    Evaluates whether Intune device configuration enforces always-on full-tunnel VPN
    on managed Windows devices and that the policy is actively assigned.
.DESCRIPTION
    Queries Intune device configuration profiles for Windows 10/11 VPN and checks
    whether always-on VPN is enabled (alwaysOn: true) and split tunneling is disabled
    (enableSplitTunneling: false), ensuring all traffic routes through the VPN at
    all times. Verifies at least one active assignment. Satisfies CMMC AC.L2-3.1.14.

    Requires an active Microsoft Graph connection with
    DeviceManagementConfiguration.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> .\Intune\Get-IntuneAlwaysOnVpnConfig.ps1

    Displays always-on VPN configuration evaluation results.
.EXAMPLE
    PS> .\Intune\Get-IntuneAlwaysOnVpnConfig.ps1 -OutputPath '.\intune-alwaysonvpn.csv'

    Exports the evaluation to CSV.
.NOTES
    Author:  Daren9m
    CMMC:    AC.L2-3.1.14 — Route remote access via managed access control points
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
# 1. Check VPN device configuration profiles for always-on full tunnel
#    with active assignments
# ------------------------------------------------------------------
try {
    Write-Verbose 'Checking Intune VPN configurations for always-on full-tunnel VPN...'
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
        if ($config['@odata.type'] -notmatch 'windows10VpnConfiguration') { continue }
        if ($config['alwaysOn'] -ne $true) { continue }
        if ($config['enableSplitTunneling'] -ne $false) { continue }

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
        $currentValue = "Always-on full-tunnel VPN configured (Policy: $profileName, $assignCount assignment(s))"
        $status       = 'Pass'
    }
    else {
        $hasUnassigned = $configList | Where-Object {
            $_['@odata.type'] -match 'windows10VpnConfiguration' -and
            $_['alwaysOn'] -eq $true -and
            $_['enableSplitTunneling'] -eq $false
        }
        $currentValue = if ($hasUnassigned) {
            'Always-on full-tunnel VPN profile exists but has no active assignments'
        } else {
            'No windows10VpnConfiguration profile with alwaysOn: true and split tunneling disabled found'
        }
        $status = 'Fail'
    }

    $settingParams = @{
        Category         = 'Always-On VPN'
        Setting          = 'Always-On VPN with Full Tunnel (Assigned)'
        CurrentValue     = $currentValue
        RecommendedValue = 'windows10VpnConfiguration with alwaysOn: true and enableSplitTunneling: false assigned to at least one group'
        Status           = $status
        CheckId          = 'INTUNE-REMOTEVPN-001'
        Remediation      = 'Intune admin center > Devices > Configuration > Create profile > Windows 10 and later > VPN > set Always-on VPN to enable and split tunneling to disable. Assign the profile to device or user groups.'
    }
    Add-Setting @settingParams
}
catch {
    if ($_.Exception.Message -match '403|Forbidden|Authorization') {
        $settingParams = @{
            Category         = 'Always-On VPN'
            Setting          = 'Always-On VPN with Full Tunnel (Assigned)'
            CurrentValue     = 'Insufficient permissions or license (Intune required)'
            RecommendedValue = 'windows10VpnConfiguration with alwaysOn: true and enableSplitTunneling: false assigned to at least one group'
            Status           = 'Review'
            CheckId          = 'INTUNE-REMOTEVPN-001'
            Remediation      = 'Requires DeviceManagementConfiguration.Read.All permission and Intune license.'
        }
        Add-Setting @settingParams
    }
    else {
        Write-Warning "Could not check always-on VPN configuration: $_"
    }
}

# ------------------------------------------------------------------
# Output results
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'Intune Always-On VPN'
