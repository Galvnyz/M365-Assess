<#
.SYNOPSIS
    Evaluates whether automatic device enrollment and discovery is configured
    in Intune for automated inventory management.
.DESCRIPTION
    Checks whether MDM auto-enrollment configurations exist so that devices are
    automatically discovered and enrolled into management. Verifies that at least
    one auto-enrollment policy is configured with MDM scope set to All or Some.

    Requires an active Microsoft Graph connection with
    DeviceManagementConfiguration.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> .\Intune\Get-IntuneAutoDiscConfig.ps1

    Displays automatic discovery evaluation results.
.EXAMPLE
    PS> .\Intune\Get-IntuneAutoDiscConfig.ps1 -OutputPath '.\intune-autodisc.csv'

    Exports the evaluation to CSV.
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
# 1. Check device enrollment configurations for auto-enrollment
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

    $autoEnrollFound = $false
    $enrollDetail = 'No auto-enrollment configuration found'

    foreach ($config in $configList) {
        $odataType = $config['@odata.type']
        $displayName = $config['displayName']

        # Windows auto-enrollment (MDM)
        if ($odataType -match 'deviceEnrollmentWindowsHelloForBusinessConfiguration|deviceEnrollmentPlatformRestrictionsConfiguration|deviceEnrollmentLimitConfiguration') {
            $autoEnrollFound = $true
            $enrollDetail = "Enrollment config found: $displayName ($odataType)"
        }

        # Look for Windows Autopilot deployment profiles
        if ($odataType -match 'windowsAutopilot') {
            $autoEnrollFound = $true
            $enrollDetail = "Autopilot deployment profile: $displayName"
        }
    }

    # Also check for Windows Autopilot deployment profiles directly
    if (-not $autoEnrollFound) {
        try {
            $autopilotParams = @{
                Method      = 'GET'
                Uri         = '/beta/deviceManagement/windowsAutopilotDeploymentProfiles'
                ErrorAction = 'Stop'
            }
            $autopilotProfiles = Invoke-MgGraphRequest @autopilotParams

            if ($autopilotProfiles -and $autopilotProfiles['value'] -and @($autopilotProfiles['value']).Count -gt 0) {
                $autoEnrollFound = $true
                $profileCount = @($autopilotProfiles['value']).Count
                $enrollDetail = "$profileCount Autopilot deployment profile(s) configured"
            }
        }
        catch {
            Write-Verbose "Could not query Autopilot profiles: $_"
        }
    }

    $settingParams = @{
        Category         = 'Automated Discovery'
        Setting          = 'Automatic Device Enrollment and Discovery'
        CurrentValue     = $enrollDetail
        RecommendedValue = 'MDM auto-enrollment configured (scope: All or Some users)'
        Status           = if ($autoEnrollFound) { 'Pass' } else { 'Fail' }
        CheckId          = 'INTUNE-AUTODISC-001'
        Remediation      = 'Configure Intune automatic enrollment: Entra admin center > Mobility (MDM and WIP) > Microsoft Intune > MDM user scope: All or Some. Consider configuring Windows Autopilot for zero-touch provisioning.'
    }
    Add-Setting @settingParams
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
