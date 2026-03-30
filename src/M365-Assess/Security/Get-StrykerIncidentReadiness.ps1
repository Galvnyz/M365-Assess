<#
.SYNOPSIS
    Collects Stryker Incident Readiness checks for the M365 Security Assessment.
.DESCRIPTION
    Evaluates 9 security controls inspired by the Stryker Corporation cyberattack
    (March 2026). These checks cover attack vectors not assessed by other M365 Assess
    collectors: stale admin detection, on-prem synced admins, CA policy exclusion
    analysis, privileged group assignments, overprivileged apps, multi-admin approval,
    RBAC scope tags, break-glass account detection, and device wipe audit.

    Requires: Directory.Read.All, AuditLog.Read.All, Policy.Read.All,
    DeviceManagementConfiguration.Read.All, DeviceManagementRBAC.Read.All,
    RoleManagement.Read.Directory
.PARAMETER OutputPath
    Path to export the CSV results file.
.NOTES
    Author:  Daren9m
    Ported from: StrykerScan (https://github.com/Galvnyz/StrykerScan)
#>

[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath
)

# Continue on errors: individual checks query different Graph endpoints and some
# may fail due to missing licenses or permissions without invalidating the rest.
$ErrorActionPreference = 'Continue'

# ── Verify Graph connection ──────────────────────────────────────────
if (-not (Assert-GraphConnection)) { return }

Import-Module -Name Microsoft.Graph.Identity.DirectoryManagement -ErrorAction SilentlyContinue
Import-Module -Name Microsoft.Graph.Identity.SignIns -ErrorAction SilentlyContinue

# ── Output collection ────────────────────────────────────────────────
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
        Update-CheckProgress -CheckId $subCheckId -Setting $Setting -Status $Status
    }
}

# ── Shared: privileged role template IDs ─────────────────────────────
$coreRoleTemplateIds = @(
    '62e90394-69f5-4237-9190-012177145e10'  # Global Administrator
    '3a2c62db-5318-420d-8d74-23affee5d9d5'  # Intune Administrator
    '194ae4cb-b126-40b2-bd5b-6091b380977d'  # Security Administrator
)
$extendedRoleTemplateIds = $coreRoleTemplateIds + @(
    'f2ef992c-3afb-46b9-b7cf-a126ee74c451'  # Global Reader
)
$groupCheckRoleTemplateIds = $extendedRoleTemplateIds + @(
    '29232cdf-9323-42fd-ade2-1d097af3e4de'  # Exchange Administrator
    'fe930be7-5e62-47db-91af-98c3a49a38b1'  # User Administrator
)

$breakGlassPatterns = @('break.?glass', 'emergency.?access', 'breakglass', 'bg.?admin')

# ── Helper: get unique admin map for a set of role template IDs ──────
function Get-AdminMap {
    param([string[]]$RoleTemplateIds)
    $map = @{}
    foreach ($roleTemplateId in $RoleTemplateIds) {
        $role = Get-MgDirectoryRole -Filter "roleTemplateId eq '$roleTemplateId'" -ErrorAction SilentlyContinue
        if (-not $role) { continue }
        $members = Get-MgDirectoryRoleMemberAsUser -DirectoryRoleId $role.Id -All -ErrorAction SilentlyContinue
        if (-not $members) { continue }
        foreach ($member in $members) {
            if (-not $map.ContainsKey($member.Id)) {
                $map[$member.Id] = $member
            }
        }
    }
    return $map
}

