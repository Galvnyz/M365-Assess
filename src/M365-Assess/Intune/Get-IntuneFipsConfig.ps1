<#
.SYNOPSIS
    Evaluates whether Intune configuration profiles enforce FIPS-validated
    cryptography on managed Windows devices.
.DESCRIPTION
    Queries Intune device configuration profiles for custom OMA-URI settings
    that enable the FIPS algorithm policy on Windows devices. The target setting
    is ./Device/Vendor/MSFT/Policy/Config/Cryptography/AllowFipsAlgorithmPolicy
    set to 1 (enabled).

    Requires an active Microsoft Graph connection with
    DeviceManagementConfiguration.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> .\Intune\Get-IntuneFipsConfig.ps1

    Displays FIPS cryptography enforcement evaluation results.
.EXAMPLE
    PS> .\Intune\Get-IntuneFipsConfig.ps1 -OutputPath '.\intune-fips.csv'

    Exports the evaluation to CSV.
.NOTES
    Author:  Daren9m
    CMMC:    SC.L2-3.13.11 — Employ FIPS-Validated Cryptography
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
# 1. Check for FIPS algorithm policy in custom OMA-URI profiles
# ------------------------------------------------------------------
try {
    Write-Verbose 'Checking Intune device configurations for FIPS algorithm policy...'
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

    $fipsEnforced = $false
    $policyDetail = 'Not configured'

    foreach ($config in $configList) {
        $odataType = $config['@odata.type']

        # Check custom OMA-URI profiles for FIPS policy
        if ($odataType -match 'windows10CustomConfiguration') {
            $omaSettings = $config['omaSettings']
            if ($omaSettings) {
                foreach ($setting in $omaSettings) {
                    $omaUri = $setting['omaUri']
                    if ($omaUri -match 'Cryptography/AllowFipsAlgorithmPolicy') {
                        $omaValue = $setting['value']
                        if ($omaValue -eq 1 -or $omaValue -eq '1' -or $omaValue -eq $true) {
                            $fipsEnforced = $true
                            $policyDetail = "FIPS enabled via OMA-URI (Policy: $($config['displayName']))"
                        }
                        else {
                            $policyDetail = "FIPS setting found but not enabled (Value: $omaValue, Policy: $($config['displayName']))"
                        }
                    }
                }
            }
        }

        # Also check Settings Catalog / Endpoint Protection for FIPS-related settings
        if ($odataType -match 'windows10EndpointProtectionConfiguration') {
            $displayName = $config['displayName']
            if ($displayName -match 'FIPS|Cryptograph') {
                $policyDetail = "Potential FIPS config via Endpoint Protection (Policy: $displayName)"
            }
        }
    }

    $settingParams = @{
        Category         = 'FIPS Cryptography'
        Setting          = 'FIPS Algorithm Policy Enforced on Windows Devices'
        CurrentValue     = $policyDetail
        RecommendedValue = 'FIPS algorithm policy enabled via Intune OMA-URI'
        Status           = if ($fipsEnforced) { 'Pass' } else { 'Fail' }
        CheckId          = 'INTUNE-FIPS-001'
        Remediation      = 'Intune admin center > Devices > Configuration > Create profile > Custom OMA-URI > Add setting: ./Device/Vendor/MSFT/Policy/Config/Cryptography/AllowFipsAlgorithmPolicy = 1.'
    }
    Add-Setting @settingParams
}
catch {
    if ($_.Exception.Message -match '403|Forbidden|Authorization') {
        $settingParams = @{
            Category         = 'FIPS Cryptography'
            Setting          = 'FIPS Algorithm Policy Enforced on Windows Devices'
            CurrentValue     = 'Insufficient permissions or license (Intune required)'
            RecommendedValue = 'FIPS algorithm policy enabled via Intune OMA-URI'
            Status           = 'Review'
            CheckId          = 'INTUNE-FIPS-001'
            Remediation      = 'Requires DeviceManagementConfiguration.Read.All permission and Intune license.'
        }
        Add-Setting @settingParams
    }
    else {
        Write-Warning "Could not check FIPS cryptography configuration: $_"
    }
}

# ------------------------------------------------------------------
# Output results
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'Intune FIPS'
