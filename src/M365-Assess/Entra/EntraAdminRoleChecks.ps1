# -------------------------------------------------------------------
# Entra ID -- Admin Accounts & PIM Checks
# Extracted from Get-EntraSecurityConfig.ps1 (#256)
# Runs in shared scope: $settings, $checkIdCounter, Add-Setting,
#   $context, $authPolicy, Get-BreakGlassAccounts
# -------------------------------------------------------------------
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseDeclaredVarsMoreThanAssignments', '')]
param()

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
            Evidence         = [PSCustomObject]@{
                OperationalAdmins = @($operationalAdmins | ForEach-Object { [PSCustomObject]@{ DisplayName = $_['displayName']; UserPrincipalName = $_['userPrincipalName']; Type = $_['@odata.type'] } })
                BreakGlassCount   = $bgExcluded
                TotalCount        = $allAdmins.Count
            }
        }
        Add-Setting @settingParams
    }
}
catch {
    Write-Warning "Could not check global admin count: $_"
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
        Remediation      = 'Entra admin center > Identity Governance > Privileged Identity Management > Microsoft Entra roles > Global Administrator > Remove permanent active assignments. Use eligible assignments with time-bound activation.'
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
        Remediation      = 'Entra admin center > Identity Governance > PIM > Microsoft Entra roles > Settings > Global Administrator > Require approval to activate > Yes.'
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
        Remediation      = 'Entra admin center > Identity Governance > PIM > Microsoft Entra roles > Settings > Privileged Role Administrator > Require approval to activate > Yes.'
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
        Remediation      = 'This check requires Entra ID P2 (included in M365 E5). Entra admin center > Identity Governance > PIM > Microsoft Entra roles > Settings.'
    }
    Add-Setting @settingParams

    $settingParams = @{
        Category         = 'Privileged Identity Management'
        Setting          = 'PRA Activation Requires Approval'
        CurrentValue     = $script:pimMessage
        RecommendedValue = 'Yes'
        Status           = 'Review'
        CheckId          = 'ENTRA-PIM-005'
        Remediation      = 'This check requires Entra ID P2 (included in M365 E5). Entra admin center > Identity Governance > PIM > Microsoft Entra roles > Settings.'
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
# 33. Admin MFA Method Strength (phishing-resistant required)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking admin MFA method strength..."
    $gaRoleTemplateId = '62e90394-69f5-4237-9190-012177145e10'
    $graphParams = @{
        Method      = 'GET'
        Uri         = "/v1.0/directoryRoles/roleTemplateId=$gaRoleTemplateId/members?`$select=id,displayName,userPrincipalName"
        ErrorAction = 'Stop'
    }
    $adminMembers = Invoke-MgGraphRequest @graphParams
    $adminList = if ($adminMembers -and $adminMembers['value']) { @($adminMembers['value']) } else { @() }

    if ($adminList.Count -gt 0) {
        $graphParams = @{
            Method      = 'GET'
            Uri         = '/beta/reports/authenticationMethods/userRegistrationDetails'
            ErrorAction = 'Stop'
        }
        $mfaDetails = Invoke-MgGraphRequest @graphParams
        $mfaList = if ($mfaDetails -and $mfaDetails['value']) { @($mfaDetails['value']) } else { @() }

        $phishingResistantMethods = @(
            'fido2'
            'windowsHelloForBusiness'
            'x509CertificateMultiFactor'
            'passKeyDeviceBound'
            'passKeyDeviceBoundAuthenticator'
        )

        $adminIds = @($adminList | ForEach-Object { $_['id'] })
        $adminMfa = @($mfaList | Where-Object { $_['id'] -in $adminIds })

        $adminsWithoutPhishRes = @($adminMfa | Where-Object {
            $methods = @($_['methodsRegistered'])
            -not ($methods | Where-Object { $_ -in $phishingResistantMethods })
        })
        $adminsNoMfa = @($adminMfa | Where-Object { -not $_['isMfaRegistered'] })

        if ($adminsNoMfa.Count -gt 0) {
            $names = ($adminsNoMfa | ForEach-Object { $_['userDisplayName'] }) -join ', '
            $settingParams = @{
                Category         = 'Admin Accounts'
                Setting          = 'Admin MFA Method Strength'
                CurrentValue     = "$($adminsNoMfa.Count) admin(s) without MFA: $names"
                RecommendedValue = 'All admins use phishing-resistant MFA'
                Status           = 'Fail'
                CheckId          = 'ENTRA-ADMIN-004'
                Remediation      = 'Enroll all Global Administrators in phishing-resistant MFA (FIDO2, Windows Hello for Business, or certificate-based). Entra admin center > Protection > Authentication methods > Policies.'
            }
            Add-Setting @settingParams
        }
        elseif ($adminsWithoutPhishRes.Count -gt 0) {
            $names = ($adminsWithoutPhishRes | ForEach-Object { $_['userDisplayName'] }) -join ', '
            $settingParams = @{
                Category         = 'Admin Accounts'
                Setting          = 'Admin MFA Method Strength'
                CurrentValue     = "$($adminsWithoutPhishRes.Count) admin(s) without phishing-resistant MFA: $names"
                RecommendedValue = 'All admins use phishing-resistant MFA'
                Status           = 'Warning'
                CheckId          = 'ENTRA-ADMIN-004'
                Remediation      = 'Upgrade admin MFA to phishing-resistant methods (FIDO2, Windows Hello for Business, or certificate-based). Standard MFA (push/TOTP) is vulnerable to adversary-in-the-middle attacks. Entra admin center > Protection > Authentication methods > Policies.'
            }
            Add-Setting @settingParams
        }
        else {
            $settingParams = @{
                Category         = 'Admin Accounts'
                Setting          = 'Admin MFA Method Strength'
                CurrentValue     = "All $($adminMfa.Count) admin(s) have phishing-resistant MFA"
                RecommendedValue = 'All admins use phishing-resistant MFA'
                Status           = 'Pass'
                CheckId          = 'ENTRA-ADMIN-004'
                Remediation      = 'No action needed.'
            }
            Add-Setting @settingParams
        }
    }
}
catch {
    Write-Warning "Could not check admin MFA method strength: $_"
}
