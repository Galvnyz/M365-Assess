<#
.SYNOPSIS
    Connects to Microsoft cloud services with standardized error handling.
.DESCRIPTION
    Wraps Connect-MgGraph, Connect-ExchangeOnline, and Connect-IPPSSession
    with consistent error handling, required module checks, and scope management.
    Supports interactive, certificate, client secret, and managed identity authentication.
.PARAMETER Service
    The service to connect to: Graph, ExchangeOnline, or Purview.
.PARAMETER Scopes
    Microsoft Graph permission scopes. Only used with the Graph service.
    Defaults to 'User.Read.All' if not specified.
.PARAMETER TenantId
    The tenant ID or domain (e.g., 'contoso.onmicrosoft.com'). Optional for
    interactive auth but required for app-only auth.
.PARAMETER ClientId
    Application (client) ID for app-only authentication. Requires TenantId
    and either CertificateThumbprint or ClientSecret.
.PARAMETER CertificateThumbprint
    Certificate thumbprint for app-only authentication. For Exchange Online and Purview
    this is Windows-only (Connect-ExchangeOnline / Connect-IPPSSession resolve it through
    the Windows certificate store); on Linux/macOS pass -Certificate or -CertificatePath.
.PARAMETER Certificate
    App-only authentication certificate as an X509Certificate2 object. Portable across
    Windows, Linux and macOS -- the recommended input for non-Windows Exchange/Purview.
.PARAMETER CertificatePath
    Path to a certificate file (.pfx/.p12) for app-only authentication; loaded with
    -CertificatePassword. Portable alternative to -CertificateThumbprint.
.PARAMETER CertificatePassword
    SecureString password protecting the -CertificatePath file, if any.
.PARAMETER ClientSecret
    Client secret for app-only authentication. Less secure than certificate auth.
.PARAMETER UserPrincipalName
    User principal name (e.g., 'admin@contoso.onmicrosoft.com') for interactive
    authentication to Exchange Online or Purview. Bypasses the Windows Authentication
    Manager (WAM) broker which can cause RuntimeBroker errors on some systems.
.PARAMETER ManagedIdentity
    Use Azure managed identity authentication. Requires the script to be running
    on an Azure resource with a system-assigned or user-assigned managed identity
    (e.g., Azure VM, Azure Functions, Azure Automation). Graph uses -Identity,
    Exchange Online uses -ManagedIdentity. Purview and Power BI do not support
    managed identity and will fall back with a warning.
.PARAMETER UseDeviceCode
    Use device code authentication flow instead of browser-based interactive auth.
    Graph uses -UseDeviceCode, Exchange Online uses -Device. Purview does not
    support device code and will fall back to browser/UPN-based auth with a warning.
.PARAMETER M365Environment
    Target cloud environment. Commercial and GCC use standard endpoints.
    GCCHigh and DoD route to sovereign cloud endpoints for Graph, Exchange,
    and Purview. Defaults to 'commercial'.
.EXAMPLE
    PS> .\Common\Connect-Service.ps1 -Service Graph -Scopes 'User.Read.All','Group.Read.All'

    Connects to Microsoft Graph interactively with the specified scopes.
.EXAMPLE
    PS> .\Common\Connect-Service.ps1 -Service ExchangeOnline -TenantId 'contoso.onmicrosoft.com'

    Connects to Exchange Online for the specified tenant.
.EXAMPLE
    PS> .\Common\Connect-Service.ps1 -Service Graph -TenantId 'contoso.onmicrosoft.com' -ClientId '00000000-0000-0000-0000-000000000000' -CertificateThumbprint 'ABC123'

    Connects to Microsoft Graph using certificate-based app-only auth.
.EXAMPLE
    PS> .\Common\Connect-Service.ps1 -Service Purview -UserPrincipalName 'admin@contoso.onmicrosoft.com'

    Connects to Purview using the specified UPN (avoids WAM broker issues).
