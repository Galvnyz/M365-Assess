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
    Certificate thumbprint for app-only authentication.
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
            elseif ($ClientId -and $CertificateThumbprint) {
                $connectParams['ClientId'] = $ClientId
                $connectParams['CertificateThumbprint'] = $CertificateThumbprint
            }
            elseif ($ClientId -and $ClientSecret) {
                $credential = New-Object -TypeName System.Management.Automation.PSCredential -ArgumentList $ClientId, $ClientSecret
                $connectParams['ClientSecretCredential'] = $credential
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
            $connectParams = @{
                ShowBanner = $false
            }
            if ($TenantId) { $connectParams['Organization'] = $TenantId }

            if ($ManagedIdentity) {
                $connectParams['ManagedIdentity'] = $true
            }
            elseif ($ClientId -and $CertificateThumbprint) {
                $connectParams['AppId'] = $ClientId
                $connectParams['CertificateThumbprint'] = $CertificateThumbprint
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
            $connectParams = @{}
            if ($TenantId) { $connectParams['Organization'] = $TenantId }

            if ($ManagedIdentity) {
                Write-Warning "Purview (Connect-IPPSSession) does not support managed identity auth. Falling back to browser-based login."
            }

            if ($ClientId -and $CertificateThumbprint) {
                $connectParams['AppId'] = $ClientId
                $connectParams['CertificateThumbprint'] = $CertificateThumbprint
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
            }

            Connect-PowerBIServiceAccount @connectParams -WarningAction SilentlyContinue
            Write-Verbose "Connected to Power BI ($M365Environment)"
        }
    }
}
catch {
    Write-Error "Failed to connect to $Service`: $_"
}
