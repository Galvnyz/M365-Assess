function Resolve-M365Environment {
    <#
    .SYNOPSIS
        Detects the M365 cloud environment for a tenant using the public OpenID
        Connect discovery endpoint (no authentication required).
    .DESCRIPTION
        Queries the well-known OpenID configuration to determine whether a tenant
        is Commercial, GCC, GCC High, or DoD. Tries the commercial authority first
        (handles legacy GCC High .com domains), then falls back to the US Government
        authority if the tenant is not found.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$TenantId
    )

    $authorities = @(
        'https://login.microsoftonline.com'
        'https://login.microsoftonline.us'
    )

    foreach ($authority in $authorities) {
        $url = "$authority/$TenantId/v2.0/.well-known/openid-configuration"
        try {
            $response = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 10 -ErrorAction Stop

            # Parse region fields to determine cloud environment
            $regionScope    = $response.tenant_region_scope
            $regionSubScope = $response.tenant_region_sub_scope

            if ($regionSubScope -eq 'GCC') {
                return 'gcc'
            }
            if ($regionScope -eq 'USGov') {
                # GCC High and DoD share the same pre-auth endpoint signals; 'gcchigh' is the safe default.
                # DoD operators must override with -M365Environment dod.
                return 'gcchigh'
            }
            return 'commercial'
        }
        catch {
            # Tenant not found on this authority, try next
            continue
        }
    }

    # Both authorities failed — return $null so caller keeps the current value
    return $null
}
