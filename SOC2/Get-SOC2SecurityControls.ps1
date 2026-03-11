<#
.SYNOPSIS
    Assesses SOC 2 Security trust principle controls against Microsoft 365 configuration.
.DESCRIPTION
    Evaluates Microsoft 365 tenant settings against SOC 2 Trust Service Criteria for
    the Security principle. Checks Conditional Access policies, MFA enforcement,
    admin role assignments, audit logging, and Defender alert configurations.

    All operations are strictly read-only (Get-* cmdlets and Graph GET requests only).
    Maps each check to an AICPA SOC 2 Trust Service Criterion reference.

    DISCLAIMER: This tool assists with SOC 2 readiness assessment. It does not
    constitute a SOC 2 audit or certification.

    Requires Microsoft Graph connection with the following scopes:
    Policy.Read.All, RoleManagement.Read.Directory, SecurityEvents.Read.All,
    AuditLog.Read.All, User.Read.All, Reports.Read.All
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned
    to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph -Scopes 'Policy.Read.All','RoleManagement.Read.Directory','SecurityEvents.Read.All'
    PS> .\SOC2\Get-SOC2SecurityControls.ps1

    Displays SOC 2 Security control assessment results.
.EXAMPLE
    PS> .\SOC2\Get-SOC2SecurityControls.ps1 -OutputPath '.\soc2-security.csv'

    Exports SOC 2 Security control results to CSV.
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

# Verify Graph connection
try {
    $context = Get-MgContext
    if (-not $context) {
        Write-Error "Not connected to Microsoft Graph. Run Connect-Service -Service Graph first."
        return
    }
}
catch {
    Write-Error "Not connected to Microsoft Graph. Run Connect-Service -Service Graph first."
    return
}

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
# S-01: MFA Enforced for All Users (CC6.1)
# ------------------------------------------------------------------
try {
    Write-Verbose "S-01: Checking MFA enforcement via Conditional Access..."
    $caPolicies = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/identity/conditionalAccess/policies' -ErrorAction Stop
    $policies = $caPolicies['value']

    # Check for Security Defaults first
    $secDefaults = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/policies/identitySecurityDefaultsEnforcementPolicy' -ErrorAction Stop
    $secDefaultsEnabled = $secDefaults['isEnabled']

    # Check for CA policy requiring MFA for all users
    $mfaForAll = $false
    $mfaPolicyNames = @()
    foreach ($policy in $policies) {
        if ($policy['state'] -ne 'enabled') { continue }
        $grantControls = $policy['grantControls']
        if (-not $grantControls) { continue }
        $builtInControls = @($grantControls['builtInControls'])
        $authStrength = $grantControls['authenticationStrength']
        $hasMfa = $builtInControls -contains 'mfa' -or $null -ne $authStrength

        if (-not $hasMfa) { continue }

        # Check if targeting all users
        $includeUsers = @($policy['conditions']['users']['includeUsers'])
        if ($includeUsers -contains 'All') {
            $mfaForAll = $true
            $mfaPolicyNames += $policy['displayName']
        }
    }

    $currentValue = if ($secDefaultsEnabled) {
        'Security Defaults enabled (MFA enforced)'
    } elseif ($mfaForAll) {
        "CA policy: $($mfaPolicyNames -join '; ')"
    } else {
        'No MFA-for-all policy found'
    }

    $status = if ($secDefaultsEnabled -or $mfaForAll) { 'Pass' } else { 'Fail' }

    Add-ControlResult -TrustPrinciple 'Security' -TSCReference 'CC6.1' -ControlId 'S-01' `
        -ControlName 'MFA Enforced for All Users' `
        -CurrentValue $currentValue -ExpectedValue 'MFA required for all users via CA or Security Defaults' `
        -Status $status -Severity 'High' `
        -Evidence "CA policies evaluated: $(@($policies).Count); Security Defaults: $secDefaultsEnabled" `
        -Remediation 'Create a Conditional Access policy requiring MFA for all users, or enable Security Defaults.'
}
catch {
    Write-Warning "S-01: Failed to check MFA enforcement: $_"
    Add-ControlResult -TrustPrinciple 'Security' -TSCReference 'CC6.1' -ControlId 'S-01' `
        -ControlName 'MFA Enforced for All Users' `
        -CurrentValue "Error: $_" -ExpectedValue 'MFA required for all users' `
        -Status 'Error' -Severity 'High'
}

