<#
.SYNOPSIS
    Assesses SOC 2 Confidentiality trust principle controls against Microsoft 365 configuration.
.DESCRIPTION
    Evaluates Microsoft 365 tenant settings against SOC 2 Trust Service Criteria for
    the Confidentiality principle. Checks SharePoint sharing settings, DLP policies,
    sensitivity labels, retention policies, and guest access governance.

    All operations are strictly read-only (Get-* cmdlets and Graph GET requests only).
    Maps each check to an AICPA SOC 2 Trust Service Criterion reference.

    DISCLAIMER: This tool assists with SOC 2 readiness assessment. It does not
    constitute a SOC 2 audit or certification.

    Requires Microsoft Graph connection and optionally Purview/Compliance connection
    for DLP and label checks.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph
    PS> Connect-Service -Service Purview
    PS> .\SOC2\Get-SOC2ConfidentialityControls.ps1

    Displays SOC 2 Confidentiality control assessment results.
.EXAMPLE
    PS> .\SOC2\Get-SOC2ConfidentialityControls.ps1 -OutputPath '.\soc2-confidentiality.csv'

    Exports SOC 2 Confidentiality control results to CSV.
.NOTES
    Version: 0.4.0
    Author:  Daren9m
#>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

$results = [System.Collections.Generic.List[PSCustomObject]]::new()

# Helper to add a control result
function Add-ControlResult {
    param(
        [string]$TrustPrinciple,
        [string]$TSCReference,
        [string]$ControlId,
        [string]$ControlName,
        [string]$CurrentValue,
        [string]$ExpectedValue,
        [string]$Status,
        [string]$Severity,
        [string]$Evidence = '',
        [string]$Remediation = ''
    )
    $results.Add([PSCustomObject]@{
        TrustPrinciple = $TrustPrinciple
        TSCReference   = $TSCReference
        ControlId      = $ControlId
        ControlName    = $ControlName
        CurrentValue   = $CurrentValue
        ExpectedValue  = $ExpectedValue
        Status         = $Status
        Severity       = $Severity
        Evidence       = $Evidence
        Remediation    = $Remediation
    })
}

