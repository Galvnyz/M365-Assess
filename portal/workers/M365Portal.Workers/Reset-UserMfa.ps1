# Reset-UserMfa.ps1 — EPIC-012 MFA reset worker (SPEC §3.2, §4.2 US-2).
#
# Removes a user's authentication methods live against Graph so
# re-registration is required. -DryRun reports the methods that would be
# removed with no Graph write; apply requires -Confirmed (re-checked here so a
# job that skips confirmation cannot remove methods). Deletions are attempted
# per method and recorded individually: one method failing does not abort the
# rest, and the result carries the post-reset method state. The Graph session
# is connected by the supervisor after materializing the tenant credential
# in-process; this file never touches secrets and never writes user data to
# disk, logs, or transcripts.

. (Join-Path -Path $PSScriptRoot -ChildPath 'Get-MfaReport.ps1')

function Get-MfaResettableSegments {
    <#
    .SYNOPSIS
        Maps canonical method ids to their Graph authentication collections.
    .DESCRIPTION
        The single source of truth for which method kinds the reset worker
        deletes. Kinds without a per-user delete collection are absent and are
        reported as skipped, never passed through.
    .EXAMPLE
        Get-MfaResettableSegments
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param()

    return @{
        fido2                        = 'fido2Methods'
        passkey                      = 'passkeyMethods'
        windowsHelloForBusiness      = 'windowsHelloForBusinessMethods'
        microsoftAuthenticator       = 'microsoftAuthenticatorMethods'
        softwareOath                 = 'softwareOathMethods'
        temporaryAccessPass          = 'temporaryAccessPassMethods'
        phone                        = 'phoneMethods'
        email                        = 'emailMethods'
        password                     = 'passwordMethods'
    }
}

function Get-MfaRawMethods {
    <#
    .SYNOPSIS
        Reads a user's live authentication methods with their Graph ids.
    .DESCRIPTION
        GETs /users/{id}/authentication/methods and returns each record with
        its canonical id (or empty when the Graph type is unrecognised).
    .PARAMETER UserId
        The user id.
    .EXAMPLE
        Get-MfaRawMethods -UserId 'user-1'
    #>
    [CmdletBinding()]
    [OutputType([object[]])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$UserId
    )

    $records = [System.Collections.Generic.List[object]]::new()
    $uri = "/v1.0/users/$UserId/authentication/methods?`$top=100"
    do {
        $response = Invoke-MgGraphRequest -Method GET -Uri $uri
        foreach ($entry in @($response.value)) {
            if ($null -eq $entry) {
                continue
            }
            $records.Add([pscustomobject]@{
                id       = [string]$entry.id
                methodId = ConvertTo-MfaMethodId -OdataType ([string]$entry.'@odata.type')
            })
        }
        $uri = $response.'@odata.nextLink'
    } while ($uri)
    return @($records)
}

function Invoke-MfaReset {
    <#
    .SYNOPSIS
        Removes a user's authentication methods live against Graph.
    .DESCRIPTION
        Lists the user's methods, then DELETEs each resettable one and returns
        the post-reset canonical method list. -DryRun returns the would-remove
        list with no Graph write. Apply requires -Confirmed. Per-method
        failures are recorded and do not abort the remaining deletes; the
        overall status is failed when any delete failed.
    .PARAMETER TenantId
        Tenant the user belongs to. Carried through to the result envelope.
    .PARAMETER UserId
        The user id.
    .PARAMETER DryRun
        Report the intended change without writing.
    .PARAMETER Confirmed
        Explicit confirmation for this destructive action.
    .EXAMPLE
        Invoke-MfaReset -TenantId 'tenant-a' -UserId 'user-1' -DryRun
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
        [switch]$DryRun,

        [Parameter()]
        [switch]$Confirmed
    )

    if (-not $DryRun -and -not $Confirmed) {
        throw 'mfa.confirm_required: resetting MFA removes authentication methods and requires confirmation'
    }

    $segments = Get-MfaResettableSegments
    $before = Get-MfaRawMethods -UserId $UserId
    $beforeIds = @($before | ForEach-Object { $_.methodId } | Where-Object { -not [string]::IsNullOrEmpty($_) })

    if ($DryRun) {
        return [pscustomobject]@{
            userId       = $UserId
            tenantId     = $TenantId
            status       = 'planned'
            methods      = $beforeIds
            methodsAfter = $beforeIds
            removed      = @($beforeIds)
            skipped      = @()
            error        = $null
        }
    }

    $removed = [System.Collections.Generic.List[string]]::new()
    $skipped = [System.Collections.Generic.List[string]]::new()
    $failures = [System.Collections.Generic.List[string]]::new()
    foreach ($record in $before) {
        if ([string]::IsNullOrEmpty($record.methodId)) {
            $skipped.Add('unknown')
            continue
        }
        if (-not $segments.ContainsKey($record.methodId)) {
            $skipped.Add($record.methodId)
            continue
        }
        $segment = $segments[$record.methodId]
        try {
            Invoke-MgGraphRequest -Method DELETE -Uri "/v1.0/users/$UserId/authentication/$segment/$($record.id)" | Out-Null
            $removed.Add($record.methodId)
        }
        catch {
            $failures.Add("$($record.methodId): $($_.Exception.Message)")
        }
    }

    $afterIds = @()
    try {
        $after = Get-MfaRawMethods -UserId $UserId
        $afterIds = @($after | ForEach-Object { $_.methodId } | Where-Object { -not [string]::IsNullOrEmpty($_) })
    }
    catch {
        $afterIds = @()
    }

    $status = 'applied'
    $error = $null
    if ($failures.Count -gt 0) {
        $status = 'failed'
        $error = $failures -join '; '
    }

    return [pscustomobject]@{
        userId       = $UserId
        tenantId     = $TenantId
        status       = $status
        methods      = $beforeIds
        methodsAfter = $afterIds
        removed      = @($removed)
        skipped      = @($skipped)
        error        = $error
    }
}

function Read-MfaResetJob {
    <#
    .SYNOPSIS
        Reads a T-0007 job envelope file into Invoke-MfaReset parameters.
    .DESCRIPTION
        Validates the envelope schema version, tenant, and user, then merges
        the dry-run/confirmation flags. The envelope carries references only;
        secrets are never present and never needed here.
    .PARAMETER Path
        Path to the job envelope JSON the supervisor wrote for this run.
    .EXAMPLE
        Read-MfaResetJob -Path './run/mfa-reset-job.json'
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "MFA reset job file not found: $Path"
    }
    $job = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
    if ($job['schemaVersion'] -ne 'v1') {
        throw "MFA reset job has unsupported schemaVersion: $($job['schemaVersion'])"
    }
    $tenantId = [string]$job['tenantId']
    if ([string]::IsNullOrWhiteSpace($tenantId)) {
        throw 'MFA reset job is missing required field: tenantId'
    }
    $payload = $job['payload']
    if ($payload -isnot [System.Collections.IDictionary]) {
        $payload = @{}
    }
    $userId = [string]$payload['userId']
    if ([string]::IsNullOrWhiteSpace($userId)) {
        throw 'MFA reset job is missing required field: payload.userId'
    }

    return @{
        TenantId  = $tenantId
        UserId    = $userId
        DryRun    = [bool]$payload['dryRun']
        Confirmed = [bool]$payload['confirmed']
    }
}
