<#
.SYNOPSIS
    Collects Microsoft Purview data lifecycle retention compliance policy configuration.
.DESCRIPTION
    Queries the Security & Compliance Center for retention compliance policies and
    their associated rules. Reports on policy existence, workload coverage (Exchange,
    Teams, SharePoint/OneDrive), and enforcement mode — essential for verifying that
    data lifecycle management requirements are met per regulatory and organizational
    standards.

    Requires an active Security & Compliance (Purview) connection via Connect-IPPSSession
    or Connect-Service -Service Purview.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Purview
    PS> .\Purview\Get-PurviewRetentionConfig.ps1

    Displays Purview retention compliance policy configuration settings.
.EXAMPLE
    PS> .\Purview\Get-PurviewRetentionConfig.ps1 -OutputPath '.\purview-retention-config.csv'

    Exports retention policy configuration to CSV.
.NOTES
    Author:  Daren9m
    Settings checked are aligned with CIS Microsoft 365 Foundations Benchmark v6.0.1
    and NIST SP 800-53 AU-11 (Audit Record Retention) recommendations.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath
)

# Continue on errors: non-critical checks should not block remaining assessments.
$ErrorActionPreference = 'Continue'

# Load shared security-config helpers
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
# 1. Retention Compliance Policies — existence and workload coverage
# ------------------------------------------------------------------
$policies = $null
try {
    Write-Verbose "Checking Purview retention compliance policies..."
    $retentionCmdAvailable = Get-Command -Name Get-RetentionCompliancePolicy -ErrorAction SilentlyContinue
    if ($retentionCmdAvailable) {
        $policies = @(Get-RetentionCompliancePolicy -ErrorAction Stop)
    }
    else {
        Write-Warning "Get-RetentionCompliancePolicy is not available. Connect to Security & Compliance PowerShell: Connect-Service -Service Purview."
    }
}
catch {
    Write-Warning "Could not retrieve retention compliance policies: $($_.Exception.Message)"
}

