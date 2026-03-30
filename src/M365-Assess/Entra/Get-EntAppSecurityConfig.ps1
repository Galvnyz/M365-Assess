<#
.SYNOPSIS
    Evaluates enterprise application and service principal security posture in Entra ID.
.DESCRIPTION
    Queries Microsoft Graph for service principals, their credentials, application role
    assignments, delegated permissions, and managed identity configurations. Identifies
    risky permission patterns including foreign apps with dangerous permissions, stale
    credentials, excessive permission counts, and managed identity over-provisioning.

    Requires an active Microsoft Graph connection with Application.Read.All,
    Directory.Read.All permissions (read-only, already in Identity scope).
.PARAMETER OutputPath
    Optional path to export results as CSV. If not specified, results are returned to the pipeline.
.EXAMPLE
    PS> . .\Common\Connect-Service.ps1
    PS> Connect-Service -Service Graph
    PS> .\Entra\Get-EntAppSecurityConfig.ps1

    Displays enterprise app security configuration results.
.EXAMPLE
    PS> .\Entra\Get-EntAppSecurityConfig.ps1 -OutputPath '.\entapp-security-config.csv'

    Exports the enterprise app security config to CSV.
.NOTES
    Author:  Daren9m
    Checks inspired by EntraFalcon (Compass Security) enterprise app audit patterns.
#>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath
)

# Continue on errors: enterprise app checks span multiple Graph endpoints and
# partial results are more useful than aborting on the first inaccessible API.
$ErrorActionPreference = 'Continue'

# Verify Graph connection
if (-not (Assert-GraphConnection)) { return }

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

# ------------------------------------------------------------------
# Dangerous permissions constants
# ------------------------------------------------------------------
$dangerousAppPermissions = @(
    'RoleManagement.ReadWrite.Directory'
    'AppRoleAssignment.ReadWrite.All'
    'Application.ReadWrite.All'
    'Directory.ReadWrite.All'
    'Mail.ReadWrite'
    'Mail.Send'
    'Files.ReadWrite.All'
    'Sites.FullControl.All'
    'User.ReadWrite.All'
    'Group.ReadWrite.All'
)

$dangerousDelegatedPermissions = @(
    'Directory.ReadWrite.All'
    'RoleManagement.ReadWrite.Directory'
    'Mail.ReadWrite'
    'Files.ReadWrite.All'
)

# ------------------------------------------------------------------
# Fetch tenant organization ID for foreign app detection
# ------------------------------------------------------------------
$tenantId = $null
try {
    $orgResponse = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/organization' -ErrorAction Stop
    if ($orgResponse -and $orgResponse['value'] -and $orgResponse['value'].Count -gt 0) {
        $tenantId = $orgResponse['value'][0]['id']
    }
}
catch {
    Write-Warning "Could not fetch organization ID: $_"
}

# ------------------------------------------------------------------
# Fetch all service principals
# ------------------------------------------------------------------
$allServicePrincipals = @()
try {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Write-Verbose "Fetching service principals..."
    $spUri = '/v1.0/servicePrincipals?$select=id,appId,displayName,appOwnerOrganizationId,servicePrincipalType,keyCredentials,passwordCredentials,accountEnabled&$top=999'
    $spResponse = Invoke-MgGraphRequest -Method GET -Uri $spUri -ErrorAction Stop
    $allServicePrincipals = if ($spResponse -and $spResponse['value']) { @($spResponse['value']) } else { @() }

    $nextLink = $spResponse['@odata.nextLink']
    while ($nextLink) {
        $spResponse = Invoke-MgGraphRequest -Method GET -Uri $nextLink -ErrorAction Stop
        if ($spResponse -and $spResponse['value']) {
            $allServicePrincipals += @($spResponse['value'])
        }
        $nextLink = $spResponse['@odata.nextLink']
    }
    $sw.Stop()
    Write-Verbose "Fetched $($allServicePrincipals.Count) service principals in $($sw.Elapsed.TotalSeconds.ToString('F1'))s"
}
catch {
    Write-Warning "Could not fetch service principals: $_"
}

