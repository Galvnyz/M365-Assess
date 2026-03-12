#Requires -Version 7.0
<#
.SYNOPSIS
    Configures all permissions required to run ScubaGear in non-interactive (app-only)
    mode on an existing App Registration.

.DESCRIPTION
    Source: https://github.com/cisagov/ScubaGear/blob/main/docs/prerequisites/noninteractive.md

    Configures the following across all six ScubaGear products:

      Product                  Permissions / Roles
      ───────────────────────  ──────────────────────────────────────────────────────
      Entra ID                 Graph API (Application): Directory.Read.All,
                               Policy.Read.All, PrivilegedAccess.Read.AzureADGroup,
                               PrivilegedEligibilitySchedule.Read.AzureADGroup,
                               RoleManagement.Read.Directory,
                               RoleManagementPolicy.Read.AzureADGroup, User.Read.All

      Defender for Office 365  Entra ID directory role: Global Reader

      Exchange Online          Office 365 Exchange Online API (Application):
                               Exchange.ManageAsApp
                               Entra ID directory role: Global Reader

      Power Platform           New-PowerAppManagementApp registration
                               (requires interactive Power Platform admin login —
                               platform limitation, cannot be automated app-only)

      SharePoint Online        SharePoint API (Application): Sites.FullControl.All
                               NOTE: Write privilege is required by the SharePoint API
                               to read admin centre configuration. ScubaGear itself
                               never writes to SharePoint.

      Microsoft Teams          Entra ID directory role: Global Reader

    Authentication model
    ────────────────────
      Graph API permissions    — app-only via certificate (ClientId + thumbprint)
      Exchange.ManageAsApp     — app-only via certificate (same session)
      Sites.FullControl.All    — app-only via certificate (same session)
      Global Reader role       — delegated Graph session (-AdminUpn) because
                                 New-MgDirectoryRoleMemberByRef requires
                                 RoleManagement.ReadWrite.Directory which cannot
                                 be self-assigned app-only on first run
      Power Platform           — PS 5.1 child process (powershell.exe) because
                                 Microsoft.PowerApps.Administration.PowerShell only
                                 supports PS 5.1. The child process handles its own
                                 interactive auth via Add-PowerAppsAccount.

.PARAMETER TenantId
    Tenant ID or domain (e.g. 'contoso.onmicrosoft.com').

.PARAMETER ClientId
    Application (Client) ID of the existing App Registration to configure.

.PARAMETER AppDisplayName
    Display name of the App Registration. Used when -ClientId is not supplied.

.PARAMETER CertificateThumbprint
    Thumbprint of the certificate in Cert:\CurrentUser\My used for app-only auth.
    Must also be uploaded to the App Registration in Entra ID.

.PARAMETER AdminUpn
    UPN of a Privileged Role Administrator or Global Administrator account.
    Used for the delegated Graph session that assigns the Global Reader directory role.
    Required unless -SkipRoleAssignments is specified.

.PARAMETER PowerPlatformAdminUpn
    UPN of a Power Platform Administrator or Global Administrator account.
    Used for the interactive Power Platform registration step.
    Required unless -SkipPowerPlatform is specified.

.PARAMETER SkipGraphPermissions
    Skip Microsoft Graph and Exchange Online / SharePoint API permission assignments.

.PARAMETER SkipRoleAssignments
    Skip the Global Reader Entra ID directory role assignment.

.PARAMETER SkipPowerPlatform
    Skip the Power Platform service principal registration step.

.PARAMETER M365Environment
    Target cloud environment. Valid values: commercial, gcc, gcchigh, dod.
    Defaults to 'commercial'. GCC High requires additional permissions — see notes.

.PARAMETER WhatIf
    Preview changes without applying them.

.EXAMPLE
    PS> .\Add-ScubaGearPermissions.ps1 `
            -TenantId              'contoso.onmicrosoft.com' `
            -ClientId              '00000000-0000-0000-0000-000000000000' `
            -CertificateThumbprint 'ABC123DEF456' `
            -AdminUpn              'admin@contoso.onmicrosoft.com' `
            -PowerPlatformAdminUpn 'admin@contoso.onmicrosoft.com'

.EXAMPLE
    PS> .\Add-ScubaGearPermissions.ps1 `
            -TenantId              'contoso.onmicrosoft.com' `
            -ClientId              '00000000-0000-0000-0000-000000000000' `
            -CertificateThumbprint 'ABC123DEF456' `
            -AdminUpn              'admin@contoso.onmicrosoft.com' `
            -SkipPowerPlatform

    All permissions except Power Platform registration.

