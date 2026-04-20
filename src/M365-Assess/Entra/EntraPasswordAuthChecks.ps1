# -------------------------------------------------------------------
# Entra ID -- Password & Authentication Checks
# Extracted from Get-EntraSecurityConfig.ps1 (#256)
# Runs in shared scope: $settings, $checkIdCounter, Add-Setting,
#   $context, $sspr, $authPolicy, $orgSettings
# -------------------------------------------------------------------
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseDeclaredVarsMoreThanAssignments', '')]
param()

# ------------------------------------------------------------------
# 1. Security Defaults
# ------------------------------------------------------------------
$secDefaultsCaPolicies = $null  # pre-fetched here, reused in check 1b
try {
    Write-Verbose "Checking security defaults..."
    $secDefaults = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/policies/identitySecurityDefaultsEnforcementPolicy' -ErrorAction Stop
    if (-not $secDefaults) { throw "API returned null response" }
    $isEnabled = $secDefaults['isEnabled']

    # When SD is disabled, check whether CA policies provide equivalent coverage.
    # SD disabled is the correct state for any tenant using Conditional Access — Microsoft
    # blocks enabling SD when CA policies are active. Only flag as Fail when there is
    # no MFA control at all (no CA and no SD).
    if (-not $isEnabled) {
        try {
            $caResp = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/identity/conditionalAccess/policies' -ErrorAction Stop
            $secDefaultsCaPolicies = if ($caResp -and $caResp['value']) { @($caResp['value']) } else { @() }
        }
        catch {
            Write-Verbose "Could not pre-fetch CA policies for security defaults check: $_"
            $secDefaultsCaPolicies = @()
        }
    }

    $caEnabledCount = if ($secDefaultsCaPolicies) {
        @($secDefaultsCaPolicies | Where-Object { $_['state'] -eq 'enabled' }).Count
    } else { 0 }

    $sdStatus = if ($isEnabled) { 'Pass' }
                elseif ($caEnabledCount -gt 0) { 'Pass' }
                else { 'Fail' }

    $sdCurrentValue = if ($isEnabled) {
        'True'
    } elseif ($caEnabledCount -gt 0) {
        "False (Conditional Access active: $caEnabledCount enabled policies)"
    } else {
        'False'
    }

    $settingParams = @{
        Category         = 'Security Defaults'
        Setting          = 'Security Defaults Enabled'
        CurrentValue     = $sdCurrentValue
        RecommendedValue = 'True (if no Conditional Access)'
        Status           = $sdStatus
        CheckId          = 'ENTRA-SECDEFAULT-001'
        Remediation      = 'Run: Update-MgPolicyIdentitySecurityDefaultsEnforcementPolicy -IsEnabled $true. Entra admin center > Properties > Manage security defaults.'
        Evidence         = [PSCustomObject]@{ IsSecurityDefaultsEnabled = [bool]$isEnabled }
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
# 1b. Security Defaults Gap Analysis (CA Coverage)
# ------------------------------------------------------------------
if ($isEnabled -eq $false) {
    try {
        Write-Verbose "Security Defaults OFF -- evaluating CA policy coverage..."
        # Reuse policies pre-fetched in check 1; fall back to a fresh call if unavailable.
        $caPolicies = if ($null -ne $secDefaultsCaPolicies) {
            $secDefaultsCaPolicies
        } else {
            $caResponse = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/identity/conditionalAccess/policies' -ErrorAction Stop
            if ($caResponse -and $caResponse['value']) { @($caResponse['value']) } else { @() }
        }
        $caEnabled = @($caPolicies | Where-Object { $_['state'] -eq 'enabled' })

        $coverageAreas = [ordered]@{
            'MFA for all users' = $false
            'Legacy auth blocked' = $false
            'Admin MFA' = $false
            'Azure Management MFA' = $false
        }

        # Well-known admin role template IDs (subset of CIS-recommended roles)
        $sdAdminRoles = @(
            '62e90394-69f5-4237-9190-012177145e10'  # Global Administrator
            'e8611ab8-c189-46e8-94e1-60213ab1f814'  # Privileged Role Administrator
            'fe930be7-5e62-47db-91af-98c3a49a38b1'  # User Administrator
            'f28a1f50-f6e7-4571-818b-6a12f2af6b6c'  # SharePoint Administrator
            '29232cdf-9323-42fd-ade2-1d097af3e4de'  # Exchange Administrator
        )

        # Azure Management well-known app ID
        $azureMgmtAppId = '797f4846-ba00-4fd7-ba43-dac1f8f63013'

        foreach ($policy in $caEnabled) {
            $grants = $policy['grantControls']['builtInControls']
            $users = $policy['conditions']['users']
            $clientApps = $policy['conditions']['clientAppTypes']
            $apps = $policy['conditions']['applications']

            # MFA for all users
            if (($users['includeUsers'] -contains 'All') -and ($grants -contains 'mfa')) {
                $coverageAreas['MFA for all users'] = $true
            }

            # Legacy auth blocked
            if (($clientApps -contains 'exchangeActiveSync' -or $clientApps -contains 'other') -and ($grants -contains 'block')) {
                $coverageAreas['Legacy auth blocked'] = $true
            }

            # Admin MFA
            $includeRoles = $users['includeRoles']
            if ($includeRoles) {
                $hasAdminRole = $false
                foreach ($role in $includeRoles) {
                    if ($role -in $sdAdminRoles) { $hasAdminRole = $true; break }
                }
                if ($hasAdminRole -and ($grants -contains 'mfa')) {
                    $coverageAreas['Admin MFA'] = $true
                }
            }

            # Azure Management MFA
            $includeApps = $apps['includeApplications']
            if (($includeApps -contains $azureMgmtAppId -or $includeApps -contains 'All') -and ($grants -contains 'mfa')) {
                $coverageAreas['Azure Management MFA'] = $true
            }
        }

        $coveredCount = ($coverageAreas.Values | Where-Object { $_ -eq $true }).Count
        $totalAreas = $coverageAreas.Count
        $gaps = @($coverageAreas.GetEnumerator() | Where-Object { $_.Value -eq $false } | ForEach-Object { $_.Key })

        if ($coveredCount -eq $totalAreas) {
            $settingParams = @{
                Category         = 'Security Defaults'
                Setting          = 'Security Defaults Gap Analysis'
                CurrentValue     = "All $totalAreas areas covered by Conditional Access"
                RecommendedValue = 'Full CA coverage when Security Defaults is OFF'
                Status           = 'Pass'
                CheckId          = 'ENTRA-SECDEFAULT-002'
                Remediation      = 'No action needed. Conditional Access policies provide equivalent coverage to Security Defaults.'
            }
        }
        elseif ($coveredCount -gt 0) {
            $gapList = $gaps -join ', '
            $settingParams = @{
                Category         = 'Security Defaults'
                Setting          = 'Security Defaults Gap Analysis'
                CurrentValue     = "$coveredCount/$totalAreas covered. Gaps: $gapList"
                RecommendedValue = 'Full CA coverage when Security Defaults is OFF'
                Status           = 'Review'
                CheckId          = 'ENTRA-SECDEFAULT-002'
                Remediation      = "Create CA policies to cover: $gapList. Entra admin center > Protection > Conditional Access."
            }
        }
        else {
            $settingParams = @{
                Category         = 'Security Defaults'
                Setting          = 'Security Defaults Gap Analysis'
                CurrentValue     = "0/$totalAreas areas covered -- no CA policy protection"
                RecommendedValue = 'Full CA coverage when Security Defaults is OFF'
                Status           = 'Fail'
                CheckId          = 'ENTRA-SECDEFAULT-002'
                Remediation      = 'Either enable Security Defaults or create CA policies for: MFA for all users, legacy auth block, admin MFA, Azure Management MFA. Entra admin center > Protection > Conditional Access.'
            }
        }
        Add-Setting @settingParams
    }
    catch {
        Write-Warning "Could not evaluate CA coverage for Security Defaults gap analysis: $_"
        $settingParams = @{
            Category         = 'Security Defaults'
            Setting          = 'Security Defaults Gap Analysis'
            CurrentValue     = 'Unable to evaluate'
            RecommendedValue = 'Full CA coverage when Security Defaults is OFF'
            Status           = 'Review'
            CheckId          = 'ENTRA-SECDEFAULT-002'
            Remediation      = 'Verify CA policies are configured. Entra admin center > Protection > Conditional Access.'
        }
        Add-Setting @settingParams
    }
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
# 7b. Authentication Methods -- SMS/Voice/Email (CIS 5.2.3.5, 5.2.3.7)
# ------------------------------------------------------------------
try {
    if ($sspr) {
        $authMethods = $sspr['authenticationMethodConfigurations']
        if ($authMethods) {
            # CIS 5.2.3.5 -- SMS sign-in disabled
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

            # CIS 5.2.3.5 -- Voice call disabled
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

            # CIS 5.2.3.7 -- Email OTP disabled
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
    if ($_.ToString() -match '400 Bad Request|BadRequest|Resource not found for the segment') {
        # Tenant has no configured directory settings — normal for tenants that have never
        # customized Entra password protection. Add a single Info item so the check appears
        # in the report rather than silently disappearing.
        $settingParams = @{
            Category         = 'Password Management'
            Setting          = 'Custom Banned Password Protection'
            CurrentValue     = 'Directory settings not configured (using Entra defaults)'
            RecommendedValue = 'Configured'
            Status           = 'Info'
            CheckId          = 'ENTRA-PASSWORD-002'
            Remediation      = 'Entra admin center > Protection > Authentication methods > Password protection. Configure a custom banned password list and smart lockout threshold.'
        }
        Add-Setting @settingParams
    }
    else {
        Write-Warning "Could not check password protection: $_"
    }
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
# 20. Authenticator Fatigue Protection (CIS 5.2.3.1)
# ------------------------------------------------------------------
try {
    if ($sspr) {
        $authMethods = $sspr['authenticationMethodConfigurations']
        $authenticator = $authMethods | Where-Object { $_['id'] -eq 'MicrosoftAuthenticator' }

        if ($authenticator) {
            $featureSettings = $authenticator['featureSettings']
            if ($null -ne $featureSettings) {
                $numberMatchState = $featureSettings['numberMatchingRequiredState']
                $appInfoState = $featureSettings['displayAppInformationRequiredState']
                $numberMatch = if ($numberMatchState) { $numberMatchState['state'] } else { 'not configured' }
                $appInfo = if ($appInfoState) { $appInfoState['state'] } else { 'not configured' }

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
                    CurrentValue     = 'Feature settings not available for Microsoft Authenticator'
                    RecommendedValue = 'Both enabled'
                    Status           = 'Review'
                    CheckId          = 'ENTRA-AUTHMETHOD-003'
                    Remediation      = 'Verify Microsoft Authenticator feature settings in Entra admin center > Protection > Authentication methods > Microsoft Authenticator > Configure.'
                }
                Add-Setting @settingParams
            }
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
    $org = if ($orgValue.Count -gt 0) { $orgValue[0] } else { $null }

    if ($null -eq $org) {
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
    else {
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
}
catch {
    Write-Warning "Could not check password hash sync: $_"
}