if ($null -ne $policies) {
    $enabledPolicies = @($policies | Where-Object { $_.Enabled -ne $false })

    # Check 1: Any enabled retention policies exist
    if ($enabledPolicies.Count -gt 0) {
        $settingParams = @{
            Category         = 'Retention Policies'
            Setting          = 'Retention Policies Configured'
            CurrentValue     = "$($enabledPolicies.Count) enabled (of $($policies.Count) total)"
            RecommendedValue = 'At least 1 enabled'
            Status           = 'Pass'
            CheckId          = 'PURVIEW-RETENTION-001'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }
    else {
        $currentVal = if ($policies.Count -eq 0) { 'None configured' } else { "$($policies.Count) policies (none enabled)" }
        $settingParams = @{
            Category         = 'Retention Policies'
            Setting          = 'Retention Policies Configured'
            CurrentValue     = $currentVal
            RecommendedValue = 'At least 1 enabled'
            Status           = 'Fail'
            CheckId          = 'PURVIEW-RETENTION-001'
            Remediation      = 'Microsoft Purview > Data lifecycle management > Retention policies > Create a retention policy to preserve or delete content per your requirements.'
        }
        Add-Setting @settingParams
    }

    # Check 2: Exchange covered by a retention policy
    $exchangePolicies = @($enabledPolicies | Where-Object {
        ($_.ExchangeLocation -and @($_.ExchangeLocation).Count -gt 0) -or
        ($_.Workload -and $_.Workload -match 'Exchange')
    })
    if ($exchangePolicies.Count -gt 0) {
        $settingParams = @{
            Category         = 'Retention Policies'
            Setting          = 'Exchange Covered by Retention'
            CurrentValue     = "$($exchangePolicies.Count) policies cover Exchange"
            RecommendedValue = 'At least 1 policy covers Exchange'
            Status           = 'Pass'
            CheckId          = 'PURVIEW-RETENTION-002'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }
    else {
        $settingParams = @{
            Category         = 'Retention Policies'
            Setting          = 'Exchange Covered by Retention'
            CurrentValue     = 'No retention policies cover Exchange'
            RecommendedValue = 'At least 1 policy covers Exchange'
            Status           = 'Fail'
            CheckId          = 'PURVIEW-RETENTION-002'
            Remediation      = 'Microsoft Purview > Data lifecycle management > Retention policies > Create or edit a retention policy to include Exchange email and mailboxes.'
        }
        Add-Setting @settingParams
    }

    # Check 3: Teams covered by a retention policy
    $teamsPolicies = @($enabledPolicies | Where-Object {
        ($_.TeamsChannelLocation -and @($_.TeamsChannelLocation).Count -gt 0) -or
        ($_.TeamsChatLocation    -and @($_.TeamsChatLocation).Count    -gt 0) -or
        ($_.Workload -and $_.Workload -match 'Teams')
    })
    if ($teamsPolicies.Count -gt 0) {
        $settingParams = @{
            Category         = 'Retention Policies'
            Setting          = 'Teams Covered by Retention'
            CurrentValue     = "$($teamsPolicies.Count) policies cover Teams"
            RecommendedValue = 'At least 1 policy covers Teams'
            Status           = 'Pass'
            CheckId          = 'PURVIEW-RETENTION-003'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }
    else {
        $settingParams = @{
            Category         = 'Retention Policies'
            Setting          = 'Teams Covered by Retention'
            CurrentValue     = 'No retention policies cover Teams'
            RecommendedValue = 'At least 1 policy covers Teams'
            Status           = 'Fail'
            CheckId          = 'PURVIEW-RETENTION-003'
            Remediation      = 'Microsoft Purview > Data lifecycle management > Retention policies > Create or edit a retention policy to include Teams channel messages and chats.'
        }
        Add-Setting @settingParams
    }

    # Check 4: SharePoint/OneDrive covered by a retention policy
    $sharepointPolicies = @($enabledPolicies | Where-Object {
        ($_.SharePointLocation -and @($_.SharePointLocation).Count -gt 0) -or
        ($_.OneDriveLocation   -and @($_.OneDriveLocation).Count   -gt 0) -or
        ($_.Workload -and $_.Workload -match 'SharePoint')
    })
    if ($sharepointPolicies.Count -gt 0) {
        $settingParams = @{
            Category         = 'Retention Policies'
            Setting          = 'SharePoint/OneDrive Covered by Retention'
            CurrentValue     = "$($sharepointPolicies.Count) policies cover SharePoint/OneDrive"
            RecommendedValue = 'At least 1 policy covers SharePoint/OneDrive'
            Status           = 'Pass'
            CheckId          = 'PURVIEW-RETENTION-004'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }
    else {
        $settingParams = @{
            Category         = 'Retention Policies'
            Setting          = 'SharePoint/OneDrive Covered by Retention'
            CurrentValue     = 'No retention policies cover SharePoint/OneDrive'
            RecommendedValue = 'At least 1 policy covers SharePoint/OneDrive'
            Status           = 'Fail'
            CheckId          = 'PURVIEW-RETENTION-004'
            Remediation      = 'Microsoft Purview > Data lifecycle management > Retention policies > Create or edit a retention policy to include SharePoint sites and OneDrive accounts.'
        }
        Add-Setting @settingParams
    }

    # Check 5: All active policies are in Enforce mode (not simulation/test)
    $testModePolicies = @($enabledPolicies | Where-Object { $_.Mode -ne 'Enforce' })
    if ($testModePolicies.Count -eq 0 -and $enabledPolicies.Count -gt 0) {
        $settingParams = @{
            Category         = 'Retention Policies'
            Setting          = 'Retention Policies in Enforce Mode'
            CurrentValue     = "All $($enabledPolicies.Count) enabled policies in Enforce mode"
            RecommendedValue = 'All policies in Enforce mode'
            Status           = 'Pass'
            CheckId          = 'PURVIEW-RETENTION-005'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }
    elseif ($testModePolicies.Count -gt 0) {
        $testNames = ($testModePolicies | Select-Object -ExpandProperty Name -First 5) -join ', '
        $settingParams = @{
            Category         = 'Retention Policies'
            Setting          = 'Retention Policies in Enforce Mode'
            CurrentValue     = "$($testModePolicies.Count) policies in simulation/test mode: $testNames"
            RecommendedValue = 'All policies in Enforce mode'
            Status           = 'Warning'
            CheckId          = 'PURVIEW-RETENTION-005'
            Remediation      = 'Microsoft Purview > Data lifecycle management > Retention policies > Edit each policy in simulation mode and switch it to Enforce once validated.'
        }
        Add-Setting @settingParams
    }
    else {
        $settingParams = @{
            Category         = 'Retention Policies'
            Setting          = 'Retention Policies in Enforce Mode'
            CurrentValue     = 'No enabled policies to evaluate'
            RecommendedValue = 'At least 1 policy in Enforce mode'
            Status           = 'Review'
            CheckId          = 'PURVIEW-RETENTION-005'
            Remediation      = 'Create and enforce retention policies in Microsoft Purview > Data lifecycle management.'
        }
        Add-Setting @settingParams
    }
}
else {
    # Cmdlet not available -- Purview connection required
    $settingParams = @{
        Category         = 'Retention Policies'
        Setting          = 'Retention Policies Configured'
        CurrentValue     = 'Cmdlet not available'
        RecommendedValue = 'At least 1 enabled'
        Status           = 'Review'
        CheckId          = 'PURVIEW-RETENTION-001'
        Remediation      = 'Connect to Security & Compliance PowerShell to check retention policies: Connect-Service -Service Purview.'
    }
    Add-Setting @settingParams
}

# ------------------------------------------------------------------
# Output
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'Purview Retention'
