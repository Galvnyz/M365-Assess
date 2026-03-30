<#
.SYNOPSIS
    Collects Entra ID security configuration settings for M365 assessment.
.DESCRIPTION
    Queries Microsoft Graph for security-relevant Entra ID configuration settings
    including user consent policies, admin consent workflow, application registration
    policies, self-service password reset, password protection, and global admin counts.
    Returns a structured inventory of settings with current values and recommendations.

    Requires Microsoft.Graph.Identity.DirectoryManagement and
    Microsoft.Graph.Identity.SignIns modules and the following permissions:
    Policy.Read.All, User.Read.All, RoleManagement.Read.Directory, Directory.Read.All
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph -Scopes 'Policy.Read.All','User.Read.All','RoleManagement.Read.Directory'
    PS> .\Entra\Get-EntraSecurityConfig.ps1

    Displays Entra ID security configuration settings.
.EXAMPLE
    PS> .\Entra\Get-EntraSecurityConfig.ps1 -OutputPath '.\entra-security-config.csv'

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

# Continue on errors: non-critical checks should not block remaining assessments.
$ErrorActionPreference = 'Continue'

# Verify Graph connection
if (-not (Assert-GraphConnection)) { return }
$context = Get-MgContext

Import-Module -Name Microsoft.Graph.Identity.DirectoryManagement -ErrorAction SilentlyContinue
Import-Module -Name Microsoft.Graph.Identity.SignIns -ErrorAction SilentlyContinue

$settings = [System.Collections.Generic.List[PSCustomObject]]::new()
$checkIdCounter = @{}

# Helper to add a setting
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

# Helper to detect emergency access (break-glass) accounts by naming convention
function Get-BreakGlassAccounts {
    param([array]$Users)
    $patterns = @('break.?glass', 'emergency.?access', 'breakglass', 'emer.?admin')
    $regex = ($patterns | ForEach-Object { "($_)" }) -join '|'
    @($Users | Where-Object {
        $_['displayName'] -match $regex -or $_['userPrincipalName'] -match $regex
    })
}

# ------------------------------------------------------------------
# 1. Security Defaults
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking security defaults..."
    $secDefaults = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/policies/identitySecurityDefaultsEnforcementPolicy' -ErrorAction Stop
    if (-not $secDefaults) { throw "API returned null response" }
    $isEnabled = $secDefaults['isEnabled']
    $settingParams = @{
        Category         = 'Security Defaults'
        Setting          = 'Security Defaults Enabled'
        CurrentValue     = "$isEnabled"
        RecommendedValue = 'True (if no Conditional Access)'
        Status           = $(if ($isEnabled) { 'Pass' } else { 'Fail' })
        CheckId          = 'ENTRA-SECDEFAULT-001'
        Remediation      = 'Run: Update-MgPolicyIdentitySecurityDefaultsEnforcementPolicy -IsEnabled $true. Entra admin center > Properties > Manage security defaults.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not retrieve security defaults: $_"
    $settingParams = @{
        Category         = 'Security Defaults'
        Setting          = 'Security Defaults Enabled'
        CurrentValue     = 'Unable to retrieve'
        RecommendedValue = 'True (if no CA)'
        Status           = 'Review'
        CheckId          = 'ENTRA-SECDEFAULT-001'
        Remediation      = 'Run: Update-MgPolicyIdentitySecurityDefaultsEnforcementPolicy -IsEnabled $true. Entra admin center > Properties > Manage security defaults.'
    }
    Add-Setting @settingParams
}

# ------------------------------------------------------------------
# 2. Global Admin Count (should be 2-4, excluding break-glass)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking global admin count..."
    $graphParams = @{
        Method      = 'GET'
        Uri         = "/v1.0/directoryRoles?`$filter=displayName eq 'Global Administrator'"
        ErrorAction = 'Stop'
    }
    $globalAdminRole = Invoke-MgGraphRequest @graphParams
    if (-not $globalAdminRole['value'] -or $globalAdminRole['value'].Count -eq 0) {
        $settingParams = @{
            Category         = 'Admin Accounts'
            Setting          = 'Global Administrator Count'
            CurrentValue     = 'Role not activated'
            RecommendedValue = '2-4'
            Status           = 'Warning'
            CheckId          = 'ENTRA-ADMIN-001'
            Remediation      = 'The Global Administrator directory role is not activated in this tenant. Activate the role by assigning at least one user, then re-run the assessment.'
        }
        Add-Setting @settingParams
    }
    else {
        $roleId = $globalAdminRole['value'][0]['id']

        $graphParams = @{
            Method      = 'GET'
            Uri         = "/v1.0/directoryRoles/$roleId/members"
            ErrorAction = 'Stop'
        }
        $members = Invoke-MgGraphRequest @graphParams
        $allAdmins = if ($members -and $members['value']) { @($members['value']) } else { @() }

        # Exclude break-glass accounts from the operational admin count
        $breakGlassAdmins = Get-BreakGlassAccounts -Users $allAdmins
        $operationalAdmins = @($allAdmins | Where-Object { $_ -notin $breakGlassAdmins })
        $gaCount = $operationalAdmins.Count
        $bgExcluded = $breakGlassAdmins.Count

        $gaStatus = if ($gaCount -ge 2 -and $gaCount -le 4) { 'Pass' }
        elseif ($gaCount -lt 2) { 'Fail' }
        else { 'Warning' }

        $countDetail = if ($bgExcluded -gt 0) { "$gaCount (excluding $bgExcluded break-glass)" } else { "$gaCount" }

        $settingParams = @{
            Category         = 'Admin Accounts'
            Setting          = 'Global Administrator Count'
            CurrentValue     = $countDetail
            RecommendedValue = '2-4'
            Status           = $gaStatus
            CheckId          = 'ENTRA-ADMIN-001'
            Remediation      = 'Run: Get-MgDirectoryRole -Filter "displayName eq ''Global Administrator''" | Get-MgDirectoryRoleMember. Maintain 2-4 global admins using dedicated accounts (break-glass accounts are excluded from this count).'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check global admin count: $_"
}

# ------------------------------------------------------------------
# 3-5. Authorization Policy (user consent, app registration, groups)
# ------------------------------------------------------------------
$authPolicy = $null
try {
    Write-Verbose "Checking authorization policy..."
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/v1.0/policies/authorizationPolicy'
        ErrorAction = 'Stop'
    }
    $authPolicy = Invoke-MgGraphRequest @graphParams
}
catch {
    Write-Warning "Could not retrieve authorization policy: $_"
}

if ($authPolicy) {
    # 3. User Consent for Applications
    try {
        $consentPolicy = $authPolicy['defaultUserRolePermissions']['permissionGrantPoliciesAssigned']

        $consentValue = if ($consentPolicy -contains 'ManagePermissionGrantsForSelf.microsoft-user-default-legacy') {
            'Allow user consent (legacy)'
        }
        elseif ($consentPolicy -contains 'ManagePermissionGrantsForSelf.microsoft-user-default-low') {
            'Allow user consent for low-impact apps'
        }
        elseif ($consentPolicy.Count -eq 0 -or $null -eq $consentPolicy) {
            'Do not allow user consent'
        }
        else {
            ($consentPolicy -join '; ')
        }

        $consentStatus = if ($consentPolicy.Count -eq 0 -or $null -eq $consentPolicy) { 'Pass' } else { 'Fail' }

        $settingParams = @{
            Category         = 'Application Consent'
            Setting          = 'User Consent for Applications'
            CurrentValue     = $consentValue
            RecommendedValue = 'Do not allow user consent'
            Status           = $consentStatus
            CheckId          = 'ENTRA-CONSENT-001'
            Remediation      = 'Run: Update-MgPolicyAuthorizationPolicy -DefaultUserRolePermissions @{PermissionGrantPoliciesAssigned = @()}. Entra admin center > Enterprise applications > Consent and permissions.'
        }
        Add-Setting @settingParams
    }
    catch {
        Write-Warning "Could not check user consent policy: $_"
    }

    # 4. Users Can Register Applications
    try {
        $canRegister = $authPolicy['defaultUserRolePermissions']['allowedToCreateApps']

        $settingParams = @{
            Category         = 'Application Consent'
            Setting          = 'Users Can Register Applications'
            CurrentValue     = "$canRegister"
            RecommendedValue = 'False'
            Status           = $(if (-not $canRegister) { 'Pass' } else { 'Fail' })
            CheckId          = 'ENTRA-APPREG-001'
            Remediation      = 'Run: Update-MgPolicyAuthorizationPolicy -DefaultUserRolePermissions @{AllowedToCreateApps = $false}. Entra admin center > Users > User settings.'
        }
        Add-Setting @settingParams
    }
    catch {
        Write-Warning "Could not check app registration policy: $_"
    }

    # 5. Users Can Create Security Groups
    try {
        $canCreateGroups = $authPolicy['defaultUserRolePermissions']['allowedToCreateSecurityGroups']
        $settingParams = @{
            Category         = 'Directory Settings'
            Setting          = 'Users Can Create Security Groups'
            CurrentValue     = "$canCreateGroups"
            RecommendedValue = 'False'
            Status           = $(if (-not $canCreateGroups) { 'Pass' } else { 'Warning' })
            CheckId          = 'ENTRA-GROUP-001'
            Remediation      = 'Run: Update-MgPolicyAuthorizationPolicy -DefaultUserRolePermissions @{AllowedToCreateSecurityGroups = $false}. Entra admin center > Groups > General.'
        }
        Add-Setting @settingParams
    }
    catch {
        Write-Warning "Could not check group creation policy: $_"
    }

    # 5b. Restrict Non-Admin Tenant Creation (CIS 5.1.2.3)
    try {
        $canCreateTenants = $authPolicy['defaultUserRolePermissions']['allowedToCreateTenants']
        $settingParams = @{
            Category         = 'Directory Settings'
            Setting          = 'Non-Admin Tenant Creation Restricted'
            CurrentValue     = "$canCreateTenants"
            RecommendedValue = 'False'
            Status           = $(if (-not $canCreateTenants) { 'Pass' } else { 'Warning' })
            CheckId          = 'ENTRA-TENANT-001'
            Remediation      = 'Run: Update-MgPolicyAuthorizationPolicy -DefaultUserRolePermissions @{AllowedToCreateTenants = $false}. Entra admin center > Users > User settings.'
        }
        Add-Setting @settingParams
    }
    catch {
        Write-Warning "Could not check tenant creation policy: $_"
    }
}

