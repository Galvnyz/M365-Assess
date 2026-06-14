<#
.SYNOPSIS
    Evaluates whether Intune compliance policies require device encryption on
    iOS and Android devices.
.DESCRIPTION
    Queries Intune device compliance policies and emits one result row per iOS
    and Android compliance policy showing whether storageRequireEncryption is
    enabled. If no policy exists for a platform, a Fail row is emitted for that
    platform. Satisfies the CMMC requirement to encrypt CUI on mobile devices.

    Requires an active Microsoft Graph connection with
    DeviceManagementConfiguration.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> .\Intune\Get-IntuneMobileEncryptConfig.ps1

    Displays per-policy mobile encryption compliance evaluation results.
.EXAMPLE
    PS> .\Intune\Get-IntuneMobileEncryptConfig.ps1 -OutputPath '.\intune-mobileencrypt.csv'

    Exports the per-policy evaluation to CSV.
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


$remediationText = 'Intune admin center > Devices > Compliance > Create/edit iOS and Android compliance policies > Require device encryption.'

# ------------------------------------------------------------------
# 1. Emit one row per iOS and Android compliance policy
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

    $iosCount    = 0
    $androidCount = 0

    foreach ($policy in $policyList) {
        $odataType = $policy['@odata.type']
        $name = $policy['displayName']

        if ($odataType -match 'iosCompliancePolicy') {
            $iosCount++
            $encrypted = $policy['storageRequireEncryption'] -eq $true
            $settingParams = @{
                Category         = 'Mobile Encryption'
                Setting          = "Storage Encryption Required (iOS) — $name"
                CurrentValue     = if ($encrypted) { 'Encryption required' } else { 'Encryption not required' }
                RecommendedValue = 'storageRequireEncryption: true'
                Status           = if ($encrypted) { 'Pass' } else { 'Fail' }
                CheckId          = 'INTUNE-MOBILEENCRYPT-001'
                Remediation      = $remediationText
            }
            Add-Setting @settingParams
        }
        elseif ($odataType -match 'androidCompliancePolicy|androidDeviceOwnerCompliancePolicy|androidWorkProfileCompliancePolicy') {
            $androidCount++
            $encrypted = $policy['storageRequireEncryption'] -eq $true
            $settingParams = @{
                Category         = 'Mobile Encryption'
                Setting          = "Storage Encryption Required (Android) — $name"
                CurrentValue     = if ($encrypted) { 'Encryption required' } else { 'Encryption not required' }
                RecommendedValue = 'storageRequireEncryption: true'
                Status           = if ($encrypted) { 'Pass' } else { 'Fail' }
                CheckId          = 'INTUNE-MOBILEENCRYPT-001'
                Remediation      = $remediationText
            }
            Add-Setting @settingParams
        }
    }

    # Sentinel rows for platforms with no compliance policy at all
    if ($iosCount -eq 0) {
        $settingParams = @{
            Category         = 'Mobile Encryption'
            Setting          = 'Storage Encryption Required (iOS)'
            CurrentValue     = 'No iOS compliance policy found'
            RecommendedValue = 'iOS compliance policy with storageRequireEncryption: true'
            Status           = 'Fail'
            CheckId          = 'INTUNE-MOBILEENCRYPT-001'
            Remediation      = $remediationText
        }
        Add-Setting @settingParams
    }
    if ($androidCount -eq 0) {
        $settingParams = @{
            Category         = 'Mobile Encryption'
            Setting          = 'Storage Encryption Required (Android)'
            CurrentValue     = 'No Android compliance policy found'
            RecommendedValue = 'Android compliance policy with storageRequireEncryption: true'
            Status           = 'Fail'
            CheckId          = 'INTUNE-MOBILEENCRYPT-001'
            Remediation      = $remediationText
        }
        Add-Setting @settingParams
    }
}
catch {
    if ($_.Exception.Message -match '403|Forbidden|Authorization') {
        $settingParams = @{
            Category         = 'Mobile Encryption'
            Setting          = 'Storage Encryption Required on iOS and Android'
            CurrentValue     = 'Insufficient permissions or license (Intune required)'
            RecommendedValue = 'iOS and Android compliance policies with storageRequireEncryption: true'
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