# Separate regular apps from managed identities
$regularApps = @($allServicePrincipals | Where-Object { $_['servicePrincipalType'] -ne 'ManagedIdentity' })
$managedIdentities = @($allServicePrincipals | Where-Object { $_['servicePrincipalType'] -eq 'ManagedIdentity' })

# ------------------------------------------------------------------
# Fetch role assignments for all SPs (directory roles)
# ------------------------------------------------------------------
$spRoleAssignments = @{}
try {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Write-Verbose "Fetching directory role assignments for service principals..."
    $roleAssignUri = '/v1.0/roleManagement/directory/roleAssignments?$top=999'
    $roleResponse = Invoke-MgGraphRequest -Method GET -Uri $roleAssignUri -ErrorAction Stop
    $allRoleAssignments = if ($roleResponse -and $roleResponse['value']) { @($roleResponse['value']) } else { @() }

    $nextLink = $roleResponse['@odata.nextLink']
    while ($nextLink) {
        $roleResponse = Invoke-MgGraphRequest -Method GET -Uri $nextLink -ErrorAction Stop
        if ($roleResponse -and $roleResponse['value']) {
            $allRoleAssignments += @($roleResponse['value'])
        }
        $nextLink = $roleResponse['@odata.nextLink']
    }

    foreach ($assignment in $allRoleAssignments) {
        $principalId = $assignment['principalId']
        if (-not $spRoleAssignments.ContainsKey($principalId)) {
            $spRoleAssignments[$principalId] = @()
        }
        $spRoleAssignments[$principalId] += $assignment
    }
}
catch {
    Write-Warning "Could not fetch role assignments: $_"
}

# ------------------------------------------------------------------
# Build a lookup of well-known Graph permission IDs to names
# ------------------------------------------------------------------
$graphPermissionMap = @{}
try {
    Write-Verbose "Fetching Microsoft Graph service principal for permission mapping..."
    $graphSpUri = "/v1.0/servicePrincipals?`$filter=appId eq '00000003-0000-0000-c000-000000000000'&`$select=id,appRoles,oauth2PermissionScopes"
    $graphSp = Invoke-MgGraphRequest -Method GET -Uri $graphSpUri -ErrorAction Stop
    $graphSpValue = if ($graphSp -and $graphSp['value'] -and $graphSp['value'].Count -gt 0) { $graphSp['value'][0] } else { $null }
    if ($graphSpValue) {
        foreach ($role in $graphSpValue['appRoles']) {
            $graphPermissionMap[$role['id']] = @{ Name = $role['value']; Type = 'Application' }
        }
        foreach ($scope in $graphSpValue['oauth2PermissionScopes']) {
            $graphPermissionMap[$scope['id']] = @{ Name = $scope['value']; Type = 'Delegated' }
        }
    }
}
catch {
    Write-Warning "Could not fetch Graph permission definitions: $_"
}

# ------------------------------------------------------------------
# Bulk-fetch oauth2PermissionGrants (tenant-wide, single fast query)
# ------------------------------------------------------------------
$spOAuth2Map = @{}
try {
    Write-Verbose "Bulk-fetching oauth2 permission grants..."
    $oauthUri = '/v1.0/oauth2PermissionGrants?$top=999'
    $oauthResponse = Invoke-MgGraphRequest -Method GET -Uri $oauthUri -ErrorAction Stop
    $allOAuth2 = if ($oauthResponse -and $oauthResponse['value']) { @($oauthResponse['value']) } else { @() }

    $nextLink = $oauthResponse['@odata.nextLink']
    while ($nextLink) {
        $oauthResponse = Invoke-MgGraphRequest -Method GET -Uri $nextLink -ErrorAction Stop
        if ($oauthResponse -and $oauthResponse['value']) {
            $allOAuth2 += @($oauthResponse['value'])
        }
        $nextLink = $oauthResponse['@odata.nextLink']
    }

    foreach ($grant in $allOAuth2) {
        $grantClientId = $grant['clientId']
        if (-not $spOAuth2Map.ContainsKey($grantClientId)) { $spOAuth2Map[$grantClientId] = @() }
        $spOAuth2Map[$grantClientId] += $grant
    }
    Write-Verbose "Indexed oauth2 grants for $($spOAuth2Map.Keys.Count) principals"
}
catch {
    Write-Warning "Could not bulk-fetch oauth2 grants: $_"
}

