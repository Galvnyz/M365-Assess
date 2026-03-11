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
    Version: 0.5.0
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
    $settings.Add([PSCustomObject]@{
        Category         = $Category
        Setting          = $Setting
        CurrentValue     = $CurrentValue
        RecommendedValue = $RecommendedValue
        Status           = $Status
        CheckId          = $CheckId
        Remediation      = $Remediation
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
        -Status $(if ($isEnabled) { 'Pass' } else { 'Review' }) `
        -Remediation 'Entra admin center > Properties > Manage security defaults > Enable. If using Conditional Access, ensure equivalent protections exist.'
}
catch {
    Write-Warning "Could not retrieve security defaults: $_"
    Add-Setting -Category 'Security Defaults' -Setting 'Security Defaults Enabled' `
        -CurrentValue 'Unable to retrieve' -RecommendedValue 'True (if no CA)' -Status 'Unknown'
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
        -Remediation 'Entra admin center > Roles > Global Administrator. Maintain 2-4 global admins. Use dedicated admin accounts without mailboxes.'
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

        $consentStatus = if ($consentPolicy.Count -eq 0 -or $null -eq $consentPolicy) { 'Pass' } else { 'Warning' }

        Add-Setting -Category 'Application Consent' -Setting 'User Consent for Applications' `
            -CurrentValue $consentValue -RecommendedValue 'Do not allow user consent' -Status $consentStatus `
            -CheckId 'ENTRA-CONSENT-001' `
            -Remediation 'Entra admin center > Enterprise applications > Consent and permissions > User consent settings > Do not allow user consent.'
    }
    catch {
        Write-Warning "Could not check user consent policy: $_"
    }

    # 4. Users Can Register Applications
    try {
        $canRegister = $authPolicy['defaultUserRolePermissions']['allowedToCreateApps']

        Add-Setting -Category 'Application Consent' -Setting 'Users Can Register Applications' `
            -CurrentValue "$canRegister" -RecommendedValue 'False' `
            -Status $(if (-not $canRegister) { 'Pass' } else { 'Warning' }) `
            -Remediation 'Entra admin center > Users > User settings > Users can register applications > No.'
    }
    catch {
        Write-Warning "Could not check app registration policy: $_"
    }

    # 5. Users Can Create Security Groups
    try {
        $canCreateGroups = $authPolicy['defaultUserRolePermissions']['allowedToCreateSecurityGroups']
        Add-Setting -Category 'Directory Settings' -Setting 'Users Can Create Security Groups' `
            -CurrentValue "$canCreateGroups" -RecommendedValue 'False' `
            -Status $(if (-not $canCreateGroups) { 'Pass' } else { 'Review' }) `
            -CheckId 'ENTRA-GROUP-001' `
            -Remediation 'Entra admin center > Groups > General > Users can create security groups in Azure portals, API or PowerShell > No.'
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
            -Remediation 'Entra admin center > Users > User settings > Restrict non-admin users from creating tenants > Yes.'
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
        -Remediation 'Entra admin center > Enterprise applications > Admin consent requests > Users can request admin consent > Yes.'
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
        -Status $(if ($ssprRegistration -eq 'enabled') { 'Pass' } else { 'Review' }) `
        -CheckId 'ENTRA-MFA-001' `
        -Remediation 'Entra admin center > Protection > Authentication methods > Registration campaign > State > Enabled.'
}
catch {
    Write-Warning "Could not check SSPR: $_"
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
            -Remediation 'Entra admin center > Protection > Authentication methods > Password protection > Enforce custom list > Yes.'

        $bannedCount = if ($bannedList) { ($bannedList -split ',').Count } else { 0 }
        Add-Setting -Category 'Password Management' -Setting 'Custom Banned Password Count' `
            -CurrentValue "$bannedCount" -RecommendedValue '1+' `
            -Status $(if ($bannedCount -gt 0) { 'Pass' } else { 'Review' }) `
            -CheckId 'ENTRA-PASSWORD-002' `
            -Remediation 'Entra admin center > Protection > Authentication methods > Password protection > Custom banned passwords list > Add org-specific terms.'

        Add-Setting -Category 'Password Management' -Setting 'Smart Lockout Threshold' `
            -CurrentValue "$lockoutThreshold" -RecommendedValue '10' `
            -Status $(if ([int]$lockoutThreshold -le 10) { 'Pass' } else { 'Review' }) `
            -Remediation 'Entra admin center > Protection > Authentication methods > Password protection > Lockout threshold.'
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
            -Status $(if ($neverExpires) { 'Pass' } else { 'Review' }) `
            -CheckId 'ENTRA-PASSWORD-001' `
            -Remediation 'M365 admin center > Settings > Org settings > Security & privacy > Password expiration policy > Set passwords to never expire (ensure MFA is enforced).'
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
            -Remediation 'Entra admin center > External Identities > External collaboration settings > Guest invite settings > Only admins and users in guest inviter role.'

        # Guest user role
        $roleDisplay = switch ($guestAccessRestriction) {
            'a0b1b346-4d3e-4e8b-98f8-753987be4970' { 'Same as member users' }
            '10dae51f-b6af-4016-8d66-8c2a99b929b3' { 'Limited access (default)' }
            '2af84b1e-32c8-42b7-82bc-daa82404023b' { 'Restricted access' }
            default { $guestAccessRestriction }
        }

        Add-Setting -Category 'External Collaboration' -Setting 'Guest User Access Restriction' `
            -CurrentValue $roleDisplay -RecommendedValue 'Restricted access' `
            -Status $(if ($guestAccessRestriction -eq '2af84b1e-32c8-42b7-82bc-daa82404023b') { 'Pass' } else { 'Review' }) `
            -CheckId 'ENTRA-GUEST-001' `
            -Remediation 'Entra admin center > External Identities > External collaboration settings > Guest user access > Most restrictive.'
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
        -Status $(if ($caCount -gt 0) { 'Pass' } else { 'Warning' }) `
        -Remediation 'Entra admin center > Protection > Conditional Access > Create policies to enforce MFA, block legacy auth, and require compliant devices.'

    Add-Setting -Category 'Conditional Access' -Setting 'Enabled CA Policies' `
        -CurrentValue "$enabledCount" -RecommendedValue '1+' `
        -Status $(if ($enabledCount -gt 0) { 'Pass' } else { 'Warning' }) `
        -Remediation 'Entra admin center > Protection > Conditional Access > Ensure policies are set to On (not Report-only).'

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
        -Remediation 'Entra admin center > Protection > Conditional Access > New policy > Conditions > Client apps > Exchange ActiveSync + Other > Grant > Block access.'
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
        -CurrentValue "$guestCount" -RecommendedValue 'Review periodically' -Status 'Review' `
        -Remediation 'Entra admin center > Users > Guest users. Review and remove stale guest accounts. Consider enabling guest access expiration.'
}
catch {
    Write-Warning "Could not count guest users: $_"
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
