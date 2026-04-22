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
        [string]$CheckId = '', [string]$Remediation = '',
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
# Check Security Defaults status
# ------------------------------------------------------------------
$securityDefaultsEnabled = $false
try {
    Write-Verbose "Checking Security Defaults status..."
    $sdPolicy = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/policies/identitySecurityDefaultsEnforcementPolicy' -ErrorAction Stop
    $securityDefaultsEnabled = $sdPolicy['isEnabled'] -eq $true
    if ($securityDefaultsEnabled) {
        Write-Verbose "Security Defaults is enabled -- CA checks covered by SD will be marked Info."
    }
}
catch {
    Write-Verbose "Could not check Security Defaults status: $_"
}

# ------------------------------------------------------------------
# Fetch Conditional Access policies
# ------------------------------------------------------------------
try {
    Write-Verbose "Fetching Conditional Access policies..."
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/v1.0/identity/conditionalAccess/policies'
        ErrorAction = 'Stop'
    }
    $caPolicies = Invoke-MgGraphRequest @graphParams
    $allPolicies = if ($caPolicies -and $caPolicies['value']) { @($caPolicies['value']) } else { @() }
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

    $mfaAdminEvidence = [PSCustomObject]@{
        PolicyCount = $mfaAdminPolicies.Count
        PolicyNames = @($mfaAdminPolicies | ForEach-Object { $_['displayName'] })
    }
    if ($mfaAdminPolicies.Count -gt 0) {
        $names = ($mfaAdminPolicies | ForEach-Object { $_['displayName'] }) -join '; '
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'MFA Required for Admin Roles'
            CurrentValue     = "Yes ($($mfaAdminPolicies.Count) policy: $names)"
            RecommendedValue = 'At least 1 policy'
            Status           = 'Pass'
            CheckId          = 'CA-MFA-ADMIN-001'
            Remediation      = 'No action needed.'
            Evidence         = $mfaAdminEvidence
        }
        Add-Setting @settingParams
    }
    elseif ($securityDefaultsEnabled) {
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'MFA Required for Admin Roles'
            CurrentValue     = 'Covered by Security Defaults'
            RecommendedValue = 'At least 1 policy (or Security Defaults)'
            Status           = 'Info'
            CheckId          = 'CA-MFA-ADMIN-001'
            Remediation      = 'Security Defaults enforces MFA for all admin roles. For granular control, disable Security Defaults and create Conditional Access policies.'
            Evidence         = $mfaAdminEvidence
        }
        Add-Setting @settingParams
    }
    else {
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'MFA Required for Admin Roles'
            CurrentValue     = 'No matching CA policy found'
            RecommendedValue = 'At least 1 policy'
            Status           = 'Fail'
            CheckId          = 'CA-MFA-ADMIN-001'
            Remediation      = 'Create a CA policy: Target admin directory roles > Grant > Require multifactor authentication. Entra admin center > Protection > Conditional Access > New policy.'
            Evidence         = $mfaAdminEvidence
        }
        Add-Setting @settingParams
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

    $mfaAllEvidence = [PSCustomObject]@{
        PolicyCount = $mfaAllPolicies.Count
        PolicyNames = @($mfaAllPolicies | ForEach-Object { $_['displayName'] })
    }

    if ($mfaAllPolicies.Count -gt 0) {
        $names = ($mfaAllPolicies | ForEach-Object { $_['displayName'] }) -join '; '
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'MFA Required for All Users'
            CurrentValue     = "Yes ($($mfaAllPolicies.Count) policy: $names)"
            RecommendedValue = 'At least 1 policy'
            Status           = 'Pass'
            CheckId          = 'CA-MFA-ALL-001'
            Remediation      = 'No action needed.'
            Evidence         = $mfaAllEvidence
        }
        Add-Setting @settingParams
    }
    elseif ($securityDefaultsEnabled) {
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'MFA Required for All Users'
            CurrentValue     = 'Covered by Security Defaults'
            RecommendedValue = 'At least 1 policy (or Security Defaults)'
            Status           = 'Info'
            CheckId          = 'CA-MFA-ALL-001'
            Remediation      = 'Security Defaults enforces MFA for all users. For granular control, disable Security Defaults and create Conditional Access policies.'
            Evidence         = $mfaAllEvidence
        }
        Add-Setting @settingParams
    }
    else {
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'MFA Required for All Users'
            CurrentValue     = 'No matching CA policy found'
            RecommendedValue = 'At least 1 policy'
            Status           = 'Fail'
            CheckId          = 'CA-MFA-ALL-001'
            Remediation      = 'Create a CA policy: Target All users > All cloud apps > Grant > Require multifactor authentication. Entra admin center > Protection > Conditional Access > New policy.'
            Evidence         = $mfaAllEvidence
        }
        Add-Setting @settingParams
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

    $legacyAuthEvidence = [PSCustomObject]@{
        PolicyCount = $legacyBlockPolicies.Count
        PolicyNames = @($legacyBlockPolicies | ForEach-Object { $_['displayName'] })
    }

    if ($legacyBlockPolicies.Count -gt 0) {
        $names = ($legacyBlockPolicies | ForEach-Object { $_['displayName'] }) -join '; '
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Legacy Authentication Blocked'
            CurrentValue     = "Yes ($($legacyBlockPolicies.Count) policy: $names)"
            RecommendedValue = 'At least 1 policy'
            Status           = 'Pass'
            CheckId          = 'CA-LEGACYAUTH-001'
            Remediation      = 'No action needed.'
            Evidence         = $legacyAuthEvidence
        }
        Add-Setting @settingParams
    }
    elseif ($securityDefaultsEnabled) {
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Legacy Authentication Blocked'
            CurrentValue     = 'Covered by Security Defaults'
            RecommendedValue = 'At least 1 policy (or Security Defaults)'
            Status           = 'Info'
            CheckId          = 'CA-LEGACYAUTH-001'
            Remediation      = 'Security Defaults blocks legacy authentication protocols. For granular control, disable Security Defaults and create Conditional Access policies.'
            Evidence         = $legacyAuthEvidence
        }
        Add-Setting @settingParams
    }
    else {
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Legacy Authentication Blocked'
            CurrentValue     = 'No matching CA policy found'
            RecommendedValue = 'At least 1 policy'
            Status           = 'Fail'
            CheckId          = 'CA-LEGACYAUTH-001'
            Remediation      = 'Create a CA policy: Target All users > Conditions > Client apps > Exchange ActiveSync clients + Other clients > Grant > Block access. Entra admin center > Protection > Conditional Access.'
            Evidence         = $legacyAuthEvidence
        }
        Add-Setting @settingParams
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
        $null -ne $_['sessionControls'] -and
        $null -ne $_['sessionControls']['signInFrequency'] -and
        $_['sessionControls']['signInFrequency']['isEnabled'] -eq $true -and
        $null -ne $_['sessionControls']['persistentBrowser'] -and
        $_['sessionControls']['persistentBrowser']['mode'] -eq 'never'
    })

    if ($signinFreqPolicies.Count -gt 0) {
        $names = ($signinFreqPolicies | ForEach-Object { $_['displayName'] }) -join '; '
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Sign-in Frequency for Admin Roles'
            CurrentValue     = "Yes ($($signinFreqPolicies.Count) policy: $names)"
            RecommendedValue = 'At least 1 policy'
            Status           = 'Pass'
            CheckId          = 'CA-SIGNIN-FREQ-001'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }
    else {
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Sign-in Frequency for Admin Roles'
            CurrentValue     = 'No matching CA policy found'
            RecommendedValue = 'At least 1 policy'
            Status           = 'Fail'
            CheckId          = 'CA-SIGNIN-FREQ-001'
            Remediation      = 'Create a CA policy: Target admin roles > Session > Sign-in frequency (e.g., 4 hours) + Persistent browser session = Never. Entra admin center > Protection > Conditional Access.'
        }
        Add-Setting @settingParams
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
        $null -ne $_['grantControls']['authenticationStrength']
    })

    if ($phishResPolicies.Count -gt 0) {
        $names = ($phishResPolicies | ForEach-Object { $_['displayName'] }) -join '; '
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Phishing-Resistant MFA for Admins'
            CurrentValue     = "Yes ($($phishResPolicies.Count) policy: $names)"
            RecommendedValue = 'At least 1 policy'
            Status           = 'Pass'
            CheckId          = 'CA-PHISHRES-001'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }
    else {
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Phishing-Resistant MFA for Admins'
            CurrentValue     = 'No matching CA policy found'
            RecommendedValue = 'At least 1 policy'
            Status           = 'Fail'
            CheckId          = 'CA-PHISHRES-001'
            Remediation      = 'Create a CA policy: Target admin roles > Grant > Require authentication strength > Phishing-resistant MFA. Entra admin center > Protection > Conditional Access.'
        }
        Add-Setting @settingParams
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
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'User Risk Policy Configured'
            CurrentValue     = "Yes ($($userRiskPolicies.Count) policy: $names)"
            RecommendedValue = 'At least 1 policy'
            Status           = 'Pass'
            CheckId          = 'CA-USERRISK-001'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }
    else {
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'User Risk Policy Configured'
            CurrentValue     = 'No matching CA policy found'
            RecommendedValue = 'At least 1 policy'
            Status           = 'Fail'
            CheckId          = 'CA-USERRISK-001'
            Remediation      = 'Create a CA policy: Target All users > Conditions > User risk > High > Grant > Require password change + MFA. Entra admin center > Protection > Conditional Access.'
        }
        Add-Setting @settingParams
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
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Sign-in Risk Policy Configured'
            CurrentValue     = "Yes ($($signinRiskPolicies.Count) policy: $names)"
            RecommendedValue = 'At least 1 policy'
            Status           = 'Pass'
            CheckId          = 'CA-SIGNINRISK-001'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }
    else {
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Sign-in Risk Policy Configured'
            CurrentValue     = 'No matching CA policy found'
            RecommendedValue = 'At least 1 policy'
            Status           = 'Fail'
            CheckId          = 'CA-SIGNINRISK-001'
            Remediation      = 'Create a CA policy: Target All users > Conditions > Sign-in risk > High, Medium > Grant > Require MFA. Entra admin center > Protection > Conditional Access.'
        }
        Add-Setting @settingParams
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
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Sign-in Risk Blocks Medium+High'
            CurrentValue     = "Yes ($($signinRiskBlockPolicies.Count) policy: $names)"
            RecommendedValue = 'At least 1 policy'
            Status           = 'Pass'
            CheckId          = 'CA-SIGNINRISK-002'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }
    elseif ($securityDefaultsEnabled) {
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Sign-in Risk Blocks Medium+High'
            CurrentValue     = 'Partially covered by Security Defaults (blocks high-risk sign-ins)'
            RecommendedValue = 'At least 1 policy (or Security Defaults for partial coverage)'
            Status           = 'Info'
            CheckId          = 'CA-SIGNINRISK-002'
            Remediation      = 'Security Defaults blocks high-risk sign-ins but does not provide granular medium-risk controls. For full coverage, disable Security Defaults and create Conditional Access policies with Entra ID P2.'
        }
        Add-Setting @settingParams
    }
    else {
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Sign-in Risk Blocks Medium+High'
            CurrentValue     = 'No matching CA policy found'
            RecommendedValue = 'At least 1 policy'
            Status           = 'Fail'
            CheckId          = 'CA-SIGNINRISK-002'
            Remediation      = 'Create a CA policy: Target All users > Conditions > Sign-in risk > Medium, High > Grant > Block access (or require MFA). Entra admin center > Protection > Conditional Access.'
        }
        Add-Setting @settingParams
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
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Managed Device Required'
            CurrentValue     = "Yes ($($devicePolicies.Count) policy: $names)"
            RecommendedValue = 'At least 1 policy'
            Status           = 'Pass'
            CheckId          = 'CA-DEVICE-001'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }
    else {
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Managed Device Required'
            CurrentValue     = 'No matching CA policy found'
            RecommendedValue = 'At least 1 policy'
            Status           = 'Fail'
            CheckId          = 'CA-DEVICE-001'
            Remediation      = 'Create a CA policy: Target All users > All cloud apps > Grant > Require device to be marked as compliant (or Microsoft Entra hybrid joined). Entra admin center > Protection > Conditional Access.'
        }
        Add-Setting @settingParams
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
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Managed Device for Security Info Registration'
            CurrentValue     = "Yes ($($secInfoDevicePolicies.Count) policy: $names)"
            RecommendedValue = 'At least 1 policy'
            Status           = 'Pass'
            CheckId          = 'CA-DEVICE-002'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }
    else {
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Managed Device for Security Info Registration'
            CurrentValue     = 'No matching CA policy found'
            RecommendedValue = 'At least 1 policy'
            Status           = 'Fail'
            CheckId          = 'CA-DEVICE-002'
            Remediation      = 'Create a CA policy: User actions > Register security information > Grant > Require compliant device. Entra admin center > Protection > Conditional Access.'
        }
        Add-Setting @settingParams
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
        $null -ne $_['sessionControls'] -and
        $null -ne $_['sessionControls']['signInFrequency'] -and
        $_['sessionControls']['signInFrequency']['isEnabled'] -eq $true -and
        $_['sessionControls']['signInFrequency']['type'] -eq 'everyTime'
    })

    if ($intuneFreqPolicies.Count -gt 0) {
        $names = ($intuneFreqPolicies | ForEach-Object { $_['displayName'] }) -join '; '
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Sign-in Frequency for Intune Enrollment'
            CurrentValue     = "Yes ($($intuneFreqPolicies.Count) policy: $names)"
            RecommendedValue = 'At least 1 policy'
            Status           = 'Pass'
            CheckId          = 'CA-INTUNE-001'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }
    else {
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Sign-in Frequency for Intune Enrollment'
            CurrentValue     = 'No matching CA policy found'
            RecommendedValue = 'At least 1 policy'
            Status           = 'Fail'
            CheckId          = 'CA-INTUNE-001'
            Remediation      = 'Create a CA policy: Target Microsoft Intune enrollment app > Session > Sign-in frequency = Every time. Entra admin center > Protection > Conditional Access.'
        }
        Add-Setting @settingParams
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
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Device Code Flow Blocked'
            CurrentValue     = "Yes ($($deviceCodePolicies.Count) policy: $names)"
            RecommendedValue = 'At least 1 policy'
            Status           = 'Pass'
            CheckId          = 'CA-DEVICECODE-001'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }
    else {
        # Device code flow blocking is a newer CA feature — emit Review if no policies exist
        # as the tenant may not have the feature or may handle it differently
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Device Code Flow Blocked'
            CurrentValue     = 'No matching CA policy found'
            RecommendedValue = 'At least 1 policy'
            Status           = 'Fail'
            CheckId          = 'CA-DEVICECODE-001'
            Remediation      = 'Create a CA policy: Target All users > Conditions > Authentication flows > Device code flow > Grant > Block access. Entra admin center > Protection > Conditional Access.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check CA device code flow block: $_"
}

