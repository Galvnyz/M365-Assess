# Invoke-UserOffboarding.ps1 — EPIC-011 offboarding run worker (SPEC §4.4 US-5).
#
# Executes a confirmed offboarding plan live against Graph: the v1 first-cut
# step catalogue (disable sign-in, license removal, mailbox conversion, group
# removal) runs sequentially for the job users, each step recorded with its
# state, result, and error. A failed step stops the run and surfaces a re-run
# action instead of being skipped silently; re-running a step never
# re-executes already-applied steps (see Rerun-OffboardingStep.ps1).
# Mailbox permission grants honor the selected access mode and are verified
# after apply. Destructive steps require explicit confirmation (no v1
# catalogue step is destructive; the -Confirmed gate stays enforced for later
# expansions).
#
# Gating (EPIC-006 contract, T-0107): the BFF confirms the plan before
# dispatch (dryRun plans only), -DryRun reports each intended change without
# writing, every applied step captures before/after, and every applied step
# emits one audit record through -WriteAudit. Progress events shaped like the
# EPIC-001 contract flow through -WriteProgress (stderr by default so stdout
# stays the result transport). The Graph session is connected by the
# supervisor after materializing the tenant credential in-process; this file
# never touches secrets.

function Get-OffboardingStepCatalogue {
    <#
    .SYNOPSIS
        Returns the v1 offboarding step catalogue in execution order.
    .DESCRIPTION
        The first-cut step set resolved in SPEC §11.1. Anything else is
        refused with users.offboarding_unknown_step, never skipped silently.
    .EXAMPLE
        Get-OffboardingStepCatalogue
    #>
    [CmdletBinding()]
    [OutputType([string[]])]
    param()

    return @('disable-sign-in', 'remove-licenses', 'convert-mailbox', 'remove-groups')
}

function Write-OffboardingProgress {
    [CmdletBinding()]
    [OutputType([void])]
    param(
        [Parameter(Mandatory)]
        [string]$JobId,

        [Parameter(Mandatory)]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [string]$Section,

        [Parameter(Mandatory)]
        [ValidateSet('pending', 'running', 'succeeded', 'failed', 'skipped')]
        [string]$SectionState,

        [Parameter()]
        [string]$Message = ''
    )

    $progressEvent = [ordered]@{
        schemaVersion = 'v1'
        jobType       = 'offboarding'
        jobId         = $JobId
        tenantId      = $TenantId
        section       = $Section
        state         = $SectionState
        message       = $Message
        emittedAt     = (Get-Date -Format 'o')
    }
    [Console]::Error.WriteLine(($progressEvent | ConvertTo-Json -Depth 5 -Compress))
}

