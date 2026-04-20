# -------------------------------------------------------------------
# Entra ID -- User, Group, App & Organization Checks
# Extracted from Get-EntraSecurityConfig.ps1 (#256)
# Runs in shared scope: $settings, $checkIdCounter, Add-Setting,
#   $context, $authPolicy, $orgSettings
# -------------------------------------------------------------------
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseDeclaredVarsMoreThanAssignments', '')]
param()

# ------------------------------------------------------------------
# 3-5. Authorization Policy (user consent, app registration, groups)
# ------------------------------------------------------------------
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
        $settingParams = @{
            CheckId          = 'ENTRA-CONSENT-001'
            Category         = 'Application Consent'
            Setting          = 'User Consent for Applications'
            CurrentValue     = "Error: $($_.Exception.Message)"
            RecommendedValue = 'Do not allow user consent'
            Status           = 'Skipped'
            Remediation      = 'Check Graph API permissions and retry.'
        }
        Add-Setting @settingParams
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
        $settingParams = @{
            CheckId          = 'ENTRA-APPREG-001'
            Category         = 'Application Consent'
            Setting          = 'Users Can Register Applications'
            CurrentValue     = "Error: $($_.Exception.Message)"
            RecommendedValue = 'False'
            Status           = 'Skipped'
            Remediation      = 'Check Graph API permissions and retry.'
        }
        Add-Setting @settingParams
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
        $settingParams = @{
            CheckId          = 'ENTRA-GROUP-001'
            Category         = 'Directory Settings'
            Setting          = 'Users Can Create Security Groups'
            CurrentValue     = "Error: $($_.Exception.Message)"
            RecommendedValue = 'False'
            Status           = 'Skipped'
            Remediation      = 'Check Graph API permissions and retry.'
        }
        Add-Setting @settingParams
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
        $settingParams = @{
            CheckId          = 'ENTRA-TENANT-001'
            Category         = 'Directory Settings'
            Setting          = 'Non-Admin Tenant Creation Restricted'
            CurrentValue     = "Error: $($_.Exception.Message)"
            RecommendedValue = 'False'
            Status           = 'Skipped'
            Remediation      = 'Check Graph API permissions and retry.'
        }
        Add-Setting @settingParams
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
    $settingParams = @{
        CheckId          = 'ENTRA-CONSENT-002'
        Category         = 'Application Consent'
        Setting          = 'Admin Consent Workflow Enabled'
        CurrentValue     = "Error: $($_.Exception.Message)"
        RecommendedValue = 'True'
        Status           = 'Skipped'
        Remediation      = 'Check Graph API permissions and retry.'
    }
    Add-Setting @settingParams
}

# ------------------------------------------------------------------
# 9b. ENTRA-CONSENT-003: User consent restricted to verified publishers
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking verified publisher consent restriction..."
    $graphParams = @{
        Method      = 'GET'
        Uri         = '/v1.0/policies/authorizationPolicy'
        ErrorAction = 'Stop'
    }
    $authzPolicy = Invoke-MgGraphRequest @graphParams
    $consentSettings = $authzPolicy['defaultUserRolePermissions']
    $consentAllowed = $consentSettings['permissionGrantPoliciesAssigned']

    # CISA SCuBA MS.AAD.5.2v1: consent should require verified publisher
    $requiresVerified = $consentAllowed -and ($consentAllowed -contains 'microsoft-user-default-low' -or $consentAllowed -contains 'microsoft-application-admin')

    $settingParams = @{
        Category         = 'Application Consent'
        Setting          = 'User Consent Requires Verified Publisher'
        CurrentValue     = $(if ($requiresVerified) { 'Restricted to verified publishers' } elseif (-not $consentAllowed -or $consentAllowed.Count -eq 0) { 'User consent fully blocked' } else { "Consent policies: $($consentAllowed -join ', ')" })
        RecommendedValue = 'User consent restricted to verified publishers or fully blocked'
        Status           = $(if ($requiresVerified -or -not $consentAllowed -or $consentAllowed.Count -eq 0) { 'Pass' } else { 'Warning' })
        CheckId          = 'ENTRA-CONSENT-003'
        Remediation      = 'Entra admin center > Enterprise applications > Consent and permissions > User consent settings > Allow consent only from verified publishers or block user consent entirely.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check verified publisher consent restriction: $_"
    $settingParams = @{
        CheckId          = 'ENTRA-CONSENT-003'
        Category         = 'Application Consent'
        Setting          = 'User Consent Requires Verified Publisher'
        CurrentValue     = "Error: $($_.Exception.Message)"
        RecommendedValue = 'User consent restricted to verified publishers or fully blocked'
        Status           = 'Skipped'
        Remediation      = 'Check Graph API permissions and retry.'
    }
    Add-Setting @settingParams
}

