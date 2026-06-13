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
    # Detect by service plan, not SKU GUID (#881). Microsoft adds new SKU
    # bundles constantly (developer packs, education, government, partner-
    # resold, regional variants); they all resolve to the same service plans.
    # AAD_PREMIUM_P2 = eec0eb4f-6444-4f95-aba0-50c24d67f998 is the atomic
    # feature unit that grants PIM access — checking SKU GUIDs misses every
    # E5 variant outside the mainline commercial bundle. Same pattern used in
    # Get-TeamsSecurityConfig.ps1 for Teams licensing detection.
    $aadP2ServicePlanId = 'eec0eb4f-6444-4f95-aba0-50c24d67f998'
    foreach ($sku in $skuList) {
        if ($sku['capabilityStatus'] -ne 'Enabled') { continue }
        $servicePlans = if ($sku['servicePlans']) { @($sku['servicePlans']) } else { @() }
        foreach ($sp in $servicePlans) {
            if ($sp['servicePlanId'] -eq $aadP2ServicePlanId -and $sp['provisioningStatus'] -eq 'Success') {
                $hasPimLicense = $true
                break
            }
        }
        if ($hasPimLicense) { break }
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

# CIS 5.3.1 -- PIM manages privileged roles (no permanent GA assignments).
# #886: previous logic queried only /beta/roleManagement/directory/roleAssignment
# ScheduleInstances which exposes ONLY PIM-managed assignments. Tenants with
# direct (non-PIM) Global Admin assignments showed empty results and were
# falsely Pass'd. The fix: enumerate directoryRoles members (all GAs, direct
# OR PIM-elevated) and subtract those whose access is JIT-eligible-only via
# PIM. Anything left = permanent / standing access.
$gaRoleTemplateId = '62e90394-69f5-4237-9190-012177145e10'
$gaMembers = @()
$gaQueryFailed = $false
try {
    $gaRoleResp = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/directoryRoles(roleTemplateId='$gaRoleTemplateId')/members" -ErrorAction Stop
    $gaMembers = if ($gaRoleResp -and $gaRoleResp['value']) { @($gaRoleResp['value']) } else { @() }
}
catch {
    Write-Warning "Could not query Global Admin role members: $($_.Exception.Message)"
    $gaQueryFailed = $true
}

$eligiblePrincipalIds = @()
if ($hasPimLicense -and -not $gaQueryFailed) {
    # PIM-eligible-only assignments don't equal permanent. Subtract these from
    # the GA members to find direct/standing assignments. PIM-active-with-end-
    # date assignments DO appear in directoryRoles members during their active
    # window, but their principal is also in eligibility schedule — so they're
    # correctly classified as eligible (not permanent).
    try {
        $eligibleResp = Invoke-MgGraphRequest -Method GET -Uri "/beta/roleManagement/directory/roleEligibilityScheduleInstances?`$filter=roleDefinitionId eq '$gaRoleTemplateId'" -ErrorAction Stop
        if ($eligibleResp -and $eligibleResp['value']) {
            $eligiblePrincipalIds = @($eligibleResp['value'] | ForEach-Object { $_['principalId'] })
        }
    }
    catch {
        Write-Warning "Could not query PIM eligibility schedule for GA role: $($_.Exception.Message)"
    }
}

if ($gaQueryFailed) {
    $settingParams = @{
        Category         = 'Privileged Identity Management'
        Setting          = 'PIM Manages Privileged Roles'
        CurrentValue     = 'Could not enumerate Global Admin members'
        RecommendedValue = 'No permanent Global Admin assignments'
        Status           = 'Unknown'
        CheckId          = 'ENTRA-PIM-001'
        Remediation      = 'Verify RoleManagement.Read.Directory consent. Then re-run the assessment.'
    }
    Add-Setting @settingParams
}
else {
    $permanentGAs = @($gaMembers | Where-Object { $_['id'] -notin $eligiblePrincipalIds })
    $permanentCount = $permanentGAs.Count

    $detail = if ($permanentCount -eq 0) {
        if ($hasPimLicense) { 'No permanent GA assignments (all GAs are PIM-eligible)' }
        else                { 'No Global Administrator members detected' }
    }
    else {
        $upns = ($permanentGAs | ForEach-Object {
            if ($_['userPrincipalName']) { $_['userPrincipalName'] }
            elseif ($_['displayName'])    { $_['displayName'] }
            else                          { $_['id'] }
        } | Select-Object -First 5) -join ', '
        $more = if ($permanentCount -gt 5) { " (+$($permanentCount - 5) more)" } else { '' }
        if ($hasPimLicense) {
            "$permanentCount permanent (non-PIM-eligible) GA assignment(s): $upns$more"
        } else {
            "$permanentCount Global Admin(s) — PIM not licensed so all are permanent: $upns$more"
        }
    }

    $settingParams = @{
        Category         = 'Privileged Identity Management'
        Setting          = 'PIM Manages Privileged Roles'
        CurrentValue     = $detail
        RecommendedValue = 'No permanent Global Admin assignments (all GAs PIM-eligible only)'
        Status           = $(if ($permanentCount -eq 0) { 'Pass' } else { 'Fail' })
        CheckId          = 'ENTRA-PIM-001'
        Remediation      = 'Entra admin center > Identity Governance > Privileged Identity Management > Microsoft Entra roles > Global Administrator > Remove permanent active assignments. Use eligible assignments with time-bound activation. Requires Entra ID P2 (included in M365 E5).'
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

# CIS 5.3.4/5.3.5 -- GA/PRA activation approval. Per Microsoft Graph docs the
# roleManagementPolicyAssignments endpoint REQUIRES a $filter on scopeId+scopeType
# +roleDefinitionId and is GA in v1.0 including GCC High / DoD. The previous call
# (/beta/policies/roleManagementPolicies?$expand=rules) omitted the mandatory
# $filter -- commercial tolerated it but sovereign clouds returned 400, and the
# returned policies are named after the scopeType ("DirectoryRole"), never the
# role, so the old displayName match never resolved a role either (#978).
$pimApprovalRoles = @(
    @{ CheckId = 'ENTRA-PIM-004'; Setting = 'GA Activation Requires Approval'
       RoleId = '62e90394-69f5-4237-9190-012177145e10'; RoleName = 'Global Administrator' }
    @{ CheckId = 'ENTRA-PIM-005'; Setting = 'PRA Activation Requires Approval'
       RoleId = 'e8611ab8-c189-46e8-94e1-60213ab1f814'; RoleName = 'Privileged Role Administrator' }
)

if ($pimAvailable) {
    foreach ($role in $pimApprovalRoles) {
        $approvalRequired = $null   # null = could not determine -> Review
        try {
            Write-Verbose "Checking PIM activation policy for $($role.RoleName)..."
            $filter = "scopeId eq '/' and scopeType eq 'DirectoryRole' and roleDefinitionId eq '$($role.RoleId)'"
            $uri = "/v1.0/policies/roleManagementPolicyAssignments?`$filter=$filter&`$expand=policy(`$expand=rules)"
            $assignmentsResp = Invoke-MgGraphRequest -Method GET -Uri $uri -ErrorAction Stop
            $assignment = if ($assignmentsResp -and $assignmentsResp['value']) { @($assignmentsResp['value'])[0] } else { $null }
            $rules = if ($assignment -and $assignment['policy'] -and $assignment['policy']['rules']) {
                @($assignment['policy']['rules'])
            } else { @() }
            $approvalRule = $rules | Where-Object { $_['@odata.type'] -match 'ApprovalRule' } | Select-Object -First 1
            if ($approvalRule -and $approvalRule['setting']) {
                $approvalRequired = [bool]$approvalRule['setting']['isApprovalRequired']
            }
            elseif ($assignment) {
                # Policy resolved but carries no approval rule -> approval not required
                $approvalRequired = $false
            }
        }
        catch {
            Write-Warning "Could not check PIM activation policy for $($role.RoleName): $_"
            $approvalRequired = $null
        }

        if ($null -eq $approvalRequired) {
            $settingParams = @{
                Category         = 'Privileged Identity Management'
                Setting          = $role.Setting
                CurrentValue     = 'Unable to read PIM activation policy'
                RecommendedValue = 'Yes'
                Status           = 'Review'
                CheckId          = $role.CheckId
                Remediation      = "Entra admin center > Identity Governance > PIM > Microsoft Entra roles > Settings > $($role.RoleName) > Require approval to activate > Yes."
            }
        }
        else {
            $settingParams = @{
                Category         = 'Privileged Identity Management'
                Setting          = $role.Setting
                CurrentValue     = $(if ($approvalRequired) { 'Yes' } else { 'No' })
                RecommendedValue = 'Yes'
                Status           = $(if ($approvalRequired) { 'Pass' } else { 'Fail' })
                CheckId          = $role.CheckId
                Remediation      = "Entra admin center > Identity Governance > PIM > Microsoft Entra roles > Settings > $($role.RoleName) > Require approval to activate > Yes."
            }
        }
        Add-Setting @settingParams
    }
}
elseif (-not $pimAvailable) {
    foreach ($role in $pimApprovalRoles) {
        $settingParams = @{
            Category         = 'Privileged Identity Management'
            Setting          = $role.Setting
            CurrentValue     = $script:pimMessage
            RecommendedValue = 'Yes'
            Status           = 'Review'
            CheckId          = $role.CheckId
            Remediation      = 'This check requires Entra ID P2 (included in M365 E5). Entra admin center > Identity Governance > PIM > Microsoft Entra roles > Settings.'
        }
        Add-Setting @settingParams
    }
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

# ENTRA-ADMIN-003 (Emergency Access Accounts) removed in #888 — was a
# duplicate of ENTRA-BREAKGLASS-001 (Get-StrykerIncidentReadiness.ps1)
# with weaker detection (broader user-base search produced false positives;
# 003 reported "3 detected" on a tenant where only 1 user actually matched
# the heuristic). Single source of truth is now ENTRA-BREAKGLASS-001 with
# the canonical Microsoft + CIS threshold of 2 enabled break-glass accounts.

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