# ------------------------------------------------------------------
# C-01: SharePoint Sites Not Publicly Shared (C1.1)
# ------------------------------------------------------------------
try {
    Write-Verbose "C-01: Checking SharePoint tenant sharing capability..."
    $null = Get-Command -Name Get-SPOTenant -ErrorAction Stop
    $spoTenant = Get-SPOTenant -ErrorAction Stop

    $sharingCapability = $spoTenant.SharingCapability.ToString()

    # ExternalUserAndGuestSharing = most permissive (Anyone links)
    # ExternalUserSharingOnly = authenticated guests only
    # ExistingExternalUserSharingOnly = existing guests only
    # Disabled = no external sharing
    $hasAnonymousLinks = $sharingCapability -eq 'ExternalUserAndGuestSharing'

    $currentValue = "SharingCapability: $sharingCapability"
    $status = if ($hasAnonymousLinks) { 'Fail' } else { 'Pass' }

    Add-ControlResult -TrustPrinciple 'Confidentiality' -TSCReference 'C1.1' -ControlId 'C-01' `
        -ControlName 'SharePoint Sites Not Publicly Shared' `
        -CurrentValue $currentValue -ExpectedValue 'SharingCapability not set to ExternalUserAndGuestSharing' `
        -Status $status -Severity 'High' `
        -Evidence "Tenant sharing level: $sharingCapability; Anonymous links: $hasAnonymousLinks" `
        -Remediation 'In SharePoint admin center > Policies > Sharing, restrict to Existing guests or more restrictive.'
}
catch {
    Write-Warning "C-01: SharePoint Online cmdlet not available: $_"
    Add-ControlResult -TrustPrinciple 'Confidentiality' -TSCReference 'C1.1' -ControlId 'C-01' `
        -ControlName 'SharePoint Sites Not Publicly Shared' `
        -CurrentValue 'Unable to check (SPO module not connected)' -ExpectedValue 'No anonymous sharing links' `
        -Status 'Review' -Severity 'High' `
        -Remediation 'Connect to SharePoint Online to evaluate this control.'
}

# ------------------------------------------------------------------
# C-02: External Sharing Restricted (C1.1)
# ------------------------------------------------------------------
try {
    Write-Verbose "C-02: Checking external sharing restrictions..."
    if (-not $spoTenant) {
        $null = Get-Command -Name Get-SPOTenant -ErrorAction Stop
        $spoTenant = Get-SPOTenant -ErrorAction Stop
    }

    $sharingCapability = $spoTenant.SharingCapability.ToString()
    $isMostPermissive = $sharingCapability -eq 'ExternalUserAndGuestSharing'

    $currentValue = "SharingCapability: $sharingCapability"
    $status = if ($isMostPermissive) { 'Fail' } else { 'Pass' }

    Add-ControlResult -TrustPrinciple 'Confidentiality' -TSCReference 'C1.1' -ControlId 'C-02' `
        -ControlName 'External Sharing Restricted' `
        -CurrentValue $currentValue -ExpectedValue 'Not set to most permissive level (ExternalUserAndGuestSharing)' `
        -Status $status -Severity 'High' `
        -Evidence "Sharing capability: $sharingCapability" `
        -Remediation 'In SharePoint admin center > Policies > Sharing, set to New and existing guests or more restrictive.'
}
catch {
    Write-Warning "C-02: Failed to check external sharing: $_"
    Add-ControlResult -TrustPrinciple 'Confidentiality' -TSCReference 'C1.1' -ControlId 'C-02' `
        -ControlName 'External Sharing Restricted' `
        -CurrentValue 'Unable to check (SPO module not connected)' -ExpectedValue 'Restricted external sharing' `
        -Status 'Review' -Severity 'High'
}

# ------------------------------------------------------------------
# C-03: DLP Policies Active and Enforcing (C1.2)
# ------------------------------------------------------------------
try {
    Write-Verbose "C-03: Checking DLP policies..."
    $null = Get-Command -Name Get-DlpCompliancePolicy -ErrorAction Stop
    $dlpPolicies = @(Get-DlpCompliancePolicy -ErrorAction Stop)

    $enforcingPolicies = @($dlpPolicies | Where-Object { $_.Mode -eq 'Enable' })
    $testPolicies = @($dlpPolicies | Where-Object { $_.Mode -like 'Test*' })

    $currentValue = if ($dlpPolicies.Count -eq 0) {
        'No DLP policies found'
    } elseif ($enforcingPolicies.Count -gt 0) {
        "$($enforcingPolicies.Count) enforcing, $($testPolicies.Count) in test mode (of $($dlpPolicies.Count) total)"
    } else {
        "$($dlpPolicies.Count) policies found but none in enforce mode"
    }

    $status = if ($enforcingPolicies.Count -gt 0) { 'Pass' } elseif ($dlpPolicies.Count -gt 0) { 'Fail' } else { 'Fail' }

    Add-ControlResult -TrustPrinciple 'Confidentiality' -TSCReference 'C1.2' -ControlId 'C-03' `
        -ControlName 'DLP Policies Active and Enforcing' `
        -CurrentValue $currentValue -ExpectedValue 'At least one DLP policy in enforcement mode' `
        -Status $status -Severity 'High' `
        -Evidence "Total DLP policies: $($dlpPolicies.Count); Enforcing: $($enforcingPolicies.Count); Test: $($testPolicies.Count)" `
        -Remediation 'In Purview compliance portal > DLP > Policies, create or enable a DLP policy in enforcement mode.'
}
catch {
    Write-Warning "C-03: DLP cmdlets not available: $_"
    Add-ControlResult -TrustPrinciple 'Confidentiality' -TSCReference 'C1.2' -ControlId 'C-03' `
        -ControlName 'DLP Policies Active and Enforcing' `
        -CurrentValue 'Unable to check (Purview not connected)' -ExpectedValue 'DLP policies enforcing' `
        -Status 'Review' -Severity 'High' `
        -Remediation 'Connect to Purview (Security & Compliance) to evaluate DLP policies.'
}