# =====================================================================
# CHECK 1: ENTRA-STALEADMIN-001 — Stale Admin Accounts (>90 days)
# =====================================================================
try {
    $staleThresholdDays = 90
    $cutoffDate = (Get-Date).AddDays(-$staleThresholdDays)
    $adminMap = Get-AdminMap -RoleTemplateIds $extendedRoleTemplateIds
    $adminsChecked = $adminMap.Count

    if ($adminsChecked -eq 0) {
        Add-Setting -Category 'Stale Admin Detection' -Setting 'Admin accounts inactive >90 days' `
            -CurrentValue 'Unable to enumerate admin accounts' `
            -RecommendedValue 'All admins active within 90 days' `
            -Status 'Review' -CheckId 'ENTRA-STALEADMIN-001' `
            -Remediation 'Ensure Directory.Read.All permission is granted.'
    }
    else {
        # Batch-fetch sign-in activity
        $adminIds = @($adminMap.Keys)
        $chunkSize = 15
        $signInData = @{}

        for ($i = 0; $i -lt $adminIds.Count; $i += $chunkSize) {
            $chunk = $adminIds[$i..[math]::Min($i + $chunkSize - 1, $adminIds.Count - 1)]
            $idFilter = ($chunk | ForEach-Object { "'$_'" }) -join ','
            try {
                $uri = "https://graph.microsoft.com/v1.0/users?`$filter=id in ($idFilter)&`$select=id,displayName,userPrincipalName,signInActivity"
                $response = Invoke-MgGraphRequest -Uri $uri -Method GET -ErrorAction Stop
                foreach ($user in $response.value) {
                    $signInData[$user.id] = $user.signInActivity
                }
            }
            catch {
                foreach ($uid in $chunk) { $signInData[$uid] = $null }
            }
        }

        $allNull = ($signInData.Values | Where-Object { $null -ne $_ }).Count -eq 0
        if ($allNull -and $adminsChecked -gt 0) {
            Add-Setting -Category 'Stale Admin Detection' -Setting 'Admin accounts inactive >90 days' `
                -CurrentValue 'Sign-in activity data unavailable (AuditLog.Read.All may not be consented)' `
                -RecommendedValue 'All admins active within 90 days' `
                -Status 'Review' -CheckId 'ENTRA-STALEADMIN-001' `
                -Remediation 'Grant AuditLog.Read.All permission and reconnect to Microsoft Graph.'
        }
        else {
            $staleAdmins = @()
            foreach ($adminId in $adminIds) {
                $admin = $adminMap[$adminId]
                $activity = $signInData[$adminId]
                $lastSignIn = if ($activity) { $activity.lastSignInDateTime } else { $null }

                if (-not $lastSignIn) {
                    $isBreakGlass = $false
                    foreach ($p in $breakGlassPatterns) {
                        if ($admin.DisplayName -match $p) { $isBreakGlass = $true; break }
                    }
                    if (-not $isBreakGlass) {
                        $staleAdmins += "$($admin.DisplayName) ($($admin.UserPrincipalName)) - Never signed in"
                    }
                }
                elseif ([datetime]$lastSignIn -lt $cutoffDate) {
                    $daysSince = [math]::Round(((Get-Date) - [datetime]$lastSignIn).TotalDays)
                    $staleAdmins += "$($admin.DisplayName) ($($admin.UserPrincipalName)) - Last sign-in: $([datetime]$lastSignIn | Get-Date -Format 'yyyy-MM-dd') ($daysSince days ago)"
                }
            }

            if ($staleAdmins.Count -eq 0) {
                Add-Setting -Category 'Stale Admin Detection' -Setting 'Admin accounts inactive >90 days' `
                    -CurrentValue "All $adminsChecked admin(s) active within $staleThresholdDays days" `
                    -RecommendedValue 'All admins active within 90 days' `
                    -Status 'Pass' -CheckId 'ENTRA-STALEADMIN-001' `
                    -Remediation 'No action needed.'
            }
            else {
                Add-Setting -Category 'Stale Admin Detection' -Setting 'Admin accounts inactive >90 days' `
                    -CurrentValue "$($staleAdmins.Count) stale admin(s): $($staleAdmins -join '; ')" `
                    -RecommendedValue 'All admins active within 90 days' `
                    -Status 'Fail' -CheckId 'ENTRA-STALEADMIN-001' `
                    -Remediation 'Review each stale account. Remove admin role if no longer needed, or require password reset and MFA re-registration. Enable PIM to auto-expire admin assignments.'
            }
        }
    }
}
catch {
    Add-Setting -Category 'Stale Admin Detection' -Setting 'Admin accounts inactive >90 days' `
        -CurrentValue "Error: $($_.Exception.Message)" `
        -RecommendedValue 'All admins active within 90 days' `
        -Status 'Review' -CheckId 'ENTRA-STALEADMIN-001' `
        -Remediation 'Ensure Directory.Read.All and AuditLog.Read.All permissions are granted.'
}

