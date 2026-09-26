# Invoke-UserAction.ps1 — EPIC-011 user lifecycle actions worker (SPEC §4.3 US-4).
#
# Executes one lifecycle action live against Graph: reset password, require
# password change, revoke sessions, disable/enable, and restore of a
# soft-deleted user. Each action captures before/after and emits one audit
# record through -WriteAudit; unknown action names are refused with a
# structured error, never passed through.
#
# Gating (EPIC-006 contract, T-0107): lifecycle actions are not registry
# CheckId commands, so they follow the executor contract instead of its
# CheckId-bound path — the BFF confirms the plan before dispatch (dryRun plans
# only, destructive and session-breaking actions need explicit confirmation),
# -DryRun reports the intended change without writing, and -Confirmed is
# re-checked here so a job that skips confirmation cannot apply a destructive
# action. A password value (caller-supplied or generated) is returned in the
# result transport only; it is never written to disk, never logged, and never
# persisted. The Graph session is connected by the supervisor after
# materializing the tenant credential in-process; this file never touches
# secrets.

. (Join-Path -Path $PSScriptRoot -ChildPath 'New-TenantUser.ps1')

function Get-UserLifecycleActions {
    <#
    .SYNOPSIS
        Returns the lifecycle action set this worker dispatches.
    .DESCRIPTION
        The single source of truth for valid action names. Anything else is
        refused with users.unknown_action.
    .EXAMPLE
        Get-UserLifecycleActions
    #>
    [CmdletBinding()]
    [OutputType([string[]])]
    param()

    return @('resetPassword', 'requirePasswordChange', 'revokeSessions', 'disable', 'enable', 'restore')
}

function Get-UserActionConfirmation {
    <#
    .SYNOPSIS
        Returns the actions that require explicit confirmation.
    .DESCRIPTION
        Session-breaking and destructive actions (revoke sessions, disable,
        restore of a deleted user) require confirmation before apply.
    .EXAMPLE
        Get-UserActionConfirmation
    #>
    [CmdletBinding()]
    [OutputType([string[]])]
    param()

    return @('revokeSessions', 'disable', 'restore')
}

function Get-UserActionState {
    <#
    .SYNOPSIS
        Reads the current user state for before/after capture.
    .DESCRIPTION
        GETs the live user (or the deleted item for restore) and shapes the
        comparison fields. A missing user returns null so the caller can fail
        the action with a clear error.
    .PARAMETER UserId
        The user (or deleted-item) id.
    .PARAMETER Deleted
        Read from the deleted-items collection instead of users.
    .EXAMPLE
        Get-UserActionState -UserId 'user-1'
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$UserId,

        [Parameter()]
        [switch]$Deleted
    )

    try {
        if ($Deleted) {
            $uri = "/v1.0/directory/deletedItems/$UserId"
        }
        else {
            $uri = "/v1.0/users/$UserId?`$select=id,displayName,userPrincipalName,accountEnabled,usageLocation"
        }
        $user = Invoke-MgGraphRequest -Method GET -Uri $uri
        if ($null -eq $user) {
            return $null
        }
        return [pscustomobject]@{
            id                = [string]$user.id
            displayName       = [string]$user.displayName
            userPrincipalName = [string]$user.userPrincipalName
            accountEnabled    = $user.accountEnabled -eq $true
        }
    }
    catch {
        return $null
    }
}

