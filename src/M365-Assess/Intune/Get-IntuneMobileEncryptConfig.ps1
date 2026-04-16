<#
.SYNOPSIS
    Evaluates whether Intune compliance policies require device encryption on
    iOS and Android devices.
.DESCRIPTION
    Queries Intune device compliance policies and checks whether storage encryption
    is required for iOS and Android platforms. Satisfies the CMMC requirement to
    encrypt CUI on mobile devices.

    Requires an active Microsoft Graph connection with
    DeviceManagementConfiguration.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> .\Intune\Get-IntuneMobileEncryptConfig.ps1

    Displays mobile encryption compliance evaluation results.
.EXAMPLE
    PS> .\Intune\Get-IntuneMobileEncryptConfig.ps1 -OutputPath '.\intune-mobileencrypt.csv'

    Exports the evaluation to CSV.
.NOTES
    Author:  Daren9m
    CMMC:    AC.L2-3.1.19 — Encrypt CUI on Mobile Devices
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
# 1. Check iOS and Android compliance policies for encryption
# ------------------------------------------------------------------
try {
    Write-Verbose 'Checking Intune compliance policies for mobile encryption...'
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/beta/deviceManagement/deviceCompliancePolicies'
        ErrorAction = 'Stop'
    }
    $policies = Invoke-MgGraphRequest @graphParams

    $policyList = @()
    if ($policies -and $policies['value']) {
        $policyList = @($policies['value'])
    }

    $iosEncryption = $false
    $androidEncryption = $false

    foreach ($policy in $policyList) {
        $odataType = $policy['@odata.type']
        if ($odataType -match 'iosCompliancePolicy') {
            if ($policy['storageRequireEncryption'] -eq $true) {
                $iosEncryption = $true
            }
        }
        elseif ($odataType -match 'androidCompliancePolicy|androidDeviceOwnerCompliancePolicy|androidWorkProfileCompliancePolicy') {
            if ($policy['storageRequireEncryption'] -eq $true) {
                $androidEncryption = $true
            }
        }
    }

    $bothRequired = $iosEncryption -and $androidEncryption
    $currentParts = @()
    $currentParts += "iOS: $(if ($iosEncryption) { 'Required' } else { 'Not required' })"
    $currentParts += "Android: $(if ($androidEncryption) { 'Required' } else { 'Not required' })"
    $currentValue = $currentParts -join ', '

    $settingParams = @{
        Category         = 'Mobile Encryption'
        Setting          = 'Storage Encryption Required on iOS and Android'
        CurrentValue     = $currentValue
        RecommendedValue = 'Storage encryption required on both iOS and Android'
        Status           = if ($bothRequired) { 'Pass' } elseif ($iosEncryption -or $androidEncryption) { 'Warning' } else { 'Fail' }
        CheckId          = 'INTUNE-MOBILEENCRYPT-001'
        Remediation      = 'Intune admin center > Devices > Compliance > Create/edit iOS and Android compliance policies > Require device encryption.'
    }
    Add-Setting @settingParams
}
catch {
    if ($_.Exception.Message -match '403|Forbidden|Authorization') {
        $settingParams = @{
            Category         = 'Mobile Encryption'
            Setting          = 'Storage Encryption Required on iOS and Android'
            CurrentValue     = 'Insufficient permissions or license (Intune required)'
            RecommendedValue = 'Storage encryption required on both iOS and Android'
            Status           = 'Review'
            CheckId          = 'INTUNE-MOBILEENCRYPT-001'
            Remediation      = 'Requires DeviceManagementConfiguration.Read.All permission and Intune license.'
        }
        Add-Setting @settingParams
    }
    else {
        Write-Warning "Could not check mobile encryption compliance: $_"
    }
}

# ------------------------------------------------------------------
# Output results
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'Intune Mobile Encrypt'
