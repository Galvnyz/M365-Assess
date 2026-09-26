# Invoke-Standard.Tests.ps1
# Pester tests for T-0145 — per-standard execution (report / alert / remediate).
# Asserts: report-only records current vs expected without any tenant write; a
# remediate/autoRemediate standard routes through the EPIC-006 contract and never
# writes directly; a missing licence is skipped with state `license missing`;
# alert raises only on a mismatch.

#Requires -Module Pester
Set-StrictMode -Version Latest

Describe 'Invoke-Standard' {
    BeforeAll {
        $script:workerModule = Join-Path $PSScriptRoot '../../../portal/workers/M365Portal.Workers/M365Portal.Workers.psm1'
        Import-Module -Name $script:workerModule -Force

        $script:CompareRows = [System.Collections.Generic.List[object]]::new()
        $script:Alerts = [System.Collections.Generic.List[object]]::new()
        $script:Audits = [System.Collections.Generic.List[object]]::new()
        $script:RemediationCalls = [System.Collections.Generic.List[object]]::new()

        $script:WriteCompareSeam = { param($row) $script:CompareRows.Add($row) | Out-Null }
        $script:RaiseAlertSeam = { param($event) $script:Alerts.Add($event) | Out-Null }
        $script:WriteAuditSeam = { param($event) $script:Audits.Add($event) | Out-Null }
    }

    BeforeEach {
        $script:CompareRows.Clear()
        $script:Alerts.Clear()
        $script:Audits.Clear()
        $script:RemediationCalls.Clear()
    }

    It 'report-only records current vs expected without writing to the tenant' {
        $remediation = { param($check, $expected) $script:RemediationCalls.Add($check) | Out-Null; [PSCustomObject]@{ State = 'applied' } }

        $result = Invoke-Standard -TenantId 'contoso' -Check 'ENTRA-SECDEFAULT-001' `
            -Current ([PSCustomObject]@{ enabled = $false }) `
            -Expected ([PSCustomObject]@{ enabled = $true }) `
            -Report:$true -Remediate:$false -Alert:$false `
            -WriteCompare $script:WriteCompareSeam -WriteAudit $script:WriteAuditSeam `
            -ApplyRemediation $remediation

        $result.State | Should -Be 'non-compliant'
        $result.DesiredMet | Should -BeFalse
        $result.Reported | Should -BeTrue
        $result.Remediated | Should -BeFalse
        $result.Alerted | Should -BeFalse

        $script:CompareRows.Count | Should -Be 1
        $script:CompareRows[0].current.enabled | Should -BeFalse
        $script:CompareRows[0].expected.enabled | Should -BeTrue
        $script:CompareRows[0].state | Should -Be 'non-compliant'
        $script:CompareRows[0].check | Should -Be 'ENTRA-SECDEFAULT-001'

        # Report-only never invokes remediation.
        $script:RemediationCalls.Count | Should -Be 0
    }

    It 'records a compliant row when current already matches expected' {
        $result = Invoke-Standard -TenantId 'contoso' -Check 'X-001' `
            -Current ([PSCustomObject]@{ enabled = $true }) `
            -Expected ([PSCustomObject]@{ enabled = $true }) `
            -WriteCompare $script:WriteCompareSeam -WriteAudit $script:WriteAuditSeam

        $result.State | Should -Be 'compliant'
        $result.DesiredMet | Should -BeTrue
        $script:CompareRows[0].state | Should -Be 'compliant'
    }

    It 'autoRemediate implies remediate and report' {
        $remediation = { param($check, $expected) $script:RemediationCalls.Add($check) | Out-Null; [PSCustomObject]@{ State = 'applied' } }

        $result = Invoke-Standard -TenantId 'contoso' -Check 'X-001' `
            -Current 1 -Expected 2 -AutoRemediate:$true `
            -WriteCompare $script:WriteCompareSeam -WriteAudit $script:WriteAuditSeam `
            -ApplyRemediation $remediation

        $result.State | Should -Be 'remediated'
        $result.Remediated | Should -BeTrue
        $result.Reported | Should -BeTrue
        $script:RemediationCalls.Count | Should -Be 1
        $script:CompareRows.Count | Should -Be 1
    }

    It 'routes a remediate standard through the EPIC-006 contract (default seam)' {
        # With no -ApplyRemediation the default seam builds a plan and applies it
        # via EPIC-006. A registry check resolves to an automated action, so the
        # apply summary reports zero failures (state applied).
        $result = Invoke-Standard -TenantId 'contoso' -Check 'ENTRA-SECDEFAULT-001' `
            -Current ([PSCustomObject]@{ enabled = $false }) `
            -Expected ([PSCustomObject]@{ enabled = $true }) `
            -Remediate:$true -WriteCompare $script:WriteCompareSeam -WriteAudit $script:WriteAuditSeam

        # The plan/apply contract ran; the standard did not write directly.
        $result.RemediationState | Should -Not -BeNullOrEmpty
        @($script:Audits | Where-Object { $_.action -eq 'standards.remediate' }).Count | Should -Be 1
    }

    It 'skips a standard whose licence is missing, without failing it' {
        $remediation = { param($check, $expected) $script:RemediationCalls.Add($check) | Out-Null; [PSCustomObject]@{ State = 'applied' } }

        $result = Invoke-Standard -TenantId 'contoso' -Check 'ENTRA-PIM-001' `
            -Current 1 -Expected 2 -Remediate:$true -Alert:$true -LicenseState 'license-missing' `
            -WriteCompare $script:WriteCompareSeam -WriteAudit $script:WriteAuditSeam -RaiseAlert $script:RaiseAlertSeam `
            -ApplyRemediation $remediation

        $result.State | Should -Be 'license missing'
        $result.Remediated | Should -BeFalse
        $result.Alerted | Should -BeFalse
        $script:RemediationCalls.Count | Should -Be 0
        $script:Alerts.Count | Should -Be 0
        # The skipped comparison is still recorded for the operator.
        $script:CompareRows[0].state | Should -Be 'license missing'
    }

    It 'uses the TestLicense seam to classify the licence' {
        $license = { param($check) 'license-missing' }
        $result = Invoke-Standard -TenantId 'contoso' -Check 'X-001' `
            -Current 1 -Expected 2 -TestLicense $license `
            -WriteCompare $script:WriteCompareSeam -WriteAudit $script:WriteAuditSeam

        $result.State | Should -Be 'license missing'
        $result.LicenseState | Should -Be 'license-missing'
    }

    It 'raises an alert only when current differs from desired' {
        # Mismatch -> alert.
        $mismatch = Invoke-Standard -TenantId 'contoso' -Check 'X-001' `
            -Current 1 -Expected 2 -Alert:$true `
            -WriteCompare $script:WriteCompareSeam -WriteAudit $script:WriteAuditSeam -RaiseAlert $script:RaiseAlertSeam
        $mismatch.Alerted | Should -BeTrue
        $script:Alerts.Count | Should -Be 1

        $script:Alerts.Clear()

        # Already compliant -> no alert.
        $compliant = Invoke-Standard -TenantId 'contoso' -Check 'X-001' `
            -Current 2 -Expected 2 -Alert:$true `
            -WriteCompare $script:WriteCompareSeam -WriteAudit $script:WriteAuditSeam -RaiseAlert $script:RaiseAlertSeam
        $compliant.Alerted | Should -BeFalse
        $script:Alerts.Count | Should -Be 0
    }

    It 'reads current state through the ReadCurrentState seam' {
        $reader = { param($check) [PSCustomObject]@{ enabled = $true } }
        $result = Invoke-Standard -TenantId 'contoso' -Check 'X-001' `
            -Expected ([PSCustomObject]@{ enabled = $true }) `
            -ReadCurrentState $reader `
            -WriteCompare $script:WriteCompareSeam -WriteAudit $script:WriteAuditSeam
        $result.DesiredMet | Should -BeTrue
        $result.State | Should -Be 'compliant'
    }

    It 'reports a failed remediation as a failed standard' {
        $remediation = { param($check, $expected) [PSCustomObject]@{ State = 'failed' } }
        $result = Invoke-Standard -TenantId 'contoso' -Check 'X-001' `
            -Current 1 -Expected 2 -Remediate:$true `
            -WriteCompare $script:WriteCompareSeam -WriteAudit $script:WriteAuditSeam -ApplyRemediation $remediation

        $result.State | Should -Be 'failed'
        $result.Remediated | Should -BeFalse
    }

    It 'treats a remediation exception as a failed standard, not a crash' {
        $remediation = { param($check, $expected) throw 'apply blew up' }
        $result = Invoke-Standard -TenantId 'contoso' -Check 'X-001' `
            -Current 1 -Expected 2 -Remediate:$true `
            -WriteCompare $script:WriteCompareSeam -WriteAudit $script:WriteAuditSeam -ApplyRemediation $remediation

        $result.State | Should -Be 'failed'
        $result.RemediationState | Should -Be 'failed'
        @($script:Audits | Where-Object { $_.result -eq 'failure' }).Count | Should -BeGreaterThan 0
    }
}
