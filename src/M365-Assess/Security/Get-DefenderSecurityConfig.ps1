<#
.SYNOPSIS
    Collects Microsoft Defender for Office 365 security configuration settings for M365 assessment.
.DESCRIPTION
    Queries Exchange Online Protection and Defender for Office 365 policies to evaluate
    security configuration including anti-phishing (impersonation protection, DMARC
    enforcement), anti-spam (threshold levels, bulk filtering), anti-malware (common
    attachment filter, ZAP), Safe Links, and Safe Attachments. Returns a structured
    inventory of settings with current values and CIS benchmark recommendations.

    Handles tenants without Defender for Office 365 licensing gracefully by checking
    cmdlet availability before querying.

    Requires an active Exchange Online connection (Connect-ExchangeOnline).
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service ExchangeOnline
    PS> .\Security\Get-DefenderSecurityConfig.ps1

    Displays Defender for Office 365 security configuration settings.
.EXAMPLE
    PS> .\Security\Get-DefenderSecurityConfig.ps1 -OutputPath '.\defender-security-config.csv'

    Exports the security configuration to CSV.
.NOTES
    Author:  Daren9m
    Settings checked are aligned with CIS Microsoft 365 Foundations Benchmark v6.0.1 recommendations.
    Some checks require Defender for Office 365 Plan 1 or Plan 2 licensing.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath
)

# Stop on errors: API failures should halt this collector rather than produce partial results.
$ErrorActionPreference = 'Stop'

# Load shared security-config helpers
$_scriptDir = if ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { $PSScriptRoot }
. (Join-Path -Path $_scriptDir -ChildPath '..\Common\SecurityConfigHelper.ps1')

$ctx = Initialize-SecurityConfig
$settings = $ctx.Settings
$checkIdCounter = $ctx.CheckIdCounter

function Add-Setting {
    param(
        [string]$Category,
        [string]$Setting,
        [string]$CurrentValue,
        [string]$RecommendedValue,
        [string]$Status,
        [string]$CheckId = '',
        [string]$Remediation = '',
        [PSCustomObject]$Evidence = $null
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
        Evidence         = $Evidence
    }
    Add-SecuritySetting @p
}

# ------------------------------------------------------------------
# Helpers & preset policy detection
# ------------------------------------------------------------------
. (Join-Path -Path $_scriptDir -ChildPath 'DefenderHelpers.ps1')

# ------------------------------------------------------------------
# Check sections (dot-sourced, run in shared scope)
# ------------------------------------------------------------------
. (Join-Path -Path $_scriptDir -ChildPath 'DefenderAntiPhishingChecks.ps1')
. (Join-Path -Path $_scriptDir -ChildPath 'DefenderAntiSpamChecks.ps1')
. (Join-Path -Path $_scriptDir -ChildPath 'DefenderAntiMalwareChecks.ps1')
. (Join-Path -Path $_scriptDir -ChildPath 'DefenderSafeAttLinksChecks.ps1')
. (Join-Path -Path $_scriptDir -ChildPath 'DefenderPresetZapChecks.ps1')

# ------------------------------------------------------------------
# Output
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'Defender'