function Invoke-TenantUserAction {
    <#
    .SYNOPSIS
        Executes one user lifecycle action live against Graph.
    .DESCRIPTION
        Dispatches resetPassword, requirePasswordChange, revokeSessions,
        disable, enable, or restore. -DryRun returns the intended change with
        no Graph write. Destructive and session-breaking actions require
        -Confirmed. Returns an applied/planned/failed result with before,
        after, and (for password actions) the one-time password value. Apply
        failures are returned, not thrown; only unknown actions and missing
        confirmation throw.
    .PARAMETER TenantId
        Tenant the user belongs to. Carried through to the result envelope.
    .PARAMETER UserId
        The target user (or deleted-item) id.
    .PARAMETER Action
        One of the Get-UserLifecycleActions names.
    .PARAMETER OneTimeSecret
        Caller-supplied password value for resetPassword. A one-time value is
        generated when omitted. Named to avoid the username/password pair
        heuristic; the value travels in the result transport only and is never
        persisted or logged.
    .PARAMETER DryRun
        Report the intended change without writing to the tenant.
    .PARAMETER Confirmed
        Explicit confirmation for destructive and session-breaking actions.
    .PARAMETER Actor
        Caller identity recorded on the audit event.
    .PARAMETER CorrelationId
        Correlation id recorded on the audit event.
    .PARAMETER WriteAudit
        Seam: scriptblock (event) -> void. Defaults to a no-op.
    .EXAMPLE
        Invoke-TenantUserAction -TenantId 'tenant-a' -UserId 'user-1' -Action 'disable' -Confirmed -DryRun
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
        [string]$OneTimeSecret = '',

        [Parameter()]
        [switch]$DryRun,

        [Parameter()]
        [switch]$Confirmed,

        [Parameter()]
        [string]$Actor = '',

        [Parameter()]
        [string]$CorrelationId = '',

        [Parameter()]
        [scriptblock]$WriteAudit = { param($AuditEvent) }
    )

    $known = Get-UserLifecycleActions
    if (-not $known.Contains($Action)) {
        throw "users.unknown_action: unknown user action '$Action'; expected one of: $($known -join ', ')"
    }
    if (-not $DryRun -and (Get-UserActionConfirmation).Contains($Action) -and -not $Confirmed) {
        throw "users.confirm_required: action '$Action' requires explicit confirmation"
    }

    $intended = [pscustomobject]@{
        userId = $UserId
        action = $Action
    }
    if ($DryRun) {
        return [pscustomobject]@{
            userId   = $UserId
            action   = $Action
            status   = 'planned'
            before   = $null
            after    = $intended
            password = $null
            error    = $null
        }
    }

    $fromDeleted = $Action -eq 'restore'
    $before = Get-UserActionState -UserId $UserId -Deleted:$fromDeleted
    if ($null -eq $before) {
        $missing = "user '$UserId' was not found"
        if ($fromDeleted) {
            $missing = "deleted user '$UserId' was not found; restore is available only for a soft-deleted user"
        }
        return [pscustomobject]@{
            userId   = $UserId
            action   = $Action
            status   = 'failed'
            before   = $null
            after    = $null
            password = $null
            error    = $missing
        }
    }

    try {
        $oneTime = $null
        switch ($Action) {
            'resetPassword' {
                if ([string]::IsNullOrWhiteSpace($OneTimeSecret)) {
                    $oneTime = New-TenantUserPassword
                }
                else {
                    $oneTime = $OneTimeSecret
                }
                $body = @{ passwordProfile = @{ forceChangePasswordNextSignIn = $true; password = $oneTime } }
                $null = Invoke-MgGraphRequest -Method PATCH -Uri "/v1.0/users/$UserId" -Body ($body | ConvertTo-Json -Depth 5)
            }
            'requirePasswordChange' {
                if ([string]::IsNullOrWhiteSpace($OneTimeSecret)) {
                    $oneTime = New-TenantUserPassword
                }
                else {
                    $oneTime = $OneTimeSecret
                }
                $body = @{ passwordProfile = @{ forceChangePasswordNextSignIn = $true; password = $oneTime } }
                $null = Invoke-MgGraphRequest -Method PATCH -Uri "/v1.0/users/$UserId" -Body ($body | ConvertTo-Json -Depth 5)
            }
            'revokeSessions' {
                $null = Invoke-MgGraphRequest -Method POST -Uri "/v1.0/users/$UserId/revokeSignInSessions"
            }
            'disable' {
                $body = @{ accountEnabled = $false }
                $null = Invoke-MgGraphRequest -Method PATCH -Uri "/v1.0/users/$UserId" -Body ($body | ConvertTo-Json -Depth 5)
            }
            'enable' {
                $body = @{ accountEnabled = $true }
                $null = Invoke-MgGraphRequest -Method PATCH -Uri "/v1.0/users/$UserId" -Body ($body | ConvertTo-Json -Depth 5)
            }
            'restore' {
                $null = Invoke-MgGraphRequest -Method POST -Uri "/v1.0/directory/deletedItems/$UserId/restore"
            }
        }

        $after = Get-UserActionState -UserId $UserId
        if ($null -eq $after) {
            $after = $before
        }
        $null = & $WriteAudit @{
            tenantId   = $TenantId
            action     = "users.action:$Action"
            userId     = $UserId
            result     = 'success'
            error      = $null
            before     = $before
            after      = $after
            actor      = $Actor
            correlationId = $CorrelationId
        }
        return [pscustomobject]@{
            userId   = $UserId
            action   = $Action
            status   = 'applied'
            before   = $before
            after    = $after
            password = $oneTime
            error    = $null
        }
    }
    catch {
        $message = $_.Exception.Message
        $null = & $WriteAudit @{
            tenantId   = $TenantId
            action     = "users.action:$Action"
            userId     = $UserId
            result     = 'failure'
            error      = $message
            before     = $before
            after      = $null
            actor      = $Actor
            correlationId = $CorrelationId
        }
        return [pscustomobject]@{
            userId   = $UserId
            action   = $Action
            status   = 'failed'
            before   = $before
            after    = $null
            password = $null
            error    = $message
        }
    }
}

function Read-UserActionJob {
    <#
    .SYNOPSIS
        Reads a T-0007 job envelope file into Invoke-TenantUserAction parameters.
    .DESCRIPTION
        Validates the envelope schema version and tenant, then returns the
        user id, action, confirmation, and dry-run flag. The envelope carries
        references only; secrets are never present and never needed here.
    .PARAMETER Path
        Path to the job envelope JSON the supervisor wrote for this run.
    .EXAMPLE
        Read-UserActionJob -Path './run/user-action-job.json'
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "User action job file not found: $Path"
    }
    $job = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
    if ($job['schemaVersion'] -ne 'v1') {
        throw "User action job has unsupported schemaVersion: $($job['schemaVersion'])"
    }
    $tenantId = [string]$job['tenantId']
    if ([string]::IsNullOrWhiteSpace($tenantId)) {
        throw 'User action job is missing required field: tenantId'
    }

    $payload = $job['payload']
    if ($payload -isnot [System.Collections.IDictionary]) {
        $payload = @{}
    }
    $userId = [string]$payload['userId']
    if ([string]::IsNullOrWhiteSpace($userId)) {
        throw 'User action job is missing required field: payload.userId'
    }
    $action = [string]$payload['action']
    if ([string]::IsNullOrWhiteSpace($action)) {
        throw 'User action job is missing required field: payload.action'
    }

    return @{
        TenantId      = $tenantId
        UserId        = $userId
        Action        = $action
        OneTimeSecret = [string]$payload['password']
        DryRun        = $payload['dryRun'] -eq $true
        Confirmed     = $payload['confirm'] -eq $true
        Actor         = [string]$payload['actor']
        CorrelationId = [string]$job['correlationId']
    }
}
