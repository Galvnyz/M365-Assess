#Requires -Version 7.0
<#
.SYNOPSIS
    Configures every permission required by Invoke-M365Assessment.ps1 on an existing
    App Registration — Microsoft Graph API permissions, Exchange Online RBAC role groups,
    and Microsoft Purview / Compliance role assignments via Graph directory roles.

.DESCRIPTION
    This script is a companion to Invoke-M365Assessment.ps1. It provisions ALL
    permissions the assessment tool needs across every section:

      Sections covered
      ────────────────
      Tenant        → Graph: Organization, Domain, Policy, User, Group
      Identity      → Graph: User, AuditLog, MFA methods, Roles, Policy, Apps, Directory
      Licensing     → Graph: Organization, User
      Email         → Exchange Online RBAC role groups
      Intune        → Graph: DeviceManagement (devices + config)
      Security      → Graph: SecurityEvents  +  Exchange Online RBAC  +  Purview/Compliance roles
      Collaboration → Graph: SharePoint tenant settings, Teams settings
      Hybrid        → Graph: Organization, Domain
      Inventory     → Graph: Groups, Teams, Channels, Reports, Sites, Users
                      + Exchange Online RBAC

    Authentication model
    ────────────────────
      Graph step (permissions)
                    — fully app-only. Connects with ClientId + CertificateThumbprint.
                      No browser interaction.

      Compliance roles step
                    — delegated Graph session using -AdminUpn.
                      New-MgDirectoryRoleMemberByRef requires RoleManagement.ReadWrite.Directory.
                      An app cannot grant itself that permission on first run (no bootstrap path),
                      so a delegated admin account is used for this step.

      EXO RBAC      — delegated Exchange Online session using -AdminUpn.
                      Add-RoleGroupMember requires a delegated admin session.
                      Microsoft does not expose this operation via app-only EXO sessions.

    Role group notes (lessons learned)
    ───────────────────────────────────
      Exchange Online (cloud-only tenants):
        "View-Only Recipients" and "View-Only Configuration" only exist in
        on-premises/hybrid Exchange. In Exchange Online the equivalent access
        is provided by "View-Only Organization Management".

        "Security Reader" is ambiguous — it exists in both EXO and Entra ID.
        The script uses the unambiguous EXO group "Compliance Management" for
        read-only Defender/EOP policy access instead.

      Purview / Compliance roles:
        "View-Only DLP Compliance Management", "View-Only Manage Alerts", and
        "Compliance Administrator" are Entra ID directory roles, not Security &
        Compliance PowerShell role groups. They are assigned via Graph
        (New-MgDirectoryRoleMemberByRef) rather than Connect-IPPSSession.

.PARAMETER TenantId
    Tenant ID or domain (e.g. 'contoso.onmicrosoft.com').

.PARAMETER ClientId
    Application (Client) ID of the App Registration being configured.

.PARAMETER AppDisplayName
    Display name of the App Registration. Used when -ClientId is not supplied.
    Aborts if multiple apps share the same name — use -ClientId in that case.

.PARAMETER CertificateThumbprint
    Thumbprint of the certificate in Cert:\CurrentUser\My used for app-only
    Graph authentication. Must also be uploaded to the App Registration.

.PARAMETER AdminUpn
    UPN of an Exchange Administrator or Global Administrator account, used for
    the delegated Exchange Online session. Required unless -SkipExchangeRbac
    is specified.

.PARAMETER SkipGraph
    Skip the Microsoft Graph API permission assignment step.

.PARAMETER SkipExchangeRbac
    Skip the Exchange Online role group assignment step.

.PARAMETER SkipComplianceRoles
    Skip the Purview/Compliance Entra directory role assignment step.

.PARAMETER WhatIf
    Shows what would be changed without making any modifications.

.EXAMPLE
    PS> .\Add-M365AssessmentPermissions.ps1 `
            -TenantId              'contoso.onmicrosoft.com' `
            -ClientId              '00000000-0000-0000-0000-000000000000' `
            -CertificateThumbprint 'ABC123DEF456' `
            -AdminUpn              'admin@contoso.onmicrosoft.com'