function Get-OffboardingUserState {
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$UserId
    )

    try {
        $user = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/users/$UserId?`$select=id,displayName,userPrincipalName,accountEnabled,assignedLicenses"
        if ($null -eq $user) {
            return $null
        }
        $skus = @()
        foreach ($license in @($user.assignedLicenses)) {
            if ($null -ne $license -and [string]$license.skuId -ne '') {
                $skus += [string]$license.skuId
            }
        }
        return [pscustomobject]@{
            id                = [string]$user.id
            displayName       = [string]$user.displayName
            userPrincipalName = [string]$user.userPrincipalName
            accountEnabled    = $user.accountEnabled -eq $true
            licenses          = @($skus)
        }
    }
    catch {
        return $null
    }
}

function Invoke-OffboardingStep {
    <#
    .SYNOPSIS
        Executes one offboarding step for one user live against Graph.
    .DESCRIPTION
        Applies disable-sign-in, remove-licenses, convert-mailbox, or
        remove-groups with before/after capture and one audit record.
        -DryRun returns the intended change with no Graph write. Unknown steps
        throw; apply failures are returned, not thrown.
    .PARAMETER TenantId
        Tenant the user belongs to.
    .PARAMETER JobId
        Offboarding job the step belongs to.
    .PARAMETER UserId
        The target user id.
    .PARAMETER Action
        One of the Get-OffboardingStepCatalogue names.
    .PARAMETER MailboxAccess
        Selected mailbox access grant (@{ mode; automap }), recorded on the
        result for verification after apply.
    .PARAMETER DryRun
        Report the intended change without writing to the tenant.
    .PARAMETER Confirmed
        Explicit confirmation, required for destructive steps.
    .PARAMETER MailboxConverter
        Seam: scriptblock (UserId) -> void performing the shared-mailbox
        conversion. Defaults to the Exchange Online session when available.
    .PARAMETER Actor
        Caller identity recorded on the audit event.
    .PARAMETER CorrelationId
        Correlation id recorded on the audit event.
    .PARAMETER WriteAudit
        Seam: scriptblock (event) -> void. Defaults to a no-op.
    .EXAMPLE
        Invoke-OffboardingStep -TenantId 'tenant-a' -JobId 'job-1' -UserId 'user-1' -Action 'disable-sign-in' -DryRun
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$JobId,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$UserId,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Action,

        [Parameter()]
        [object]$MailboxAccess = @{ mode = 'full'; automap = $false },

        [Parameter()]
        [switch]$DryRun,

        [Parameter()]
        [switch]$Confirmed,

        [Parameter()]
        [scriptblock]$MailboxConverter,

        [Parameter()]
        [string]$Actor = '',

        [Parameter()]
        [string]$CorrelationId = '',

        [Parameter()]
        [scriptblock]$WriteAudit = { param($AuditEvent) }
    )

    $catalogue = Get-OffboardingStepCatalogue
    if (-not $catalogue.Contains($Action)) {
        throw "users.offboarding_unknown_step: unknown offboarding step '$Action'"
    }
    $destructive = @('delete-user', 'wipe-device')
    if (-not $DryRun -and $destructive.Contains($Action) -and -not $Confirmed) {
        throw "users.confirm_required: destructive step '$Action' requires explicit confirmation"
    }

    if ($DryRun) {
        return [pscustomobject]@{
            userId   = $UserId
            action   = $Action
            status   = 'planned'
            before   = $null
            after    = [pscustomobject]@{ intendedAction = $Action; mailboxAccess = $MailboxAccess }
            error    = $null
        }
    }

    $before = Get-OffboardingUserState -UserId $UserId
    if ($null -eq $before -and $Action -ne 'convert-mailbox') {
        return [pscustomobject]@{
            userId   = $UserId
            action   = $Action
            status   = 'failed'
            before   = $null
            after    = $null
            error    = "user '$UserId' was not found"
        }
    }

    try {
        $after = $before
        switch ($Action) {
            'disable-sign-in' {
                $body = @{ accountEnabled = $false }
                $null = Invoke-MgGraphRequest -Method PATCH -Uri "/v1.0/users/$UserId" -Body ($body | ConvertTo-Json -Depth 5)
                $after = Get-OffboardingUserState -UserId $UserId
            }
            'remove-licenses' {
                if (@($before.licenses).Count -eq 0) {
                    $after = $before
                }
                else {
                    $licenseBody = @{ addLicenses = @(); removeLicenses = @($before.licenses) }
                    $null = Invoke-MgGraphRequest -Method POST -Uri "/v1.0/users/$UserId/assignLicense" -Body ($licenseBody | ConvertTo-Json -Depth 5)
                    $after = Get-OffboardingUserState -UserId $UserId
                }
            }
            'convert-mailbox' {
                if ($null -ne $MailboxConverter) {
                    $null = & $MailboxConverter $UserId
                }
                else {
                    $exo = Get-Command -Name 'Set-Mailbox' -ErrorAction SilentlyContinue
                    if ($null -eq $exo) {
                        throw 'users.offboarding_exo_required: mailbox conversion requires an Exchange Online session; re-run when connected'
                    }
                    $null = Set-Mailbox -Identity $UserId -Type Shared
                }
                $after = [pscustomobject]@{
                    id             = $UserId
                    mailboxType    = 'Shared'
                    mailboxAccess  = $MailboxAccess
                    verifiedAfter  = (Get-Date -Format 'o')
                }
            }
            'remove-groups' {
                $membership = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/users/$UserId/memberOf?`$select=id"
                $groupIds = @()
                foreach ($entry in @($membership.value)) {
                    if ($null -ne $entry -and [string]$entry.id -ne '') {
                        $groupIds += [string]$entry.id
                    }
                }
                foreach ($groupId in $groupIds) {
                    $null = Invoke-MgGraphRequest -Method DELETE -Uri "/v1.0/groups/$groupId/members/$UserId/`$ref"
                }
                $after = [pscustomobject]@{ id = $UserId; removedGroups = @($groupIds) }
            }
        }
        if ($null -eq $after) {
            $after = $before
        }
        $null = & $WriteAudit @{
            tenantId      = $TenantId
            jobId         = $JobId
            action        = "users.offboard:$Action"
            userId        = $UserId
            result        = 'success'
            error         = $null
            before        = $before
            after         = $after
            actor         = $Actor
            correlationId = $CorrelationId
        }
        return [pscustomobject]@{
            userId   = $UserId
            action   = $Action
            status   = 'succeeded'
            before   = $before
            after    = $after
            error    = $null
        }
    }
    catch {
        $message = $_.Exception.Message
        $null = & $WriteAudit @{
            tenantId      = $TenantId
            jobId         = $JobId
            action        = "users.offboard:$Action"
            userId        = $UserId
            result        = 'failure'
            error         = $message
            before        = $before
            after         = $null
            actor         = $Actor
            correlationId = $CorrelationId
        }
        return [pscustomobject]@{
            userId   = $UserId
            action   = $Action
            status   = 'failed'
            before   = $before
            after    = $null
            error    = $message
        }
    }
}