# ------------------------------------------------------------------
# Bulk-fetch appRoleAssignments from the RESOURCE side (fast)
# Instead of querying each SP's appRoleAssignments (N calls), we query
# the Microsoft Graph SP's appRoleAssignedTo — this returns ALL grants
# to Graph permissions across all SPs in one paginated call.
# ------------------------------------------------------------------
$spAppRoleMap = @{}
try {
    Write-Verbose "Bulk-fetching app role assignments from Graph resource SP..."
    $graphSpIdValue = $graphSpValue['id']
    if ($graphSpIdValue) {
        $araUri = "/v1.0/servicePrincipals/$graphSpIdValue/appRoleAssignedTo?`$top=999"
        $araResponse = Invoke-MgGraphRequest -Method GET -Uri $araUri -ErrorAction Stop
        $allAssigned = if ($araResponse -and $araResponse['value']) { @($araResponse['value']) } else { @() }

        $nextLink = $araResponse['@odata.nextLink']
        while ($nextLink) {
            $araResponse = Invoke-MgGraphRequest -Method GET -Uri $nextLink -ErrorAction Stop
            if ($araResponse -and $araResponse['value']) {
                $allAssigned += @($araResponse['value'])
            }
            $nextLink = $araResponse['@odata.nextLink']
        }

        foreach ($a in $allAssigned) {
            $principalId = $a['principalId']
            if (-not $spAppRoleMap.ContainsKey($principalId)) { $spAppRoleMap[$principalId] = @() }
            $spAppRoleMap[$principalId] += $a
        }
        Write-Verbose "Indexed $($allAssigned.Count) Graph app role assignments across $($spAppRoleMap.Keys.Count) principals"
    }
}
catch {
    Write-Warning "Could not bulk-fetch app role assignments: $_"
}

# ------------------------------------------------------------------
# Helpers: look up cached permission data (zero API calls per check)
# ------------------------------------------------------------------
function Get-SpAppRoleAssignments {
    param([string]$SpId)
    if ($spAppRoleMap.ContainsKey($SpId)) { return @($spAppRoleMap[$SpId]) }
    return @()
}

function Get-SpOAuth2Grants {
    param([string]$SpId)
    if ($spOAuth2Map.ContainsKey($SpId)) { return @($spOAuth2Map[$SpId]) }
    return @()
}

# ------------------------------------------------------------------
# 1. ENTRA-ENTAPP-001: Enabled apps with client credentials
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking enabled apps with client credentials..."
    $appsWithCreds = @($regularApps | Where-Object {
        $_['accountEnabled'] -eq $true -and
        (($_['keyCredentials'] -and @($_['keyCredentials']).Count -gt 0) -or
         ($_['passwordCredentials'] -and @($_['passwordCredentials']).Count -gt 0))
    })

    $settingParams = @{
        Category         = 'Enterprise Applications'
        Setting          = 'Apps with Client Credentials'
        CurrentValue     = "$($appsWithCreds.Count) enabled app(s) have secrets or certificates"
        RecommendedValue = 'Review all apps with credentials; remove unused'
        Status           = $(if ($appsWithCreds.Count -eq 0) { 'Pass' } elseif ($appsWithCreds.Count -le 10) { 'Info' } else { 'Warning' })
        CheckId          = 'ENTRA-ENTAPP-001'
        Remediation      = 'Entra admin center > Enterprise applications > review each app with credentials. Remove secrets/certificates from apps that no longer need them.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check apps with credentials: $_"
}