.EXAMPLE
    PS> .\Add-M365AssessmentPermissions.ps1 `
            -TenantId              'contoso.onmicrosoft.com' `
            -ClientId              '00000000-0000-0000-0000-000000000000' `
            -CertificateThumbprint 'ABC123DEF456' `
            -SkipExchangeRbac `
            -SkipComplianceRoles

    Graph permissions only — no AdminUpn required.

.NOTES
    Version  : 4.1.0
    Author   : Companion script for Invoke-M365Assessment.ps1 by Daren9m

    Required modules:
        Install-Module Microsoft.Graph.Authentication    -Scope CurrentUser
        Install-Module Microsoft.Graph.Applications      -Scope CurrentUser
        Install-Module Microsoft.Graph.Identity.Governance -Scope CurrentUser
        Install-Module ExchangeOnlineManagement          -Scope CurrentUser
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [string]$TenantId,

    [Parameter(ParameterSetName = 'ByClientId', Mandatory)]
    [string]$ClientId,

    [Parameter(ParameterSetName = 'ByDisplayName', Mandatory)]
    [string]$AppDisplayName,

    [Parameter(Mandatory)]
    [string]$CertificateThumbprint,

    [Parameter()]
    [string]$AdminUpn,

    [Parameter()]
    [switch]$SkipGraph,

    [Parameter()]
    [switch]$SkipExchangeRbac,

    [Parameter()]
    [switch]$SkipComplianceRoles
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ==============================================================================
# GRAPH API PERMISSIONS
# Source: $sectionScopeMap — all sections, deduplicated
# ==============================================================================

$requiredGraphPermissions = @(
    # ── Tenant ────────────────────────────────────────────────────────────────
    @{ Name = 'Organization.Read.All';                   Sections = 'Tenant, Licensing, Hybrid'              ; Reason = 'Tenant org details, verified domains, hybrid config' }
    @{ Name = 'Domain.Read.All';                         Sections = 'Tenant, Identity, Hybrid'               ; Reason = 'All domains registered in the tenant' }
    @{ Name = 'Group.Read.All';                          Sections = 'Tenant, Inventory'                      ; Reason = 'All groups including Microsoft 365 and security groups' }
    # ── Identity ──────────────────────────────────────────────────────────────
    @{ Name = 'User.Read.All';                           Sections = 'Tenant, Identity, Licensing, Inventory' ; Reason = 'User profiles, sign-in activity, license assignments' }
    @{ Name = 'AuditLog.Read.All';                       Sections = 'Identity'                               ; Reason = 'Sign-in logs and directory audit events' }
    @{ Name = 'UserAuthenticationMethod.Read.All';       Sections = 'Identity'                               ; Reason = 'MFA and passwordless authentication methods per user' }
    @{ Name = 'RoleManagement.Read.Directory';           Sections = 'Identity'                               ; Reason = 'Entra directory role assignments and PIM eligibility' }
    @{ Name = 'Policy.Read.All';                         Sections = 'Tenant, Identity'                       ; Reason = 'Conditional Access, auth methods, token lifetime, password policies' }
    @{ Name = 'Application.Read.All';                    Sections = 'Identity'                               ; Reason = 'App registrations, service principals, OAuth permission grants' }
    @{ Name = 'Directory.Read.All';                      Sections = 'Identity'                               ; Reason = 'Devices, admin units, role templates' }
    # ── Intune ────────────────────────────────────────────────────────────────
    @{ Name = 'DeviceManagementManagedDevices.Read.All'; Sections = 'Intune'                                 ; Reason = 'Managed device inventory and compliance state' }
    @{ Name = 'DeviceManagementConfiguration.Read.All';  Sections = 'Intune'                                 ; Reason = 'Configuration profiles and compliance policies' }
    # ── Security ──────────────────────────────────────────────────────────────
    @{ Name = 'SecurityEvents.Read.All';                 Sections = 'Security'                               ; Reason = 'Secure Score, improvement actions, security alerts' }
    # ── Collaboration ─────────────────────────────────────────────────────────
    @{ Name = 'SharePointTenantSettings.Read.All';       Sections = 'Collaboration'                          ; Reason = 'SharePoint and OneDrive tenant-level settings' }
    @{ Name = 'TeamSettings.Read.All';                   Sections = 'Collaboration'                          ; Reason = 'Teams tenant-level settings and policies' }
    @{ Name = 'TeamworkAppSettings.Read.All';            Sections = 'Collaboration'                          ; Reason = 'Teams app permission and setup policies' }
    # ── Inventory ─────────────────────────────────────────────────────────────
    @{ Name = 'Team.ReadBasic.All';                      Sections = 'Inventory'                              ; Reason = 'Enumerate all Teams' }
    @{ Name = 'TeamMember.Read.All';                     Sections = 'Inventory'                              ; Reason = 'Teams membership details' }
    @{ Name = 'Channel.ReadBasic.All';                   Sections = 'Inventory'                              ; Reason = 'Teams channels' }
    @{ Name = 'Reports.Read.All';                        Sections = 'Inventory'                              ; Reason = 'Microsoft 365 usage reports' }
    @{ Name = 'Sites.Read.All';                          Sections = 'Inventory'                              ; Reason = 'SharePoint site enumeration and metadata' }
)

# ==============================================================================
# EXCHANGE ONLINE ROLE GROUPS
#
# Cloud-only EXO tenants do NOT have "View-Only Recipients" or
# "View-Only Configuration" — those only exist in on-premises / hybrid Exchange.
# In Exchange Online, "View-Only Organization Management" covers the equivalent
# read-only access for mailboxes, recipients, transport rules, and connectors.
#
# "Security Reader" is intentionally excluded here — it is ambiguous (exists in
# both EXO and Entra ID) and causes a "matches multiple entries" error. The
# Entra ID "Security Reader" directory role is assigned in the Compliance step
# below, which is the correct surface for Defender/security policy reads.
# ==============================================================================

$requiredExoRoleGroups = @(
    @{
        RoleGroup = 'View-Only Organization Management'
        Sections  = 'Email, Security, Inventory'
        Reason    = 'Read-only access to mailboxes, recipients, transport rules, connectors, and EOP/Defender policies. Replaces the on-prem-only "View-Only Recipients" and "View-Only Configuration" groups in cloud EXO.'
    }
    @{
        RoleGroup = 'Compliance Management'
        Sections  = 'Security'
        Reason    = 'Read access to compliance-related EXO configuration (journal rules, message tracking, transport compliance rules).'
    }
)

# ==============================================================================
# PURVIEW / COMPLIANCE ENTRA DIRECTORY ROLES
#
# These are Entra ID built-in directory roles, NOT Security & Compliance
# PowerShell role groups. They must be assigned via Graph
# (New-MgDirectoryRoleMemberByRef), not Connect-IPPSSession.
#
# Role template GUIDs are stable across all tenants (built-in roles).
# ==============================================================================

$requiredComplianceRoles = @(
    @{
        DisplayName  = 'Compliance Administrator'
        TemplateId   = '17315797-102d-40b4-93e0-432062caca18'
        Sections     = 'Security'
        Reason       = 'Read access to Purview compliance configuration — DLP policies, audit, retention, sensitivity labels.'
    }
    @{
        DisplayName  = 'Security Reader'
        TemplateId   = '5d6b6bb7-de71-4623-b4af-96380a352509'
        Sections     = 'Security'
        Reason       = 'Read access to Microsoft Defender and security-related settings, alerts, and policies.'
    }
    @{
        DisplayName  = 'Global Reader'
        TemplateId   = 'f2ef992c-3afb-46b9-b7cf-a126ee74c451'
        Sections     = 'Security, Compliance'
        Reason       = 'Broad read-only access across Microsoft 365 services including Purview, covering gaps not addressed by the above roles.'
    }
)

# ==============================================================================
# HELPERS
# ==============================================================================

function Write-Banner {
    param([string]$Title, [string]$Color = 'Cyan')
    $border = '=' * ($Title.Length + 4)
    Write-Host ''
    Write-Host "  $border"    -ForegroundColor $Color
    Write-Host "  = $Title =" -ForegroundColor $Color
    Write-Host "  $border"    -ForegroundColor $Color
    Write-Host ''
}

function Write-Step { param([string]$M) Write-Host "`n  > $M" -ForegroundColor Cyan }
function Write-OK   { param([string]$M) Write-Host "    + $M" -ForegroundColor Green }
function Write-Skip { param([string]$M) Write-Host "    o $M" -ForegroundColor DarkGray }
function Write-Warn { param([string]$M) Write-Host "    ! $M" -ForegroundColor Yellow }
function Write-Fail { param([string]$M) Write-Host "    x $M" -ForegroundColor Magenta }
function Write-Info { param([string]$M) Write-Host "    . $M" -ForegroundColor White }