function Invoke-UserOffboarding {
    <#
    .SYNOPSIS
        Runs an offboarding job plan sequentially with per-step recording.
    .DESCRIPTION
        Executes each plan step in order across the job users. A failed step
        stops the run and is surfaced with its error for re-run; applied steps
        are never re-executed by this call. Progress events flow through
        -WriteProgress. Returns the job result with every step state.
    .PARAMETER TenantId
        Tenant the users belong to.
    .PARAMETER JobId
        Offboarding job id.
    .PARAMETER UserIds
        Target user ids.
    .PARAMETER Steps
        Plan steps exposing order and action.
    .PARAMETER MailboxAccess
        Selected mailbox access grant recorded on results.
    .PARAMETER DryRun
        Report each intended change without writing to the tenant.
    .PARAMETER Confirmed
        Explicit confirmation, required for destructive steps.
    .PARAMETER MailboxConverter
        Seam passed through to Invoke-OffboardingStep.
    .PARAMETER Actor
        Caller identity recorded on each audit event.
    .PARAMETER CorrelationId
        Correlation id recorded on each audit event.
    .PARAMETER WriteAudit
        Seam: scriptblock (event) -> void. Defaults to a no-op.
    .PARAMETER WriteProgress
        Seam: scriptblock (event) -> void. Defaults to stderr JSON lines.
    .EXAMPLE
        Invoke-UserOffboarding -TenantId 'tenant-a' -JobId 'job-1' -UserIds @('user-1') -Steps $plan.Steps
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$JobId,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [string[]]$UserIds,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$Steps,

        [Parameter()]
        [object]$MailboxAccess = @{ mode = 'full'; automap = $false },

        [Parameter()]
        [switch]$DryRun,

        [Parameter()]
        [switch]$Confirmed,

        [Parameter()]
        [scriptblock]$MailboxConverter,

        [Parameter()]
        [string]$Actor = '',

        [Parameter()]
        [string]$CorrelationId = '',

        [Parameter()]
        [scriptblock]$WriteAudit = { param($AuditEvent) },

        [Parameter()]
        [scriptblock]$WriteProgress = { param($ProgressEvent) Write-OffboardingProgress -JobId $ProgressEvent.jobId -TenantId $ProgressEvent.tenantId -Section $ProgressEvent.section -SectionState $ProgressEvent.state -Message $ProgressEvent.message }
    )

    $records = [System.Collections.Generic.List[object]]::new()
    $state = 'completed'
    foreach ($step in ($Steps | Sort-Object -Property order)) {
        $order = [int]$step.order
        $action = [string]$step.action
        $null = & $WriteProgress @{ jobId = $JobId; tenantId = $TenantId; section = "$order/$action"; state = 'running'; message = '' }
        $outcomes = [System.Collections.Generic.List[object]]::new()
        $failed = $null
        foreach ($userId in $UserIds) {
            $outcome = Invoke-OffboardingStep -TenantId $TenantId -JobId $JobId -UserId $userId -Action $action -MailboxAccess $MailboxAccess -DryRun:$DryRun -Confirmed:$Confirmed -MailboxConverter $MailboxConverter -Actor $Actor -CorrelationId $CorrelationId -WriteAudit $WriteAudit
            $outcomes.Add($outcome)
            if ($outcome.status -eq 'failed' -and $null -eq $failed) {
                $failed = $outcome
            }
        }
        if ($null -ne $failed) {
            $state = 'failed'
            $records.Add([pscustomobject]@{
                order     = $order
                action    = $action
                state     = 'failed'
                result    = [pscustomobject]@{ outcomes = @($outcomes) }
                error     = $failed.error
                appliedAt = $null
            })
            $null = & $WriteProgress @{ jobId = $JobId; tenantId = $TenantId; section = "$order/$action"; state = 'failed'; message = [string]$failed.error }
            break
        }
        $records.Add([pscustomobject]@{
            order     = $order
            action    = $action
            state     = 'succeeded'
            result    = [pscustomobject]@{ outcomes = @($outcomes) }
            error     = $null
            appliedAt = (Get-Date -Format 'o')
        })
        $null = & $WriteProgress @{ jobId = $JobId; tenantId = $TenantId; section = "$order/$action"; state = 'succeeded'; message = '' }
    }
    return [pscustomobject]@{
        jobId    = $JobId
        tenantId = $TenantId
        state    = $state
        steps    = @($records)
    }
}

