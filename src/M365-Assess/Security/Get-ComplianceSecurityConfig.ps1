<#
.SYNOPSIS
    Collects Microsoft Purview/Compliance security configuration settings for M365 assessment.
.DESCRIPTION
    Queries Security & Compliance PowerShell for compliance-related security settings
    including unified audit log, DLP policies, sensitivity labels, alert policies,
    auto-labeling, and communication compliance. Returns a structured inventory of
    settings with current values and CIS benchmark recommendations.

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
            Setting          = 'Unified Audit Log (UAL) Ingestion'
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
            Setting          = 'Unified Audit Log (UAL) Ingestion'
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

        # DLP workload coverage -- Exchange and SharePoint/OneDrive
        $exoPolicies  = @($enabledPolicies | Where-Object { $_.ExchangeLocation -or ($_.Workload -and $_.Workload -match 'Exchange') })
        $spodPolicies = @($enabledPolicies | Where-Object { $_.SharePointLocation -or $_.OneDriveLocation -or ($_.Workload -and $_.Workload -match 'SharePoint') })
        $coverageStatus = if ($exoPolicies.Count -gt 0 -and $spodPolicies.Count -gt 0) { 'Pass' }
                          elseif ($exoPolicies.Count -gt 0 -or $spodPolicies.Count -gt 0) { 'Warning' }
                          else { 'Fail' }
        $settingParams = @{
            Category         = 'Data Loss Prevention'
            Setting          = 'DLP Workload Coverage'
            CurrentValue     = "Exchange: $($exoPolicies.Count -gt 0), SharePoint/OneDrive: $($spodPolicies.Count -gt 0)"
            RecommendedValue = 'Policies cover Exchange and SharePoint/OneDrive'
            Status           = $coverageStatus
            CheckId          = 'COMPLIANCE-DLP-003'
            Remediation      = 'Microsoft Purview > Data loss prevention > Policies > Edit existing policies to include Exchange email and SharePoint/OneDrive locations for comprehensive data protection.'
        }
        Add-Setting @settingParams
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
# 4. Security Alert Policies
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking security alert policies..."
    $alertAvailable = Get-Command -Name Get-ProtectionAlert -ErrorAction SilentlyContinue
    if ($alertAvailable) {
        $alerts = @(Get-ProtectionAlert -ErrorAction Stop)
        $enabledAlerts = @($alerts | Where-Object { -not $_.Disabled })
        $alertStatus = if ($enabledAlerts.Count -gt 0) { 'Pass' } else { 'Fail' }
        $settingParams = @{
            Category         = 'Alert Policies'
            Setting          = 'Security Alert Policies Enabled'
            CurrentValue     = "$($enabledAlerts.Count) enabled (of $($alerts.Count) total)"
            RecommendedValue = 'At least 1 enabled'
            Status           = $alertStatus
            CheckId          = 'COMPLIANCE-ALERTPOLICY-001'
            Remediation      = 'Microsoft Purview > Alert policies > Review and enable default alert policies. Ensure high-severity policies for suspicious activity, malware, and privilege escalation are active.'
        }
        Add-Setting @settingParams
    }
    else {
        $settingParams = @{
            Category         = 'Alert Policies'
            Setting          = 'Security Alert Policies Enabled'
            CurrentValue     = 'Cmdlet not available'
            RecommendedValue = 'At least 1 enabled'
            Status           = 'Review'
            CheckId          = 'COMPLIANCE-ALERTPOLICY-001'
            Remediation      = 'Connect to Security & Compliance PowerShell to check alert policies.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check alert policies: $_"
}

# ------------------------------------------------------------------
# 5. Auto-Sensitivity Labeling Policies (requires AIP P2 / E5)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking auto-labeling policies..."
    $autoLabelAvailable = Get-Command -Name Get-AutoSensitivityLabelPolicy -ErrorAction SilentlyContinue
    if ($autoLabelAvailable) {
        $autoLabelPolicies = @(Get-AutoSensitivityLabelPolicy -ErrorAction Stop)
        $enabledAutoLabel  = @($autoLabelPolicies | Where-Object { $_.Enabled -eq $true })
        if ($enabledAutoLabel.Count -gt 0) {
            $autoLabelCount = $enabledAutoLabel.Count
            $settingParams = @{
                Category         = 'Information Protection'
                Setting          = 'Auto-Sensitivity Labeling Policies'
                CurrentValue     = "$autoLabelCount enabled auto-labeling $(if ($autoLabelCount -eq 1) { 'policy' } else { 'policies' })"
                RecommendedValue = 'At least 1 enabled'
                Status           = 'Pass'
                CheckId          = 'COMPLIANCE-LABELS-002'
                Remediation      = 'No action needed.'
            }
            Add-Setting @settingParams
        }
        else {
            $settingParams = @{
                Category         = 'Information Protection'
                Setting          = 'Auto-Sensitivity Labeling Policies'
                CurrentValue     = if ($autoLabelPolicies.Count -eq 0) { 'None configured' } else { "$($autoLabelPolicies.Count) policies (none enabled)" }
                RecommendedValue = 'At least 1 enabled'
                Status           = 'Fail'
                CheckId          = 'COMPLIANCE-LABELS-002'
                Remediation      = 'Microsoft Purview > Information protection > Auto-labeling > Create a policy to automatically classify sensitive content. Requires Azure Information Protection P2 (E5 or E5 Compliance).'
            }
            Add-Setting @settingParams
        }
    }
    else {
        $settingParams = @{
            Category         = 'Information Protection'
            Setting          = 'Auto-Sensitivity Labeling Policies'
            CurrentValue     = 'Cmdlet not available'
            RecommendedValue = 'At least 1 enabled'
            Status           = 'Review'
            CheckId          = 'COMPLIANCE-LABELS-002'
            Remediation      = 'Auto-labeling requires Azure Information Protection P2 (E5 or E5 Compliance). Connect to Security & Compliance PowerShell to verify.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check auto-labeling policies: $_"
}

# ------------------------------------------------------------------
# 6. Communication Compliance Policies (requires E5 Compliance)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking communication compliance policies..."
    $commAvailable = Get-Command -Name Get-CommunicationCompliancePolicy -ErrorAction SilentlyContinue
    if ($commAvailable) {
        $commPolicies  = @(Get-CommunicationCompliancePolicy -ErrorAction Stop)
        $enabledComm   = @($commPolicies | Where-Object { $_.Enabled -eq $true })
        if ($enabledComm.Count -gt 0) {
            $enabledCommCount = $enabledComm.Count
            $settingParams = @{
                Category         = 'Communication Compliance'
                Setting          = 'Communication Compliance Policies'
                CurrentValue     = "$enabledCommCount enabled $(if ($enabledCommCount -eq 1) { 'policy' } else { 'policies' })"
                RecommendedValue = 'At least 1 enabled'
                Status           = 'Pass'
                CheckId          = 'COMPLIANCE-COMMS-001'
                Remediation      = 'No action needed.'
            }
            Add-Setting @settingParams
        }
        else {
            $settingParams = @{
                Category         = 'Communication Compliance'
                Setting          = 'Communication Compliance Policies'
                CurrentValue     = if ($commPolicies.Count -eq 0) { 'None configured' } else { "$($commPolicies.Count) policies (none enabled)" }
                RecommendedValue = 'At least 1 enabled'
                Status           = 'Warning'
                CheckId          = 'COMPLIANCE-COMMS-001'
                Remediation      = 'Microsoft Purview > Communication compliance > Create a policy to monitor communications for policy violations and insider risk. Requires E5 Compliance licensing.'
            }
            Add-Setting @settingParams
        }
    }
    else {
        $settingParams = @{
            Category         = 'Communication Compliance'
            Setting          = 'Communication Compliance Policies'
            CurrentValue     = 'Cmdlet not available'
            RecommendedValue = 'At least 1 enabled'
            Status           = 'Review'
            CheckId          = 'COMPLIANCE-COMMS-001'
            Remediation      = 'Communication compliance requires E5 Compliance licensing. Connect to Security & Compliance PowerShell to verify policy status.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check communication compliance policies: $_"
}

# ------------------------------------------------------------------
# Output
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'Compliance'