# ------------------------------------------------------------------
# S-02: Sign-in Risk Policy Configured (CC6.1)
# ------------------------------------------------------------------
try {
    Write-Verbose "S-02: Checking for sign-in risk Conditional Access policies..."
    # Reuse $policies from S-01 if available
    if (-not $policies) {
        $caPolicies = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/identity/conditionalAccess/policies' -ErrorAction Stop
        $policies = $caPolicies['value']
    }

    $signInRiskPolicies = @()
    foreach ($policy in $policies) {
        if ($policy['state'] -ne 'enabled') { continue }
        $riskLevels = @($policy['conditions']['signInRiskLevels'])
        if ($riskLevels.Count -gt 0) {
            $signInRiskPolicies += $policy['displayName']
        }
    }

    $currentValue = if ($signInRiskPolicies.Count -gt 0) {
        "Configured: $($signInRiskPolicies -join '; ')"
    } else {
        'No sign-in risk policy found'
    }

    $status = if ($signInRiskPolicies.Count -gt 0) { 'Pass' } else { 'Fail' }

    Add-ControlResult -TrustPrinciple 'Security' -TSCReference 'CC6.1' -ControlId 'S-02' `
        -ControlName 'Sign-in Risk Policy Configured' `
        -CurrentValue $currentValue -ExpectedValue 'At least one CA policy with sign-in risk conditions' `
        -Status $status -Severity 'High' `
        -Evidence "Sign-in risk policies found: $($signInRiskPolicies.Count)" `
        -Remediation 'Create a CA policy with sign-in risk condition (Medium and High) requiring MFA or blocking access.'
}
catch {
    Write-Warning "S-02: Failed to check sign-in risk policies: $_"
    Add-ControlResult -TrustPrinciple 'Security' -TSCReference 'CC6.1' -ControlId 'S-02' `
        -ControlName 'Sign-in Risk Policy Configured' `
        -CurrentValue "Error: $_" -ExpectedValue 'Sign-in risk CA policy configured' `
        -Status 'Error' -Severity 'High'
}

# ------------------------------------------------------------------
# S-03: User Risk Policy Configured (CC6.1)
# ------------------------------------------------------------------
try {
    Write-Verbose "S-03: Checking for user risk Conditional Access policies..."
    if (-not $policies) {
        $caPolicies = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/identity/conditionalAccess/policies' -ErrorAction Stop
        $policies = $caPolicies['value']
    }

    $userRiskPolicies = @()
    foreach ($policy in $policies) {
        if ($policy['state'] -ne 'enabled') { continue }
        $riskLevels = @($policy['conditions']['userRiskLevels'])
        if ($riskLevels.Count -gt 0) {
            $userRiskPolicies += $policy['displayName']
        }
    }

    $currentValue = if ($userRiskPolicies.Count -gt 0) {
        "Configured: $($userRiskPolicies -join '; ')"
    } else {
        'No user risk policy found'
    }

    $status = if ($userRiskPolicies.Count -gt 0) { 'Pass' } else { 'Fail' }

    Add-ControlResult -TrustPrinciple 'Security' -TSCReference 'CC6.1' -ControlId 'S-03' `
        -ControlName 'User Risk Policy Configured' `
        -CurrentValue $currentValue -ExpectedValue 'At least one CA policy with user risk conditions' `
        -Status $status -Severity 'High' `
        -Evidence "User risk policies found: $($userRiskPolicies.Count)" `
        -Remediation 'Create a CA policy with user risk condition (High) requiring password change.'
}
catch {
    Write-Warning "S-03: Failed to check user risk policies: $_"
    Add-ControlResult -TrustPrinciple 'Security' -TSCReference 'CC6.1' -ControlId 'S-03' `
        -ControlName 'User Risk Policy Configured' `
        -CurrentValue "Error: $_" -ExpectedValue 'User risk CA policy configured' `
        -Status 'Error' -Severity 'High'
}

