<#
.SYNOPSIS
    Evaluates whether Intune device configuration blocks removable media on
    managed Windows devices and that the policy is actively assigned.
.DESCRIPTION
    Queries Intune device configuration profiles for Windows 10/11 and emits one
    result row per windows10GeneralConfiguration profile that has
    storageBlockRemovableStorage set to true. Pass = profile has at least one
    active assignment; Fail = profile exists but has no assignments. If no
    blocking profiles exist, a Fail row is emitted. Satisfies CMMC MP.L2-3.8.7.

    Requires an active Microsoft Graph connection with
    DeviceManagementConfiguration.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> .\Intune\Get-IntuneRemovableMediaConfig.ps1

    Displays per-profile removable media restriction evaluation results.
.EXAMPLE
    PS> .\Intune\Get-IntuneRemovableMediaConfig.ps1 -OutputPath '.\intune-removablemedia.csv'

    Exports the per-profile evaluation to CSV.
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


$remediationText = 'Intune admin center > Devices > Configuration > Create profile > Windows 10 and later > Device restrictions > General > Removable storage: Block. Assign the profile to device or user groups.'

# ------------------------------------------------------------------
# 1. Emit one row per blocking profile, Pass/Fail based on assignments
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

    $blockingProfiles = @($configList | Where-Object {
        $_['@odata.type'] -match 'windows10GeneralConfiguration' -and
        $_['storageBlockRemovableStorage'] -eq $true
    })

    if ($blockingProfiles.Count -eq 0) {
        $settingParams = @{
            Category         = 'Removable Media'
            Setting          = 'Removable Storage Block (Assigned)'
            CurrentValue     = 'No removable storage block profile found'
            RecommendedValue = 'windows10GeneralConfiguration profile with storageBlockRemovableStorage assigned to at least one group'
            Status           = 'Fail'
            CheckId          = 'INTUNE-REMOVABLEMEDIA-001'
            Remediation      = $remediationText
        }
        Add-Setting @settingParams
    }
    else {
        foreach ($blockProfile in $blockingProfiles) {
            $name        = $blockProfile['displayName']
            $assignments = @()
            if ($blockProfile['assignments']) { $assignments = @($blockProfile['assignments']) }
            $assigned    = $assignments.Count -gt 0

            $settingParams = @{
                Category         = 'Removable Media'
                Setting          = "Removable Storage Block — $name"
                CurrentValue     = if ($assigned) {
                    "Removable storage blocked ($($assignments.Count) assignment(s))"
                } else {
                    'Removable storage block profile exists but has no active assignments'
                }
                RecommendedValue = 'storageBlockRemovableStorage: true with at least one active assignment'
                Status           = if ($assigned) { 'Pass' } else { 'Fail' }
                CheckId          = 'INTUNE-REMOVABLEMEDIA-001'
                Remediation      = $remediationText
            }
            Add-Setting @settingParams
        }
    }
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