# ------------------------------------------------------------------
# 9c. ENTRA-CONSENT-004: Tenant-wide admin consent grants to third-party apps
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking tenant-wide admin consent grants..."
    $graphParams = @{
        Method      = 'GET'
        Uri         = "/v1.0/oauth2PermissionGrants?`$filter=consentType eq 'AllPrincipals'&`$top=999"
        ErrorAction = 'Stop'
    }
    $allPrincipalGrants = Invoke-MgGraphRequest @graphParams
    $tenantWideGrants = if ($allPrincipalGrants -and $allPrincipalGrants['value']) { @($allPrincipalGrants['value']) } else { @() }

    $settingParams = @{
        Category         = 'Application Consent'
        Setting          = 'Tenant-Wide Admin Consent Grants'
        CurrentValue     = $(if ($tenantWideGrants.Count -eq 0) { 'No tenant-wide admin consent grants' } else { "$($tenantWideGrants.Count) tenant-wide consent grant(s)" })
        RecommendedValue = 'Review and minimize tenant-wide admin consent grants'
        Status           = $(if ($tenantWideGrants.Count -le 5) { 'Pass' } elseif ($tenantWideGrants.Count -le 15) { 'Info' } else { 'Warning' })
        CheckId          = 'ENTRA-CONSENT-004'
        Remediation      = 'Review tenant-wide admin consent grants. These grants apply to all users in the tenant. Remove overly broad grants that are no longer needed. Entra admin center > Enterprise applications > filter by Admin consent.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check tenant-wide consent grants: $_"
    $settingParams = @{
        CheckId          = 'ENTRA-CONSENT-004'
        Category         = 'Application Consent'
        Setting          = 'Tenant-Wide Admin Consent Grants'
        CurrentValue     = "Error: $($_.Exception.Message)"
        RecommendedValue = 'Review and minimize tenant-wide admin consent grants'
        Status           = 'Skipped'
        Remediation      = 'Check Graph API permissions and retry.'
    }
    Add-Setting @settingParams
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
        $settingParams = @{
            CheckId          = 'ENTRA-GUEST-002'
            Category         = 'External Collaboration'
            Setting          = 'Guest Invitation Policy'
            CurrentValue     = "Error: $($_.Exception.Message)"
            RecommendedValue = 'Admins and guest inviters only'
            Status           = 'Skipped'
            Remediation      = 'Check Graph API permissions and retry.'
        }
        Add-Setting @settingParams
        $settingParams = @{
            CheckId          = 'ENTRA-GUEST-001'
            Category         = 'External Collaboration'
            Setting          = 'Guest User Access Restriction'
            CurrentValue     = "Error: $($_.Exception.Message)"
            RecommendedValue = 'Restricted access'
            Status           = 'Skipped'
            Remediation      = 'Check Graph API permissions and retry.'
        }
        Add-Setting @settingParams
    }
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
    $settingParams = @{
        CheckId          = 'ENTRA-GUEST-003'
        Category         = 'External Collaboration'
        Setting          = 'Guest User Count'
        CurrentValue     = "Error: $($_.Exception.Message)"
        RecommendedValue = 'Review periodically'
        Status           = 'Skipped'
        Remediation      = 'Check Graph API permissions and retry.'
    }
    Add-Setting @settingParams
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
    $settingParams = @{
        CheckId          = 'ENTRA-LINKEDIN-001'
        Category         = 'Directory Settings'
        Setting          = 'LinkedIn Account Connections'
        CurrentValue     = "Error: $($_.Exception.Message)"
        RecommendedValue = 'Disabled'
        Status           = 'Skipped'
        Remediation      = 'Check Graph API permissions and retry.'
    }
    Add-Setting @settingParams
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
        $settingParams = @{
            CheckId          = 'ENTRA-APPS-001'
            Category         = 'Application Consent'
            Setting          = 'Third-party Integrated Apps Restricted'
            CurrentValue     = "Error: $($_.Exception.Message)"
            RecommendedValue = 'Restricted'
            Status           = 'Skipped'
            Remediation      = 'Check Graph API permissions and retry.'
        }
        Add-Setting @settingParams
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
    $settingParams = @{
        CheckId          = 'ENTRA-GUEST-004'
        Category         = 'External Collaboration'
        Setting          = 'Guest Invitation Domain Restrictions'
        CurrentValue     = "Error: $($_.Exception.Message)"
        RecommendedValue = 'Restricted to allowed domains only'
        Status           = 'Skipped'
        Remediation      = 'Check Graph API permissions and retry.'
    }
    Add-Setting @settingParams
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
    $settingParams = @{
        CheckId          = 'ENTRA-GROUP-002'
        Category         = 'External Collaboration'
        Setting          = 'Dynamic Group for Guest Users'
        CurrentValue     = "Error: $($_.Exception.Message)"
        RecommendedValue = 'At least 1 dynamic group for guests'
        Status           = 'Skipped'
        Remediation      = 'Check Graph API permissions and retry.'
    }
    Add-Setting @settingParams
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
    $settingParams = @{
        CheckId          = 'ENTRA-GROUP-003'
        Category         = 'Group Management'
        Setting          = 'Public Groups Have Owners'
        CurrentValue     = "Error: $($_.Exception.Message)"
        RecommendedValue = 'All public groups have assigned owners'
        Status           = 'Skipped'
        Remediation      = 'Check Graph API permissions and retry.'
    }
    Add-Setting @settingParams
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
    $settingParams = @{
        CheckId          = 'ENTRA-ORGSETTING-001'
        Category         = 'Organization Settings'
        Setting          = 'Org-Level App Consent Restriction'
        CurrentValue     = "Error: $($_.Exception.Message)"
        RecommendedValue = 'Do not allow user consent'
        Status           = 'Skipped'
        Remediation      = 'Check Graph API permissions and retry.'
    }
    Add-Setting @settingParams
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
# Disabled Member Account Count
# ------------------------------------------------------------------
try {
    Write-Verbose "Counting disabled member accounts..."
    $countHeaders  = @{ 'ConsistencyLevel' = 'eventual' }
    $totalCount    = [int](Invoke-MgGraphRequest -Method GET `
        -Uri "/v1.0/users/`$count?`$filter=userType eq 'Member'" `
        -Headers $countHeaders -ErrorAction Stop)
    $disabledCount = [int](Invoke-MgGraphRequest -Method GET `
        -Uri "/v1.0/users/`$count?`$filter=accountEnabled eq false and userType eq 'Member'" `
        -Headers $countHeaders -ErrorAction Stop)
    $pct = if ($totalCount -gt 0) { [math]::Round($disabledCount / $totalCount * 100, 1) } else { 0 }
    $settingParams = @{
        CheckId          = 'ENTRA-DISABLED-001'
        Category         = 'Directory Health'
        Setting          = 'Disabled Member Accounts'
        CurrentValue     = "$disabledCount disabled of $totalCount total members ($pct%)"
        RecommendedValue = 'Review periodically; remove accounts no longer needed'
        Status           = 'Info'
        Remediation      = 'Review disabled accounts and remove any that are no longer needed. Entra admin center > Users > All users > filter by Account status: Disabled.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not count disabled member accounts: $_"
    $settingParams = @{
        CheckId          = 'ENTRA-DISABLED-001'
        Category         = 'Directory Health'
        Setting          = 'Disabled Member Accounts'
        CurrentValue     = "Error: $($_.Exception.Message)"
        RecommendedValue = 'Review periodically; remove accounts no longer needed'
        Status           = 'Skipped'
        Remediation      = 'Check Graph API permissions (User.Read.All) and retry.'
    }
    Add-Setting @settingParams
}