# =====================================================================
# CHECK 2: ENTRA-SYNCADMIN-001 — On-Prem Synced Admin Accounts
# =====================================================================
try {
    $adminMap = Get-AdminMap -RoleTemplateIds $coreRoleTemplateIds
    $adminsChecked = $adminMap.Count

    if ($adminsChecked -eq 0) {
        Add-Setting -Category 'Cloud Admin Isolation' -Setting 'On-prem synced admin accounts' `
            -CurrentValue 'Unable to enumerate admin accounts' `
            -RecommendedValue 'All admin accounts cloud-only' `
            -Status 'Review' -CheckId 'ENTRA-SYNCADMIN-001' `
            -Remediation 'Ensure Directory.Read.All permission is granted.'
    }
    else {
        $syncedAdmins = @()
        foreach ($admin in $adminMap.Values) {
            if ($admin.OnPremisesSyncEnabled -eq $true) {
                $syncedAdmins += "$($admin.DisplayName) ($($admin.UserPrincipalName))"
            }
        }

        if ($syncedAdmins.Count -eq 0) {
            Add-Setting -Category 'Cloud Admin Isolation' -Setting 'On-prem synced admin accounts' `
                -CurrentValue "All $adminsChecked admin(s) are cloud-only" `
                -RecommendedValue 'All admin accounts cloud-only' `
                -Status 'Pass' -CheckId 'ENTRA-SYNCADMIN-001' `
                -Remediation 'No action needed.'
        }
        else {
            Add-Setting -Category 'Cloud Admin Isolation' -Setting 'On-prem synced admin accounts' `
                -CurrentValue "$($syncedAdmins.Count) synced admin(s): $($syncedAdmins -join '; ')" `
                -RecommendedValue 'All admin accounts cloud-only' `
                -Status 'Fail' -CheckId 'ENTRA-SYNCADMIN-001' `
                -Remediation 'Create dedicated cloud-only admin accounts on the .onmicrosoft.com domain. Remove admin roles from on-prem synced accounts. On-prem compromise leads to cloud admin compromise.'
        }
    }
}
catch {
    Add-Setting -Category 'Cloud Admin Isolation' -Setting 'On-prem synced admin accounts' `
        -CurrentValue "Error: $($_.Exception.Message)" `
        -RecommendedValue 'All admin accounts cloud-only' `
        -Status 'Review' -CheckId 'ENTRA-SYNCADMIN-001' `
        -Remediation 'Ensure Directory.Read.All permission is granted.'
}

# =====================================================================
# CHECK 3: CA-EXCLUSION-001 — Privileged Admins Excluded from CA
# =====================================================================
try {
    $policies = Get-MgIdentityConditionalAccessPolicy -All -ErrorAction Stop
    $enabledPolicies = @($policies | Where-Object { $_.State -eq 'enabled' })

    if ($enabledPolicies.Count -eq 0) {
        Add-Setting -Category 'CA Policy Exclusions' -Setting 'Admins excluded from CA policies' `
            -CurrentValue 'No enabled Conditional Access policies found' `
            -RecommendedValue 'No privileged admins excluded from CA policies' `
            -Status 'Warning' -CheckId 'CA-EXCLUSION-001' `
            -Remediation 'Create Conditional Access policies to protect admin access.'
    }
    else {
        $adminMap = Get-AdminMap -RoleTemplateIds $coreRoleTemplateIds
        if ($adminMap.Count -eq 0) {
            Add-Setting -Category 'CA Policy Exclusions' -Setting 'Admins excluded from CA policies' `
                -CurrentValue 'Unable to enumerate admin accounts' `
                -RecommendedValue 'No privileged admins excluded from CA policies' `
                -Status 'Review' -CheckId 'CA-EXCLUSION-001' `
                -Remediation 'Ensure Directory.Read.All permission is granted.'
        }
        else {
            $riskyExclusions = @()
            foreach ($policy in $enabledPolicies) {
                $excludedUserIds = @($policy.Conditions.Users.ExcludeUsers | Where-Object { $_ })
                if ($excludedUserIds.Count -eq 0) { continue }

                foreach ($excludedId in $excludedUserIds) {
                    if ($adminMap.ContainsKey($excludedId)) {
                        $admin = $adminMap[$excludedId]
                        $adminName = "$($admin.DisplayName) ($($admin.UserPrincipalName))"
                        $isBreakGlass = $false
                        foreach ($p in $breakGlassPatterns) {
                            if ($adminName -match $p) { $isBreakGlass = $true; break }
                        }
                        if (-not $isBreakGlass) {
                            $riskyExclusions += "$adminName excluded from '$($policy.DisplayName)'"
                        }
                    }
                }
            }

            $uniqueExclusions = @($riskyExclusions | Select-Object -Unique)

            if ($uniqueExclusions.Count -eq 0) {
                Add-Setting -Category 'CA Policy Exclusions' -Setting 'Admins excluded from CA policies' `
                    -CurrentValue 'No privileged admins excluded (break-glass accounts filtered)' `
                    -RecommendedValue 'No privileged admins excluded from CA policies' `
                    -Status 'Pass' -CheckId 'CA-EXCLUSION-001' `
                    -Remediation 'No action needed. Continue to review CA exclusions periodically.'
            }
            else {
                Add-Setting -Category 'CA Policy Exclusions' -Setting 'Admins excluded from CA policies' `
                    -CurrentValue "$($uniqueExclusions.Count) exclusion(s): $($uniqueExclusions -join '; ')" `
                    -RecommendedValue 'No privileged admins excluded from CA policies' `
                    -Status 'Fail' -CheckId 'CA-EXCLUSION-001' `
                    -Remediation 'Remove admin accounts from CA policy exclusion lists. Only break-glass emergency access accounts should be excluded. Use Entra ID Access Reviews to audit CA exclusions regularly.'
            }
        }
    }
}
catch {
    Add-Setting -Category 'CA Policy Exclusions' -Setting 'Admins excluded from CA policies' `
        -CurrentValue "Error: $($_.Exception.Message)" `
        -RecommendedValue 'No privileged admins excluded from CA policies' `
        -Status 'Review' -CheckId 'CA-EXCLUSION-001' `
        -Remediation 'Ensure Policy.Read.All and Directory.Read.All permissions are granted.'
}