# ------------------------------------------------------------------
# C-04: Sensitivity Labels Published (C1.2)
# ------------------------------------------------------------------
try {
    Write-Verbose "C-04: Checking sensitivity labels..."
    $null = Get-Command -Name Get-Label -ErrorAction Stop
    $labels = @(Get-Label -ErrorAction Stop)

    $enabledLabels = @($labels | Where-Object { $null -eq $_.Disabled -or -not $_.Disabled })

    $currentValue = if ($labels.Count -eq 0) {
        'No sensitivity labels found'
    } else {
        "$($enabledLabels.Count) enabled labels (of $($labels.Count) total)"
    }

    $status = if ($enabledLabels.Count -gt 0) { 'Pass' } else { 'Fail' }

    Add-ControlResult -TrustPrinciple 'Confidentiality' -TSCReference 'C1.2' -ControlId 'C-04' `
        -ControlName 'Sensitivity Labels Published' `
        -CurrentValue $currentValue -ExpectedValue 'At least one sensitivity label enabled and published' `
        -Status $status -Severity 'Medium' `
        -Evidence "Total labels: $($labels.Count); Enabled: $($enabledLabels.Count)" `
        -Remediation 'In Purview compliance portal > Information protection > Labels, create and publish sensitivity labels.'
}
catch {
    Write-Warning "C-04: Sensitivity label cmdlets not available: $_"
    Add-ControlResult -TrustPrinciple 'Confidentiality' -TSCReference 'C1.2' -ControlId 'C-04' `
        -ControlName 'Sensitivity Labels Published' `
        -CurrentValue 'Unable to check (Purview not connected)' -ExpectedValue 'Sensitivity labels published' `
        -Status 'Review' -Severity 'Medium' `
        -Remediation 'Connect to Purview to evaluate sensitivity labels.'
}

# ------------------------------------------------------------------
# C-05: Encryption in Transit Enforced (C1.1)
# ------------------------------------------------------------------
# Microsoft 365 enforces TLS 1.2 by default — this is an informational check
Write-Verbose "C-05: Checking encryption in transit (TLS)..."
Add-ControlResult -TrustPrinciple 'Confidentiality' -TSCReference 'C1.1' -ControlId 'C-05' `
    -ControlName 'Encryption in Transit Enforced' `
    -CurrentValue 'TLS 1.2+ enforced by Microsoft 365 (platform default)' -ExpectedValue 'TLS 1.2 or higher' `
    -Status 'Pass' -Severity 'Medium' `
    -Evidence 'Microsoft 365 enforces TLS 1.2 by default since October 2020. TLS 1.0/1.1 are deprecated.' `
    -Remediation 'Verify no legacy applications use TLS 1.0/1.1 to connect to M365 services.'

# ------------------------------------------------------------------
# C-06: Data Retention Policies Configured (C1.2)
# ------------------------------------------------------------------
try {
    Write-Verbose "C-06: Checking retention policies..."
    $null = Get-Command -Name Get-RetentionCompliancePolicy -ErrorAction Stop
    $retentionPolicies = @(Get-RetentionCompliancePolicy -ErrorAction Stop)

    $enabledRetention = @($retentionPolicies | Where-Object { $_.Enabled -eq $true -or $null -eq $_.Enabled })

    $currentValue = if ($retentionPolicies.Count -eq 0) {
        'No retention policies found'
    } else {
        "$($enabledRetention.Count) active retention policies (of $($retentionPolicies.Count) total)"
    }

    $status = if ($enabledRetention.Count -gt 0) { 'Pass' } else { 'Fail' }

    Add-ControlResult -TrustPrinciple 'Confidentiality' -TSCReference 'C1.2' -ControlId 'C-06' `
        -ControlName 'Data Retention Policies Configured' `
        -CurrentValue $currentValue -ExpectedValue 'At least one retention policy active' `
        -Status $status -Severity 'Medium' `
        -Evidence "Total retention policies: $($retentionPolicies.Count); Active: $($enabledRetention.Count)" `
        -Remediation 'In Purview compliance portal > Data lifecycle management > Retention policies, create retention policies.'
}
catch {
    Write-Warning "C-06: Retention policy cmdlets not available: $_"
    Add-ControlResult -TrustPrinciple 'Confidentiality' -TSCReference 'C1.2' -ControlId 'C-06' `
        -ControlName 'Data Retention Policies Configured' `
        -CurrentValue 'Unable to check (Purview not connected)' -ExpectedValue 'Retention policies active' `
        -Status 'Review' -Severity 'Medium' `
        -Remediation 'Connect to Purview to evaluate retention policies.'
}

# ------------------------------------------------------------------
# C-07: Guest Access Governance (C1.1)
# ------------------------------------------------------------------
try {
    Write-Verbose "C-07: Checking guest invitation settings..."
    $authPolicy = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/policies/authorizationPolicy' -ErrorAction Stop

    $allowInvitesFrom = $authPolicy['allowInvitesFrom']
    # Values: everyone, adminsAndGuestInviters, adminsGuestInvitersAndAllMembers, none

    $currentValue = "allowInvitesFrom: $allowInvitesFrom"
    $isRestricted = $allowInvitesFrom -eq 'adminsAndGuestInviters' -or $allowInvitesFrom -eq 'none'
    $status = if ($isRestricted) { 'Pass' } else { 'Fail' }

    Add-ControlResult -TrustPrinciple 'Confidentiality' -TSCReference 'C1.1' -ControlId 'C-07' `
        -ControlName 'Guest Access Governance' `
        -CurrentValue $currentValue -ExpectedValue "allowInvitesFrom set to 'adminsAndGuestInviters' or 'none'" `
        -Status $status -Severity 'Medium' `
        -Evidence "Guest invitation policy: $allowInvitesFrom" `
        -Remediation 'In Entra admin center > External Identities > External collaboration settings, restrict guest invitations to admins.'
}
catch {
    Write-Warning "C-07: Failed to check guest access settings: $_"
    Add-ControlResult -TrustPrinciple 'Confidentiality' -TSCReference 'C1.1' -ControlId 'C-07' `
        -ControlName 'Guest Access Governance' `
        -CurrentValue "Error: $_" -ExpectedValue 'Guest invitations restricted to admins' `
        -Status 'Error' -Severity 'Medium'
}

# ------------------------------------------------------------------
# Output results
# ------------------------------------------------------------------
if ($results.Count -eq 0) {
    Write-Warning "No SOC 2 Confidentiality control results were generated."
    return
}

Write-Verbose "SOC 2 Confidentiality controls assessed: $($results.Count)"

if ($OutputPath) {
    $results | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported $($results.Count) SOC 2 Confidentiality controls to $OutputPath"
}
else {
    Write-Output $results
}
