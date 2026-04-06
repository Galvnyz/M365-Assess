# Dot-source permission definitions
. "$PSScriptRoot\PermissionDefinitions.ps1"

function Grant-M365AssessConsent {
    <#
    .SYNOPSIS
        Creates and configures an Entra ID app registration with all permissions
        required by M365-Assess.
    .DESCRIPTION
        Provisions a read-only service principal for Invoke-M365Assessment with:
        - 24 Microsoft Graph API application permissions (all .Read.All)
        - 3 Office 365 Exchange Online API permissions (ManageAsApp, Organization.Read.All, MailboxSettings.Read)
        - 1 Microsoft Purview API permission (Purview.ApplicationAccess)
        - 3 Entra ID directory roles (Security Reader, Compliance Admin, Global Reader)
        - 2 Exchange Online RBAC role groups (View-Only Org Management, Compliance Management)

        Supports creating a new app registration from scratch (-CreateNew) or configuring
        an existing one. Saves credentials to .m365assess.json for automatic detection
        by the assessment.

        Requires Global Administrator or Application Administrator rights.

        Authentication model:
          Graph step (permissions) -- fully app-only. Connects with ClientId + CertificateThumbprint.
          Compliance roles step   -- delegated Graph session using -AdminUpn.
            New-MgDirectoryRoleMemberByRef requires RoleManagement.ReadWrite.Directory.
            An app cannot grant itself that permission on first run (no bootstrap path),
            so a delegated admin account is used for this step.
          EXO RBAC                -- delegated Exchange Online session using -AdminUpn.
            Add-RoleGroupMember requires a delegated admin session.
            Microsoft does not expose this operation via app-only EXO sessions.

        Role group notes (lessons learned):
          Exchange Online (cloud-only tenants):
            "View-Only Recipients" and "View-Only Configuration" only exist in
            on-premises/hybrid Exchange. In Exchange Online the equivalent access
            is provided by "View-Only Organization Management".

            "Security Reader" is ambiguous -- it exists in both EXO and Entra ID.
            The function uses the unambiguous EXO group "Compliance Management" for
            read-only Defender/EOP policy access instead.

          Purview / Compliance roles:
            "View-Only DLP Compliance Management", "View-Only Manage Alerts", and
            "Compliance Administrator" are Entra ID directory roles, not Security &
            Compliance PowerShell role groups. They are assigned via Graph
            (New-MgDirectoryRoleMemberByRef) rather than Connect-IPPSSession.
    .PARAMETER TenantId
        Tenant ID or domain (e.g. 'contoso.onmicrosoft.com').
    .PARAMETER CreateNew
        Creates a new App Registration and self-signed certificate from scratch.
        Uses delegated auth (browser login) for the bootstrap, then switches to
        app-only for permission assignment. Requires -AdminUpn.
    .PARAMETER ClientId
        Application (Client) ID of the App Registration being configured.
    .PARAMETER AppDisplayName
        Display name of the App Registration. When used with -CreateNew, specifies
        the name for the new app (default: 'M365-Assess-Reader'). When used alone,
        looks up an existing app by name.
    .PARAMETER CertificateThumbprint
        Thumbprint of the certificate in Cert:\CurrentUser\My used for app-only
        Graph authentication. Must also be uploaded to the App Registration.
        Not required with -CreateNew (the function generates a certificate).
    .PARAMETER CertificateExpiryYears
        Number of years before the generated certificate expires. Default: 2.
        Only used with -CreateNew.
    .PARAMETER AdminUpn
        UPN of an Exchange Administrator or Global Administrator account, used for
        delegated sessions (app creation, compliance roles, Exchange RBAC).
        Required with -CreateNew and for EXO/compliance steps.
    .PARAMETER SkipGraph
        Skip the Microsoft Graph API permission assignment step.
    .PARAMETER SkipExchangeRbac
        Skip the Exchange Online role group assignment step.
    .PARAMETER SkipComplianceRoles
        Skip the Purview/Compliance Entra directory role assignment step.
    .EXAMPLE
        Grant-M365AssessConsent -TenantId 'contoso.onmicrosoft.com' -AdminUpn 'admin@contoso.onmicrosoft.com' -CreateNew

        Creates a new app registration named 'M365-Assess-Reader' with a 2-year
        self-signed certificate, then assigns all required permissions. Prints
        the ClientId and thumbprint for use with Invoke-M365Assessment.
    .EXAMPLE
        Grant-M365AssessConsent -TenantId 'contoso.onmicrosoft.com' -ClientId '00000000-0000-0000-0000-000000000000' -CertificateThumbprint 'ABC123DEF456' -AdminUpn 'admin@contoso.onmicrosoft.com'

        Configures an existing app registration with all required permissions.
    .EXAMPLE
        Grant-M365AssessConsent -TenantId 'contoso.onmicrosoft.com' -ClientId '00000000-0000-0000-0000-000000000000' -CertificateThumbprint 'ABC123DEF456' -SkipExchangeRbac -SkipComplianceRoles

        Graph permissions only -- no AdminUpn required.
    .NOTES
        Required modules:
            Install-Module Microsoft.Graph.Authentication    -Scope CurrentUser
            Install-Module Microsoft.Graph.Applications      -Scope CurrentUser
            Install-Module Microsoft.Graph.Identity.Governance -Scope CurrentUser
            Install-Module ExchangeOnlineManagement          -Scope CurrentUser
    #>
    [CmdletBinding(SupportsShouldProcess, DefaultParameterSetName = 'CreateNew')]
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSReviewUnusedParameter', 'CreateNew',
        Justification = 'Used implicitly via ParameterSetName')]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory)]
        [string]$TenantId,

        [Parameter(ParameterSetName = 'CreateNew')]
        [switch]$CreateNew,

        [Parameter(ParameterSetName = 'Existing', Mandatory)]
        [string]$ClientId,

        [Parameter()]
        [string]$AppDisplayName = 'M365-Assess-Reader',

        [Parameter(ParameterSetName = 'Existing')]
        [string]$CertificateThumbprint,

        [Parameter(ParameterSetName = 'CreateNew')]
        [ValidateRange(1, 10)]
        [int]$CertificateExpiryYears = 2,

        [Parameter()]
        [string]$AdminUpn,

        [Parameter()]
        [switch]$SkipGraph,

        [Parameter()]
        [switch]$SkipExchangeRbac,

        [Parameter()]
        [switch]$SkipComplianceRoles,

        [Parameter()]
        [string]$ProfileName
    )

    $ErrorActionPreference = 'Stop'
    Set-StrictMode -Version Latest

    # ==================================================================
    # INTERNAL HELPERS (private to function scope)
    # ==================================================================

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

    function Write-StepSummary {
        param([string]$Label, [object[]]$Results, [string]$ItemField)
        $added    = @($Results | Where-Object { $_.Status -eq 'Added' }).Count
        $present  = @($Results | Where-Object { $_.Status -eq 'AlreadyPresent' }).Count
        $failed   = @($Results | Where-Object { $_.Status -eq 'Failed' }).Count
        $notfound = @($Results | Where-Object { $_.Status -eq 'NotFound' }).Count
        $whatif   = @($Results | Where-Object { $_.Status -eq 'WhatIf' }).Count
        $skipped  = @($Results | Where-Object { $_.Status -eq 'Skipped' }).Count
        $pad      = '-' * [Math]::Max(0, 52 - $Label.Length)

        Write-Host "  -- $Label $pad" -ForegroundColor Cyan
        Write-Host "     Added           : $added"   -ForegroundColor $(if ($added -gt 0) { 'Green' } else { 'DarkGray' })
        Write-Host "     Already present : $present" -ForegroundColor DarkGray
        if ($skipped -gt 0) { Write-Host "     Skipped         : $skipped" -ForegroundColor DarkGray }
        if ($failed -gt 0) {
            Write-Host "     Failed          : $failed" -ForegroundColor Magenta
            $Results | Where-Object { $_.Status -eq 'Failed' } | ForEach-Object { Write-Host "       - $($_.$ItemField)" -ForegroundColor Magenta }
        }
        if ($notfound -gt 0) {
            Write-Host "     Not found       : $notfound" -ForegroundColor Yellow
            $Results | Where-Object { $_.Status -eq 'NotFound' } | ForEach-Object { Write-Host "       - $($_.$ItemField)" -ForegroundColor Yellow }
        }
        if ($whatif -gt 0) { Write-Host "     [WhatIf]        : $whatif" -ForegroundColor DarkYellow }
        Write-Host ''
    }

    # ==================================================================
    # BANNER + PRE-FLIGHT
    # ==================================================================

    Write-Banner -Title 'M365 Assessment - Full Permission Configurator'

    if ($WhatIfPreference) {
        Write-Host '  *** WHATIF MODE - no changes will be made ***' -ForegroundColor Yellow
        Write-Host ''
    }

    if (-not $SkipExchangeRbac -and -not $AdminUpn) {
        Write-Host '  Exchange Online RBAC requires a delegated admin session.' -ForegroundColor Yellow
        Write-Host '  Enter the UPN of a Global or Exchange Administrator:' -ForegroundColor White
        Write-Host '  > ' -ForegroundColor Cyan -NoNewline
        $AdminUpn = (Read-Host) ?? ''
        if (-not $AdminUpn.Trim()) {
            Write-Host '  No UPN provided -- skipping Exchange RBAC step.' -ForegroundColor DarkGray
            $SkipExchangeRbac = [switch]$true
        }
        else {
            $AdminUpn = $AdminUpn.Trim()
        }
    }
    # Compliance roles also need AdminUpn for delegated Graph session
    if (-not $SkipComplianceRoles -and -not $AdminUpn) {
        Write-Host '  Compliance role assignment also requires an admin UPN.' -ForegroundColor Yellow
        Write-Host '  Enter the UPN of a Global Administrator (or press ENTER to skip):' -ForegroundColor White
        Write-Host '  > ' -ForegroundColor Cyan -NoNewline
        $AdminUpn = (Read-Host) ?? ''
        if (-not $AdminUpn.Trim()) {
            Write-Host '  No UPN provided -- skipping compliance roles step.' -ForegroundColor DarkGray
            $SkipComplianceRoles = [switch]$true
        }
        else {
            $AdminUpn = $AdminUpn.Trim()
        }
    }

    # ==================================================================
    # STEP 1 - MODULE VALIDATION
    # ==================================================================

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

    # ==================================================================
    # STEP 1b - BOOTSTRAP: CREATE APP REGISTRATION + CERTIFICATE
    #           (CreateNew parameter set only)
    #
    # When -CreateNew is specified, the function creates everything:
    #   1. Connect delegated (browser login) -- no app exists yet
    #   2. Generate a self-signed certificate in Cert:\CurrentUser\My
    #   3. Create the App Registration with the certificate uploaded
    #   4. Create the Service Principal
    #   5. Set $ClientId and $CertificateThumbprint for downstream steps
    #   6. Disconnect delegated session
    #
    # After this block, the function flows into the normal Steps 2-5
    # using the newly created app and certificate.
    # ==================================================================

    $bootstrapCreated = $false
    $cert = $null
    $cerPath = $null

    if ($PSCmdlet.ParameterSetName -eq 'CreateNew') {
        Write-Step "Bootstrapping new app registration '$AppDisplayName'..."
        Write-Info 'This requires a one-time delegated login (browser) to create the app.'

        # --- Connect delegated for bootstrap ---
        # MSAL_ALLOW_WAM = '0' workaround is critical -- without it,
        # Connect-MgGraph fails on some Windows machines where the WAM
        # broker intercepts the auth flow and causes silent failures.
        $prevWam = $env:MSAL_ALLOW_WAM
        $env:MSAL_ALLOW_WAM = '0'
        try {
            Connect-MgGraph -TenantId $TenantId -Scopes 'Application.ReadWrite.All' -NoWelcome -ErrorAction Stop
            $bootstrapCtx = Get-MgContext
            Write-OK "Connected (delegated) as: $($bootstrapCtx.Account)"
        }
        catch {
            throw "Delegated Graph connection failed: $($_.Exception.Message). " +
                  'Ensure the account has Application Administrator or Global Administrator rights.'
        }
        finally {
            $env:MSAL_ALLOW_WAM = $prevWam
        }

        # --- Check for duplicate app name ---
        $existingApps = @(Get-MgApplication -Filter "displayName eq '$AppDisplayName'" -ErrorAction Stop)
        if ($existingApps.Count -gt 0) {
            $existingId = $existingApps[0].AppId
            Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null
            throw "An app named '$AppDisplayName' already exists (AppId: $existingId). " +
                  "Use -ClientId '$existingId' -CertificateThumbprint <thumbprint> to configure " +
                  'the existing app, or choose a different -AppDisplayName.'
        }

        # --- Generate self-signed certificate ---
        Write-Step "Generating self-signed certificate (CN=M365-Assess-$TenantId, $CertificateExpiryYears yr)..."
        $certSubject = "CN=M365-Assess-$TenantId"
        $certParams = @{
            Subject            = $certSubject
            CertStoreLocation  = 'Cert:\CurrentUser\My'
            KeyExportPolicy    = 'Exportable'
            KeySpec            = 'Signature'
            KeyLength          = 2048
            KeyAlgorithm       = 'RSA'
            HashAlgorithm      = 'SHA256'
            NotAfter           = (Get-Date).AddYears($CertificateExpiryYears)
        }
        $cert = New-SelfSignedCertificate @certParams
        $CertificateThumbprint = $cert.Thumbprint
        Write-OK "Certificate created: $certSubject"
        Write-OK "Thumbprint: $CertificateThumbprint"
        Write-OK "Expires: $($cert.NotAfter.ToString('yyyy-MM-dd'))"

        # --- Export public key (.cer) for portability ---
        $cerPath = Join-Path (Get-Location) "M365-Assess-$TenantId.cer"
        Export-Certificate -Cert $cert -FilePath $cerPath -Type CERT | Out-Null
        Write-OK "Public key exported: $cerPath"

        # --- Create app registration with certificate ---
        Write-Step "Creating app registration '$AppDisplayName'..."
        $keyCredential = @{
            Type          = 'AsymmetricX509Cert'
            Usage         = 'Verify'
            Key           = $cert.RawData
            DisplayName   = $certSubject
            StartDateTime = $cert.NotBefore.ToUniversalTime().ToString('o')
            EndDateTime   = $cert.NotAfter.ToUniversalTime().ToString('o')
        }

        if ($PSCmdlet.ShouldProcess($AppDisplayName, 'Create new app registration')) {
            $newApp = New-MgApplication -DisplayName $AppDisplayName -SignInAudience 'AzureADMyOrg' -KeyCredentials @($keyCredential) -ErrorAction Stop
            $ClientId = $newApp.AppId
            Write-OK "App created: $AppDisplayName"
            Write-OK "Application (client) ID: $ClientId"
            Write-OK "Object ID: $($newApp.Id)"
        }

        # --- Create service principal ---
        Write-Step 'Creating service principal...'
        if ($PSCmdlet.ShouldProcess($AppDisplayName, 'Create service principal')) {
            $newSp = New-MgServicePrincipal -AppId $ClientId -ErrorAction Stop
            Write-OK "Service principal created (ObjectId: $($newSp.Id))"
        }

        # --- Disconnect bootstrap session ---
        Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null
        Write-Info 'Disconnected bootstrap delegated session'

        # --- Wait for AAD replication ---
        # This delay is necessary for Azure AD to replicate the new app
        # registration and service principal across all directory partitions.
        Write-Info 'Waiting 10 seconds for Azure AD replication...'
        Start-Sleep -Seconds 10

        $bootstrapCreated = $true

        # WhatIf guard -- downstream steps require the real app + cert to exist
        if ($WhatIfPreference) {
            Write-Host ''
            Write-Host '  [WhatIf] Would create app registration, certificate, and service principal,' -ForegroundColor DarkYellow
            Write-Host '           then proceed with permission assignment (Graph, Compliance, EXO).'    -ForegroundColor DarkYellow
            Write-Host '  [WhatIf] Re-run without -WhatIf to execute.' -ForegroundColor DarkYellow
            return
        }
    }

    # ==================================================================
    # STEP 2 - RESOLVE APP + CONNECT DELEGATED FOR PERMISSION ASSIGNMENT
    #
    # All permission assignment steps (Graph API, directory roles) require
    # elevated privileges that the target app itself may not have. Instead
    # of using app-only auth (which fails with 403 if the app lacks
    # AppRoleAssignment.ReadWrite.All), we use a single delegated admin
    # session for Steps 2-4. The admin's Global Administrator role
    # inherits the ability to grant any permission.
    # ==================================================================

    Write-Step 'Validating certificate...'

    $cert = Get-Item "Cert:\CurrentUser\My\$CertificateThumbprint" -ErrorAction SilentlyContinue
    if (-not $cert) {
        throw "Certificate '$CertificateThumbprint' not found in Cert:\CurrentUser\My."
    }
    Write-OK "Certificate: $($cert.Subject)  [Expires: $($cert.NotAfter.ToString('yyyy-MM-dd'))]"

    # Connect delegated for all Graph operations (Steps 2-4)
    if ($AdminUpn) {
        Write-Step "Connecting to Microsoft Graph (delegated as $AdminUpn)..."
        Write-Info 'Delegated session used for all Graph steps (permission grants + directory roles).'

        # MSAL_ALLOW_WAM = '0' workaround is critical -- without it,
        # Connect-MgGraph fails on some Windows machines where the WAM
        # broker intercepts the auth flow and causes silent failures.
        $prevWam = $env:MSAL_ALLOW_WAM
        $env:MSAL_ALLOW_WAM = '0'
        try {
            $graphScopes = @(
                'Application.ReadWrite.All'
                'AppRoleAssignment.ReadWrite.All'
                'RoleManagement.ReadWrite.Directory'
                'Directory.Read.All'
            )
            Connect-MgGraph -TenantId $TenantId -Scopes $graphScopes -NoWelcome -ErrorAction Stop
            $ctx = Get-MgContext
            Write-OK "Connected (delegated) as: $($ctx.Account)"
        }
        catch {
            throw "Delegated Graph connection failed: $($_.Exception.Message). Ensure the account has Global Administrator or Application Administrator rights."
        }
        finally {
            $env:MSAL_ALLOW_WAM = $prevWam
        }
    }
    else {
        # No AdminUpn -- fall back to app-only (will work only if app already has sufficient perms)
        Write-Step 'Connecting to Microsoft Graph (app-only, certificate)...'
        Write-Info 'No -AdminUpn provided. App-only session may lack permission to grant roles. Use -AdminUpn for full setup.'
        Connect-MgGraph -TenantId $TenantId -ClientId $ClientId -CertificateThumbprint $CertificateThumbprint -NoWelcome
        $ctx = Get-MgContext
        Write-OK "Connected (app-only) | AuthType: $($ctx.AuthType)"
    }

    # Resolve app and SP (works with either auth type)
    Write-Step 'Resolving App Registration and Service Principal...'

    $app = Get-MgApplication -Filter "appId eq '$ClientId'" -ErrorAction Stop
    if (-not $app) { throw "No application found with ClientId '$ClientId'." }
    $sp = Get-MgServicePrincipal -Filter "appId eq '$ClientId'" -ErrorAction Stop
    if (-not $sp)  { throw "Service principal not found for appId '$ClientId'." }

    Write-OK "App       : $($app.DisplayName)"
    Write-OK "AppId     : $($app.AppId)"
    Write-OK "SP Object : $($sp.Id)"

    $spDisplayName = $app.DisplayName

    # ==================================================================
    # STEP 3 - MICROSOFT GRAPH API PERMISSIONS
    # ==================================================================

    $graphResults = [System.Collections.Generic.List[PSCustomObject]]::new()

    if ($SkipGraph) {
        Write-Step 'Microsoft Graph permissions - SKIPPED (-SkipGraph specified)'
    }
    else {
        Write-Step "Adding Microsoft Graph API permissions ($($script:RequiredGraphPermissions.Count) across all sections)..."

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

        foreach ($perm in $script:RequiredGraphPermissions) {
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
                    $roleBody = @{
                        PrincipalId = $sp.Id
                        ResourceId  = $graphSp.Id
                        AppRoleId   = $roleId
                    }
                    New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -BodyParameter $roleBody | Out-Null
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

        # --- Exchange.ManageAsApp (Office 365 Exchange Online API) ---
        # Required for app-only certificate auth to Exchange Online.
        # This is NOT a Graph permission -- it belongs to the EXO resource SP.
        Write-Step 'Adding Exchange.ManageAsApp permission for app-only EXO auth...'
        try {
            $exoResourceAppId = '00000002-0000-0ff1-ce00-000000000000'
            $exoSp = Get-MgServicePrincipal -Filter "appId eq '$exoResourceAppId'" -ErrorAction Stop
            $manageAsAppRole = $exoSp.AppRoles | Where-Object { $_.Value -eq 'Exchange.ManageAsApp' }
            if ($manageAsAppRole) {
                $sp = Get-MgServicePrincipal -Filter "appId eq '$ClientId'" -ErrorAction Stop
                $existingExoRoles = Get-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -ErrorAction SilentlyContinue
                $alreadyAssigned = $existingExoRoles | Where-Object { $_.AppRoleId -eq $manageAsAppRole.Id -and $_.ResourceId -eq $exoSp.Id }
                if ($alreadyAssigned) {
                    Write-OK 'Exchange.ManageAsApp  [Email, Security]  (already assigned)'
                }
                elseif ($PSCmdlet.ShouldProcess('Exchange.ManageAsApp', 'Grant app role')) {
                    $roleBody = @{
                        PrincipalId = $sp.Id
                        ResourceId  = $exoSp.Id
                        AppRoleId   = $manageAsAppRole.Id
                    }
                    New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -BodyParameter $roleBody | Out-Null
                    Write-OK 'Exchange.ManageAsApp  [Email, Security]'
                }
            }
            else {
                Write-Warn 'Exchange.ManageAsApp role not found on EXO service principal'
            }
        }
        catch {
            Write-Warn "Could not assign Exchange.ManageAsApp: $_"
        }

        # --- Additional EXO API permissions (Organization.Read.All, MailboxSettings.Read) ---
        $additionalExoRoles = @('Organization.Read.All', 'MailboxSettings.Read')
        foreach ($roleName in $additionalExoRoles) {
            $role = $exoSp.AppRoles | Where-Object { $_.Value -eq $roleName }
            if ($role) {
                $alreadyAssigned = $existingExoRoles | Where-Object { $_.AppRoleId -eq $role.Id -and $_.ResourceId -eq $exoSp.Id }
                if ($alreadyAssigned) {
                    Write-OK "$roleName  [Email]  (already assigned)"
                }
                elseif ($PSCmdlet.ShouldProcess($roleName, 'Grant app role')) {
                    $roleBody = @{
                        PrincipalId = $sp.Id
                        ResourceId  = $exoSp.Id
                        AppRoleId   = $role.Id
                    }
                    New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -BodyParameter $roleBody | Out-Null
                    Write-OK "$roleName  [Email]"
                }
            }
        }

        # --- Purview.ApplicationAccess (Microsoft Purview API) ---
        # Required for app-only certificate auth to Security & Compliance (Connect-IPPSSession).
        Write-Step 'Adding Purview.ApplicationAccess permission for app-only Purview auth...'
        try {
            $purviewResourceAppId = '00000007-0000-0ff1-ce00-000000000000'
            $purviewSp = Get-MgServicePrincipal -Filter "appId eq '$purviewResourceAppId'" -ErrorAction Stop
            $purviewAppRole = $purviewSp.AppRoles | Where-Object { $_.Value -eq 'Purview.ApplicationAccess' }
            if ($purviewAppRole) {
                $sp = Get-MgServicePrincipal -Filter "appId eq '$ClientId'" -ErrorAction Stop
                $existingPurviewRoles = Get-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -ErrorAction SilentlyContinue
                $alreadyAssigned = $existingPurviewRoles | Where-Object { $_.AppRoleId -eq $purviewAppRole.Id -and $_.ResourceId -eq $purviewSp.Id }
                if ($alreadyAssigned) {
                    Write-OK 'Purview.ApplicationAccess  [Security]  (already assigned)'
                }
                elseif ($PSCmdlet.ShouldProcess('Purview.ApplicationAccess', 'Grant app role')) {
                    $roleBody = @{
                        PrincipalId = $sp.Id
                        ResourceId  = $purviewSp.Id
                        AppRoleId   = $purviewAppRole.Id
                    }
                    New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -BodyParameter $roleBody | Out-Null
                    Write-OK 'Purview.ApplicationAccess  [Security]'
                }
            }
            else {
                Write-Warn 'Purview.ApplicationAccess role not found on Purview service principal'
            }
        }
        catch {
            Write-Warn "Could not assign Purview.ApplicationAccess: $_"
        }
    }

    # ==================================================================
    # STEP 4 - PURVIEW / COMPLIANCE ENTRA DIRECTORY ROLES
    #
    # Uses the same delegated Graph session from Step 2 -- no
    # reconnection needed. If running app-only (no AdminUpn), this
    # step is skipped.
    # ==================================================================

    $complianceResults = [System.Collections.Generic.List[PSCustomObject]]::new()

    if ($SkipComplianceRoles) {
        Write-Step 'Compliance directory roles - SKIPPED (-SkipComplianceRoles specified)'
    }
    elseif (-not $AdminUpn) {
        Write-Warn 'Compliance directory role assignment requires -AdminUpn (delegated Graph connection).'
        Write-Warn 'Skipping compliance roles step. Re-run with -AdminUpn to complete this step.'
        foreach ($roleDef in $script:RequiredComplianceRoles) {
            $complianceResults.Add([PSCustomObject]@{ Role = $roleDef.DisplayName; Status = 'Skipped'; Sections = $roleDef.Sections })
        }
    }
    else {
        # Reuses the delegated Graph session from Step 2 -- no reconnection needed
        Write-Step "Assigning Entra ID directory roles for compliance/security access ($($script:RequiredComplianceRoles.Count) roles)..."

        foreach ($roleDef in $script:RequiredComplianceRoles) {
            $roleName       = $roleDef.DisplayName
            $roleTemplateId = $roleDef.TemplateId

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
                    $memberRef = @{
                        '@odata.id' = "https://graph.microsoft.com/v1.0/directoryObjects/$($sp.Id)"
                    }
                    New-MgDirectoryRoleMemberByRef -DirectoryRoleId $dirRole.Id -BodyParameter $memberRef -ErrorAction Stop
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
    }

    # Disconnect Graph (delegated session) before EXO step
    Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null

    # ==================================================================
    # STEP 5 - EXCHANGE ONLINE RBAC ROLE GROUPS (delegated -- platform
    #          requirement)
    #
    # Add-RoleGroupMember is not available in app-only EXO sessions.
    # A delegated admin credential is required for this step only.
    #
    # Role groups used:
    #   "View-Only Organization Management" -- the correct cloud-only
    #     EXO group that covers mailboxes, recipients, transport config,
    #     and EOP/Defender policies.
    #     ("View-Only Recipients" and "View-Only Configuration" are
    #      on-prem/hybrid only.)
    #   "Compliance Management" -- EXO-side compliance config reads.
    # ==================================================================

    $exoResults = [System.Collections.Generic.List[PSCustomObject]]::new()

    if ($SkipExchangeRbac) {
        Write-Step 'Exchange Online RBAC - SKIPPED (-SkipExchangeRbac specified)'
    }
    else {
        Write-Step "Connecting to Exchange Online (delegated as $AdminUpn)..."
        Write-Info 'Note: Add-RoleGroupMember requires a delegated session -- this is a platform constraint.'

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
            Write-Step "Adding '$spDisplayName' to Exchange Online role groups ($($script:RequiredExoRoleGroups.Count) groups)..."

            foreach ($entry in $script:RequiredExoRoleGroups) {
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

    # ==================================================================
    # FINAL SUMMARY
    # ==================================================================

    Write-Banner -Title 'Configuration Summary'

    Write-Host "  App Registration : $($app.DisplayName)" -ForegroundColor White
    Write-Host "  AppId            : $($app.AppId)"        -ForegroundColor White
    Write-Host "  Tenant           : $TenantId"            -ForegroundColor White
    Write-Host ''

    if (-not $SkipGraph)           { Write-StepSummary -Label 'Microsoft Graph API Permissions'      -Results $graphResults      -ItemField 'Permission' }
    if (-not $SkipComplianceRoles) { Write-StepSummary -Label 'Entra ID Compliance / Security Roles' -Results $complianceResults -ItemField 'Role'       }
    if (-not $SkipExchangeRbac)    { Write-StepSummary -Label 'Exchange Online RBAC Role Groups'     -Results $exoResults        -ItemField 'RoleGroup'  }

    $totalFailed = (
        @($graphResults      | Where-Object { $_.Status -in 'Failed', 'NotFound' }).Count +
        @($complianceResults | Where-Object { $_.Status -eq 'Failed' }).Count +
        @($exoResults        | Where-Object { $_.Status -eq 'Failed' }).Count
    )

    if ($WhatIfPreference) {
        Write-Host '  *** WhatIf run complete. No changes were made. ***' -ForegroundColor Yellow
        Write-Host '      Re-run without -WhatIf to apply the changes shown above.' -ForegroundColor DarkGray
    }
    elseif ($totalFailed -gt 0) {
        Write-Host '  Configuration completed with errors.' -ForegroundColor Yellow
        Write-Host '  Review failures above and re-run -- already-present items are skipped automatically.' -ForegroundColor DarkGray
    }
    else {
        Write-Host '  All permissions configured successfully.' -ForegroundColor Green
        Write-Host '  The app registration is ready for use with Invoke-M365Assessment.' -ForegroundColor Green
    }

    if ($bootstrapCreated) {
        Write-Host ''
        Write-Banner -Title 'New App Registration Details'
        Write-Host "  App Display Name         : $AppDisplayName"          -ForegroundColor Green
        Write-Host "  Application (Client) ID  : $ClientId"               -ForegroundColor Green
        Write-Host "  Certificate Thumbprint   : $CertificateThumbprint"  -ForegroundColor Green
        Write-Host "  Certificate Subject      : CN=M365-Assess-$TenantId" -ForegroundColor White
        Write-Host "  Certificate Expires      : $($cert.NotAfter.ToString('yyyy-MM-dd'))" -ForegroundColor White
        Write-Host "  Public Key Exported      : $cerPath"                -ForegroundColor White
        Write-Host ''
        Write-Host '  Run the assessment with:' -ForegroundColor Cyan
        Write-Host ''
        Write-Host "    Invoke-M365Assessment -TenantId '$TenantId'" -ForegroundColor Yellow
        Write-Host ''
        Write-Host '  Credentials are saved automatically and will be used by the assessment.' -ForegroundColor DarkGray
        Write-Host ''
    }

    # ------------------------------------------------------------------
    # Save credentials to connection profile
    # ------------------------------------------------------------------
    if ($ClientId -and $CertificateThumbprint -and -not $WhatIfPreference) {
        $profileHelper = Join-Path $PSScriptRoot 'Save-M365ConnectionProfile.ps1'
        if (Test-Path -Path $profileHelper) {
            . $profileHelper

            # Derive tenant prefix for naming
            $tenantPrefix = if ($TenantId -match '^([^.]+)\.onmicrosoft\.(com|us)$') {
                $Matches[1]
            }
            elseif ($TenantId -match '^([^.]+)\.') {
                $Matches[1]
            }
            else {
                $TenantId
            }

            # Check for existing profile matching this TenantId -- update it instead of creating a duplicate
            $existingProfiles = @(Get-M365ConnectionProfile -ErrorAction SilentlyContinue)
            $existingMatch = $existingProfiles | Where-Object { $_.TenantId -eq $TenantId } | Select-Object -First 1

            $resolvedProfileName = if ($ProfileName) {
                $ProfileName
            }
            elseif ($existingMatch) {
                $existingMatch.Name
            }
            else {
                "$tenantPrefix-AppReg"
            }

            $appName = if ($AppDisplayName) { $AppDisplayName }
                       elseif ($app) { $app.DisplayName }
                       else { '' }

            $profileParams = @{
                ProfileName           = $resolvedProfileName
                TenantId              = $TenantId
                AuthMethod            = 'Certificate'
                ClientId              = $ClientId
                CertificateThumbprint = $CertificateThumbprint
                AppName               = $appName
            }
            if ($AdminUpn) { $profileParams['UserPrincipalName'] = $AdminUpn }

            $verb = if ($existingMatch) { 'Updated' } else { 'Created' }
            Set-M365ConnectionProfile @profileParams
            Write-Info "$verb profile '$resolvedProfileName' -- use: Invoke-M365Assessment -ConnectionProfile '$resolvedProfileName'"
        }
    }

    Write-Host ''

    # ------------------------------------------------------------------
    # Return structured output
    # ------------------------------------------------------------------
    [PSCustomObject]@{
        ClientId              = $ClientId
        CertificateThumbprint = $CertificateThumbprint
        AppDisplayName        = $spDisplayName
        TenantId              = $TenantId
        BootstrapCreated      = $bootstrapCreated
        GraphPermissions      = $graphResults
        ComplianceRoles       = $complianceResults
        ExoRoleGroups         = $exoResults
        TotalFailed           = $totalFailed
    }
}
