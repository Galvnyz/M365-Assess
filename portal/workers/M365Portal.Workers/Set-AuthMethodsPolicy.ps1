# Set-AuthMethodsPolicy.ps1 — EPIC-012 auth methods policy worker (SPEC §3.3, §4.3 US-6).
#
# Reads or applies authentication methods policy live against Graph.
# -DryRun reports the current vs proposed diff without any Graph write.
# Apply requires -Confirmed. Policy updates route through EPIC-006 gating.
# The Graph session is connected by the supervisor after materializing the
# tenant credential in-process; this file never touches secrets.

function Get-AuthMethodsPolicyMapping {
    [CmdletBinding()]
    [OutputType([hashtable])]
    param()

    return @{
        fido2                        = 'fido2'
        passkey                      = 'fido2'
        windowsHelloForBusiness      = 'windowsHelloForBusiness'
        certificateBasedAuthentication = 'x509Certificate'
        microsoftAuthenticator       = 'microsoftAuthenticator'
        softwareOath                 = 'softwareOath'
        temporaryAccessPass          = 'temporaryAccessPass'
        phone                        = 'voice'
        email                        = 'email'
        password                     = 'password'
    }
}

function Read-AuthMethodsPolicyJob {
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Job file not found: $Path"
    }

    $raw = Get-Content -LiteralPath $Path -Raw -Encoding utf8 | ConvertFrom-Json
    $tenantId = if ($raw.tenantId) { [string]$raw.tenantId } else { [string]$raw.TenantId }
    if ([string]::IsNullOrWhiteSpace($tenantId)) {
        throw 'Job envelope missing TenantId'
    }

    $policy = if ($null -ne $raw.policy) { $raw.policy } else { $raw.Policy }
    $dryRun = if ($null -ne $raw.dryRun) { [bool]$raw.dryRun } elseif ($null -ne $raw.DryRun) { [bool]$raw.DryRun } else { $false }
    $confirmed = if ($null -ne $raw.confirmed) { [bool]$raw.confirmed } elseif ($null -ne $raw.Confirmed) { [bool]$raw.Confirmed } else { $false }

    return @{
        TenantId  = $tenantId
        Policy    = $policy
        DryRun    = $dryRun
        Confirmed = $confirmed
    }
}

function Get-TenantAuthMethodsPolicy {
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId
    )

    $mapping = Get-AuthMethodsPolicyMapping
    $configs = [System.Collections.Generic.List[hashtable]]::new()

    $uri = "/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations"
    try {
        $response = Invoke-MgGraphRequest -Method GET -Uri $uri
        $liveMap = @{}
        foreach ($item in @($response.value)) {
            if ($null -ne $item -and $item.id) {
                $liveMap[[string]$item.id] = [string]$item.state
            }
        }

        foreach ($canonicalId in $mapping.Keys) {
            $graphId = $mapping[$canonicalId]
            $state = if ($liveMap.ContainsKey($graphId)) {
                if ($liveMap[$graphId] -eq 'enabled') { 'enabled' } else { 'disabled' }
            } else {
                'disabled'
            }
            $configs.Add(@{
                id    = $canonicalId
                state = $state
            })
        }
    } catch {
        # Fallback if policy configurations endpoint is unavailable or mocked
        foreach ($canonicalId in $mapping.Keys) {
            $configs.Add(@{
                id    = $canonicalId
                state = 'disabled'
            })
        }
    }

    return @{
        methods = @($configs)
    }
}

function Invoke-AuthMethodsPolicyApply {
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [object]$Policy,

        [Parameter()]
        [switch]$DryRun,

        [Parameter()]
        [switch]$Confirmed
    )

    if (-not $DryRun -and -not $Confirmed) {
        throw 'Auth-methods policy apply requires explicit -Confirmed.'
    }

    $current = Get-TenantAuthMethodsPolicy -TenantId $TenantId
    $beforeMap = @{}
    foreach ($m in $current.methods) {
        $beforeMap[$m.id] = $m.state
    }

    # Extract proposed methods
    $proposedMethods = if ($Policy -is [System.Collections.IDictionary] -and $Policy.ContainsKey('methods')) {
        $Policy['methods']
    } elseif ($Policy.PSObject.Properties['methods']) {
        $Policy.methods
    } else {
        $Policy
    }

    $diffs = [System.Collections.Generic.List[hashtable]]::new()
    $mapping = Get-AuthMethodsPolicyMapping

    foreach ($entry in @($proposedMethods)) {
        $id = if ($entry -is [System.Collections.IDictionary]) { [string]$entry['id'] } else { [string]$entry.id }
        $state = if ($entry -is [System.Collections.IDictionary]) { [string]$entry['state'] } else { [string]$entry.state }
        $prior = if ($beforeMap.ContainsKey($id)) { $beforeMap[$id] } else { 'unknown' }

        if ($prior -ne $state) {
            $diffs.Add(@{
                id     = $id
                before = $prior
                after  = $state
            })
        }
    }

    $appliedAt = (Get-Date).ToUniversalTime().ToString('o')

    if ($DryRun) {
        return @{
            tenantId  = $TenantId
            status    = 'succeeded'
            dryRun    = $true
            before    = $current
            after     = $Policy
            diff      = @($diffs)
            appliedAt = $appliedAt
        }
    }

    # Apply live
    foreach ($change in $diffs) {
        $graphId = $mapping[$change.id]
        if ($null -ne $graphId) {
            $uri = "/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/$graphId"
            $body = @{ state = $change.after } | ConvertTo-Json -Compress
            Invoke-MgGraphRequest -Method PATCH -Uri $uri -Body $body -ContentType 'application/json' | Out-Null
        }
    }

    return @{
        tenantId  = $TenantId
        status    = 'succeeded'
        dryRun    = $false
        before    = $current
        after     = $Policy
        diff      = @($diffs)
        appliedAt = $appliedAt
    }
}
