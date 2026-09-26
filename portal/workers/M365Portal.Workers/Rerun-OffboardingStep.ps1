# Rerun-OffboardingStep.ps1 — EPIC-011 single-step offboarding re-run (SPEC §4.4 US-5).
#
# Re-executes one failed step for the job users without touching
# already-applied steps: the caller resets the step record (BFF resetStep),
# and this worker runs only that order through the shared Invoke-OffboardingStep
# core. A failed re-run is surfaced with its error for another attempt.

. (Join-Path -Path $PSScriptRoot -ChildPath 'Invoke-UserOffboarding.ps1')

function Invoke-OffboardingStepRerun {
    <#
    .SYNOPSIS
        Re-runs one offboarding plan step without re-executing applied steps.
    .DESCRIPTION
        Finds the plan step at -Order and executes it for each job user
        through Invoke-OffboardingStep. Steps at other orders never run here.
        Returns the single step record with its per-user outcomes.
    .PARAMETER TenantId
        Tenant the users belong to.
    .PARAMETER JobId
        Offboarding job id.
    .PARAMETER UserIds
        Target user ids.
    .PARAMETER Steps
        Plan steps exposing order and action.
    .PARAMETER Order
        The single plan order to re-run.
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
        Invoke-OffboardingStepRerun -TenantId 'tenant-a' -JobId 'job-1' -UserIds @('user-1') -Steps $plan.Steps -Order 2
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

        [Parameter(Mandatory)]
        [int]$Order,

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

    $target = @($Steps | Where-Object { [int]$_.order -eq $Order })[0]
    if ($null -eq $target) {
        throw "users.offboarding_step_not_found: offboarding step $Order is not in the job plan"
    }
    $action = [string]$target.action
    $null = & $WriteProgress @{ jobId = $JobId; tenantId = $TenantId; section = "$Order/$action"; state = 'running'; message = '' }
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
        $null = & $WriteProgress @{ jobId = $JobId; tenantId = $TenantId; section = "$Order/$action"; state = 'failed'; message = [string]$failed.error }
        return [pscustomobject]@{
            order     = $Order
            action    = $action
            state     = 'failed'
            result    = [pscustomobject]@{ outcomes = @($outcomes) }
            error     = $failed.error
            appliedAt = $null
        }
    }
    $null = & $WriteProgress @{ jobId = $JobId; tenantId = $TenantId; section = "$Order/$action"; state = 'succeeded'; message = '' }
    return [pscustomobject]@{
        order     = $Order
        action    = $action
        state     = 'succeeded'
        result    = [pscustomobject]@{ outcomes = @($outcomes) }
        error     = $null
        appliedAt = (Get-Date -Format 'o')
    }
}