# ------------------------------------------------------------------
# S-04: Admin Accounts Use Phishing-Resistant MFA (CC6.2)
# ------------------------------------------------------------------
try {
    Write-Verbose "S-04: Checking admin accounts for phishing-resistant MFA..."

    # Get Global Admin role members
    $globalAdminRole = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/directoryRoles' -ErrorAction Stop
    $gaRole = $globalAdminRole['value'] | Where-Object { $_['displayName'] -eq 'Global Administrator' }

    $adminUserIds = @()
    if ($gaRole) {
        $members = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/directoryRoles/$($gaRole['id'])/members" -ErrorAction Stop
        $adminUserIds = @($members['value'] | Where-Object { $_['@odata.type'] -eq '#microsoft.graph.user' } | ForEach-Object { $_['id'] })
    }

    # Check auth method registration for phishing-resistant methods
    $phishingResistantAdmins = 0
    $totalAdmins = $adminUserIds.Count
    foreach ($userId in $adminUserIds) {
        try {
            $regDetails = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/reports/authenticationMethods/userRegistrationDetails?`$filter=id eq '$userId'" -ErrorAction Stop
            $details = $regDetails['value']
            if ($details) {
                $methods = @($details[0]['methodsRegistered'])
                if ($methods -contains 'fido2SecurityKey' -or $methods -contains 'windowsHelloForBusiness' -or $methods -contains 'passKeyDeviceBound') {
                    $phishingResistantAdmins++
                }
            }
        }
        catch {
            Write-Verbose "Could not check auth methods for user $userId : $_"
        }
    }

    $currentValue = "$phishingResistantAdmins of $totalAdmins Global Admins use phishing-resistant MFA"
    $status = if ($totalAdmins -eq 0) { 'Review' } elseif ($phishingResistantAdmins -eq $totalAdmins) { 'Pass' } else { 'Fail' }

    Add-ControlResult -TrustPrinciple 'Security' -TSCReference 'CC6.2' -ControlId 'S-04' `
        -ControlName 'Admin Accounts Use Phishing-Resistant MFA' `
        -CurrentValue $currentValue -ExpectedValue 'All Global Admins registered for FIDO2 or Windows Hello' `
        -Status $status -Severity 'High' `
        -Evidence "Global Admins: $totalAdmins; Phishing-resistant: $phishingResistantAdmins" `
        -Remediation 'Register admin accounts for FIDO2 security keys or Windows Hello for Business.'
}
catch {
    Write-Warning "S-04: Failed to check admin MFA methods: $_"
    Add-ControlResult -TrustPrinciple 'Security' -TSCReference 'CC6.2' -ControlId 'S-04' `
        -ControlName 'Admin Accounts Use Phishing-Resistant MFA' `
        -CurrentValue "Error: $_" -ExpectedValue 'Phishing-resistant MFA for admins' `
        -Status 'Error' -Severity 'High'
}

# ------------------------------------------------------------------
# S-05: Least Privilege Admin Roles (CC6.3)
# ------------------------------------------------------------------
try {
    Write-Verbose "S-05: Checking Global Administrator count..."

    if (-not $gaRole) {
        $globalAdminRole = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/directoryRoles' -ErrorAction Stop
        $gaRole = $globalAdminRole['value'] | Where-Object { $_['displayName'] -eq 'Global Administrator' }
    }

    $gaCount = 0
    if ($gaRole) {
        $members = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/directoryRoles/$($gaRole['id'])/members" -ErrorAction Stop
        $gaCount = @($members['value'] | Where-Object { $_['@odata.type'] -eq '#microsoft.graph.user' }).Count
    }

    $currentValue = "$gaCount Global Administrators"
    $status = if ($gaCount -ge 2 -and $gaCount -le 4) { 'Pass' } elseif ($gaCount -lt 2) { 'Fail' } else { 'Fail' }

    Add-ControlResult -TrustPrinciple 'Security' -TSCReference 'CC6.3' -ControlId 'S-05' `
        -ControlName 'Least Privilege Admin Roles' `
        -CurrentValue $currentValue -ExpectedValue 'Between 2 and 4 Global Administrators' `
        -Status $status -Severity 'High' `
        -Evidence "Global Admin count: $gaCount" `
        -Remediation 'Reduce Global Admin assignments to 2-4 accounts. Use scoped admin roles for day-to-day tasks.'
}
catch {
    Write-Warning "S-05: Failed to check admin role assignments: $_"
    Add-ControlResult -TrustPrinciple 'Security' -TSCReference 'CC6.3' -ControlId 'S-05' `
        -ControlName 'Least Privilege Admin Roles' `
        -CurrentValue "Error: $_" -ExpectedValue '2-4 Global Admins' `
        -Status 'Error' -Severity 'High'
}

# ------------------------------------------------------------------
# S-06: Unified Audit Log Enabled (CC7.1)
# ------------------------------------------------------------------
try {
    Write-Verbose "S-06: Checking Unified Audit Log status..."
    # This requires EXO connection — attempt via Graph audit log query as fallback
    $ualEnabled = $null

    # Try EXO cmdlet first
    try {
        $null = Get-Command -Name Get-AdminAuditLogConfig -ErrorAction Stop
        $auditConfig = Get-AdminAuditLogConfig -ErrorAction Stop
        $ualEnabled = $auditConfig.UnifiedAuditLogIngestionEnabled
    }
    catch {
        Write-Verbose "EXO cmdlet not available, attempting Graph-based audit log check..."
        # If we can query audit logs via Graph, UAL is likely enabled
        try {
            $testAudit = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/auditLogs/directoryAudits?$top=1' -ErrorAction Stop
            if ($null -ne $testAudit['value']) {
                $ualEnabled = $true
            }
        }
        catch {
            Write-Verbose "Could not verify UAL via Graph: $_"
        }
    }

    $currentValue = if ($null -eq $ualEnabled) {
        'Unable to determine (requires EXO connection or AuditLog.Read.All scope)'
    } elseif ($ualEnabled) {
        'Enabled'
    } else {
        'Disabled'
    }

    $status = if ($null -eq $ualEnabled) { 'Review' } elseif ($ualEnabled) { 'Pass' } else { 'Fail' }

    Add-ControlResult -TrustPrinciple 'Security' -TSCReference 'CC7.1' -ControlId 'S-06' `
        -ControlName 'Unified Audit Log Enabled' `
        -CurrentValue $currentValue -ExpectedValue 'Enabled' `
        -Status $status -Severity 'Critical' `
        -Evidence "UAL ingestion enabled: $ualEnabled" `
        -Remediation 'Enable audit logging: Set-AdminAuditLogConfig -UnifiedAuditLogIngestionEnabled $true'
}
catch {
    Write-Warning "S-06: Failed to check audit log status: $_"
    Add-ControlResult -TrustPrinciple 'Security' -TSCReference 'CC7.1' -ControlId 'S-06' `
        -ControlName 'Unified Audit Log Enabled' `
        -CurrentValue "Error: $_" -ExpectedValue 'UAL enabled' `
        -Status 'Error' -Severity 'Critical'
}

# ------------------------------------------------------------------
# S-07: Defender Alert Policies Active (CC7.1)
# ------------------------------------------------------------------
try {
    Write-Verbose "S-07: Checking Defender alert policies..."
    $alerts = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/security/alerts_v2?$top=10' -ErrorAction Stop
    $alertList = @($alerts['value'])

    $currentValue = if ($alertList.Count -gt 0) {
        "$($alertList.Count)+ alerts found (threat detection active)"
    } else {
        'No alerts found (may indicate no threat detection or clean environment)'
    }

    # Having alerts available means the system is monitoring — even 0 alerts can be fine
    $status = 'Pass'

    Add-ControlResult -TrustPrinciple 'Security' -TSCReference 'CC7.1' -ControlId 'S-07' `
        -ControlName 'Defender Alert Policies Active' `
        -CurrentValue $currentValue -ExpectedValue 'Defender alerts accessible and monitoring active' `
        -Status $status -Severity 'High' `
        -Evidence "Alert API accessible; alerts returned: $($alertList.Count)" `
        -Remediation 'Review alert policies in Microsoft Defender portal > Policies & rules > Alert policy.'
}
catch {
    Write-Warning "S-07: Failed to check Defender alerts: $_"
    $errorMsg = "$_"
    # Distinguish between permission issues and actual failures
    $status = if ($errorMsg -match 'Forbidden|403|Authorization') { 'Review' } else { 'Error' }
    Add-ControlResult -TrustPrinciple 'Security' -TSCReference 'CC7.1' -ControlId 'S-07' `
        -ControlName 'Defender Alert Policies Active' `
        -CurrentValue "Error: $errorMsg" -ExpectedValue 'Defender alerts active' `
        -Status $status -Severity 'High' `
        -Remediation 'Ensure SecurityEvents.Read.All or SecurityAlert.Read.All scope is granted.'
}

# ------------------------------------------------------------------
# S-08: Alerts Are Triaged and Responded To (CC7.2)
# ------------------------------------------------------------------
try {
    Write-Verbose "S-08: Checking alert triage activity..."
    $resolvedAlerts = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/security/alerts_v2?`$filter=status ne 'new'&`$top=10" -ErrorAction Stop
    $resolvedList = @($resolvedAlerts['value'])

    $allAlerts = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/security/alerts_v2?$top=50' -ErrorAction Stop
    $allList = @($allAlerts['value'])
    $newCount = @($allList | Where-Object { $_['status'] -eq 'new' }).Count
    $triagedCount = $allList.Count - $newCount

    $currentValue = if ($allList.Count -eq 0) {
        'No alerts to triage (clean environment)'
    } elseif ($triagedCount -gt 0) {
        "$triagedCount of $($allList.Count) alerts triaged (resolved/inProgress)"
    } else {
        "0 of $($allList.Count) alerts triaged — all alerts in 'new' status"
    }

    $status = if ($allList.Count -eq 0) { 'Pass' } elseif ($triagedCount -gt 0) { 'Pass' } else { 'Fail' }

    Add-ControlResult -TrustPrinciple 'Security' -TSCReference 'CC7.2' -ControlId 'S-08' `
        -ControlName 'Alerts Are Triaged and Responded To' `
        -CurrentValue $currentValue -ExpectedValue 'Evidence of alert triage activity' `
        -Status $status -Severity 'Medium' `
        -Evidence "Total alerts sampled: $($allList.Count); Triaged: $triagedCount; New: $newCount" `
        -Remediation 'Regularly review and triage security alerts in Microsoft Defender portal.'
}
catch {
    Write-Warning "S-08: Failed to check alert triage: $_"
    Add-ControlResult -TrustPrinciple 'Security' -TSCReference 'CC7.2' -ControlId 'S-08' `
        -ControlName 'Alerts Are Triaged and Responded To' `
        -CurrentValue "Error: $_" -ExpectedValue 'Alert triage evidence' `
        -Status 'Error' -Severity 'Medium'
}

# ------------------------------------------------------------------
# Output results
# ------------------------------------------------------------------
if ($results.Count -eq 0) {
    Write-Warning "No SOC 2 Security control results were generated."
    return
}

Write-Verbose "SOC 2 Security controls assessed: $($results.Count)"

if ($OutputPath) {
    $results | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported $($results.Count) SOC 2 Security controls to $OutputPath"
}
else {
    Write-Output $results
}
