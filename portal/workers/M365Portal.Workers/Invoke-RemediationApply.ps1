# Invoke-RemediationApply.ps1
# EPIC-006 SPEC.md §4.3, §8 — gated apply (US-4). T-0108.
#
# Applies a plan's selected actions one at a time through the typed executor
# (Invoke-RemediationAction, T-0107), re-checking gates on every action. This is
# the write path, so the rules are strict:
#
#   - Only checks whose validation matrix specStatus is `approved` (T-0110) are
#     eligible; everything else is skipped and recorded.
#   - dryRun (default true) never writes: no RemediationAction update and no
#     AuditEvent.
#   - A failure stops the batch by default; -ContinueOnFailure keeps going.
#   - Every applied/failed action records command, before, after, actor,
#     timestamp, result, and an AuditEvent (via the injected seams).
#
# Execution, eligibility, persistence, and audit are injectable scriptblock
# seams so unit tests exercise the orchestration without a tenant or a database.
# The default executor is the real typed executor; the default persistence/audit
# seams are no-ops, and the returned records carry the exact payloads the caller
# persists (the entrypoint writes them to the apply artifact).

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:RemediationDomainRoot = Join-Path $PSScriptRoot '../../../src/M365-Assess/Remediate'
if (Test-Path -LiteralPath $script:RemediationDomainRoot -PathType Container) {
    foreach ($domainFile in @(
            'Resolve-Remediation.ps1',
            'Test-RemediationGate.ps1',
            'Get-RemediationAllowlist.ps1',
            'Get-RemediationCommand.ps1',
            'Test-RemediationCommand.ps1',
            'Invoke-RemediationAction.ps1')) {
        $domainPath = Join-Path -Path $script:RemediationDomainRoot -ChildPath $domainFile
        if (Test-Path -LiteralPath $domainPath -PathType Leaf) {
            . $domainPath
        }
    }
}