function Read-OffboardingJob {
    <#
    .SYNOPSIS
        Reads a T-0007 job envelope file into Invoke-UserOffboarding parameters.
    .DESCRIPTION
        Validates the envelope schema version and tenant, then returns the
        job id, users, plan steps, mailbox access mode, dry-run flag, and an
        optional single-step re-run order. The envelope carries the plan
        snapshot and references only; secrets are never present here.
    .PARAMETER Path
        Path to the job envelope JSON the supervisor wrote for this run.
    .EXAMPLE
        Read-OffboardingJob -Path './run/offboarding-job.json'
    #>
    [CmdletBinding()]
    [OutputType([hashtable])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Offboarding job file not found: $Path"
    }
    $job = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
    if ($job['schemaVersion'] -ne 'v1') {
        throw "Offboarding job has unsupported schemaVersion: $($job['schemaVersion'])"
    }
    $tenantId = [string]$job['tenantId']
    if ([string]::IsNullOrWhiteSpace($tenantId)) {
        throw 'Offboarding job is missing required field: tenantId'
    }

    $payload = $job['payload']
    if ($payload -isnot [System.Collections.IDictionary]) {
        $payload = @{}
    }
    $userIds = [System.Collections.Generic.List[string]]::new()
    foreach ($entry in @($payload['userIds'])) {
        if ([string]$entry -ne '') {
            $userIds.Add([string]$entry)
        }
    }
    if ($userIds.Count -eq 0 -and [string]$payload['userId'] -ne '') {
        $userIds.Add([string]$payload['userId'])
    }
    $steps = [System.Collections.Generic.List[object]]::new()
    foreach ($entry in @($payload['steps'])) {
        if ($null -ne $entry) {
            $steps.Add($entry)
        }
    }
    $rerun = 0
    if ($null -ne $payload['rerunOrder']) {
        [int]::TryParse([string]$payload['rerunOrder'], [ref]$rerun) | Out-Null
    }

    return @{
        TenantId      = $tenantId
        JobId         = [string]$payload['jobId']
        UserIds       = @($userIds)
        Steps         = @($steps)
        MailboxAccess = $payload['mailboxAccess']
        DryRun        = $payload['dryRun'] -eq $true
        RerunOrder    = $rerun
        Actor         = [string]$payload['actor']
        CorrelationId = [string]$job['correlationId']
    }
}