# ------------------------------------------------------------------
# 2. ENTRA-ENTAPP-002: Inactive apps with credentials (no sign-in > 90 days)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking inactive apps with credentials..."
    $cutoffDate = (Get-Date).AddDays(-90).ToString('yyyy-MM-ddTHH:mm:ssZ')
    $inactiveWithCreds = @()

    # Fetch signInActivity only for the small subset with credentials (avoids
    # the 60-120s penalty of including signInActivity in the bulk SP query)
    foreach ($sp in $appsWithCreds) {
        try {
            $signInUri = "/v1.0/servicePrincipals/$($sp['id'])?`$select=signInActivity"
            $signInData = Invoke-MgGraphRequest -Method GET -Uri $signInUri -ErrorAction Stop
            $lastSignIn = $signInData['signInActivity']['lastSignInDateTime']
            if (-not $lastSignIn -or $lastSignIn -lt $cutoffDate) {
                $inactiveWithCreds += $sp['displayName']
            }
        }
        catch {
            Write-Verbose "signInActivity not available for $($sp['displayName'])"
        }
    }

    $settingParams = @{
        Category         = 'Enterprise Applications'
        Setting          = 'Inactive Apps with Credentials'
        CurrentValue     = $(if ($inactiveWithCreds.Count -eq 0) { 'No inactive apps with credentials found' } else { "$($inactiveWithCreds.Count) app(s) inactive > 90 days with credentials" })
        RecommendedValue = 'Remove credentials from inactive apps'
        Status           = $(if ($inactiveWithCreds.Count -eq 0) { 'Pass' } else { 'Fail' })
        CheckId          = 'ENTRA-ENTAPP-002'
        Remediation      = 'Review the following inactive apps and remove their credentials or disable them: Entra admin center > Enterprise applications > filter by last sign-in > remove secrets/certificates.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check inactive app credentials: $_"
}


# ------------------------------------------------------------------
# Identify foreign apps (appOwnerOrganizationId != tenant ID)
# ------------------------------------------------------------------
$foreignApps = @()
if ($tenantId) {
    $foreignApps = @($regularApps | Where-Object {
        $_['appOwnerOrganizationId'] -and $_['appOwnerOrganizationId'] -ne $tenantId -and
        $_['accountEnabled'] -eq $true
    })
}

# ------------------------------------------------------------------
# 3. ENTRA-ENTAPP-003: Foreign apps with dangerous application permissions
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking foreign apps with dangerous application permissions..."
    $foreignDangerousApp = @()

    foreach ($sp in $foreignApps) {
        $appRoles = Get-SpAppRoleAssignments -SpId $sp['id']
        foreach ($role in $appRoles) {
            $permId = $role['appRoleId']
            if ($permId -and $graphPermissionMap.ContainsKey($permId)) {
                $permName = $graphPermissionMap[$permId].Name
                if ($permName -in $dangerousAppPermissions) {
                    $foreignDangerousApp += "$($sp['displayName']): $permName"
                }
            }
        }
    }

    $settingParams = @{
        Category         = 'Enterprise Applications'
        Setting          = 'Foreign Apps with Dangerous App Permissions'
        CurrentValue     = $(if ($foreignDangerousApp.Count -eq 0) { 'No foreign apps with dangerous application permissions' } else { "$($foreignDangerousApp.Count) finding(s): $($foreignDangerousApp -join '; ')" })
        RecommendedValue = 'No foreign apps should hold dangerous application permissions'
        Status           = $(if ($foreignDangerousApp.Count -eq 0) { 'Pass' } else { 'Fail' })
        CheckId          = 'ENTRA-ENTAPP-003'
        Remediation      = 'Entra admin center > Enterprise applications > review foreign apps with high-privilege application permissions. Remove permissions or replace with first-party alternatives.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check foreign app permissions: $_"
}