.EXAMPLE
    PS> .\Common\Connect-Service.ps1 -Service Graph -M365Environment gcchigh -TenantId 'contoso.onmicrosoft.us'

    Connects to Microsoft Graph in the GCC High sovereign cloud.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Graph', 'ExchangeOnline', 'Purview', 'PowerBI')]
    [string]$Service,

    [Parameter()]
    [string[]]$Scopes = @('User.Read.All'),

    [Parameter()]
    [string]$TenantId,

    [Parameter()]
    [string]$ClientId,

    [Parameter()]
    [string]$CertificateThumbprint,

    [Parameter()]
    [System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate,

    [Parameter()]
    [string]$CertificatePath,

    [Parameter()]
    [SecureString]$CertificatePassword,

    [Parameter()]
    [SecureString]$ClientSecret,

    [Parameter()]
    [string]$UserPrincipalName,

    [Parameter()]
    [switch]$ManagedIdentity,

    [Parameter()]
    [switch]$UseDeviceCode,

    [Parameter()]
    [ValidateSet('commercial', 'gcc', 'gcchigh', 'dod')]
    [string]$M365Environment = 'commercial'
)

$ErrorActionPreference = 'Stop'

function Resolve-AppOnlyCertificate {
    <#
    .SYNOPSIS
        Returns the app-only authentication certificate as an X509Certificate2, from either the
        -Certificate object or the -CertificatePath (+ -CertificatePassword) file, or $null when
        neither is supplied. Portable across Windows, Linux and macOS -- it never touches the
        Windows-only PowerShell Cert: provider.
    #>
    [OutputType([System.Security.Cryptography.X509Certificates.X509Certificate2])]
    param(
        [System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate,
        [string]$CertificatePath,
        [System.Security.SecureString]$CertificatePassword
    )
    if ($Certificate) { return $Certificate }
    if (-not $CertificatePath) { return $null }
    if (-not (Test-Path -Path $CertificatePath)) {
        throw "Certificate file not found: '$CertificatePath'."
    }
    try {
        if ($CertificatePassword) {
            return [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($CertificatePath, $CertificatePassword)
        }
        return [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($CertificatePath)
    }
    catch {
        throw "Failed to load certificate from '$CertificatePath': $($_.Exception.Message)"
    }
}

function Resolve-InitialDomain {
    <#
    .SYNOPSIS
        Resolves the tenant's initial (*.onmicrosoft.*) domain, which app-only Exchange Online /
        Purview authentication requires as -Organization. Prefers -TenantId when it already is an
        initial domain; otherwise queries Microsoft Graph with a RELATIVE request so the connected
        sovereign-cloud endpoint (commercial, GCC High, DoD) is honoured. Returns $null on failure.
    #>
    [OutputType([string])]
    param([string]$TenantId)
    if ($TenantId -and $TenantId -match '\.onmicrosoft\.[a-z]+$') { return $TenantId }
    try {
        $verifiedDomains = (Invoke-MgGraphRequest -Method GET -Uri '/v1.0/organization?$select=verifiedDomains').value.verifiedDomains
        $initial = $verifiedDomains | Where-Object { $_.isInitial } | Select-Object -First 1
        if ($initial.name) { return [string]$initial.name }
    }
    catch {
        Write-Verbose "Initial-domain lookup via Graph failed: $($_.Exception.Message)"
    }
    return $null
}

function Set-ExchangeAppOnlyAuth {
    <#
    .SYNOPSIS
        Configures Exchange Online / Purview app-only certificate authentication cross-platform.
    .DESCRIPTION
        Connect-ExchangeOnline and Connect-IPPSSession resolve -CertificateThumbprint only through
        the Windows certificate store, which is unavailable on Linux/macOS. When a certificate
        object is supplied it is passed via -Certificate together with -Organization (the tenant's
        initial domain). Windows keeps the unchanged -CertificateThumbprint code path. Fails early
        with an actionable error when the required material cannot be resolved.
    #>
    param(
        [Parameter(Mandatory)][hashtable]$ConnectParams,
        [Parameter(Mandatory)][string]$ClientId,
        [string]$CertificateThumbprint,
        [System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate,
        [string]$TenantId
    )
    $ConnectParams['AppId'] = $ClientId
    if ($Certificate) {
        $ConnectParams['Certificate'] = $Certificate
        $organization = Resolve-InitialDomain -TenantId $TenantId
        if (-not $organization) {
            throw "Could not resolve the tenant's initial (*.onmicrosoft.*) domain, which app-only Exchange Online / Purview authentication requires. Connect to Microsoft Graph first, or pass -TenantId as the initial domain."
        }
        $ConnectParams['Organization'] = $organization
    }
    elseif ($CertificateThumbprint) {
        if ($IsWindows -eq $false) {
            throw "-CertificateThumbprint is Windows-only for Exchange Online / Purview (it is resolved through the Windows certificate store). On Linux/macOS, pass the certificate with -Certificate or -CertificatePath instead."
        }
        $ConnectParams['CertificateThumbprint'] = $CertificateThumbprint
    }
    else {
        throw "App-only Exchange Online / Purview authentication requires a certificate: pass -Certificate, -CertificatePath, or (on Windows) -CertificateThumbprint."
    }
}

# Resolve the app-only certificate object once (from -Certificate or -CertificatePath).
$appOnlyCertificate = Resolve-AppOnlyCertificate -Certificate $Certificate -CertificatePath $CertificatePath -CertificatePassword $CertificatePassword

$moduleMap = @{
    'Graph'           = 'Microsoft.Graph.Authentication'
    'ExchangeOnline'  = 'ExchangeOnlineManagement'
    'Purview'         = 'ExchangeOnlineManagement'
    'PowerBI'         = 'MicrosoftPowerBIMgmt'
}

$requiredModule = $moduleMap[$Service]

# Check that the required module is available
if (-not (Get-Module -Name $requiredModule -ListAvailable)) {
    Write-Error "Required module '$requiredModule' is not installed. Run: Install-Module -Name $requiredModule -Scope CurrentUser"
    return
}

try {
    # ------------------------------------------------------------------
    # Environment endpoint configuration
    # GCC uses the same endpoints as commercial (tenant is in the GCC
    # partition but API surface is identical). GCC High and DoD route
    # to sovereign cloud endpoints.
    # ------------------------------------------------------------------
    $envConfig = @{
        'commercial' = @{ GraphEnvironment = $null; ExoEnvironment = $null; PurviewParams = @{} }
        'gcc'        = @{ GraphEnvironment = $null; ExoEnvironment = $null; PurviewParams = @{} }
        'gcchigh'    = @{
            GraphEnvironment = 'USGov'
            ExoEnvironment   = 'O365USGovGCCHigh'
            PurviewParams    = @{
                ConnectionUri                   = 'https://ps.compliance.protection.office365.us/powershell-liveid/'
                AzureADAuthorizationEndpointUri = 'https://login.microsoftonline.us/common'
            }
        }
        'dod'        = @{
            GraphEnvironment = 'USGovDoD'
            ExoEnvironment   = 'O365USGovDoD'
            PurviewParams    = @{
                ConnectionUri                   = 'https://l5.ps.compliance.protection.office365.us/powershell-liveid/'
                AzureADAuthorizationEndpointUri = 'https://login.microsoftonline.us/common'
            }
        }
    }

    $currentEnv = $envConfig[$M365Environment]

    switch ($Service) {
        'Graph' {
            $connectParams = @{}
            if ($TenantId) { $connectParams['TenantId'] = $TenantId }

            if ($ManagedIdentity) {
                $connectParams['Identity'] = $true
            }
            elseif ($ClientId -and ($appOnlyCertificate -or $CertificateThumbprint)) {
                $connectParams['ClientId'] = $ClientId
                # Connect-MgGraph accepts a certificate object cross-platform; the thumbprint
                # path stays for Windows callers that rely on the certificate store.
                if ($appOnlyCertificate) { $connectParams['Certificate'] = $appOnlyCertificate }
                else { $connectParams['CertificateThumbprint'] = $CertificateThumbprint }
            }
            elseif ($ClientId -and $ClientSecret) {
                $credential = New-Object -TypeName System.Management.Automation.PSCredential -ArgumentList $ClientId, $ClientSecret
                $connectParams['ClientSecretCredential'] = $credential
                Write-Warning 'Graph: client secret authentication is supported but certificate authentication is recommended for unattended assessments. Pass -CertificateThumbprint where possible.'
            }
            else {
                $connectParams['Scopes'] = $Scopes
                if ($UseDeviceCode) {
                    $connectParams['UseDeviceCode'] = $true
                }
            }

            if ($currentEnv.GraphEnvironment) {
                $connectParams['Environment'] = $currentEnv.GraphEnvironment
            }

            # Suppress Graph SDK welcome banner (available in v2.x+)
            if ((Get-Command Connect-MgGraph -ErrorAction SilentlyContinue) -and
                (Get-Command Connect-MgGraph).Parameters.ContainsKey('NoWelcome')) {
                $connectParams['NoWelcome'] = $true
            }

            Connect-MgGraph @connectParams
            Write-Verbose "Connected to Microsoft Graph ($M365Environment)"
        }

        'ExchangeOnline' {
            # #231: EXO 3.8.0+ bundles an MSAL that conflicts with the Graph SDK
            # in-session. Connect-ExchangeOnline auto-loads the HIGHEST installed
            # version, so when a compatible (< 3.8.0) version is installed
            # side-by-side, pin the import to it before connecting.
            if (-not (Get-Module -Name ExchangeOnlineManagement)) {
                $compatibleExo = if (Get-Command -Name Get-CompatibleExoModule -ErrorAction SilentlyContinue) { Get-CompatibleExoModule } else { $null }
                if ($compatibleExo) {
                    Import-Module -Name ExchangeOnlineManagement -RequiredVersion $compatibleExo.Version -ErrorAction Stop
                    Write-Verbose "Pinned ExchangeOnlineManagement $($compatibleExo.Version) for this session"
                }
            }

            $connectParams = @{
                ShowBanner = $false
            }
            if ($TenantId) { $connectParams['Organization'] = $TenantId }

            if ($ManagedIdentity) {
                $connectParams['ManagedIdentity'] = $true
            }
            elseif ($ClientId -and ($appOnlyCertificate -or $CertificateThumbprint)) {
                Set-ExchangeAppOnlyAuth -ConnectParams $connectParams -ClientId $ClientId -CertificateThumbprint $CertificateThumbprint -Certificate $appOnlyCertificate -TenantId $TenantId
            }
            elseif ($ClientId -and $ClientSecret) {
                throw "Exchange Online does not support client secret authentication. Use -CertificateThumbprint for app-only auth."
            }
            elseif ($UseDeviceCode) {
                $connectParams['Device'] = $true
            }
            elseif ($UserPrincipalName) {
                $connectParams['UserPrincipalName'] = $UserPrincipalName
            }

            if ($currentEnv.ExoEnvironment) {
                $connectParams['ExchangeEnvironmentName'] = $currentEnv.ExoEnvironment
            }

            Connect-ExchangeOnline @connectParams
            Write-Verbose "Connected to Exchange Online ($M365Environment)"
        }

        'Purview' {
            # Connect-IPPSSession ships in ExchangeOnlineManagement — same #231
            # side-by-side pin applies (see the ExchangeOnline case above).
            if (-not (Get-Module -Name ExchangeOnlineManagement)) {
                $compatibleExo = if (Get-Command -Name Get-CompatibleExoModule -ErrorAction SilentlyContinue) { Get-CompatibleExoModule } else { $null }
                if ($compatibleExo) {
                    Import-Module -Name ExchangeOnlineManagement -RequiredVersion $compatibleExo.Version -ErrorAction Stop
                    Write-Verbose "Pinned ExchangeOnlineManagement $($compatibleExo.Version) for this session"
                }
            }

            $connectParams = @{}
            if ($TenantId) { $connectParams['Organization'] = $TenantId }

            if ($ManagedIdentity) {
                Write-Warning "Purview (Connect-IPPSSession) does not support managed identity auth. Falling back to browser-based login."
            }

            if ($ClientId -and ($appOnlyCertificate -or $CertificateThumbprint)) {
                Set-ExchangeAppOnlyAuth -ConnectParams $connectParams -ClientId $ClientId -CertificateThumbprint $CertificateThumbprint -Certificate $appOnlyCertificate -TenantId $TenantId
            }
            elseif ($ClientId -and $ClientSecret) {
                throw "Purview does not support client secret authentication. Use -CertificateThumbprint for app-only auth."
            }
            elseif ($UserPrincipalName) {
                $connectParams['UserPrincipalName'] = $UserPrincipalName
            }

            if ($UseDeviceCode) {
                Write-Warning "Purview (Connect-IPPSSession) does not support device code auth. Falling back to browser-based login."
            }

            foreach ($key in $currentEnv.PurviewParams.Keys) {
                $connectParams[$key] = $currentEnv.PurviewParams[$key]
            }

            Connect-IPPSSession @connectParams
            Write-Verbose "Connected to Purview (Security & Compliance) ($M365Environment)"
        }

        'PowerBI' {
            $connectParams = @{}
            if ($TenantId) { $connectParams['Tenant'] = $TenantId }

            # Route sovereign clouds to their Power BI environment. Without this the
            # module defaults to commercial, so the WAM broker uses the commercial
            # redirect URI and GCC High/DoD fail with IncorrectConfiguration /
            # "Invalid redirect uri" (#943). Power BI env names differ from Graph's:
            # gcc->USGov, gcchigh->USGovHigh, dod->USGovMil (api[.high|.mil].powerbigov.us).
            $pbiEnvironmentMap = @{
                'gcc'     = 'USGov'
                'gcchigh' = 'USGovHigh'
                'dod'     = 'USGovMil'
            }
            if ($pbiEnvironmentMap.ContainsKey($M365Environment)) {
                $connectParams['Environment'] = $pbiEnvironmentMap[$M365Environment]
            }

            if ($ManagedIdentity) {
                throw "Power BI (Connect-PowerBIServiceAccount) does not support managed identity auth. Use -ClientId and -CertificateThumbprint for non-interactive auth."
            }
            if ($UseDeviceCode) {
                Write-Warning "Power BI (Connect-PowerBIServiceAccount) does not support device code auth. Falling back to interactive login."
            }
            if ($ClientId -and $CertificateThumbprint) {
                $connectParams['ServicePrincipal'] = $true
                $connectParams['ApplicationId'] = $ClientId
                $connectParams['CertificateThumbprint'] = $CertificateThumbprint
            }
            elseif ($ClientId -and $ClientSecret) {
                $credential = New-Object -TypeName System.Management.Automation.PSCredential -ArgumentList $ClientId, $ClientSecret
                $connectParams['ServicePrincipal'] = $true
                $connectParams['Credential'] = $credential
                Write-Warning 'Power BI: client secret authentication is supported but certificate authentication is recommended for unattended assessments. Pass -CertificateThumbprint where possible.'
            }

            Connect-PowerBIServiceAccount @connectParams -WarningAction SilentlyContinue
            Write-Verbose "Connected to Power BI ($M365Environment)"
        }
    }
}
catch {
    Write-Error "Failed to connect to $Service`: $_"
}