# ------------------------------------------------------------------
# 6. Admin Consent Workflow
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking admin consent workflow..."
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/v1.0/policies/adminConsentRequestPolicy'
        ErrorAction = 'Stop'
    }
    $adminConsentSettings = Invoke-MgGraphRequest @graphParams
    $isAdminConsentEnabled = $adminConsentSettings['isEnabled']

    $settingParams = @{
        Category         = 'Application Consent'
        Setting          = 'Admin Consent Workflow Enabled'
        CurrentValue     = "$isAdminConsentEnabled"
        RecommendedValue = 'True'
        Status           = $(if ($isAdminConsentEnabled) { 'Pass' } else { 'Warning' })
        CheckId          = 'ENTRA-CONSENT-002'
        Remediation      = 'Run: Update-MgPolicyAdminConsentRequestPolicy -IsEnabled $true. Entra admin center > Enterprise applications > Admin consent requests.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check admin consent workflow: $_"
}

# ------------------------------------------------------------------
# 7. Self-Service Password Reset
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking SSPR configuration..."
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/v1.0/policies/authenticationMethodsPolicy'
        ErrorAction = 'Stop'
    }
    $sspr = Invoke-MgGraphRequest @graphParams
    $ssprRegistration = $sspr['registrationEnforcement']['authenticationMethodsRegistrationCampaign']['state']

    $settingParams = @{
        Category         = 'Password Management'
        Setting          = 'Auth Method Registration Campaign'
        CurrentValue     = "$ssprRegistration"
        RecommendedValue = 'enabled'
        Status           = $(if ($ssprRegistration -eq 'enabled') { 'Pass' } else { 'Warning' })
        CheckId          = 'ENTRA-MFA-001'
        Remediation      = 'Run: Update-MgBetaPolicyAuthenticationMethodPolicy with RegistrationEnforcement settings. Entra admin center > Protection > Authentication methods > Registration campaign.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check SSPR: $_"
}

# ------------------------------------------------------------------
# 7b. Authentication Methods — SMS/Voice/Email (CIS 5.2.3.5, 5.2.3.7)
# ------------------------------------------------------------------
try {
    if ($sspr) {
        $authMethods = $sspr['authenticationMethodConfigurations']
        if ($authMethods) {
            # CIS 5.2.3.5 — SMS sign-in disabled
            $smsMethod = $authMethods | Where-Object { $_['id'] -eq 'Sms' }
            $smsState = if ($smsMethod) { $smsMethod['state'] } else { 'not found' }
            $settingParams = @{
                Category         = 'Authentication Methods'
                Setting          = 'SMS Authentication'
                CurrentValue     = "$smsState"
                RecommendedValue = 'disabled'
                Status           = $(if ($smsState -eq 'disabled') { 'Pass' } else { 'Fail' })
                CheckId          = 'ENTRA-AUTHMETHOD-001'
                Remediation      = 'Entra admin center > Protection > Authentication methods > SMS > Disable. SMS is vulnerable to SIM-swapping attacks.'
            }
            Add-Setting @settingParams

            # CIS 5.2.3.5 — Voice call disabled
            $voiceMethod = $authMethods | Where-Object { $_['id'] -eq 'Voice' }
            $voiceState = if ($voiceMethod) { $voiceMethod['state'] } else { 'not found' }
            $settingParams = @{
                Category         = 'Authentication Methods'
                Setting          = 'Voice Call Authentication'
                CurrentValue     = "$voiceState"
                RecommendedValue = 'disabled'
                Status           = $(if ($voiceState -eq 'disabled') { 'Pass' } else { 'Fail' })
                CheckId          = 'ENTRA-AUTHMETHOD-001'
                Remediation      = 'Entra admin center > Protection > Authentication methods > Voice call > Disable. Voice is vulnerable to telephony-based attacks.'
            }
            Add-Setting @settingParams

            # CIS 5.2.3.7 — Email OTP disabled
            $emailMethod = $authMethods | Where-Object { $_['id'] -eq 'Email' }
            $emailState = if ($emailMethod) { $emailMethod['state'] } else { 'not found' }
            $settingParams = @{
                Category         = 'Authentication Methods'
                Setting          = 'Email OTP Authentication'
                CurrentValue     = "$emailState"
                RecommendedValue = 'disabled'
                Status           = $(if ($emailState -eq 'disabled') { 'Pass' } else { 'Fail' })
                CheckId          = 'ENTRA-AUTHMETHOD-002'
                Remediation      = 'Entra admin center > Protection > Authentication methods > Email OTP > Disable. Email OTP is a weaker authentication factor.'
            }
            Add-Setting @settingParams
        }
    }
}
catch {
    Write-Warning "Could not check authentication method configurations: $_"
}