# ------------------------------------------------------------------
# 4. ENTRA-ENTAPP-004: Foreign apps with dangerous delegated permissions
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking foreign apps with dangerous delegated permissions..."
    $foreignDangerousDelegated = @()

    foreach ($sp in $foreignApps) {
        $grants = Get-SpOAuth2Grants -SpId $sp['id']
        foreach ($grant in $grants) {
            $scopes = if ($grant['scope']) { $grant['scope'] -split '\s+' } else { @() }
            foreach ($scope in $scopes) {
                if ($scope -in $dangerousDelegatedPermissions) {
                    $foreignDangerousDelegated += "$($sp['displayName']): $scope"
                }
            }
        }
    }

    $settingParams = @{
        Category         = 'Enterprise Applications'
        Setting          = 'Foreign Apps with Dangerous Delegated Permissions'
        CurrentValue     = $(if ($foreignDangerousDelegated.Count -eq 0) { 'No foreign apps with dangerous delegated permissions' } else { "$($foreignDangerousDelegated.Count) finding(s): $($foreignDangerousDelegated -join '; ')" })
        RecommendedValue = 'No foreign apps should hold dangerous delegated permissions'
        Status           = $(if ($foreignDangerousDelegated.Count -eq 0) { 'Pass' } else { 'Fail' })
        CheckId          = 'ENTRA-ENTAPP-004'
        Remediation      = 'Entra admin center > Enterprise applications > review foreign apps with high-privilege delegated permissions. Revoke admin consent or remove the app.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check foreign app delegated permissions: $_"
}

# ------------------------------------------------------------------
# 5. ENTRA-ENTAPP-005: Foreign apps with Entra directory roles
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking foreign apps with directory roles..."
    $foreignWithRoles = @()

    foreach ($sp in $foreignApps) {
        if ($spRoleAssignments.ContainsKey($sp['id'])) {
            $roles = $spRoleAssignments[$sp['id']]
            $foreignWithRoles += "$($sp['displayName']) ($($roles.Count) role(s))"
        }
    }

    $settingParams = @{
        Category         = 'Enterprise Applications'
        Setting          = 'Foreign Apps with Directory Roles'
        CurrentValue     = $(if ($foreignWithRoles.Count -eq 0) { 'No foreign apps hold directory roles' } else { "$($foreignWithRoles.Count) foreign app(s) with roles: $($foreignWithRoles -join '; ')" })
        RecommendedValue = 'No foreign apps should hold Entra directory roles'
        Status           = $(if ($foreignWithRoles.Count -eq 0) { 'Pass' } else { 'Fail' })
        CheckId          = 'ENTRA-ENTAPP-005'
        Remediation      = 'Entra admin center > Roles and administrators > review roles assigned to foreign service principals. Remove role assignments from untrusted external apps.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check foreign app directory roles: $_"
}

# ------------------------------------------------------------------
# 6. ENTRA-ENTAPP-006: Apps with excessive permission count (>10 app permissions)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking apps with excessive permissions..."
    $excessivePerms = @()

    foreach ($sp in $regularApps | Where-Object { $_['accountEnabled'] -eq $true }) {
        $appRoles = Get-SpAppRoleAssignments -SpId $sp['id']
        if ($appRoles.Count -gt 10) {
            $excessivePerms += "$($sp['displayName']) ($($appRoles.Count) permissions)"
        }
    }

    $settingParams = @{
        Category         = 'Enterprise Applications'
        Setting          = 'Apps with Excessive Permissions'
        CurrentValue     = $(if ($excessivePerms.Count -eq 0) { 'No apps with > 10 application permissions' } else { "$($excessivePerms.Count) app(s): $($excessivePerms -join '; ')" })
        RecommendedValue = 'Apps should follow least-privilege (max 10 app permissions)'
        Status           = $(if ($excessivePerms.Count -eq 0) { 'Pass' } else { 'Warning' })
        CheckId          = 'ENTRA-ENTAPP-006'
        Remediation      = 'Review apps with > 10 application permissions. Remove unnecessary permissions to follow least-privilege. Entra admin center > App registrations > [app] > API permissions.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check excessive app permissions: $_"
}

