# New-TemporaryAccessPass.ps1 — EPIC-012 Temporary Access Pass worker (SPEC §3.2, §4.2 US-3, §5, §9).
#
# Creates a Temporary Access Pass live against Graph with the requested
# lifetime, one-time-use flag, and start time. -DryRun reports the intended
# pass metadata with no Graph write; apply requires -Confirmed (re-checked
# here so a job that skips confirmation cannot issue a pass). The pass value
# is returned in the result transport only: it is never written to disk, never
# logged, never persisted, and never included in any audit record. Only this
# result transport and the BFF response body ever carry it, exactly once. The
# Graph session is connected by the supervisor after materializing the tenant
# credential in-process; this file never touches secrets.

function New-TemporaryAccessPass {
    <#
    .SYNOPSIS
        Creates a Temporary Access Pass for a user live against Graph.
    .DESCRIPTION
        POSTs a temporaryAccessPassMethods record with lifetimeInMinutes,
        isUsableOnce, and an optional startDateTime, then returns the pass
        value once with its metadata. -DryRun returns planned metadata with a
        null value and no Graph write. Apply requires -Confirmed. Failures are
        returned, not thrown; only missing identifiers and missing confirmation
        throw.
    .PARAMETER TenantId
        Tenant the user belongs to. Carried through to the result envelope.
    .PARAMETER UserId
        The user the pass is issued for.
    .PARAMETER LifetimeMinutes
        Pass lifetime in minutes (10 to 43200).
    .PARAMETER OneTime
        The pass is usable once. Defaults to true.
    .PARAMETER StartTime
        Optional ISO-8601 start time. Empty means effective immediately.
    .PARAMETER DryRun
        Report the intended pass metadata without writing.
    .PARAMETER Confirmed
        Explicit confirmation for issuing a credential.
    .EXAMPLE
        New-TemporaryAccessPass -TenantId 'tenant-a' -UserId 'user-1' -LifetimeMinutes 60 -Confirmed
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$UserId,

        [Parameter()]
        [ValidateRange(10, 43200)]
        [int]$LifetimeMinutes = 60,

        [Parameter()]
        [bool]$OneTime = $true,

        [Parameter()]
        [string]$StartTime = '',

        [Parameter()]
        [switch]$DryRun,

        [Parameter()]
        [switch]$Confirmed
    )

    if (-not $DryRun -and -not $Confirmed) {
        throw 'mfa.confirm_required: issuing a Temporary Access Pass requires confirmation'
    }

    $start = $null
    if ($StartTime.Trim().Length -gt 0) {
        $parsed = [datetime]::MinValue
        if (-not [datetime]::TryParse($StartTime, [ref]$parsed)) {
            throw 'mfa.invalid_start_time: startTime must be an ISO-8601 date-time string'
        }
        $start = $parsed.ToUniversalTime().ToString('o')
    }

    if ($DryRun) {
        return [pscustomobject]@{
            id                  = $null
            userId              = $UserId
            tenantId            = $TenantId
            status              = 'planned'
            lifetimeMinutes     = $LifetimeMinutes
            oneTime             = $OneTime
            startTime           = $start
            expiresAt           = $null
            temporaryAccessPass = $null
            error               = $null
        }
    }

    $payload = @{
        lifetimeInMinutes = $LifetimeMinutes
        isUsableOnce      = $OneTime
    }
    if ($null -ne $start) {
        $payload['startDateTime'] = $start
    }

    try {
        $created = Invoke-MgGraphRequest -Method POST -Uri "/v1.0/users/$UserId/authentication/temporaryAccessPassMethods" -Body ($payload | ConvertTo-Json -Depth 3 -Compress)
    }
    catch {
        return [pscustomobject]@{
            id                  = $null
            userId              = $UserId
            tenantId            = $TenantId
            status              = 'failed'
            lifetimeMinutes     = $LifetimeMinutes
            oneTime             = $OneTime
            startTime           = $start
            expiresAt           = $null
            temporaryAccessPass = $null
            error               = $_.Exception.Message
        }
    }

    $value = [string]$created.temporaryAccessPass
    if ($value.Trim().Length -eq 0) {
        return [pscustomobject]@{
            id                  = [string]$created.id
            userId              = $UserId
            tenantId            = $TenantId
            status              = 'failed'
            lifetimeMinutes     = $LifetimeMinutes
            oneTime             = $OneTime
            startTime           = $start
            expiresAt           = $null
            temporaryAccessPass = $null
            error               = 'Graph returned no pass value'
        }
    }

    $anchor = Get-Date
    if ($null -ne $start) {
        $anchor = [datetime]$start
    }
    $expiresAt = $anchor.AddMinutes($LifetimeMinutes).ToString('o')

    return [pscustomobject]@{
        id                  = [string]$created.id
        userId              = $UserId
        tenantId            = $TenantId
        status              = 'applied'
        lifetimeMinutes     = $LifetimeMinutes
        oneTime             = $OneTime
        startTime           = $start
        expiresAt           = $expiresAt
        temporaryAccessPass = $value
        error               = $null
    }
}

function Read-TapJob {
    <#
    .SYNOPSIS
        Reads a T-0007 job envelope file into New-TemporaryAccessPass parameters.
    .DESCRIPTION
        Validates the envelope schema version, tenant, and user, then merges
        the lifetime, one-time-use, start time, dry-run, and confirmation
        flags. The envelope carries references only; secrets are never present
        and never needed here.
    .PARAMETER Path
        Path to the job envelope JSON the supervisor wrote for this run.
    .EXAMPLE
        Read-TapJob -Path './run/tap-job.json'
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "TAP job file not found: $Path"
    }
    $job = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
    if ($job['schemaVersion'] -ne 'v1') {
        throw "TAP job has unsupported schemaVersion: $($job['schemaVersion'])"
    }
    $tenantId = [string]$job['tenantId']
    if ([string]::IsNullOrWhiteSpace($tenantId)) {
        throw 'TAP job is missing required field: tenantId'
    }
    $payload = $job['payload']
    if ($payload -isnot [System.Collections.IDictionary]) {
        $payload = @{}
    }
    $userId = [string]$payload['userId']
    if ([string]::IsNullOrWhiteSpace($userId)) {
        throw 'TAP job is missing required field: payload.userId'
    }

    $lifetime = 60
    $rawLifetime = 0
    if ([int]::TryParse([string]$payload['lifetimeMinutes'], [ref]$rawLifetime) -and $rawLifetime -ge 10 -and $rawLifetime -le 43200) {
        $lifetime = $rawLifetime
    }

    return @{
        TenantId        = $tenantId
        UserId          = $userId
        LifetimeMinutes = $lifetime
        OneTime         = -not ($payload['oneTime'] -is [bool] -and $payload['oneTime'] -eq $false)
        StartTime       = [string]$payload['startTime']
        DryRun          = [bool]$payload['dryRun']
        Confirmed       = [bool]$payload['confirmed']
    }
}
