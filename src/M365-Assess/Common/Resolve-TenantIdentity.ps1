<#
.SYNOPSIS
    Resolves the canonical tenant identity for baseline / drift bookkeeping.
.DESCRIPTION
    Returns a PSCustomObject describing the connected tenant in stable terms:

      Guid          : the tenant GUID (from Get-MgContext.TenantId after Graph
                      connect) -- the canonical identifier used as the folder
                      key for baselines (C1 #780). Falls back to a stable hash
                      of the user-supplied TenantId if Graph isn't connected.
      DisplayName   : tenant display name (from Get-MgOrganization)
      PrimaryDomain : primary verified domain (Get-MgOrganization VerifiedDomains
                      with isDefault=true)
      Environment   : commercial / gcc / gcchigh / dod (passed in by caller)
      Source        : 'Graph' when fully resolved, 'Fallback' when Graph data
                      was unavailable -- callers can warn

    The function is read-only: no Graph calls beyond Get-MgContext +
    Get-MgOrganization, both of which are already in the assessment's required
    permissions for the Tenant section.

    Resolves once per assessment run (caller caches the result). Used by the
    baseline export/compare path and intended for any future feature that
    needs a stable tenant identifier (#812 permissions deficit CSV, #802
    score-disclosure, etc.).
.PARAMETER TenantIdInput
    The user-supplied -TenantId from Invoke-M365Assessment. Used as the
    fallback folder key when Graph context isn't usable (e.g. AD-only runs).
.PARAMETER Environment
    The cloud environment (commercial/gcc/gcchigh/dod). Stored as metadata.
.EXAMPLE
    $identity = Resolve-TenantIdentity -TenantIdInput $TenantId -Environment $M365Environment
    $folderKey = $identity.Guid
#>
function Resolve-TenantIdentity {
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter()]
        [AllowEmptyString()]
        [string]$TenantIdInput = '',

        [Parameter()]
        [string]$Environment = 'commercial'
    )

    $guid          = $null
    $displayName   = ''
    $primaryDomain = ''
    $source        = 'Fallback'

    try {
        $context = Get-MgContext -ErrorAction SilentlyContinue
        if ($context -and $context.TenantId) {
            $guid = [string]$context.TenantId
            $source = 'Graph'
        }
    }
    catch { Write-Verbose "Resolve-TenantIdentity: Get-MgContext threw: $($_.Exception.Message)" }

    # Try to enrich with display name + primary domain via Get-MgOrganization.
    # This call requires Organization.Read.All which the Tenant section already
    # asks for, so it's expected to succeed for any normal assessment run.
    if ($guid) {
        try {
            $org = Get-MgOrganization -ErrorAction Stop | Select-Object -First 1
            if ($org) {
                $displayName = [string]$org.DisplayName
                $primary = $org.VerifiedDomains | Where-Object { $_.IsDefault } | Select-Object -First 1
                if ($primary) { $primaryDomain = [string]$primary.Name }
            }
        }
        catch { Write-Verbose "Resolve-TenantIdentity: Get-MgOrganization unavailable: $($_.Exception.Message)" }
    }

    # Fallback: synthesize a stable key from the user-supplied TenantId. The
    # resulting "guid" isn't a real GUID -- it's a deterministic 32-hex hash
    # so identical TenantIdInput values produce identical folder keys.
    if (-not $guid) {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try {
            $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($TenantIdInput.ToLowerInvariant()))
            $hex = ([System.BitConverter]::ToString($bytes) -replace '-', '').Substring(0, 32).ToLowerInvariant()
            # Format as a GUID-shaped string so callers can treat it uniformly.
            $guid = "{0}-{1}-{2}-{3}-{4}" -f $hex.Substring(0, 8), $hex.Substring(8, 4), $hex.Substring(12, 4), $hex.Substring(16, 4), $hex.Substring(20, 12)
        }
        finally {
            $sha.Dispose()
        }
    }

    return [pscustomobject]@{
        Guid          = $guid
        DisplayName   = $displayName
        PrimaryDomain = $primaryDomain
        Environment   = $Environment
        Source        = $source
        TenantInput   = $TenantIdInput
    }
}

function Resolve-BaselineFolder {
    <#
    .SYNOPSIS
        Resolves a baseline folder path, preferring GUID-keyed naming
        and falling back to legacy TenantId-keyed naming for read.
    .DESCRIPTION
        C1 #780: baselines saved on v2.9.0+ use '<Label>_<TenantGuid>' as
        the folder name. Pre-v2.9.0 baselines used '<Label>_<TenantId>'
        where TenantId was whatever string the user supplied. This helper
        searches the GUID path first, then the legacy path. Returns the
        first existing folder, or the canonical GUID path if neither
        exists (so error messages point at the new location).
    .PARAMETER OutputFolder
        Root output folder (parent of Baselines/).
    .PARAMETER Label
        Baseline label.
    .PARAMETER TenantGuid
        Canonical tenant GUID. If supplied, the GUID-keyed folder is the
        first candidate.
    .PARAMETER TenantId
        Legacy tenant identifier (vanity domain or onmicrosoft.com short).
        Searched as a fallback for pre-v2.9.0 baselines.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [string]$OutputFolder,

        [Parameter(Mandatory)]
        [string]$Label,

        [Parameter()]
        [string]$TenantGuid = '',

        [Parameter()]
        [string]$TenantId = ''
    )

    $safeLabel = $Label -replace '[^\w\-]', '_'
    $candidates = @()
    if ($TenantGuid) {
        $g = $TenantGuid -replace '[^\w\-]', ''
        $candidates += (Join-Path -Path $OutputFolder -ChildPath ("Baselines\${safeLabel}_${g}"))
    }
    if ($TenantId) {
        $t = $TenantId -replace '[^\w\.\-]', '_'
        $candidates += (Join-Path -Path $OutputFolder -ChildPath ("Baselines\${safeLabel}_${t}"))
    }

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Container) {
            return $candidate
        }
    }

    # Neither folder exists -- return the canonical (GUID) candidate if we
    # have one, else the legacy candidate. This lets callers compose useful
    # "not found" messages pointing at the path they expected.
    if ($candidates.Count -gt 0) { return $candidates[0] }
    return Join-Path -Path $OutputFolder -ChildPath ("Baselines\${safeLabel}")
}
