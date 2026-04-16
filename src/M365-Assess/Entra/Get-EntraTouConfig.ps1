<#
.SYNOPSIS
    Evaluates whether Terms of Use agreement policies are configured in Entra ID.
.DESCRIPTION
    Checks whether at least one Terms of Use (ToU) agreement policy exists in
    Entra ID and is active. This satisfies the CMMC requirement for privacy and
    security notices before granting system access.

    Requires an active Microsoft Graph connection with Agreement.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> .\Entra\Get-EntraTouConfig.ps1

    Displays Terms of Use evaluation results.
.EXAMPLE
    PS> .\Entra\Get-EntraTouConfig.ps1 -OutputPath '.\entra-tou-config.csv'

    Exports the evaluation to CSV.
.NOTES
    Author:  Daren9m
    CMMC:    AC.L2-3.1.9 — Privacy and Security Notices
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
# 1. Check for Terms of Use agreements
# ------------------------------------------------------------------
try {
    Write-Verbose 'Checking for Terms of Use agreements...'
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/v1.0/agreements'
        ErrorAction = 'Stop'
    }
    $agreements = Invoke-MgGraphRequest @graphParams

    $agreementList = @()
    if ($agreements -and $agreements['value']) {
        $agreementList = @($agreements['value'])
    }

    $agreementCount = $agreementList.Count

    $activeAgreements = @($agreementList | Where-Object { $_['isViewingBeforeAcceptanceRequired'] -eq $true })
    $status = if ($activeAgreements.Count -gt 0) { 'Pass' } elseif ($agreementCount -gt 0) { 'Warning' } else { 'Fail' }

    $currentValue = switch ($status) {
        'Pass'    { "$($activeAgreements.Count) agreement(s) with acceptance required before viewing" }
        'Warning' { "Agreement exists but acceptance not required before viewing" }
        default   { 'No agreements configured' }
    }

    $settingParams = @{
        Category         = 'Terms of Use'
        Setting          = 'Terms of Use Agreement Policy'
        CurrentValue     = $currentValue
        RecommendedValue = 'At least one Terms of Use agreement with isViewingBeforeAcceptanceRequired = true'
        Status           = $status
        CheckId          = 'ENTRA-TOU-001'
        Remediation      = 'Entra admin center > Identity Governance > Terms of use. Verify agreements have "Require users to expand the terms of use" enabled and are assigned via Conditional Access policies.'
    }
    Add-Setting @settingParams
}
catch {
    if ($_.Exception.Message -match '403|Forbidden|Authorization') {
        $settingParams = @{
            Category         = 'Terms of Use'
            Setting          = 'Terms of Use Agreement Policy'
            CurrentValue     = 'Insufficient permissions'
            RecommendedValue = 'At least one Terms of Use agreement configured and assigned'
            Status           = 'Review'
            CheckId          = 'ENTRA-TOU-001'
            Remediation      = 'Requires Agreement.Read.All permission.'
        }
        Add-Setting @settingParams
    }
    else {
        Write-Warning "Could not check Terms of Use configuration: $_"
    }
}

# ------------------------------------------------------------------
# Output results
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'Entra ToU'
