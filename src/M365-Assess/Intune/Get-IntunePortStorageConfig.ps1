<#
.SYNOPSIS
    Evaluates whether Intune device configuration restricts USB and removable
    storage on managed Windows devices.
.DESCRIPTION
    Queries Intune device configuration profiles for Windows 10/11 and emits one
    result row per windows10GeneralConfiguration profile showing its USB and
    removable storage restriction state. If no such profiles exist, a Fail row
    is emitted. Satisfies the CMMC requirement to limit use of portable storage
    devices on external systems.

    Requires an active Microsoft Graph connection with
    DeviceManagementConfiguration.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> .\Intune\Get-IntunePortStorageConfig.ps1

    Displays per-profile portable storage restriction evaluation results.
.EXAMPLE
    PS> .\Intune\Get-IntunePortStorageConfig.ps1 -OutputPath '.\intune-portstorage.csv'

    Exports the per-profile evaluation to CSV.
.NOTES
    Author:  Daren9m
    CMMC:    AC.L2-3.1.21 — Limit Use of Portable Storage on External Systems
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


$remediationText = 'Intune admin center > Devices > Configuration > Create profile > Windows 10 and later > Device restrictions > General > Removable storage: Block.'

# ------------------------------------------------------------------
# 1. Emit one row per Windows device restriction profile
# ------------------------------------------------------------------
try {
    Write-Verbose 'Checking Intune device configurations for removable storage restrictions...'
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

    $relevantProfiles = @($configList | Where-Object { $_['@odata.type'] -match 'windows10GeneralConfiguration' })

    if ($relevantProfiles.Count -eq 0) {
        $settingParams = @{
            Category         = 'Portable Storage'
            Setting          = 'USB/Removable Storage Restriction'
            CurrentValue     = 'No Windows device restriction profiles found'
            RecommendedValue = 'windows10GeneralConfiguration profile with usbBlocked or storageBlockRemovableStorage: true'
            Status           = 'Fail'
            CheckId          = 'INTUNE-PORTSTORAGE-001'
            Remediation      = $remediationText
        }
        Add-Setting @settingParams
    }
    else {
        foreach ($deviceProfile in $relevantProfiles) {
            $name        = $deviceProfile['displayName']
            $usbBlocked  = $deviceProfile['usbBlocked'] -eq $true
            $storageBlocked = $deviceProfile['storageBlockRemovableStorage'] -eq $true
            $parts = @()
            if ($usbBlocked) { $parts += 'USB blocked' }
            if ($storageBlocked) { $parts += 'Removable storage blocked' }
            $currentValue = if ($parts.Count -gt 0) { $parts -join ', ' } else { 'Not configured' }

            $settingParams = @{
                Category         = 'Portable Storage'
                Setting          = "USB/Removable Storage — $name"
                CurrentValue     = $currentValue
                RecommendedValue = 'usbBlocked or storageBlockRemovableStorage: true'
                Status           = if ($usbBlocked -or $storageBlocked) { 'Pass' } else { 'Fail' }
                CheckId          = 'INTUNE-PORTSTORAGE-001'
                Remediation      = $remediationText
            }
            Add-Setting @settingParams
        }
    }
}
catch {
    if ($_.Exception.Message -match '403|Forbidden|Authorization') {
        $settingParams = @{
            Category         = 'Portable Storage'
            Setting          = 'USB/Removable Storage Restriction'
            CurrentValue     = 'Insufficient permissions or license (Intune required)'
            RecommendedValue = 'windows10GeneralConfiguration profile with usbBlocked or storageBlockRemovableStorage: true'
            Status           = 'Review'
            CheckId          = 'INTUNE-PORTSTORAGE-001'
            Remediation      = 'Requires DeviceManagementConfiguration.Read.All permission and Intune license.'
        }
        Add-Setting @settingParams
    }
    else {
        Write-Warning "Could not check portable storage restrictions: $_"
    }
}

# ------------------------------------------------------------------
# Output results
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'Intune Port Storage'
