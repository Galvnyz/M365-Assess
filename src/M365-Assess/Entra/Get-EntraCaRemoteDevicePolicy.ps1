<#
.SYNOPSIS
    Evaluates whether a Conditional Access policy enforces device compliance for
    remote access by requiring compliantDevice and excluding a corporate named location.
.DESCRIPTION
    Queries Conditional Access policies for an enabled policy that both grants access
    only to compliant devices and excludes a named location (corporate network), signaling
    that the policy applies to remote/external access. Satisfies CMMC AC.L2-3.1.13.

    Requires an active Microsoft Graph connection with
    Policy.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> .\Entra\Get-EntraCaRemoteDevicePolicy.ps1

    Displays CA remote device policy evaluation results.
.EXAMPLE
    PS> .\Entra\Get-EntraCaRemoteDevicePolicy.ps1 -OutputPath '.\entra-caremotedevice.csv'

    Exports the evaluation to CSV.
.NOTES
    Author:  Daren9m
    CMMC:    AC.L2-3.1.13 — Employ cryptographic mechanisms to protect CUI during transmission
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
# 1. Check CA policies for compliant device enforcement on remote access
# ------------------------------------------------------------------
try {
    Write-Verbose 'Checking CA policies for compliant device enforcement on remote access...'
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/v1.0/identity/conditionalAccess/policies'
        ErrorAction = 'Stop'
    }
    $caResponse = Invoke-MgGraphRequest @graphParams

    $policies = @()
    if ($caResponse -and $caResponse['value']) { $policies = @($caResponse['value']) }

    $passPolicy = $null
    $warnPolicy = $null

    foreach ($policy in $policies) {
        $state = $policy['state']
        if ($state -eq 'disabled') { continue }

        $grantControls = $policy['grantControls']
        if (-not $grantControls) { continue }
        $builtIn = @($grantControls['builtInControls'])
        if ('compliantDevice' -notin $builtIn) { continue }

        $excludeLocations = @()
        $locations = $policy['conditions']['locations']
        if ($locations -and $locations['excludeLocations']) {
            $excludeLocations = @($locations['excludeLocations'])
        }
        if ($excludeLocations.Count -eq 0) { continue }

        if ($state -eq 'enabled') { $passPolicy = $policy; break }
        if ($state -eq 'enabledForReportingButNotEnforced' -and -not $warnPolicy) {
            $warnPolicy = $policy
        }
    }

    if ($passPolicy) {
        $settingParams = @{
            Category         = 'Remote Access'
            Setting          = 'CA Policy: Compliant Device Required for Remote Access'
            CurrentValue     = "Enabled: '$($passPolicy['displayName'])' requires compliantDevice with named location exclusion"
            RecommendedValue = 'Enabled CA policy requiring compliantDevice grant with at least one named location excluded'
            Status           = 'Pass'
            CheckId          = 'CA-REMOTEDEVICE-001'
            Remediation      = 'Verify the CA policy is scoped to all users and targets remote access scenarios.'
        }
        Add-Setting @settingParams
    }
    elseif ($warnPolicy) {
        $settingParams = @{
            Category         = 'Remote Access'
            Setting          = 'CA Policy: Compliant Device Required for Remote Access'
            CurrentValue     = "Report-only: '$($warnPolicy['displayName'])' - not enforced"
            RecommendedValue = 'Enabled CA policy requiring compliantDevice grant with at least one named location excluded'
            Status           = 'Warning'
            CheckId          = 'CA-REMOTEDEVICE-001'
            Remediation      = 'Change the CA policy state from report-only to enabled to enforce compliant device requirements.'
        }
        Add-Setting @settingParams
    }
    else {
        $settingParams = @{
            Category         = 'Remote Access'
            Setting          = 'CA Policy: Compliant Device Required for Remote Access'
            CurrentValue     = 'No CA policy found requiring compliantDevice with a named location exclusion'
            RecommendedValue = 'Enabled CA policy requiring compliantDevice grant with at least one named location excluded'
            Status           = 'Fail'
            CheckId          = 'CA-REMOTEDEVICE-001'
            Remediation      = 'Create a Conditional Access policy that requires device compliance (compliantDevice) and excludes a named corporate network location to enforce remote access controls.'
        }
        Add-Setting @settingParams
    }
}
catch {
    if ($_.Exception.Message -match '403|Forbidden|Authorization') {
        $settingParams = @{
            Category         = 'Remote Access'
            Setting          = 'CA Policy: Compliant Device Required for Remote Access'
            CurrentValue     = 'Insufficient permissions (Policy.Read.All required)'
            RecommendedValue = 'Enabled CA policy requiring compliantDevice grant with at least one named location excluded'
            Status           = 'Review'
            CheckId          = 'CA-REMOTEDEVICE-001'
            Remediation      = 'Requires Policy.Read.All permission and Entra ID P1 or P2 license.'
        }
        Add-Setting @settingParams
    }
    else {
        Write-Warning "Could not check CA remote device policy: $_"
    }
}

# ------------------------------------------------------------------
# Output results
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'Entra CA Remote Device'
