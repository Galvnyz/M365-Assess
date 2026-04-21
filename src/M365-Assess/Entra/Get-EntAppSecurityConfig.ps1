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

# Load shared security-config helpers
$_scriptDir = if ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { $PSScriptRoot }
. (Join-Path -Path $_scriptDir -ChildPath '..\Common\SecurityConfigHelper.ps1')

$ctx = Initialize-SecurityConfig
$settings = $ctx.Settings
$checkIdCounter = $ctx.CheckIdCounter

function Add-Setting {
    param(
        [string]$Category, [string]$Setting, [string]$CurrentValue,
        [string]$RecommendedValue, [string]$Status,
        [string]$CheckId = '', [string]$Remediation = '',
        [PSCustomObject]$Evidence = $null
    )
    $p = @{
        Settings         = $settings
        CheckIdCounter   = $checkIdCounter
        Category         = $Category
        Setting          = $Setting
        CurrentValue     = $CurrentValue
        RecommendedValue = $RecommendedValue
        Status           = $Status
        CheckId          = $CheckId
        Remediation      = $Remediation
        Evidence         = $Evidence
    }
    Add-SecuritySetting @p
}

# ------------------------------------------------------------------
# Dangerous permissions -- loaded from tiered classification file
# ------------------------------------------------------------------
$_controlsPath = Join-Path -Path (Split-Path -Parent $_scriptDir) -ChildPath 'controls'
$_tier0Path = Join-Path -Path $_controlsPath -ChildPath 'tier0-permissions.json'
$_tierData = $null
if (Test-Path -Path $_tier0Path) {
    $_tierData = Get-Content -Path $_tier0Path -Raw | ConvertFrom-Json
}

# Tier 0: Global Admin escalation paths (41 permissions)
$tier0AppPermissions = if ($_tierData) {
    @($_tierData.permissions | ForEach-Object { $_.permission })
} else {
    @('RoleManagement.ReadWrite.Directory', 'AppRoleAssignment.ReadWrite.All', 'Application.ReadWrite.All',
      'Directory.ReadWrite.All', 'User.ReadWrite.All', 'Group.ReadWrite.All')
}

# Tier 1: High-impact data access (no escalation path)
$tier1AppPermissions = if ($_tierData) {
    @($_tierData.tier1DataAccess)
} else {
    @('Mail.ReadWrite', 'Mail.Send', 'Files.ReadWrite.All', 'Sites.FullControl.All')
}

# Combined list for backward-compatible checks
$dangerousAppPermissions = $tier0AppPermissions + $tier1AppPermissions

