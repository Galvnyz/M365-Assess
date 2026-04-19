BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Initialize-CheckProgress' {
    BeforeAll {
        . "$PSScriptRoot/../../src/M365-Assess/Common/Show-CheckProgress.ps1"
        Mock Write-Host { }
        Mock Write-Progress { }
    }

    Context 'when active sections have automated checks' {
        BeforeAll {
            $registry = @{
                'ENTRA-ADMIN-001' = @{ checkId = 'ENTRA-ADMIN-001'; hasAutomatedCheck = $true; collector = 'Entra' }
                'ENTRA-ADMIN-002' = @{ checkId = 'ENTRA-ADMIN-002'; hasAutomatedCheck = $true; collector = 'Entra' }
                'DNS-SPF-001'     = @{ checkId = 'DNS-SPF-001'; hasAutomatedCheck = $true; collector = 'DNS' }
                'MANUAL-001'      = @{ checkId = 'MANUAL-001'; hasAutomatedCheck = $false; collector = '' }
            }
            Initialize-CheckProgress -ControlRegistry $registry -ActiveSections @('Identity', 'Email')
        }

        It 'should set up global state' {
            $global:CheckProgressState | Should -Not -BeNullOrEmpty
        }

        It 'should count only automated checks in active sections' {
            $global:CheckProgressState.Total | Should -Be 3
        }

        It 'should start with zero completed' {
            $global:CheckProgressState.Completed | Should -Be 0
        }

        It 'should track collector counts' {
            $global:CheckProgressState.CollectorCounts['Entra'] | Should -Be 2
            $global:CheckProgressState.CollectorCounts['DNS'] | Should -Be 1
        }

        It 'should set Mode to Fallback in CI' {
            $global:CheckProgressState.Mode | Should -Be 'Fallback'
        }

        It 'should initialize Pass/Fail/Warn/Skip counters to zero' {
            $global:CheckProgressState.Pass | Should -Be 0
            $global:CheckProgressState.Fail | Should -Be 0
            $global:CheckProgressState.Warn | Should -Be 0
            $global:CheckProgressState.Skip | Should -Be 0
        }

        It 'should initialize Checks as an empty list' {
            $checks = $global:CheckProgressState.Checks
            $checks -is [System.Collections.Generic.List[hashtable]] | Should -Be $true
            $checks.Count | Should -Be 0
        }

        It 'should set Complete to false' {
            $global:CheckProgressState.Complete | Should -Be $false
        }
    }

    Context 'when no sections match any checks' {
        BeforeAll {
            $registry = @{
                'ENTRA-ADMIN-001' = @{ checkId = 'ENTRA-ADMIN-001'; hasAutomatedCheck = $true; collector = 'Entra' }
            }
            Initialize-CheckProgress -ControlRegistry $registry -ActiveSections @('PowerBI')
        }

        It 'should set total to 0' {
            $global:CheckProgressState.Total | Should -Be 0
        }
    }
}

Describe 'Update-CheckProgress' {
    BeforeAll {
        . "$PSScriptRoot/../../src/M365-Assess/Common/Show-CheckProgress.ps1"
        Mock Write-Host { }
        Mock Write-Progress { }

        $registry = @{
            'ENTRA-ADMIN-001' = @{ checkId = 'ENTRA-ADMIN-001'; hasAutomatedCheck = $true; collector = 'Entra' }
            'ENTRA-ADMIN-002' = @{ checkId = 'ENTRA-ADMIN-002'; hasAutomatedCheck = $true; collector = 'Entra' }
        }
        Initialize-CheckProgress -ControlRegistry $registry -ActiveSections @('Identity')
    }

    It 'should increment completed count' {
        Update-CheckProgress -CheckId 'ENTRA-ADMIN-001' -Setting 'Global Admin Count' -Status 'Pass'
        $global:CheckProgressState.Completed | Should -Be 1
    }

    It 'should not double-count the same check' {
        Update-CheckProgress -CheckId 'ENTRA-ADMIN-001' -Setting 'Global Admin Count' -Status 'Pass'
        $global:CheckProgressState.Completed | Should -Be 1
    }

    It 'should handle sub-numbered checks by base CheckId' {
        # ENTRA-ADMIN-002.1 shares the same base as ENTRA-ADMIN-002
        Update-CheckProgress -CheckId 'ENTRA-ADMIN-002.1' -Setting 'Sub check' -Status 'Fail'
        $global:CheckProgressState.Completed | Should -Be 2
        # Second sub-number shouldn't increment
        Update-CheckProgress -CheckId 'ENTRA-ADMIN-002.2' -Setting 'Sub check 2' -Status 'Pass'
        $global:CheckProgressState.Completed | Should -Be 2
    }

    It 'should ignore unknown check IDs' {
        $before = $global:CheckProgressState.Completed
        Update-CheckProgress -CheckId 'UNKNOWN-001' -Setting 'Unknown' -Status 'Pass'
        $global:CheckProgressState.Completed | Should -Be $before
    }
}

Describe 'Complete-CheckProgress' {
    BeforeAll {
        . "$PSScriptRoot/../../src/M365-Assess/Common/Show-CheckProgress.ps1"
        Mock Write-Host { }
        Mock Write-Progress { }

        $registry = @{
            'ENTRA-ADMIN-001' = @{ checkId = 'ENTRA-ADMIN-001'; hasAutomatedCheck = $true; collector = 'Entra' }
        }
        Initialize-CheckProgress -ControlRegistry $registry -ActiveSections @('Identity')
    }

    It 'should clean up global state' {
        Complete-CheckProgress
        $global:CheckProgressState | Should -BeNullOrEmpty
    }
}