.EXAMPLE
    PS> .\Add-ScubaGearPermissions.ps1 `
            -TenantId              'contoso.onmicrosoft.com' `
            -ClientId              '00000000-0000-0000-0000-000000000000' `
            -CertificateThumbprint 'ABC123DEF456' `
            -AdminUpn              'admin@contoso.onmicrosoft.com' `
            -PowerPlatformAdminUpn 'admin@contoso.onmicrosoft.com' `
            -WhatIf

.NOTES
    Version  : 1.0.0
    Source   : https://github.com/cisagov/ScubaGear/blob/main/docs/prerequisites/noninteractive.md

    Required modules:
        Install-Module Microsoft.Graph.Authentication       -Scope CurrentUser
        Install-Module Microsoft.Graph.Applications        -Scope CurrentUser
        Install-Module Microsoft.Graph.Identity.Governance -Scope CurrentUser
        Install-Module ExchangeOnlineManagement            -Scope CurrentUser
        Install-Module Microsoft.PowerApps.Administration.PowerShell -Scope CurrentUser

    GCC High note:
        Exchange.ManageAsApp must be added from BOTH:
          - Office 365 Exchange Online (00000002-0000-0ff1-ce00-000000000000)
          - Microsoft Exchange Online Protection
        Sites.FullControl.All must be added from:
          - Office 365 SharePoint Online (GCC High-specific API, not the commercial SharePoint API)
        This script handles the commercial case. Pass -M365Environment gcchigh to apply
        the GCC High-specific API IDs.
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
    [string]$PowerPlatformAdminUpn,

    [Parameter()]
    [switch]$SkipGraphPermissions,

    [Parameter()]
    [switch]$SkipRoleAssignments,

    [Parameter()]
    [switch]$SkipPowerPlatform,

    [Parameter()]
    [ValidateSet('commercial', 'gcc', 'gcchigh', 'dod')]
    [string]$M365Environment = 'commercial'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ==============================================================================
# PERMISSION DEFINITIONS
# Source: noninteractive.md permission table
# ==============================================================================

# Microsoft Graph application permissions — assignable app-only
# (AppId: 00000003-0000-0000-c000-000000000000)
$graphPermissions = @(
    @{ Name = 'Directory.Read.All';                              Product = 'Entra ID';   Reason = 'Read directory objects including users, groups, devices, and service principals' }
    @{ Name = 'Policy.Read.All';                                 Product = 'Entra ID';   Reason = 'Read all policies including Conditional Access and auth methods' }
    @{ Name = 'PrivilegedEligibilitySchedule.Read.AzureADGroup'; Product = 'Entra ID';   Reason = 'Read PIM eligible group membership schedules' }
    @{ Name = 'RoleManagement.Read.Directory';                   Product = 'Entra ID';   Reason = 'Read Entra ID role assignments' }
    @{ Name = 'User.Read.All';                                   Product = 'Entra ID';   Reason = 'Read all user profiles and properties' }
)

# Microsoft Graph application permissions — sensitive, require delegated assignment
# These two trigger Authorization_RequestDenied in app-only sessions even with a
# valid certificate. They are assigned during the delegated Graph step (Step 6)
# alongside the Global Reader role assignment.
$graphPermissionsDelegated = @(
    @{ Name = 'PrivilegedAccess.Read.AzureADGroup';     Product = 'Entra ID'; Reason = 'Read PIM group assignments and active privileged access — requires delegated assignment' }
    @{ Name = 'RoleManagementPolicy.Read.AzureADGroup'; Product = 'Entra ID'; Reason = 'Read PIM role management policies for groups — requires delegated assignment' }
)

# Office 365 Exchange Online application permissions
# Commercial / GCC AppId: 00000002-0000-0ff1-ce00-000000000000
# GCC High also requires this from Exchange Online Protection — handled separately
$exoApiAppId = '00000002-0000-0ff1-ce00-000000000000'
$exoPermissions = @(
    @{ Name = 'Exchange.ManageAsApp'; Product = 'Exchange Online / Defender'; Reason = 'Allows app-only authentication to Exchange Online PowerShell for configuration reads' }
)

# SharePoint API application permissions
# Commercial / GCC AppId: 00000003-0000-0ff1-ce00-000000000000
# GCC High uses a different API — flag this if gcchigh is selected
$spoApiAppId = '00000003-0000-0ff1-ce00-000000000000'
$spoPermissions = @(
    @{ Name = 'Sites.FullControl.All'; Product = 'SharePoint Online'; Reason = 'Required by SharePoint API to read admin centre configuration (write privilege is a platform requirement — ScubaGear never writes)' }
)

