# Invoke-Drift.Tests.ps1
# Pester tests for T-0163 — drift detection (in-template mismatch + extra policy).
# Asserts: both deviation kinds are emitted distinctly; extra-policy detection
# covers CA and Intune only; deviations go through the T-0162 upsert seam and the
# worker never resolves or deletes anything.

#Requires -Module Pester
Set-StrictMode -Version Latest

Describe 'Invoke-Drift' {
    BeforeAll {
        $script:workerModule = Join-Path $PSScriptRoot '../../../portal/workers/M365Portal.Workers/M365Portal.Workers.psm1'
        Import-Module -Name $script:workerModule -Force

        $script:CurrentState = @{}
        $script:ExtraPolicies = @()
        $script:Upserts = [System.Collections.Generic.List[object]]::new()
        $script:RemediationCalls = [System.Collections.Generic.List[object]]::new()
        $script:RemediationResults = @{}

        $script:CollectCurrentSeam = {
            param($key, $resourceId)
            $mapKey = "$key|$resourceId"
            if ($script:CurrentState.ContainsKey($mapKey)) { return $script:CurrentState[$mapKey] }
            return $null
        }
        $script:CollectExtraSeam = { @($script:ExtraPolicies) }
        $script:UpsertSeam = {
            param($tenantId, $deviations)
            $script:Upserts.Add([PSCustomObject]@{ tenantId = $tenantId; deviations = $deviations }) | Out-Null
            return [PSCustomObject]@{ inserted = $deviations.Count; updated = 0; preserved = 0 }
        }
        $script:ApplyRemediationSeam = {
            param($standardKey, $resourceId, $expected)
            $script:RemediationCalls.Add([PSCustomObject]@{ standardKey = $standardKey; resourceId = $resourceId; expected = $expected }) | Out-Null
            if ($script:RemediationResults.ContainsKey($standardKey)) {
                return $script:RemediationResults[$standardKey]
            }
            return [PSCustomObject]@{ State = 'applied'; Reason = $null }
        }
    }

    BeforeEach {
        $script:CurrentState = @{}
        $script:ExtraPolicies = @()
        $script:Upserts.Clear()
        $script:RemediationCalls.Clear()
        $script:RemediationResults = @{}
    }

    It 'detects an in-template mismatch and an extra policy as distinct kinds' {
        # Template expects enabled; tenant currently has disabled.
        $script:CurrentState['CA-REPORTONLY-001|'] = [PSCustomObject]@{ state = 'disabled' }
        # Tenant has an extra CA policy not in the template.
        $script:ExtraPolicies = @(
            [PSCustomObject]@{ resourceType = 'conditionalAccess'; resourceId = 'extra-policy'; value = [PSCustomObject]@{ state = 'enabled' } }
        )

        $result = Invoke-Drift -TenantId 'contoso' -TemplateId 'drift-1' `
            -ExpectedSettings @([PSCustomObject]@{ key = 'CA-REPORTONLY-001'; value = [PSCustomObject]@{ state = 'enabled' } }) `
            -CollectCurrentState $script:CollectCurrentSeam `
            -CollectExtraPolicies $script:CollectExtraSeam `
            -UpsertDeviations $script:UpsertSeam

        $result.Counts.mismatch | Should -Be 1
        $result.Counts.extra | Should -Be 1
        $result.Counts.total | Should -Be 2

        $kinds = ($result.Deviations | ForEach-Object { $_.kind } | Sort-Object)
        $kinds | Should -Be @('extra', 'mismatch')

        $mismatch = $result.Deviations | Where-Object { $_.kind -eq 'mismatch' }
        $mismatch.standardKey | Should -Be 'CA-REPORTONLY-001'
        $mismatch.current.state | Should -Be 'disabled'
        $mismatch.expected.state | Should -Be 'enabled'

        $extra = $result.Deviations | Where-Object { $_.kind -eq 'extra' }
        $extra.standardKey | Should -Be 'extra:conditionalAccess'
        $extra.resourceId | Should -Be 'extra-policy'
        $extra.expected | Should -BeNullOrEmpty
    }

    It 'does not emit a mismatch when current already matches expected' {
        $script:CurrentState['ENTRA-SECDEFAULT-001|'] = [PSCustomObject]@{ enabled = $true }
        $result = Invoke-Drift -TenantId 'contoso' `
            -ExpectedSettings @([PSCustomObject]@{ key = 'ENTRA-SECDEFAULT-001'; value = [PSCustomObject]@{ enabled = $true } }) `
            -CollectCurrentState $script:CollectCurrentSeam `
            -CollectExtraPolicies $script:CollectExtraSeam `
            -UpsertDeviations $script:UpsertSeam

        $result.Counts.total | Should -Be 0
        # No deviations -> the upsert seam is not called.
        $script:Upserts.Count | Should -Be 0
    }

    It 'compares nested values order-independently' {
        $script:CurrentState['X-001|'] = [PSCustomObject]@{ a = 1; b = 2 }
        $result = Invoke-Drift -TenantId 'contoso' `
            -ExpectedSettings @([PSCustomObject]@{ key = 'X-001'; value = [PSCustomObject]@{ b = 2; a = 1 } }) `
            -CollectCurrentState $script:CollectCurrentSeam -CollectExtraPolicies $script:CollectExtraSeam -UpsertDeviations $script:UpsertSeam
        $result.Counts.mismatch | Should -Be 0
    }

    It 'covers CA and Intune extras and ignores other resource types' {
        $script:ExtraPolicies = @(
            [PSCustomObject]@{ resourceType = 'conditionalAccess'; resourceId = 'ca-1'; value = 1 },
            [PSCustomObject]@{ resourceType = 'intune'; resourceId = 'intune-1'; value = 2 },
            [PSCustomObject]@{ resourceType = 'exchange'; resourceId = 'exo-1'; value = 3 },
            [PSCustomObject]@{ resourceType = 'purview'; resourceId = 'pur-1'; value = 4 }
        )

        $result = Invoke-Drift -TenantId 'contoso' `
            -CollectCurrentState $script:CollectCurrentSeam `
            -CollectExtraPolicies $script:CollectExtraSeam `
            -UpsertDeviations $script:UpsertSeam

        $result.Counts.extra | Should -Be 2
        $keys = ($result.Deviations | ForEach-Object { $_.standardKey } | Sort-Object)
        $keys | Should -Be @('extra:conditionalAccess', 'extra:intune')
    }

    It 'accepts common resource-type spellings' {
        $script:ExtraPolicies = @(
            [PSCustomObject]@{ resourceType = 'conditional-access'; resourceId = 'ca-1'; value = 1 },
            [PSCustomObject]@{ resourceType = 'CA'; resourceId = 'ca-2'; value = 2 },
            [PSCustomObject]@{ resourceType = 'DeviceManagement'; resourceId = 'int-1'; value = 3 }
        )
        $result = Invoke-Drift -TenantId 'contoso' `
            -CollectCurrentState $script:CollectCurrentSeam -CollectExtraPolicies $script:CollectExtraSeam -UpsertDeviations $script:UpsertSeam
        $result.Counts.extra | Should -Be 3
    }

    It 'upserts every deviation through the T-0162 seam and never resolves' {
        $script:CurrentState['A-001|'] = 1
        $script:CurrentState['B-001|'] = 2
        $script:ExtraPolicies = @([PSCustomObject]@{ resourceType = 'intune'; resourceId = 'i-1'; value = 3 })

        $result = Invoke-Drift -TenantId 'contoso' `
            -ExpectedSettings @(
                [PSCustomObject]@{ key = 'A-001'; value = 9 },
                [PSCustomObject]@{ key = 'B-001'; value = 2 }
            ) `
            -CollectCurrentState $script:CollectCurrentSeam -CollectExtraPolicies $script:CollectExtraSeam -UpsertDeviations $script:UpsertSeam

        $script:Upserts.Count | Should -Be 1
        $script:Upserts[0].tenantId | Should -Be 'contoso'
        # Only the two detected deviations are handed over; B-001 matched so is absent.
        $script:Upserts[0].deviations.Count | Should -Be 2
        $result.Upsert.inserted | Should -Be 2
        # The result exposes no resolve/delete surface.
        $result.PSObject.Properties.Name | Should -Not -Contain 'Resolved'
        $result.PSObject.Properties.Name | Should -Not -Contain 'Deleted'
    }

    It 'is importable from the worker module' {
        (Get-Command -Module M365Portal.Workers -Name 'Invoke-Drift') | Should -Not -BeNullOrEmpty
    }

    It 'stays report-only and writes nothing when no toggle is enabled' {
        $script:CurrentState['A-001|'] = 1

        $result = Invoke-Drift -TenantId 'contoso' `
            -ExpectedSettings @([PSCustomObject]@{ key = 'A-001'; value = 9 }) `
            -CollectCurrentState $script:CollectCurrentSeam -CollectExtraPolicies $script:CollectExtraSeam `
            -UpsertDeviations $script:UpsertSeam -ApplyRemediation $script:ApplyRemediationSeam

        $result.Remediations.Count | Should -Be 0
        $result.RemediationSummary.total | Should -Be 0
        $script:RemediationCalls.Count | Should -Be 0
    }

    It 'auto-remediates only the mismatches whose setting is enabled' {
        $script:CurrentState['A-001|'] = 1
        $script:CurrentState['B-001|'] = 2
        $script:CurrentState['C-001|'] = 3

        $result = Invoke-Drift -TenantId 'contoso' `
            -ExpectedSettings @(
                [PSCustomObject]@{ key = 'A-001'; value = 9 },
                [PSCustomObject]@{ key = 'B-001'; value = 9 },
                [PSCustomObject]@{ key = 'C-001'; value = 3 }  # already compliant
            ) `
            -AutoRemediateKeys @('A-001') `
            -CollectCurrentState $script:CollectCurrentSeam -CollectExtraPolicies $script:CollectExtraSeam `
            -UpsertDeviations $script:UpsertSeam -ApplyRemediation $script:ApplyRemediationSeam

        # Only A-001 was enabled and mismatched.
        $script:RemediationCalls.Count | Should -Be 1
        $script:RemediationCalls[0].standardKey | Should -Be 'A-001'
        # The expected value is passed through, not the toggle.
        $script:RemediationCalls[0].expected | Should -Be 9

        $result.RemediationSummary.total | Should -Be 1
        $result.RemediationSummary.remediated | Should -Be 1
    }

    It 'never auto-remediates an extra policy' {
        $script:ExtraPolicies = @([PSCustomObject]@{ resourceType = 'intune'; resourceId = 'i-1'; value = 3 })

        $result = Invoke-Drift -TenantId 'contoso' `
            -AutoRemediateKeys @('extra:intune') `
            -CollectCurrentState $script:CollectCurrentSeam -CollectExtraPolicies $script:CollectExtraSeam `
            -UpsertDeviations $script:UpsertSeam -ApplyRemediation $script:ApplyRemediationSeam

        # Deleting a resource is the destructive deny path, never an implicit action.
        $script:RemediationCalls.Count | Should -Be 0
        $result.RemediationSummary.total | Should -Be 0
    }

    It 'records a gate failure as skipped and does not write directly' {
        $script:CurrentState['A-001|'] = 1
        # The EPIC-006 seam reports a gate skip (e.g. allowlist / licence).
        $script:RemediationResults['A-001'] = [PSCustomObject]@{ State = 'skipped'; Reason = 'not-allowlisted' }

        $result = Invoke-Drift -TenantId 'contoso' `
            -ExpectedSettings @([PSCustomObject]@{ key = 'A-001'; value = 9 }) `
            -AutoRemediateKeys @('A-001') `
            -CollectCurrentState $script:CollectCurrentSeam -CollectExtraPolicies $script:CollectExtraSeam `
            -UpsertDeviations $script:UpsertSeam -ApplyRemediation $script:ApplyRemediationSeam

        $result.Remediations.Count | Should -Be 1
        $result.Remediations[0].outcome | Should -Be 'skipped'
        $result.Remediations[0].reason | Should -Be 'not-allowlisted'
        $result.RemediationSummary.skipped | Should -Be 1
        # The seam was the only write path consulted.
        $script:RemediationCalls.Count | Should -Be 1
    }

    It 'records a remediation exception as failed without crashing the run' {
        $script:CurrentState['A-001|'] = 1
        $throwing = { param($k, $r, $e) throw 'apply blew up' }

        $result = Invoke-Drift -TenantId 'contoso' `
            -ExpectedSettings @([PSCustomObject]@{ key = 'A-001'; value = 9 }) `
            -AutoRemediateKeys @('A-001') `
            -CollectCurrentState $script:CollectCurrentSeam -CollectExtraPolicies $script:CollectExtraSeam `
            -UpsertDeviations $script:UpsertSeam -ApplyRemediation $throwing

        $result.Remediations[0].outcome | Should -Be 'failed'
        $result.Remediations[0].reason | Should -Match 'apply blew up'
        $result.RemediationSummary.failed | Should -Be 1
    }
}
