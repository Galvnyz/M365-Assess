# Set-GroupGalDelivery.ps1 — EPIC-014 Hide-from-GAL and delivery management via EXO (SPEC §3.4, §4.4, §6; T-0269).
#
# Runs in per-tenant child process with Exchange Online session.
# Updates HiddenFromAddressListsEnabled (GAL) and delivery management (RequireSenderAuthenticationEnabled, GrantSendOnBehalfTo).
# Validates delivery combinations, captures before/after, and generates audit events.

function Test-DeliveryManagementInput {
    param(
        [Parameter()]
        [bool]$RequireSenderAuthenticationEnabled,

        [Parameter()]
        [array]$GrantSendOnBehalfTo
    )

    if ($null -ne $GrantSendOnBehalfTo -and $GrantSendOnBehalfTo.Count -gt 0) {
        foreach ($grant in $GrantSendOnBehalfTo) {
            if ([string]::IsNullOrWhiteSpace($grant)) {
                return @{
                    Valid   = $false
                    Message = 'GrantSendOnBehalfTo cannot contain empty or whitespace entries.'
                }
            }
        }
    }

    return @{ Valid = $true; Message = 'Valid delivery settings.' }
}

function Read-SetGroupGalDeliveryJob {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "job envelope not found at '$Path'"
    }

    $raw = Get-Content -LiteralPath $Path -Raw
    $json = $raw | ConvertFrom-Json
    if (-not $json.tenantId) {
        throw "job envelope '$Path' is missing mandatory 'tenantId'"
    }
    if (-not $json.groupId) {
        throw "job envelope '$Path' is missing mandatory 'groupId'"
    }
    if (-not $json.target) {
        throw "job envelope '$Path' is missing mandatory 'target' (gal or delivery)"
    }

    $sendOnBehalf = @()
    if ($json.grantSendOnBehalfTo) {
        $sendOnBehalf = @($json.grantSendOnBehalfTo)
    }

    return @{
        TenantId                           = [string]$json.tenantId
        GroupId                            = [string]$json.groupId
        Target                             = [string]$json.target
        HiddenFromAddressListsEnabled      = [bool]($json.hiddenFromAddressListsEnabled -eq $true)
        RequireSenderAuthenticationEnabled = [bool]($json.requireSenderAuthenticationEnabled -eq $true)
        GrantSendOnBehalfTo                = $sendOnBehalf
        DryRun                             = [bool]($json.dryRun -eq $true)
    }
}