# ------------------------------------------------------------------
# 13. Report-Only Policies (stale auditing)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking CA: Report-only policies..."
    $reportOnlyPolicies = @($allPolicies | Where-Object { $_['state'] -eq 'enabledForReportingButNotEnforced' })

    if ($reportOnlyPolicies.Count -eq 0) {
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Report-Only Policies'
            CurrentValue     = 'None'
            RecommendedValue = 'Review and promote or remove'
            Status           = 'Pass'
            CheckId          = 'CA-REPORTONLY-001'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }
    else {
        $names = ($reportOnlyPolicies | ForEach-Object { $_['displayName'] }) -join '; '
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Report-Only Policies'
            CurrentValue     = "$($reportOnlyPolicies.Count) policies in report-only: $names"
            RecommendedValue = 'Review and promote or remove'
            Status           = 'Warning'
            CheckId          = 'CA-REPORTONLY-001'
            Remediation      = 'Review report-only policies and either enable enforcement or remove if no longer needed. Entra admin center > Protection > Conditional Access.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check CA report-only policies: $_"
}

# ------------------------------------------------------------------
# 14. Named Locations Risk (IP-based trusted locations)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking CA: Named location risk..."
    $namedLocResponse = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/identity/conditionalAccess/namedLocations' -ErrorAction Stop
    $namedLocations = if ($namedLocResponse -and $namedLocResponse['value']) { @($namedLocResponse['value']) } else { @() }
    $ipLocations = @($namedLocations | Where-Object {
        $_['@odata.type'] -eq '#microsoft.graph.ipNamedLocation' -and $_['isTrusted'] -eq $true
    })

    if ($ipLocations.Count -eq 0) {
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Trusted IP Named Locations'
            CurrentValue     = 'None configured'
            RecommendedValue = 'Use country-based or compliant network locations'
            Status           = 'Pass'
            CheckId          = 'CA-NAMEDLOC-001'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }
    else {
        $names = ($ipLocations | ForEach-Object { $_['displayName'] }) -join '; '
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Trusted IP Named Locations'
            CurrentValue     = "$($ipLocations.Count) trusted IP locations: $names"
            RecommendedValue = 'Prefer compliant network or country-based locations'
            Status           = 'Review'
            CheckId          = 'CA-NAMEDLOC-001'
            Remediation      = 'IP-based trusted locations can be spoofed via VPN or proxy. Consider Global Secure Access compliant network checks or country-based locations for stronger assurance. Entra admin center > Protection > Conditional Access > Named locations.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check CA named locations: $_"
}

