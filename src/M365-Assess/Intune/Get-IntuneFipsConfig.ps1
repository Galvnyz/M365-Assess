<#
.SYNOPSIS
    Evaluates whether Intune configuration profiles enforce FIPS-validated
    cryptography on managed Windows devices.
.DESCRIPTION
    Queries Intune device configuration profiles and emits one result row per
    custom OMA-URI profile containing the FIPS algorithm policy setting
    (./Device/Vendor/MSFT/Policy/Config/Cryptography/AllowFipsAlgorithmPolicy).
    Pass = value 1/true; Fail = OMA-URI present but value is 0/false; Warning =
    endpoint protection profile name suggests FIPS but no OMA-URI is present.
    If no FIPS-related profiles are found, a Fail row is emitted.

    Requires an active Microsoft Graph connection with
    DeviceManagementConfiguration.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> .\Intune\Get-IntuneFipsConfig.ps1

    Displays per-profile FIPS cryptography enforcement evaluation results.
.EXAMPLE
    PS> .\Intune\Get-IntuneFipsConfig.ps1 -OutputPath '.\intune-fips.csv'

    Exports the per-profile evaluation to CSV.
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


$remediationText = 'Intune admin center > Devices > Configuration > Create profile > Custom OMA-URI > Add setting: ./Device/Vendor/MSFT/Policy/Config/Cryptography/AllowFipsAlgorithmPolicy = 1.'

# ------------------------------------------------------------------
# 1. Emit one row per profile with a FIPS-related setting
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

    $matchCount = 0

    foreach ($config in $configList) {
        $odataType   = $config['@odata.type']
        $displayName = $config['displayName']

        if ($odataType -match 'windows10CustomConfiguration') {
            $omaSettings = $config['omaSettings']
            if ($omaSettings) {
                foreach ($setting in @($omaSettings)) {
                    $omaUri = $setting['omaUri']
                    if ($omaUri -match 'Cryptography/AllowFipsAlgorithmPolicy') {
                        $matchCount++
                        $omaValue = $setting['value']
                        $enabled  = ($omaValue -eq 1 -or $omaValue -eq '1' -or $omaValue -eq $true)
                        $settingParams = @{
                            Category         = 'FIPS Cryptography'
                            Setting          = "FIPS Algorithm Policy (OMA-URI) — $displayName"
                            CurrentValue     = "AllowFipsAlgorithmPolicy = $omaValue"
                            RecommendedValue = 'AllowFipsAlgorithmPolicy = 1'
                            Status           = if ($enabled) { 'Pass' } else { 'Fail' }
                            CheckId          = 'INTUNE-FIPS-001'
                            Remediation      = $remediationText
                        }
                        Add-Setting @settingParams
                        break
                    }
                }
            }
        }

        # Endpoint protection profile whose name suggests FIPS — can't confirm without OMA-URI
        if ($odataType -match 'windows10EndpointProtectionConfiguration' -and $displayName -match 'FIPS|Cryptograph') {
            $matchCount++
            $settingParams = @{
                Category         = 'FIPS Cryptography'
                Setting          = "Potential FIPS Policy (verify OMA-URI) — $displayName"
                CurrentValue     = "Profile name suggests FIPS — OMA-URI setting not confirmed"
                RecommendedValue = 'Confirm AllowFipsAlgorithmPolicy OMA-URI is present and set to 1'
                Status           = 'Warning'
                CheckId          = 'INTUNE-FIPS-001'
                Remediation      = $remediationText
            }
            Add-Setting @settingParams
        }
    }

    if ($matchCount -eq 0) {
        $settingParams = @{
            Category         = 'FIPS Cryptography'
            Setting          = 'FIPS Algorithm Policy Enforced on Windows Devices'
            CurrentValue     = 'Not configured'
            RecommendedValue = 'FIPS algorithm policy enabled via Intune OMA-URI'
            Status           = 'Fail'
            CheckId          = 'INTUNE-FIPS-001'
            Remediation      = $remediationText
        }
        Add-Setting @settingParams
    }
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
