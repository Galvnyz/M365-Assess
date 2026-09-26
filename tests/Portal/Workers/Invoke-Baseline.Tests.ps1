# Invoke-Baseline.Tests.ps1
# Pester tests for T-0184 — baseline state collectors + gated apply via EPIC-006.
# Asserts: the collector reads current state without writing; every apply write
# routes through the EPIC-006 seam and is audited; a gate failure skips the
# action with a recorded reason; report-only stages never call the apply seam.

#Requires -Module Pester
Set-StrictMode -Version Latest

Describe 'Invoke-Baseline' {
    BeforeAll {
        $script:workerModule = Join-Path $PSScriptRoot '../../../portal/workers/M365Portal.Workers/M365Portal.Workers.psm1'
        Import-Module -Name $script:workerModule -Force

        $script:CurrentState = @{}
        $script:RemediationCalls = [System.Collections.Generic.List[object]]::new()
        $script:RemediationResults = @{}
        $script:Audits = [System.Collections.Generic.List[object]]::new()

        $script:CollectSeam = {
            param($key)
            if ($script:CurrentState.ContainsKey($key)) { return $script:CurrentState[$key] }
            return $null
        }
        $script:ApplySeam = {
            param($standardKey, $expected)
            $script:RemediationCalls.Add([PSCustomObject]@{ standardKey = $standardKey; expected = $expected }) | Out-Null
            if ($script:RemediationResults.ContainsKey($standardKey)) {
                return $script:RemediationResults[$standardKey]
            }
            return [PSCustomObject]@{ State = 'applied'; Reason = $null }
        }
        $script:AuditSeam = {
            param($auditEvent)
            $script:Audits.Add($auditEvent) | Out-Null
        }

        $script:Stages = @(
            [PSCustomObject]@{
                order = 0
                action = 'report'
                conditions = @(
                    [PSCustomObject]@{ key = 'CA-REPORTONLY-001'; expected = 'enabled' }
                )
            },
            [PSCustomObject]@{
                order = 1
                action = 'remediate'
                conditions = @(
                    [PSCustomObject]@{ key = 'EXO-SHARING-001'; expected = 'disabled' }
                )
            }
        )
    }

    BeforeEach {
        $script:CurrentState = @{}
        $script:RemediationCalls.Clear()
        $script:RemediationResults = @{}
        $script:Audits.Clear()
    }

    It 'collects current state per stage without writing' {
        $script:CurrentState['CA-REPORTONLY-001'] = 'enabled'
        $script:CurrentState['EXO-SHARING-001'] = 'disabled'

        $result = Invoke-Baseline -TenantId 'contoso' -BaselineId 'bl-1' `
            -Stages $script:Stages `
            -CollectStageState $script:CollectSeam -ApplyRemediation $script:ApplySeam -WriteAudit $script:AuditSeam

        # Everything already matches: no mismatch, no write, no audit.
        $result.Summary.compliant | Should -Be 2
        $script:RemediationCalls.Count | Should -Be 0
        $script:Audits.Count | Should -Be 0
        $result.StageResults[0].compliant | Should -BeTrue
        $result.StageResults[1].compliant | Should -BeTrue
    }

    It 'records a report-stage mismatch without calling the apply seam' {
        $script:CurrentState['CA-REPORTONLY-001'] = 'disabled'
        $script:CurrentState['EXO-SHARING-001'] = 'disabled'

        $result = Invoke-Baseline -TenantId 'contoso' -BaselineId 'bl-1' `
            -Stages $script:Stages `
            -CollectStageState $script:CollectSeam -ApplyRemediation $script:ApplySeam -WriteAudit $script:AuditSeam

        $result.StageResults[0].compliant | Should -BeFalse
        $result.StageResults[0].mismatched | Should -Be 1
        # Report-only: observed but never written.
        $script:RemediationCalls.Count | Should -Be 0
    }

    It 'routes every remediate-stage write through the EPIC-006 seam and audits it' {
        $script:CurrentState['CA-REPORTONLY-001'] = 'enabled'
        $script:CurrentState['EXO-SHARING-001'] = 'enabled'

        $result = Invoke-Baseline -TenantId 'contoso' -BaselineId 'bl-1' `
            -Stages $script:Stages `
            -CollectStageState $script:CollectSeam -ApplyRemediation $script:ApplySeam -WriteAudit $script:AuditSeam

        $script:RemediationCalls.Count | Should -Be 1
        $script:RemediationCalls[0].standardKey | Should -Be 'EXO-SHARING-001'
        $script:RemediationCalls[0].expected | Should -Be 'disabled'
        $result.Summary.remediated | Should -Be 1

        $script:Audits.Count | Should -Be 1
        $script:Audits[0].action | Should -Be 'baseline.apply'
        $script:Audits[0].tenantId | Should -Be 'contoso'
        $script:Audits[0].baselineId | Should -Be 'bl-1'
        $script:Audits[0].outcome | Should -Be 'remediated'
    }

    It 'skips the action with a recorded reason on a gate failure' {
        $script:CurrentState['EXO-SHARING-001'] = 'enabled'
        # The EPIC-006 seam reports a gate skip (e.g. licence / allowlist).
        $script:RemediationResults['EXO-SHARING-001'] = [PSCustomObject]@{ State = 'skipped'; Reason = 'not-allowlisted' }

        $result = Invoke-Baseline -TenantId 'contoso' -BaselineId 'bl-1' `
            -Stages $script:Stages `
            -CollectStageState $script:CollectSeam -ApplyRemediation $script:ApplySeam -WriteAudit $script:AuditSeam

        $result.Summary.skipped | Should -Be 1
        $result.Summary.remediated | Should -Be 0
        # The seam was the only write path consulted.
        $script:RemediationCalls.Count | Should -Be 1
        $script:Audits.Count | Should -Be 1
        $script:Audits[0].outcome | Should -Be 'skipped'
        $script:Audits[0].reason | Should -Be 'not-allowlisted'
    }

    It 'records a remediation exception as failed without crashing the run' {
        $script:CurrentState['EXO-SHARING-001'] = 'enabled'
        $throwing = { param($k, $e) throw 'apply blew up' }

        $result = Invoke-Baseline -TenantId 'contoso' -BaselineId 'bl-1' `
            -Stages $script:Stages `
            -CollectStageState $script:CollectSeam -ApplyRemediation $throwing -WriteAudit $script:AuditSeam

        $result.Summary.failed | Should -Be 1
        $script:Audits[0].outcome | Should -Be 'failed'
        $script:Audits[0].reason | Should -Match 'apply blew up'
    }
}