function Invoke-RemediationApply {
    <#
    .SYNOPSIS
        Applies a remediation plan's actions under the full gate set.
    .DESCRIPTION
        Implements EPIC-006 SPEC.md §4.3. Iterates the selected actions,
        enforces approval eligibility (matrix specStatus approved), executes
        each through the typed executor, and records the outcome. Stop-on-first
        -failure is the default; pass -ContinueOnFailure to override.
    .PARAMETER Actions
        Plan actions to apply (objects exposing at least id/checkId).
    .PARAMETER PlanId
    .PARAMETER TenantId
    .PARAMETER DryRun
        When true (default) nothing is written and no action is marked applied.
    .PARAMETER ContinueOnFailure
        Continue past a failed action instead of stopping the batch.
    .PARAMETER Actor
    .PARAMETER CorrelationId
    .PARAMETER CallerContext
    .PARAMETER AllowlistCheckIds
    .PARAMETER AllowlistPath
    .PARAMETER TenantReadOnly
    .PARAMETER TenantServicePlans
    .PARAMETER ServiceAvailable
    .PARAMETER RequiredPermission
        Gate pass-through parameters.
    .PARAMETER ExecuteAction
        Seam: scriptblock (action) -> executor result. Defaults to Invoke-RemediationAction.
    .PARAMETER TestEligibility
        Seam: scriptblock (checkId) -> eligibility (Eligible/SpecStatus). Defaults to
        Test-RemediationApplyEligibility.
    .PARAMETER UpdateAction
        Seam: scriptblock (actionId, update) -> void. Records the RemediationAction update.
    .PARAMETER WriteAudit
        Seam: scriptblock (event) -> void. Appends the AuditEvent.
    .OUTPUTS
        [PSCustomObject] with Results, Summary, and StoppedOnFailure.
    .EXAMPLE
        Invoke-RemediationApply -Actions $plan.Actions -PlanId 'p1' -TenantId 'contoso' -DryRun
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$Actions,

        [Parameter()]
        [string]$PlanId = '',

        [Parameter()]
        [string]$TenantId = '',

        [Parameter()]
        [bool]$DryRun = $true,

        [Parameter()]
        [bool]$ContinueOnFailure = $false,

        [Parameter()]
        [string]$Actor = '',

        [Parameter()]
        [string]$CorrelationId = '',

        [Parameter()]
        [object]$CallerContext,

        [Parameter()]
        [string[]]$AllowlistCheckIds = @(),

        [Parameter()]
        [string]$AllowlistPath,

        [Parameter()]
        [bool]$TenantReadOnly = $false,

        [Parameter()]
        [string[]]$TenantServicePlans = @(),

        [Parameter()]
        [bool]$ServiceAvailable = $true,

        [Parameter()]
        [string]$RequiredPermission = 'remediation.apply',

        [Parameter()]
        [scriptblock]$ExecuteAction,

        [Parameter()]
        [scriptblock]$TestEligibility,

        [Parameter()]
        [scriptblock]$UpdateAction,

        [Parameter()]
        [scriptblock]$WriteAudit
    )

    if (-not $PlanId) { $PlanId = [guid]::NewGuid().ToString() }

    if (-not $TestEligibility) {
        $TestEligibility = {
            param($CheckId)
            Test-RemediationApplyEligibility -CheckId $CheckId
        }
    }
    if (-not $ExecuteAction) {
        $ExecuteAction = {
            param($action)
            $execParams = @{
                CheckId             = [string]$action.checkId
                TenantId            = $TenantId
                CallerContext       = $CallerContext
                AllowlistCheckIds   = $AllowlistCheckIds
                TenantReadOnly      = $TenantReadOnly
                TenantServicePlans  = $TenantServicePlans
                ServiceAvailable    = $ServiceAvailable
                RequiredPermission  = $RequiredPermission
                DryRun              = $DryRun
            }
            if (-not [string]::IsNullOrWhiteSpace($AllowlistPath)) { $execParams['AllowlistPath'] = $AllowlistPath }
            if (-not [string]::IsNullOrWhiteSpace($Actor)) { $execParams['Actor'] = $Actor }
            return Invoke-RemediationAction @execParams
        }
    }
    if (-not $UpdateAction) { $UpdateAction = { param($actionId, $update) } }
    if (-not $WriteAudit) { $WriteAudit = { param($event) } }

    $results = New-Object System.Collections.Generic.List[object]
    $appliedCount = 0
    $skippedCount = 0
    $failedCount = 0
    $dryRunCount = 0
    $stopped = $false

    foreach ($action in $Actions) {
        $actionId = [string]$action.id
        $checkId = [string]$action.checkId
        $command = if ($null -ne $action.command) { [string]$action.command } else { '' }

        if ($stopped) {
            $skippedCount++
            $results.Add([ordered]@{
                actionId     = $actionId
                checkId      = $checkId
                state        = 'skipped'
                command      = $command
                before       = $null
                after        = $null
                intendedChange = $null
                appliedAt    = $null
                actor        = $Actor
                result       = $null
                error        = 'batch-stopped'
                dryRun       = $DryRun
            }) | Out-Null
            continue
        }

        # Gate 1: only approved (validated) checks are eligible to apply.
        $eligibility = & $TestEligibility $checkId
        $eligible = $false
        $specStatus = 'unknown'
        if ($null -ne $eligibility) {
            if ($null -ne $eligibility.PSObject.Properties['Eligible']) { $eligible = [bool]$eligibility.Eligible }
            if ($null -ne $eligibility.PSObject.Properties['SpecStatus']) { $specStatus = [string]$eligibility.SpecStatus }
        }
        if (-not $eligible) {
            $skippedCount++
            $reason = "not-approved: specStatus=$specStatus"
            & $UpdateAction $actionId @{ state = 'skipped'; error = $reason }
            $results.Add([ordered]@{
                actionId     = $actionId
                checkId      = $checkId
                state        = 'skipped'
                command      = $command
                before       = $null
                after        = $null
                intendedChange = $null
                appliedAt    = $null
                actor        = $Actor
                result       = $null
                error        = $reason
                dryRun       = $DryRun
            }) | Out-Null
            continue
        }

        # Gate 2..n live in the executor (RBAC/scope/license/service/read-only/allowlist).
        try {
            $execResult = & $ExecuteAction $action
        }
        catch {
            $failedCount++
            $failedAt = [DateTime]::UtcNow.ToString('o')
            $message = $_.Exception.Message
            & $UpdateAction $actionId @{ state = 'failed'; before = $null; error = $message; appliedAt = $failedAt; appliedBy = $Actor }
            & $WriteAudit ([ordered]@{
                action = 'remediation.apply'; result = 'failure'; tenantId = $TenantId
                resourceId = $actionId; checkId = $checkId; command = $command; error = $message
                actorUserId = $Actor; correlationId = $CorrelationId; timestamp = $failedAt
            })
            $results.Add([ordered]@{
                actionId = $actionId; checkId = $checkId; state = 'failed'; command = $command
                before = $null; after = $null; intendedChange = $null; appliedAt = $failedAt
                actor = $Actor; result = $null; error = $message; dryRun = $DryRun
            }) | Out-Null
            if (-not $ContinueOnFailure) { $stopped = $true }
            continue
        }

        $state = if ($null -ne $execResult -and $null -ne $execResult.PSObject.Properties['State']) {
            [string]$execResult.State
        }
        else { 'failed' }

        $before = if ($null -ne $execResult -and $null -ne $execResult.PSObject.Properties['Before']) { $execResult.Before } else { $null }
        $after = if ($null -ne $execResult -and $null -ne $execResult.PSObject.Properties['After']) { $execResult.After } else { $null }
        $intended = if ($null -ne $execResult -and $null -ne $execResult.PSObject.Properties['IntendedChange']) { $execResult.IntendedChange } else { $null }
        $reason = if ($null -ne $execResult -and $null -ne $execResult.PSObject.Properties['Reason']) { [string]$execResult.Reason } else { $null }

        switch ($state) {
            'applied' {
                $appliedAt = if ($null -ne $execResult.PSObject.Properties['AppliedAt'] -and $execResult.AppliedAt) {
                    [string]$execResult.AppliedAt
                }
                else { [DateTime]::UtcNow.ToString('o') }
                $appliedCount++
                $update = @{
                    state = 'applied'; before = $before; after = $after
                    appliedAt = $appliedAt; appliedBy = $Actor; result = $after
                }
                & $UpdateAction $actionId $update
                & $WriteAudit ([ordered]@{
                    action = 'remediation.apply'; result = 'success'; tenantId = $TenantId
                    resourceId = $actionId; checkId = $checkId; command = $command
                    before = $before; after = $after; actorUserId = $Actor
                    correlationId = $CorrelationId; timestamp = $appliedAt
                })
                $results.Add([ordered]@{
                    actionId = $actionId; checkId = $checkId; state = 'applied'; command = $command
                    before = $before; after = $after; intendedChange = $intended
                    appliedAt = $appliedAt; actor = $Actor; result = $after; error = $null; dryRun = $false
                }) | Out-Null
            }
            'dryrun' {
                # Dry run writes nothing: no action update, no audit.
                $dryRunCount++
                $results.Add([ordered]@{
                    actionId = $actionId; checkId = $checkId; state = 'dryrun'; command = $command
                    before = $before; after = $null; intendedChange = $intended
                    appliedAt = $null; actor = $Actor; result = $null; error = $null; dryRun = $true
                }) | Out-Null
            }
            'failed' {
                $failedCount++
                $failedAt = [DateTime]::UtcNow.ToString('o')
                $message = if ($reason) { $reason } else { 'remediation.apply_failed' }
                & $UpdateAction $actionId @{ state = 'failed'; before = $before; error = $message; appliedAt = $failedAt; appliedBy = $Actor }
                & $WriteAudit ([ordered]@{
                    action = 'remediation.apply'; result = 'failure'; tenantId = $TenantId
                    resourceId = $actionId; checkId = $checkId; command = $command
                    before = $before; error = $message; actorUserId = $Actor
                    correlationId = $CorrelationId; timestamp = $failedAt
                })
                $results.Add([ordered]@{
                    actionId = $actionId; checkId = $checkId; state = 'failed'; command = $command
                    before = $before; after = $null; intendedChange = $intended
                    appliedAt = $failedAt; actor = $Actor; result = $null; error = $message; dryRun = $false
                }) | Out-Null
                if (-not $ContinueOnFailure) { $stopped = $true }
            }
            default {
                # skipped / rejected / not-implemented: gate did not pass.
                $skippedCount++
                $skipReason = if ($reason) { $reason } else { $state }
                & $UpdateAction $actionId @{ state = 'skipped'; error = $skipReason }
                $results.Add([ordered]@{
                    actionId = $actionId; checkId = $checkId; state = 'skipped'; command = $command
                    before = $before; after = $null; intendedChange = $intended
                    appliedAt = $null; actor = $Actor; result = $null; error = $skipReason; dryRun = $DryRun
                }) | Out-Null
                # An RBAC/scope rejection is a hard stop for the batch.
                if ($state -eq 'rejected' -and -not $ContinueOnFailure) { $stopped = $true }
            }
        }
    }

    return [PSCustomObject]@{
        PlanId           = $PlanId
        TenantId         = $TenantId
        DryRun           = $DryRun
        ContinueOnFailure = $ContinueOnFailure
        StoppedOnFailure = $stopped
        Results          = $results.ToArray()
        Summary          = [PSCustomObject]@{
            total   = $Actions.Count
            applied = $appliedCount
            skipped = $skippedCount
            failed  = $failedCount
            dryrun  = $dryRunCount
        }
    }
}