# Entra ID directory roles (Global Reader covers Defender, Exchange Online, and Teams)
$directoryRoles = @(
    @{
        DisplayName  = 'Global Reader'
        TemplateId   = 'f2ef992c-3afb-46b9-b7cf-a126ee74c451'
        Products     = 'Defender for Office 365, Exchange Online, Microsoft Teams'
        Reason       = 'Read-only access to all admin centre configurations across Defender, Exchange, and Teams'
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

function Add-AppRoleAssignment {
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [string]$PermissionName,
        [string]$Product,
        [string]$Reason,
        [string]$ResourceSpId,
        [hashtable]$RoleLookup,
        [string[]]$ExistingIds,
        [string]$PrincipalId,
        [System.Collections.Generic.List[PSCustomObject]]$Results
    )

    if (-not $RoleLookup.ContainsKey($PermissionName)) {
        Write-Fail "$PermissionName - not found in resource app roles"
        $Results.Add([PSCustomObject]@{ Permission = $PermissionName; Status = 'NotFound'; Product = $Product })
        return
    }

    $roleId = $RoleLookup[$PermissionName]

    if ($ExistingIds -contains $roleId) {
        Write-Skip "$PermissionName - already assigned"
        $Results.Add([PSCustomObject]@{ Permission = $PermissionName; Status = 'AlreadyPresent'; Product = $Product })
        return
    }

    if ($PSCmdlet.ShouldProcess($PermissionName, "Add app role assignment ($Reason)")) {
        try {
            New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $PrincipalId -BodyParameter @{
                PrincipalId = $PrincipalId
                ResourceId  = $ResourceSpId
                AppRoleId   = $roleId
            } -ErrorAction Stop | Out-Null
            Write-OK "$PermissionName  [$Product]"
            $Results.Add([PSCustomObject]@{ Permission = $PermissionName; Status = 'Added'; Product = $Product })
        }
        catch {
            Write-Fail "$PermissionName - $($_.Exception.Message)"
            $Results.Add([PSCustomObject]@{ Permission = $PermissionName; Status = 'Failed'; Product = $Product })
        }
    }
    else {
        Write-Host "    [WhatIf] Would add: $PermissionName  [$Product]" -ForegroundColor DarkYellow
        $Results.Add([PSCustomObject]@{ Permission = $PermissionName; Status = 'WhatIf'; Product = $Product })
    }
}

# ==============================================================================
# BANNER + PRE-FLIGHT
# ==============================================================================

Write-Banner -Title 'ScubaGear Non-Interactive Permission Configurator v1.0.0'

if ($WhatIfPreference) {
    Write-Host '  *** WHATIF MODE - no changes will be made ***' -ForegroundColor Yellow
    Write-Host ''
}

if ($M365Environment -eq 'gcchigh') {
    Write-Warn 'GCC High environment selected.'
    Write-Info 'Exchange.ManageAsApp will also be added from the Exchange Online Protection API.'
    Write-Info 'Sites.FullControl.All will be added from the GCC High SharePoint API.'
    Write-Host ''
}

if (-not $SkipRoleAssignments -and -not $AdminUpn) {
    throw '-AdminUpn is required for the Global Reader directory role assignment. ' +
          'Provide -AdminUpn or use -SkipRoleAssignments to skip that step.'
}

if (-not $SkipPowerPlatform -and -not (Test-Path "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe")) {
    Write-Warn 'powershell.exe (PS 5.1) not found — Power Platform step will fail. Use -SkipPowerPlatform to skip.'
}

# ==============================================================================
# STEP 1 - MODULE VALIDATION
# ==============================================================================

Write-Step 'Validating required PowerShell modules...'

$moduleChecks = @(
    @{ Name = 'Microsoft.Graph.Authentication';                      Required = $true }
    @{ Name = 'Microsoft.Graph.Applications';                        Required = $true }
    @{ Name = 'Microsoft.Graph.Identity.Governance';                 Required = (-not $SkipRoleAssignments) }
    @{ Name = 'Microsoft.PowerApps.Administration.PowerShell';       Required = (-not $SkipPowerPlatform) }
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
# STEP 2 - VALIDATE CERTIFICATE AND RESOLVE APP REGISTRATION (app-only)
# ==============================================================================

Write-Step 'Validating certificate...'

$cert = Get-Item "Cert:\CurrentUser\My\$CertificateThumbprint" -ErrorAction SilentlyContinue
if (-not $cert) {
    throw "Certificate '$CertificateThumbprint' not found in Cert:\CurrentUser\My."
}
Write-OK "Certificate: $($cert.Subject)  [Expires: $($cert.NotAfter.ToString('yyyy-MM-dd'))]"

# Resolve AppId from display name if needed (brief delegated connection)
if ($PSCmdlet.ParameterSetName -eq 'ByDisplayName') {
    Write-Step 'Resolving AppId from display name...'
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
Write-OK "Connected (app-only) | AuthType: $((Get-MgContext).AuthType)"

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
# STEP 3 - MICROSOFT GRAPH API PERMISSIONS (app-only)
# Covers: Entra ID product
# ==============================================================================

$graphResults = [System.Collections.Generic.List[PSCustomObject]]::new()

if ($SkipGraphPermissions) {
    Write-Step 'Graph / EXO / SharePoint API permissions - SKIPPED (-SkipGraphPermissions specified)'
}
else {
    Write-Step "Adding Microsoft Graph API permissions ($($graphPermissions.Count) permissions — Entra ID)..."

    $graphSp = Get-MgServicePrincipal -Filter "appId eq '00000003-0000-0000-c000-000000000000'" -ErrorAction Stop
    Write-OK "Microsoft Graph SP resolved (ObjectId: $($graphSp.Id))"

    $graphRoleLookup = @{}
    foreach ($r in $graphSp.AppRoles) { $graphRoleLookup[$r.Value] = $r.Id }

    $existingGraphIds = @(
        Get-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -ErrorAction SilentlyContinue |
        Where-Object { $_.ResourceId -eq $graphSp.Id } |
        Select-Object -ExpandProperty AppRoleId
    )
    Write-OK "Existing Graph role assignments: $($existingGraphIds.Count)"

    foreach ($perm in $graphPermissions) {
        Add-AppRoleAssignment `
            -PermissionName $perm.Name `
            -Product        $perm.Product `
            -Reason         $perm.Reason `
            -ResourceSpId   $graphSp.Id `
            -RoleLookup     $graphRoleLookup `
            -ExistingIds    $existingGraphIds `
            -PrincipalId    $sp.Id `
            -Results        $graphResults
    }

    # ==============================================================================
    # STEP 4 - EXCHANGE ONLINE API PERMISSION (app-only)
    # Covers: Exchange Online, Defender for Office 365
    # API: Office 365 Exchange Online (00000002-0000-0ff1-ce00-000000000000)
    # ==============================================================================

    Write-Step "Adding Exchange Online API permission (Exchange.ManageAsApp — Exchange Online / Defender)..."

    # Resolve the Office 365 Exchange Online service principal
    $exoSp = Get-MgServicePrincipal -Filter "appId eq '$exoApiAppId'" -ErrorAction Stop
    if (-not $exoSp) { throw "Office 365 Exchange Online service principal not found (AppId: $exoApiAppId)." }
    Write-OK "Exchange Online SP resolved (ObjectId: $($exoSp.Id))"

    $exoRoleLookup = @{}
    foreach ($r in $exoSp.AppRoles) { $exoRoleLookup[$r.Value] = $r.Id }

    $existingExoIds = @(
        Get-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -ErrorAction SilentlyContinue |
        Where-Object { $_.ResourceId -eq $exoSp.Id } |
        Select-Object -ExpandProperty AppRoleId
    )

    foreach ($perm in $exoPermissions) {
        Add-AppRoleAssignment `
            -PermissionName $perm.Name `
            -Product        $perm.Product `
            -Reason         $perm.Reason `
            -ResourceSpId   $exoSp.Id `
            -RoleLookup     $exoRoleLookup `
            -ExistingIds    $existingExoIds `
            -PrincipalId    $sp.Id `
            -Results        $graphResults
    }

    # GCC High: also add Exchange.ManageAsApp from Exchange Online Protection
    if ($M365Environment -eq 'gcchigh') {
        Write-Step 'GCC High: Adding Exchange.ManageAsApp from Exchange Online Protection...'
        $eopSp = Get-MgServicePrincipal -Filter "displayName eq 'Microsoft Exchange Online Protection'" -ErrorAction SilentlyContinue
        if ($eopSp) {
            $eopRoleLookup = @{}
            foreach ($r in $eopSp.AppRoles) { $eopRoleLookup[$r.Value] = $r.Id }
            $existingEopIds = @(
                Get-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -ErrorAction SilentlyContinue |
                Where-Object { $_.ResourceId -eq $eopSp.Id } |
                Select-Object -ExpandProperty AppRoleId
            )
            Add-AppRoleAssignment `
                -PermissionName 'Exchange.ManageAsApp' `
                -Product        'Exchange Online Protection (GCC High)' `
                -Reason         'GCC High requirement: Exchange.ManageAsApp from EOP API in addition to EXO API' `
                -ResourceSpId   $eopSp.Id `
                -RoleLookup     $eopRoleLookup `
                -ExistingIds    $existingEopIds `
                -PrincipalId    $sp.Id `
                -Results        $graphResults
        }
        else {
            Write-Warn 'Exchange Online Protection SP not found in tenant — skipping GCC High EOP permission.'
        }
    }

    # ==============================================================================
    # STEP 5 - SHAREPOINT API PERMISSION (app-only)
    # Covers: SharePoint Online
    # API: SharePoint (00000003-0000-0ff1-ce00-000000000000) for commercial/gcc
    #      Office 365 SharePoint Online (different AppId) for gcchigh
    # ==============================================================================

    Write-Step "Adding SharePoint API permission (Sites.FullControl.All — SharePoint Online)..."
    Write-Info 'Note: Sites.FullControl.All is required by the SharePoint API to read admin centre config.'
    Write-Info 'ScubaGear itself never uses the write privilege — this is a platform limitation.'

    if ($M365Environment -eq 'gcchigh') {
        $spoSp = Get-MgServicePrincipal -Filter "displayName eq 'Office 365 SharePoint Online'" -ErrorAction SilentlyContinue
        if (-not $spoSp) { Write-Warn 'GCC High SharePoint SP not found. Skipping SharePoint permission.' }
    }
    else {
        $spoSp = Get-MgServicePrincipal -Filter "appId eq '$spoApiAppId'" -ErrorAction SilentlyContinue
        if (-not $spoSp) { Write-Warn "SharePoint SP not found (AppId: $spoApiAppId). Skipping SharePoint permission." }
    }

    if ($spoSp) {
        Write-OK "SharePoint SP resolved: $($spoSp.DisplayName) (ObjectId: $($spoSp.Id))"

        $spoRoleLookup = @{}
        foreach ($r in $spoSp.AppRoles) { $spoRoleLookup[$r.Value] = $r.Id }

        $existingSpoIds = @(
            Get-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -ErrorAction SilentlyContinue |
            Where-Object { $_.ResourceId -eq $spoSp.Id } |
            Select-Object -ExpandProperty AppRoleId
        )

        foreach ($perm in $spoPermissions) {
            Add-AppRoleAssignment `
                -PermissionName $perm.Name `
                -Product        $perm.Product `
                -Reason         $perm.Reason `
                -ResourceSpId   $spoSp.Id `
                -RoleLookup     $spoRoleLookup `
                -ExistingIds    $existingSpoIds `
                -PrincipalId    $sp.Id `
                -Results        $graphResults
        }
    }

    Write-Info 'Admin consent granted automatically via role assignment (application-type permissions).'
}

Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null

# ==============================================================================
# STEP 6 - GLOBAL READER DIRECTORY ROLE (delegated Graph)
# Covers: Defender for Office 365, Exchange Online, Microsoft Teams
#
# Requires RoleManagement.ReadWrite.Directory — cannot be self-assigned app-only.
# Uses delegated session with WAM disabled to prevent popup being hidden.
# ==============================================================================

$roleResults = [System.Collections.Generic.List[PSCustomObject]]::new()

if ($SkipRoleAssignments) {
    Write-Step 'Directory role assignments - SKIPPED (-SkipRoleAssignments specified)'
}
else {
    Write-Step "Connecting to Microsoft Graph (delegated as $AdminUpn) for role assignment and sensitive permissions..."
    Write-Info 'Delegated session required: RoleManagement.ReadWrite.Directory + AppRoleAssignment.ReadWrite.All'
    Write-Info 'Two Graph permissions (PrivilegedAccess / RoleManagementPolicy) also require delegated assignment.'

    # Disable WAM to prevent the auth popup being hidden behind the terminal window
    $prevWam = $env:MSAL_ALLOW_WAM
    $env:MSAL_ALLOW_WAM = '0'

    $delegatedConnected = $false
    try {
        Connect-MgGraph -TenantId $TenantId `
            -Scopes 'RoleManagement.ReadWrite.Directory', 'Directory.Read.All', 'AppRoleAssignment.ReadWrite.All' `
            -NoWelcome `
            -ErrorAction Stop
        $delegatedCtx = Get-MgContext
        if ($delegatedCtx.Account -ne $AdminUpn) {
            Write-Warn "Connected as $($delegatedCtx.Account) — expected $AdminUpn. Verify Privileged Role Administrator rights."
        }
        $delegatedConnected = $true
        Write-OK "Connected (delegated) as: $($delegatedCtx.Account)"
    }
    catch {
        Write-Fail "Delegated Graph connection failed: $($_.Exception.Message)"
        Write-Warn 'Directory role assignment and sensitive permission steps skipped. Re-run to retry.'
        foreach ($roleDef in $directoryRoles) {
            $roleResults.Add([PSCustomObject]@{ Role = $roleDef.DisplayName; Status = 'Failed'; Products = $roleDef.Products })
        }
        foreach ($perm in $graphPermissionsDelegated) {
            $graphResults.Add([PSCustomObject]@{ Permission = $perm.Name; Status = 'Failed'; Product = $perm.Product })
        }
    }
    finally {
        $env:MSAL_ALLOW_WAM = $prevWam
    }

    if ($delegatedConnected) {
        # Assign the two sensitive Graph permissions that cannot be assigned app-only
        Write-Step "Adding sensitive Graph permissions via delegated session ($($graphPermissionsDelegated.Count) permissions)..."

        $graphSpDelegated = Get-MgServicePrincipal -Filter "appId eq '00000003-0000-0000-c000-000000000000'" -ErrorAction Stop
        $graphRoleLookupDelegated = @{}
        foreach ($r in $graphSpDelegated.AppRoles) { $graphRoleLookupDelegated[$r.Value] = $r.Id }
        $existingGraphIdsDelegated = @(
            Get-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -ErrorAction SilentlyContinue |
            Where-Object { $_.ResourceId -eq $graphSpDelegated.Id } |
            Select-Object -ExpandProperty AppRoleId
        )

        foreach ($perm in $graphPermissionsDelegated) {
            Add-AppRoleAssignment `
                -PermissionName $perm.Name `
                -Product        $perm.Product `
                -Reason         $perm.Reason `
                -ResourceSpId   $graphSpDelegated.Id `
                -RoleLookup     $graphRoleLookupDelegated `
                -ExistingIds    $existingGraphIdsDelegated `
                -PrincipalId    $sp.Id `
                -Results        $graphResults
        }

        Write-Step "Assigning Entra ID directory roles ($($directoryRoles.Count) role)..."

        foreach ($roleDef in $directoryRoles) {
            $roleName       = $roleDef.DisplayName
            $roleTemplateId = $roleDef.TemplateId

            # Activate the role in the tenant if not yet active
            $dirRole = Get-MgDirectoryRole -Filter "roleTemplateId eq '$roleTemplateId'" -ErrorAction SilentlyContinue
            if (-not $dirRole) {
                if ($PSCmdlet.ShouldProcess($roleName, 'Activate directory role in tenant')) {
                    try {
                        $dirRole = New-MgDirectoryRole -BodyParameter @{ roleTemplateId = $roleTemplateId } -ErrorAction Stop
                        Write-Info "$roleName - activated in tenant"
                    }
                    catch {
                        Write-Fail "$roleName - could not activate: $($_.Exception.Message)"
                        $roleResults.Add([PSCustomObject]@{ Role = $roleName; Status = 'Failed'; Products = $roleDef.Products })
                        continue
                    }
                }
                else {
                    Write-Host "    [WhatIf] Would activate directory role: $roleName" -ForegroundColor DarkYellow
                    $roleResults.Add([PSCustomObject]@{ Role = $roleName; Status = 'WhatIf'; Products = $roleDef.Products })
                    continue
                }
            }

            # Check existing membership (SP-specific, fully paged)
            $existingMembers = @(
                Get-MgDirectoryRoleMemberAsServicePrincipal -DirectoryRoleId $dirRole.Id -All -ErrorAction SilentlyContinue |
                Select-Object -ExpandProperty Id
            )

            if ($existingMembers -contains $sp.Id) {
                Write-Skip "$roleName - already assigned"
                $roleResults.Add([PSCustomObject]@{ Role = $roleName; Status = 'AlreadyPresent'; Products = $roleDef.Products })
                continue
            }

            if ($PSCmdlet.ShouldProcess($roleName, "Assign to $spDisplayName")) {
                try {
                    New-MgDirectoryRoleMemberByRef `
                        -DirectoryRoleId $dirRole.Id `
                        -BodyParameter @{ '@odata.id' = "https://graph.microsoft.com/v1.0/directoryObjects/$($sp.Id)" } `
                        -ErrorAction Stop
                    Write-OK "$roleName  [$($roleDef.Products)]"
                    $roleResults.Add([PSCustomObject]@{ Role = $roleName; Status = 'Added'; Products = $roleDef.Products })
                }
                catch {
                    if ($_.Exception.Message -match 'already exist') {
                        Write-Skip "$roleName - already assigned (confirmed via error)"
                        $roleResults.Add([PSCustomObject]@{ Role = $roleName; Status = 'AlreadyPresent'; Products = $roleDef.Products })
                    }
                    else {
                        Write-Fail "$roleName - $($_.Exception.Message)"
                        $roleResults.Add([PSCustomObject]@{ Role = $roleName; Status = 'Failed'; Products = $roleDef.Products })
                    }
                }
            }
            else {
                Write-Host "    [WhatIf] Would assign role: $roleName  [$($roleDef.Products)]" -ForegroundColor DarkYellow
                $roleResults.Add([PSCustomObject]@{ Role = $roleName; Status = 'WhatIf'; Products = $roleDef.Products })
            }
        }

        Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null
        Write-Info 'Disconnected delegated Graph session'
    }
}

