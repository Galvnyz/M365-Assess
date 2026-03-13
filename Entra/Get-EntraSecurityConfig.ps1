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
    Version: 0.7.0
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
# 2. Global Admin Count (should be 2-4)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking global admin count..."
    $globalAdminRole = Invoke-MgGraphRequest -Method GET `
        -Uri "/v1.0/directoryRoles?`$filter=displayName eq 'Global Administrator'" -ErrorAction Stop
    $roleId = $globalAdminRole['value'][0]['id']

    $members = Invoke-MgGraphRequest -Method GET `
        -Uri "/v1.0/directoryRoles/$roleId/members" -ErrorAction Stop
    $gaCount = @($members['value']).Count

    $gaStatus = if ($gaCount -ge 2 -and $gaCount -le 4) { 'Pass' }
    elseif ($gaCount -lt 2) { 'Fail' }
    else { 'Warning' }

    Add-Setting -Category 'Admin Accounts' -Setting 'Global Administrator Count' `
        -CurrentValue "$gaCount" -RecommendedValue '2-4' -Status $gaStatus `
        -CheckId 'ENTRA-ADMIN-001' `
        -Remediation 'Run: Get-MgDirectoryRole -Filter "displayName eq ''Global Administrator''" | Get-MgDirectoryRoleMember. Maintain 2-4 global admins using dedicated accounts.'
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

    # 11b. CA Policy Blocks Legacy Authentication (CIS 5.2.2.3)
    $legacyBlockPolicies = @($caPolicies['value'] | Where-Object {
        $_['state'] -eq 'enabled' -and
        $_['conditions']['clientAppTypes'] -contains 'exchangeActiveSync' -or
        $_['conditions']['clientAppTypes'] -contains 'other'
    } | Where-Object {
        $_['grantControls']['builtInControls'] -contains 'block'
    })
    $legacyBlockCount = $legacyBlockPolicies.Count

    Add-Setting -Category 'Conditional Access' -Setting 'CA Policy Blocks Legacy Authentication' `
        -CurrentValue $(if ($legacyBlockCount -gt 0) { "Yes ($legacyBlockCount policy)" } else { 'No' }) `
        -RecommendedValue 'Yes' `
        -Status $(if ($legacyBlockCount -gt 0) { 'Pass' } else { 'Fail' }) `
        -CheckId 'ENTRA-CA-001' `
        -Remediation 'Run: New-MgIdentityConditionalAccessPolicy targeting legacy client apps with Block grant control. Entra admin center > Protection > Conditional Access.'
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