# =====================================================================
# CHECK 4: ENTRA-ROLEGROUP-001 — Unprotected Privileged Group Assignments
# =====================================================================
try {
    $unprotectedGroups = @()
    $groupsChecked = 0

    foreach ($roleTemplateId in $groupCheckRoleTemplateIds) {
        $role = Get-MgDirectoryRole -Filter "roleTemplateId eq '$roleTemplateId'" -ErrorAction SilentlyContinue
        if (-not $role) { continue }

        $members = Invoke-MgGraphRequest -Uri "https://graph.microsoft.com/v1.0/directoryRoles/$($role.Id)/members" -Method GET -ErrorAction SilentlyContinue
        if (-not $members -or -not $members.value) { continue }

        foreach ($member in $members.value) {
            if ($member.'@odata.type' -ne '#microsoft.graph.group') { continue }
            $groupsChecked++

            if ($member.isAssignableToRole -ne $true) {
                $memberCount = 'unknown'
                try {
                    $countUri = "https://graph.microsoft.com/v1.0/groups/$($member.id)/members/`$count"
                    $countResponse = Invoke-MgGraphRequest -Uri $countUri -Method GET -Headers @{ 'ConsistencyLevel' = 'eventual' } -ErrorAction Stop
                    $memberCount = $countResponse
                }
                catch { Write-Verbose "Could not get member count for group $($member.displayName)" }
                $unprotectedGroups += "$($member.displayName) — Role: $($role.DisplayName), Members: $memberCount"
            }
        }
    }

    if ($groupsChecked -eq 0) {
        Add-Setting -Category 'Privileged Group Protection' -Setting 'Groups in privileged role assignments' `
            -CurrentValue 'No groups assigned to privileged roles (individual users only)' `
            -RecommendedValue 'All role-assigned groups have isAssignableToRole enabled' `
            -Status 'Pass' -CheckId 'ENTRA-ROLEGROUP-001' `
            -Remediation 'No action needed.'
    }
    elseif ($unprotectedGroups.Count -eq 0) {
        Add-Setting -Category 'Privileged Group Protection' -Setting 'Groups in privileged role assignments' `
            -CurrentValue "All $groupsChecked group(s) have isAssignableToRole enabled" `
            -RecommendedValue 'All role-assigned groups have isAssignableToRole enabled' `
            -Status 'Pass' -CheckId 'ENTRA-ROLEGROUP-001' `
            -Remediation 'No action needed.'
    }
    else {
        Add-Setting -Category 'Privileged Group Protection' -Setting 'Groups in privileged role assignments' `
            -CurrentValue "$($unprotectedGroups.Count) unprotected group(s): $($unprotectedGroups -join '; ')" `
            -RecommendedValue 'All role-assigned groups have isAssignableToRole enabled' `
            -Status 'Fail' -CheckId 'ENTRA-ROLEGROUP-001' `
            -Remediation 'Recreate each group with isAssignableToRole = true (cannot be changed post-creation). Copy membership, reassign the role, then delete the old group. Role-assignable groups restrict membership management to Global Admins and Privileged Role Admins.'
    }
}
catch {
    Add-Setting -Category 'Privileged Group Protection' -Setting 'Groups in privileged role assignments' `
        -CurrentValue "Error: $($_.Exception.Message)" `
        -RecommendedValue 'All role-assigned groups have isAssignableToRole enabled' `
        -Status 'Review' -CheckId 'ENTRA-ROLEGROUP-001' `
        -Remediation 'Ensure Directory.Read.All permission is granted.'
}