# ==============================================================================
# BANNER + PRE-FLIGHT
# ==============================================================================

Write-Banner -Title 'M365 Assessment - Full Permission Configurator v4.1.0'

if ($WhatIfPreference) {
    Write-Host '  *** WHATIF MODE - no changes will be made ***' -ForegroundColor Yellow
    Write-Host ''
}

if (-not $SkipExchangeRbac -and -not $AdminUpn) {
    throw 'Parameter -AdminUpn is required for Exchange Online role group assignments. ' +
          'Add-RoleGroupMember requires a delegated admin session — this is a platform ' +
          'constraint. Provide -AdminUpn or use -SkipExchangeRbac to skip that step.'
}

# ==============================================================================
# STEP 1 - MODULE VALIDATION
# ==============================================================================

Write-Step 'Validating required PowerShell modules...'

$moduleChecks = @(
    @{ Name = 'Microsoft.Graph.Authentication';       Required = $true }
    @{ Name = 'Microsoft.Graph.Applications';         Required = $true }
    @{ Name = 'Microsoft.Graph.Identity.Governance';  Required = (-not $SkipComplianceRoles) }
    @{ Name = 'ExchangeOnlineManagement';             Required = (-not $SkipExchangeRbac) }
)

$missingModules = @()
foreach ($m in $moduleChecks) {
    if (-not $m.Required) { Write-Skip "$($m.Name) - step skipped, not checked"; continue }
    if (Get-Module -ListAvailable -Name $m.Name) {
        Write-OK $m.Name
    }
    else {
        Write-Fail "$($m.Name) - NOT INSTALLED"
        Write-Info "Fix: Install-Module $($m.Name) -Scope CurrentUser"
        $missingModules += $m.Name
    }
}

