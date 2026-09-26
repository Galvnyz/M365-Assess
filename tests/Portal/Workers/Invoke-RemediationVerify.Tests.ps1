# Invoke-RemediationVerify.Tests.ps1
# Pester tests for T-0109 — verify after apply.
# Asserts: a flipped finding marks the action applied and re-evaluates the
# finding; a still-failing check leaves the finding and records `failed` + an
# alert; single-check is preferred when supported and the section fallback is
# used otherwise; every verify writes an AuditEvent; no tenant writes.

#Requires -Module Pester
Set-StrictMode -Version Latest

Describe 'Invoke-RemediationVerify' {
    BeforeAll {
        . (Join-Path $PSScriptRoot '../../../portal/workers/M365Portal.Workers/Invoke-RemediationVerify.ps1')

        function New-Action {
            param([string]$Id = 'a1', [string]$CheckId = 'ENTRA-SECDEFAULT-001.1', [string]$Section = '')
            $action = [PSCustomObject]@{ id = $Id; checkId = $CheckId }
            if ($Section) { $action | Add-Member -NotePropertyName 'section' -NotePropertyValue $Section }
            return $action
        }

        $script:FindingStatus = 'Pass'
        $script:CollectCheckCalls = [System.Collections.Generic.List[string]]::new()
        $script:CollectSectionCalls = [System.Collections.Generic.List[string]]::new()
        $script:ActionUpdates = [System.Collections.Generic.List[object]]::new()
        $script:FindingUpdates = [System.Collections.Generic.List[object]]::new()
        $script:Audits = [System.Collections.Generic.List[object]]::new()
        $script:Alerts = [System.Collections.Generic.List[object]]::new()

        $script:CollectCheckSeam = {
            param($checkId)
            $script:CollectCheckCalls.Add([string]$checkId) | Out-Null
            return [PSCustomObject]@{ Id = 'f1'; CheckId = $checkId; Status = $script:FindingStatus }
        }
        $script:CollectSectionSeam = {
            param($section)
            $script:CollectSectionCalls.Add([string]$section) | Out-Null
            return @(
                [PSCustomObject]@{ Id = 'f-other'; CheckId = 'OTHER-001'; Status = 'Fail' },
                [PSCustomObject]@{ Id = 'f1'; CheckId = 'ENTRA-SECDEFAULT-001.2'; Status = $script:FindingStatus }
            )
        }
        $script:UpdateActionSeam = { param($id, $update) $script:ActionUpdates.Add([PSCustomObject]@{ id = $id; update = $update }) | Out-Null }
        $script:UpdateFindingSeam = { param($id, $update) $script:FindingUpdates.Add([PSCustomObject]@{ id = $id; update = $update }) | Out-Null }
        $script:AuditSeam = { param($event) $script:Audits.Add($event) | Out-Null }
        $script:AlertSeam = { param($event) $script:Alerts.Add($event) | Out-Null }
    }

    BeforeEach {
        $script:FindingStatus = 'Pass'
        $script:CollectCheckCalls.Clear()
        $script:CollectSectionCalls.Clear()
        $script:ActionUpdates.Clear()
        $script:FindingUpdates.Clear()
        $script:Audits.Clear()
        $script:Alerts.Clear()
    }

    It 'flips the action to applied and re-evaluates the finding when the check now passes' {
        $result = Invoke-RemediationVerify `
            -Action (New-Action) -TenantId 't1' -SingleCheckSupported:$true -Actor 'user-1' `
            -CollectCheck $script:CollectCheckSeam -CollectSection $script:CollectSectionSeam `
            -UpdateAction $script:UpdateActionSeam -UpdateFinding $script:UpdateFindingSeam `
            -WriteAudit $script:AuditSeam -RaiseAlert $script:AlertSeam

        $result.Strategy | Should -Be 'single-check'
        $result.Passed | Should -BeTrue
        $result.ActionState | Should -Be 'applied'
        $result.ReEvaluated | Should -BeTrue
        $result.Alerted | Should -BeFalse

        $script:ActionUpdates.Count | Should -Be 1
        $script:ActionUpdates[0].update.state | Should -Be 'applied'
        $script:FindingUpdates.Count | Should -Be 1
        $script:FindingUpdates[0].update.status | Should -Be 'Pass'
        $script:Audits.Count | Should -Be 1
        $script:Audits[0].action | Should -Be 'remediation.verify'
        $script:Audits[0].result | Should -Be 'success'
        $script:Alerts.Count | Should -Be 0
    }

    It 'leaves the finding and records failed + an alert when the check still fails' {
        $script:FindingStatus = 'Fail'

        $result = Invoke-RemediationVerify `
            -Action (New-Action) -TenantId 't1' -SingleCheckSupported:$true `
            -CollectCheck $script:CollectCheckSeam -CollectSection $script:CollectSectionSeam `
            -UpdateAction $script:UpdateActionSeam -UpdateFinding $script:UpdateFindingSeam `
            -WriteAudit $script:AuditSeam -RaiseAlert $script:AlertSeam

        $result.Passed | Should -BeFalse
        $result.ActionState | Should -Be 'failed'
        $result.Alerted | Should -BeTrue

        $script:ActionUpdates[0].update.state | Should -Be 'failed'
        $script:FindingUpdates.Count | Should -Be 0
        $script:Alerts.Count | Should -Be 1
        $script:Audits[0].result | Should -Be 'failure'
    }

    It 'uses the section re-run when single-check is not supported' {
        $result = Invoke-RemediationVerify `
            -Action (New-Action -Section 'Entra') -TenantId 't1' -SingleCheckSupported:$false `
            -CollectCheck $script:CollectCheckSeam -CollectSection $script:CollectSectionSeam `
            -UpdateAction $script:UpdateActionSeam -UpdateFinding $script:UpdateFindingSeam `
            -WriteAudit $script:AuditSeam -RaiseAlert $script:AlertSeam

        $result.Strategy | Should -Be 'section'
        $script:CollectSectionCalls | Should -Contain 'Entra'
        $script:CollectCheckCalls.Count | Should -Be 0
        # Matched by registry key (sub-number stripped), so the finding still resolves.
        $result.FindingStatus | Should -Be 'Pass'
        $result.ReEvaluated | Should -BeTrue
    }

    It 'honours the single-check support probe seam' {
        $probe = { param($checkId) return $false }
        $result = Invoke-RemediationVerify `
            -Action (New-Action -Section 'Entra') -TenantId 't1' `
            -TestSingleCheckSupport $probe `
            -CollectCheck $script:CollectCheckSeam -CollectSection $script:CollectSectionSeam `
            -UpdateAction $script:UpdateActionSeam -UpdateFinding $script:UpdateFindingSeam `
            -WriteAudit $script:AuditSeam -RaiseAlert $script:AlertSeam

        $result.Strategy | Should -Be 'section'
    }

    It 'records failed and alerts when the finding cannot be re-collected' {
        $emptySection = { param($section) return @() }
        $result = Invoke-RemediationVerify `
            -Action (New-Action -Section 'Entra') -TenantId 't1' -SingleCheckSupported:$false `
            -CollectCheck $script:CollectCheckSeam -CollectSection $emptySection `
            -UpdateAction $script:UpdateActionSeam -UpdateFinding $script:UpdateFindingSeam `
            -WriteAudit $script:AuditSeam -RaiseAlert $script:AlertSeam

        $result.Passed | Should -BeFalse
        $result.ActionState | Should -Be 'failed'
        $script:Alerts.Count | Should -Be 1
        $script:Audits.Count | Should -Be 1
    }

    It 'fails fast when neither a collector nor a section is available' {
        $action = New-Action
        {
            Invoke-RemediationVerify -Action $action -TenantId 't1' -SingleCheckSupported:$false `
                -CollectCheck $script:CollectCheckSeam -CollectSection $script:CollectSectionSeam `
                -UpdateAction $script:UpdateActionSeam -WriteAudit $script:AuditSeam
        } | Should -Throw -ExceptionType ([System.InvalidOperationException])
    }
}
