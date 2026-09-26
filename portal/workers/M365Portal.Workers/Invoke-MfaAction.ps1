# Invoke-MfaAction.ps1 — EPIC-012 push and default-method worker (SPEC §3.2 US-4, US-5).
#
# Sends an MFA push to a registered Authenticator device and changes the
# default MFA method live against Graph. -DryRun reports the intended change
# with no Graph write; apply requires -Confirmed (re-checked here so a job
# that skips confirmation cannot write). A push is refused with
# no_push_device when no Authenticator (push-capable) registration exists, and
# a default-method change is refused with unregistered_method when the
# requested method is not in the user's registered set — both are returned,
# not thrown. The Graph session is connected by the supervisor after
# materializing the tenant credential in-process; this file never touches
# secrets and never writes user data to disk, logs, or transcripts.

. (Join-Path -Path $PSScriptRoot -ChildPath 'Get-MfaReport.ps1')

function Get-MfaActionMethods {
    <#
    .SYNOPSIS
        Reads a user's live authentication methods with Graph ids.
    .DESCRIPTION
        GETs /users/{id}/authentication/methods and returns each record with
        its canonical id (empty when the Graph type is unrecognised).
    .PARAMETER UserId
        The user id.
    .EXAMPLE
        Get-MfaActionMethods -UserId 'user-1'
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

function Get-MfaActions {
    <#
    .SYNOPSIS
        Returns the MFA action set this worker dispatches.
    .DESCRIPTION
        The single source of truth for valid action names. Anything else is
        refused with mfa.unknown_action.
    .EXAMPLE
        Get-MfaActions
    #>
    [CmdletBinding()]
    [OutputType([string[]])]
    param()

    return @('push', 'defaultMethod')
}

function Send-MfaPush {
    <#
    .SYNOPSIS
        Sends an MFA push to the user's registered Authenticator device.
    .DESCRIPTION
        Reads the user's methods and targets the first Authenticator
        registration (the push-capable device). Without one the push is
        refused with code no_push_device and no Graph write is issued.
        -DryRun reports the target with no write. Apply requires -Confirmed.
    .PARAMETER TenantId
        Tenant the user belongs to. Carried through to the result envelope.
    .PARAMETER UserId
        The user id.
    .PARAMETER DryRun
        Report the intended push without writing.
    .PARAMETER Confirmed
        Explicit confirmation for this tenant write.
    .EXAMPLE
        Send-MfaPush -TenantId 'tenant-a' -UserId 'user-1' -Confirmed
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
        throw 'mfa.confirm_required: sending an MFA push requires confirmation'
    }

    $records = Get-MfaActionMethods -UserId $UserId
    $target = @($records | Where-Object { $_.methodId -eq 'microsoftAuthenticator' } | Select-Object -First 1)[0]
    if ($null -eq $target) {
        return [pscustomobject]@{
            userId     = $UserId
            tenantId   = $TenantId
            status     = 'failed'
            pushTarget = $null
            code       = 'no_push_device'
            error      = 'no push-capable device is registered for this user'
        }
    }

    if ($DryRun) {
        return [pscustomobject]@{
            userId     = $UserId
            tenantId   = $TenantId
            status     = 'planned'
            pushTarget = [string]$target.id
            code       = $null
            error      = $null
        }
    }

    try {
        $body = @{ displayName = 'M365-Assess push verification' } | ConvertTo-Json -Depth 2 -Compress
        Invoke-MgGraphRequest -Method POST -Uri "/v1.0/users/$UserId/authentication/microsoftAuthenticatorMethods/$($target.id)/push" -Body $body | Out-Null
    }
    catch {
        return [pscustomobject]@{
            userId     = $UserId
            tenantId   = $TenantId
            status     = 'failed'
            pushTarget = [string]$target.id
            code       = $null
            error      = $_.Exception.Message
        }
    }

    return [pscustomobject]@{
        userId     = $UserId
        tenantId   = $TenantId
        status     = 'applied'
        pushTarget = [string]$target.id
        code       = $null
        error      = $null
    }
}

