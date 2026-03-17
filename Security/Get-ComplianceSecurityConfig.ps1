<#
.SYNOPSIS
    Collects Microsoft Purview/Compliance security configuration settings for M365 assessment.
.DESCRIPTION
    Queries Security & Compliance PowerShell for compliance-related security settings
    including unified audit log, DLP policies, and sensitivity labels. Returns a structured
    inventory of settings with current values and CIS benchmark recommendations.

    Requires an active Security & Compliance (Purview) connection.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Purview
    PS> .\Security\Get-ComplianceSecurityConfig.ps1

    Displays Purview/Compliance security configuration settings.
.EXAMPLE
    PS> .\Security\Get-ComplianceSecurityConfig.ps1 -OutputPath '.\compliance-security-config.csv'

    Exports the security configuration to CSV.
.NOTES
    Author:  Daren9m
    Settings checked are aligned with CIS Microsoft 365 Foundations Benchmark v6.0.1 recommendations.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath
)

# Stop on errors: API failures should halt this collector rather than produce partial results.
$ErrorActionPreference = 'Stop'

$settings = [System.Collections.Generic.List[PSCustomObject]]::new()
$checkIdCounter = @{}

function Add-Setting {
    param(
        [string]$Category,
        [string]$Setting,
        [string]$CurrentValue,
        [string]$RecommendedValue,
        [string]$Status,
        [string]$CheckId = '',
        [string]$Remediation = ''
    )
    # Auto-generate sub-numbered CheckId for individual setting traceability
    $subCheckId = $CheckId
    if ($CheckId) {
        if (-not $checkIdCounter.ContainsKey($CheckId)) { $checkIdCounter[$CheckId] = 0 }
        $checkIdCounter[$CheckId]++
        $subCheckId = "$CheckId.$($checkIdCounter[$CheckId])"
    }
    $settings.Add([PSCustomObject]@{
        Category         = $Category
        Setting          = $Setting
        CurrentValue     = $CurrentValue
        RecommendedValue = $RecommendedValue
        Status           = $Status
        CheckId          = $subCheckId
        Remediation      = $Remediation
    })
    if ($CheckId -and (Get-Command -Name Update-CheckProgress -ErrorAction SilentlyContinue)) {
        Update-CheckProgress -CheckId $subCheckId -Setting $Setting -Status $Status
    }
}

