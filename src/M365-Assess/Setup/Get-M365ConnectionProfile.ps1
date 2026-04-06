function Get-M365ConnectionProfile {
    <#
    .SYNOPSIS
        Lists or retrieves saved M365 connection profiles.
    .DESCRIPTION
        Reads connection profiles from .m365assess.json. Without -ProfileName,
        lists all saved profiles. With -ProfileName, returns the specific profile.
    .PARAMETER ProfileName
        Optional name of a specific profile to retrieve.
    .EXAMPLE
        Get-M365ConnectionProfile
        Lists all saved profiles.
    .EXAMPLE
        Get-M365ConnectionProfile -ProfileName 'Production'
        Returns the Production profile details.
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject[]])]
    param(
        [Parameter()]
        [string]$ProfileName
    )

    $projectRoot = if ($PSCommandPath) { Split-Path -Parent (Split-Path -Parent $PSCommandPath) } else { $PSScriptRoot }
    $configPath = Join-Path -Path $projectRoot -ChildPath '.m365assess.json'

    if (-not (Test-Path -Path $configPath)) {
        Write-Host '  No saved connection profiles found.' -ForegroundColor DarkGray
        Write-Host "  Use Save-M365ConnectionProfile to create one." -ForegroundColor DarkGray
        return @()
    }

    try {
        $config = Get-Content -Path $configPath -Raw | ConvertFrom-Json -AsHashtable
    }
    catch {
        Write-Error "Could not read config file: $_"
        return @()
    }

    $profiles = if ($config.ContainsKey('profiles')) { $config['profiles'] } else { @{} }

    # Also surface legacy entries (keyed by TenantId at root level, no 'profiles' wrapper)
    foreach ($key in $config.Keys) {
        if ($key -eq 'profiles') { continue }
        $entry = $config[$key]
        if ($entry -is [hashtable] -and $entry.ContainsKey('clientId')) {
            if (-not $profiles.ContainsKey($key)) {
                $profiles[$key] = $entry
                $profiles[$key]['tenantId'] = $key
                $profiles[$key]['authMethod'] = 'Certificate'
            }
        }
    }

    if ($ProfileName) {
        # Case-insensitive lookup
        $matchKey = $profiles.Keys | Where-Object { $_ -eq $ProfileName } | Select-Object -First 1
        if ($matchKey) {
            $p = $profiles[$matchKey]
            return [PSCustomObject]@{
                Name        = $matchKey
                TenantId    = $p['tenantId']
                AuthMethod  = $p['authMethod']
                ClientId    = $p['clientId']
                Thumbprint  = $p['thumbprint']
                UPN         = $p['upn']
                Environment = $p['environment']
                AppName     = $p['appName']
                Saved       = $p['saved']
                LastUsed    = $p['lastUsed']
            }
        }
        else {
            Write-Error "Profile '$ProfileName' not found. Use Get-M365ConnectionProfile to list available profiles."
            return $null
        }
    }

    # Return all profiles
    $result = @()
    foreach ($name in ($profiles.Keys | Sort-Object)) {
        $p = $profiles[$name]
        $result += [PSCustomObject]@{
            Name        = $name
            TenantId    = $p['tenantId']
            AuthMethod  = $p['authMethod']
            ClientId    = $p['clientId']
            Environment = if ($p['environment']) { $p['environment'] } else { 'commercial' }
            Saved       = $p['saved']
            LastUsed    = $p['lastUsed']
        }
    }
    return $result
}