# ------------------------------------------------------------------
# 15. Persistent Browser Session Without Device Compliance
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking CA: Persistent browser sessions..."
    $persistentBrowserPolicies = @($enabledPolicies | Where-Object {
        $sessionControls = $_['sessionControls']
        $persistentBrowser = if ($sessionControls) { $sessionControls['persistentBrowser'] } else { $null }
        $persistentBrowser -and $persistentBrowser['mode'] -eq 'always' -and $persistentBrowser['isEnabled'] -eq $true
    })

    # Check if any of those also require device compliance
    $persistentWithoutDevice = @($persistentBrowserPolicies | Where-Object {
        $grantControls = $_['grantControls']['builtInControls']
        -not ($grantControls -contains 'compliantDevice' -or $grantControls -contains 'domainJoinedDevice')
    })

    if ($persistentWithoutDevice.Count -eq 0) {
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Persistent Browser Without Device Compliance'
            CurrentValue     = 'None'
            RecommendedValue = 'No persistent sessions without device compliance'
            Status           = 'Pass'
            CheckId          = 'CA-SESSION-001'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }
    else {
        $names = ($persistentWithoutDevice | ForEach-Object { $_['displayName'] }) -join '; '
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Persistent Browser Without Device Compliance'
            CurrentValue     = "$($persistentWithoutDevice.Count) policies allow persistent sessions without device compliance: $names"
            RecommendedValue = 'No persistent sessions without device compliance'
            Status           = 'Warning'
            CheckId          = 'CA-SESSION-001'
            Remediation      = 'Persistent browser sessions on unmanaged devices increase the risk of session hijacking. Require device compliance or remove persistent browser grants. Entra admin center > Protection > Conditional Access.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check CA persistent browser sessions: $_"
}

