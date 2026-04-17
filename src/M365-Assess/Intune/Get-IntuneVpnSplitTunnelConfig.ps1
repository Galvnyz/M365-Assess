<#
.SYNOPSIS
    Evaluates whether Intune device configuration disables VPN split tunneling on
    managed Windows devices and that the policy is actively assigned.
.DESCRIPTION
    Queries Intune device configuration profiles for Windows 10/11 VPN and checks
    whether split tunneling is disabled (enableSplitTunneling: false), ensuring all
    traffic routes through the VPN tunnel. Verifies at least one active assignment.
    Satisfies CMMC SC.L2-3.13.7.

    Requires an active Microsoft Graph connection with
    DeviceManagementConfiguration.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> .\Intune\Get-IntuneVpnSplitTunnelConfig.ps1

    Displays VPN split tunnel configuration evaluation results.
.EXAMPLE
    PS> .\Intune\Get-IntuneVpnSplitTunnelConfig.ps1 -OutputPath '.\intune-vpnsplittunnel.csv'

    Exports the evaluation to CSV.
.NOTES
    Author:  Daren9m
    CMMC:    SC.L2-3.13.7 — Control and monitor communications at external boundaries
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
# 1. Check VPN device configuration profiles for split tunnel disabled
#    with active assignments
# ------------------------------------------------------------------
try {
    Write-Verbose 'Checking Intune VPN configurations for split tunnel disabled...'
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
        $currentValue = "Split tunneling disabled (Policy: $profileName, $assignCount assignment(s))"
        $status       = 'Pass'
    }
    else {
        $hasUnassigned = $configList | Where-Object {
            $_['@odata.type'] -match 'windows10VpnConfiguration' -and
            $_['enableSplitTunneling'] -eq $false
        }
        $currentValue = if ($hasUnassigned) {
            'VPN split-tunnel disabled profile exists but has no active assignments'
        } else {
            'No windows10VpnConfiguration profile with split tunneling disabled found'
        }
        $status = 'Fail'
    }

    $settingParams = @{
        Category         = 'VPN Configuration'
        Setting          = 'VPN Split Tunnel Disabled (Assigned)'
        CurrentValue     = $currentValue
        RecommendedValue = 'windows10VpnConfiguration with enableSplitTunneling: false assigned to at least one group'
        Status           = $status
        CheckId          = 'INTUNE-VPNCONFIG-001'
        Remediation      = 'Intune admin center > Devices > Configuration > Create profile > Windows 10 and later > VPN > set enableSplitTunneling to false. Assign the profile to device or user groups.'
    }
    Add-Setting @settingParams
}
catch {
    if ($_.Exception.Message -match '403|Forbidden|Authorization') {
        $settingParams = @{
            Category         = 'VPN Configuration'
            Setting          = 'VPN Split Tunnel Disabled (Assigned)'
            CurrentValue     = 'Insufficient permissions or license (Intune required)'
            RecommendedValue = 'windows10VpnConfiguration with enableSplitTunneling: false assigned to at least one group'
            Status           = 'Review'
            CheckId          = 'INTUNE-VPNCONFIG-001'
            Remediation      = 'Requires DeviceManagementConfiguration.Read.All permission and Intune license.'
        }
        Add-Setting @settingParams
    }
    else {
        Write-Warning "Could not check VPN split tunnel configuration: $_"
    }
}

# ------------------------------------------------------------------
# Output results
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'Intune VPN Split Tunnel'
