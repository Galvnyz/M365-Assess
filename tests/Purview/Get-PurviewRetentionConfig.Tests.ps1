BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-PurviewRetentionConfig' {
    BeforeAll {
        # Stub the progress function so Add-Setting's guard passes
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        # Return a set of healthy retention policies with full workload coverage
        function Get-RetentionCompliancePolicy {
            return @(
                [PSCustomObject]@{
                    Name               = 'All Content Retention'
                    Enabled            = $true
                    Mode               = 'Enforce'
                    ExchangeLocation   = @('All')
                    SharePointLocation = @('All')
                    OneDriveLocation   = @('All')
                    TeamsChannelLocation = @('All')
                    TeamsChatLocation    = @('All')
                    Workload           = 'Exchange,SharePoint,Teams'
                }
                [PSCustomObject]@{
                    Name               = 'Teams Retention'
                    Enabled            = $true
                    Mode               = 'Enforce'
                    ExchangeLocation   = @()
                    SharePointLocation = @()
                    OneDriveLocation   = @()
                    TeamsChannelLocation = @('All')
                    TeamsChatLocation    = @('All')
                    Workload           = 'Teams'
                }
            )
        }

        # Run the collector by dot-sourcing it
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Purview/Get-PurviewRetentionConfig.ps1"
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

    It 'All CheckIds use the PURVIEW-RETENTION- prefix' {
        $withCheckId = $settings | Where-Object { $_.CheckId -and $_.CheckId.Trim() -ne '' }
        foreach ($s in $withCheckId) {
            $s.CheckId | Should -Match '^PURVIEW-RETENTION-' `
                -Because "CheckId '$($s.CheckId)' should use PURVIEW-RETENTION- prefix"
        }
    }

    It 'Retention policies configured passes when enabled policies exist' {
        $check = $settings | Where-Object { $_.CheckId -like 'PURVIEW-RETENTION-001*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Exchange coverage passes when Exchange policies exist' {
        $check = $settings | Where-Object { $_.CheckId -like 'PURVIEW-RETENTION-002*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Teams coverage passes when Teams policies exist' {
        $check = $settings | Where-Object { $_.CheckId -like 'PURVIEW-RETENTION-003*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'SharePoint coverage passes when SharePoint policies exist' {
        $check = $settings | Where-Object { $_.CheckId -like 'PURVIEW-RETENTION-004*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Enforce mode passes when all policies are enforced' {
        $check = $settings | Where-Object { $_.CheckId -like 'PURVIEW-RETENTION-005*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Pass'
    }

    It 'Returns exactly 5 checks for full coverage scenario' {
        $settings.Count | Should -Be 5
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-PurviewRetentionConfig - No Policies' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        # Return no policies
        function Get-RetentionCompliancePolicy {
            return @()
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Purview/Get-PurviewRetentionConfig.ps1"
    }

    It 'Retention policies check fails when none exist' {
        $check = $settings | Where-Object { $_.CheckId -like 'PURVIEW-RETENTION-001*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail'
    }

    It 'Exchange coverage fails when no policies exist' {
        $check = $settings | Where-Object { $_.CheckId -like 'PURVIEW-RETENTION-002*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Fail'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-PurviewRetentionConfig - Test Mode Policies' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        # Return policies in simulation/test mode
        function Get-RetentionCompliancePolicy {
            return @(
                [PSCustomObject]@{
                    Name               = 'Exchange Simulation Policy'
                    Enabled            = $true
                    Mode               = 'TestWithNotifications'
                    ExchangeLocation   = @('All')
                    SharePointLocation = @()
                    OneDriveLocation   = @()
                    TeamsChannelLocation = @()
                    TeamsChatLocation    = @()
                    Workload           = 'Exchange'
                }
            )
        }

        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Purview/Get-PurviewRetentionConfig.ps1"
    }

    It 'Enforce mode warns when policies are in simulation mode' {
        $check = $settings | Where-Object { $_.CheckId -like 'PURVIEW-RETENTION-005*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Warning'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}

Describe 'Get-PurviewRetentionConfig - Cmdlet Unavailable' {
    BeforeAll {
        function global:Update-CheckProgress {
            param($CheckId, $Setting, $Status)
        }

        # Do NOT define Get-RetentionCompliancePolicy — simulates no Purview connection
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        . "$PSScriptRoot/../../src/M365-Assess/Purview/Get-PurviewRetentionConfig.ps1"
    }

    It 'Returns a Review status when cmdlet is unavailable' {
        $check = $settings | Where-Object { $_.CheckId -like 'PURVIEW-RETENTION-001*' }
        $check | Should -Not -BeNullOrEmpty
        $check.Status | Should -Be 'Review'
    }

    AfterAll {
        Remove-Item Function:\Update-CheckProgress -ErrorAction SilentlyContinue
    }
}