# ------------------------------------------------------------------
# 16. Combined Sign-in Risk + User Risk Anti-Pattern
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking CA: Risk policy anti-pattern..."
    $combinedRiskPolicies = @($enabledPolicies | Where-Object {
        $conditions = $_['conditions']
        $signInRisk = $conditions['signInRiskLevels']
        $userRisk = $conditions['userRiskLevels']
        ($signInRisk -and $signInRisk.Count -gt 0) -and ($userRisk -and $userRisk.Count -gt 0)
    })

    if ($combinedRiskPolicies.Count -eq 0) {
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Combined Risk Policy Anti-Pattern'
            CurrentValue     = 'None'
            RecommendedValue = 'Separate sign-in risk and user risk into distinct policies'
            Status           = 'Pass'
            CheckId          = 'CA-RISKPOLICY-001'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }
    else {
        $names = ($combinedRiskPolicies | ForEach-Object { $_['displayName'] }) -join '; '
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Combined Risk Policy Anti-Pattern'
            CurrentValue     = "$($combinedRiskPolicies.Count) policies combine both risk types: $names"
            RecommendedValue = 'Separate sign-in risk and user risk into distinct policies'
            Status           = 'Warning'
            CheckId          = 'CA-RISKPOLICY-001'
            Remediation      = 'Combining sign-in risk and user risk in one CA policy creates an AND condition -- both must be true to trigger. Microsoft recommends separate policies for each risk type. Entra admin center > Protection > Conditional Access.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check CA risk policy anti-pattern: $_"
}