if ($missingModules.Count -gt 0) {
    throw "Missing required modules: $($missingModules -join ', '). Install them and re-run."
}

# ==============================================================================
# STEP 2 - RESOLVE APP REGISTRATION (app-only, certificate)
# ==============================================================================

Write-Step 'Validating certificate...'

$cert = Get-Item "Cert:\CurrentUser\My\$CertificateThumbprint" -ErrorAction SilentlyContinue
if (-not $cert) {
    throw "Certificate '$CertificateThumbprint' not found in Cert:\CurrentUser\My."
}
Write-OK "Certificate: $($cert.Subject)  [Expires: $($cert.NotAfter.ToString('yyyy-MM-dd'))]"

# If only a display name was provided, do a brief delegated lookup to get the AppId
if ($PSCmdlet.ParameterSetName -eq 'ByDisplayName') {
    Write-Step 'Resolving AppId from display name (brief delegated connection)...'
    Connect-MgGraph -TenantId $TenantId -Scopes 'Application.Read.All' -NoWelcome
    $apps = @(Get-MgApplication -Filter "displayName eq '$AppDisplayName'" -ErrorAction Stop)
    if ($apps.Count -eq 0) { throw "No application found with displayName '$AppDisplayName'." }
    if ($apps.Count -gt 1) { throw "Multiple apps share displayName '$AppDisplayName' - use -ClientId." }
    $ClientId = $apps[0].AppId
    Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null
    Write-OK "Resolved AppId: $ClientId"
}

Write-Step 'Connecting to Microsoft Graph (app-only, certificate)...'
Connect-MgGraph -TenantId $TenantId -ClientId $ClientId -CertificateThumbprint $CertificateThumbprint -NoWelcome
$ctx = Get-MgContext
Write-OK "Connected (app-only) | AuthType: $($ctx.AuthType)"

Write-Step 'Resolving App Registration and Service Principal...'

$app = Get-MgApplication -Filter "appId eq '$ClientId'" -ErrorAction Stop
if (-not $app) { throw "No application found with ClientId '$ClientId'." }
$sp = Get-MgServicePrincipal -Filter "appId eq '$ClientId'" -ErrorAction Stop
if (-not $sp)  { throw "Service principal not found for appId '$ClientId'." }

Write-OK "App       : $($app.DisplayName)"
Write-OK "AppId     : $($app.AppId)"
Write-OK "SP Object : $($sp.Id)"