# =====================================================================
# CHECK 5: ENTRA-APPS-002 — Overprivileged App Registrations
# =====================================================================
try {
    $dangerousPermissions = @{
        'DeviceManagementConfiguration.ReadWrite.All'              = 'Modify Intune device config'
        'DeviceManagementManagedDevices.ReadWrite.All'             = 'Wipe/retire/manage all devices'
        'DeviceManagementManagedDevices.PrivilegedOperations.All'  = 'Privileged device operations'
        'DeviceManagementRBAC.ReadWrite.All'                       = 'Modify Intune RBAC roles'
        'DeviceManagementApps.ReadWrite.All'                       = 'Deploy/modify apps on devices'
        'DeviceManagementServiceConfig.ReadWrite.All'              = 'Modify Intune service config'
        'RoleManagement.ReadWrite.Directory'                       = 'Modify Entra ID role assignments'
        'AppRoleAssignment.ReadWrite.All'                          = 'Grant itself additional permissions'
        'Directory.ReadWrite.All'                                  = 'Modify all directory objects'
    }
    $graphAppId = '00000003-0000-0000-c000-000000000000'

    $uri = "https://graph.microsoft.com/v1.0/applications?`$select=id,appId,displayName,requiredResourceAccess&`$top=999"
    $response = Invoke-MgGraphRequest -Uri $uri -Method GET -ErrorAction Stop
    $apps = $response.value

    $graphSp = Get-MgServicePrincipal -Filter "appId eq '$graphAppId'" -ErrorAction Stop
    $graphAppRoles = @{}
    foreach ($role in $graphSp.AppRoles) {
        $graphAppRoles[$role.Id] = $role.Value
    }

    $riskyApps = @()
    foreach ($app in $apps) {
        $graphAccess = $app.requiredResourceAccess | Where-Object { $_.resourceAppId -eq $graphAppId }
        if (-not $graphAccess) { continue }

        $dangerousFound = @()
        foreach ($access in $graphAccess.resourceAccess) {
            if ($access.type -ne 'Role') { continue }
            $permName = $graphAppRoles[$access.id]
            if ($permName -and $dangerousPermissions.ContainsKey($permName)) {
                $dangerousFound += $permName
            }
        }

        if ($dangerousFound.Count -gt 0) {
            $riskyApps += "$($app.displayName) (AppId: $($app.appId)) — $($dangerousFound -join ', ')"
        }
    }

    if ($riskyApps.Count -eq 0) {
        Add-Setting -Category 'Application Permissions' -Setting 'Apps with dangerous Intune write permissions' `
            -CurrentValue "No risky apps found ($(@($apps).Count) evaluated)" `
            -RecommendedValue 'No apps with dangerous device management write permissions' `
            -Status 'Pass' -CheckId 'ENTRA-APPS-002' `
            -Remediation 'No action needed. Continue to review app permissions during app registration reviews.'
    }
    else {
        Add-Setting -Category 'Application Permissions' -Setting 'Apps with dangerous Intune write permissions' `
            -CurrentValue "$($riskyApps.Count) risky app(s): $($riskyApps -join '; ')" `
            -RecommendedValue 'No apps with dangerous device management write permissions' `
            -Status 'Fail' -CheckId 'ENTRA-APPS-002' `
            -Remediation 'Review each app in Entra > Applications > App registrations > API permissions. Remove unnecessary write permissions and replace with read-only equivalents. Use Managed Identities where possible.'
    }
}
catch {
    Add-Setting -Category 'Application Permissions' -Setting 'Apps with dangerous Intune write permissions' `
        -CurrentValue "Error: $($_.Exception.Message)" `
        -RecommendedValue 'No apps with dangerous device management write permissions' `
        -Status 'Review' -CheckId 'ENTRA-APPS-002' `
        -Remediation 'Ensure Directory.Read.All permission is granted.'
}

# =====================================================================
# CHECK 6: INTUNE-MAA-001 — Multi-Admin Approval
# =====================================================================
try {
    $uri = "https://graph.microsoft.com/beta/deviceManagement/operationApprovalPolicies"
    $response = Invoke-MgGraphRequest -Uri $uri -Method GET -ErrorAction Stop
    $policies = $response.value

    if ($policies -and $policies.Count -gt 0) {
        $policyDescriptions = @($policies | ForEach-Object {
            $type = if ($_.policyType) { $_.policyType } else { 'Custom' }
            "$type ($($_.approverGroupIds.Count) approver group(s))"
        })
        Add-Setting -Category 'Multi-Admin Approval' -Setting 'Intune Multi-Admin Approval enabled' `
            -CurrentValue "$($policies.Count) policy(ies) configured: $($policyDescriptions -join '; ')" `
            -RecommendedValue 'Multi-Admin Approval enabled for destructive operations' `
            -Status 'Pass' -CheckId 'INTUNE-MAA-001' `
            -Remediation 'No action needed. Review policies periodically to ensure coverage of critical operations.'
    }
    else {
        Add-Setting -Category 'Multi-Admin Approval' -Setting 'Intune Multi-Admin Approval enabled' `
            -CurrentValue 'No Multi-Admin Approval policies configured' `
            -RecommendedValue 'Multi-Admin Approval enabled for destructive operations' `
            -Status 'Fail' -CheckId 'INTUNE-MAA-001' `
            -Remediation 'Enable Multi-Admin Approval in Intune admin center > Tenant administration > Multi-admin approval. Create policies for device wipe/retire, script deployment, app deployment, and role assignment changes.'
    }
}
catch {
    $errorMessage = $_.Exception.Message
    if ($errorMessage -match '404|NotFound') {
        Add-Setting -Category 'Multi-Admin Approval' -Setting 'Intune Multi-Admin Approval enabled' `
            -CurrentValue 'Feature not available (requires Intune Plan 2 or Intune Suite)' `
            -RecommendedValue 'Multi-Admin Approval enabled for destructive operations' `
            -Status 'Review' -CheckId 'INTUNE-MAA-001' `
            -Remediation 'Verify your Intune license includes Multi-Admin Approval (Intune Plan 2 or Intune Suite).'
    }
    else {
        Add-Setting -Category 'Multi-Admin Approval' -Setting 'Intune Multi-Admin Approval enabled' `
            -CurrentValue "Error (Beta API): $errorMessage" `
            -RecommendedValue 'Multi-Admin Approval enabled for destructive operations' `
            -Status 'Review' -CheckId 'INTUNE-MAA-001' `
            -Remediation 'Ensure DeviceManagementConfiguration.Read.All permission is granted. This check uses the Microsoft Graph Beta API.'
    }
}

