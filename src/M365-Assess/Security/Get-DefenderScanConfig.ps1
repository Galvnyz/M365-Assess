<#
.SYNOPSIS
    Evaluates whether Defender Antivirus real-time protection is enabled via
    Intune endpoint security policies.
.DESCRIPTION
    Checks Intune device configurations and endpoint security intents for
    Windows Defender Antivirus settings that enable real-time scanning. Verifies
    that at least one policy enforces real-time protection.

    Requires an active Microsoft Graph connection with
    DeviceManagementConfiguration.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> .\Security\Get-DefenderScanConfig.ps1

    Displays real-time scan evaluation results.
.EXAMPLE
    PS> .\Security\Get-DefenderScanConfig.ps1 -OutputPath '.\defender-scan.csv'

    Exports the evaluation to CSV.
.NOTES
    Author:  Daren9m
    CMMC:    SI.L2-3.14.5 — Periodic and Real-time Scans
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
# 1. Check device configurations for Defender real-time protection
# ------------------------------------------------------------------
try {
    Write-Verbose 'Checking Intune device configurations for Defender real-time protection...'
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

    $realtimeEnabled = $false
    $policyDetail = 'Not configured'

    foreach ($config in $configList) {
        $odataType = $config['@odata.type']
        $displayName = $config['displayName']

        # Check Windows Defender configurations
        if ($odataType -match 'windows10GeneralConfiguration|windows10EndpointProtectionConfiguration') {
            $realtimeScan = $config['defenderMonitorFileActivity']
            $realtimeProtection = $config['defenderRealtimeScanDirection']

            if ($realtimeScan -eq 'monitorAllFiles' -or
                ($null -ne $realtimeProtection -and $realtimeProtection -ne 'notConfigured')) {
                $realtimeEnabled = $true
                $policyDetail = "Real-time monitoring configured (Policy: $displayName)"
            }
        }
    }

    # Also check endpoint security antivirus intents
    if (-not $realtimeEnabled) {
        try {
            $intentParams = @{
                Method      = 'GET'
                Uri         = '/beta/deviceManagement/intents'
                ErrorAction = 'Stop'
            }
            $intents = Invoke-MgGraphRequest @intentParams

            if ($intents -and $intents['value']) {
                $avIntents = @($intents['value'] | Where-Object {
                    $_['templateId'] -match 'antivirus' -or $_['displayName'] -match 'antivirus|defender'
                })
                if ($avIntents.Count -gt 0) {
                    $realtimeEnabled = $true
                    $policyDetail = "$($avIntents.Count) endpoint security antivirus policy(s) deployed"
                }
            }
        }
        catch {
            Write-Verbose "Could not query endpoint security intents: $_"
        }
    }

    $settingParams = @{
        Category         = 'Real-time Scanning'
        Setting          = 'Defender Antivirus Real-time Protection Enabled'
        CurrentValue     = $policyDetail
        RecommendedValue = 'Real-time protection enabled via Intune antivirus policy'
        Status           = if ($realtimeEnabled) { 'Pass' } else { 'Fail' }
        CheckId          = 'DEFENDER-REALTIMESCAN-001'
        Remediation      = 'Intune admin center > Endpoint security > Antivirus > Create policy > Microsoft Defender Antivirus > Enable real-time protection.'
    }
    Add-Setting @settingParams
}
catch {
    if ($_.Exception.Message -match '403|Forbidden|Authorization') {
        $settingParams = @{
            Category         = 'Real-time Scanning'
            Setting          = 'Defender Antivirus Real-time Protection Enabled'
            CurrentValue     = 'Insufficient permissions'
            RecommendedValue = 'Real-time protection enabled via Intune antivirus policy'
            Status           = 'Review'
            CheckId          = 'DEFENDER-REALTIMESCAN-001'
            Remediation      = 'Requires DeviceManagementConfiguration.Read.All permission.'
        }
        Add-Setting @settingParams
    }
    else {
        Write-Warning "Could not check Defender real-time scanning: $_"
    }
}

# ------------------------------------------------------------------
# Output results
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'Defender Scan'