$spDisplayName = $app.DisplayName

# ==============================================================================
# STEP 3 - MICROSOFT GRAPH API PERMISSIONS
# ==============================================================================

$graphResults = [System.Collections.Generic.List[PSCustomObject]]::new()

if ($SkipGraph) {
    Write-Step 'Microsoft Graph permissions - SKIPPED (-SkipGraph specified)'
}
else {
    Write-Step "Adding Microsoft Graph API permissions ($($requiredGraphPermissions.Count) across all sections)..."

    $graphSp = Get-MgServicePrincipal -Filter "appId eq '00000003-0000-0000-c000-000000000000'" -ErrorAction Stop
    Write-OK "Graph SP resolved (ObjectId: $($graphSp.Id))"

    $roleLookup = @{}
    foreach ($r in $graphSp.AppRoles) { $roleLookup[$r.Value] = $r.Id }

    $existingIds = @(
        Get-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -ErrorAction SilentlyContinue |
        Where-Object { $_.ResourceId -eq $graphSp.Id } |
        Select-Object -ExpandProperty AppRoleId
    )
    Write-OK "Existing Graph role assignments: $($existingIds.Count)"

    foreach ($perm in $requiredGraphPermissions) {
        $name = $perm.Name

        if (-not $roleLookup.ContainsKey($name)) {
            Write-Fail "$name - not found in Microsoft Graph app roles"
            $graphResults.Add([PSCustomObject]@{ Permission = $name; Status = 'NotFound'; Sections = $perm.Sections })
            continue
        }

        $roleId = $roleLookup[$name]

        if ($existingIds -contains $roleId) {
            Write-Skip "$name - already assigned"
            $graphResults.Add([PSCustomObject]@{ Permission = $name; Status = 'AlreadyPresent'; Sections = $perm.Sections })
            continue
        }

        if ($PSCmdlet.ShouldProcess($app.DisplayName, "Add Graph permission: $name")) {
            try {
                New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -BodyParameter @{
                    PrincipalId = $sp.Id
                    ResourceId  = $graphSp.Id
                    AppRoleId   = $roleId
                } | Out-Null
                Write-OK "$name  [$($perm.Sections)]"
                $graphResults.Add([PSCustomObject]@{ Permission = $name; Status = 'Added'; Sections = $perm.Sections })
            }
            catch {
                Write-Fail "$name - $($_.Exception.Message)"
                $graphResults.Add([PSCustomObject]@{ Permission = $name; Status = 'Failed'; Sections = $perm.Sections })
            }
        }
        else {
            Write-Host "    [WhatIf] Would add: $name  [$($perm.Sections)]" -ForegroundColor DarkYellow
            $graphResults.Add([PSCustomObject]@{ Permission = $name; Status = 'WhatIf'; Sections = $perm.Sections })
        }
    }

    Write-Info 'Admin consent granted automatically via role assignment (application-type permissions).'
}

# ==============================================================================
# STEP 4 - PURVIEW / COMPLIANCE ENTRA DIRECTORY ROLES (delegated Graph)
#
# Assigning directory roles requires RoleManagement.ReadWrite.Directory.
# The app-only session used in Step 3 cannot grant itself that permission
# without already having it — a chicken-and-egg problem on first run.
# We therefore reconnect using a delegated session (-AdminUpn) which inherits
# the caller's Privileged Role Administrator / Global Administrator rights.
# ==============================================================================

$complianceResults = [System.Collections.Generic.List[PSCustomObject]]::new()

# Disconnect the app-only session before reconnecting as delegated
Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null