# ------------------------------------------------------------------
# 17. Directory Role Coverage Gaps
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking CA: Role coverage gaps..."
    # Get active role assignments to find which Tier-0 roles are actually in use
    $roleAssignments = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/roleManagement/directory/roleAssignments?$top=999' -ErrorAction Stop
    $activeRoleIds = @($roleAssignments['value'] | ForEach-Object { $_['roleDefinitionId'] } | Sort-Object -Unique)

    # Find CA policies that target specific directory roles (not "All users")
    $roleTargetingPolicies = @($enabledPolicies | Where-Object {
        $includeRoles = $_['conditions']['users']['includeRoles']
        $includeRoles -and $includeRoles.Count -gt 0
    })

    if ($roleTargetingPolicies.Count -eq 0) {
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Tier-0 Role Coverage in CA Policies'
            CurrentValue     = 'No role-targeted CA policies found'
            RecommendedValue = 'Target active privileged roles'
            Status           = 'Review'
            CheckId          = 'CA-ROLECOVERAGE-001'
            Remediation      = 'Consider creating CA policies that specifically target privileged directory roles with stricter controls (phishing-resistant MFA, compliant devices).'
        }
        Add-Setting @settingParams
    }
    else {
        # Collect all roles covered by CA policies
        $coveredRoles = [System.Collections.Generic.HashSet[string]]::new()
        foreach ($p in $roleTargetingPolicies) {
            foreach ($r in $p['conditions']['users']['includeRoles']) {
                [void]$coveredRoles.Add($r)
            }
        }
        # Find active Tier-0 roles not covered by any CA policy
        $tier0Roles = @($adminRoleIds | Where-Object { $_ -in $activeRoleIds })
        $uncoveredRoles = @($tier0Roles | Where-Object { -not $coveredRoles.Contains($_) })

        if ($uncoveredRoles.Count -eq 0) {
            $settingParams = @{
                Category         = 'Conditional Access'
                Setting          = 'Tier-0 Role Coverage in CA Policies'
                CurrentValue     = "All $($tier0Roles.Count) active Tier-0 roles covered"
                RecommendedValue = 'All active privileged roles covered'
                Status           = 'Pass'
                CheckId          = 'CA-ROLECOVERAGE-001'
                Remediation      = 'No action needed.'
            }
            Add-Setting @settingParams
        }
        else {
            $settingParams = @{
                Category         = 'Conditional Access'
                Setting          = 'Tier-0 Role Coverage in CA Policies'
                CurrentValue     = "$($uncoveredRoles.Count) of $($tier0Roles.Count) active Tier-0 roles not targeted by any CA policy"
                RecommendedValue = 'All active privileged roles covered'
                Status           = 'Warning'
                CheckId          = 'CA-ROLECOVERAGE-001'
                Remediation      = 'Add the uncovered role IDs to existing admin-targeted CA policies. Entra admin center > Protection > Conditional Access > Select policy > Users > Include roles.'
            }
            Add-Setting @settingParams
        }
    }
}
catch {
    Write-Warning "Could not check CA role coverage: $_"
}