# =====================================================================
# CHECK 7: INTUNE-RBAC-001 — RBAC Role Assignments Without Scope Tags
# =====================================================================
try {
    $defsUri = "https://graph.microsoft.com/v1.0/deviceManagement/roleDefinitions"
    $defsResponse = Invoke-MgGraphRequest -Uri $defsUri -Method GET -ErrorAction Stop

    $assignments = @()
    foreach ($roleDef in $defsResponse.value) {
        if ($roleDef.isBuiltIn -eq $true -and $roleDef.displayName -eq 'Intune Role Administrator') { continue }
        $assignUri = "https://graph.microsoft.com/v1.0/deviceManagement/roleDefinitions/$($roleDef.id)/roleAssignments"
        try {
            $assignResponse = Invoke-MgGraphRequest -Uri $assignUri -Method GET -ErrorAction Stop
            foreach ($a in $assignResponse.value) {
                $a['_roleName'] = $roleDef.displayName
                $assignments += $a
            }
        }
        catch { Write-Verbose "Could not fetch role assignments for $($roleDef.displayName)" }
    }

    if (-not $assignments -or $assignments.Count -eq 0) {
        Add-Setting -Category 'RBAC Scope Tags' -Setting 'RBAC role assignments without scope tags' `
            -CurrentValue 'No custom RBAC role assignments found' `
            -RecommendedValue 'All role assignments use scope tags' `
            -Status 'Pass' -CheckId 'INTUNE-RBAC-001' `
            -Remediation 'No action needed.'
    }
    else {
        $broadAssignments = @()
        foreach ($assignment in $assignments) {
            $scopeMembers = $assignment.resourceScopes
            $isBroad = (-not $scopeMembers) -or ($scopeMembers.Count -eq 0) -or ($scopeMembers.Count -eq 1 -and $scopeMembers[0] -eq '0')
            if ($isBroad) {
                $roleName = if ($assignment['_roleName']) { $assignment['_roleName'] } else { 'Unknown' }
                $broadAssignments += "$($assignment.displayName) [Role: $roleName]"
            }
        }

        if ($broadAssignments.Count -eq 0) {
            Add-Setting -Category 'RBAC Scope Tags' -Setting 'RBAC role assignments without scope tags' `
                -CurrentValue "All $($assignments.Count) assignment(s) use scope tags" `
                -RecommendedValue 'All role assignments use scope tags' `
                -Status 'Pass' -CheckId 'INTUNE-RBAC-001' `
                -Remediation 'No action needed.'
        }
        else {
            Add-Setting -Category 'RBAC Scope Tags' -Setting 'RBAC role assignments without scope tags' `
                -CurrentValue "$($broadAssignments.Count) of $($assignments.Count) assignment(s) have full tenant scope: $($broadAssignments -join '; ')" `
                -RecommendedValue 'All role assignments use scope tags' `
                -Status 'Fail' -CheckId 'INTUNE-RBAC-001' `
                -Remediation 'Create scope tags in Intune > Tenant administration > Scope (Tags). Assign scope tags to device groups, then edit role assignments to restrict to specific tags instead of Default (full tenant).'
        }
    }
}
catch {
    Add-Setting -Category 'RBAC Scope Tags' -Setting 'RBAC role assignments without scope tags' `
        -CurrentValue "Error: $($_.Exception.Message)" `
        -RecommendedValue 'All role assignments use scope tags' `
        -Status 'Review' -CheckId 'INTUNE-RBAC-001' `
        -Remediation 'Ensure DeviceManagementRBAC.Read.All permission is granted.'
}