if ($SkipComplianceRoles) {
    Write-Step 'Compliance directory roles - SKIPPED (-SkipComplianceRoles specified)'
}
else {
    if (-not $AdminUpn) {
        Write-Warn 'Compliance directory role assignment requires -AdminUpn (delegated Graph connection).'
        Write-Warn 'Skipping compliance roles step. Re-run with -AdminUpn to complete this step.'
        foreach ($roleDef in $requiredComplianceRoles) {
            $complianceResults.Add([PSCustomObject]@{ Role = $roleDef.DisplayName; Status = 'Skipped'; Sections = $roleDef.Sections })
        }
    }
    else {
        Write-Step "Connecting to Microsoft Graph (delegated as $AdminUpn) for directory role assignments..."
        Write-Info 'Delegated session required: RoleManagement.ReadWrite.Directory cannot be self-assigned app-only.'
        Write-Info 'Disabling WAM broker to prevent popup being hidden behind terminal window.'

        # Disable the WAM broker for this connection — WAM intercepts the auth popup
        # and hides it behind the terminal window in embedded/non-default console hosts.
        # Setting this environment variable forces the standard interactive browser flow.
        $prevWam = $env:MSAL_ALLOW_WAM
        $env:MSAL_ALLOW_WAM = '0'

        $delegatedConnected = $false
        try {
            Connect-MgGraph -TenantId $TenantId `
                -Scopes 'RoleManagement.ReadWrite.Directory', 'Directory.Read.All' `
                -NoWelcome `
                -ErrorAction Stop
            $delegatedCtx = Get-MgContext
            if ($delegatedCtx.Account -ne $AdminUpn) {
                Write-Warn "Connected as $($delegatedCtx.Account) — expected $AdminUpn. Verify this account has Privileged Role Administrator rights."
            }
            $delegatedConnected = $true
            Write-OK "Connected (delegated) as: $($delegatedCtx.Account)"
        }
        catch {
            Write-Fail "Delegated Graph connection failed: $($_.Exception.Message)"
            Write-Warn 'Compliance roles step skipped. Resolve connectivity and re-run.'
            foreach ($roleDef in $requiredComplianceRoles) {
                $complianceResults.Add([PSCustomObject]@{ Role = $roleDef.DisplayName; Status = 'Failed'; Sections = $roleDef.Sections })
            }
        }
        finally {
            # Restore WAM setting to whatever it was before this script changed it
            $env:MSAL_ALLOW_WAM = $prevWam
        }

        if ($delegatedConnected) {
            Write-Step "Assigning Entra ID directory roles for compliance/security access ($($requiredComplianceRoles.Count) roles)..."

            foreach ($roleDef in $requiredComplianceRoles) {
                $roleName       = $roleDef.DisplayName
                $roleTemplateId = $roleDef.TemplateId

                # Activate the directory role in the tenant if not already active
                $dirRole = Get-MgDirectoryRole -Filter "roleTemplateId eq '$roleTemplateId'" -ErrorAction SilentlyContinue
                if (-not $dirRole) {
                    if ($PSCmdlet.ShouldProcess($roleName, 'Activate directory role in tenant')) {
                        try {
                            $dirRole = New-MgDirectoryRole -BodyParameter @{ roleTemplateId = $roleTemplateId } -ErrorAction Stop
                            Write-Info "$roleName - activated in tenant"
                        }
                        catch {
                            Write-Fail "$roleName - could not activate role: $($_.Exception.Message)"
                            $complianceResults.Add([PSCustomObject]@{ Role = $roleName; Status = 'Failed'; Sections = $roleDef.Sections })
                            continue
                        }
                    }
                    else {
                        Write-Host "    [WhatIf] Would activate directory role: $roleName" -ForegroundColor DarkYellow
                        $complianceResults.Add([PSCustomObject]@{ Role = $roleName; Status = 'WhatIf'; Sections = $roleDef.Sections })
                        continue
                    }
                }

                # Check existing membership — use SP-specific call to avoid type/paging misses
                $existingMembers = @(
                    Get-MgDirectoryRoleMemberAsServicePrincipal -DirectoryRoleId $dirRole.Id -All -ErrorAction SilentlyContinue |
                    Select-Object -ExpandProperty Id
                )

                if ($existingMembers -contains $sp.Id) {
                    Write-Skip "$roleName - already assigned"
                    $complianceResults.Add([PSCustomObject]@{ Role = $roleName; Status = 'AlreadyPresent'; Sections = $roleDef.Sections })
                    continue
                }

                if ($PSCmdlet.ShouldProcess($roleName, "Assign to $spDisplayName")) {
                    try {
                        New-MgDirectoryRoleMemberByRef `
                            -DirectoryRoleId $dirRole.Id `
                            -BodyParameter @{ '@odata.id' = "https://graph.microsoft.com/v1.0/directoryObjects/$($sp.Id)" } `
                            -ErrorAction Stop
                        Write-OK "$roleName  [$($roleDef.Sections)]"
                        $complianceResults.Add([PSCustomObject]@{ Role = $roleName; Status = 'Added'; Sections = $roleDef.Sections })
                    }
                    catch {
                        if ($_.Exception.Message -match 'already exist') {
                            Write-Skip "$roleName - already assigned (confirmed via error)"
                            $complianceResults.Add([PSCustomObject]@{ Role = $roleName; Status = 'AlreadyPresent'; Sections = $roleDef.Sections })
                        }
                        else {
                            Write-Fail "$roleName - $($_.Exception.Message)"
                            $complianceResults.Add([PSCustomObject]@{ Role = $roleName; Status = 'Failed'; Sections = $roleDef.Sections })
                        }
                    }
                }
                else {
                    Write-Host "    [WhatIf] Would assign role: $roleName  [$($roleDef.Sections)]" -ForegroundColor DarkYellow
                    $complianceResults.Add([PSCustomObject]@{ Role = $roleName; Status = 'WhatIf'; Sections = $roleDef.Sections })
                }
            }

            Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null
            Write-Info 'Disconnected delegated Graph session'
        }
    }
}