# ------------------------------------------------------------------
# 7. ENTRA-ENTAPP-007: App instance property lock not enabled
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking app instance property lock..."
    # Check for tenant-default app management policy
    $defaultPolicy = $null
    try {
        $defaultPolicy = Invoke-MgGraphRequest -Method GET -Uri '/v1.0/policies/defaultAppManagementPolicy' -ErrorAction Stop
    }
    catch { Write-Verbose "Default app management policy not available" }

    $lockEnabled = $false
    if ($defaultPolicy -and $defaultPolicy['isEnabled'] -eq $true) {
        $lockEnabled = $true
    }

    $settingParams = @{
        Category         = 'Enterprise Applications'
        Setting          = 'App Instance Property Lock'
        CurrentValue     = $(if ($lockEnabled) { 'Default app management policy enabled' } else { 'No default app management policy or disabled' })
        RecommendedValue = 'App management policy enabled to prevent property modifications by app owners'
        Status           = $(if ($lockEnabled) { 'Pass' } else { 'Info' })
        CheckId          = 'ENTRA-ENTAPP-007'
        Remediation      = 'Entra admin center > Applications > App management policies > configure a default policy to lock sensitive properties on multi-tenant apps.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check app instance property lock: $_"
}

# ------------------------------------------------------------------
# 8. ENTRA-ENTAPP-008: Managed identities with dangerous application permissions
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking managed identity application permissions..."
    $miDangerousPerms = @()

    foreach ($mi in $managedIdentities) {
        $appRoles = Get-SpAppRoleAssignments -SpId $mi['id']
        foreach ($role in $appRoles) {
            $permId = $role['appRoleId']
            if ($permId -and $graphPermissionMap.ContainsKey($permId)) {
                $permName = $graphPermissionMap[$permId].Name
                if ($permName -in $dangerousAppPermissions) {
                    $miDangerousPerms += "$($mi['displayName']): $permName"
                }
            }
        }
    }

    $settingParams = @{
        Category         = 'Managed Identities'
        Setting          = 'Managed Identities with Dangerous Permissions'
        CurrentValue     = $(if ($miDangerousPerms.Count -eq 0) { 'No managed identities with dangerous permissions' } else { "$($miDangerousPerms.Count) finding(s): $($miDangerousPerms -join '; ')" })
        RecommendedValue = 'Managed identities should follow least-privilege'
        Status           = $(if ($miDangerousPerms.Count -eq 0) { 'Pass' } else { 'Fail' })
        CheckId          = 'ENTRA-ENTAPP-008'
        Remediation      = 'Review managed identity permissions. Use narrower permissions (e.g., Mail.Read instead of Mail.ReadWrite). Azure portal > Managed Identity > API permissions.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check managed identity permissions: $_"
}

# ------------------------------------------------------------------
# 9. ENTRA-ENTAPP-009: Managed identities with Entra directory roles
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking managed identity directory roles..."
    $miWithRoles = @()

    foreach ($mi in $managedIdentities) {
        if ($spRoleAssignments.ContainsKey($mi['id'])) {
            $roles = $spRoleAssignments[$mi['id']]
            $miWithRoles += "$($mi['displayName']) ($($roles.Count) role(s))"
        }
    }

    $settingParams = @{
        Category         = 'Managed Identities'
        Setting          = 'Managed Identities with Directory Roles'
        CurrentValue     = $(if ($miWithRoles.Count -eq 0) { 'No managed identities hold directory roles' } else { "$($miWithRoles.Count) managed identity/ies with roles: $($miWithRoles -join '; ')" })
        RecommendedValue = 'Managed identities should not hold Entra directory roles'
        Status           = $(if ($miWithRoles.Count -eq 0) { 'Pass' } else { 'Warning' })
        CheckId          = 'ENTRA-ENTAPP-009'
        Remediation      = 'Review managed identities with directory roles. Use Graph API permissions instead of directory roles where possible. Entra admin center > Roles and administrators.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check managed identity directory roles: $_"
}

# ------------------------------------------------------------------
# Output results
# ------------------------------------------------------------------
$report = @($settings)
Write-Verbose "Collected $($report.Count) enterprise app security configuration settings"

if ($OutputPath) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Output "Exported enterprise app security config ($($report.Count) settings) to $OutputPath"
}
else {
    Write-Output $report
}
