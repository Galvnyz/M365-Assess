<#
.SYNOPSIS
    Evaluates whether Intune device configuration blocks removable media on
    managed Windows devices and that the policy is actively assigned.
.DESCRIPTION
    Queries Intune device configuration profiles for Windows 10/11 and checks
    whether removable storage is blocked via storageBlockRemovableStorage. Also
    verifies the profile has at least one group or device assignment, since an
    unassigned policy provides no enforcement. Satisfies CMMC MP.L2-3.8.7.

    Requires an active Microsoft Graph connection with
    DeviceManagementConfiguration.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> .\Intune\Get-IntuneRemovableMediaConfig.ps1

    Displays removable media restriction evaluation results.
.EXAMPLE
    PS> .\Intune\Get-IntuneRemovableMediaConfig.ps1 -OutputPath '.\intune-removablemedia.csv'

    Exports the evaluation to CSV.
.NOTES
    Author:  Daren9m
    CMMC:    MP.L2-3.8.7 — Control use of removable media on system components
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
# 1. Check device configuration profiles for removable storage block
#    with active assignments
# ------------------------------------------------------------------
try {
    Write-Verbose 'Checking Intune device configurations for removable media restrictions...'
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

    $blockingProfile = $null

    foreach ($config in $configList) {
        if ($config['@odata.type'] -notmatch 'windows10GeneralConfiguration') { continue }
        if ($config['storageBlockRemovableStorage'] -ne $true) { continue }

        $assignments = @()
        if ($config['assignments']) { $assignments = @($config['assignments']) }

        if ($assignments.Count -gt 0) {
            $blockingProfile = $config
            break
        }
    }

    if ($blockingProfile) {
        $profileName = $blockingProfile['displayName']
        $assignCount = @($blockingProfile['assignments']).Count
        $currentValue = "Removable storage blocked (Policy: $profileName, $assignCount assignment(s))"
        $status = 'Pass'
    }
    else {
        $hasUnassigned = $configList | Where-Object {
            $_['@odata.type'] -match 'windows10GeneralConfiguration' -and
            $_['storageBlockRemovableStorage'] -eq $true
        }
        $currentValue = if ($hasUnassigned) {
            'Removable storage block profile exists but has no active assignments'
        } else {
            'No removable storage block profile found'
        }
        $status = 'Fail'
    }

    $settingParams = @{
        Category         = 'Removable Media'
        Setting          = 'Removable Storage Block (Assigned)'
        CurrentValue     = $currentValue
        RecommendedValue = 'windows10GeneralConfiguration profile with storageBlockRemovableStorage assigned to at least one group'
        Status           = $status
        CheckId          = 'INTUNE-REMOVABLEMEDIA-001'
        Remediation      = 'Intune admin center > Devices > Configuration > Create profile > Windows 10 and later > Device restrictions > General > Removable storage: Block. Assign the profile to device or user groups.'
    }
    Add-Setting @settingParams
}
catch {
    if ($_.Exception.Message -match '403|Forbidden|Authorization') {
        $settingParams = @{
            Category         = 'Removable Media'
            Setting          = 'Removable Storage Block (Assigned)'
            CurrentValue     = 'Insufficient permissions or license (Intune required)'
            RecommendedValue = 'windows10GeneralConfiguration profile with storageBlockRemovableStorage assigned to at least one group'
            Status           = 'Review'
            CheckId          = 'INTUNE-REMOVABLEMEDIA-001'
            Remediation      = 'Requires DeviceManagementConfiguration.Read.All permission and Intune license.'
        }
        Add-Setting @settingParams
    }
    else {
        Write-Warning "Could not check removable media restrictions: $_"
    }
}

# ------------------------------------------------------------------
# Output results
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'Intune Removable Media'
