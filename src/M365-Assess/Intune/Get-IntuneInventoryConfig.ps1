<#
.SYNOPSIS
    Evaluates whether Intune is used as an authoritative device inventory with
    device categories configured.
.DESCRIPTION
    Checks whether managed devices are enrolled in Intune and whether device
    categories have been configured for classification. Satisfies the CMMC L3
    requirement for maintaining an authoritative component repository.

    Requires an active Microsoft Graph connection with
    DeviceManagementManagedDevices.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> .\Intune\Get-IntuneInventoryConfig.ps1

    Displays device inventory evaluation results.
.EXAMPLE
    PS> .\Intune\Get-IntuneInventoryConfig.ps1 -OutputPath '.\intune-inventory.csv'

    Exports the evaluation to CSV.
.NOTES
    Author:  Daren9m
    CMMC:    CM.L3-3.4.1E — Authoritative Source and Repository for Components
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
# 1. Check managed device overview and device categories
# ------------------------------------------------------------------
try {
    Write-Verbose 'Checking Intune managed device overview...'
    $overviewParams = @{
        Method      = 'GET'
        Uri         = '/beta/deviceManagement/managedDeviceOverview'
        ErrorAction = 'Stop'
    }
    $overview = Invoke-MgGraphRequest @overviewParams

    $enrolledCount = 0
    if ($null -ne $overview -and $null -ne $overview['enrolledDeviceCount']) {
        $enrolledCount = [int]$overview['enrolledDeviceCount']
    }

    Write-Verbose 'Checking device categories...'
    $categoryParams = @{
        Method      = 'GET'
        Uri         = '/beta/deviceManagement/deviceCategories'
        ErrorAction = 'Stop'
    }
    $categories = Invoke-MgGraphRequest @categoryParams

    $categoryCount = 0
    if ($categories -and $categories['value']) {
        $categoryCount = @($categories['value']).Count
    }

    $hasDevices = $enrolledCount -gt 0
    $hasCategories = $categoryCount -gt 0
    $passCondition = $hasDevices -and $hasCategories

    $currentValue = "Enrolled devices: $enrolledCount, Device categories: $categoryCount"

    $settingParams = @{
        Category         = 'Device Inventory'
        Setting          = 'Authoritative Device Inventory with Categories'
        CurrentValue     = $currentValue
        RecommendedValue = 'Devices enrolled in Intune with at least one device category configured'
        Status           = if ($passCondition) { 'Pass' } elseif ($hasDevices) { 'Warning' } else { 'Fail' }
        CheckId          = 'INTUNE-INVENTORY-001'
        Remediation      = 'Ensure devices are enrolled in Intune. Configure device categories: Intune admin center > Devices > Device categories > Create category.'
    }
    Add-Setting @settingParams
}
catch {
    if ($_.Exception.Message -match '403|Forbidden|Authorization') {
        $settingParams = @{
            Category         = 'Device Inventory'
            Setting          = 'Authoritative Device Inventory with Categories'
            CurrentValue     = 'Insufficient permissions or license (Intune required)'
            RecommendedValue = 'Devices enrolled in Intune with at least one device category configured'
            Status           = 'Review'
            CheckId          = 'INTUNE-INVENTORY-001'
            Remediation      = 'Requires DeviceManagementManagedDevices.Read.All permission and Intune license.'
        }
        Add-Setting @settingParams
    }
    else {
        Write-Warning "Could not check device inventory configuration: $_"
    }
}

# ------------------------------------------------------------------
# Output results
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'Intune Inventory'