# ==============================================================================
# STEP 5 - EXCHANGE ONLINE RBAC ROLE GROUPS (delegated — platform requirement)
#
# Add-RoleGroupMember is not available in app-only EXO sessions.
# A delegated admin credential is required for this step only.
#
# Role groups used:
#   "View-Only Organization Management" — the correct cloud-only EXO group that
#     covers mailboxes, recipients, transport config, and EOP/Defender policies.
#     ("View-Only Recipients" and "View-Only Configuration" are on-prem/hybrid only.)
#   "Compliance Management" — EXO-side compliance config reads.
# ==============================================================================

$exoResults = [System.Collections.Generic.List[PSCustomObject]]::new()

if ($SkipExchangeRbac) {
    Write-Step 'Exchange Online RBAC - SKIPPED (-SkipExchangeRbac specified)'
}
else {
    Write-Step "Connecting to Exchange Online (delegated as $AdminUpn)..."
    Write-Info 'Note: Add-RoleGroupMember requires a delegated session — this is a platform constraint.'

    $exoConnected = $false
    try {
        Connect-ExchangeOnline -UserPrincipalName $AdminUpn -ShowBanner:$false -ErrorAction Stop
        Write-OK 'Connected to Exchange Online'
        $exoConnected = $true
    }
    catch {
        Write-Fail "Connection failed: $($_.Exception.Message)"
        Write-Warn 'Exchange Online RBAC step skipped. Resolve connectivity and re-run.'
    }

    if ($exoConnected) {
        Write-Step "Adding '$spDisplayName' to Exchange Online role groups ($($requiredExoRoleGroups.Count) groups)..."

        foreach ($entry in $requiredExoRoleGroups) {
            $rg = $entry.RoleGroup

            $alreadyMember = $false
            try {
                $members = @(Get-RoleGroupMember -Identity $rg -ErrorAction Stop | Select-Object -ExpandProperty Name)
                if ($members -contains $spDisplayName) { $alreadyMember = $true }
            }
            catch {
                Write-Warn "$rg - could not query members: $($_.Exception.Message)"
            }

            if ($alreadyMember) {
                Write-Skip "$rg - already a member"
                $exoResults.Add([PSCustomObject]@{ RoleGroup = $rg; Status = 'AlreadyPresent'; Sections = $entry.Sections })
                continue
            }

            if ($PSCmdlet.ShouldProcess($rg, "Add '$spDisplayName'")) {
                try {
                    Add-RoleGroupMember -Identity $rg -Member $spDisplayName -ErrorAction Stop
                    Write-OK "$rg  [$($entry.Sections)]"
                    $exoResults.Add([PSCustomObject]@{ RoleGroup = $rg; Status = 'Added'; Sections = $entry.Sections })
                }
                catch {
                    # Gracefully handle "already a member" errors from EXO (non-terminating wording varies)
                    if ($_.Exception.Message -match 'already a member') {
                        Write-Skip "$rg - already a member (confirmed via error)"
                        $exoResults.Add([PSCustomObject]@{ RoleGroup = $rg; Status = 'AlreadyPresent'; Sections = $entry.Sections })
                    }
                    else {
                        Write-Fail "$rg - $($_.Exception.Message)"
                        $exoResults.Add([PSCustomObject]@{ RoleGroup = $rg; Status = 'Failed'; Sections = $entry.Sections })
                    }
                }
            }
            else {
                Write-Host "    [WhatIf] Would add '$spDisplayName' to EXO role group: $rg  [$($entry.Sections)]" -ForegroundColor DarkYellow
                $exoResults.Add([PSCustomObject]@{ RoleGroup = $rg; Status = 'WhatIf'; Sections = $entry.Sections })
            }
        }

        Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue
        Write-Info 'Disconnected from Exchange Online'
    }
}

