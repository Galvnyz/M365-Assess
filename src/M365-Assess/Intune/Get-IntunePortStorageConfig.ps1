<#
.SYNOPSIS
    Evaluates whether Intune device configuration restricts USB and removable
    storage on managed Windows devices.
.DESCRIPTION
    Queries Intune device configuration profiles for Windows 10/11 and checks
    whether removable storage or USB is blocked. Satisfies the CMMC requirement
    to limit use of portable storage devices on external systems.

    Requires an active Microsoft Graph connection with
    DeviceManagementConfiguration.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> .\Intune\Get-IntunePortStorageConfig.ps1

    Displays portable storage restriction evaluation results.
.EXAMPLE
    PS> .\Intune\Get-IntunePortStorageConfig.ps1 -OutputPath '.\intune-portstorage.csv'

    Exports the evaluation to CSV.
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
# 1. Check device configuration profiles for removable storage restrictions
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

    $storageRestricted = $false
    $restrictionDetail = 'None found'

    foreach ($config in $configList) {
        $odataType = $config['@odata.type']
        if ($odataType -match 'windows10GeneralConfiguration') {
            $usbBlocked = $config['usbBlocked']
            $storageCardBlocked = $config['storageBlockRemovableStorage']
            if ($usbBlocked -eq $true -or $storageCardBlocked -eq $true) {
                $storageRestricted = $true
                $parts = @()
                if ($usbBlocked -eq $true) { $parts += 'USB blocked' }
                if ($storageCardBlocked -eq $true) { $parts += 'Removable storage blocked' }
                $restrictionDetail = ($parts -join ', ') + " (Policy: $($config['displayName']))"
            }
        }
    }

    $settingParams = @{
        Category         = 'Portable Storage'
        Setting          = 'USB/Removable Storage Restriction'
        CurrentValue     = if ($storageRestricted) { $restrictionDetail } else { 'No restriction policies found' }
        RecommendedValue = 'Removable storage blocked via Intune device restriction profile'
        Status           = if ($storageRestricted) { 'Pass' } else { 'Fail' }
        CheckId          = 'INTUNE-PORTSTORAGE-001'
        Remediation      = 'Intune admin center > Devices > Configuration > Create profile > Windows 10 and later > Device restrictions > General > Removable storage: Block.'
    }
    Add-Setting @settingParams
}
catch {
    if ($_.Exception.Message -match '403|Forbidden|Authorization') {
        $settingParams = @{
            Category         = 'Portable Storage'
            Setting          = 'USB/Removable Storage Restriction'
            CurrentValue     = 'Insufficient permissions or license (Intune required)'
            RecommendedValue = 'Removable storage blocked via Intune device restriction profile'
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