# =====================================================================
# CHECK 8: ENTRA-BREAKGLASS-001 — Break-Glass Emergency Access Account
# =====================================================================
try {
    $globalAdminRoleId = '62e90394-69f5-4237-9190-012177145e10'
    $role = Get-MgDirectoryRole -Filter "roleTemplateId eq '$globalAdminRoleId'" -ErrorAction Stop

    if (-not $role) {
        Add-Setting -Category 'Emergency Access' -Setting 'Break-glass emergency access account' `
            -CurrentValue 'Global Administrator role not activated' `
            -RecommendedValue 'At least 1 break-glass account with Global Admin role' `
            -Status 'Fail' -CheckId 'ENTRA-BREAKGLASS-001' `
            -Remediation 'Create break-glass emergency access accounts with the Global Administrator role.'
    }
    else {
        $members = Get-MgDirectoryRoleMemberAsUser -DirectoryRoleId $role.Id -All -ErrorAction Stop
        $detectedAccounts = @()
        $confidenceLevel = 'None'

        # Method 1: Name pattern matching (high confidence)
        foreach ($member in $members) {
            foreach ($pattern in $breakGlassPatterns) {
                if ($member.DisplayName -match $pattern -or $member.UserPrincipalName -match $pattern) {
                    $detectedAccounts += "$($member.DisplayName) ($($member.UserPrincipalName)) [name match]"
                    $confidenceLevel = 'High'
                    break
                }
            }
        }

        # Method 2: CA exclusion pattern (medium confidence fallback)
        if ($detectedAccounts.Count -eq 0) {
            $caPolicies = Get-MgIdentityConditionalAccessPolicy -All -ErrorAction SilentlyContinue
            $enabledCaPolicies = @($caPolicies | Where-Object { $_.State -eq 'enabled' })
            $excludedUserIds = @()
            foreach ($policy in $enabledCaPolicies) {
                if ($policy.Conditions.Users.ExcludeUsers) {
                    $excludedUserIds += $policy.Conditions.Users.ExcludeUsers
                }
            }
            $globalAdminIds = @($members | Select-Object -ExpandProperty Id)
            $excludedAdmins = @($excludedUserIds | Where-Object { $_ -in $globalAdminIds } | Select-Object -Unique)

            if ($excludedAdmins.Count -gt 0) {
                foreach ($adminId in $excludedAdmins) {
                    $admin = $members | Where-Object { $_.Id -eq $adminId }
                    if ($admin) {
                        $detectedAccounts += "$($admin.DisplayName) ($($admin.UserPrincipalName)) [CA exclusion pattern]"
                        $confidenceLevel = 'Medium'
                    }
                }
            }
        }

        if ($detectedAccounts.Count -gt 0) {
            $status = if ($confidenceLevel -eq 'High') { 'Pass' } else { 'Warning' }
            Add-Setting -Category 'Emergency Access' -Setting 'Break-glass emergency access account' `
                -CurrentValue "$($detectedAccounts.Count) account(s) detected (confidence: $confidenceLevel): $($detectedAccounts -join '; ')" `
                -RecommendedValue 'At least 1 break-glass account with Global Admin role' `
                -Status $status -CheckId 'ENTRA-BREAKGLASS-001' `
                -Remediation $(if ($status -eq 'Pass') { 'No action needed. Ensure break-glass accounts are excluded from all CA policies, monitored for sign-in activity, and tested quarterly.' } else { 'Verify detected account(s) are intentional break-glass accounts. Consider renaming to clearly identify them.' })
        }
        else {
            Add-Setting -Category 'Emergency Access' -Setting 'Break-glass emergency access account' `
                -CurrentValue 'No break-glass account detected among Global Admins' `
                -RecommendedValue 'At least 1 break-glass account with Global Admin role' `
                -Status 'Fail' -CheckId 'ENTRA-BREAKGLASS-001' `
                -Remediation 'Create 2 cloud-only break-glass accounts (e.g., BreakGlass-Admin-01@contoso.onmicrosoft.com) with Global Admin role, FIDO2 security keys, excluded from all CA policies, and monitored for sign-in activity.'
        }
    }
}
catch {
    Add-Setting -Category 'Emergency Access' -Setting 'Break-glass emergency access account' `
        -CurrentValue "Error: $($_.Exception.Message)" `
        -RecommendedValue 'At least 1 break-glass account with Global Admin role' `
        -Status 'Review' -CheckId 'ENTRA-BREAKGLASS-001' `
        -Remediation 'Ensure Directory.Read.All and Policy.Read.All permissions are granted.'
}

