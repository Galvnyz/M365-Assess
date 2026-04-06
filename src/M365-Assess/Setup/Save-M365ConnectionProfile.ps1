# ------------------------------------------------------------------
# Shared helper: read/write .m365assess.json config
# ------------------------------------------------------------------
function Get-ProfileConfigPath {
    [CmdletBinding()]
    [OutputType([string])]
    param()
    $root = if ($PSCommandPath) { Split-Path -Parent (Split-Path -Parent $PSCommandPath) } else { $PSScriptRoot }
    Join-Path -Path $root -ChildPath '.m365assess.json'
}

function Read-ProfileConfig {
    [CmdletBinding()]
    [OutputType([hashtable])]
    param([string]$ConfigPath)
    $config = @{}
    if (Test-Path -Path $ConfigPath) {
        try {
            $config = Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json -AsHashtable
        }
        catch {
            Write-Warning "Could not read config: $_"
        }
    }
    if (-not $config.ContainsKey('profiles')) { $config['profiles'] = @{} }
    return $config
}

function Write-ProfileConfig {
    [CmdletBinding()]
    param([hashtable]$Config, [string]$ConfigPath)
    $Config | ConvertTo-Json -Depth 5 | Set-Content -Path $ConfigPath -Encoding UTF8
}

function Build-ProfileEntry {
    <#
    .SYNOPSIS
        Builds a profile hashtable from parameters.
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [string]$TenantId,
        [string]$AuthMethod,
        [string]$M365Environment,
        [string]$ClientId,
        [string]$CertificateThumbprint,
        [string]$UserPrincipalName,
        [string]$AppName
    )
    $entry = @{
        tenantId    = $TenantId
        authMethod  = $AuthMethod
        environment = $M365Environment
        saved       = (Get-Date -Format 'yyyy-MM-dd')
        lastUsed    = $null
    }
    if ($ClientId) { $entry['clientId'] = $ClientId }
    if ($CertificateThumbprint) { $entry['thumbprint'] = $CertificateThumbprint }
    if ($UserPrincipalName) { $entry['upn'] = $UserPrincipalName }
    if ($AppName) { $entry['appName'] = $AppName }
    return $entry
}

# Shared parameter set for profile creation/update
$script:ProfileParams = @(
    'ProfileName', 'TenantId', 'AuthMethod', 'ClientId',
    'CertificateThumbprint', 'UserPrincipalName', 'M365Environment', 'AppName'
)

# ------------------------------------------------------------------
# New-M365ConnectionProfile -- create (fail if exists)
# ------------------------------------------------------------------
function New-M365ConnectionProfile {
    <#
    .SYNOPSIS
        Creates a new named connection profile.
    .DESCRIPTION
        Creates a connection profile in .m365assess.json. Fails if a profile
        with the same name already exists -- use Set-M365ConnectionProfile to
        update an existing profile.
    .PARAMETER ProfileName
        A friendly name for this connection profile (e.g., 'Production', 'DevTenant').
    .PARAMETER TenantId
        Tenant ID or domain (e.g., 'contoso.onmicrosoft.com').
    .PARAMETER AuthMethod
        Authentication method: Interactive, DeviceCode, Certificate, ManagedIdentity.
    .PARAMETER ClientId
        Application (client) ID for app-only authentication.
    .PARAMETER CertificateThumbprint
        Certificate thumbprint for app-only authentication.
    .PARAMETER UserPrincipalName
        Optional UPN for EXO/Purview interactive auth.
    .PARAMETER M365Environment
        Cloud environment: commercial, gcc, gcchigh, dod.
    .PARAMETER AppName
        Optional friendly name for the app registration.
    .EXAMPLE
        New-M365ConnectionProfile -ProfileName 'Production' -TenantId 'contoso.onmicrosoft.com' -AuthMethod Interactive
    .EXAMPLE
        New-M365ConnectionProfile -ProfileName 'CertAuth' -TenantId 'contoso.onmicrosoft.com' -ClientId '...' -CertificateThumbprint 'ABC123' -AuthMethod Certificate
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

    $configPath = Get-ProfileConfigPath
    $config = Read-ProfileConfig -ConfigPath $configPath

    $existingKey = $config['profiles'].Keys | Where-Object { $_ -eq $ProfileName } | Select-Object -First 1
    if ($existingKey) {
        Write-Error "Profile '$existingKey' already exists. Use Set-M365ConnectionProfile to update it, or Remove-M365ConnectionProfile to delete it first."
        return
    }

    $entry = Build-ProfileEntry -TenantId $TenantId -AuthMethod $AuthMethod -M365Environment $M365Environment -ClientId $ClientId -CertificateThumbprint $CertificateThumbprint -UserPrincipalName $UserPrincipalName -AppName $AppName
    $config['profiles'][$ProfileName] = $entry
    Write-ProfileConfig -Config $config -ConfigPath $configPath
    Write-Host "  Created connection profile '$ProfileName' for $TenantId" -ForegroundColor Green
}