# ------------------------------------------------------------------
# 7c. SSPR Enabled for All Users (CIS 5.2.4.1)
# ------------------------------------------------------------------
try {
    if ($sspr) {
        $campaign = $sspr['registrationEnforcement']['authenticationMethodsRegistrationCampaign']
        $campaignState = $campaign['state']
        $includeTargets = $campaign['includeTargets']
        $targetsAll = $false
        if ($includeTargets) {
            $targetsAll = $includeTargets | Where-Object { $_['id'] -eq 'all_users' -or $_['targetType'] -eq 'group' }
        }
        $settingParams = @{
            Category         = 'Password Management'
            Setting          = 'SSPR Registration Campaign Targets All Users'
            CurrentValue     = $(if ($campaignState -eq 'enabled' -and $targetsAll) { 'Enabled for all users' } elseif ($campaignState -eq 'enabled') { 'Enabled (limited scope)' } else { 'Disabled' })
            RecommendedValue = 'Enabled for all users'
            Status           = $(if ($campaignState -eq 'enabled' -and $targetsAll) { 'Pass' } elseif ($campaignState -eq 'enabled') { 'Warning' } else { 'Fail' })
            CheckId          = 'ENTRA-SSPR-001'
            Remediation      = 'Entra admin center > Protection > Authentication methods > Registration campaign > Enable and target All Users.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check SSPR targeting: $_"
}

# ------------------------------------------------------------------
# 8. Password Protection (Banned Passwords)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking password protection..."
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/v1.0/settings'
        ErrorAction = 'Stop'
    }
    $passwordProtection = Invoke-MgGraphRequest @graphParams
    $pwSettings = $passwordProtection['value'] | Where-Object {
        $_['displayName'] -eq 'Password Rule Settings'
    }

    if ($pwSettings) {
        $bannedListEntry = if ($pwSettings['values']) { $pwSettings['values'] | Where-Object { $_['name'] -eq 'BannedPasswordList' } } else { $null }
        $bannedList = if ($bannedListEntry) { $bannedListEntry['value'] } else { $null }
        $enforceCustomEntry = if ($pwSettings['values']) { $pwSettings['values'] | Where-Object { $_['name'] -eq 'EnableBannedPasswordCheck' } } else { $null }
        $enforceCustom = if ($enforceCustomEntry) { $enforceCustomEntry['value'] } else { $null }
        $lockoutEntry = if ($pwSettings['values']) { $pwSettings['values'] | Where-Object { $_['name'] -eq 'LockoutThreshold' } } else { $null }
        $lockoutThreshold = if ($lockoutEntry) { $lockoutEntry['value'] } else { $null }

        $settingParams = @{
            Category         = 'Password Management'
            Setting          = 'Custom Banned Password List Enforced'
            CurrentValue     = "$enforceCustom"
            RecommendedValue = 'True'
            Status           = $(if ($enforceCustom -eq 'True') { 'Pass' } else { 'Warning' })
            CheckId          = 'ENTRA-PASSWORD-002'
            Remediation      = 'Run: Update-MgBetaDirectorySetting for Password Rule Settings with CustomBannedPasswordsEnforced = true. Entra admin center > Protection > Password protection.'
        }
        Add-Setting @settingParams

        $bannedCount = if ($bannedList) { ($bannedList -split ',').Count } else { 0 }
        $settingParams = @{
            Category         = 'Password Management'
            Setting          = 'Custom Banned Password Count'
            CurrentValue     = "$bannedCount"
            RecommendedValue = '1+'
            Status           = $(if ($bannedCount -gt 0) { 'Pass' } else { 'Warning' })
            CheckId          = 'ENTRA-PASSWORD-004'
            Remediation      = 'Run: Update-MgBetaDirectorySetting for Password Rule Settings to add organization-specific terms. Entra admin center > Protection > Password protection.'
        }
        Add-Setting @settingParams

        $settingParams = @{
            Category         = 'Password Management'
            Setting          = 'Smart Lockout Threshold'
            CurrentValue     = "$lockoutThreshold"
            RecommendedValue = '10'
            Status           = $(if ([int]$lockoutThreshold -le 10) { 'Pass' } else { 'Review' })
            CheckId          = 'ENTRA-PASSWORD-003'
            Remediation      = 'Run: Update-MgBetaDirectorySetting for Password Rule Settings with LockoutThreshold. Entra admin center > Protection > Password protection.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check password protection: $_"
}

# ------------------------------------------------------------------
# 9. Password Expiration Policy
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking password expiration..."
    $domains = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/domains' -ErrorAction Stop
    $domainList = if ($domains -and $domains['value']) { @($domains['value']) } else { @() }
    foreach ($domain in $domainList) {
        if (-not $domain['isVerified']) { continue }
        $validityDays = $domain['passwordValidityPeriodInDays']
        $neverExpires = ($validityDays -eq 2147483647)

        $settingParams = @{
            Category         = 'Password Management'
            Setting          = "Password Expiration: $($domain['id'])"
            CurrentValue     = $(if ($neverExpires) { 'Never expires' } else { "$validityDays days" })
            RecommendedValue = 'Never expires (with MFA)'
            Status           = $(if ($neverExpires) { 'Pass' } else { 'Fail' })
            CheckId          = 'ENTRA-PASSWORD-001'
            Remediation      = 'Run: Update-MgDomain -DomainId {domain} -PasswordValidityPeriodInDays 2147483647. M365 admin center > Settings > Password expiration policy.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check password expiration: $_"
}

# ------------------------------------------------------------------
# 10. External Collaboration Settings (reuses $authPolicy from section 3-5)
# ------------------------------------------------------------------
if ($authPolicy) {
    try {
        $guestInviteSettings = $authPolicy['allowInvitesFrom']
        $guestAccessRestriction = $authPolicy['guestUserRoleId']

        $inviteDisplay = switch ($guestInviteSettings) {
            'none' { 'No one can invite' }
            'adminsAndGuestInviters' { 'Admins and guest inviters only' }
            'adminsGuestInvitersAndAllMembers' { 'All members can invite' }
            'everyone' { 'Everyone including guests' }
            default { $guestInviteSettings }
        }

        $inviteStatus = switch ($guestInviteSettings) {
            'none' { 'Pass' }
            'adminsAndGuestInviters' { 'Pass' }
            'adminsGuestInvitersAndAllMembers' { 'Review' }
            'everyone' { 'Warning' }
            default { 'Review' }
        }

        $settingParams = @{
            Category         = 'External Collaboration'
            Setting          = 'Guest Invitation Policy'
            CurrentValue     = $inviteDisplay
            RecommendedValue = 'Admins and guest inviters only'
            Status           = $inviteStatus
            CheckId          = 'ENTRA-GUEST-002'
            Remediation      = 'Run: Update-MgPolicyAuthorizationPolicy -AllowInvitesFrom ''adminsAndGuestInviters''. Entra admin center > External Identities > External collaboration settings.'
        }
        Add-Setting @settingParams

        # Guest user role
        $roleDisplay = switch ($guestAccessRestriction) {
            'a0b1b346-4d3e-4e8b-98f8-753987be4970' { 'Same as member users' }
            '10dae51f-b6af-4016-8d66-8c2a99b929b3' { 'Limited access (default)' }
            '2af84b1e-32c8-42b7-82bc-daa82404023b' { 'Restricted access' }
            default { $guestAccessRestriction }
        }

        $settingParams = @{
            Category         = 'External Collaboration'
            Setting          = 'Guest User Access Restriction'
            CurrentValue     = $roleDisplay
            RecommendedValue = 'Restricted access'
            Status           = $(if ($guestAccessRestriction -eq '2af84b1e-32c8-42b7-82bc-daa82404023b') { 'Pass' } else { 'Warning' })
            CheckId          = 'ENTRA-GUEST-001'
            Remediation      = 'Run: Update-MgPolicyAuthorizationPolicy -GuestUserRoleId ''2af84b1e-32c8-42b7-82bc-daa82404023b''. Entra admin center > External Identities > External collaboration settings.'
        }
        Add-Setting @settingParams
    }
    catch {
        Write-Warning "Could not check external collaboration: $_"
    }
}

# ------------------------------------------------------------------
# 11. Conditional Access Policy Count
# ------------------------------------------------------------------
try {
    Write-Verbose "Counting conditional access policies..."
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/v1.0/identity/conditionalAccess/policies'
        ErrorAction = 'Stop'
    }
    $caPolicies = Invoke-MgGraphRequest @graphParams
    $policyList = if ($caPolicies -and $caPolicies['value']) { @($caPolicies['value']) } else { @() }
    $caCount = $policyList.Count
    $enabledCount = @($policyList | Where-Object { $_['state'] -eq 'enabled' }).Count

    $settingParams = @{
        Category         = 'Conditional Access'
        Setting          = 'Total CA Policies'
        CurrentValue     = "$caCount"
        RecommendedValue = '1+'
        Status           = 'Info'
        CheckId          = 'ENTRA-CA-002'
        Remediation      = 'Informational — review Conditional Access policy coverage for your organization.'
    }
    Add-Setting @settingParams

    $settingParams = @{
        Category         = 'Conditional Access'
        Setting          = 'Enabled CA Policies'
        CurrentValue     = "$enabledCount"
        RecommendedValue = '1+'
        Status           = $(if ($enabledCount -gt 0) { 'Pass' } else { 'Warning' })
        CheckId          = 'ENTRA-CA-003'
        Remediation      = 'Run: Get-MgIdentityConditionalAccessPolicy | Where-Object {$_.State -eq ''enabled''}. Ensure policies are set to On, not Report-only.'
    }
    Add-Setting @settingParams

}
catch {
    Write-Warning "Could not check CA policies: $_"
}

# ------------------------------------------------------------------
# 12. Guest User Summary
# ------------------------------------------------------------------
try {
    Write-Verbose "Counting guest users..."
    $graphParams = @{
        Method      = 'GET'
        Uri         = "/v1.0/users/`$count?`$filter=userType eq 'Guest'"
        Headers     = @{ 'ConsistencyLevel' = 'eventual' }
        ErrorAction = 'Stop'
    }
    $guestCount = Invoke-MgGraphRequest @graphParams
    $settingParams = @{
        Category         = 'External Collaboration'
        Setting          = 'Guest User Count'
        CurrentValue     = "$guestCount"
        RecommendedValue = 'Review periodically'
        Status           = 'Info'
        CheckId          = 'ENTRA-GUEST-003'
        Remediation      = 'Informational — review and remove stale guest accounts periodically. Entra admin center > Users > Guest users.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not count guest users: $_"
}

# ------------------------------------------------------------------
# 13. Device Registration Policy (CIS 5.1.4.1, 5.1.4.2, 5.1.4.3)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking device registration policy..."
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/v1.0/policies/deviceRegistrationPolicy'
        ErrorAction = 'Stop'
    }
    $devicePolicy = Invoke-MgGraphRequest @graphParams

    if ($devicePolicy) {
        # CIS 5.1.4.1 — Device join restricted
        $joinType = $devicePolicy['azureADJoin']['allowedToJoin']['@odata.type']
        $joinRestricted = $joinType -ne '#microsoft.graph.allDeviceRegistrationMembership'
        $settingParams = @{
            Category         = 'Device Management'
            Setting          = 'Azure AD Join Restriction'
            CurrentValue     = $(if ($joinRestricted) { 'Restricted' } else { 'All users allowed' })
            RecommendedValue = 'Restricted to specific users/groups'
            Status           = $(if ($joinRestricted) { 'Pass' } else { 'Fail' })
            CheckId          = 'ENTRA-DEVICE-001'
            Remediation      = 'Entra admin center > Devices > Device settings > Users may join devices to Microsoft Entra > Selected. Restrict to a specific group of authorized users.'
        }
        Add-Setting @settingParams

        # CIS 5.1.4.2 — Max devices per user
        $maxDevices = $devicePolicy['userDeviceQuota']
        $settingParams = @{
            Category         = 'Device Management'
            Setting          = 'Maximum Devices Per User'
            CurrentValue     = "$maxDevices"
            RecommendedValue = '15 or fewer'
            Status           = $(if ($maxDevices -le 15) { 'Pass' } else { 'Fail' })
            CheckId          = 'ENTRA-DEVICE-002'
            Remediation      = 'Entra admin center > Devices > Device settings > Maximum number of devices per user. Set to 15 or lower.'
        }
        Add-Setting @settingParams

        # CIS 5.1.4.3 — Global admins not added as local admin on join
        $gaLocalAdmin = $true  # Default assumption
        if ($devicePolicy['azureADJoin']['localAdmins']) {
            $gaLocalAdmin = $devicePolicy['azureADJoin']['localAdmins']['enableGlobalAdmins']
        }
        $settingParams = @{
            Category         = 'Device Management'
            Setting          = 'Global Admins as Local Admin on Join'
            CurrentValue     = $(if ($gaLocalAdmin) { 'Enabled' } else { 'Disabled' })
            RecommendedValue = 'Disabled'
            Status           = $(if (-not $gaLocalAdmin) { 'Pass' } else { 'Fail' })
            CheckId          = 'ENTRA-DEVICE-003'
            Remediation      = 'Entra admin center > Devices > Device settings > Global administrator is added as local administrator on the device during Azure AD Join > No.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check device registration policy: $_"
}

# ------------------------------------------------------------------
# 14. LinkedIn Account Connections (CIS 5.1.2.6)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking LinkedIn account connections..."
    $tenantId = $context.TenantId
    $graphParams = @{
        Method      = 'GET'
        Uri         = "/beta/organization/$tenantId"
        ErrorAction = 'Stop'
    }
    $orgSettings = Invoke-MgGraphRequest @graphParams

    $linkedInEnabled = $true  # Default assumption
    if ($orgSettings -and $orgSettings['linkedInConfiguration']) {
        $linkedInEnabled = -not $orgSettings['linkedInConfiguration']['isDisabled']
    }

    $settingParams = @{
        Category         = 'Directory Settings'
        Setting          = 'LinkedIn Account Connections'
        CurrentValue     = $(if ($linkedInEnabled) { 'Enabled' } else { 'Disabled' })
        RecommendedValue = 'Disabled'
        Status           = $(if (-not $linkedInEnabled) { 'Pass' } else { 'Fail' })
        CheckId          = 'ENTRA-LINKEDIN-001'
        Remediation      = 'Entra admin center > Users > User settings > LinkedIn account connections > No. Prevents data leakage between LinkedIn and organizational directory.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check LinkedIn account connections: $_"
}

# ------------------------------------------------------------------
# 15. Per-user MFA Disabled (CIS 5.1.2.1)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking per-user MFA state..."
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/beta/reports/authenticationMethods/userRegistrationDetails?$select=userPrincipalName,isMfaRegistered,isMfaCapable&$top=1'
        ErrorAction = 'Stop'
    }
    Invoke-MgGraphRequest @graphParams | Out-Null
    # Graph doesn't directly expose legacy per-user MFA state (MSOnline concept).
    # We confirm API access works, then emit Review since we can't verify enforcement mode.
    $settingParams = @{
        Category         = 'Authentication Methods'
        Setting          = 'Per-user MFA (Legacy)'
        CurrentValue     = 'Review -- verify no per-user MFA states are set to Enforced or Enabled'
        RecommendedValue = 'All per-user MFA disabled (use CA policies)'
        Status           = 'Review'
        CheckId          = 'ENTRA-PERUSER-001'
        Remediation      = 'Entra admin center > Users > Per-user MFA > Ensure all users show Disabled. Use Conditional Access policies for MFA enforcement instead of per-user MFA.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check per-user MFA: $_"
    $settingParams = @{
        Category         = 'Authentication Methods'
        Setting          = 'Per-user MFA (Legacy)'
        CurrentValue     = 'Could not query -- verify manually'
        RecommendedValue = 'All per-user MFA disabled (use CA policies)'
        Status           = 'Review'
        CheckId          = 'ENTRA-PERUSER-001'
        Remediation      = 'Entra admin center > Users > Per-user MFA > Ensure all users show Disabled. Use Conditional Access policies for MFA enforcement instead.'
    }
    Add-Setting @settingParams
}

# ------------------------------------------------------------------
# 16. Third-party Integrated Apps Blocked (CIS 5.1.2.2)
# ------------------------------------------------------------------
if ($authPolicy) {
    try {
        Write-Verbose "Checking third-party integrated apps..."
        $allowedToCreateApps = $authPolicy['defaultUserRolePermissions']['allowedToCreateApps']
        # CIS 5.1.2.2 checks that third-party integrated apps are not allowed
        # This is closely related to ENTRA-APPREG-001 but specifically targets integrated apps
        $settingParams = @{
            Category         = 'Application Consent'
            Setting          = 'Third-party Integrated Apps Restricted'
            CurrentValue     = $(if (-not $allowedToCreateApps) { 'Restricted' } else { 'Allowed' })
            RecommendedValue = 'Restricted'
            Status           = $(if (-not $allowedToCreateApps) { 'Pass' } else { 'Fail' })
            CheckId          = 'ENTRA-APPS-001'
            Remediation      = 'Entra admin center > Users > User settings > Users can register applications > No. Also review Enterprise applications > User settings > Users can consent to apps.'
        }
        Add-Setting @settingParams
    }
    catch {
        Write-Warning "Could not check third-party app restrictions: $_"
    }
}

# ------------------------------------------------------------------
# 17. Guest Invitation Domain Restrictions (CIS 5.1.6.1)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking guest invitation domain restrictions..."
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/v1.0/policies/crossTenantAccessPolicy/default'
        ErrorAction = 'Stop'
    }
    $crossTenantPolicy = Invoke-MgGraphRequest @graphParams

    $b2bCollabInbound = $crossTenantPolicy['b2bCollaborationInbound']
    $isRestricted = $false
    if ($b2bCollabInbound -and $b2bCollabInbound['applications']) {
        $accessType = $b2bCollabInbound['applications']['accessType']
        $isRestricted = ($accessType -eq 'blocked' -or $accessType -eq 'allowed')
    }

    # Also check authorizationPolicy allowInvitesFrom
    $invitesFrom = if ($authPolicy) { $authPolicy['allowInvitesFrom'] } else { 'unknown' }
    $domainRestricted = ($invitesFrom -ne 'everyone') -and $isRestricted

    $settingParams = @{
        Category         = 'External Collaboration'
        Setting          = 'Guest Invitation Domain Restrictions'
        CurrentValue     = $(if ($domainRestricted) { "Restricted (invites: $invitesFrom)" } else { "Open (invites: $invitesFrom)" })
        RecommendedValue = 'Restricted to allowed domains only'
        Status           = $(if ($invitesFrom -eq 'none' -or $domainRestricted) { 'Pass' } elseif ($invitesFrom -ne 'everyone') { 'Review' } else { 'Fail' })
        CheckId          = 'ENTRA-GUEST-004'
        Remediation      = 'Entra admin center > External Identities > External collaboration settings > Collaboration restrictions > Allow invitations only to the specified domains.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check guest invitation restrictions: $_"
}

# ------------------------------------------------------------------
# 18. Dynamic Group for Guest Users (CIS 5.1.3.1)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking for dynamic guest group..."
    $graphParams = @{
        Method      = 'GET'
        Uri         = "/v1.0/groups?`$filter=groupTypes/any(g:g eq 'DynamicMembership')&`$select=displayName,membershipRule&`$top=999"
        ErrorAction = 'Stop'
    }
    $dynamicGroups = Invoke-MgGraphRequest @graphParams
    $dynamicGroupList = if ($dynamicGroups -and $dynamicGroups['value']) { @($dynamicGroups['value']) } else { @() }
    $guestGroups = @($dynamicGroupList | Where-Object {
        $_['membershipRule'] -and $_['membershipRule'] -match 'user\.userType\s+(-eq|-contains)\s+.?Guest'
    })

    if ($guestGroups.Count -gt 0) {
        $names = ($guestGroups | ForEach-Object { $_['displayName'] }) -join '; '
        $settingParams = @{
            Category         = 'External Collaboration'
            Setting          = 'Dynamic Group for Guest Users'
            CurrentValue     = "Yes ($($guestGroups.Count) group: $names)"
            RecommendedValue = 'At least 1 dynamic group for guests'
            Status           = 'Pass'
            CheckId          = 'ENTRA-GROUP-002'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }
    else {
        $settingParams = @{
            Category         = 'External Collaboration'
            Setting          = 'Dynamic Group for Guest Users'
            CurrentValue     = 'No dynamic guest group found'
            RecommendedValue = 'At least 1 dynamic group for guests'
            Status           = 'Fail'
            CheckId          = 'ENTRA-GROUP-002'
            Remediation      = 'Entra admin center > Groups > New group > Membership type = Dynamic User > Rule: (user.userType -eq "Guest"). This enables targeted policies for guest users.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check dynamic guest groups: $_"
}

# ------------------------------------------------------------------
# 19. Device Registration Extensions (CIS 5.1.4.4, 5.1.4.5, 5.1.4.6)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking extended device registration settings..."
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/beta/policies/deviceRegistrationPolicy'
        ErrorAction = 'Stop'
    }
    $devicePolicyBeta = Invoke-MgGraphRequest @graphParams

    if ($devicePolicyBeta) {
        # CIS 5.1.4.4 -- Local admin assignment limited during Entra join
        $localAdminSettings = $devicePolicyBeta['azureADJoin']['localAdmins']
        $additionalAdmins = if ($localAdminSettings -and $localAdminSettings['registeredUsers']) {
            $localAdminSettings['registeredUsers']['additionalLocalAdminsCount']
        } else { 0 }
        $settingParams = @{
            Category         = 'Device Management'
            Setting          = 'Local Admin Assignment on Entra Join'
            CurrentValue     = "Additional local admins configured: $additionalAdmins"
            RecommendedValue = 'Minimal local admin assignment'
            Status           = $(if ($additionalAdmins -le 0) { 'Pass' } else { 'Review' })
            CheckId          = 'ENTRA-DEVICE-004'
            Remediation      = 'Entra admin center > Devices > Device settings > Manage Additional local administrators on all Azure AD joined devices. Minimize additional local admins.'
        }
        Add-Setting @settingParams

        # CIS 5.1.4.5 -- LAPS enabled
        $lapsEnabled = $false
        if ($devicePolicyBeta['localAdminPassword']) {
            $lapsEnabled = $devicePolicyBeta['localAdminPassword']['isEnabled']
        }
        $settingParams = @{
            Category         = 'Device Management'
            Setting          = 'Local Administrator Password Solution (LAPS)'
            CurrentValue     = $(if ($lapsEnabled) { 'Enabled' } else { 'Disabled' })
            RecommendedValue = 'Enabled'
            Status           = $(if ($lapsEnabled) { 'Pass' } else { 'Fail' })
            CheckId          = 'ENTRA-DEVICE-005'
            Remediation      = 'Entra admin center > Devices > Device settings > Enable Microsoft Entra Local Administrator Password Solution (LAPS) > Yes.'
        }
        Add-Setting @settingParams

        # CIS 5.1.4.6 -- BitLocker recovery key restricted
        # Beta API may expose this via deviceRegistrationPolicy or directorySettings
        $settingParams = @{
            Category         = 'Device Management'
            Setting          = 'BitLocker Recovery Key Restriction'
            CurrentValue     = 'Review -- verify users cannot read own BitLocker keys'
            RecommendedValue = 'Users restricted from recovering BitLocker keys'
            Status           = 'Review'
            CheckId          = 'ENTRA-DEVICE-006'
            Remediation      = 'Entra admin center > Devices > Device settings > Restrict users from recovering the BitLocker key(s) for their owned devices > Yes.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check extended device registration settings: $_"
}

# ------------------------------------------------------------------
# 20. Authenticator Fatigue Protection (CIS 5.2.3.1)
# ------------------------------------------------------------------
try {
    if ($sspr) {
        $authMethods = $sspr['authenticationMethodConfigurations']
        $authenticator = $authMethods | Where-Object { $_['id'] -eq 'MicrosoftAuthenticator' }

        if ($authenticator) {
            $featureSettings = $authenticator['featureSettings']
            $numberMatch = $featureSettings['numberMatchingRequiredState']['state']
            $appInfo = $featureSettings['displayAppInformationRequiredState']['state']

            $fatiguePassed = ($numberMatch -eq 'enabled') -and ($appInfo -eq 'enabled')
            $settingParams = @{
                Category         = 'Authentication Methods'
                Setting          = 'Authenticator Fatigue Protection'
                CurrentValue     = "Number matching: $numberMatch; App context: $appInfo"
                RecommendedValue = 'Both enabled'
                Status           = $(if ($fatiguePassed) { 'Pass' } else { 'Fail' })
                CheckId          = 'ENTRA-AUTHMETHOD-003'
                Remediation      = 'Entra admin center > Protection > Authentication methods > Microsoft Authenticator > Configure > Require number matching = Enabled, Show application name = Enabled.'
            }
            Add-Setting @settingParams
        }
        else {
            $settingParams = @{
                Category         = 'Authentication Methods'
                Setting          = 'Authenticator Fatigue Protection'
                CurrentValue     = 'Microsoft Authenticator not configured'
                RecommendedValue = 'Both enabled'
                Status           = 'Review'
                CheckId          = 'ENTRA-AUTHMETHOD-003'
                Remediation      = 'Enable Microsoft Authenticator and configure number matching + application context display.'
            }
            Add-Setting @settingParams
        }
    }
}
catch {
    Write-Warning "Could not check authenticator fatigue protection: $_"
}

# ------------------------------------------------------------------
# 21. System-Preferred MFA (CIS 5.2.3.6)
# ------------------------------------------------------------------
try {
    if ($sspr) {
        $systemPreferred = $sspr['systemCredentialPreferences']
        $sysState = if ($systemPreferred) { $systemPreferred['state'] } else { 'not configured' }

        $settingParams = @{
            Category         = 'Authentication Methods'
            Setting          = 'System-Preferred MFA'
            CurrentValue     = "$sysState"
            RecommendedValue = 'enabled'
            Status           = $(if ($sysState -eq 'enabled') { 'Pass' } else { 'Fail' })
            CheckId          = 'ENTRA-AUTHMETHOD-004'
            Remediation      = 'Entra admin center > Protection > Authentication methods > Settings > System-preferred multifactor authentication > Enabled.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check system-preferred MFA: $_"
}

# ------------------------------------------------------------------
# 22. Privileged Identity Management (CIS 5.3.x) -- requires Entra ID P2
# ------------------------------------------------------------------
$pimAvailable = $true
$pimRoleAssignments = $null
$script:pimMessage = $null

# Check if tenant has P2/E5 capability for PIM
$hasPimLicense = $false
try {
    $skus = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/subscribedSkus' -ErrorAction Stop
    $skuList = if ($skus -and $skus['value']) { @($skus['value']) } else { @() }
    $pimSkuIds = @(
        'eec0eb4f-6444-4f95-aba0-50c24d67f998'  # AAD_PREMIUM_P2
        '06ebc4ee-1bb5-47dd-8120-11324bc54e06'  # SPE_E5 (M365 E5)
        'b05e124f-c7cc-45a0-a6aa-8cf78c946968'  # EMSPREMIUM (EMS E5)
        'cd2925a3-5076-4233-8931-638a8c94f773'  # SPE_E5_NOPSTNCONF
    )
    foreach ($sku in $skuList) {
        if ($sku['skuId'] -in $pimSkuIds -and $sku['capabilityStatus'] -eq 'Enabled') {
            $hasPimLicense = $true
            break
        }
    }
}
catch {
    Write-Verbose "Could not check SKU licenses: $_"
}

# Skip PIM API query entirely when no P2 license -- empty results from PIM APIs
# on unlicensed tenants would be falsely interpreted as "no permanent assignments"
if (-not $hasPimLicense) {
    $pimAvailable = $false
    $script:pimMessage = 'PIM not licensed (Entra ID P2 required) -- cannot verify role assignment permanence'
}
else {
    try {
        Write-Verbose "Checking PIM role assignments..."
        $graphParams = @{
            Method      = 'GET'
            Uri         = '/beta/roleManagement/directory/roleAssignmentScheduleInstances'
            ErrorAction = 'Stop'
        }
        $pimRoleAssignments = Invoke-MgGraphRequest @graphParams
    }
    catch {
        if ($_.Exception.Message -match '403|Forbidden|Authorization|license') {
            $pimAvailable = $false
            $script:pimMessage = 'PIM is available but not configured in this tenant'
        }
        else {
            Write-Warning "Could not check PIM role assignments: $_"
            $pimAvailable = $false
            $script:pimMessage = "Could not check PIM: $($_.Exception.Message)"
        }
    }
}

if ($pimAvailable -and $pimRoleAssignments -and $pimRoleAssignments['value']) {
    # CIS 5.3.1 -- PIM manages privileged roles (no permanent GA assignments)
    $gaRoleTemplateId = '62e90394-69f5-4237-9190-012177145e10'
    $permanentGA = @($pimRoleAssignments['value'] | Where-Object {
        $_['roleDefinitionId'] -eq $gaRoleTemplateId -and
        $_['assignmentType'] -eq 'Activated' -and
        (-not $_['endDateTime'] -or $_['endDateTime'] -eq '9999-12-31T23:59:59Z')
    })

    $settingParams = @{
        Category         = 'Privileged Identity Management'
        Setting          = 'PIM Manages Privileged Roles'
        CurrentValue     = $(if ($permanentGA.Count -eq 0) { 'No permanent GA assignments' } else { "$($permanentGA.Count) permanent GA assignment(s) found" })
        RecommendedValue = 'No permanent Global Admin assignments'
        Status           = $(if ($permanentGA.Count -eq 0) { 'Pass' } else { 'Fail' })
        CheckId          = 'ENTRA-PIM-001'
        Remediation      = 'Entra admin center > Identity Governance > Privileged Identity Management > Azure AD roles > Global Administrator > Remove permanent active assignments. Use eligible assignments with time-bound activation.'
    }
    Add-Setting @settingParams
}
elseif (-not $pimAvailable) {
    $settingParams = @{
        Category         = 'Privileged Identity Management'
        Setting          = 'PIM Manages Privileged Roles'
        CurrentValue     = $script:pimMessage
        RecommendedValue = 'PIM enabled for all privileged roles'
        Status           = 'Review'
        CheckId          = 'ENTRA-PIM-001'
        Remediation      = 'This check requires Entra ID P2 (included in M365 E5). Enable PIM at Entra admin center > Identity Governance > Privileged Identity Management.'
    }
    Add-Setting @settingParams
}

# CIS 5.3.2/5.3.3 -- Access reviews for guests and privileged roles
$accessReviews = $null
if ($pimAvailable) {
    try {
        Write-Verbose "Checking access reviews..."
        $graphParams = @{
            Method      = 'GET'
            Uri         = '/beta/identityGovernance/accessReviews/definitions?$top=100'
            ErrorAction = 'Stop'
        }
        $accessReviews = Invoke-MgGraphRequest @graphParams
    }
    catch {
        if ($_.Exception.Message -match '403|Forbidden|Authorization|license') {
            $pimAvailable = $false
        }
        else {
            Write-Warning "Could not check access reviews: $_"
        }
    }
}

if ($accessReviews -and $accessReviews['value']) {
    $allReviews = @($accessReviews['value'])

    # CIS 5.3.2 -- Guest access reviews
    $guestReviews = @($allReviews | Where-Object {
        $_['scope'] -and ($_['scope']['query'] -match 'guest' -or $_['scope']['@odata.type'] -match 'guest')
    })
    $settingParams = @{
        Category         = 'Privileged Identity Management'
        Setting          = 'Access Reviews for Guest Users'
        CurrentValue     = $(if ($guestReviews.Count -gt 0) { "$($guestReviews.Count) guest access review(s) configured" } else { 'No guest access reviews found' })
        RecommendedValue = 'At least 1 access review for guests'
        Status           = $(if ($guestReviews.Count -gt 0) { 'Pass' } else { 'Fail' })
        CheckId          = 'ENTRA-PIM-002'
        Remediation      = 'Entra admin center > Identity Governance > Access reviews > New access review > Review type: Guest users only. Schedule recurring reviews.'
    }
    Add-Setting @settingParams

    # CIS 5.3.3 -- Privileged role access reviews
    $roleReviews = @($allReviews | Where-Object {
        $_['scope'] -and ($_['scope']['query'] -match 'roleManagement|directoryRole')
    })
    $settingParams = @{
        Category         = 'Privileged Identity Management'
        Setting          = 'Access Reviews for Privileged Roles'
        CurrentValue     = $(if ($roleReviews.Count -gt 0) { "$($roleReviews.Count) privileged role review(s) configured" } else { 'No privileged role access reviews found' })
        RecommendedValue = 'At least 1 access review for admin roles'
        Status           = $(if ($roleReviews.Count -gt 0) { 'Pass' } else { 'Fail' })
        CheckId          = 'ENTRA-PIM-003'
        Remediation      = 'Entra admin center > Identity Governance > Access reviews > New access review > Review type: Members of a group or Users assigned to a privileged role.'
    }
    Add-Setting @settingParams
}
elseif (-not $pimAvailable) {
    $settingParams = @{
        Category         = 'Privileged Identity Management'
        Setting          = 'Access Reviews for Guest Users'
        CurrentValue     = $script:pimMessage
        RecommendedValue = 'At least 1 access review for guests'
        Status           = 'Review'
        CheckId          = 'ENTRA-PIM-002'
        Remediation      = 'This check requires Entra ID P2 (included in M365 E5). Entra admin center > Identity Governance > Access reviews.'
    }
    Add-Setting @settingParams

    $settingParams = @{
        Category         = 'Privileged Identity Management'
        Setting          = 'Access Reviews for Privileged Roles'
        CurrentValue     = $script:pimMessage
        RecommendedValue = 'At least 1 access review for admin roles'
        Status           = 'Review'
        CheckId          = 'ENTRA-PIM-003'
        Remediation      = 'This check requires Entra ID P2 (included in M365 E5). Entra admin center > Identity Governance > Access reviews.'
    }
    Add-Setting @settingParams
}

# CIS 5.3.4/5.3.5 -- PIM activation approval for GA and PRA
$roleManagementPolicies = $null
if ($pimAvailable) {
    try {
        Write-Verbose "Checking PIM role management policies..."
        $graphParams = @{
            Method      = 'GET'
            Uri         = '/beta/policies/roleManagementPolicies?$expand=rules'
            ErrorAction = 'Stop'
        }
        $roleManagementPolicies = Invoke-MgGraphRequest @graphParams
    }
    catch {
        if ($_.Exception.Message -match '403|Forbidden|Authorization|license') {
            $pimAvailable = $false
        }
        else {
            Write-Warning "Could not check PIM policies: $_"
        }
    }
}

if ($roleManagementPolicies -and $roleManagementPolicies['value']) {
    $allPolicies = @($roleManagementPolicies['value'])

    # CIS 5.3.4 -- GA activation approval
    $gaPolicy = $allPolicies | Where-Object {
        $_['scopeId'] -eq '/' -and $_['scopeType'] -eq 'DirectoryRole' -and
        $_['displayName'] -match 'Global Administrator'
    } | Select-Object -First 1

    $gaApprovalRequired = $false
    if ($gaPolicy -and $gaPolicy['rules']) {
        $approvalRule = $gaPolicy['rules'] | Where-Object { $_['@odata.type'] -match 'ApprovalRule' }
        if ($approvalRule) {
            $gaApprovalRequired = $approvalRule['setting']['isApprovalRequired']
        }
    }

    $settingParams = @{
        Category         = 'Privileged Identity Management'
        Setting          = 'GA Activation Requires Approval'
        CurrentValue     = $(if ($gaApprovalRequired) { 'Yes' } else { 'No' })
        RecommendedValue = 'Yes'
        Status           = $(if ($gaApprovalRequired) { 'Pass' } else { 'Fail' })
        CheckId          = 'ENTRA-PIM-004'
        Remediation      = 'Entra admin center > Identity Governance > PIM > Azure AD roles > Settings > Global Administrator > Require approval to activate > Yes.'
    }
    Add-Setting @settingParams

    # CIS 5.3.5 -- PRA activation approval
    $praPolicy = $allPolicies | Where-Object {
        $_['scopeId'] -eq '/' -and $_['scopeType'] -eq 'DirectoryRole' -and
        $_['displayName'] -match 'Privileged Role Administrator'
    } | Select-Object -First 1

    $praApprovalRequired = $false
    if ($praPolicy -and $praPolicy['rules']) {
        $approvalRule = $praPolicy['rules'] | Where-Object { $_['@odata.type'] -match 'ApprovalRule' }
        if ($approvalRule) {
            $praApprovalRequired = $approvalRule['setting']['isApprovalRequired']
        }
    }

    $settingParams = @{
        Category         = 'Privileged Identity Management'
        Setting          = 'PRA Activation Requires Approval'
        CurrentValue     = $(if ($praApprovalRequired) { 'Yes' } else { 'No' })
        RecommendedValue = 'Yes'
        Status           = $(if ($praApprovalRequired) { 'Pass' } else { 'Fail' })
        CheckId          = 'ENTRA-PIM-005'
        Remediation      = 'Entra admin center > Identity Governance > PIM > Azure AD roles > Settings > Privileged Role Administrator > Require approval to activate > Yes.'
    }
    Add-Setting @settingParams
}
elseif (-not $pimAvailable) {
    $settingParams = @{
        Category         = 'Privileged Identity Management'
        Setting          = 'GA Activation Requires Approval'
        CurrentValue     = $script:pimMessage
        RecommendedValue = 'Yes'
        Status           = 'Review'
        CheckId          = 'ENTRA-PIM-004'
        Remediation      = 'This check requires Entra ID P2 (included in M365 E5). Entra admin center > Identity Governance > PIM > Azure AD roles > Settings.'
    }
    Add-Setting @settingParams

    $settingParams = @{
        Category         = 'Privileged Identity Management'
        Setting          = 'PRA Activation Requires Approval'
        CurrentValue     = $script:pimMessage
        RecommendedValue = 'Yes'
        Status           = 'Review'
        CheckId          = 'ENTRA-PIM-005'
        Remediation      = 'This check requires Entra ID P2 (included in M365 E5). Entra admin center > Identity Governance > PIM > Azure AD roles > Settings.'
    }
    Add-Setting @settingParams
}

# ------------------------------------------------------------------
# 23. Cloud-Only Admin Accounts (CIS 1.1.1)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking Global Administrator accounts for cloud-only status..."
    $gaRoleTemplateId = '62e90394-69f5-4237-9190-012177145e10'
    $graphParams = @{
        Method      = 'GET'
        Uri         = "/v1.0/directoryRoles/roleTemplateId=$gaRoleTemplateId/members?`$select=displayName,userPrincipalName,onPremisesSyncEnabled"
        ErrorAction = 'Stop'
    }
    $gaMembers = Invoke-MgGraphRequest @graphParams

    $gaList = if ($gaMembers -and $gaMembers['value']) { @($gaMembers['value']) } else { @() }
    $syncedAdmins = @($gaList | Where-Object { $_['onPremisesSyncEnabled'] -eq $true })

    if ($syncedAdmins.Count -eq 0) {
        $settingParams = @{
            Category         = 'Admin Accounts'
            Setting          = 'Cloud-Only Global Admins'
            CurrentValue     = "All $($gaList.Count) GA accounts are cloud-only"
            RecommendedValue = 'All admin accounts cloud-only'
            Status           = 'Pass'
            CheckId          = 'ENTRA-CLOUDADMIN-001'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }
    else {
        $syncedNames = ($syncedAdmins | ForEach-Object { $_['displayName'] }) -join ', '
        $settingParams = @{
            Category         = 'Admin Accounts'
            Setting          = 'Cloud-Only Global Admins'
            CurrentValue     = "$($syncedAdmins.Count) synced: $syncedNames"
            RecommendedValue = 'All admin accounts cloud-only'
            Status           = 'Fail'
            CheckId          = 'ENTRA-CLOUDADMIN-001'
            Remediation      = 'Create cloud-only admin accounts instead of using on-premises synced accounts. Entra admin center > Users > New user > Create user (cloud identity).'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check cloud-only admin accounts: $_"
}

# ------------------------------------------------------------------
# 24. Admin License Footprint (CIS 1.1.4)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking admin account license assignments..."
    $gaRoleTemplateId = '62e90394-69f5-4237-9190-012177145e10'
    $graphParams = @{
        Method      = 'GET'
        Uri         = "/v1.0/directoryRoles/roleTemplateId=$gaRoleTemplateId/members?`$select=displayName,assignedLicenses"
        ErrorAction = 'Stop'
    }
    $gaUsersLicense = Invoke-MgGraphRequest @graphParams

    # E3/E5 SKU part IDs (productivity suites that admins shouldn't have)
    $productivitySkus = @(
        '05e9a617-0261-4cee-bb36-b42c3d50e6a0',  # SPE_E3 (M365 E3)
        '06ebc4ee-1bb5-47dd-8120-11324bc54e06',  # SPE_E5 (M365 E5)
        '6fd2c87f-b296-42f0-b197-1e91e994b900',  # ENTERPRISEPACK (O365 E3)
        'c7df2760-2c81-4ef7-b578-5b5392b571df'   # ENTERPRISEPREMIUM (O365 E5)
    )

    $gaLicenseList = if ($gaUsersLicense -and $gaUsersLicense['value']) { @($gaUsersLicense['value']) } else { @() }
    $heavyLicensed = @($gaLicenseList | Where-Object {
        $licenses = $_['assignedLicenses']
        $licenses | Where-Object { $productivitySkus -contains $_['skuId'] }
    })

    if ($heavyLicensed.Count -eq 0) {
        $settingParams = @{
            Category         = 'Admin Accounts'
            Setting          = 'Admin License Footprint'
            CurrentValue     = 'No GA accounts have full productivity licenses'
            RecommendedValue = 'Admins use minimal license (Entra P2 only)'
            Status           = 'Pass'
            CheckId          = 'ENTRA-CLOUDADMIN-002'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }
    else {
        $names = ($heavyLicensed | ForEach-Object { $_['displayName'] }) -join ', '
        $settingParams = @{
            Category         = 'Admin Accounts'
            Setting          = 'Admin License Footprint'
            CurrentValue     = "$($heavyLicensed.Count) GA with productivity license: $names"
            RecommendedValue = 'Admins use minimal license (Entra P2 only)'
            Status           = 'Warning'
            CheckId          = 'ENTRA-CLOUDADMIN-002'
            Remediation      = 'Assign admin accounts minimal licenses (Entra ID P2). Do not assign E3/E5 productivity suites. M365 admin center > Users > Active users > Licenses.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check admin license footprint: $_"
}

# ------------------------------------------------------------------
# 25. Public Groups Have Owners (CIS 1.2.1)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking public M365 groups for owner assignment..."
    # Fetch M365 groups and filter for Public visibility client-side.
    # Server-side $filter on 'visibility' requires Directory.Read.All and
    # can fail in tenants with restricted directory permissions.
    $graphParams = @{
        Method      = 'GET'
        Uri         = "/v1.0/groups?`$filter=groupTypes/any(g:g eq 'Unified')&`$select=displayName,id,visibility&`$top=999"
        ErrorAction = 'Stop'
    }
    $unifiedGroups = Invoke-MgGraphRequest @graphParams

    $publicGroupList = if ($unifiedGroups -and $unifiedGroups['value']) {
        @($unifiedGroups['value'] | Where-Object { $_['visibility'] -eq 'Public' })
    } else { @() }
    $noOwnerGroups = @()
    foreach ($group in $publicGroupList) {
        $graphParams = @{
            Method      = 'GET'
            Uri         = "/v1.0/groups/$($group['id'])/owners?`$select=id"
            ErrorAction = 'SilentlyContinue'
        }
        $owners = Invoke-MgGraphRequest @graphParams
        if (-not $owners['value'] -or $owners['value'].Count -eq 0) {
            $noOwnerGroups += $group['displayName']
        }
    }

    if ($noOwnerGroups.Count -eq 0) {
        $settingParams = @{
            Category         = 'Group Management'
            Setting          = 'Public Groups Have Owners'
            CurrentValue     = "$($publicGroupList.Count) public groups, all have owners"
            RecommendedValue = 'All public groups have assigned owners'
            Status           = 'Pass'
            CheckId          = 'ENTRA-GROUP-003'
            Remediation      = 'No action needed.'
        }
        Add-Setting @settingParams
    }
    else {
        $groupList = ($noOwnerGroups | Select-Object -First 5) -join ', '
        $suffix = if ($noOwnerGroups.Count -gt 5) { " (+$($noOwnerGroups.Count - 5) more)" } else { '' }
        $settingParams = @{
            Category         = 'Group Management'
            Setting          = 'Public Groups Have Owners'
            CurrentValue     = "$($noOwnerGroups.Count) groups without owners: $groupList$suffix"
            RecommendedValue = 'All public groups have assigned owners'
            Status           = 'Fail'
            CheckId          = 'ENTRA-GROUP-003'
            Remediation      = 'Assign owners to ownerless public M365 groups. Entra admin center > Groups > All groups > select group > Owners > Add owners.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check public group owners: $_"
}

# ------------------------------------------------------------------
# 26. User Owned Apps Restricted (CIS 1.3.4)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking user consent for apps..."
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/v1.0/policies/authorizationPolicy'
        ErrorAction = 'Stop'
    }
    $consentPolicy = Invoke-MgGraphRequest @graphParams

    $consentSetting = $consentPolicy['defaultUserRolePermissions']['permissionGrantPoliciesAssigned']
    $isRestricted = ($null -eq $consentSetting) -or ($consentSetting.Count -eq 0) -or
                    ($consentSetting -notcontains 'ManagePermissionGrantsForSelf.microsoft-user-default-legacy')

    $settingParams = @{
        Category         = 'Organization Settings'
        Setting          = 'Org-Level App Consent Restriction'
        CurrentValue     = $(if ($isRestricted) { 'Restricted' } else { "Allowed: $($consentSetting -join ', ')" })
        RecommendedValue = 'Do not allow user consent'
        Status           = $(if ($isRestricted) { 'Pass' } else { 'Fail' })
        CheckId          = 'ENTRA-ORGSETTING-001'
        Remediation      = 'Entra admin center > Enterprise applications > Consent and permissions > User consent settings > Do not allow user consent.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check user app consent: $_"
}

# ------------------------------------------------------------------
# 27. Password Protection On-Premises (CIS 5.2.3.3)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking password protection on-premises setting..."

    # Check if tenant uses directory sync (hybrid) -- on-prem check is irrelevant for cloud-only
    # Reuse $orgSettings from section 14 (LinkedIn check) which fetches /beta/organization/{tenantId}
    $isCloudOnly = $true
    if ($orgSettings -and $orgSettings['onPremisesSyncEnabled'] -eq $true) {
        $isCloudOnly = $false
    }
    elseif (-not $orgSettings) {
        $isCloudOnly = $null  # Org data not available -- fall through to normal check
    }

    if ($isCloudOnly -eq $true) {
        $settingParams = @{
            Category         = 'Password Management'
            Setting          = 'Password Protection On-Premises'
            CurrentValue     = 'Not applicable (cloud-only tenant)'
            RecommendedValue = 'True (if hybrid)'
            Status           = 'Info'
            CheckId          = 'ENTRA-PASSWORD-005'
            Remediation      = 'Not applicable for cloud-only tenants. If you configure hybrid identity in the future, enable on-premises password protection.'
        }
        Add-Setting @settingParams
    }
    # Reuse $pwSettings from section 8 if available
    elseif ($pwSettings) {
        $onPremEntry = if ($pwSettings['values']) { $pwSettings['values'] | Where-Object { $_['name'] -eq 'EnableBannedPasswordCheckOnPremises' } } else { $null }
        $onPremEnabled = if ($onPremEntry) { $onPremEntry['value'] } else { $null }
        $settingParams = @{
            Category         = 'Password Management'
            Setting          = 'Password Protection On-Premises'
            CurrentValue     = "$onPremEnabled"
            RecommendedValue = 'True'
            Status           = $(if ($onPremEnabled -eq 'True') { 'Pass' } else { 'Fail' })
            CheckId          = 'ENTRA-PASSWORD-005'
            Remediation      = 'Entra admin center > Protection > Authentication methods > Password protection > Enable password protection on Windows Server Active Directory > Yes.'
        }
        Add-Setting @settingParams
    }
    else {
        $settingParams = @{
            Category         = 'Password Management'
            Setting          = 'Password Protection On-Premises'
            CurrentValue     = 'Password Rule Settings not available'
            RecommendedValue = 'True'
            Status           = 'Review'
            CheckId          = 'ENTRA-PASSWORD-005'
            Remediation      = 'Entra admin center > Protection > Authentication methods > Password protection. Verify on-premises password protection is enabled.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check password protection on-premises: $_"
}

# ------------------------------------------------------------------
# 28-30. Organization Settings (Review-only CIS 1.3.5, 1.3.7, 1.3.9)
# ------------------------------------------------------------------
$settingParams = @{
    Category         = 'Organization Settings'
    Setting          = 'Forms Internal Phishing Protection'
    CurrentValue     = 'Cannot be checked via API'
    RecommendedValue = 'Enabled'
    Status           = 'Review'
    CheckId          = 'ENTRA-ORGSETTING-002'
    Remediation      = 'M365 admin center > Settings > Org settings > Microsoft Forms > ensure internal phishing protection is enabled.'
}
Add-Setting @settingParams

$settingParams = @{
    Category         = 'Organization Settings'
    Setting          = 'Third-Party Storage in M365 Web Apps'
    CurrentValue     = 'Cannot be checked via API'
    RecommendedValue = 'Restricted (all third-party storage disabled)'
    Status           = 'Review'
    CheckId          = 'ENTRA-ORGSETTING-003'
    Remediation      = 'M365 admin center > Settings > Org settings > Microsoft 365 on the web > uncheck all third-party storage services.'
}
Add-Setting @settingParams

$settingParams = @{
    Category         = 'Organization Settings'
    Setting          = 'Shared Bookings Pages Restricted'
    CurrentValue     = 'Cannot be checked via API'
    RecommendedValue = 'Restricted to selected users'
    Status           = 'Review'
    CheckId          = 'ENTRA-ORGSETTING-004'
    Remediation      = 'M365 admin center > Settings > Org settings > Bookings > restrict shared booking pages to selected staff members.'
}
Add-Setting @settingParams

# ------------------------------------------------------------------
# 31. Entra Admin Center Access Restriction (CIS 5.1.2.4)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking Entra admin center access restriction..."
    if ($authPolicy -and $null -ne $authPolicy['restrictNonAdminUsers']) {
        $restricted = $authPolicy['restrictNonAdminUsers']
        $settingParams = @{
            Category         = 'Access Control'
            Setting          = 'Entra Admin Center Restricted'
            CurrentValue     = "$restricted"
            RecommendedValue = 'True'
            Status           = $(if ($restricted) { 'Pass' } else { 'Fail' })
            CheckId          = 'ENTRA-ADMIN-002'
            Remediation      = 'Entra admin center > Identity > Users > User settings > Administration center > set "Restrict access to Microsoft Entra admin center" to Yes.'
        }
        Add-Setting @settingParams
    }
    else {
        $settingParams = @{
            Category         = 'Access Control'
            Setting          = 'Entra Admin Center Restricted'
            CurrentValue     = 'Property not available'
            RecommendedValue = 'True'
            Status           = 'Review'
            CheckId          = 'ENTRA-ADMIN-002'
            Remediation      = 'Entra admin center > Identity > Users > User settings > Administration center > verify "Restrict access to Microsoft Entra admin center" is set to Yes.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check Entra admin center restriction: $_"
}

# ------------------------------------------------------------------
# 32. Emergency Access Accounts (CIS 1.1.2)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking for emergency access (break-glass) accounts..."
    $graphParams = @{
        Method      = 'GET'
        Uri         = "/v1.0/users?`$select=displayName,userPrincipalName,accountEnabled&`$top=999"
        ErrorAction = 'Stop'
    }
    $allUsers = Invoke-MgGraphRequest @graphParams

    $allUserList = if ($allUsers -and $allUsers['value']) { @($allUsers['value']) } else { @() }
    $breakGlassAccounts = Get-BreakGlassAccounts -Users $allUserList
    $bgCount = $breakGlassAccounts.Count
    $enabledBg = @($breakGlassAccounts | Where-Object { $_['accountEnabled'] -eq $true })

    if ($bgCount -ge 2 -and $enabledBg.Count -ge 2) {
        $bgNames = ($breakGlassAccounts | ForEach-Object { $_['displayName'] }) -join ', '
        $settingParams = @{
            Category         = 'Admin Accounts'
            Setting          = 'Emergency Access Accounts'
            CurrentValue     = "$bgCount found ($bgNames)"
            RecommendedValue = '2+ enabled break-glass accounts'
            Status           = 'Pass'
            CheckId          = 'ENTRA-ADMIN-003'
            Remediation      = 'Maintain at least two cloud-only emergency access accounts excluded from all Conditional Access policies.'
        }
        Add-Setting @settingParams
    }
    else {
        $settingParams = @{
            Category         = 'Admin Accounts'
            Setting          = 'Emergency Access Accounts'
            CurrentValue     = "$bgCount detected (heuristic: name contains break glass/emergency)"
            RecommendedValue = '2+ enabled break-glass accounts'
            Status           = 'Review'
            CheckId          = 'ENTRA-ADMIN-003'
            Remediation      = 'Create 2+ cloud-only emergency access accounts with Global Administrator role, excluded from all Conditional Access policies. Use naming convention including "BreakGlass" or "EmergencyAccess" for detection.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check emergency access accounts: $_"
}

# ------------------------------------------------------------------
# 33. Password Hash Sync (CIS 5.1.8.1)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking password hash sync for hybrid deployments..."
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/v1.0/organization'
        ErrorAction = 'Stop'
    }
    $orgInfo = Invoke-MgGraphRequest @graphParams

    $orgValue = if ($orgInfo -and $orgInfo['value']) { @($orgInfo['value']) } else { @() }
    if ($orgValue -and $orgValue.Count -gt 0) {
        $org = $orgValue[0]
        $onPremSync = $org['onPremisesSyncEnabled']

        if ($null -eq $onPremSync -or $onPremSync -eq $false) {
            # Cloud-only tenant, PHS not applicable
            $settingParams = @{
                Category         = 'Hybrid Identity'
                Setting          = 'Password Hash Sync'
                CurrentValue     = 'Cloud-only tenant (no directory sync)'
                RecommendedValue = 'Enabled (if hybrid)'
                Status           = 'Info'
                CheckId          = 'ENTRA-HYBRID-001'
                Remediation      = 'Not applicable for cloud-only tenants. If you configure hybrid identity in the future, enable Password Hash Sync in Azure AD Connect.'
            }
            Add-Setting @settingParams
        }
        else {
            # Hybrid tenant, check PHS via on-premises sync status
            $phsEnabled = $org['onPremisesLastPasswordSyncDateTime']
            if ($phsEnabled) {
                $settingParams = @{
                    Category         = 'Hybrid Identity'
                    Setting          = 'Password Hash Sync'
                    CurrentValue     = "Enabled (last sync: $phsEnabled)"
                    RecommendedValue = 'Enabled'
                    Status           = 'Pass'
                    CheckId          = 'ENTRA-HYBRID-001'
                    Remediation      = 'Password Hash Sync is enabled. Verify it remains active in Azure AD Connect configuration.'
                }
                Add-Setting @settingParams
            }
            else {
                $settingParams = @{
                    Category         = 'Hybrid Identity'
                    Setting          = 'Password Hash Sync'
                    CurrentValue     = 'Directory sync enabled but no password sync detected'
                    RecommendedValue = 'Enabled'
                    Status           = 'Fail'
                    CheckId          = 'ENTRA-HYBRID-001'
                    Remediation      = 'Enable Password Hash Sync in Azure AD Connect > Optional Features. This provides leaked credential detection and backup authentication.'
                }
                Add-Setting @settingParams
            }
        }
    }
    else {
        $settingParams = @{
            Category         = 'Hybrid Identity'
            Setting          = 'Password Hash Sync'
            CurrentValue     = 'Organization data not available'
            RecommendedValue = 'Enabled (if hybrid)'
            Status           = 'Review'
            CheckId          = 'ENTRA-HYBRID-001'
            Remediation      = 'Verify Password Hash Sync status in Azure AD Connect. Entra admin center > Identity > Hybrid management > Azure AD Connect.'
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check password hash sync: $_"
}

# ------------------------------------------------------------------
# Output results
# ------------------------------------------------------------------
$report = @($settings)
Write-Verbose "Collected $($report.Count) Entra ID security configuration settings"

if ($OutputPath) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported Entra security config ($($report.Count) settings) to $OutputPath"
}
else {
    Write-Output $report
}