# ==============================================================================
# FINAL SUMMARY
# ==============================================================================

Write-Banner -Title 'Configuration Summary'

Write-Host "  App Registration : $($app.DisplayName)" -ForegroundColor White
Write-Host "  AppId            : $($app.AppId)"        -ForegroundColor White
Write-Host "  Tenant           : $TenantId"            -ForegroundColor White
Write-Host ''

function Write-StepSummary {
    param([string]$Label, [object[]]$Results, [string]$ItemField)
    $added    = @($Results | Where-Object Status -eq 'Added').Count
    $present  = @($Results | Where-Object Status -eq 'AlreadyPresent').Count
    $failed   = @($Results | Where-Object Status -eq 'Failed').Count
    $notfound = @($Results | Where-Object Status -eq 'NotFound').Count
    $whatif   = @($Results | Where-Object Status -eq 'WhatIf').Count
    $skipped  = @($Results | Where-Object Status -eq 'Skipped').Count
    $pad      = '-' * [Math]::Max(0, 52 - $Label.Length)

    Write-Host "  -- $Label $pad" -ForegroundColor Cyan
    Write-Host "     Added           : $added"   -ForegroundColor $(if ($added -gt 0) { 'Green' } else { 'DarkGray' })
    Write-Host "     Already present : $present" -ForegroundColor DarkGray
    if ($skipped -gt 0) { Write-Host "     Skipped         : $skipped" -ForegroundColor DarkGray }
    if ($failed -gt 0) {
        Write-Host "     Failed          : $failed" -ForegroundColor Magenta
        $Results | Where-Object Status -eq 'Failed'   | ForEach-Object { Write-Host "       - $($_.$ItemField)" -ForegroundColor Magenta }
    }
    if ($notfound -gt 0) {
        Write-Host "     Not found       : $notfound" -ForegroundColor Yellow
        $Results | Where-Object Status -eq 'NotFound' | ForEach-Object { Write-Host "       - $($_.$ItemField)" -ForegroundColor Yellow }
    }
    if ($whatif -gt 0) { Write-Host "     [WhatIf]        : $whatif" -ForegroundColor DarkYellow }
    Write-Host ''
}

if (-not $SkipGraph)           { Write-StepSummary -Label 'Microsoft Graph API Permissions'             -Results $graphResults      -ItemField 'Permission' }
if (-not $SkipComplianceRoles) { Write-StepSummary -Label 'Entra ID Compliance / Security Roles'        -Results $complianceResults -ItemField 'Role'       }
if (-not $SkipExchangeRbac)    { Write-StepSummary -Label 'Exchange Online RBAC Role Groups'            -Results $exoResults        -ItemField 'RoleGroup'  }

$totalFailed = (
    @($graphResults      | Where-Object { $_.Status -in 'Failed', 'NotFound' }).Count +
    @($complianceResults | Where-Object Status -eq 'Failed').Count +
    @($exoResults        | Where-Object Status -eq 'Failed').Count
)

if ($WhatIfPreference) {
    Write-Host '  *** WhatIf run complete. No changes were made. ***' -ForegroundColor Yellow
    Write-Host '      Re-run without -WhatIf to apply the changes shown above.' -ForegroundColor DarkGray
}
elseif ($totalFailed -gt 0) {
    Write-Host '  Configuration completed with errors.' -ForegroundColor Yellow
    Write-Host '  Review failures above and re-run — already-present items are skipped automatically.' -ForegroundColor DarkGray
}
else {
    Write-Host '  All permissions configured successfully.' -ForegroundColor Green
    Write-Host '  The app registration is ready for use with Invoke-M365Assessment.ps1.' -ForegroundColor Green
}

Write-Host ''