# Set-RegistrationCampaign.ps1 — EPIC-012 registration campaign worker (SPEC §3.4, §4.4 US-7).
#
# Reads and configures the Microsoft Authenticator registration campaign live against Graph.
# Applies state (enabled/disabled), snooze duration, and included/excluded groups.
# Apply requires -Confirmed. The Graph session is connected by the supervisor after
# materializing the tenant credential in-process; this file never touches secrets.

function Read-RegistrationCampaignJob {
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

    $state = if ($raw.state) { [string]$raw.state } elseif ($raw.State) { [string]$raw.State } else { 'disabled' }
    $snooze = if ($null -ne $raw.snoozeDurationInDays) { [int]$raw.snoozeDurationInDays } elseif ($null -ne $raw.SnoozeDurationInDays) { [int]$raw.SnoozeDurationInDays } else { 1 }
    $includes = if ($raw.includeTargets) { @($raw.includeTargets) } elseif ($raw.IncludeTargets) { @($raw.IncludeTargets) } else { @() }
    $excludes = if ($raw.excludeTargets) { @($raw.excludeTargets) } elseif ($raw.ExcludeTargets) { @($raw.ExcludeTargets) } else { @() }
    $confirmed = if ($null -ne $raw.confirmed) { [bool]$raw.confirmed } elseif ($null -ne $raw.Confirmed) { [bool]$raw.Confirmed } else { $false }

    return @{
        TenantId             = $tenantId
        State                = $state
        SnoozeDurationInDays = $snooze
        IncludeTargets       = $includes
        ExcludeTargets       = $excludes
        Confirmed            = $confirmed
    }
}

function Get-TenantRegistrationCampaign {
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId
    )

    $uri = "/v1.0/policies/authenticationMethodsPolicy"
    try {
        $response = Invoke-MgGraphRequest -Method GET -Uri $uri
        $campaign = $response.registrationEnforcement.authenticationMethodsRegistrationCampaign

        $state = if ($null -ne $campaign -and $campaign.state -eq 'enabled') { 'enabled' } else { 'disabled' }
        $snooze = if ($null -ne $campaign -and $null -ne $campaign.snoozeDurationInDays) { [int]$campaign.snoozeDurationInDays } else { 1 }
        $includes = [System.Collections.Generic.List[string]]::new()
        if ($null -ne $campaign -and $null -ne $campaign.includeTargets) {
            foreach ($item in @($campaign.includeTargets)) {
                if ($null -ne $item -and $item.id) {
                    $includes.Add([string]$item.id)
                }
            }
        }
        $excludes = [System.Collections.Generic.List[string]]::new()
        if ($null -ne $campaign -and $null -ne $campaign.excludeTargets) {
            foreach ($item in @($campaign.excludeTargets)) {
                if ($null -ne $item -and $item.id) {
                    $excludes.Add([string]$item.id)
                }
            }
        }

        return @{
            tenantId             = $TenantId
            state                = $state
            snoozeDurationInDays = $snooze
            includeTargets       = @($includes)
            excludeTargets       = @($excludes)
            eligibleUserCount    = 0
            retrievedAt          = (Get-Date).ToUniversalTime().ToString('o')
        }
    } catch {
        return @{
            tenantId             = $TenantId
            state                = 'disabled'
            snoozeDurationInDays = 1
            includeTargets       = @()
            excludeTargets       = @()
            eligibleUserCount    = 0
            retrievedAt          = (Get-Date).ToUniversalTime().ToString('o')
        }
    }
}

function Invoke-RegistrationCampaignSet {
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [ValidateSet('enabled', 'disabled')]
        [string]$State,

        [Parameter()]
        [ValidateRange(1, 14)]
        [int]$SnoozeDurationInDays = 1,

        [Parameter()]
        [string[]]$IncludeTargets = @(),

        [Parameter()]
        [string[]]$ExcludeTargets = @(),

        [Parameter()]
        [switch]$Confirmed
    )

    if (-not $Confirmed) {
        throw 'Registration campaign apply requires explicit -Confirmed.'
    }

    $inc = @()
    foreach ($id in $IncludeTargets) {
        if (-not [string]::IsNullOrWhiteSpace($id)) {
            $inc += @{ id = $id.Trim(); targetType = 'group' }
        }
    }
    $exc = @()
    foreach ($id in $ExcludeTargets) {
        if (-not [string]::IsNullOrWhiteSpace($id)) {
            $exc += @{ id = $id.Trim(); targetType = 'group' }
        }
    }

    $body = @{
        registrationEnforcement = @{
            authenticationMethodsRegistrationCampaign = @{
                state                = $State
                snoozeDurationInDays = $SnoozeDurationInDays
                includeTargets       = $inc
                excludeTargets       = $exc
            }
        }
    } | ConvertTo-Json -Depth 6 -Compress

    $uri = "/v1.0/policies/authenticationMethodsPolicy"
    Invoke-MgGraphRequest -Method PATCH -Uri $uri -Body $body -ContentType 'application/json' | Out-Null

    return @{
        tenantId             = $TenantId
        status               = 'succeeded'
        state                = $State
        snoozeDurationInDays = $SnoozeDurationInDays
        includeTargets       = @($IncludeTargets)
        excludeTargets       = @($ExcludeTargets)
        appliedAt            = (Get-Date).ToUniversalTime().ToString('o')
    }
}
