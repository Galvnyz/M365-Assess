BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-ComplianceSecurityConfig' {
    BeforeAll {
        # Stub the progress function so Add-Setting's guard passes
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        # Stub the three optional cmdlets so Get-Command finds them
        function Get-AdminAuditLogConfig {
            return @{ UnifiedAuditLogIngestionEnabled = $true }
        }

        function Get-DlpCompliancePolicy {
            return @(
                @{ Name = 'PII Protection'; Enabled = $true; TeamsLocation = @('All') }
                @{ Name = 'Financial Data'; Enabled = $true; TeamsLocation = $null; Workload = 'Exchange,SharePoint' }
                @{ Name = 'Disabled Policy'; Enabled = $false; TeamsLocation = $null; Workload = $null }
            )
        }

        function Get-LabelPolicy {
            return @(
                @{ Name = 'Default Label Policy'; Labels = @('Confidential', 'Public') }
            )
        }

        function Get-ProtectionAlert {
            return @(
                @{ Name = 'Activity from infrequent country'; Disabled = $false }
                @{ Name = 'Mass file deletion';               Disabled = $false }
                @{ Name = 'Disabled Alert';                   Disabled = $true }
            )
        }

        function Get-AutoSensitivityLabelPolicy {
            return @(
                @{ Name = 'Auto-label PII'; Enabled = $true }
            )
        }

        function Get-CommunicationCompliancePolicy {
            return @(
                @{ Name = 'Comm Compliance Policy'; Enabled = $true }
            )
        }

        # Run the collector by dot-sourcing it
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Security/Get-ComplianceSecurityConfig.ps1"
    }

    It 'Returns a non-empty settings list' {
        $settings.Count | Should -BeGreaterThan 0
    }

    It 'All settings have required properties' {
        foreach ($s in $settings) {
            $s.PSObject.Properties.Name | Should -Contain 'Category'
            $s.PSObject.Properties.Name | Should -Contain 'Setting'
            $s.PSObject.Properties.Name | Should -Contain 'Status'
            $s.PSObject.Properties.Name | Should -Contain 'CurrentValue'
            $s.PSObject.Properties.Name | Should -Contain 'RecommendedValue'
            $s.PSObject.Properties.Name | Should -Contain 'CheckId'
        }
    }

    It 'All Status values are valid' {
        $validStatuses = @('Pass', 'Fail', 'Warning', 'Review', 'Info', 'N/A')
        foreach ($s in $settings) {
            $s.Status | Should -BeIn $validStatuses `
                -Because "Setting '$($s.Setting)' has status '$($s.Status)'"
        }
    }

    It 'All non-empty CheckIds follow naming convention' {
        $withCheckId = $settings | Where-Object { $_.CheckId -and $_.CheckId.Trim() -ne '' }
        $withCheckId.Count | Should -BeGreaterThan 0
        foreach ($s in $withCheckId) {
            $s.CheckId | Should -Match '^[A-Z]+(-[A-Z0-9]+)+-\d{3}(\.\d+)?$' `
                -Because "CheckId '$($s.CheckId)' should follow convention"
        }
    }

    It 'All CheckIds use the COMPLIANCE- prefix' {
        $withCheckId = $settings | Where-Object { $_.CheckId -and $_.CheckId.Trim() -ne '' }
        foreach ($s in $withCheckId) {
            $s.CheckId | Should -Match '^COMPLIANCE-' `
                -Because "CheckId '$($s.CheckId)' should use COMPLIANCE- prefix"
        }
    }

    It 'Unified Audit Log check passes when enabled' {
        $auditCheck = $settings | Where-Object {
            $_.CheckId -like 'COMPLIANCE-AUDIT-001*' -and $_.Setting -eq 'Unified Audit Log (UAL) Ingestion'
        }
        $auditCheck | Should -Not -BeNullOrEmpty
        $auditCheck.Status | Should -Be 'Pass'
    }

    It 'DLP Policies check passes with enabled policies' {
        $dlpCheck = $settings | Where-Object {
            $_.CheckId -like 'COMPLIANCE-DLP-001*' -and $_.Setting -eq 'DLP Policies'
        }
        $dlpCheck | Should -Not -BeNullOrEmpty
        $dlpCheck.Status | Should -Be 'Pass'
    }

    It 'DLP Covers Teams check passes when at least one policy includes Teams' {
        $dlpTeams = $settings | Where-Object {
            $_.CheckId -like 'COMPLIANCE-DLP-002*' -and $_.Setting -eq 'DLP Covers Teams'
        }
        $dlpTeams | Should -Not -BeNullOrEmpty
        $dlpTeams.Status | Should -Be 'Pass'
    }

    It 'Sensitivity Label Policies check passes with published policies' {
        $labelCheck = $settings | Where-Object {
            $_.CheckId -like 'COMPLIANCE-LABELS-001*' -and $_.Setting -eq 'Sensitivity Label Policies'
        }
        $labelCheck | Should -Not -BeNullOrEmpty
        $labelCheck.Status | Should -Be 'Pass'
    }

    It 'DLP Workload Coverage check passes when Exchange and SharePoint are covered' {
        $dlpCoverage = $settings | Where-Object { $_.CheckId -like 'COMPLIANCE-DLP-003*' }
        $dlpCoverage | Should -Not -BeNullOrEmpty
        $dlpCoverage.Status | Should -Be 'Pass'
    }

    It 'Alert Policies check passes when enabled policies exist' {
        $alertCheck = $settings | Where-Object { $_.CheckId -like 'COMPLIANCE-ALERTPOLICY-001*' }
        $alertCheck | Should -Not -BeNullOrEmpty
        $alertCheck.Status | Should -Be 'Pass'
    }

    It 'Auto-Labeling check passes when enabled policies exist' {
        $autoLabel = $settings | Where-Object { $_.CheckId -like 'COMPLIANCE-LABELS-002*' }
        $autoLabel | Should -Not -BeNullOrEmpty
        $autoLabel.Status | Should -Be 'Pass'
    }

    It 'Communication Compliance check passes when enabled policies exist' {
        $comms = $settings | Where-Object { $_.CheckId -like 'COMPLIANCE-COMMS-001*' }
        $comms | Should -Not -BeNullOrEmpty
        $comms.Status | Should -Be 'Pass'
    }

    It 'Produces settings across multiple categories' {
        $categories = $settings | Select-Object -ExpandProperty Category -Unique
        $categories.Count | Should -BeGreaterOrEqual 4
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-ComplianceSecurityConfig - Cmdlets Not Available' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        # Do NOT define Get-AdminAuditLogConfig, Get-DlpCompliancePolicy, Get-LabelPolicy
        # so Get-Command returns $null for each, triggering the 'Review' paths

        # Run the collector by dot-sourcing it
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Security/Get-ComplianceSecurityConfig.ps1"
    }

    It 'Returns settings even when cmdlets are unavailable' {
        $settings.Count | Should -BeGreaterThan 0
    }

    It 'All unavailable-cmdlet checks have Review status' {
        foreach ($s in $settings) {
            $s.Status | Should -Be 'Review' `
                -Because "Setting '$($s.Setting)' should be Review when cmdlet is not available"
        }
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}