function Set-MfaDefaultMethod {
    <#
    .SYNOPSIS
        Changes the user's default MFA method live against Graph.
    .DESCRIPTION
        Reads the user's registered set and refuses methods outside it with
        code unregistered_method. -DryRun reports the intended method with no
        write. Apply requires -Confirmed and PATCHes the sign-in preferences.
    .PARAMETER TenantId
        Tenant the user belongs to. Carried through to the result envelope.
    .PARAMETER UserId
        The user id.
    .PARAMETER Method
        Canonical method id to make the default.
    .PARAMETER DryRun
        Report the intended change without writing.
    .PARAMETER Confirmed
        Explicit confirmation for this tenant write.
    .EXAMPLE
        Set-MfaDefaultMethod -TenantId 'tenant-a' -UserId 'user-1' -Method 'phone' -Confirmed
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

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Method,

        [Parameter()]
        [switch]$DryRun,

        [Parameter()]
        [switch]$Confirmed
    )

    if (-not $DryRun -and -not $Confirmed) {
        throw 'mfa.confirm_required: changing the default MFA method requires confirmation'
    }

    $records = Get-MfaActionMethods -UserId $UserId
    $registered = @($records | ForEach-Object { $_.methodId } | Where-Object { -not [string]::IsNullOrEmpty($_) })
    if ($registered -notcontains $Method) {
        return [pscustomobject]@{
            userId        = $UserId
            tenantId      = $TenantId
            status        = 'failed'
            methods       = $registered
            defaultMethod = $null
            code          = 'unregistered_method'
            error         = "method '$Method' is not in the user's registered set"
        }
    }

    if ($DryRun) {
        return [pscustomobject]@{
            userId        = $UserId
            tenantId      = $TenantId
            status        = 'planned'
            methods       = $registered
            defaultMethod = $Method
            code          = $null
            error         = $null
        }
    }

    try {
        $body = @{ preferredMethod = $Method } | ConvertTo-Json -Depth 2 -Compress
        Invoke-MgGraphRequest -Method PATCH -Uri "/beta/users/$UserId/authentication/signInPreferences" -Body $body | Out-Null
    }
    catch {
        return [pscustomobject]@{
            userId        = $UserId
            tenantId      = $TenantId
            status        = 'failed'
            methods       = $registered
            defaultMethod = $null
            code          = $null
            error         = $_.Exception.Message
        }
    }

    return [pscustomobject]@{
        userId        = $UserId
        tenantId      = $TenantId
        status        = 'applied'
        methods       = $registered
        defaultMethod = $Method
        code          = $null
        error         = $null
    }
}

function Invoke-MfaAction {
    <#
    .SYNOPSIS
        Dispatches one MFA action (push or defaultMethod) for a user.
    .DESCRIPTION
        The single job surface for the entrypoint: validates the action name
        against Get-MfaActions and delegates. Unknown action names throw
        mfa.unknown_action and issue no Graph call.
    .PARAMETER TenantId
        Tenant the user belongs to.
    .PARAMETER UserId
        The user id.
    .PARAMETER Action
        push or defaultMethod.
    .PARAMETER Method
        Canonical method id for defaultMethod.
    .PARAMETER DryRun
        Report the intended change without writing.
    .PARAMETER Confirmed
        Explicit confirmation for the tenant write.
    .EXAMPLE
        Invoke-MfaAction -TenantId 'tenant-a' -UserId 'user-1' -Action 'push' -Confirmed
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

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Action,

        [Parameter()]
        [string]$Method = '',

        [Parameter()]
        [switch]$DryRun,

        [Parameter()]
        [switch]$Confirmed
    )

    $base = @{
        TenantId = $TenantId
        UserId   = $UserId
    }
    if ($DryRun) {
        $base['DryRun'] = $true
    }
    if ($Confirmed) {
        $base['Confirmed'] = $true
    }

    switch ($Action) {
        'push' {
            return Send-MfaPush @base
        }
        'defaultMethod' {
            if ([string]::IsNullOrWhiteSpace($Method)) {
                throw 'mfa.invalid_method: defaultMethod requires a method'
            }
            return Set-MfaDefaultMethod @base -Method $Method.Trim()
        }
        default {
            throw "mfa.unknown_action: unknown MFA action '$Action'; expected one of: push, defaultMethod"
        }
    }
    return $null
}

function Read-MfaActionJob {
    <#
    .SYNOPSIS
        Reads a T-0007 job envelope file into Invoke-MfaAction parameters.
    .DESCRIPTION
        Validates the envelope schema version, tenant, user, and action, then
        merges the method, dry-run, and confirmation flags. The envelope
        carries references only; secrets are never present and never needed
        here.
    .PARAMETER Path
        Path to the job envelope JSON the supervisor wrote for this run.
    .EXAMPLE
        Read-MfaActionJob -Path './run/mfa-action-job.json'
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "MFA action job file not found: $Path"
    }
    $job = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
    if ($job['schemaVersion'] -ne 'v1') {
        throw "MFA action job has unsupported schemaVersion: $($job['schemaVersion'])"
    }
    $tenantId = [string]$job['tenantId']
    if ([string]::IsNullOrWhiteSpace($tenantId)) {
        throw 'MFA action job is missing required field: tenantId'
    }
    $payload = $job['payload']
    if ($payload -isnot [System.Collections.IDictionary]) {
        $payload = @{}
    }
    $userId = [string]$payload['userId']
    if ([string]::IsNullOrWhiteSpace($userId)) {
        throw 'MFA action job is missing required field: payload.userId'
    }
    $action = [string]$payload['action']
    if ((Get-MfaActions) -notcontains $action) {
        throw "MFA action job has unsupported action: $action"
    }

    return @{
        TenantId  = $tenantId
        UserId    = $userId
        Action    = $action
        Method    = [string]$payload['method']
        DryRun    = [bool]$payload['dryRun']
        Confirmed = [bool]$payload['confirmed']
    }
}