# ==============================================================================
# STEP 7 - POWER PLATFORM REGISTRATION (PS 5.1 child process)
# Covers: Power Platform product
#
# Add-PowerAppsAccount / New-PowerAppManagementApp are from
# Microsoft.PowerApps.Administration.PowerShell which only supports PS 5.1.
# This script requires PS 7, so the Power Platform step is delegated to a
# child powershell.exe (PS 5.1) process via -Command.
#
# This is a delegated-only operation — explicit platform limitation.
# Source: https://learn.microsoft.com/en-us/power-platform/admin/powershell-create-service-principal#limitations-of-service-principals
# ==============================================================================

$ppResults = [System.Collections.Generic.List[PSCustomObject]]::new()

if ($SkipPowerPlatform) {
    Write-Step 'Power Platform registration - SKIPPED (-SkipPowerPlatform specified)'
}
else {
    Write-Step 'Registering service principal with Power Platform (PS 5.1 child process)...'
    Write-Info 'Microsoft.PowerApps.Administration.PowerShell only supports PS 5.1.'
    Write-Info 'This step runs in a child powershell.exe process. A browser window will open for auth.'
    if ($PowerPlatformAdminUpn) { Write-Info "Power Platform admin: $PowerPlatformAdminUpn" }

    $ppEndpoint = switch ($M365Environment) {
        'gcc'     { 'usgov' }
        'gcchigh' { 'usgovhigh' }
        'dod'     { 'dod' }
        default   { 'prod' }
    }
    Write-Info "Power Platform endpoint: $ppEndpoint"

    # Verify powershell.exe (PS 5.1) is available
    $ps51 = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    if (-not (Test-Path $ps51)) {
        Write-Fail "powershell.exe not found at $ps51 — cannot run PS 5.1 child process."
        Write-Warn 'Run the Power Platform registration manually in a PS 5.1 window:'
        Write-Info "  Import-Module Microsoft.PowerApps.Administration.PowerShell"
        Write-Info "  Add-PowerAppsAccount -Endpoint $ppEndpoint -TenantID $TenantId"
        Write-Info "  New-PowerAppManagementApp -ApplicationId $ClientId"
        $ppResults.Add([PSCustomObject]@{ Step = 'Registration'; Status = 'Failed' })
    }
    else {
        $ps51Script = @"
`$ErrorActionPreference = 'Stop'
try {
    Import-Module Microsoft.PowerApps.Administration.PowerShell -ErrorAction Stop

    # Check if already registered
    try {
        `$existing = Get-PowerAppManagementApp -ApplicationId '$ClientId' -ErrorAction SilentlyContinue
    } catch { `$existing = `$null }

    if (`$existing) {
        Write-Output 'STATUS:AlreadyPresent'
    } else {
        Add-PowerAppsAccount -Endpoint '$ppEndpoint' -TenantID '$TenantId' -ErrorAction Stop
        New-PowerAppManagementApp -ApplicationId '$ClientId' -ErrorAction Stop
        # Verify
        try {
            `$verify = Get-PowerAppManagementApp -ApplicationId '$ClientId' -ErrorAction SilentlyContinue
            if (`$verify) { Write-Output 'STATUS:Added' }
            else { Write-Output 'STATUS:AddedUnverified' }
        } catch { Write-Output 'STATUS:AddedUnverified' }
    }
} catch {
    Write-Output "STATUS:Failed:`$(`$_.Exception.Message)"
}
"@
        if ($PSCmdlet.ShouldProcess($ClientId, 'Register service principal with Power Platform')) {
            try {
                $output = & $ps51 -NonInteractive:$false -Command $ps51Script 2>&1
                $statusLine = $output | Where-Object { $_ -match '^STATUS:' } | Select-Object -Last 1

                switch -Wildcard ($statusLine) {
                    'STATUS:Added' {
                        Write-OK "Service principal registered with Power Platform (AppId: $ClientId)"
                        Write-OK 'Registration verified'
                        $ppResults.Add([PSCustomObject]@{ Step = 'Registration'; Status = 'Added' })
                    }
                    'STATUS:AddedUnverified' {
                        Write-OK "Service principal registered (AppId: $ClientId)"
                        Write-Warn 'Verification returned no result — may need a few minutes to propagate'
                        $ppResults.Add([PSCustomObject]@{ Step = 'Registration'; Status = 'Added' })
                    }
                    'STATUS:AlreadyPresent' {
                        Write-Skip "Service principal already registered with Power Platform (AppId: $ClientId)"
                        $ppResults.Add([PSCustomObject]@{ Step = 'Registration'; Status = 'AlreadyPresent' })
                    }
                    'STATUS:Failed:*' {
                        $errMsg = $statusLine -replace '^STATUS:Failed:', ''
                        Write-Fail "Power Platform registration failed: $errMsg"
                        $ppResults.Add([PSCustomObject]@{ Step = 'Registration'; Status = 'Failed' })
                    }
                    default {
                        Write-Warn "Unexpected output from PS 5.1 process. Raw output:"
                        $output | ForEach-Object { Write-Info "  $_" }
                        $ppResults.Add([PSCustomObject]@{ Step = 'Registration'; Status = 'Failed' })
                    }
                }
            }
            catch {
                Write-Fail "Failed to launch PS 5.1 child process: $($_.Exception.Message)"
                $ppResults.Add([PSCustomObject]@{ Step = 'Registration'; Status = 'Failed' })
            }
        }
        else {
            Write-Host "    [WhatIf] Would register '$spDisplayName' (AppId: $ClientId) with Power Platform via PS 5.1 child process" -ForegroundColor DarkYellow
            $ppResults.Add([PSCustomObject]@{ Step = 'Registration'; Status = 'WhatIf' })
        }
    }
}

# ==============================================================================
# FINAL SUMMARY
# ==============================================================================

Write-Banner -Title 'Configuration Summary'

Write-Host "  App Registration : $($app.DisplayName)" -ForegroundColor White
Write-Host "  AppId            : $($app.AppId)"        -ForegroundColor White
Write-Host "  Tenant           : $TenantId"            -ForegroundColor White
Write-Host "  Environment      : $M365Environment"     -ForegroundColor White
Write-Host ''

function Write-StepSummary {
    param([string]$Label, [object[]]$Results, [string]$ItemField)
    $added    = @($Results | Where-Object Status -eq 'Added').Count
    $present  = @($Results | Where-Object Status -eq 'AlreadyPresent').Count
    $failed   = @($Results | Where-Object Status -eq 'Failed').Count
    $notfound = @($Results | Where-Object Status -eq 'NotFound').Count
    $whatif   = @($Results | Where-Object Status -eq 'WhatIf').Count
    $pad      = '-' * [Math]::Max(0, 52 - $Label.Length)

    Write-Host "  -- $Label $pad" -ForegroundColor Cyan
    Write-Host "     Added           : $added"   -ForegroundColor $(if ($added -gt 0) { 'Green' } else { 'DarkGray' })
    Write-Host "     Already present : $present" -ForegroundColor DarkGray
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

if (-not $SkipGraphPermissions)  { Write-StepSummary -Label 'Graph / EXO / SharePoint API Permissions' -Results $graphResults -ItemField 'Permission' }
if (-not $SkipRoleAssignments)   { Write-StepSummary -Label 'Entra ID Directory Roles'                 -Results $roleResults  -ItemField 'Role'       }
if (-not $SkipPowerPlatform)     { Write-StepSummary -Label 'Power Platform Registration'              -Results $ppResults    -ItemField 'Step'       }

$totalFailed = (
    @($graphResults | Where-Object { $_.Status -in 'Failed', 'NotFound' }).Count +
    @($roleResults  | Where-Object Status -eq 'Failed').Count +
    @($ppResults    | Where-Object Status -eq 'Failed').Count
)

if ($WhatIfPreference) {
    Write-Host '  *** WhatIf run complete. No changes were made. ***' -ForegroundColor Yellow
    Write-Host '      Re-run without -WhatIf to apply changes.' -ForegroundColor DarkGray
}
elseif ($totalFailed -gt 0) {
    Write-Host '  Configuration completed with errors.' -ForegroundColor Yellow
    Write-Host '  Review failures above and re-run — already-present items are skipped automatically.' -ForegroundColor DarkGray
}
else {
    Write-Host '  All ScubaGear non-interactive permissions configured successfully.' -ForegroundColor Green
    Write-Host '  The app registration is ready for use with Invoke-SCuBA -AppID ... -CertificateThumbprint ...' -ForegroundColor Green
}

Write-Host ''