# =====================================================================
# CHECK 9: INTUNE-WIPEAUDIT-001 — Mass Device Wipe Activity
# =====================================================================
try {
    $failThreshold = 10
    $warnThreshold = 5
    $lookbackDays = 30
    $startDate = (Get-Date).ToUniversalTime().AddDays(-$lookbackDays).ToString('yyyy-MM-ddTHH:mm:ssZ')

    $uri = "https://graph.microsoft.com/v1.0/deviceManagement/auditEvents?`$filter=activityDateTime ge $startDate and (activityType eq 'Wipe' or activityType eq 'Retire' or activityType eq 'Delete')&`$orderby=activityDateTime desc&`$top=500"
    $response = Invoke-MgGraphRequest -Uri $uri -Method GET -ErrorAction Stop
    $wipeEvents = $response.value

    if (-not $wipeEvents -or $wipeEvents.Count -eq 0) {
        Add-Setting -Category 'Device Wipe Audit' -Setting 'Mass device wipe activity (30 days)' `
            -CurrentValue "No wipe/retire/delete actions in last $lookbackDays days" `
            -RecommendedValue 'No suspicious burst wipe patterns' `
            -Status 'Pass' -CheckId 'INTUNE-WIPEAUDIT-001' `
            -Remediation 'No action needed.'
    }
    else {
        # Analyze for burst patterns (sliding 24-hour window)
        $sortedEvents = @($wipeEvents | Sort-Object { $_.activityDateTime })
        $maxBurstCount = 0
        $burstWindow = $null

        for ($i = 0; $i -lt $sortedEvents.Count; $i++) {
            $windowStart = [datetime]$sortedEvents[$i].activityDateTime
            $windowEnd = $windowStart.AddHours(24)
            $windowCount = ($sortedEvents | Where-Object {
                [datetime]$_.activityDateTime -ge $windowStart -and [datetime]$_.activityDateTime -le $windowEnd
            } | Measure-Object).Count
            if ($windowCount -gt $maxBurstCount) {
                $maxBurstCount = $windowCount
                $burstWindow = $windowStart.ToString('yyyy-MM-dd')
            }
        }

        $summary = "Total: $($wipeEvents.Count) events, Peak 24h burst: $maxBurstCount"
        if ($burstWindow) { $summary += " (on $burstWindow)" }

        if ($maxBurstCount -ge $failThreshold) {
            Add-Setting -Category 'Device Wipe Audit' -Setting 'Mass device wipe activity (30 days)' `
                -CurrentValue "ALERT: $maxBurstCount wipe/retire/delete actions in 24h window on $burstWindow. $summary" `
                -RecommendedValue 'No suspicious burst wipe patterns' `
                -Status 'Fail' -CheckId 'INTUNE-WIPEAUDIT-001' `
                -Remediation 'IMMEDIATE: Identify the actor in Intune > Tenant admin > Audit logs. Disable the account and revoke sessions in Entra. Assess scope of affected devices. Check for persistence (scripts, config changes). Contact Microsoft Support (Severity A).'
        }
        elseif ($maxBurstCount -ge $warnThreshold) {
            Add-Setting -Category 'Device Wipe Audit' -Setting 'Mass device wipe activity (30 days)' `
                -CurrentValue "$maxBurstCount wipe/retire/delete actions in 24h window on $burstWindow (elevated but may be legitimate). $summary" `
                -RecommendedValue 'No suspicious burst wipe patterns' `
                -Status 'Warning' -CheckId 'INTUNE-WIPEAUDIT-001' `
                -Remediation 'Review audit logs to confirm wipes were part of documented processes (device refresh, offboarding). If unexplained, investigate as potential compromise.'
        }
        else {
            Add-Setting -Category 'Device Wipe Audit' -Setting 'Mass device wipe activity (30 days)' `
                -CurrentValue "$($wipeEvents.Count) action(s) found, no suspicious burst patterns (peak: $maxBurstCount in 24h). $summary" `
                -RecommendedValue 'No suspicious burst wipe patterns' `
                -Status 'Pass' -CheckId 'INTUNE-WIPEAUDIT-001' `
                -Remediation 'No action needed. Continue monitoring audit logs.'
        }
    }
}
catch {
    Add-Setting -Category 'Device Wipe Audit' -Setting 'Mass device wipe activity (30 days)' `
        -CurrentValue "Error: $($_.Exception.Message)" `
        -RecommendedValue 'No suspicious burst wipe patterns' `
        -Status 'Review' -CheckId 'INTUNE-WIPEAUDIT-001' `
        -Remediation 'Ensure DeviceManagementApps.Read.All permission is granted for the Intune audit events endpoint.'
}

# ── Export results ───────────────────────────────────────────────────
$report = @($settings)
Write-Verbose "Collected $($report.Count) Stryker Incident Readiness settings"

if ($OutputPath) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported Stryker Incident Readiness ($($report.Count) settings) to $OutputPath"
}
else {
    Write-Output $report
}