# ------------------------------------------------------------------
# 18. Empty-Target Policies (Fallback Catch-All)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking CA: Empty-target policies..."
    $emptyTargetPolicies = @($enabledPolicies | Where-Object {
        $users         = $_['conditions']['users']
        $includeUsers  = $users['includeUsers']
        $includeGroups = $users['includeGroups']
        $includeRoles  = $users['includeRoles']
        $noUsers  = (-not $includeUsers)  -or ($includeUsers.Count  -eq 0) -or ($includeUsers  -contains 'None')
        $noGroups = (-not $includeGroups) -or ($includeGroups.Count -eq 0)
        $noRoles  = (-not $includeRoles)  -or ($includeRoles.Count  -eq 0)
        $noUsers -and $noGroups -and $noRoles
    })

    if ($emptyTargetPolicies.Count -eq 0) {
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'CA Policies with Empty Include Targets'
            CurrentValue     = 'None'
            RecommendedValue = 'All enabled CA policies should target at least one user, group, or role'
            Status           = 'Pass'
            CheckId          = 'CA-FALLBACK-001'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }
    else {
        $names = ($emptyTargetPolicies | ForEach-Object { $_['displayName'] }) -join '; '
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'CA Policies with Empty Include Targets'
            CurrentValue     = "$($emptyTargetPolicies.Count) enabled policies have no include targets: $names"
            RecommendedValue = 'All enabled CA policies should target at least one user, group, or role'
            Status           = 'Warning'
            CheckId          = 'CA-FALLBACK-001'
            Remediation      = 'Enabled CA policies with no include targets apply to no users and create operational noise. Configure meaningful include targets or disable the policy. Entra admin center > Protection > Conditional Access.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check CA empty-target policies: $_"
}