# ------------------------------------------------------------------
# Set-M365ConnectionProfile -- create or update (upsert)
# ------------------------------------------------------------------
function Set-M365ConnectionProfile {
    <#
    .SYNOPSIS
        Creates or updates a named connection profile.
    .DESCRIPTION
        Upserts a connection profile in .m365assess.json. Creates the profile
        if it does not exist, or overwrites it if it does.
    .PARAMETER ProfileName
        A friendly name for this connection profile.
    .PARAMETER TenantId
        Tenant ID or domain (e.g., 'contoso.onmicrosoft.com').
    .PARAMETER AuthMethod
        Authentication method: Interactive, DeviceCode, Certificate, ManagedIdentity.
    .PARAMETER ClientId
        Application (client) ID for app-only authentication.
    .PARAMETER CertificateThumbprint
        Certificate thumbprint for app-only authentication.
    .PARAMETER UserPrincipalName
        Optional UPN for EXO/Purview interactive auth.
    .PARAMETER M365Environment
        Cloud environment: commercial, gcc, gcchigh, dod.
    .PARAMETER AppName
        Optional friendly name for the app registration.
    .EXAMPLE
        Set-M365ConnectionProfile -ProfileName 'Production' -TenantId 'contoso.onmicrosoft.com' -AuthMethod Certificate -ClientId '...' -CertificateThumbprint 'ABC123'
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

    $configPath = Get-ProfileConfigPath
    $config = Read-ProfileConfig -ConfigPath $configPath
    $verb = if ($config['profiles'].ContainsKey($ProfileName)) { 'Updated' } else { 'Created' }

    $entry = Build-ProfileEntry -TenantId $TenantId -AuthMethod $AuthMethod -M365Environment $M365Environment -ClientId $ClientId -CertificateThumbprint $CertificateThumbprint -UserPrincipalName $UserPrincipalName -AppName $AppName
    $config['profiles'][$ProfileName] = $entry
    Write-ProfileConfig -Config $config -ConfigPath $configPath
    Write-Host "  $verb connection profile '$ProfileName' for $TenantId" -ForegroundColor Green
}

# ------------------------------------------------------------------
# Remove-M365ConnectionProfile -- delete by name or all
# ------------------------------------------------------------------
function Remove-M365ConnectionProfile {
    <#
    .SYNOPSIS
        Removes a saved connection profile.
    .DESCRIPTION
        Deletes a named profile from .m365assess.json. Use -All to remove
        all saved profiles and reset the config file.
    .PARAMETER ProfileName
        Name of the profile to remove.
    .PARAMETER All
        Remove all saved profiles.
    .EXAMPLE
        Remove-M365ConnectionProfile -ProfileName 'OldTenant'
    .EXAMPLE
        Remove-M365ConnectionProfile -All
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, ParameterSetName = 'ByName')]
        [ValidateNotNullOrEmpty()]
        [string]$ProfileName,

        [Parameter(Mandatory, ParameterSetName = 'All')]
        [switch]$All
    )

    $configPath = Get-ProfileConfigPath
    $config = Read-ProfileConfig -ConfigPath $configPath

    if ($All) {
        $count = $config['profiles'].Count
        $config['profiles'] = @{}
        Write-ProfileConfig -Config $config -ConfigPath $configPath
        Write-Host "  Removed all $count connection profile(s)." -ForegroundColor Yellow
        return
    }

    # Case-insensitive lookup
    $matchKey = $config['profiles'].Keys | Where-Object { $_ -eq $ProfileName } | Select-Object -First 1
    if (-not $matchKey) {
        Write-Error "Profile '$ProfileName' not found. Use Get-M365ConnectionProfile to list available profiles."
        return
    }

    $config['profiles'].Remove($matchKey)
    Write-ProfileConfig -Config $config -ConfigPath $configPath
    Write-Host "  Removed connection profile '$ProfileName'." -ForegroundColor Yellow
}

# Backward compatibility: alias Save- to Set-
Set-Alias -Name Save-M365ConnectionProfile -Value Set-M365ConnectionProfile -Scope Global
