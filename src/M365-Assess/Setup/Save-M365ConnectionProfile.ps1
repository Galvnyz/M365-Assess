function Save-M365ConnectionProfile {
    <#
    .SYNOPSIS
        Saves a named connection profile for M365 assessments.
    .DESCRIPTION
        Stores connection parameters (TenantId, ClientId, auth method, certificate
        thumbprint) as a named profile in .m365assess.json. Profiles enable zero-config
        repeat runs via Invoke-M365Assessment -ConnectionProfile 'ProfileName'.

        Client secrets are NOT stored -- use certificate-based auth for saved profiles.
    .PARAMETER ProfileName
        A friendly name for this connection profile (e.g., 'Production', 'DevTenant').
    .PARAMETER TenantId
        Tenant ID or domain (e.g., 'contoso.onmicrosoft.com').
    .PARAMETER ClientId
        Application (client) ID for app-only authentication.
    .PARAMETER CertificateThumbprint
        Certificate thumbprint for app-only authentication.
    .PARAMETER AuthMethod
        Authentication method: Interactive, DeviceCode, Certificate, ManagedIdentity.
    .PARAMETER UserPrincipalName
        Optional UPN for EXO/Purview interactive auth.
    .PARAMETER M365Environment
        Cloud environment: commercial, gcc, gcchigh, dod.
    .PARAMETER AppName
        Optional friendly name for the app registration.
    .EXAMPLE
        Save-M365ConnectionProfile -ProfileName 'Production' -TenantId 'contoso.onmicrosoft.com' -AuthMethod Interactive
    .EXAMPLE
        Save-M365ConnectionProfile -ProfileName 'CertAuth' -TenantId 'contoso.onmicrosoft.com' -ClientId '00000...' -CertificateThumbprint 'ABC123' -AuthMethod Certificate
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$ProfileName,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter()]
        [ValidateSet('Interactive', 'DeviceCode', 'Certificate', 'ManagedIdentity')]
        [string]$AuthMethod = 'Interactive',

        [Parameter()]
        [string]$ClientId,

        [Parameter()]
        [string]$CertificateThumbprint,

        [Parameter()]
        [string]$UserPrincipalName,

        [Parameter()]
        [ValidateSet('commercial', 'gcc', 'gcchigh', 'dod')]
        [string]$M365Environment = 'commercial',

        [Parameter()]
        [string]$AppName
    )

    if ($AuthMethod -eq 'Certificate' -and (-not $ClientId -or -not $CertificateThumbprint)) {
        Write-Error "Certificate auth requires both -ClientId and -CertificateThumbprint."
        return
    }

    $projectRoot = if ($PSCommandPath) { Split-Path -Parent (Split-Path -Parent $PSCommandPath) } else { $PSScriptRoot }
    $configPath = Join-Path -Path $projectRoot -ChildPath '.m365assess.json'

    # Load existing config or create new
    $config = @{}
    if (Test-Path -Path $configPath) {
        try {
            $config = Get-Content -Path $configPath -Raw | ConvertFrom-Json -AsHashtable
        }
        catch {
            Write-Warning "Could not read existing config: $_. Creating new."
        }
    }

    # Build profile entry
    $profile = @{
        tenantId       = $TenantId
        authMethod     = $AuthMethod
        environment    = $M365Environment
        saved          = (Get-Date -Format 'yyyy-MM-dd')
        lastUsed       = $null
    }
    if ($ClientId) { $profile['clientId'] = $ClientId }
    if ($CertificateThumbprint) { $profile['thumbprint'] = $CertificateThumbprint }
    if ($UserPrincipalName) { $profile['upn'] = $UserPrincipalName }
    if ($AppName) { $profile['appName'] = $AppName }

    # Migrate legacy format: old format keyed by TenantId, new format keyed by ProfileName
    # under a 'profiles' key. Support both for backward compat.
    if (-not $config.ContainsKey('profiles')) {
        $config['profiles'] = @{}
    }

    $config['profiles'][$ProfileName] = $profile

    # Write back
    $config | ConvertTo-Json -Depth 5 | Set-Content -Path $configPath -Encoding UTF8
    Write-Host "  Saved connection profile '$ProfileName' for $TenantId" -ForegroundColor Green
}