# ------------------------------------------------------------------
# 19. Stale Named Location References
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking CA: Stale named location references..."
    # System placeholder values are not real location IDs -- skip them
    $systemLocationIds = [System.Collections.Generic.HashSet[string]]::new(
        [string[]]@('All', 'AllTrusted', 'MFA'),
        [System.StringComparer]::OrdinalIgnoreCase
    )
    # $namedLocations populated by check 14 (IP named locations); may be $null if that check threw
    $knownLocationIds = [System.Collections.Generic.HashSet[string]]::new()
    if ($namedLocations) {
        foreach ($loc in $namedLocations) {
            if ($loc['id']) { [void]$knownLocationIds.Add($loc['id']) }
        }
    }

    # Only evaluate when we have authoritative location data
    if ($knownLocationIds.Count -gt 0) {
        $staleLocPolicies = @($enabledPolicies | Where-Object {
            $locations = $_['conditions']['locations']
            if (-not $locations) { return $false }
            $allRefs = @()
            if ($locations['includeLocations']) { $allRefs += @($locations['includeLocations']) }
            if ($locations['excludeLocations']) { $allRefs += @($locations['excludeLocations']) }
            $staleRefs = @($allRefs | Where-Object { -not $systemLocationIds.Contains($_) -and -not $knownLocationIds.Contains($_) })
            $staleRefs.Count -gt 0
        })

        if ($staleLocPolicies.Count -eq 0) {
            $settingParams = @{
                Category         = 'Conditional Access'
                Setting          = 'Stale Named Location References in CA Policies'
                CurrentValue     = 'None'
                RecommendedValue = 'All referenced named locations should exist'
                Status           = 'Pass'
                CheckId          = 'CA-NAMEDLOC-002'
                Remediation      = 'No action needed.'
            }
            Add-Setting @settingParams
        }
        else {
            $names = ($staleLocPolicies | ForEach-Object { $_['displayName'] }) -join '; '
            $settingParams = @{
                Category         = 'Conditional Access'
                Setting          = 'Stale Named Location References in CA Policies'
                CurrentValue     = "$($staleLocPolicies.Count) policies reference deleted named locations: $names"
                RecommendedValue = 'All referenced named locations should exist'
                Status           = 'Fail'
                CheckId          = 'CA-NAMEDLOC-002'
                Remediation      = 'The referenced named locations have been deleted. These policies may not evaluate correctly, creating unpredictable enforcement. Update or remove the stale location references. Entra admin center > Protection > Conditional Access > Named locations.'
            }
            Add-Setting @settingParams
        }
    }
}
catch {
    Write-Warning "Could not check CA stale named location references: $_"
}