$dangerousDelegatedPermissions = @(
    'Directory.ReadWrite.All'
    'RoleManagement.ReadWrite.Directory'
    'Mail.ReadWrite'
    'Files.ReadWrite.All'
    'User.ReadWrite.All'
    'AppRoleAssignment.ReadWrite.All'
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
# Fetch app registrations (for redirect URIs, signInAudience)
# ------------------------------------------------------------------
$allAppRegistrations = @()
try {
    Write-Verbose "Fetching app registrations..."
    $appUri = "/v1.0/applications?`$select=id,appId,displayName,signInAudience,web,spa,publicClient&`$top=999"
    $appResponse = Invoke-MgGraphRequest -Method GET -Uri $appUri -ErrorAction Stop
    $allAppRegistrations = if ($appResponse -and $appResponse['value']) { @($appResponse['value']) } else { @() }

    $nextLink = $appResponse['@odata.nextLink']
    while ($nextLink) {
        $appResponse = Invoke-MgGraphRequest -Method GET -Uri $nextLink -ErrorAction Stop
        if ($appResponse -and $appResponse['value']) {
            $allAppRegistrations += @($appResponse['value'])
        }
        $nextLink = $appResponse['@odata.nextLink']
    }
    Write-Verbose "Fetched $($allAppRegistrations.Count) app registrations"
}
catch {
    Write-Warning "Could not fetch app registrations: $_"
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
# 3. ENTRA-ENTAPP-003: Foreign apps with Tier 0 application permissions
#    (Global Admin escalation paths)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking foreign apps with Tier 0 application permissions..."
    $foreignTier0 = @()
    $foreignTier1 = @()

    foreach ($sp in $foreignApps) {
        $appRoles = Get-SpAppRoleAssignments -SpId $sp['id']
        foreach ($role in $appRoles) {
            $permId = $role['appRoleId']
            if ($permId -and $graphPermissionMap.ContainsKey($permId)) {
                $permName = $graphPermissionMap[$permId].Name
                if ($permName -in $tier0AppPermissions) {
                    $foreignTier0 += "$($sp['displayName']): $permName"
                }
                elseif ($permName -in $tier1AppPermissions) {
                    $foreignTier1 += "$($sp['displayName']): $permName"
                }
            }
        }
    }

    # Tier 0 findings (Critical -- escalation paths)
    $settingParams = @{
        Category         = 'Enterprise Applications'
        Setting          = 'Foreign Apps with Tier 0 Permissions (GA Escalation)'
        CurrentValue     = $(if ($foreignTier0.Count -eq 0) { 'No foreign apps with Tier 0 permissions' } else { "$($foreignTier0.Count) finding(s): $($foreignTier0 -join '; ')" })
        RecommendedValue = 'No foreign apps should hold Tier 0 (Global Admin escalation) permissions'
        Status           = $(if ($foreignTier0.Count -eq 0) { 'Pass' } else { 'Fail' })
        CheckId          = 'ENTRA-ENTAPP-003'
        Remediation      = 'Entra admin center > Enterprise applications > review foreign apps with Tier 0 permissions. These permissions have documented attack paths to Global Administrator. Remove or replace with least-privilege alternatives.'
        Evidence         = [PSCustomObject]@{ Findings = @($foreignTier0); Count = $foreignTier0.Count }
    }
    Add-Setting @settingParams

    # Tier 1 findings (High -- data access risk)
    $settingParams = @{
        Category         = 'Enterprise Applications'
        Setting          = 'Foreign Apps with Tier 1 Permissions (Data Access)'
        CurrentValue     = $(if ($foreignTier1.Count -eq 0) { 'No foreign apps with Tier 1 data access permissions' } else { "$($foreignTier1.Count) finding(s): $($foreignTier1 -join '; ')" })
        RecommendedValue = 'Minimize foreign apps with broad data access permissions'
        Status           = $(if ($foreignTier1.Count -eq 0) { 'Pass' } else { 'Warning' })
        CheckId          = 'ENTRA-ENTAPP-011'
        Remediation      = 'Entra admin center > Enterprise applications > review foreign apps with broad data access (Mail.ReadWrite, Files.ReadWrite.All, etc.). Scope to least-privilege or remove.'
        Evidence         = [PSCustomObject]@{ Findings = @($foreignTier1); Count = $foreignTier1.Count }
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
        Evidence         = [PSCustomObject]@{ Findings = @($foreignDangerousDelegated); Count = $foreignDangerousDelegated.Count }
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
# 10. ENTRA-ENTAPP-010: Internal (first-party) apps with Tier 0 permissions
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking internal apps with Tier 0 application permissions..."
    $internalTier0 = @()

    $internalApps = @($allServicePrincipals | Where-Object {
        $_['appOwnerOrganizationId'] -eq $tenantId -and
        $_['servicePrincipalType'] -ne 'ManagedIdentity'
    })

    foreach ($sp in $internalApps) {
        $appRoles = Get-SpAppRoleAssignments -SpId $sp['id']
        foreach ($role in $appRoles) {
            $permId = $role['appRoleId']
            if ($permId -and $graphPermissionMap.ContainsKey($permId)) {
                $permName = $graphPermissionMap[$permId].Name
                if ($permName -in $tier0AppPermissions) {
                    $internalTier0 += "$($sp['displayName']): $permName"
                }
            }
        }
    }

    $settingParams = @{
        Category         = 'Enterprise Applications'
        Setting          = 'Internal Apps with Tier 0 Permissions (GA Escalation)'
        CurrentValue     = $(if ($internalTier0.Count -eq 0) { 'No internal apps with Tier 0 permissions' } else { "$($internalTier0.Count) finding(s): $($internalTier0 -join '; ')" })
        RecommendedValue = 'Minimize internal apps with Tier 0 permissions; use least-privilege'
        Status           = $(if ($internalTier0.Count -eq 0) { 'Pass' } else { 'Warning' })
        CheckId          = 'ENTRA-ENTAPP-010'
        Remediation      = 'Entra admin center > App registrations > review internal apps with Tier 0 permissions. Each has a documented path to Global Administrator. Replace with narrower permissions or use managed identities where possible.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check internal app Tier 0 permissions: $_"
}

# ------------------------------------------------------------------
# 12. ENTRA-ENTAPP-012: Apps using client secrets instead of certificates
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking apps using secrets instead of certificates..."
    $secretOnlyApps = @($regularApps | Where-Object {
        $_['accountEnabled'] -eq $true -and
        $_['passwordCredentials'] -and @($_['passwordCredentials']).Count -gt 0 -and
        (-not $_['keyCredentials'] -or @($_['keyCredentials']).Count -eq 0)
    } | ForEach-Object { $_['displayName'] })

    $settingParams = @{
        Category         = 'Credential Hygiene'
        Setting          = 'Apps Using Secrets Instead of Certificates'
        CurrentValue     = $(if ($secretOnlyApps.Count -eq 0) { 'No apps rely solely on client secrets' } else { "$($secretOnlyApps.Count) app(s): $($secretOnlyApps[0..4] -join '; ')$(if ($secretOnlyApps.Count -gt 5) { '...' })" })
        RecommendedValue = 'Use certificates or managed identities instead of client secrets'
        Status           = $(if ($secretOnlyApps.Count -eq 0) { 'Pass' } else { 'Warning' })
        CheckId          = 'ENTRA-ENTAPP-012'
        Remediation      = 'Migrate app credentials from client secrets to certificates or managed identities. Secrets are extractable from memory and logs. Entra admin center > App registrations > Certificates & secrets.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check secret-only apps: $_"
}

# ------------------------------------------------------------------
# 13. ENTRA-ENTAPP-013: Apps with expired credentials still present
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking apps with expired credentials..."
    $now = Get-Date
    $expiredCredApps = @()

    foreach ($sp in $regularApps) {
        $hasExpired = $false
        foreach ($passCred in @($sp['passwordCredentials'])) {
            if ($passCred -and $passCred['endDateTime'] -and [datetime]$passCred['endDateTime'] -lt $now) { $hasExpired = $true; break }
        }
        if (-not $hasExpired) {
            foreach ($key in @($sp['keyCredentials'])) {
                if ($key -and $key['endDateTime'] -and [datetime]$key['endDateTime'] -lt $now) { $hasExpired = $true; break }
            }
        }
        if ($hasExpired) { $expiredCredApps += $sp['displayName'] }
    }

    $settingParams = @{
        Category         = 'Credential Hygiene'
        Setting          = 'Apps with Expired Credentials'
        CurrentValue     = $(if ($expiredCredApps.Count -eq 0) { 'No apps have expired credentials' } else { "$($expiredCredApps.Count) app(s): $($expiredCredApps[0..4] -join '; ')$(if ($expiredCredApps.Count -gt 5) { '...' })" })
        RecommendedValue = 'Remove expired credentials from all app registrations'
        Status           = $(if ($expiredCredApps.Count -eq 0) { 'Pass' } else { 'Warning' })
        CheckId          = 'ENTRA-ENTAPP-013'
        Remediation      = 'Remove expired credentials. Expired secrets/certs are attack surface -- they indicate poor credential lifecycle management. Entra admin center > App registrations > Certificates & secrets.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check expired credentials: $_"
}

# ------------------------------------------------------------------
# 14. ENTRA-ENTAPP-014: Apps with both secret and certificate credentials
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking apps with multiple credential types..."
    $dualCredApps = @($regularApps | Where-Object {
        $_['passwordCredentials'] -and @($_['passwordCredentials']).Count -gt 0 -and
        $_['keyCredentials'] -and @($_['keyCredentials']).Count -gt 0
    } | ForEach-Object { $_['displayName'] })

    $settingParams = @{
        Category         = 'Credential Hygiene'
        Setting          = 'Apps with Both Secrets and Certificates'
        CurrentValue     = $(if ($dualCredApps.Count -eq 0) { 'No apps have dual credential types' } else { "$($dualCredApps.Count) app(s): $($dualCredApps[0..4] -join '; ')$(if ($dualCredApps.Count -gt 5) { '...' })" })
        RecommendedValue = 'Use a single credential type per app (prefer certificates)'
        Status           = $(if ($dualCredApps.Count -eq 0) { 'Pass' } else { 'Info' })
        CheckId          = 'ENTRA-ENTAPP-014'
        Remediation      = 'Remove the client secret if a certificate is also configured. Dual credential types widen the attack surface. Entra admin center > App registrations > Certificates & secrets.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check dual credential apps: $_"
}

# ------------------------------------------------------------------
# 15. ENTRA-ENTAPP-015: SPs with client secret AND permanent privileged role
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking SPs with secret + permanent privileged role..."
    $secretPermanentRole = @()

    foreach ($sp in $regularApps) {
        $hasSecret = $sp['passwordCredentials'] -and @($sp['passwordCredentials']).Count -gt 0
        if (-not $hasSecret) { continue }

        if ($spRoleAssignments.ContainsKey($sp['id'])) {
            $secretPermanentRole += "$($sp['displayName']) ($(@($spRoleAssignments[$sp['id']]).Count) role(s))"
        }
    }

    $settingParams = @{
        Category         = 'Credential Hygiene'
        Setting          = 'SPs with Secret + Permanent Directory Role'
        CurrentValue     = $(if ($secretPermanentRole.Count -eq 0) { 'No SPs combine secrets with permanent roles' } else { "$($secretPermanentRole.Count) SP(s): $($secretPermanentRole[0..2] -join '; ')$(if ($secretPermanentRole.Count -gt 3) { '...' })" })
        RecommendedValue = 'Privileged SPs should use certificates, not secrets'
        Status           = $(if ($secretPermanentRole.Count -eq 0) { 'Pass' } else { 'Fail' })
        CheckId          = 'ENTRA-ENTAPP-015'
        Remediation      = 'Migrate privileged service principals from client secrets to certificates or managed identities. A secret on a permanently privileged SP is a persistent backdoor risk.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check secret + permanent role SPs: $_"
}

# ------------------------------------------------------------------
# 16. ENTRA-ENTAPP-016: Privileged apps (Tier 0 perms) with owners
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking privileged apps with owners..."
    $privilegedWithOwners = @()

    foreach ($sp in $regularApps) {
        $appRoles = Get-SpAppRoleAssignments -SpId $sp['id']
        $hasTier0 = $false
        foreach ($role in $appRoles) {
            $permId = $role['appRoleId']
            if ($permId -and $graphPermissionMap.ContainsKey($permId)) {
                if ($graphPermissionMap[$permId].Name -in $tier0AppPermissions) {
                    $hasTier0 = $true
                    break
                }
            }
        }
        if (-not $hasTier0) { continue }

        try {
            $ownersUri = "/v1.0/servicePrincipals/$($sp['id'])/owners?`$select=id,displayName"
            $ownersResp = Invoke-MgGraphRequest -Method GET -Uri $ownersUri -ErrorAction Stop
            $owners = if ($ownersResp -and $ownersResp['value']) { @($ownersResp['value']) } else { @() }
            if ($owners.Count -gt 0) {
                $ownerNames = ($owners | ForEach-Object { $_['displayName'] }) -join ', '
                $privilegedWithOwners += "$($sp['displayName']) (owners: $ownerNames)"
            }
        }
        catch {
            Write-Verbose "Could not fetch owners for $($sp['displayName']): $_"
        }
    }

    $settingParams = @{
        Category         = 'Owner Risk'
        Setting          = 'Tier 0 Apps with Owners Assigned'
        CurrentValue     = $(if ($privilegedWithOwners.Count -eq 0) { 'No Tier 0 apps have owners' } else { "$($privilegedWithOwners.Count) app(s): $($privilegedWithOwners[0..2] -join '; ')$(if ($privilegedWithOwners.Count -gt 3) { '...' })" })
        RecommendedValue = 'Tier 0 apps should not have owners (owners can add credentials and impersonate)'
        Status           = $(if ($privilegedWithOwners.Count -eq 0) { 'Pass' } else { 'Fail' })
        CheckId          = 'ENTRA-ENTAPP-016'
        Remediation      = 'Remove owners from apps with Tier 0 permissions. An owner of a Tier 0 app can add credentials and impersonate it to escalate to Global Admin. Entra admin center > App registrations > Owners.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check privileged app owners: $_"
}

# ------------------------------------------------------------------
# 17. ENTRA-ENTAPP-017: Apps with directory roles that have owners
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking role-holding apps with owners..."
    $roleAppsWithOwners = @()

    foreach ($sp in $regularApps) {
        if (-not $spRoleAssignments.ContainsKey($sp['id'])) { continue }

        try {
            $ownersUri = "/v1.0/servicePrincipals/$($sp['id'])/owners?`$select=id,displayName"
            $ownersResp = Invoke-MgGraphRequest -Method GET -Uri $ownersUri -ErrorAction Stop
            $owners = if ($ownersResp -and $ownersResp['value']) { @($ownersResp['value']) } else { @() }
            if ($owners.Count -gt 0) {
                $ownerNames = ($owners | ForEach-Object { $_['displayName'] }) -join ', '
                $roleAppsWithOwners += "$($sp['displayName']) (owners: $ownerNames)"
            }
        }
        catch {
            Write-Verbose "Could not fetch owners for $($sp['displayName']): $_"
        }
    }

    $settingParams = @{
        Category         = 'Owner Risk'
        Setting          = 'Role-Holding Apps with Owners'
        CurrentValue     = $(if ($roleAppsWithOwners.Count -eq 0) { 'No role-holding apps have owners' } else { "$($roleAppsWithOwners.Count) app(s): $($roleAppsWithOwners[0..2] -join '; ')$(if ($roleAppsWithOwners.Count -gt 3) { '...' })" })
        RecommendedValue = 'Apps with directory roles should not have owners'
        Status           = $(if ($roleAppsWithOwners.Count -eq 0) { 'Pass' } else { 'Warning' })
        CheckId          = 'ENTRA-ENTAPP-017'
        Remediation      = 'Remove owners from apps holding Entra directory roles. Owners can add credentials and impersonate the SP to exercise those roles. Entra admin center > App registrations > Owners.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check role-holding app owners: $_"
}

# ------------------------------------------------------------------
# 18. ENTRA-ENTAPP-018: Orphaned apps (no owners assigned)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking for orphaned apps with no owners..."
    $orphanedApps = @()
    $appsWithCreds = @($regularApps | Where-Object {
        ($_['passwordCredentials'] -and @($_['passwordCredentials']).Count -gt 0) -or
        ($_['keyCredentials'] -and @($_['keyCredentials']).Count -gt 0)
    })

    foreach ($sp in $appsWithCreds) {
        try {
            $ownersUri = "/v1.0/servicePrincipals/$($sp['id'])/owners?`$select=id"
            $ownersResp = Invoke-MgGraphRequest -Method GET -Uri $ownersUri -ErrorAction Stop
            $owners = if ($ownersResp -and $ownersResp['value']) { @($ownersResp['value']) } else { @() }
            if ($owners.Count -eq 0) {
                $orphanedApps += $sp['displayName']
            }
        }
        catch {
            Write-Verbose "Could not fetch owners for $($sp['displayName']): $_"
        }
    }

    $settingParams = @{
        Category         = 'Owner Risk'
        Setting          = 'Credentialed Apps with No Owners'
        CurrentValue     = $(if ($orphanedApps.Count -eq 0) { 'All credentialed apps have at least one owner' } else { "$($orphanedApps.Count) orphaned app(s): $($orphanedApps[0..4] -join '; ')$(if ($orphanedApps.Count -gt 5) { '...' })" })
        RecommendedValue = 'All apps with credentials should have at least one owner for accountability'
        Status           = $(if ($orphanedApps.Count -eq 0) { 'Pass' } else { 'Warning' })
        CheckId          = 'ENTRA-ENTAPP-018'
        Remediation      = 'Assign owners to orphaned app registrations. Without owners, no one is accountable for credential rotation or permission review. Entra admin center > App registrations > Owners > Add owner.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check orphaned apps: $_"
}

# ------------------------------------------------------------------
# 19. ENTRA-ENTAPP-019: Unused privileged permissions (granted >30 days, never used)
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking for unused privileged permissions..."
    $unusedPrivileged = @()

    foreach ($sp in $regularApps) {
        $appRoles = Get-SpAppRoleAssignments -SpId $sp['id']
        $hasTier0 = $false
        foreach ($role in $appRoles) {
            $permId = $role['appRoleId']
            if ($permId -and $graphPermissionMap.ContainsKey($permId)) {
                if ($graphPermissionMap[$permId].Name -in $tier0AppPermissions) {
                    $hasTier0 = $true
                    break
                }
            }
        }
        if (-not $hasTier0) { continue }

        # Check sign-in activity
        $lastSignIn = $sp['lastSignInActivity']
        if (-not $lastSignIn) {
            # SP with Tier 0 perms and no sign-in activity at all
            $unusedPrivileged += $sp['displayName']
        }
    }

    $settingParams = @{
        Category         = 'Permission Hygiene'
        Setting          = 'Tier 0 Apps with No Sign-In Activity'
        CurrentValue     = $(if ($unusedPrivileged.Count -eq 0) { 'All Tier 0 apps show recent sign-in activity' } else { "$($unusedPrivileged.Count) app(s) with Tier 0 perms and no sign-in: $($unusedPrivileged[0..4] -join '; ')$(if ($unusedPrivileged.Count -gt 5) { '...' })" })
        RecommendedValue = 'Remove Tier 0 permissions from apps that never use them'
        Status           = $(if ($unusedPrivileged.Count -eq 0) { 'Pass' } else { 'Warning' })
        CheckId          = 'ENTRA-ENTAPP-019'
        Remediation      = 'Review apps with Tier 0 permissions that show no sign-in activity. These permissions may have been granted but never used -- remove them to reduce attack surface. Entra admin center > Enterprise applications > Sign-in logs.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check unused privileged permissions: $_"
}

# ------------------------------------------------------------------
# 20. ENTRA-APPREG-002: Apps with localhost redirect URIs
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking apps with localhost redirect URIs..."
    $localhostApps = @()

    foreach ($app in $allAppRegistrations) {
        $allUris = @()
        if ($app['web'] -and $app['web']['redirectUris']) { $allUris += @($app['web']['redirectUris']) }
        if ($app['spa'] -and $app['spa']['redirectUris']) { $allUris += @($app['spa']['redirectUris']) }
        if ($app['publicClient'] -and $app['publicClient']['redirectUris']) { $allUris += @($app['publicClient']['redirectUris']) }

        $hasLocalhost = $allUris | Where-Object { $_ -match 'localhost|127\.0\.0\.1|\[::1\]' }
        if ($hasLocalhost) {
            $localhostApps += $app['displayName']
        }
    }

    $settingParams = @{
        Category         = 'App Registration Security'
        Setting          = 'Apps with Localhost Redirect URIs'
        CurrentValue     = $(if ($localhostApps.Count -eq 0) { 'No apps have localhost redirect URIs' } else { "$($localhostApps.Count) app(s): $($localhostApps[0..4] -join '; ')$(if ($localhostApps.Count -gt 5) { '...' })" })
        RecommendedValue = 'Remove localhost redirect URIs from production apps'
        Status           = $(if ($localhostApps.Count -eq 0) { 'Pass' } else { 'Warning' })
        CheckId          = 'ENTRA-APPREG-002'
        Remediation      = 'Remove localhost redirect URIs from production app registrations. In shared environments, tokens redirected to localhost can be intercepted. Entra admin center > App registrations > Authentication.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check localhost redirect URIs: $_"
}

# ------------------------------------------------------------------
# 21. ENTRA-APPREG-003: Apps with HTTP (non-HTTPS) redirect URIs
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking apps with HTTP redirect URIs..."
    $httpApps = @()

    foreach ($app in $allAppRegistrations) {
        $allUris = @()
        if ($app['web'] -and $app['web']['redirectUris']) { $allUris += @($app['web']['redirectUris']) }
        if ($app['spa'] -and $app['spa']['redirectUris']) { $allUris += @($app['spa']['redirectUris']) }

        $hasHttp = $allUris | Where-Object { $_ -match '^http://' -and $_ -notmatch 'localhost|127\.0\.0\.1' }
        if ($hasHttp) {
            $httpApps += $app['displayName']
        }
    }

    $settingParams = @{
        Category         = 'App Registration Security'
        Setting          = 'Apps with HTTP (Non-HTTPS) Redirect URIs'
        CurrentValue     = $(if ($httpApps.Count -eq 0) { 'No apps have insecure HTTP redirect URIs' } else { "$($httpApps.Count) app(s): $($httpApps[0..4] -join '; ')$(if ($httpApps.Count -gt 5) { '...' })" })
        RecommendedValue = 'All redirect URIs should use HTTPS'
        Status           = $(if ($httpApps.Count -eq 0) { 'Pass' } else { 'Fail' })
        CheckId          = 'ENTRA-APPREG-003'
        Remediation      = 'Update HTTP redirect URIs to HTTPS. Non-HTTPS URIs allow token interception via MITM attacks. Entra admin center > App registrations > Authentication.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check HTTP redirect URIs: $_"
}

# ------------------------------------------------------------------
# 22. ENTRA-APPREG-004: Apps with wildcard redirect URIs
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking apps with wildcard redirect URIs..."
    $wildcardApps = @()

    foreach ($app in $allAppRegistrations) {
        $allUris = @()
        if ($app['web'] -and $app['web']['redirectUris']) { $allUris += @($app['web']['redirectUris']) }
        if ($app['spa'] -and $app['spa']['redirectUris']) { $allUris += @($app['spa']['redirectUris']) }

        $hasWildcard = $allUris | Where-Object { $_ -match '\*' }
        if ($hasWildcard) {
            $wildcardApps += $app['displayName']
        }
    }

    $settingParams = @{
        Category         = 'App Registration Security'
        Setting          = 'Apps with Wildcard Redirect URIs'
        CurrentValue     = $(if ($wildcardApps.Count -eq 0) { 'No apps have wildcard redirect URIs' } else { "$($wildcardApps.Count) app(s): $($wildcardApps[0..4] -join '; ')$(if ($wildcardApps.Count -gt 5) { '...' })" })
        RecommendedValue = 'Avoid wildcard redirect URIs'
        Status           = $(if ($wildcardApps.Count -eq 0) { 'Pass' } else { 'Fail' })
        CheckId          = 'ENTRA-APPREG-004'
        Remediation      = 'Replace wildcard redirect URIs with explicit URIs. Wildcards enable open redirect attacks for token theft. Entra admin center > App registrations > Authentication.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check wildcard redirect URIs: $_"
}

# ------------------------------------------------------------------
# 23. ENTRA-ENTAPP-020: Foreign apps impersonating Microsoft display names
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking for apps impersonating Microsoft names..."
    $msNames = @('Microsoft Teams', 'Microsoft Graph', 'Microsoft Office', 'Microsoft Azure', 'Microsoft Intune', 'Microsoft Exchange', 'Microsoft SharePoint', 'Microsoft Outlook', 'Microsoft OneDrive', 'Microsoft Defender')
    $impersonators = @()

    # Exclude legitimate Microsoft first-party SPs (appOwnerOrganizationId == Microsoft tenant).
    # These are automatically provisioned by the platform and are not impersonators.
    $msTenantId = 'f8cdef31-a31e-4b4a-93e4-5f571e91255a'
    $nonMsForeignApps = @($foreignApps | Where-Object { $_['appOwnerOrganizationId'] -ne $msTenantId })

    foreach ($sp in $nonMsForeignApps) {
        $name = $sp['displayName']
        foreach ($msName in $msNames) {
            if ($name -eq $msName -or $name -like "$msName *") {
                $impersonators += "$name (AppId: $($sp['appId']))"
                break
            }
        }
    }

    $settingParams = @{
        Category         = 'App Registration Security'
        Setting          = 'Foreign Apps Impersonating Microsoft Names'
        CurrentValue     = $(if ($impersonators.Count -eq 0) { 'No foreign apps impersonate Microsoft display names' } else { "$($impersonators.Count) app(s): $($impersonators[0..2] -join '; ')$(if ($impersonators.Count -gt 3) { '...' })" })
        RecommendedValue = 'No foreign apps should use Microsoft product names'
        Status           = $(if ($impersonators.Count -eq 0) { 'Pass' } else { 'Fail' })
        CheckId          = 'ENTRA-ENTAPP-020'
        Remediation      = 'Investigate foreign apps using Microsoft product names -- they may be social engineering attempts. Verify the publisher and appId against known Microsoft first-party apps. Remove if suspicious.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check impersonating apps: $_"
}

# ------------------------------------------------------------------
# 24. ENTRA-ENTAPP-021: Multi-tenant apps that should be single-tenant
# ------------------------------------------------------------------
try {
    Write-Verbose "Checking multi-tenant app registrations..."
    $multiTenantApps = @($allAppRegistrations | Where-Object {
        $_['signInAudience'] -in @('AzureADMultipleOrgs', 'AzureADandPersonalMicrosoftAccount')
    } | ForEach-Object { "$($_['displayName']) ($($_['signInAudience']))" })

    $settingParams = @{
        Category         = 'App Registration Security'
        Setting          = 'Multi-Tenant App Registrations'
        CurrentValue     = $(if ($multiTenantApps.Count -eq 0) { 'No multi-tenant app registrations' } else { "$($multiTenantApps.Count) app(s): $($multiTenantApps[0..4] -join '; ')$(if ($multiTenantApps.Count -gt 5) { '...' })" })
        RecommendedValue = 'Use single-tenant (AzureADMyOrg) unless external access is required'
        Status           = $(if ($multiTenantApps.Count -eq 0) { 'Pass' } else { 'Info' })
        CheckId          = 'ENTRA-ENTAPP-021'
        Remediation      = 'Review multi-tenant apps and restrict to AzureADMyOrg if they do not need cross-tenant access. Multi-tenant apps can be accessed by users from any Entra ID tenant. Entra admin center > App registrations > Authentication > Supported account types.'
    }
    Add-Setting @settingParams
}
catch {
    Write-Warning "Could not check multi-tenant apps: $_"
}

# ------------------------------------------------------------------
# Output results
# ------------------------------------------------------------------
Export-SecurityConfigReport -Settings $settings -OutputPath $OutputPath -ServiceLabel 'Enterprise Apps'
