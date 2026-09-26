# Invoke-RemediationApply.Tests.ps1
# Pester tests for T-0108 — gated remediation apply.
# Asserts: dry-run writes nothing, applied actions record the full update + an
# AuditEvent, stop-on-first-failure (default) and the explicit override, and that
# unapproved or rejected actions are never applied.

#Requires -Module Pester
Set-StrictMode -Version Latest

Describe 'Invoke-RemediationApply' {
    BeforeAll {
        . (Join-Path $PSScriptRoot '../../../portal/workers/M365Portal.Workers/Invoke-RemediationApply.ps1')

        function New-Action {
            param(
                [string]$Id = 'a1',
                [string]$CheckId = 'ENTRA-SECDEFAULT-001',
                [string]$Command = 'Set-EntraSecurityDefaultsState'
            )
            return [PSCustomObject]@{ id = $Id; checkId = $CheckId; command = $Command }
        }

        # Seams: eligibility and executor are driven per test.
        $script:Eligible = $true
        $script:SpecStatus = 'approved'
        $script:ExecPlan = @{}   # checkId -> state (applied|dryrun|failed|skipped|rejected)

        $script:EligibilitySeam = {
            param($CheckId)
            return [PSCustomObject]@{
                CheckId    = $CheckId
                SpecStatus = $script:SpecStatus
                Eligible   = [bool]$script:Eligible
            }
        }

        $script:ExecutorSeam = {
            param($action)
            $state = if ($script:ExecPlan.ContainsKey([string]$action.checkId)) { $script:ExecPlan[[string]$action.checkId] } else { 'applied' }
            $result = [PSCustomObject]@{
                CheckId        = [string]$action.checkId
                State          = $state
                Reason         = $null
                Before         = [PSCustomObject]@{ enabled = $false }
                After          = $null
                IntendedChange = [PSCustomObject]@{ enabled = $true }
                DryRun         = ($state -eq 'dryrun')
                AppliedAt      = $null
                Actor          = 'user-1'
            }
            if ($state -eq 'applied') { $result.After = [PSCustomObject]@{ enabled = $true } }
            if ($state -eq 'failed') { $result.Reason = 'boom' }
            if ($state -eq 'rejected') { $result.Reason = 'rbac-denied' }
            return $result
        }

        $script:Updates = [System.Collections.Generic.List[object]]::new()
        $script:Audits = [System.Collections.Generic.List[object]]::new()
        $script:UpdateSeam = {
            param($actionId, $update)
            $script:Updates.Add([PSCustomObject]@{ actionId = $actionId; update = $update }) | Out-Null
        }
        $script:AuditSeam = {
            param($event)
            $script:Audits.Add($event) | Out-Null
        }
    }

    BeforeEach {
        $script:Eligible = $true
        $script:SpecStatus = 'approved'
        $script:ExecPlan = @{}
        $script:Updates.Clear()
        $script:Audits.Clear()
    }

    It 'dry run writes no action update, no audit, and marks no action applied' {
        $script:ExecPlan = @{ 'ENTRA-SECDEFAULT-001' = 'dryrun' }
        $result = Invoke-RemediationApply `
            -Actions @((New-Action)) -PlanId 'p1' -TenantId 't1' -DryRun:$true `
            -ExecuteAction $script:ExecutorSeam -TestEligibility $script:EligibilitySeam `
            -UpdateAction $script:UpdateSeam -WriteAudit $script:AuditSeam

        $result.Summary.dryrun | Should -Be 1
        $result.Summary.applied | Should -Be 0
        $script:Updates.Count | Should -Be 0
        $script:Audits.Count | Should -Be 0
        $result.Results[0].state | Should -Be 'dryrun'
        $result.Results[0].dryRun | Should -BeTrue
    }

    It 'records command/before/after/actor/timestamp/result and an AuditEvent for an applied action' {
        $result = Invoke-RemediationApply `
            -Actions @((New-Action)) -PlanId 'p1' -TenantId 't1' -DryRun:$false -Actor 'user-1' `
            -ExecuteAction $script:ExecutorSeam -TestEligibility $script:EligibilitySeam `
            -UpdateAction $script:UpdateSeam -WriteAudit $script:AuditSeam

        $result.Summary.applied | Should -Be 1

        $script:Updates.Count | Should -Be 1
        $update = $script:Updates[0].update
        $update.state | Should -Be 'applied'
        $update.before.enabled | Should -BeFalse
        $update.after.enabled | Should -BeTrue
        $update.appliedBy | Should -Be 'user-1'
        $update.appliedAt | Should -Not -BeNullOrEmpty

        $script:Audits.Count | Should -Be 1
        $event = $script:Audits[0]
        $event.action | Should -Be 'remediation.apply'
        $event.result | Should -Be 'success'

        $row = $result.Results[0]
        $row.command | Should -Be 'Set-EntraSecurityDefaultsState'
        $row.before.enabled | Should -BeFalse
        $row.after.enabled | Should -BeTrue
        $row.appliedAt | Should -Not -BeNullOrEmpty
    }

    It 'skips an action whose check is not approved' {
        $script:Eligible = $false
        $script:SpecStatus = 'not-started'

        $result = Invoke-RemediationApply `
            -Actions @((New-Action -CheckId 'SPO-SHARING-001')) -PlanId 'p1' -TenantId 't1' -DryRun:$false `
            -ExecuteAction $script:ExecutorSeam -TestEligibility $script:EligibilitySeam `
            -UpdateAction $script:UpdateSeam -WriteAudit $script:AuditSeam

        $result.Results[0].state | Should -Be 'skipped'
        $result.Results[0].error | Should -Match 'not-approved'
        $script:Audits.Count | Should -Be 0
    }

    It 'stops the batch on first failure by default and records the failure' {
        $script:ExecPlan = @{ 'b' = 'failed' }
        $actions = @(
            (New-Action -Id 'a' -CheckId 'a'),
            (New-Action -Id 'b' -CheckId 'b'),
            (New-Action -Id 'c' -CheckId 'c')
        )

        $result = Invoke-RemediationApply `
            -Actions $actions -PlanId 'p1' -TenantId 't1' -DryRun:$false `
            -ExecuteAction $script:ExecutorSeam -TestEligibility $script:EligibilitySeam `
            -UpdateAction $script:UpdateSeam -WriteAudit $script:AuditSeam

        $result.StoppedOnFailure | Should -BeTrue
        $result.Summary.failed | Should -Be 1
        $result.Results[1].state | Should -Be 'failed'
        $result.Results[2].state | Should -Be 'skipped'
        $result.Results[2].error | Should -Be 'batch-stopped'
        @($script:Audits | Where-Object { $_.result -eq 'failure' }).Count | Should -Be 1
        @($script:Audits | Where-Object { $_.result -eq 'success' }).Count | Should -Be 1
    }

    It 'continues past a failure when explicitly overridden' {
        $script:ExecPlan = @{ 'b' = 'failed' }
        $actions = @(
            (New-Action -Id 'a' -CheckId 'a'),
            (New-Action -Id 'b' -CheckId 'b'),
            (New-Action -Id 'c' -CheckId 'c')
        )

        $result = Invoke-RemediationApply `
            -Actions $actions -PlanId 'p1' -TenantId 't1' -DryRun:$false -ContinueOnFailure:$true `
            -ExecuteAction $script:ExecutorSeam -TestEligibility $script:EligibilitySeam `
            -UpdateAction $script:UpdateSeam -WriteAudit $script:AuditSeam

        $result.Summary.failed | Should -Be 1
        $result.Summary.applied | Should -Be 2
        $result.Results[2].state | Should -Be 'applied'
    }

    It 'treats a rejected action as a hard stop' {
        $script:ExecPlan = @{ 'a' = 'rejected' }
        $actions = @(
            (New-Action -Id 'a' -CheckId 'a'),
            (New-Action -Id 'b' -CheckId 'b')
        )

        $result = Invoke-RemediationApply `
            -Actions $actions -PlanId 'p1' -TenantId 't1' -DryRun:$false `
            -ExecuteAction $script:ExecutorSeam -TestEligibility $script:EligibilitySeam `
            -UpdateAction $script:UpdateSeam -WriteAudit $script:AuditSeam

        $result.StoppedOnFailure | Should -BeTrue
        $result.Results[0].state | Should -Be 'skipped'
        $result.Results[1].state | Should -Be 'skipped'
        $result.Results[1].error | Should -Be 'batch-stopped'
    }
}

Describe 'apply-remediation entrypoint' {
    BeforeAll {
        $script:repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
        $script:entrypoint = Join-Path $script:repoRoot 'portal/workers/apply-remediation.ps1'
        $script:handler = Join-Path $script:repoRoot 'portal/workers/M365Portal.Workers/Invoke-RemediationApply.ps1'
    }

    It 'exists and is wired to the handler and result envelope' {
        Test-Path -LiteralPath $script:entrypoint -PathType Leaf | Should -BeTrue
        Test-Path -LiteralPath $script:handler -PathType Leaf | Should -BeTrue

        $text = Get-Content -LiteralPath $script:entrypoint -Raw
        $text | Should -Match 'Invoke-RemediationApply'
        $text | Should -Match 'Write-WorkerResult'
        $text | Should -Match "JobType 'remediation'"
        $text | Should -Match 'remediation-apply\.json'
        # dryRun must default to true so an omitted flag cannot write.
        $text | Should -Match "-Name 'dryRun' -Default \`$true"
    }
}
