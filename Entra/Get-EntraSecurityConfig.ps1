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
    Version: 0.8.1
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
        Update-CheckProgress -CheckId $CheckId -Setting $Setting -Status $Status
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
    $isEnabled = $secDefaults['isEnabled']
    Add-Setting -Category 'Security Defaults' -Setting 'Security Defaults Enabled' `
        -CurrentValue "$isEnabled" -RecommendedValue 'True (if no Conditional Access)' `
        -Status $(if ($isEnabled) { 'Pass' } else { 'Fail' }) `
        -CheckId 'ENTRA-SECDEFAULT-001' `
        -Remediation 'Run: Update-MgPolicyIdentitySecurityDefaultsEnforcementPolicy -IsEnabled $true. Entra admin center > Properties > Manage security defaults.'
}
catch {
    Write-Warning "Could not retrieve security defaults: $_"
    Add-Setting -Category 'Security Defaults' -Setting 'Security Defaults Enabled' `
        -CurrentValue 'Unable to retrieve' -RecommendedValue 'True (if no CA)' -Status 'Review' `
        -CheckId 'ENTRA-SECDEFAULT-001' `
        -Remediation 'Run: Update-MgPolicyIdentitySecurityDefaultsEnforcementPolicy -IsEnabled $true. Entra admin center > Properties > Manage security defaults.'
}

# ------------------------------------------------------------------
# 2. Global Admin Count (should be 2-4, excluding break-glass)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking global admin count..."
    $globalAdminRole = Invoke-MgGraphRequest -Method GET `
        -Uri "/v1.0/directoryRoles?`$filter=displayName eq 'Global Administrator'" -ErrorAction Stop
    $roleId = $globalAdminRole['value'][0]['id']

    $members = Invoke-MgGraphRequest -Method GET `
        -Uri "/v1.0/directoryRoles/$roleId/members" -ErrorAction Stop
    $allAdmins = @($members['value'])

    # Exclude break-glass accounts from the operational admin count
    $breakGlassAdmins = Get-BreakGlassAccounts -Users $allAdmins
    $operationalAdmins = @($allAdmins | Where-Object { $_ -notin $breakGlassAdmins })
    $gaCount = $operationalAdmins.Count
    $bgExcluded = $breakGlassAdmins.Count

    $gaStatus = if ($gaCount -ge 2 -and $gaCount -le 4) { 'Pass' }
    elseif ($gaCount -lt 2) { 'Fail' }
    else { 'Warning' }

    $countDetail = if ($bgExcluded -gt 0) { "$gaCount (excluding $bgExcluded break-glass)" } else { "$gaCount" }

    Add-Setting -Category 'Admin Accounts' -Setting 'Global Administrator Count' `
        -CurrentValue $countDetail -RecommendedValue '2-4' -Status $gaStatus `
        -CheckId 'ENTRA-ADMIN-001' `
        -Remediation 'Run: Get-MgDirectoryRole -Filter "displayName eq ''Global Administrator''" | Get-MgDirectoryRoleMember. Maintain 2-4 global admins using dedicated accounts (break-glass accounts are excluded from this count).'
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
    $authPolicy = Invoke-MgGraphRequest -Method GET `
        -Uri '/v1.0/policies/authorizationPolicy' -ErrorAction Stop
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

        Add-Setting -Category 'Application Consent' -Setting 'User Consent for Applications' `
            -CurrentValue $consentValue -RecommendedValue 'Do not allow user consent' -Status $consentStatus `
            -CheckId 'ENTRA-CONSENT-001' `
            -Remediation 'Run: Update-MgPolicyAuthorizationPolicy -DefaultUserRolePermissions @{PermissionGrantPoliciesAssigned = @()}. Entra admin center > Enterprise applications > Consent and permissions.'
    }
    catch {
        Write-Warning "Could not check user consent policy: $_"
    }

    # 4. Users Can Register Applications
    try {
        $canRegister = $authPolicy['defaultUserRolePermissions']['allowedToCreateApps']

        Add-Setting -Category 'Application Consent' -Setting 'Users Can Register Applications' `
            -CurrentValue "$canRegister" -RecommendedValue 'False' `
            -Status $(if (-not $canRegister) { 'Pass' } else { 'Fail' }) `
            -CheckId 'ENTRA-APPREG-001' `
            -Remediation 'Run: Update-MgPolicyAuthorizationPolicy -DefaultUserRolePermissions @{AllowedToCreateApps = $false}. Entra admin center > Users > User settings.'
    }
    catch {
        Write-Warning "Could not check app registration policy: $_"
    }

    # 5. Users Can Create Security Groups
    try {
        $canCreateGroups = $authPolicy['defaultUserRolePermissions']['allowedToCreateSecurityGroups']
        Add-Setting -Category 'Directory Settings' -Setting 'Users Can Create Security Groups' `
            -CurrentValue "$canCreateGroups" -RecommendedValue 'False' `
            -Status $(if (-not $canCreateGroups) { 'Pass' } else { 'Warning' }) `
            -CheckId 'ENTRA-GROUP-001' `
            -Remediation 'Run: Update-MgPolicyAuthorizationPolicy -DefaultUserRolePermissions @{AllowedToCreateSecurityGroups = $false}. Entra admin center > Groups > General.'
    }
    catch {
        Write-Warning "Could not check group creation policy: $_"
    }

    # 5b. Restrict Non-Admin Tenant Creation (CIS 5.1.2.3)
    try {
        $canCreateTenants = $authPolicy['defaultUserRolePermissions']['allowedToCreateTenants']
        Add-Setting -Category 'Directory Settings' -Setting 'Non-Admin Tenant Creation Restricted' `
            -CurrentValue "$canCreateTenants" -RecommendedValue 'False' `
            -Status $(if (-not $canCreateTenants) { 'Pass' } else { 'Warning' }) `
            -CheckId 'ENTRA-TENANT-001' `
            -Remediation 'Run: Update-MgPolicyAuthorizationPolicy -DefaultUserRolePermissions @{AllowedToCreateTenants = $false}. Entra admin center > Users > User settings.'
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
    $adminConsentSettings = Invoke-MgGraphRequest -Method GET `
        -Uri '/v1.0/policies/adminConsentRequestPolicy' -ErrorAction Stop
    $isAdminConsentEnabled = $adminConsentSettings['isEnabled']

    Add-Setting -Category 'Application Consent' -Setting 'Admin Consent Workflow Enabled' `
        -CurrentValue "$isAdminConsentEnabled" -RecommendedValue 'True' `
        -Status $(if ($isAdminConsentEnabled) { 'Pass' } else { 'Warning' }) `
        -CheckId 'ENTRA-CONSENT-002' `
        -Remediation 'Run: Update-MgPolicyAdminConsentRequestPolicy -IsEnabled $true. Entra admin center > Enterprise applications > Admin consent requests.'
}
catch {
    Write-Warning "Could not check admin consent workflow: $_"
}

# ------------------------------------------------------------------
# 7. Self-Service Password Reset
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking SSPR configuration..."
    $sspr = Invoke-MgGraphRequest -Method GET `
        -Uri '/v1.0/policies/authenticationMethodsPolicy' -ErrorAction Stop
    $ssprRegistration = $sspr['registrationEnforcement']['authenticationMethodsRegistrationCampaign']['state']

    Add-Setting -Category 'Password Management' -Setting 'Auth Method Registration Campaign' `
        -CurrentValue "$ssprRegistration" -RecommendedValue 'enabled' `
        -Status $(if ($ssprRegistration -eq 'enabled') { 'Pass' } else { 'Warning' }) `
        -CheckId 'ENTRA-MFA-001' `
        -Remediation 'Run: Update-MgBetaPolicyAuthenticationMethodPolicy with RegistrationEnforcement settings. Entra admin center > Protection > Authentication methods > Registration campaign.'
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
            Add-Setting -Category 'Authentication Methods' -Setting 'SMS Authentication' `
                -CurrentValue "$smsState" -RecommendedValue 'disabled' `
                -Status $(if ($smsState -eq 'disabled') { 'Pass' } else { 'Fail' }) `
                -CheckId 'ENTRA-AUTHMETHOD-001' `
                -Remediation 'Entra admin center > Protection > Authentication methods > SMS > Disable. SMS is vulnerable to SIM-swapping attacks.'

            # CIS 5.2.3.5 — Voice call disabled
            $voiceMethod = $authMethods | Where-Object { $_['id'] -eq 'Voice' }
            $voiceState = if ($voiceMethod) { $voiceMethod['state'] } else { 'not found' }
            Add-Setting -Category 'Authentication Methods' -Setting 'Voice Call Authentication' `
                -CurrentValue "$voiceState" -RecommendedValue 'disabled' `
                -Status $(if ($voiceState -eq 'disabled') { 'Pass' } else { 'Fail' }) `
                -CheckId 'ENTRA-AUTHMETHOD-001' `
                -Remediation 'Entra admin center > Protection > Authentication methods > Voice call > Disable. Voice is vulnerable to telephony-based attacks.'

            # CIS 5.2.3.7 — Email OTP disabled
            $emailMethod = $authMethods | Where-Object { $_['id'] -eq 'Email' }
            $emailState = if ($emailMethod) { $emailMethod['state'] } else { 'not found' }
            Add-Setting -Category 'Authentication Methods' -Setting 'Email OTP Authentication' `
                -CurrentValue "$emailState" -RecommendedValue 'disabled' `
                -Status $(if ($emailState -eq 'disabled') { 'Pass' } else { 'Fail' }) `
                -CheckId 'ENTRA-AUTHMETHOD-002' `
                -Remediation 'Entra admin center > Protection > Authentication methods > Email OTP > Disable. Email OTP is a weaker authentication factor.'
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
        Add-Setting -Category 'Password Management' -Setting 'SSPR Registration Campaign Targets All Users' `
            -CurrentValue $(if ($campaignState -eq 'enabled' -and $targetsAll) { 'Enabled for all users' } elseif ($campaignState -eq 'enabled') { 'Enabled (limited scope)' } else { 'Disabled' }) `
            -RecommendedValue 'Enabled for all users' `
            -Status $(if ($campaignState -eq 'enabled' -and $targetsAll) { 'Pass' } elseif ($campaignState -eq 'enabled') { 'Warning' } else { 'Fail' }) `
            -CheckId 'ENTRA-SSPR-001' `
            -Remediation 'Entra admin center > Protection > Authentication methods > Registration campaign > Enable and target All Users.'
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
    $passwordProtection = Invoke-MgGraphRequest -Method GET `
        -Uri '/v1.0/settings' -ErrorAction Stop
    $pwSettings = $passwordProtection['value'] | Where-Object {
        $_['displayName'] -eq 'Password Rule Settings'
    }

    if ($pwSettings) {
        $bannedList = ($pwSettings['values'] | Where-Object { $_['name'] -eq 'BannedPasswordList' })['value']
        $enforceCustom = ($pwSettings['values'] | Where-Object { $_['name'] -eq 'EnableBannedPasswordCheck' })['value']
        $lockoutThreshold = ($pwSettings['values'] | Where-Object { $_['name'] -eq 'LockoutThreshold' })['value']

        Add-Setting -Category 'Password Management' -Setting 'Custom Banned Password List Enforced' `
            -CurrentValue "$enforceCustom" -RecommendedValue 'True' `
            -Status $(if ($enforceCustom -eq 'True') { 'Pass' } else { 'Warning' }) `
            -CheckId 'ENTRA-PASSWORD-002' `
            -Remediation 'Run: Update-MgBetaDirectorySetting for Password Rule Settings with CustomBannedPasswordsEnforced = true. Entra admin center > Protection > Password protection.'

        $bannedCount = if ($bannedList) { ($bannedList -split ',').Count } else { 0 }
        Add-Setting -Category 'Password Management' -Setting 'Custom Banned Password Count' `
            -CurrentValue "$bannedCount" -RecommendedValue '1+' `
            -Status $(if ($bannedCount -gt 0) { 'Pass' } else { 'Warning' }) `
            -CheckId 'ENTRA-PASSWORD-004' `
            -Remediation 'Run: Update-MgBetaDirectorySetting for Password Rule Settings to add organization-specific terms. Entra admin center > Protection > Password protection.'

        Add-Setting -Category 'Password Management' -Setting 'Smart Lockout Threshold' `
            -CurrentValue "$lockoutThreshold" -RecommendedValue '10' `
            -Status $(if ([int]$lockoutThreshold -le 10) { 'Pass' } else { 'Review' }) `
            -CheckId 'ENTRA-PASSWORD-003' `
            -Remediation 'Run: Update-MgBetaDirectorySetting for Password Rule Settings with LockoutThreshold. Entra admin center > Protection > Password protection.'
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
    foreach ($domain in $domains['value']) {
        if (-not $domain['isVerified']) { continue }
        $validityDays = $domain['passwordValidityPeriodInDays']
        $neverExpires = ($validityDays -eq 2147483647)

        Add-Setting -Category 'Password Management' -Setting "Password Expiration: $($domain['id'])" `
            -CurrentValue $(if ($neverExpires) { 'Never expires' } else { "$validityDays days" }) `
            -RecommendedValue 'Never expires (with MFA)' `
            -Status $(if ($neverExpires) { 'Pass' } else { 'Fail' }) `
            -CheckId 'ENTRA-PASSWORD-001' `
            -Remediation 'Run: Update-MgDomain -DomainId {domain} -PasswordValidityPeriodInDays 2147483647. M365 admin center > Settings > Password expiration policy.'
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

        Add-Setting -Category 'External Collaboration' -Setting 'Guest Invitation Policy' `
            -CurrentValue $inviteDisplay -RecommendedValue 'Admins and guest inviters only' `
            -Status $inviteStatus `
            -CheckId 'ENTRA-GUEST-002' `
            -Remediation 'Run: Update-MgPolicyAuthorizationPolicy -AllowInvitesFrom ''adminsAndGuestInviters''. Entra admin center > External Identities > External collaboration settings.'

        # Guest user role
        $roleDisplay = switch ($guestAccessRestriction) {
            'a0b1b346-4d3e-4e8b-98f8-753987be4970' { 'Same as member users' }
            '10dae51f-b6af-4016-8d66-8c2a99b929b3' { 'Limited access (default)' }
            '2af84b1e-32c8-42b7-82bc-daa82404023b' { 'Restricted access' }
            default { $guestAccessRestriction }
        }

        Add-Setting -Category 'External Collaboration' -Setting 'Guest User Access Restriction' `
            -CurrentValue $roleDisplay -RecommendedValue 'Restricted access' `
            -Status $(if ($guestAccessRestriction -eq '2af84b1e-32c8-42b7-82bc-daa82404023b') { 'Pass' } else { 'Warning' }) `
            -CheckId 'ENTRA-GUEST-001' `
            -Remediation 'Run: Update-MgPolicyAuthorizationPolicy -GuestUserRoleId ''2af84b1e-32c8-42b7-82bc-daa82404023b''. Entra admin center > External Identities > External collaboration settings.'
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
    $caPolicies = Invoke-MgGraphRequest -Method GET `
        -Uri '/v1.0/identity/conditionalAccess/policies' -ErrorAction Stop
    $caCount = @($caPolicies['value']).Count
    $enabledCount = @($caPolicies['value'] | Where-Object { $_['state'] -eq 'enabled' }).Count

    Add-Setting -Category 'Conditional Access' -Setting 'Total CA Policies' `
        -CurrentValue "$caCount" -RecommendedValue '1+' `
        -Status 'Info' `
        -CheckId 'ENTRA-CA-002' `
        -Remediation 'Informational — review Conditional Access policy coverage for your organization.'

    Add-Setting -Category 'Conditional Access' -Setting 'Enabled CA Policies' `
        -CurrentValue "$enabledCount" -RecommendedValue '1+' `
        -Status $(if ($enabledCount -gt 0) { 'Pass' } else { 'Warning' }) `
        -CheckId 'ENTRA-CA-003' `
        -Remediation 'Run: Get-MgIdentityConditionalAccessPolicy | Where-Object {$_.State -eq ''enabled''}. Ensure policies are set to On, not Report-only.'

}
catch {
    Write-Warning "Could not check CA policies: $_"
}

# ------------------------------------------------------------------
# 12. Guest User Summary
# ------------------------------------------------------------------
try {
    Write-Verbose "Counting guest users..."
    $guestCount = Invoke-MgGraphRequest -Method GET `
        -Uri "/v1.0/users/`$count?`$filter=userType eq 'Guest'" `
        -Headers @{ 'ConsistencyLevel' = 'eventual' } -ErrorAction Stop
    Add-Setting -Category 'External Collaboration' -Setting 'Guest User Count' `
        -CurrentValue "$guestCount" -RecommendedValue 'Review periodically' -Status 'Info' `
        -CheckId 'ENTRA-GUEST-003' `
        -Remediation 'Informational — review and remove stale guest accounts periodically. Entra admin center > Users > Guest users.'
}
catch {
    Write-Warning "Could not count guest users: $_"
}

# ------------------------------------------------------------------
# 13. Device Registration Policy (CIS 5.1.4.1, 5.1.4.2, 5.1.4.3)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking device registration policy..."
    $devicePolicy = Invoke-MgGraphRequest -Method GET `
        -Uri '/v1.0/policies/deviceRegistrationPolicy' -ErrorAction Stop

    if ($devicePolicy) {
        # CIS 5.1.4.1 — Device join restricted
        $joinType = $devicePolicy['azureADJoin']['allowedToJoin']['@odata.type']
        $joinRestricted = $joinType -ne '#microsoft.graph.allDeviceRegistrationMembership'
        Add-Setting -Category 'Device Management' -Setting 'Azure AD Join Restriction' `
            -CurrentValue $(if ($joinRestricted) { 'Restricted' } else { 'All users allowed' }) `
            -RecommendedValue 'Restricted to specific users/groups' `
            -Status $(if ($joinRestricted) { 'Pass' } else { 'Fail' }) `
            -CheckId 'ENTRA-DEVICE-001' `
            -Remediation 'Entra admin center > Devices > Device settings > Users may join devices to Microsoft Entra > Selected. Restrict to a specific group of authorized users.'

        # CIS 5.1.4.2 — Max devices per user
        $maxDevices = $devicePolicy['userDeviceQuota']
        Add-Setting -Category 'Device Management' -Setting 'Maximum Devices Per User' `
            -CurrentValue "$maxDevices" -RecommendedValue '15 or fewer' `
            -Status $(if ($maxDevices -le 15) { 'Pass' } else { 'Fail' }) `
            -CheckId 'ENTRA-DEVICE-002' `
            -Remediation 'Entra admin center > Devices > Device settings > Maximum number of devices per user. Set to 15 or lower.'

        # CIS 5.1.4.3 — Global admins not added as local admin on join
        $gaLocalAdmin = $true  # Default assumption
        if ($devicePolicy['azureADJoin']['localAdmins']) {
            $gaLocalAdmin = $devicePolicy['azureADJoin']['localAdmins']['enableGlobalAdmins']
        }
        Add-Setting -Category 'Device Management' -Setting 'Global Admins as Local Admin on Join' `
            -CurrentValue $(if ($gaLocalAdmin) { 'Enabled' } else { 'Disabled' }) `
            -RecommendedValue 'Disabled' `
            -Status $(if (-not $gaLocalAdmin) { 'Pass' } else { 'Fail' }) `
            -CheckId 'ENTRA-DEVICE-003' `
            -Remediation 'Entra admin center > Devices > Device settings > Global administrator is added as local administrator on the device during Azure AD Join > No.'
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
    $orgSettings = Invoke-MgGraphRequest -Method GET `
        -Uri "/beta/organization/$tenantId" -ErrorAction Stop

    $linkedInEnabled = $true  # Default assumption
    if ($orgSettings -and $orgSettings['linkedInConfiguration']) {
        $linkedInEnabled = -not $orgSettings['linkedInConfiguration']['isDisabled']
    }

    Add-Setting -Category 'Directory Settings' -Setting 'LinkedIn Account Connections' `
        -CurrentValue $(if ($linkedInEnabled) { 'Enabled' } else { 'Disabled' }) `
        -RecommendedValue 'Disabled' `
        -Status $(if (-not $linkedInEnabled) { 'Pass' } else { 'Fail' }) `
        -CheckId 'ENTRA-LINKEDIN-001' `
        -Remediation 'Entra admin center > Users > User settings > LinkedIn account connections > No. Prevents data leakage between LinkedIn and organizational directory.'
}
catch {
    Write-Warning "Could not check LinkedIn account connections: $_"
}

# ------------------------------------------------------------------
# 15. Per-user MFA Disabled (CIS 5.1.2.1)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking per-user MFA state..."
    Invoke-MgGraphRequest -Method GET `
        -Uri '/beta/reports/authenticationMethods/userRegistrationDetails?$select=userPrincipalName,isMfaRegistered,isMfaCapable&$top=1' -ErrorAction Stop | Out-Null
    # Graph doesn't directly expose legacy per-user MFA state (MSOnline concept).
    # We confirm API access works, then emit Review since we can't verify enforcement mode.
    Add-Setting -Category 'Authentication Methods' -Setting 'Per-user MFA (Legacy)' `
        -CurrentValue 'Review -- verify no per-user MFA states are set to Enforced or Enabled' `
        -RecommendedValue 'All per-user MFA disabled (use CA policies)' `
        -Status 'Review' `
        -CheckId 'ENTRA-PERUSER-001' `
        -Remediation 'Entra admin center > Users > Per-user MFA > Ensure all users show Disabled. Use Conditional Access policies for MFA enforcement instead of per-user MFA.'
}
catch {
    Write-Warning "Could not check per-user MFA: $_"
    Add-Setting -Category 'Authentication Methods' -Setting 'Per-user MFA (Legacy)' `
        -CurrentValue 'Could not query -- verify manually' `
        -RecommendedValue 'All per-user MFA disabled (use CA policies)' `
        -Status 'Review' `
        -CheckId 'ENTRA-PERUSER-001' `
        -Remediation 'Entra admin center > Users > Per-user MFA > Ensure all users show Disabled. Use Conditional Access policies for MFA enforcement instead.'
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
        Add-Setting -Category 'Application Consent' -Setting 'Third-party Integrated Apps Restricted' `
            -CurrentValue $(if (-not $allowedToCreateApps) { 'Restricted' } else { 'Allowed' }) `
            -RecommendedValue 'Restricted' `
            -Status $(if (-not $allowedToCreateApps) { 'Pass' } else { 'Fail' }) `
            -CheckId 'ENTRA-APPS-001' `
            -Remediation 'Entra admin center > Users > User settings > Users can register applications > No. Also review Enterprise applications > User settings > Users can consent to apps.'
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
    $crossTenantPolicy = Invoke-MgGraphRequest -Method GET `
        -Uri '/v1.0/policies/crossTenantAccessPolicy/default' -ErrorAction Stop

    $b2bCollabInbound = $crossTenantPolicy['b2bCollaborationInbound']
    $isRestricted = $false
    if ($b2bCollabInbound -and $b2bCollabInbound['applications']) {
        $accessType = $b2bCollabInbound['applications']['accessType']
        $isRestricted = ($accessType -eq 'blocked' -or $accessType -eq 'allowed')
    }

    # Also check authorizationPolicy allowInvitesFrom
    $invitesFrom = if ($authPolicy) { $authPolicy['allowInvitesFrom'] } else { 'unknown' }
    $domainRestricted = ($invitesFrom -ne 'everyone') -and $isRestricted

    Add-Setting -Category 'External Collaboration' -Setting 'Guest Invitation Domain Restrictions' `
        -CurrentValue $(if ($domainRestricted) { "Restricted (invites: $invitesFrom)" } else { "Open (invites: $invitesFrom)" }) `
        -RecommendedValue 'Restricted to allowed domains only' `
        -Status $(if ($invitesFrom -eq 'none' -or $domainRestricted) { 'Pass' } elseif ($invitesFrom -ne 'everyone') { 'Review' } else { 'Fail' }) `
        -CheckId 'ENTRA-GUEST-004' `
        -Remediation 'Entra admin center > External Identities > External collaboration settings > Collaboration restrictions > Allow invitations only to the specified domains.'
}
catch {
    Write-Warning "Could not check guest invitation restrictions: $_"
}

# ------------------------------------------------------------------
# 18. Dynamic Group for Guest Users (CIS 5.1.3.1)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking for dynamic guest group..."
    $dynamicGroups = Invoke-MgGraphRequest -Method GET `
        -Uri "/v1.0/groups?`$filter=groupTypes/any(g:g eq 'DynamicMembership')&`$select=displayName,membershipRule&`$top=999" -ErrorAction Stop
    $guestGroups = @($dynamicGroups['value'] | Where-Object {
        $_['membershipRule'] -and $_['membershipRule'] -match 'user\.userType\s+(-eq|-contains)\s+.?Guest'
    })

    if ($guestGroups.Count -gt 0) {
        $names = ($guestGroups | ForEach-Object { $_['displayName'] }) -join '; '
        Add-Setting -Category 'External Collaboration' -Setting 'Dynamic Group for Guest Users' `
            -CurrentValue "Yes ($($guestGroups.Count) group: $names)" `
            -RecommendedValue 'At least 1 dynamic group for guests' `
            -Status 'Pass' `
            -CheckId 'ENTRA-GROUP-002' `
            -Remediation 'No action needed.'
    }
    else {
        Add-Setting -Category 'External Collaboration' -Setting 'Dynamic Group for Guest Users' `
            -CurrentValue 'No dynamic guest group found' `
            -RecommendedValue 'At least 1 dynamic group for guests' `
            -Status 'Fail' `
            -CheckId 'ENTRA-GROUP-002' `
            -Remediation 'Entra admin center > Groups > New group > Membership type = Dynamic User > Rule: (user.userType -eq "Guest"). This enables targeted policies for guest users.'
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
    $devicePolicyBeta = Invoke-MgGraphRequest -Method GET `
        -Uri '/beta/policies/deviceRegistrationPolicy' -ErrorAction Stop

    if ($devicePolicyBeta) {
        # CIS 5.1.4.4 -- Local admin assignment limited during Entra join
        $localAdminSettings = $devicePolicyBeta['azureADJoin']['localAdmins']
        $additionalAdmins = if ($localAdminSettings -and $localAdminSettings['registeredUsers']) {
            $localAdminSettings['registeredUsers']['additionalLocalAdminsCount']
        } else { 0 }
        Add-Setting -Category 'Device Management' -Setting 'Local Admin Assignment on Entra Join' `
            -CurrentValue "Additional local admins configured: $additionalAdmins" `
            -RecommendedValue 'Minimal local admin assignment' `
            -Status $(if ($additionalAdmins -le 0) { 'Pass' } else { 'Review' }) `
            -CheckId 'ENTRA-DEVICE-004' `
            -Remediation 'Entra admin center > Devices > Device settings > Manage Additional local administrators on all Azure AD joined devices. Minimize additional local admins.'

        # CIS 5.1.4.5 -- LAPS enabled
        $lapsEnabled = $false
        if ($devicePolicyBeta['localAdminPassword']) {
            $lapsEnabled = $devicePolicyBeta['localAdminPassword']['isEnabled']
        }
        Add-Setting -Category 'Device Management' -Setting 'Local Administrator Password Solution (LAPS)' `
            -CurrentValue $(if ($lapsEnabled) { 'Enabled' } else { 'Disabled' }) `
            -RecommendedValue 'Enabled' `
            -Status $(if ($lapsEnabled) { 'Pass' } else { 'Fail' }) `
            -CheckId 'ENTRA-DEVICE-005' `
            -Remediation 'Entra admin center > Devices > Device settings > Enable Microsoft Entra Local Administrator Password Solution (LAPS) > Yes.'

        # CIS 5.1.4.6 -- BitLocker recovery key restricted
        # Beta API may expose this via deviceRegistrationPolicy or directorySettings
        Add-Setting -Category 'Device Management' -Setting 'BitLocker Recovery Key Restriction' `
            -CurrentValue 'Review -- verify users cannot read own BitLocker keys' `
            -RecommendedValue 'Users restricted from recovering BitLocker keys' `
            -Status 'Review' `
            -CheckId 'ENTRA-DEVICE-006' `
            -Remediation 'Entra admin center > Devices > Device settings > Restrict users from recovering the BitLocker key(s) for their owned devices > Yes.'
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
            Add-Setting -Category 'Authentication Methods' -Setting 'Authenticator Fatigue Protection' `
                -CurrentValue "Number matching: $numberMatch; App context: $appInfo" `
                -RecommendedValue 'Both enabled' `
                -Status $(if ($fatiguePassed) { 'Pass' } else { 'Fail' }) `
                -CheckId 'ENTRA-AUTHMETHOD-003' `
                -Remediation 'Entra admin center > Protection > Authentication methods > Microsoft Authenticator > Configure > Require number matching = Enabled, Show application name = Enabled.'
        }
        else {
            Add-Setting -Category 'Authentication Methods' -Setting 'Authenticator Fatigue Protection' `
                -CurrentValue 'Microsoft Authenticator not configured' `
                -RecommendedValue 'Both enabled' `
                -Status 'Review' `
                -CheckId 'ENTRA-AUTHMETHOD-003' `
                -Remediation 'Enable Microsoft Authenticator and configure number matching + application context display.'
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

        Add-Setting -Category 'Authentication Methods' -Setting 'System-Preferred MFA' `
            -CurrentValue "$sysState" `
            -RecommendedValue 'enabled' `
            -Status $(if ($sysState -eq 'enabled') { 'Pass' } else { 'Fail' }) `
            -CheckId 'ENTRA-AUTHMETHOD-004' `
            -Remediation 'Entra admin center > Protection > Authentication methods > Settings > System-preferred multifactor authentication > Enabled.'
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
try {
    Write-Verbose "Checking PIM role assignments..."
    $pimRoleAssignments = Invoke-MgGraphRequest -Method GET `
        -Uri '/beta/roleManagement/directory/roleAssignmentScheduleInstances' -ErrorAction Stop
}
catch {
    if ($_.Exception.Message -match '403|Forbidden|Authorization|license') {
        $pimAvailable = $false
    }
    else {
        Write-Warning "Could not check PIM role assignments: $_"
        $pimAvailable = $false
    }
}

if ($pimAvailable -and $pimRoleAssignments) {
    # CIS 5.3.1 -- PIM manages privileged roles (no permanent GA assignments)
    $gaRoleTemplateId = '62e90394-69f5-4237-9190-012177145e10'
    $permanentGA = @($pimRoleAssignments['value'] | Where-Object {
        $_['roleDefinitionId'] -eq $gaRoleTemplateId -and
        $_['assignmentType'] -eq 'Activated' -and
        (-not $_['endDateTime'] -or $_['endDateTime'] -eq '9999-12-31T23:59:59Z')
    })

    Add-Setting -Category 'Privileged Identity Management' -Setting 'PIM Manages Privileged Roles' `
        -CurrentValue $(if ($permanentGA.Count -eq 0) { 'No permanent GA assignments' } else { "$($permanentGA.Count) permanent GA assignment(s) found" }) `
        -RecommendedValue 'No permanent Global Admin assignments' `
        -Status $(if ($permanentGA.Count -eq 0) { 'Pass' } else { 'Fail' }) `
        -CheckId 'ENTRA-PIM-001' `
        -Remediation 'Entra admin center > Identity Governance > Privileged Identity Management > Azure AD roles > Global Administrator > Remove permanent active assignments. Use eligible assignments with time-bound activation.'
}
elseif (-not $pimAvailable) {
    Add-Setting -Category 'Privileged Identity Management' -Setting 'PIM Manages Privileged Roles' `
        -CurrentValue 'Requires Entra ID P2 license -- PIM API returned 403' `
        -RecommendedValue 'PIM enabled for all privileged roles' `
        -Status 'Review' `
        -CheckId 'ENTRA-PIM-001' `
        -Remediation 'This check requires Entra ID P2 (included in M365 E5). Enable PIM at Entra admin center > Identity Governance > Privileged Identity Management.'
}

# CIS 5.3.2/5.3.3 -- Access reviews for guests and privileged roles
$accessReviews = $null
if ($pimAvailable) {
    try {
        Write-Verbose "Checking access reviews..."
        $accessReviews = Invoke-MgGraphRequest -Method GET `
            -Uri '/beta/identityGovernance/accessReviews/definitions?$top=100' -ErrorAction Stop
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

if ($accessReviews) {
    $allReviews = @($accessReviews['value'])

    # CIS 5.3.2 -- Guest access reviews
    $guestReviews = @($allReviews | Where-Object {
        $_['scope'] -and ($_['scope']['query'] -match 'guest' -or $_['scope']['@odata.type'] -match 'guest')
    })
    Add-Setting -Category 'Privileged Identity Management' -Setting 'Access Reviews for Guest Users' `
        -CurrentValue $(if ($guestReviews.Count -gt 0) { "$($guestReviews.Count) guest access review(s) configured" } else { 'No guest access reviews found' }) `
        -RecommendedValue 'At least 1 access review for guests' `
        -Status $(if ($guestReviews.Count -gt 0) { 'Pass' } else { 'Fail' }) `
        -CheckId 'ENTRA-PIM-002' `
        -Remediation 'Entra admin center > Identity Governance > Access reviews > New access review > Review type: Guest users only. Schedule recurring reviews.'

    # CIS 5.3.3 -- Privileged role access reviews
    $roleReviews = @($allReviews | Where-Object {
        $_['scope'] -and ($_['scope']['query'] -match 'roleManagement|directoryRole')
    })
    Add-Setting -Category 'Privileged Identity Management' -Setting 'Access Reviews for Privileged Roles' `
        -CurrentValue $(if ($roleReviews.Count -gt 0) { "$($roleReviews.Count) privileged role review(s) configured" } else { 'No privileged role access reviews found' }) `
        -RecommendedValue 'At least 1 access review for admin roles' `
        -Status $(if ($roleReviews.Count -gt 0) { 'Pass' } else { 'Fail' }) `
        -CheckId 'ENTRA-PIM-003' `
        -Remediation 'Entra admin center > Identity Governance > Access reviews > New access review > Review type: Members of a group or Users assigned to a privileged role.'
}
elseif (-not $pimAvailable) {
    Add-Setting -Category 'Privileged Identity Management' -Setting 'Access Reviews for Guest Users' `
        -CurrentValue 'Requires Entra ID P2 license -- Access Reviews API returned 403' `
        -RecommendedValue 'At least 1 access review for guests' `
        -Status 'Review' `
        -CheckId 'ENTRA-PIM-002' `
        -Remediation 'This check requires Entra ID P2 (included in M365 E5). Entra admin center > Identity Governance > Access reviews.'

    Add-Setting -Category 'Privileged Identity Management' -Setting 'Access Reviews for Privileged Roles' `
        -CurrentValue 'Requires Entra ID P2 license -- Access Reviews API returned 403' `
        -RecommendedValue 'At least 1 access review for admin roles' `
        -Status 'Review' `
        -CheckId 'ENTRA-PIM-003' `
        -Remediation 'This check requires Entra ID P2 (included in M365 E5). Entra admin center > Identity Governance > Access reviews.'
}

# CIS 5.3.4/5.3.5 -- PIM activation approval for GA and PRA
$roleManagementPolicies = $null
if ($pimAvailable) {
    try {
        Write-Verbose "Checking PIM role management policies..."
        $roleManagementPolicies = Invoke-MgGraphRequest -Method GET `
            -Uri '/beta/policies/roleManagementPolicies?$expand=rules' -ErrorAction Stop
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

if ($roleManagementPolicies) {
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

    Add-Setting -Category 'Privileged Identity Management' -Setting 'GA Activation Requires Approval' `
        -CurrentValue $(if ($gaApprovalRequired) { 'Yes' } else { 'No' }) `
        -RecommendedValue 'Yes' `
        -Status $(if ($gaApprovalRequired) { 'Pass' } else { 'Fail' }) `
        -CheckId 'ENTRA-PIM-004' `
        -Remediation 'Entra admin center > Identity Governance > PIM > Azure AD roles > Settings > Global Administrator > Require approval to activate > Yes.'

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

    Add-Setting -Category 'Privileged Identity Management' -Setting 'PRA Activation Requires Approval' `
        -CurrentValue $(if ($praApprovalRequired) { 'Yes' } else { 'No' }) `
        -RecommendedValue 'Yes' `
        -Status $(if ($praApprovalRequired) { 'Pass' } else { 'Fail' }) `
        -CheckId 'ENTRA-PIM-005' `
        -Remediation 'Entra admin center > Identity Governance > PIM > Azure AD roles > Settings > Privileged Role Administrator > Require approval to activate > Yes.'
}
elseif (-not $pimAvailable) {
    Add-Setting -Category 'Privileged Identity Management' -Setting 'GA Activation Requires Approval' `
        -CurrentValue 'Requires Entra ID P2 license -- PIM Policies API returned 403' `
        -RecommendedValue 'Yes' `
        -Status 'Review' `
        -CheckId 'ENTRA-PIM-004' `
        -Remediation 'This check requires Entra ID P2 (included in M365 E5). Entra admin center > Identity Governance > PIM > Azure AD roles > Settings.'

    Add-Setting -Category 'Privileged Identity Management' -Setting 'PRA Activation Requires Approval' `
        -CurrentValue 'Requires Entra ID P2 license -- PIM Policies API returned 403' `
        -RecommendedValue 'Yes' `
        -Status 'Review' `
        -CheckId 'ENTRA-PIM-005' `
        -Remediation 'This check requires Entra ID P2 (included in M365 E5). Entra admin center > Identity Governance > PIM > Azure AD roles > Settings.'
}

# ------------------------------------------------------------------
# 23. Cloud-Only Admin Accounts (CIS 1.1.1)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking Global Administrator accounts for cloud-only status..."
    $gaRoleTemplateId = '62e90394-69f5-4237-9190-012177145e10'
    $gaMembers = Invoke-MgGraphRequest -Method GET `
        -Uri "/v1.0/directoryRoles/roleTemplateId=$gaRoleTemplateId/members?`$select=displayName,userPrincipalName,onPremisesSyncEnabled" `
        -ErrorAction Stop

    $syncedAdmins = @($gaMembers['value'] | Where-Object { $_['onPremisesSyncEnabled'] -eq $true })

    if ($syncedAdmins.Count -eq 0) {
        Add-Setting -Category 'Admin Accounts' -Setting 'Cloud-Only Global Admins' `
            -CurrentValue "All $($gaMembers['value'].Count) GA accounts are cloud-only" `
            -RecommendedValue 'All admin accounts cloud-only' `
            -Status 'Pass' `
            -CheckId 'ENTRA-CLOUDADMIN-001' `
            -Remediation 'No action needed.'
    }
    else {
        $syncedNames = ($syncedAdmins | ForEach-Object { $_['displayName'] }) -join ', '
        Add-Setting -Category 'Admin Accounts' -Setting 'Cloud-Only Global Admins' `
            -CurrentValue "$($syncedAdmins.Count) synced: $syncedNames" `
            -RecommendedValue 'All admin accounts cloud-only' `
            -Status 'Fail' `
            -CheckId 'ENTRA-CLOUDADMIN-001' `
            -Remediation 'Create cloud-only admin accounts instead of using on-premises synced accounts. Entra admin center > Users > New user > Create user (cloud identity).'
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
    $gaUsersLicense = Invoke-MgGraphRequest -Method GET `
        -Uri "/v1.0/directoryRoles/roleTemplateId=$gaRoleTemplateId/members?`$select=displayName,assignedLicenses" `
        -ErrorAction Stop

    # E3/E5 SKU part IDs (productivity suites that admins shouldn't have)
    $productivitySkus = @(
        '05e9a617-0261-4cee-bb36-b42c3d50e6a0',  # SPE_E3 (M365 E3)
        '06ebc4ee-1bb5-47dd-8120-11324bc54e06',  # SPE_E5 (M365 E5)
        '6fd2c87f-b296-42f0-b197-1e91e994b900',  # ENTERPRISEPACK (O365 E3)
        'c7df2760-2c81-4ef7-b578-5b5392b571df'   # ENTERPRISEPREMIUM (O365 E5)
    )

    $heavyLicensed = @($gaUsersLicense['value'] | Where-Object {
        $licenses = $_['assignedLicenses']
        $licenses | Where-Object { $productivitySkus -contains $_['skuId'] }
    })

    if ($heavyLicensed.Count -eq 0) {
        Add-Setting -Category 'Admin Accounts' -Setting 'Admin License Footprint' `
            -CurrentValue 'No GA accounts have full productivity licenses' `
            -RecommendedValue 'Admins use minimal license (Entra P2 only)' `
            -Status 'Pass' `
            -CheckId 'ENTRA-CLOUDADMIN-002' `
            -Remediation 'No action needed.'
    }
    else {
        $names = ($heavyLicensed | ForEach-Object { $_['displayName'] }) -join ', '
        Add-Setting -Category 'Admin Accounts' -Setting 'Admin License Footprint' `
            -CurrentValue "$($heavyLicensed.Count) GA with productivity license: $names" `
            -RecommendedValue 'Admins use minimal license (Entra P2 only)' `
            -Status 'Warning' `
            -CheckId 'ENTRA-CLOUDADMIN-002' `
            -Remediation 'Assign admin accounts minimal licenses (Entra ID P2). Do not assign E3/E5 productivity suites. M365 admin center > Users > Active users > Licenses.'
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
    $publicGroups = Invoke-MgGraphRequest -Method GET `
        -Uri "/v1.0/groups?`$filter=visibility eq 'Public' and groupTypes/any(g:g eq 'Unified')&`$select=displayName,id&`$top=100" `
        -ErrorAction Stop

    $noOwnerGroups = @()
    foreach ($group in $publicGroups['value']) {
        $owners = Invoke-MgGraphRequest -Method GET `
            -Uri "/v1.0/groups/$($group['id'])/owners?`$select=id" -ErrorAction SilentlyContinue
        if (-not $owners['value'] -or $owners['value'].Count -eq 0) {
            $noOwnerGroups += $group['displayName']
        }
    }

    if ($noOwnerGroups.Count -eq 0) {
        Add-Setting -Category 'Group Management' -Setting 'Public Groups Have Owners' `
            -CurrentValue "$($publicGroups['value'].Count) public groups, all have owners" `
            -RecommendedValue 'All public groups have assigned owners' `
            -Status 'Pass' `
            -CheckId 'ENTRA-GROUP-003' `
            -Remediation 'No action needed.'
    }
    else {
        $groupList = ($noOwnerGroups | Select-Object -First 5) -join ', '
        $suffix = if ($noOwnerGroups.Count -gt 5) { " (+$($noOwnerGroups.Count - 5) more)" } else { '' }
        Add-Setting -Category 'Group Management' -Setting 'Public Groups Have Owners' `
            -CurrentValue "$($noOwnerGroups.Count) groups without owners: $groupList$suffix" `
            -RecommendedValue 'All public groups have assigned owners' `
            -Status 'Fail' `
            -CheckId 'ENTRA-GROUP-003' `
            -Remediation 'Assign owners to ownerless public M365 groups. Entra admin center > Groups > All groups > select group > Owners > Add owners.'
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
    $consentPolicy = Invoke-MgGraphRequest -Method GET `
        -Uri '/v1.0/policies/authorizationPolicy' -ErrorAction Stop

    $consentSetting = $consentPolicy['defaultUserRolePermissions']['permissionGrantPoliciesAssigned']
    $isRestricted = ($null -eq $consentSetting) -or ($consentSetting.Count -eq 0) -or
                    ($consentSetting -notcontains 'ManagePermissionGrantsForSelf.microsoft-user-default-legacy')

    Add-Setting -Category 'Organization Settings' -Setting 'User Consent for Applications' `
        -CurrentValue $(if ($isRestricted) { 'Restricted' } else { "Allowed: $($consentSetting -join ', ')" }) `
        -RecommendedValue 'Do not allow user consent' `
        -Status $(if ($isRestricted) { 'Pass' } else { 'Fail' }) `
        -CheckId 'ENTRA-ORGSETTING-001' `
        -Remediation 'Entra admin center > Enterprise applications > Consent and permissions > User consent settings > Do not allow user consent.'
}
catch {
    Write-Warning "Could not check user app consent: $_"
}

# ------------------------------------------------------------------
# 27. Password Protection On-Premises (CIS 5.2.3.3)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking password protection on-premises setting..."
    # Reuse $pwSettings from section 8 if available
    if ($pwSettings) {
        $onPremEnabled = ($pwSettings['values'] | Where-Object { $_['name'] -eq 'EnableBannedPasswordCheckOnPremises' })['value']
        Add-Setting -Category 'Password Management' -Setting 'Password Protection On-Premises' `
            -CurrentValue "$onPremEnabled" -RecommendedValue 'True' `
            -Status $(if ($onPremEnabled -eq 'True') { 'Pass' } else { 'Fail' }) `
            -CheckId 'ENTRA-PASSWORD-005' `
            -Remediation 'Entra admin center > Protection > Authentication methods > Password protection > Enable password protection on Windows Server Active Directory > Yes.'
    }
    else {
        Add-Setting -Category 'Password Management' -Setting 'Password Protection On-Premises' `
            -CurrentValue 'Password Rule Settings not available' `
            -RecommendedValue 'True' `
            -Status 'Review' `
            -CheckId 'ENTRA-PASSWORD-005' `
            -Remediation 'Entra admin center > Protection > Authentication methods > Password protection. Verify on-premises password protection is enabled.'
    }
}
catch {
    Write-Warning "Could not check password protection on-premises: $_"
}

# ------------------------------------------------------------------
# 28-30. Organization Settings (Review-only CIS 1.3.5, 1.3.7, 1.3.9)
# ------------------------------------------------------------------
Add-Setting -Category 'Organization Settings' -Setting 'Forms Internal Phishing Protection' `
    -CurrentValue 'Cannot be checked via API' `
    -RecommendedValue 'Enabled' `
    -Status 'Review' `
    -CheckId 'ENTRA-ORGSETTING-002' `
    -Remediation 'M365 admin center > Settings > Org settings > Microsoft Forms > ensure internal phishing protection is enabled.'

Add-Setting -Category 'Organization Settings' -Setting 'Third-Party Storage in M365 Web Apps' `
    -CurrentValue 'Cannot be checked via API' `
    -RecommendedValue 'Restricted (all third-party storage disabled)' `
    -Status 'Review' `
    -CheckId 'ENTRA-ORGSETTING-003' `
    -Remediation 'M365 admin center > Settings > Org settings > Microsoft 365 on the web > uncheck all third-party storage services.'

Add-Setting -Category 'Organization Settings' -Setting 'Shared Bookings Pages Restricted' `
    -CurrentValue 'Cannot be checked via API' `
    -RecommendedValue 'Restricted to selected users' `
    -Status 'Review' `
    -CheckId 'ENTRA-ORGSETTING-004' `
    -Remediation 'M365 admin center > Settings > Org settings > Bookings > restrict shared booking pages to selected staff members.'

# ------------------------------------------------------------------
# 31. Entra Admin Center Access Restriction (CIS 5.1.2.4)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking Entra admin center access restriction..."
    if ($authPolicy -and $null -ne $authPolicy['restrictNonAdminUsers']) {
        $restricted = $authPolicy['restrictNonAdminUsers']
        Add-Setting -Category 'Access Control' -Setting 'Entra Admin Center Restricted' `
            -CurrentValue "$restricted" -RecommendedValue 'True' `
            -Status $(if ($restricted) { 'Pass' } else { 'Fail' }) `
            -CheckId 'ENTRA-ADMIN-002' `
            -Remediation 'Entra admin center > Identity > Users > User settings > Administration center > set "Restrict access to Microsoft Entra admin center" to Yes.'
    }
    else {
        Add-Setting -Category 'Access Control' -Setting 'Entra Admin Center Restricted' `
            -CurrentValue 'Property not available' -RecommendedValue 'True' `
            -Status 'Review' `
            -CheckId 'ENTRA-ADMIN-002' `
            -Remediation 'Entra admin center > Identity > Users > User settings > Administration center > verify "Restrict access to Microsoft Entra admin center" is set to Yes.'
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
    $allUsers = Invoke-MgGraphRequest -Method GET `
        -Uri "/v1.0/users?`$select=displayName,userPrincipalName,accountEnabled&`$top=999" `
        -ErrorAction Stop

    $breakGlassAccounts = Get-BreakGlassAccounts -Users $allUsers['value']
    $bgCount = $breakGlassAccounts.Count
    $enabledBg = @($breakGlassAccounts | Where-Object { $_['accountEnabled'] -eq $true })

    if ($bgCount -ge 2 -and $enabledBg.Count -ge 2) {
        $bgNames = ($breakGlassAccounts | ForEach-Object { $_['displayName'] }) -join ', '
        Add-Setting -Category 'Admin Accounts' -Setting 'Emergency Access Accounts' `
            -CurrentValue "$bgCount found ($bgNames)" -RecommendedValue '2+ enabled break-glass accounts' `
            -Status 'Pass' `
            -CheckId 'ENTRA-ADMIN-003' `
            -Remediation 'Maintain at least two cloud-only emergency access accounts excluded from all Conditional Access policies.'
    }
    else {
        Add-Setting -Category 'Admin Accounts' -Setting 'Emergency Access Accounts' `
            -CurrentValue "$bgCount detected (heuristic: name contains break glass/emergency)" `
            -RecommendedValue '2+ enabled break-glass accounts' `
            -Status 'Review' `
            -CheckId 'ENTRA-ADMIN-003' `
            -Remediation 'Create 2+ cloud-only emergency access accounts with Global Administrator role, excluded from all Conditional Access policies. Use naming convention including "BreakGlass" or "EmergencyAccess" for detection.'
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
    $orgInfo = Invoke-MgGraphRequest -Method GET `
        -Uri '/v1.0/organization' -ErrorAction Stop

    $orgValue = $orgInfo['value']
    if ($orgValue -and $orgValue.Count -gt 0) {
        $org = $orgValue[0]
        $onPremSync = $org['onPremisesSyncEnabled']

        if ($null -eq $onPremSync -or $onPremSync -eq $false) {
            # Cloud-only tenant, PHS not applicable
            Add-Setting -Category 'Hybrid Identity' -Setting 'Password Hash Sync' `
                -CurrentValue 'Cloud-only tenant (no directory sync)' `
                -RecommendedValue 'Enabled (if hybrid)' `
                -Status 'Info' `
                -CheckId 'ENTRA-HYBRID-001' `
                -Remediation 'Not applicable for cloud-only tenants. If you configure hybrid identity in the future, enable Password Hash Sync in Azure AD Connect.'
        }
        else {
            # Hybrid tenant, check PHS via on-premises sync status
            $phsEnabled = $org['onPremisesLastPasswordSyncDateTime']
            if ($phsEnabled) {
                Add-Setting -Category 'Hybrid Identity' -Setting 'Password Hash Sync' `
                    -CurrentValue "Enabled (last sync: $phsEnabled)" `
                    -RecommendedValue 'Enabled' `
                    -Status 'Pass' `
                    -CheckId 'ENTRA-HYBRID-001' `
                    -Remediation 'Password Hash Sync is enabled. Verify it remains active in Azure AD Connect configuration.'
            }
            else {
                Add-Setting -Category 'Hybrid Identity' -Setting 'Password Hash Sync' `
                    -CurrentValue 'Directory sync enabled but no password sync detected' `
                    -RecommendedValue 'Enabled' `
                    -Status 'Fail' `
                    -CheckId 'ENTRA-HYBRID-001' `
                    -Remediation 'Enable Password Hash Sync in Azure AD Connect > Optional Features. This provides leaked credential detection and backup authentication.'
            }
        }
    }
    else {
        Add-Setting -Category 'Hybrid Identity' -Setting 'Password Hash Sync' `
            -CurrentValue 'Organization data not available' -RecommendedValue 'Enabled (if hybrid)' `
            -Status 'Review' `
            -CheckId 'ENTRA-HYBRID-001' `
            -Remediation 'Verify Password Hash Sync status in Azure AD Connect. Entra admin center > Identity > Hybrid management > Azure AD Connect.'
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