# ------------------------------------------------------------------
# 20. Stale Group References in CA Policies
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking CA: Stale group references..."
    # Collect all unique group IDs referenced across enabled policies
    $groupIdSet = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($policy in $enabledPolicies) {
        $users = $policy['conditions']['users']
        if ($users['includeGroups']) { foreach ($g in $users['includeGroups']) { [void]$groupIdSet.Add($g) } }
        if ($users['excludeGroups']) { foreach ($g in $users['excludeGroups']) { [void]$groupIdSet.Add($g) } }
    }

    if ($groupIdSet.Count -gt 0) {
        # Cap lookups to 50 IDs to prevent slow runs on tenants with many group-targeted policies
        $groupIdsToCheck = @($groupIdSet)[0..([Math]::Min($groupIdSet.Count, 50) - 1)]
        $staleGroupIds = [System.Collections.Generic.HashSet[string]]::new()
        foreach ($gid in $groupIdsToCheck) {
            try {
                $null = Invoke-MgGraphRequest -Method GET -Uri ('/v1.0/groups/' + $gid + '?$select=id') -ErrorAction Stop
            }
            catch {
                if ("$_" -match '404|ResourceNotFound|Request_ResourceNotFound') {
                    [void]$staleGroupIds.Add($gid)
                }
            }
        }

        # Map stale group IDs back to affected policy names
        $stalePolicies = @($enabledPolicies | Where-Object {
            $users = $_['conditions']['users']
            $allGroupRefs = @()
            if ($users['includeGroups']) { $allGroupRefs += @($users['includeGroups']) }
            if ($users['excludeGroups']) { $allGroupRefs += @($users['excludeGroups']) }
            (@($allGroupRefs | Where-Object { $staleGroupIds.Contains($_) })).Count -gt 0
        })

        if ($stalePolicies.Count -eq 0) {
            $settingParams = @{
                Category         = 'Conditional Access'
                Setting          = 'Stale Group References in CA Policies'
                CurrentValue     = 'None'
                RecommendedValue = 'All referenced groups should exist'
                Status           = 'Pass'
                CheckId          = 'CA-STALEREF-001'
                Remediation      = 'No action needed.'
            }
            Add-Setting @settingParams
        }
        else {
            $names = ($stalePolicies | ForEach-Object { $_['displayName'] }) -join '; '
            $settingParams = @{
                Category         = 'Conditional Access'
                Setting          = 'Stale Group References in CA Policies'
                CurrentValue     = "$($stalePolicies.Count) policies reference deleted groups: $names"
                RecommendedValue = 'All referenced groups should exist'
                Status           = 'Fail'
                CheckId          = 'CA-STALEREF-001'
                Remediation      = 'CA policies with deleted group references may not enforce correctly, creating silent security gaps. Remove or replace the stale group references. Entra admin center > Protection > Conditional Access.'
            }
            Add-Setting @settingParams
        }
    }
    else {
        $settingParams = @{
            Category         = 'Conditional Access'
            Setting          = 'Stale Group References in CA Policies'
            CurrentValue     = 'No group-targeted policies'
            RecommendedValue = 'All referenced groups should exist'
            Status           = 'Pass'
            CheckId          = 'CA-STALEREF-001'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check CA stale group references: $_"
}

# ------------------------------------------------------------------
# Output
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'Conditional Access'