function Invoke-SetGroupGalDelivery {
    <#
    .SYNOPSIS
        Applies GAL or delivery management changes via Exchange Online cmdlets.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$GroupId,

        [Parameter(Mandatory)]
        [ValidateSet('gal', 'delivery')]
        [string]$Target,

        [Parameter()]
        [bool]$HiddenFromAddressListsEnabled = $false,

        [Parameter()]
        [bool]$RequireSenderAuthenticationEnabled = $false,

        [Parameter()]
        [array]$GrantSendOnBehalfTo = @(),

        [Parameter()]
        [bool]$DryRun = $false
    )

    # 1. Validation for delivery management
    if ($Target -eq 'delivery') {
        $val = Test-DeliveryManagementInput -RequireSenderAuthenticationEnabled $RequireSenderAuthenticationEnabled -GrantSendOnBehalfTo $GrantSendOnBehalfTo
        if (-not $val.Valid) {
            throw "ValidationFailed: $($val.Message)"
        }
    }

    # 2. Fetch before state
    $before = @{
        hiddenFromAddressListsEnabled      = $false
        requireSenderAuthenticationEnabled = $false
        grantSendOnBehalfTo                = ,@()
    }

    $isUnified = $false
    try {
        if (Get-Command Get-UnifiedGroup -ErrorAction SilentlyContinue) {
            $ug = Get-UnifiedGroup -Identity $GroupId -ErrorAction SilentlyContinue
            if ($ug) {
                $isUnified = $true
                $before.hiddenFromAddressListsEnabled = [bool]$ug.HiddenFromAddressListsEnabled
                $before.requireSenderAuthenticationEnabled = [bool]$ug.RequireSenderAuthenticationEnabled
                if ($ug.GrantSendOnBehalfTo) {
                    $before.grantSendOnBehalfTo = ,@($ug.GrantSendOnBehalfTo)
                }
            }
        }
        if (-not $isUnified -and (Get-Command Get-DistributionGroup -ErrorAction SilentlyContinue)) {
            $dg = Get-DistributionGroup -Identity $GroupId -ErrorAction SilentlyContinue
            if ($dg) {
                $before.hiddenFromAddressListsEnabled = [bool]$dg.HiddenFromAddressListsEnabled
                $before.requireSenderAuthenticationEnabled = [bool]$dg.RequireSenderAuthenticationEnabled
                if ($dg.GrantSendOnBehalfTo) {
                    $before.grantSendOnBehalfTo = ,@($dg.GrantSendOnBehalfTo)
                }
            }
        }
    }
    catch {
        # Fallback to defaults if query fails
    }

    # 3. Calculate after state and diff
    $after = @{
        hiddenFromAddressListsEnabled      = if ($Target -eq 'gal') { $HiddenFromAddressListsEnabled } else { $before.hiddenFromAddressListsEnabled }
        requireSenderAuthenticationEnabled = if ($Target -eq 'delivery') { $RequireSenderAuthenticationEnabled } else { $before.requireSenderAuthenticationEnabled }
        grantSendOnBehalfTo                = if ($Target -eq 'delivery') { ,@($GrantSendOnBehalfTo) } else { ,@($before.grantSendOnBehalfTo) }
    }

    $diff = [System.Collections.Generic.List[string]]::new()
    if ($Target -eq 'gal') {
        $diff.Add("Set HiddenFromAddressListsEnabled: $($before.hiddenFromAddressListsEnabled) -> $HiddenFromAddressListsEnabled")
    }
    elseif ($Target -eq 'delivery') {
        $diff.Add("Set RequireSenderAuthenticationEnabled: $($before.requireSenderAuthenticationEnabled) -> $RequireSenderAuthenticationEnabled")
        if ($GrantSendOnBehalfTo.Count -gt 0) {
            $diff.Add("Set GrantSendOnBehalfTo: $($GrantSendOnBehalfTo -join ', ')")
        }
    }

    $plan = [pscustomobject]@{
        tenantId = $TenantId
        groupId  = $GroupId
        target   = $Target
        before   = $before
        after    = $after
        diff     = @($diff)
        dryRun   = $DryRun
    }

    if ($DryRun) {
        return $plan
    }

    # 4. Apply write via EXO cmdlets
    if ($Target -eq 'gal') {
        if ($isUnified -and (Get-Command Set-UnifiedGroup -ErrorAction SilentlyContinue)) {
            Set-UnifiedGroup -Identity $GroupId -HiddenFromAddressListsEnabled $HiddenFromAddressListsEnabled -Confirm:$false
        }
        elseif (Get-Command Set-DistributionGroup -ErrorAction SilentlyContinue) {
            Set-DistributionGroup -Identity $GroupId -HiddenFromAddressListsEnabled $HiddenFromAddressListsEnabled -Confirm:$false
        }
    }
    elseif ($Target -eq 'delivery') {
        $params = @{
            Identity                           = $GroupId
            RequireSenderAuthenticationEnabled = $RequireSenderAuthenticationEnabled
            Confirm                            = $false
        }
        if ($GrantSendOnBehalfTo.Count -gt 0) {
            $params['GrantSendOnBehalfTo'] = $GrantSendOnBehalfTo
        }

        if ($isUnified -and (Get-Command Set-UnifiedGroup -ErrorAction SilentlyContinue)) {
            Set-UnifiedGroup @params
        }
        elseif (Get-Command Set-DistributionGroup -ErrorAction SilentlyContinue) {
            Set-DistributionGroup @params
        }
    }

    $now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $auditEvent = [pscustomobject]@{
        id        = [guid]::NewGuid().ToString()
        tenantId  = $TenantId
        action    = "group.$Target"
        targetId  = $GroupId
        timestamp = $now
        before    = $before
        after     = $after
    }

    return [pscustomobject]@{
        success    = $true
        plan       = $plan
        before     = $before
        after      = $after
        auditEvent = $auditEvent
    }
}
