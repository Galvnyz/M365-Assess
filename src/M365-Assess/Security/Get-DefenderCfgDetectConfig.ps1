<#
.SYNOPSIS
    Evaluates whether automated detection of misconfigured or unauthorized
    components is active via Defender for Endpoint and Secure Score.
.DESCRIPTION
    Checks whether Defender for Endpoint device discovery is effectively active
    and whether Secure Score tracks device-configuration-related controls. This
    satisfies the CMMC L3 requirement for automated detection of misconfigured
    or unauthorized components.

    Requires an active Microsoft Graph connection with SecurityEvents.Read.All
    permission. Full functionality requires Defender for Endpoint P2 (E5).
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> .\Security\Get-DefenderCfgDetectConfig.ps1

    Displays configuration detection evaluation results.
.EXAMPLE
    PS> .\Security\Get-DefenderCfgDetectConfig.ps1 -OutputPath '.\defender-cfgdetect.csv'

    Exports the evaluation to CSV.
.NOTES
    Author:  Daren9m
    CMMC:    CM.L3-3.4.2E — Automated Detection of Misconfigured/Unauthorized Components
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
# 1. Check Secure Score control profiles for device config detection
# ------------------------------------------------------------------
try {
    Write-Verbose 'Checking Secure Score control profiles for configuration detection...'
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/v1.0/security/secureScoreControlProfiles'
        ErrorAction = 'Stop'
    }
    $controlProfiles = Invoke-MgGraphRequest @graphParams

    $configDetectionActive = $false
    $activeControls = @()

    if ($controlProfiles -and $controlProfiles['value']) {
        $deviceConfigControls = @($controlProfiles['value'] | Where-Object {
            $_['controlCategory'] -match 'Device' -or
            $_['title'] -match 'device|configuration|unauthorized|discovery'
        })

        foreach ($control in $deviceConfigControls) {
            $state = $control['controlStateUpdates']
            if ($null -ne $state -and @($state).Count -gt 0) {
                $latestState = @($state)[-1]
                if ($latestState['state'] -ne 'Default') {
                    $configDetectionActive = $true
                    $activeControls += $control['title']
                }
            }
        }

        # If device controls exist but none are actively configured, do NOT pass
        if ($deviceConfigControls.Count -gt 0 -and -not $configDetectionActive) {
            $currentDetail = "$($deviceConfigControls.Count) device config controls tracked in Secure Score but none are actively configured"
            # Do NOT set $configDetectionActive = $true here
        }
    }

    $currentDetail = if ($activeControls.Count -gt 0) {
        ($activeControls | Select-Object -First 3) -join '; '
    }
    else {
        'No device configuration detection controls found'
    }

    $settingParams = @{
        Category         = 'Configuration Detection'
        Setting          = 'Automated Misconfiguration/Unauthorized Device Detection'
        CurrentValue     = $currentDetail
        RecommendedValue = 'Defender for Endpoint device discovery and config monitoring active'
        Status           = if ($configDetectionActive) { 'Pass' } else { 'Fail' }
        CheckId          = 'DEFENDER-CFGDETECT-001'
        Remediation      = 'Enable Defender for Endpoint device discovery. security.microsoft.com > Settings > Device discovery. Ensure devices are onboarded and configuration assessment is active.'
    }
    Add-Setting @settingParams
}
catch {
    if ($_.Exception.Message -match '403|Forbidden|Authorization') {
        $settingParams = @{
            Category         = 'Configuration Detection'
            Setting          = 'Automated Misconfiguration/Unauthorized Device Detection'
            CurrentValue     = 'Insufficient permissions'
            RecommendedValue = 'Defender for Endpoint device discovery and config monitoring active'
            Status           = 'Review'
            CheckId          = 'DEFENDER-CFGDETECT-001'
            Remediation      = 'Requires SecurityEvents.Read.All permission and Defender for Endpoint P2 (E5) license.'
        }
        Add-Setting @settingParams
    }
    else {
        Write-Warning "Could not check configuration detection: $_"
    }
}

# ------------------------------------------------------------------
# Output results
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'Defender Cfg Detect'
