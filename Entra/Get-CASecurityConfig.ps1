<#
.SYNOPSIS
    Evaluates Conditional Access policies against CIS Microsoft 365 Foundations Benchmark requirements.
.DESCRIPTION
    Fetches all Conditional Access policies via Microsoft Graph and evaluates them
    against CIS 5.2.2.x requirements. Each check filters enabled policies for specific
    condition and grant/session control combinations.

    Requires an active Microsoft Graph connection with Policy.Read.All permission.
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph
    PS> .\Entra\Get-CASecurityConfig.ps1

    Displays CA policy evaluation results.
.EXAMPLE
    PS> .\Entra\Get-CASecurityConfig.ps1 -OutputPath '.\ca-security-config.csv'

    Exports the CA evaluation to CSV.
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
        Update-CheckProgress -CheckId $CheckId -Setting $Setting -Status $Status
    }
}

# ------------------------------------------------------------------
# Fetch Conditional Access policies
# ------------------------------------------------------------------
try {
    Write-Verbose "Fetching Conditional Access policies..."
    $caPolicies = Invoke-MgGraphRequest -Method GET `
        -Uri '/v1.0/identity/conditionalAccess/policies' -ErrorAction Stop
    $allPolicies = @($caPolicies['value'])
    $enabledPolicies = @($allPolicies | Where-Object { $_['state'] -eq 'enabled' })
}
catch {
    Write-Warning "Could not retrieve CA policies: $_"
    $allPolicies = @()
    $enabledPolicies = @()
}

# Well-known admin role template IDs used by CIS checks
$adminRoleIds = @(
    '62e90394-69f5-4237-9190-012177145e10'  # Global Administrator
    'e8611ab8-c189-46e8-94e1-60213ab1f814'  # Privileged Role Administrator
    'fe930be7-5e62-47db-91af-98c3a49a38b1'  # User Administrator
    'f28a1f50-f6e7-4571-818b-6a12f2af6b6c'  # SharePoint Administrator
    '29232cdf-9323-42fd-ade2-1d097af3e4de'  # Exchange Administrator
    'b1be1c3e-b65d-4f19-8427-f6fa0d97feb9'  # Conditional Access Administrator
    '194ae4cb-b126-40b2-bd5b-6091b380977d'  # Security Administrator
    '729827e3-9c14-49f7-bb1b-9608f156bbb8'  # Helpdesk Administrator
    '966707d0-3269-4727-9be2-8c3a10f19b9d'  # Password Administrator
    'fdd7a751-b60b-444a-984c-02652fe8fa1c'  # Groups Administrator
    '11648597-926c-4cf3-9c36-bcebb0ba8dcc'  # Power Platform Administrator
    '3a2c62db-5318-420d-8d74-23affee5d9d5'  # Intune Administrator
    '158c047a-c907-4556-b7ef-446551a6b5f7'  # Cloud Application Administrator
    '9b895d92-2cd3-44c7-9d02-a6ac2d5ea5c3'  # Application Administrator
    '7be44c8a-adaf-4e2a-84d6-ab2649e08a13'  # Privileged Authentication Administrator
    'c4e39bd9-1100-46d3-8c65-fb160da0071f'  # Authentication Administrator
    'b0f54661-2d74-4c50-afa3-1ec803f12efe'  # Billing Administrator
    '44367163-eba1-44c3-98af-f5787879f96a'  # Dynamics 365 Administrator
    '8835291a-918c-4fd7-a9ce-faa49f0cf7d9'  # Teams Administrator
    '112f9a7f-7249-4951-bd88-c42b60cebe72'  # Fabric Administrator
)

# Helper: check if a policy targets admin roles
function Test-TargetAdminRole {
    param([hashtable]$Policy)
    $includeRoles = $Policy['conditions']['users']['includeRoles']
    if (-not $includeRoles) { return $false }
    foreach ($role in $includeRoles) {
        if ($role -in $adminRoleIds) { return $true }
    }
    return $false
}

# Helper: check if a policy targets all users
function Test-TargetAllUser {
    param([hashtable]$Policy)
    $includeUsers = $Policy['conditions']['users']['includeUsers']
    return ($includeUsers -and ($includeUsers -contains 'All'))
}

# ------------------------------------------------------------------
# 1. MFA Required for Admin Roles (CIS 5.2.2.1)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking CA: MFA for admin roles..."
    $mfaAdminPolicies = @($enabledPolicies | Where-Object {
        (Test-TargetAdminRole -Policy $_) -and
        ($_['grantControls']['builtInControls'] -contains 'mfa')
    })

    if ($mfaAdminPolicies.Count -gt 0) {
        $names = ($mfaAdminPolicies | ForEach-Object { $_['displayName'] }) -join '; '
        Add-Setting -Category 'Conditional Access' -Setting 'MFA Required for Admin Roles' `
            -CurrentValue "Yes ($($mfaAdminPolicies.Count) policy: $names)" `
            -RecommendedValue 'At least 1 policy' `
            -Status 'Pass' `
            -CheckId 'CA-MFA-ADMIN-001' `
            -Remediation 'No action needed.'
    }
    else {
        Add-Setting -Category 'Conditional Access' -Setting 'MFA Required for Admin Roles' `
            -CurrentValue 'No matching CA policy found' `
            -RecommendedValue 'At least 1 policy' `
            -Status 'Fail' `
            -CheckId 'CA-MFA-ADMIN-001' `
            -Remediation 'Create a CA policy: Target admin directory roles > Grant > Require multifactor authentication. Entra admin center > Protection > Conditional Access > New policy.'
    }
}
catch {
    Write-Warning "Could not check CA MFA for admins: $_"
}

# ------------------------------------------------------------------
# 2. MFA Required for All Users (CIS 5.2.2.2)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking CA: MFA for all users..."
    $mfaAllPolicies = @($enabledPolicies | Where-Object {
        (Test-TargetAllUser -Policy $_) -and
        ($_['grantControls']['builtInControls'] -contains 'mfa')
    })

    if ($mfaAllPolicies.Count -gt 0) {
        $names = ($mfaAllPolicies | ForEach-Object { $_['displayName'] }) -join '; '
        Add-Setting -Category 'Conditional Access' -Setting 'MFA Required for All Users' `
            -CurrentValue "Yes ($($mfaAllPolicies.Count) policy: $names)" `
            -RecommendedValue 'At least 1 policy' `
            -Status 'Pass' `
            -CheckId 'CA-MFA-ALL-001' `
            -Remediation 'No action needed.'
    }
    else {
        Add-Setting -Category 'Conditional Access' -Setting 'MFA Required for All Users' `
            -CurrentValue 'No matching CA policy found' `
            -RecommendedValue 'At least 1 policy' `
            -Status 'Fail' `
            -CheckId 'CA-MFA-ALL-001' `
            -Remediation 'Create a CA policy: Target All users > All cloud apps > Grant > Require multifactor authentication. Entra admin center > Protection > Conditional Access > New policy.'
    }
}
catch {
    Write-Warning "Could not check CA MFA for all users: $_"
}

# ------------------------------------------------------------------
# 3. Legacy Authentication Blocked (CIS 5.2.2.3)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking CA: Legacy auth blocked..."
    $legacyBlockPolicies = @($enabledPolicies | Where-Object {
        $clientApps = $_['conditions']['clientAppTypes']
        ($clientApps -contains 'exchangeActiveSync' -or $clientApps -contains 'other') -and
        ($_['grantControls']['builtInControls'] -contains 'block')
    })

    if ($legacyBlockPolicies.Count -gt 0) {
        $names = ($legacyBlockPolicies | ForEach-Object { $_['displayName'] }) -join '; '
        Add-Setting -Category 'Conditional Access' -Setting 'Legacy Authentication Blocked' `
            -CurrentValue "Yes ($($legacyBlockPolicies.Count) policy: $names)" `
            -RecommendedValue 'At least 1 policy' `
            -Status 'Pass' `
            -CheckId 'CA-LEGACYAUTH-001' `
            -Remediation 'No action needed.'
    }
    else {
        Add-Setting -Category 'Conditional Access' -Setting 'Legacy Authentication Blocked' `
            -CurrentValue 'No matching CA policy found' `
            -RecommendedValue 'At least 1 policy' `
            -Status 'Fail' `
            -CheckId 'CA-LEGACYAUTH-001' `
            -Remediation 'Create a CA policy: Target All users > Conditions > Client apps > Exchange ActiveSync clients + Other clients > Grant > Block access. Entra admin center > Protection > Conditional Access.'
    }
}
catch {
    Write-Warning "Could not check CA legacy auth block: $_"
}

# ------------------------------------------------------------------
# 4. Sign-in Frequency for Admins (CIS 5.2.2.4)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking CA: Sign-in frequency for admins..."
    $signinFreqPolicies = @($enabledPolicies | Where-Object {
        (Test-TargetAdminRole -Policy $_) -and
        $_['sessionControls']['signInFrequency']['isEnabled'] -eq $true -and
        $_['sessionControls']['persistentBrowser']['mode'] -eq 'never'
    })

    if ($signinFreqPolicies.Count -gt 0) {
        $names = ($signinFreqPolicies | ForEach-Object { $_['displayName'] }) -join '; '
        Add-Setting -Category 'Conditional Access' -Setting 'Sign-in Frequency for Admin Roles' `
            -CurrentValue "Yes ($($signinFreqPolicies.Count) policy: $names)" `
            -RecommendedValue 'At least 1 policy' `
            -Status 'Pass' `
            -CheckId 'CA-SIGNIN-FREQ-001' `
            -Remediation 'No action needed.'
    }
    else {
        Add-Setting -Category 'Conditional Access' -Setting 'Sign-in Frequency for Admin Roles' `
            -CurrentValue 'No matching CA policy found' `
            -RecommendedValue 'At least 1 policy' `
            -Status 'Fail' `
            -CheckId 'CA-SIGNIN-FREQ-001' `
            -Remediation 'Create a CA policy: Target admin roles > Session > Sign-in frequency (e.g., 4 hours) + Persistent browser session = Never. Entra admin center > Protection > Conditional Access.'
    }
}
catch {
    Write-Warning "Could not check CA sign-in frequency for admins: $_"
}

# ------------------------------------------------------------------
# 5. Phishing-Resistant MFA for Admins (CIS 5.2.2.5)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking CA: Phishing-resistant MFA for admins..."
    $phishResPolicies = @($enabledPolicies | Where-Object {
        (Test-TargetAdminRole -Policy $_) -and
        $_['grantControls']['authenticationStrength'] -ne $null
    })

    if ($phishResPolicies.Count -gt 0) {
        $names = ($phishResPolicies | ForEach-Object { $_['displayName'] }) -join '; '
        Add-Setting -Category 'Conditional Access' -Setting 'Phishing-Resistant MFA for Admins' `
            -CurrentValue "Yes ($($phishResPolicies.Count) policy: $names)" `
            -RecommendedValue 'At least 1 policy' `
            -Status 'Pass' `
            -CheckId 'CA-PHISHRES-001' `
            -Remediation 'No action needed.'
    }
    else {
        Add-Setting -Category 'Conditional Access' -Setting 'Phishing-Resistant MFA for Admins' `
            -CurrentValue 'No matching CA policy found' `
            -RecommendedValue 'At least 1 policy' `
            -Status 'Fail' `
            -CheckId 'CA-PHISHRES-001' `
            -Remediation 'Create a CA policy: Target admin roles > Grant > Require authentication strength > Phishing-resistant MFA. Entra admin center > Protection > Conditional Access.'
    }
}
catch {
    Write-Warning "Could not check CA phishing-resistant MFA: $_"
}

# ------------------------------------------------------------------
# 6. User Risk Policy (CIS 5.2.2.6)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking CA: User risk policy..."
    $userRiskPolicies = @($enabledPolicies | Where-Object {
        $riskLevels = $_['conditions']['userRiskLevels']
        $riskLevels -and @($riskLevels).Count -gt 0
    })

    if ($userRiskPolicies.Count -gt 0) {
        $names = ($userRiskPolicies | ForEach-Object { $_['displayName'] }) -join '; '
        Add-Setting -Category 'Conditional Access' -Setting 'User Risk Policy Configured' `
            -CurrentValue "Yes ($($userRiskPolicies.Count) policy: $names)" `
            -RecommendedValue 'At least 1 policy' `
            -Status 'Pass' `
            -CheckId 'CA-USERRISK-001' `
            -Remediation 'No action needed.'
    }
    else {
        Add-Setting -Category 'Conditional Access' -Setting 'User Risk Policy Configured' `
            -CurrentValue 'No matching CA policy found' `
            -RecommendedValue 'At least 1 policy' `
            -Status 'Fail' `
            -CheckId 'CA-USERRISK-001' `
            -Remediation 'Create a CA policy: Target All users > Conditions > User risk > High > Grant > Require password change + MFA. Entra admin center > Protection > Conditional Access.'
    }
}
catch {
    Write-Warning "Could not check CA user risk policy: $_"
}

# ------------------------------------------------------------------
# 7. Sign-in Risk Policy (CIS 5.2.2.7)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking CA: Sign-in risk policy..."
    $signinRiskPolicies = @($enabledPolicies | Where-Object {
        $riskLevels = $_['conditions']['signInRiskLevels']
        $riskLevels -and @($riskLevels).Count -gt 0
    })

    if ($signinRiskPolicies.Count -gt 0) {
        $names = ($signinRiskPolicies | ForEach-Object { $_['displayName'] }) -join '; '
        Add-Setting -Category 'Conditional Access' -Setting 'Sign-in Risk Policy Configured' `
            -CurrentValue "Yes ($($signinRiskPolicies.Count) policy: $names)" `
            -RecommendedValue 'At least 1 policy' `
            -Status 'Pass' `
            -CheckId 'CA-SIGNINRISK-001' `
            -Remediation 'No action needed.'
    }
    else {
        Add-Setting -Category 'Conditional Access' -Setting 'Sign-in Risk Policy Configured' `
            -CurrentValue 'No matching CA policy found' `
            -RecommendedValue 'At least 1 policy' `
            -Status 'Fail' `
            -CheckId 'CA-SIGNINRISK-001' `
            -Remediation 'Create a CA policy: Target All users > Conditions > Sign-in risk > High, Medium > Grant > Require MFA. Entra admin center > Protection > Conditional Access.'
    }
}
catch {
    Write-Warning "Could not check CA sign-in risk policy: $_"
}

# ------------------------------------------------------------------
# 8. Sign-in Risk Blocks Medium and High (CIS 5.2.2.8)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking CA: Sign-in risk blocks medium+high..."
    $signinRiskBlockPolicies = @($enabledPolicies | Where-Object {
        $riskLevels = $_['conditions']['signInRiskLevels']
        $riskLevels -and
        ($riskLevels -contains 'medium' -or $riskLevels -contains 'high') -and
        ($_['grantControls']['builtInControls'] -contains 'block' -or
         $_['grantControls']['builtInControls'] -contains 'mfa')
    })

    if ($signinRiskBlockPolicies.Count -gt 0) {
        $names = ($signinRiskBlockPolicies | ForEach-Object { $_['displayName'] }) -join '; '
        Add-Setting -Category 'Conditional Access' -Setting 'Sign-in Risk Blocks Medium+High' `
            -CurrentValue "Yes ($($signinRiskBlockPolicies.Count) policy: $names)" `
            -RecommendedValue 'At least 1 policy' `
            -Status 'Pass' `
            -CheckId 'CA-SIGNINRISK-002' `
            -Remediation 'No action needed.'
    }
    else {
        Add-Setting -Category 'Conditional Access' -Setting 'Sign-in Risk Blocks Medium+High' `
            -CurrentValue 'No matching CA policy found' `
            -RecommendedValue 'At least 1 policy' `
            -Status 'Fail' `
            -CheckId 'CA-SIGNINRISK-002' `
            -Remediation 'Create a CA policy: Target All users > Conditions > Sign-in risk > Medium, High > Grant > Block access (or require MFA). Entra admin center > Protection > Conditional Access.'
    }
}
catch {
    Write-Warning "Could not check CA sign-in risk block: $_"
}

# ------------------------------------------------------------------
# 9. Compliant/Domain-Joined Device Required (CIS 5.2.2.9)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking CA: Managed device required..."
    $devicePolicies = @($enabledPolicies | Where-Object {
        $_['grantControls']['builtInControls'] -contains 'compliantDevice' -or
        $_['grantControls']['builtInControls'] -contains 'domainJoinedDevice'
    })

    if ($devicePolicies.Count -gt 0) {
        $names = ($devicePolicies | ForEach-Object { $_['displayName'] }) -join '; '
        Add-Setting -Category 'Conditional Access' -Setting 'Managed Device Required' `
            -CurrentValue "Yes ($($devicePolicies.Count) policy: $names)" `
            -RecommendedValue 'At least 1 policy' `
            -Status 'Pass' `
            -CheckId 'CA-DEVICE-001' `
            -Remediation 'No action needed.'
    }
    else {
        Add-Setting -Category 'Conditional Access' -Setting 'Managed Device Required' `
            -CurrentValue 'No matching CA policy found' `
            -RecommendedValue 'At least 1 policy' `
            -Status 'Fail' `
            -CheckId 'CA-DEVICE-001' `
            -Remediation 'Create a CA policy: Target All users > All cloud apps > Grant > Require device to be marked as compliant (or Hybrid Azure AD joined). Entra admin center > Protection > Conditional Access.'
    }
}
catch {
    Write-Warning "Could not check CA managed device requirement: $_"
}

# ------------------------------------------------------------------
# 10. Managed Device for Security Info Registration (CIS 5.2.2.10)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking CA: Managed device for security info registration..."
    $secInfoDevicePolicies = @($enabledPolicies | Where-Object {
        $userActions = $_['conditions']['users']['includeUserActions']
        if (-not $userActions) {
            $userActions = $_['conditions']['applications']['includeUserActions']
        }
        ($userActions -contains 'urn:user:registersecurityinfo') -and
        ($_['grantControls']['builtInControls'] -contains 'compliantDevice' -or
         $_['grantControls']['builtInControls'] -contains 'domainJoinedDevice')
    })

    if ($secInfoDevicePolicies.Count -gt 0) {
        $names = ($secInfoDevicePolicies | ForEach-Object { $_['displayName'] }) -join '; '
        Add-Setting -Category 'Conditional Access' -Setting 'Managed Device for Security Info Registration' `
            -CurrentValue "Yes ($($secInfoDevicePolicies.Count) policy: $names)" `
            -RecommendedValue 'At least 1 policy' `
            -Status 'Pass' `
            -CheckId 'CA-DEVICE-002' `
            -Remediation 'No action needed.'
    }
    else {
        Add-Setting -Category 'Conditional Access' -Setting 'Managed Device for Security Info Registration' `
            -CurrentValue 'No matching CA policy found' `
            -RecommendedValue 'At least 1 policy' `
            -Status 'Fail' `
            -CheckId 'CA-DEVICE-002' `
            -Remediation 'Create a CA policy: User actions > Register security information > Grant > Require compliant device. Entra admin center > Protection > Conditional Access.'
    }
}
catch {
    Write-Warning "Could not check CA security info registration device requirement: $_"
}

# ------------------------------------------------------------------
# 11. Sign-in Frequency for Intune Enrollment (CIS 5.2.2.11)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking CA: Sign-in frequency for Intune enrollment..."
    $intuneAppId = 'd4ebce55-015a-49b5-a083-c84d1797ae8c'
    $intuneFreqPolicies = @($enabledPolicies | Where-Object {
        $includeApps = $_['conditions']['applications']['includeApplications']
        ($includeApps -contains $intuneAppId -or $includeApps -contains 'All') -and
        $_['sessionControls']['signInFrequency']['isEnabled'] -eq $true -and
        $_['sessionControls']['signInFrequency']['type'] -eq 'everyTime'
    })

    if ($intuneFreqPolicies.Count -gt 0) {
        $names = ($intuneFreqPolicies | ForEach-Object { $_['displayName'] }) -join '; '
        Add-Setting -Category 'Conditional Access' -Setting 'Sign-in Frequency for Intune Enrollment' `
            -CurrentValue "Yes ($($intuneFreqPolicies.Count) policy: $names)" `
            -RecommendedValue 'At least 1 policy' `
            -Status 'Pass' `
            -CheckId 'CA-INTUNE-001' `
            -Remediation 'No action needed.'
    }
    else {
        Add-Setting -Category 'Conditional Access' -Setting 'Sign-in Frequency for Intune Enrollment' `
            -CurrentValue 'No matching CA policy found' `
            -RecommendedValue 'At least 1 policy' `
            -Status 'Fail' `
            -CheckId 'CA-INTUNE-001' `
            -Remediation 'Create a CA policy: Target Microsoft Intune enrollment app > Session > Sign-in frequency = Every time. Entra admin center > Protection > Conditional Access.'
    }
}
catch {
    Write-Warning "Could not check CA Intune enrollment sign-in frequency: $_"
}

# ------------------------------------------------------------------
# 12. Device Code Flow Blocked (CIS 5.2.2.12)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking CA: Device code flow blocked..."
    $deviceCodePolicies = @($enabledPolicies | Where-Object {
        $authFlows = $_['conditions']['authenticationFlows']
        $transferMethods = if ($authFlows) { $authFlows['transferMethods'] } else { $null }
        $transferMethods -and
        ($transferMethods -contains 'deviceCodeFlow') -and
        ($_['grantControls']['builtInControls'] -contains 'block')
    })

    if ($deviceCodePolicies.Count -gt 0) {
        $names = ($deviceCodePolicies | ForEach-Object { $_['displayName'] }) -join '; '
        Add-Setting -Category 'Conditional Access' -Setting 'Device Code Flow Blocked' `
            -CurrentValue "Yes ($($deviceCodePolicies.Count) policy: $names)" `
            -RecommendedValue 'At least 1 policy' `
            -Status 'Pass' `
            -CheckId 'CA-DEVICECODE-001' `
            -Remediation 'No action needed.'
    }
    else {
        # Device code flow blocking is a newer CA feature — emit Review if no policies exist
        # as the tenant may not have the feature or may handle it differently
        Add-Setting -Category 'Conditional Access' -Setting 'Device Code Flow Blocked' `
            -CurrentValue 'No matching CA policy found' `
            -RecommendedValue 'At least 1 policy' `
            -Status 'Fail' `
            -CheckId 'CA-DEVICECODE-001' `
            -Remediation 'Create a CA policy: Target All users > Conditions > Authentication flows > Device code flow > Grant > Block access. Entra admin center > Protection > Conditional Access.'
    }
}
catch {
    Write-Warning "Could not check CA device code flow block: $_"
}

# ------------------------------------------------------------------
# Output
# ------------------------------------------------------------------
$report = @($settings)
Write-Verbose "Collected $($report.Count) CA security configuration settings"

if ($OutputPath) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported CA security config ($($report.Count) settings) to $OutputPath"
}
else {
    Write-Output $report
}