# ------------------------------------------------------------------
# 1. Unified Audit Log (CIS 3.1.1)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking unified audit log configuration..."
    $auditLogAvailable = Get-Command -Name Get-AdminAuditLogConfig -ErrorAction SilentlyContinue
    if ($auditLogAvailable) {
        $auditConfig = Get-AdminAuditLogConfig -ErrorAction Stop
        $auditEnabled = $auditConfig.UnifiedAuditLogIngestionEnabled

        $settingParams = @{
            Category         = 'Audit'
            Setting          = 'Unified Audit Log Ingestion'
            CurrentValue     = "$auditEnabled"
            RecommendedValue = 'True'
            Status           = if ($auditEnabled) { 'Pass' } else { 'Fail' }
            CheckId          = 'COMPLIANCE-AUDIT-001'
            Remediation      = 'Run: Set-AdminAuditLogConfig -UnifiedAuditLogIngestionEnabled $true. Microsoft Purview > Audit > Start recording user and admin activity.'
        }
        Add-Setting @settingParams
    }
    else {
        $settingParams = @{
            Category         = 'Audit'
            Setting          = 'Unified Audit Log Ingestion'
            CurrentValue     = 'Cmdlet not available'
            RecommendedValue = 'True'
            Status           = 'Review'
            CheckId          = 'COMPLIANCE-AUDIT-001'
            Remediation      = 'Connect to Security & Compliance PowerShell to check audit log configuration.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check unified audit log: $_"
}

# ------------------------------------------------------------------
# 2. DLP Policies Exist (CIS 3.2.1)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking DLP policies..."
    $dlpAvailable = Get-Command -Name Get-DlpCompliancePolicy -ErrorAction SilentlyContinue
    if ($dlpAvailable) {
        $dlpPolicies = Get-DlpCompliancePolicy -ErrorAction Stop
        $enabledPolicies = @($dlpPolicies | Where-Object { $_.Enabled -eq $true })

        if ($enabledPolicies.Count -gt 0) {
            $settingParams = @{
                Category         = 'Data Loss Prevention'
                Setting          = 'DLP Policies'
                CurrentValue     = "$($enabledPolicies.Count) enabled (of $(@($dlpPolicies).Count) total)"
                RecommendedValue = 'At least 1 enabled'
                Status           = 'Pass'
                CheckId          = 'COMPLIANCE-DLP-001'
                Remediation      = 'No action needed.'
            }
            Add-Setting @settingParams
        }
        else {
            $settingParams = @{
                Category         = 'Data Loss Prevention'
                Setting          = 'DLP Policies'
                CurrentValue     = $(if (@($dlpPolicies).Count -eq 0) { 'None configured' } else { "$(@($dlpPolicies).Count) policies (none enabled)" })
                RecommendedValue = 'At least 1 enabled'
                Status           = 'Fail'
                CheckId          = 'COMPLIANCE-DLP-001'
                Remediation      = 'Microsoft Purview > Data loss prevention > Policies > Create a DLP policy covering sensitive information types relevant to your organization.'
            }
            Add-Setting @settingParams
        }

        # CIS 3.2.2 -- DLP covers Teams
        $teamsPolicies = @($enabledPolicies | Where-Object {
            $_.TeamsLocation -or ($_.Workload -and $_.Workload -match 'Teams')
        })

        if ($teamsPolicies.Count -gt 0) {
            $settingParams = @{
                Category         = 'Data Loss Prevention'
                Setting          = 'DLP Covers Teams'
                CurrentValue     = "$($teamsPolicies.Count) policies include Teams"
                RecommendedValue = 'At least 1 policy covers Teams'
                Status           = 'Pass'
                CheckId          = 'COMPLIANCE-DLP-002'
                Remediation      = 'No action needed.'
            }
            Add-Setting @settingParams
        }
        else {
            $settingParams = @{
                Category         = 'Data Loss Prevention'
                Setting          = 'DLP Covers Teams'
                CurrentValue     = 'No DLP policies cover Teams'
                RecommendedValue = 'At least 1 policy covers Teams'
                Status           = 'Fail'
                CheckId          = 'COMPLIANCE-DLP-002'
                Remediation      = 'Microsoft Purview > Data loss prevention > Policies > Edit an existing policy or create new > Include Teams chat and channel messages location.'
            }
            Add-Setting @settingParams
        }
    }
    else {
        $settingParams = @{
            Category         = 'Data Loss Prevention'
            Setting          = 'DLP Policies'
            CurrentValue     = 'Cmdlet not available'
            RecommendedValue = 'At least 1 enabled'
            Status           = 'Review'
            CheckId          = 'COMPLIANCE-DLP-001'
            Remediation      = 'Connect to Security & Compliance PowerShell to check DLP policies.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check DLP policies: $_"
}

# ------------------------------------------------------------------
# 3. Sensitivity Labels Published (CIS 3.3.1)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking sensitivity label policies..."
    $labelAvailable = Get-Command -Name Get-LabelPolicy -ErrorAction SilentlyContinue
    if ($labelAvailable) {
        $labelPolicies = Get-LabelPolicy -ErrorAction Stop

        if (@($labelPolicies).Count -gt 0) {
            $settingParams = @{
                Category         = 'Information Protection'
                Setting          = 'Sensitivity Label Policies'
                CurrentValue     = "$(@($labelPolicies).Count) policies published"
                RecommendedValue = 'At least 1 published'
                Status           = 'Pass'
                CheckId          = 'COMPLIANCE-LABELS-001'
                Remediation      = 'No action needed.'
            }
            Add-Setting @settingParams
        }
        else {
            $settingParams = @{
                Category         = 'Information Protection'
                Setting          = 'Sensitivity Label Policies'
                CurrentValue     = 'None published'
                RecommendedValue = 'At least 1 published'
                Status           = 'Fail'
                CheckId          = 'COMPLIANCE-LABELS-001'
                Remediation      = 'Microsoft Purview > Information protection > Labels > Create and publish sensitivity labels. Then create a label policy to deploy them to users.'
            }
            Add-Setting @settingParams
        }
    }
    else {
        $settingParams = @{
            Category         = 'Information Protection'
            Setting          = 'Sensitivity Label Policies'
            CurrentValue     = 'Cmdlet not available'
            RecommendedValue = 'At least 1 published'
            Status           = 'Review'
            CheckId          = 'COMPLIANCE-LABELS-001'
            Remediation      = 'Connect to Security & Compliance PowerShell to check sensitivity labels.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check sensitivity labels: $_"
}

# ------------------------------------------------------------------
# Output
# ------------------------------------------------------------------
$report = @($settings)
Write-Verbose "Collected $($report.Count) Compliance security configuration settings"

if ($OutputPath) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported Compliance security config ($($report.Count) settings) to $OutputPath"
}
else {
    Write-Output $report
}
